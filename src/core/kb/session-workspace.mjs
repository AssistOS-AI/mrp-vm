import { createHash } from 'node:crypto';
import { KBIndex } from './index.mjs';

function cloneUnit(unit) {
  return {
    ...unit,
    utilityActs: [...(unit.utilityActs || [])],
    phaseScopes: [...(unit.phaseScopes || [])]
  };
}

function cloneEntry(entry) {
  return {
    meta: { ...(entry.meta || {}) },
    content: entry.content || '',
    units: (entry.units || []).map(cloneUnit),
    kind: entry.kind || entry.meta?.kind || 'source'
  };
}

function hashUnit(unit) {
  return createHash('sha256')
    .update(`${unit.claim || ''}|${unit.procedure || ''}|${unit.role}|${unit.topic}|${(unit.phaseScopes || []).join(',')}|${unit.subject || ''}|${unit.relation || ''}|${unit.object || ''}`)
    .digest('hex');
}

function buildSourceHash(name) {
  return createHash('sha256').update(name).digest('hex').substring(0, 12);
}

function cloneConversationUnit(unit, sourceId, chunkId, idx) {
  const next = cloneUnit(unit);
  next.sourceId = sourceId;
  next.chunkId = chunkId;
  next.id = `${sourceId}::chunk-000::unit-${String(idx).padStart(3, '0')}`;
  next.hash = hashUnit(next);
  return next;
}

export class SessionWorkspace {
  constructor(sessionId, retrievalConfig = {}) {
    this.sessionId = sessionId;
    this.retrievalConfig = retrievalConfig;
    this.index = new KBIndex(retrievalConfig);
    this.entries = new Map();
    this.mountedKbId = null;
    this.mountedKbName = null;
    this.dirty = false;
    this.lastSavedAt = null;
  }

  mountFromSnapshot(repositoryMeta, snapshot) {
    this.entries.clear();
    for (const entry of snapshot?.sources || []) {
      this.entries.set(entry.meta.sourceId, cloneEntry(entry));
    }
    this.mountedKbId = repositoryMeta?.kbId || 'default';
    this.mountedKbName = repositoryMeta?.name || this.mountedKbId;
    this.dirty = false;
    this.lastSavedAt = repositoryMeta?.updatedAt || null;
    this._rebuildIndex();
  }

  stageSource(name, content, units, options = {}) {
    const now = new Date().toISOString();
    const existing = options.sourceId ? this.entries.get(options.sourceId) : null;
    const sourceId = options.sourceId || this._generateSourceId(name);
    const nextUnits = (units || []).map(unit => {
      const next = cloneUnit(unit);
      next.sourceId = sourceId;
      next.hash = next.hash || hashUnit(next);
      return next;
    });
    const meta = {
      sourceId,
      name,
      addedAt: existing?.meta?.addedAt || now,
      updatedAt: now,
      chunkCount: new Set(nextUnits.map(u => u.chunkId)).size,
      unitCount: nextUnits.length,
      status: 'ready',
      hash: createHash('sha256').update(content || '').digest('hex'),
      kind: options.kind || 'source'
    };
    this.entries.set(sourceId, {
      meta,
      content: content || '',
      units: nextUnits,
      kind: options.kind || 'source'
    });
    this.dirty = true;
    this._rebuildIndex();
    return meta;
  }

  deleteSource(sourceId) {
    if (!this.entries.has(sourceId)) return false;
    this.entries.delete(sourceId);
    this.dirty = true;
    this._rebuildIndex();
    return true;
  }

  getSourceMeta(sourceId) {
    return this.entries.get(sourceId)?.meta || null;
  }

  getSources() {
    return [...this.entries.values()]
      .filter(entry => entry.kind !== 'conversation-journal')
      .map(entry => ({ ...entry.meta }));
  }

  getStats() {
    const sourceCount = this.entries.size;
    const unitCount = [...this.entries.values()].reduce((sum, entry) => sum + entry.units.length, 0);
    return {
      mountedKbId: this.mountedKbId,
      mountedKbName: this.mountedKbName,
      dirty: this.dirty,
      sourceCount,
      unitCount,
      lastSavedAt: this.lastSavedAt
    };
  }

  getIndex() {
    return this.index;
  }

  toSnapshot(options = {}) {
    const includeConversationUnits = options.includeConversationUnits ?? false;
    const conversationUnits = options.conversationUnits || [];
    const sources = [...this.entries.values()].map(cloneEntry);
    if (includeConversationUnits && conversationUnits.length > 0) {
      const journalSourceId = this._buildConversationSourceId(conversationUnits);
      const chunkId = `${journalSourceId}::chunk-000`;
      const journalUnits = conversationUnits.map((unit, idx) => cloneConversationUnit(unit, journalSourceId, chunkId, idx));
      sources.push({
        meta: {
          sourceId: journalSourceId,
          name: `session-${this.sessionId}-journal`,
          addedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          chunkCount: 1,
          unitCount: journalUnits.length,
          status: 'ready',
          hash: createHash('sha256').update(journalUnits.map(u => u.hash).join('|')).digest('hex'),
          kind: 'conversation-journal'
        },
        content: journalUnits.map(u => u.claim || u.procedure || '').filter(Boolean).join('\n'),
        units: journalUnits,
        kind: 'conversation-journal'
      });
    }
    return { sources };
  }

  markSaved(savedAt = new Date().toISOString(), repositoryMeta = null) {
    this.dirty = false;
    this.lastSavedAt = savedAt;
    if (repositoryMeta?.kbId) this.mountedKbId = repositoryMeta.kbId;
    if (repositoryMeta?.name) this.mountedKbName = repositoryMeta.name;
  }

  _rebuildIndex() {
    const units = [];
    for (const entry of this.entries.values()) units.push(...entry.units.map(cloneUnit));
    this.index.rebuild(units);
  }

  _generateSourceId(name) {
    const baseHash = buildSourceHash(name || `workspace-${this.sessionId}`);
    let sourceId = `src-${baseHash}`;
    let suffix = 0;
    while (this.entries.has(sourceId)) {
      suffix += 1;
      sourceId = `src-${baseHash}-${suffix}`;
    }
    return sourceId;
  }

  _buildConversationSourceId(conversationUnits) {
    const seed = conversationUnits.map(u => u.hash || hashUnit(u)).join('|') || this.sessionId;
    return `src-journal-${createHash('sha256').update(seed).digest('hex').substring(0, 10)}`;
  }
}
