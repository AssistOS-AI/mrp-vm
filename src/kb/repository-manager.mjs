import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { KnowledgeBase } from './knowledge-base.mjs';
import { FileMemoryPersistence } from './persistence.mjs';
import { KBIndex } from '../retrieval/kb-index.mjs';
import { MRPError } from '../lib/errors.mjs';

function ensureDir(dir) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function repoMetaPath(rootDir) {
  return join(rootDir, 'repo.json');
}

function readRepoMeta(rootDir, fallback) {
  const filePath = repoMetaPath(rootDir);
  if (!existsSync(filePath)) return fallback;
  return { ...fallback, ...JSON.parse(readFileSync(filePath, 'utf-8')) };
}

function writeRepoMeta(rootDir, meta) {
  ensureDir(rootDir);
  writeFileSync(repoMetaPath(rootDir), JSON.stringify(meta, null, 2), 'utf-8');
}

export class KBRepositoryManager {
  constructor(ingestor, retrievalConfig, kbConfig) {
    this.ingestor = ingestor;
    this.retrievalConfig = retrievalConfig;
    this.kbConfig = kbConfig;
    this.defaultKbId = 'default';
    this.defaultRootDir = dirname(resolve(kbConfig.paths.sources));
    this.repositoriesDir = join(this.defaultRootDir, 'repositories');
    this.workspacesDir = resolve(kbConfig.workspaceRootDir || join(dirname(this.defaultRootDir), 'workspaces'));
    this.repositories = new Map();
  }

  async boot() {
    ensureDir(this.defaultRootDir);
    ensureDir(this.repositoriesDir);
    ensureDir(this.workspacesDir);
    await this._loadRepository(this.defaultKbId, this.defaultRootDir, {
      kbId: this.defaultKbId,
      name: 'Default KB',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      parentKbId: null,
      isDefault: true
    });
    for (const entry of readdirSync(this.repositoriesDir)) {
      const rootDir = join(this.repositoriesDir, entry);
      if (!statSync(rootDir).isDirectory()) continue;
      await this._loadRepository(entry, rootDir, {
        kbId: entry,
        name: entry,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        parentKbId: null,
        isDefault: false
      });
    }
  }

  listRepositories() {
    return [...this.repositories.values()]
      .map(record => ({
        kbId: record.meta.kbId,
        name: record.meta.name,
        createdAt: record.meta.createdAt,
        updatedAt: record.meta.updatedAt,
        parentKbId: record.meta.parentKbId || null,
        isDefault: !!record.meta.isDefault,
        sourceCount: record.kb.getSources().length,
        unitCount: record.kb.getAllUnits().length
      }))
      .sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.name.localeCompare(b.name));
  }

  getDefaultRepository() {
    return this.getRepository(this.defaultKbId);
  }

  getRepository(kbId) {
    const record = this.repositories.get(kbId);
    if (!record) throw new MRPError('KB_NOT_FOUND', 'kb-repositories', `KB '${kbId}' not found`);
    return record;
  }

  getRepositoryMeta(kbId) {
    return { ...this.getRepository(kbId).meta };
  }

  async exportSnapshot(kbId) {
    const record = this.getRepository(kbId);
    return record.kb.exportSnapshot();
  }

  async createRepositoryFromSnapshot(name, snapshot, options = {}) {
    const kbId = options.kbId || this._generateKbId(name);
    const rootDir = join(this.repositoriesDir, kbId);
    const meta = {
      kbId,
      name: name || kbId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      parentKbId: options.parentKbId || null,
      isDefault: false
    };
    if (this.repositories.has(kbId)) {
      throw new MRPError('KB_VALIDATION_DUPLICATE_ID', 'kb-repositories', `KB '${kbId}' already exists`);
    }
    const record = await this._loadRepository(kbId, rootDir, meta);
    await record.kb.replaceAllSources(snapshot);
    writeRepoMeta(rootDir, meta);
    record.meta = meta;
    this.repositories.set(kbId, record);
    return this.getRepositoryMeta(kbId);
  }

  async saveSnapshotToRepository(kbId, snapshot, options = {}) {
    const record = this.getRepository(kbId);
    await record.kb.replaceAllSources(snapshot);
    record.meta = {
      ...record.meta,
      name: options.name || record.meta.name,
      updatedAt: new Date().toISOString()
    };
    writeRepoMeta(record.rootDir, record.meta);
    return this.getRepositoryMeta(kbId);
  }

  async forkRepository(kbId, name) {
    const snapshot = await this.exportSnapshot(kbId);
    return this.createRepositoryFromSnapshot(name, snapshot, { parentKbId: kbId });
  }

  async persistWorkspace(session) {
    const rootDir = this._workspaceRoot(session.sessionId);
    ensureDir(rootDir);
    const persistence = new FileMemoryPersistence(this._buildWorkspaceConfig(rootDir));
    await persistence.resetRepository();
    const snapshot = session.workspace.toSnapshot({
      includeConversationUnits: true,
      conversationUnits: session.sessionContextUnits
    });
    for (const entry of snapshot.sources) {
      await persistence.saveSourceMeta(entry.meta.sourceId, entry.meta);
      await persistence.saveRawSource(entry.meta.sourceId, entry.meta.name, entry.content || '');
      await persistence.saveContextUnits(entry.meta.sourceId, entry.units || []);
    }
    const workspaceIndex = new KBIndex(this.retrievalConfig);
    workspaceIndex.rebuild(snapshot.sources.flatMap(entry => entry.units || []));
    await persistence.saveIndex(workspaceIndex.toIndexData());
    writeFileSync(join(rootDir, 'workspace.json'), JSON.stringify({
      sessionId: session.sessionId,
      mountedKbId: session.mountedKbId,
      mountedKbName: session.mountedKbName,
      dirty: session.workspace.dirty,
      lastSavedAt: session.workspace.lastSavedAt || null,
      updatedAt: new Date().toISOString(),
      sourceCount: snapshot.sources.length
    }, null, 2), 'utf-8');
  }

  removeWorkspace(sessionId) {
    rmSync(this._workspaceRoot(sessionId), { recursive: true, force: true });
  }

  _generateKbId(name) {
    const base = (name || `kb-${randomUUID().substring(0, 6)}`)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || `kb-${randomUUID().substring(0, 6)}`;
    let kbId = base;
    let suffix = 0;
    while (this.repositories.has(kbId) || existsSync(join(this.repositoriesDir, kbId))) {
      suffix += 1;
      kbId = `${base}-${suffix}`;
    }
    return kbId;
  }

  async _loadRepository(kbId, rootDir, fallbackMeta) {
    ensureDir(rootDir);
    const config = this._buildRepoConfig(rootDir);
    const kb = new KnowledgeBase(
      this.ingestor,
      new KBIndex(this.retrievalConfig),
      new FileMemoryPersistence(config),
      this.kbConfig
    );
    await kb.boot();
    const meta = readRepoMeta(rootDir, fallbackMeta);
    writeRepoMeta(rootDir, meta);
    const record = { kbId, rootDir, kb, meta };
    this.repositories.set(kbId, record);
    return record;
  }

  _buildRepoConfig(rootDir) {
    return {
      ...this.kbConfig,
      paths: {
        sources: join(rootDir, 'sources'),
        cnl: join(rootDir, 'cnl'),
        meta: join(rootDir, 'meta'),
        index: join(rootDir, 'index'),
        quarantine: join(rootDir, 'quarantine')
      }
    };
  }

  _buildWorkspaceConfig(rootDir) {
    return {
      ...this.kbConfig,
      paths: {
        sources: join(rootDir, 'sources'),
        cnl: join(rootDir, 'cnl'),
        meta: join(rootDir, 'meta'),
        index: join(rootDir, 'index'),
        quarantine: join(rootDir, 'quarantine')
      }
    };
  }

  _workspaceRoot(sessionId) {
    return join(this.workspacesDir, sessionId);
  }
}
