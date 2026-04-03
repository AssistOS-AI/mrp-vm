// DS010 — File-Memory Persistence Strategy
import { writeFileSync, readFileSync, readdirSync, existsSync, mkdirSync, renameSync, unlinkSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { CNLValidator, CNLParser } from '../parser/cnl-validator-parser.mjs';
import { logger } from '../platform/logger.mjs';
import { createSOPBuilder, renderSOPValue, sopRef } from '../../mrp-vm-sdk/control/sop.mjs';

const MOD = 'persistence';

function ensureDir(dir) { if (!existsSync(dir)) mkdirSync(dir, { recursive: true }); }

function atomicWrite(filePath, content) {
  const tmp = filePath + '.tmp';
  writeFileSync(tmp, content, 'utf-8');
  renameSync(tmp, filePath);
}

function pluginDir(baseDir, pluginId) {
  const dir = join(baseDir, 'plugins', pluginId);
  ensureDir(dir);
  return dir;
}

function clearDir(dir) {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir)) {
    const filePath = join(dir, entry);
    if (statSync(filePath).isFile()) unlinkSync(filePath);
  }
}

export class FileMemoryPersistence {
  constructor(config) {
    this.paths = {};
    const base = config.paths || {};
    for (const [k, v] of Object.entries(base)) this.paths[k] = resolve(v);
    for (const dir of Object.values(this.paths)) ensureDir(dir);
  }

  async saveContextUnits(sourceId, units) {
    const lines = this._unitsToSOP(units);
    atomicWrite(join(this.paths.cnl, `${sourceId}.cnl.md`), lines);
  }

  async loadContextUnits(sourceId) {
    const fp = join(this.paths.cnl, `${sourceId}.cnl.md`);
    if (!existsSync(fp)) return [];
    const parser = new CNLParser();
    return parser.parseContextCNL(readFileSync(fp, 'utf-8'));
  }

  async removeContextUnits(sourceId) {
    const fp = join(this.paths.cnl, `${sourceId}.cnl.md`);
    if (existsSync(fp)) unlinkSync(fp);
  }

  async loadAllContextUnits() {
    const dir = this.paths.cnl;
    if (!existsSync(dir)) return [];
    const validator = new CNLValidator();
    const parser = new CNLParser();
    const all = [];
    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.cnl.md')) continue;
      const fp = join(dir, f);
      const content = readFileSync(fp, 'utf-8');
      const vr = validator.validateContextCNL(content);
      if (!vr.valid) {
        logger.warn(MOD, `Invalid CNL file ${f}, quarantining`, { errors: vr.errors });
        ensureDir(this.paths.quarantine);
        renameSync(fp, join(this.paths.quarantine, f));
        continue;
      }
      all.push(...parser.parseContextCNL(content));
    }
    return all;
  }

  async saveSourceMeta(sourceId, meta) {
    atomicWrite(join(this.paths.meta, `${sourceId}.meta.json`), JSON.stringify(meta, null, 2));
  }

  async loadSourceMeta(sourceId) {
    const fp = join(this.paths.meta, `${sourceId}.meta.json`);
    if (!existsSync(fp)) return null;
    return JSON.parse(readFileSync(fp, 'utf-8'));
  }

  async loadAllSourceMeta() {
    const dir = this.paths.meta;
    if (!existsSync(dir)) return [];
    const metas = [];
    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.meta.json')) continue;
      metas.push(JSON.parse(readFileSync(join(dir, f), 'utf-8')));
    }
    return metas;
  }

  async removeSourceMeta(sourceId) {
    const fp = join(this.paths.meta, `${sourceId}.meta.json`);
    if (existsSync(fp)) unlinkSync(fp);
  }

  async saveRawSource(sourceId, name, content) {
    atomicWrite(join(this.paths.sources, `${sourceId}.src`), content);
  }

  async loadRawSource(sourceId) {
    const fp = join(this.paths.sources, `${sourceId}.src`);
    if (!existsSync(fp)) return null;
    return readFileSync(fp, 'utf-8');
  }

  async removeRawSource(sourceId) {
    const fp = join(this.paths.sources, `${sourceId}.src`);
    if (existsSync(fp)) unlinkSync(fp);
  }

  async saveIndex(indexData) {
    atomicWrite(join(this.paths.index, 'bm25-index.json'), JSON.stringify(indexData));
  }

  async loadIndex() {
    const fp = join(this.paths.index, 'bm25-index.json');
    if (!existsSync(fp)) return null;
    return JSON.parse(readFileSync(fp, 'utf-8'));
  }

  async isIndexValid(allUnits) {
    const data = await this.loadIndex();
    if (!data) return false;
    if (data.schemaVersion !== 1) return false;
    if (data.unitCount !== allUnits.length) return false;
    for (const u of allUnits) {
      if (data.unitHashes[u.id] !== (u.hash || '')) return false;
    }
    return true;
  }

  async cleanTempFiles() {
    for (const dir of Object.values(this.paths)) {
      if (!existsSync(dir)) continue;
      for (const f of readdirSync(dir)) {
        if (f.endsWith('.tmp')) {
          unlinkSync(join(dir, f));
          logger.info(MOD, `Removed stale temp file: ${f}`);
        }
      }
    }
  }

  async resetRepository() {
    clearDir(this.paths.sources);
    clearDir(this.paths.cnl);
    clearDir(this.paths.meta);
    clearDir(this.paths.index);
  }

  getPluginArtifactDir(pluginId) {
    return pluginDir(resolve(this.paths.sources, '..'), pluginId);
  }

  async savePluginArtifact(pluginId, artifactName, payload) {
    const dir = this.getPluginArtifactDir(pluginId);
    const filePath = join(dir, artifactName);
    const content = typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2);
    atomicWrite(filePath, content);
    return filePath;
  }

  _unitsToSOP(units = []) {
    const builder = createSOPBuilder();
    const refByUnitId = new Map();

    for (const unit of units) {
      const kuId = builder.nextId('k');
      refByUnitId.set(unit.id, kuId);
      builder.push(kuId, 'ku', renderSOPValue(unit.kuType || 'atomic'), renderSOPValue(unit.id, { forceQuoted: true }));
      builder.push(builder.nextId('ks'), 'set', sopRef(kuId), 'sourceId', renderSOPValue(unit.sourceId));
      if (unit.sourceName) builder.push(builder.nextId('ks'), 'set', sopRef(kuId), 'sourceName', renderSOPValue(unit.sourceName, { forceQuoted: true }));
      if (unit.sourceType) builder.push(builder.nextId('ks'), 'set', sopRef(kuId), 'sourceType', renderSOPValue(unit.sourceType));
      if (unit.author) builder.push(builder.nextId('ks'), 'set', sopRef(kuId), 'author', renderSOPValue(unit.author, { forceQuoted: true }));
      builder.push(builder.nextId('ks'), 'set', sopRef(kuId), 'chunkId', renderSOPValue(unit.chunkId));
      if (unit.chunkIndex !== null && unit.chunkIndex !== undefined) builder.push(builder.nextId('ks'), 'set', sopRef(kuId), 'chunkIndex', renderSOPValue(unit.chunkIndex));
      if (unit.unitIndex !== null && unit.unitIndex !== undefined) builder.push(builder.nextId('ks'), 'set', sopRef(kuId), 'unitIndex', renderSOPValue(unit.unitIndex));
      if (unit.unitType) builder.push(builder.nextId('ks'), 'set', sopRef(kuId), 'unitType', renderSOPValue(unit.unitType));
      if (unit.textBody) builder.push(builder.nextId('ks'), 'set', sopRef(kuId), 'textBody', renderSOPValue(unit.textBody, { forceQuoted: true }));
      if (unit.title) builder.push(builder.nextId('ks'), 'set', sopRef(kuId), 'title', renderSOPValue(unit.title, { forceQuoted: true }));
      builder.push(builder.nextId('ks'), 'set', sopRef(kuId), 'role', renderSOPValue(unit.role));
      builder.push(builder.nextId('ks'), 'set', sopRef(kuId), 'topic', renderSOPValue(unit.topic, { forceQuoted: true }));
      if (unit.claim) builder.push(builder.nextId('ks'), 'set', sopRef(kuId), 'claim', renderSOPValue(unit.claim, { forceQuoted: true }));
      if (unit.condition) builder.push(builder.nextId('ks'), 'set', sopRef(kuId), 'condition', renderSOPValue(unit.condition, { forceQuoted: true }));
      if (unit.procedure) builder.push(builder.nextId('ks'), 'set', sopRef(kuId), 'procedure', renderSOPValue(unit.procedure, { forceQuoted: true }));
      if (unit.charStart !== null && unit.charStart !== undefined) builder.push(builder.nextId('ks'), 'set', sopRef(kuId), 'charStart', renderSOPValue(unit.charStart));
      if (unit.charEnd !== null && unit.charEnd !== undefined) builder.push(builder.nextId('ks'), 'set', sopRef(kuId), 'charEnd', renderSOPValue(unit.charEnd));
      if (unit.createdAt) builder.push(builder.nextId('ks'), 'set', sopRef(kuId), 'createdAt', renderSOPValue(unit.createdAt));
      if (unit.ingestedAt) builder.push(builder.nextId('ks'), 'set', sopRef(kuId), 'ingestedAt', renderSOPValue(unit.ingestedAt));
      if (unit.knowledgeDate) builder.push(builder.nextId('ks'), 'set', sopRef(kuId), 'knowledgeDate', renderSOPValue(unit.knowledgeDate));
      if (unit.chunkType) builder.push(builder.nextId('ks'), 'set', sopRef(kuId), 'chunkType', renderSOPValue(unit.chunkType));
      if (unit.sectionTitle) builder.push(builder.nextId('ks'), 'set', sopRef(kuId), 'sectionTitle', renderSOPValue(unit.sectionTitle, { forceQuoted: true }));
      if (unit.subject) builder.push(builder.nextId('ks'), 'set', sopRef(kuId), 'symbolicSubject', renderSOPValue(unit.subject));
      if (unit.relation) builder.push(builder.nextId('ks'), 'set', sopRef(kuId), 'symbolicRelation', renderSOPValue(unit.relation));
      if (unit.object) builder.push(builder.nextId('ks'), 'set', sopRef(kuId), 'symbolicObject', renderSOPValue(unit.object));
      if (unit.confidence !== null && unit.confidence !== undefined) builder.push(builder.nextId('ks'), 'set', sopRef(kuId), 'confidence', renderSOPValue(unit.confidence));
      if (unit.utilityActs?.length) builder.push(builder.nextId('ks'), 'set', sopRef(kuId), 'utilityActs', renderSOPValue(unit.utilityActs));
      if (unit.phaseScopes?.length) builder.push(builder.nextId('ks'), 'set', sopRef(kuId), 'phaseScopes', renderSOPValue(unit.phaseScopes));
      if (unit.utilityNote) builder.push(builder.nextId('ks'), 'set', sopRef(kuId), 'utilityNote', renderSOPValue(unit.utilityNote, { forceQuoted: true }));
      if (unit.hash) builder.push(builder.nextId('ks'), 'set', sopRef(kuId), 'hash', renderSOPValue(unit.hash));
    }

    for (const unit of units) {
      const kuId = refByUnitId.get(unit.id);
      if (!kuId) continue;
      for (const parentId of unit.parentUnitIds || []) {
        const parentRef = refByUnitId.get(parentId);
        if (parentRef) {
          builder.push(builder.nextId('kr'), 'parent', sopRef(kuId), sopRef(parentRef));
        }
      }
      for (const sourceId of unit.derivedFromUnitIds || []) {
        const sourceRef = refByUnitId.get(sourceId);
        if (sourceRef) {
          builder.push(builder.nextId('kr'), 'derived_from', sopRef(kuId), sopRef(sourceRef));
        }
      }
    }

    return builder.toString();
  }
}
