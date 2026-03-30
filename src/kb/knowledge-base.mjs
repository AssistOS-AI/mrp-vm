// DS008 — Knowledge Base
import { createHash } from 'node:crypto';
import { MRPError } from '../lib/errors.mjs';
import { logger } from '../lib/logger.mjs';

const MOD = 'kb';

export class KnowledgeBase {
  constructor(ingestor, index, persistence, config = {}) {
    this.ingestor = ingestor;
    this.index = index;
    this.persistence = persistence;
    this.maxSourceSizeBytes = config.maxSourceSizeBytes || 1048576;
    this.maxSources = config.maxSources || 500;
    this.maxUnitsPerSource = config.maxUnitsPerSource || 500;
    this.maxTotalUnits = config.maxTotalUnits || 10000;
    this._sources = new Map();
    this._units = [];
    this._writeLock = false;
  }

  async _acquireLock() {
    while (this._writeLock) await new Promise(r => setTimeout(r, 10));
    this._writeLock = true;
  }
  _releaseLock() { this._writeLock = false; }

  _generateSourceId(name) {
    const hash = createHash('sha256').update(name).digest('hex').substring(0, 12);
    let id = `src-${hash}`;
    let suffix = 0;
    while (this._sources.has(id)) { suffix++; id = `src-${hash}-${suffix}`; }
    return id;
  }

  _hashUnit(u) {
    return createHash('sha256')
      .update(`${u.claim || ''}|${u.procedure || ''}|${u.role}|${u.topic}|${u.subject || ''}|${u.relation || ''}|${u.object || ''}`)
      .digest('hex');
  }

  _normalizeUnit(unit, sourceMeta = null) {
    const next = { ...unit };
    next.hash = next.hash || this._hashUnit(next);
    next.sourceName = next.sourceName || sourceMeta?.name || null;
    next.chunkIndex = next.chunkIndex ?? null;
    next.unitIndex = next.unitIndex ?? null;
    next.unitType = next.unitType || 'semantic-unit';
    next.textBody = next.textBody || next.claim || next.procedure || next.topic || '';
    next.parentUnitIds = next.parentUnitIds || [];
    next.childUnitIds = next.childUnitIds || [];
    next.derivedFromUnitIds = next.derivedFromUnitIds || [];
    next.charStart = next.charStart ?? null;
    next.charEnd = next.charEnd ?? null;
    next.createdAt = next.createdAt || sourceMeta?.updatedAt || sourceMeta?.addedAt || null;
    next.chunkType = next.chunkType || null;
    next.sectionTitle = next.sectionTitle || null;
    return next;
  }

  async boot() {
    await this.persistence.cleanTempFiles();
    const allUnits = await this.persistence.loadAllContextUnits();
    const metas = await this.persistence.loadAllSourceMeta();
    this._sources.clear();
    for (const m of metas) {
      if (m.status === 'dirty') {
        logger.warn(MOD, `Source ${m.sourceId} is dirty, needs reprocessing`);
      }
      this._sources.set(m.sourceId, m);
    }
    for (const u of allUnits) {
      const meta = this._sources.get(u.sourceId) || null;
      Object.assign(u, this._normalizeUnit(u, meta));
    }
    this._units = allUnits;
    const indexValid = await this.persistence.isIndexValid(allUnits);
    if (indexValid) {
      const data = await this.persistence.loadIndex();
      this.index.loadFromIndexData(data, allUnits);
      logger.info(MOD, 'Index loaded from disk');
    } else {
      this.index.rebuild(allUnits);
      await this.persistence.saveIndex(this.index.toIndexData());
      logger.info(MOD, 'Index rebuilt from CNL');
    }
  }

  async addSource(name, nlContent, strategy) {
    if (Buffer.byteLength(nlContent, 'utf-8') > this.maxSourceSizeBytes) {
      throw new MRPError('KB_VALIDATION_TOO_LARGE', MOD, `Source exceeds max size of ${this.maxSourceSizeBytes} bytes`);
    }
    if (this._sources.size >= this.maxSources) {
      throw new MRPError('KB_VALIDATION_MAX_SOURCES', MOD, `Max sources limit (${this.maxSources}) reached`);
    }
    await this._acquireLock();
    try {
      const sourceId = this._generateSourceId(name);
      const { units } = await this.ingestor.ingest(sourceId, nlContent, name, strategy);
      if (units.length > this.maxUnitsPerSource) {
        throw new MRPError('KB_VALIDATION_MAX_UNITS_PER_SOURCE', MOD, `Source produces ${units.length} units, exceeding limit`);
      }
      if (this._units.length + units.length > this.maxTotalUnits) {
        throw new MRPError('KB_VALIDATION_MAX_TOTAL_UNITS', MOD, 'Total units limit exceeded');
      }
      const normalizedUnits = units.map(unit => this._normalizeUnit(unit, { name }));
      const contentHash = createHash('sha256').update(nlContent).digest('hex');
      const meta = {
        sourceId, name,
        addedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        chunkCount: new Set(normalizedUnits.map(u => u.chunkId)).size,
        unitCount: normalizedUnits.length,
        status: 'dirty',
        hash: contentHash
      };
      // Phase 1: write all files to disk (each atomic via .tmp+rename)
      await this.persistence.saveSourceMeta(sourceId, meta);
      await this.persistence.saveRawSource(sourceId, name, nlContent);
      await this.persistence.saveContextUnits(sourceId, normalizedUnits);
      // Phase 2: build new in-memory state
      const newUnits = [...this._units, ...normalizedUnits];
      this.index.rebuild(newUnits);
      await this.persistence.saveIndex(this.index.toIndexData());
      // Phase 3: mark ready and swap
      meta.status = 'ready';
      await this.persistence.saveSourceMeta(sourceId, meta);
      this._sources.set(sourceId, meta);
      this._units = newUnits;
      return sourceId;
    } catch (e) {
      // On failure, attempt cleanup of partial writes
      // In-memory state was never updated, so it's consistent
      throw e;
    } finally {
      this._releaseLock();
    }
  }

  async updateSource(sourceId, nlContent, strategy) {
    const existing = this._sources.get(sourceId);
    if (!existing) throw new MRPError('KB_NOT_FOUND', MOD, `Source ${sourceId} not found`);
    if (Buffer.byteLength(nlContent, 'utf-8') > this.maxSourceSizeBytes) {
      throw new MRPError('KB_VALIDATION_TOO_LARGE', MOD, 'Source exceeds max size');
    }
    await this._acquireLock();
    try {
      const { units } = await this.ingestor.ingest(sourceId, nlContent, existing.name, strategy);
      const normalizedUnits = units.map(unit => this._normalizeUnit(unit, existing));
      // Mark dirty first
      const meta = { ...existing, updatedAt: new Date().toISOString(), unitCount: normalizedUnits.length,
        chunkCount: new Set(normalizedUnits.map(u => u.chunkId)).size,
        hash: createHash('sha256').update(nlContent).digest('hex'), status: 'dirty' };
      await this.persistence.saveSourceMeta(sourceId, meta);
      await this.persistence.saveRawSource(sourceId, existing.name, nlContent);
      await this.persistence.saveContextUnits(sourceId, normalizedUnits);
      // Build new state
      const newUnits = [...this._units.filter(u => u.sourceId !== sourceId), ...normalizedUnits];
      this.index.rebuild(newUnits);
      await this.persistence.saveIndex(this.index.toIndexData());
      // Mark ready and swap
      meta.status = 'ready';
      await this.persistence.saveSourceMeta(sourceId, meta);
      this._sources.set(sourceId, meta);
      this._units = newUnits;
    } finally {
      this._releaseLock();
    }
  }

  async removeSource(sourceId) {
    if (!this._sources.has(sourceId)) throw new MRPError('KB_NOT_FOUND', MOD, `Source ${sourceId} not found`);
    await this._acquireLock();
    try {
      await this.persistence.removeContextUnits(sourceId);
      await this.persistence.removeSourceMeta(sourceId);
      await this.persistence.removeRawSource(sourceId);
      const newUnits = this._units.filter(u => u.sourceId !== sourceId);
      this.index.rebuild(newUnits);
      await this.persistence.saveIndex(this.index.toIndexData());
      this._sources.delete(sourceId);
      this._units = newUnits;
    } finally {
      this._releaseLock();
    }
  }

  getSources() { return [...this._sources.values()]; }
  getSource(sourceId) { return this._sources.get(sourceId) || null; }
  async getContextUnits(sourceId) { return this._units.filter(u => u.sourceId === sourceId); }
  getIndex() { return this.index; }
  getAllUnits() { return this._units; }

  async exportSnapshot() {
    const sources = [];
    for (const meta of this.getSources()) {
      const content = await this.persistence.loadRawSource(meta.sourceId);
      const units = await this.getContextUnits(meta.sourceId);
      sources.push({
        meta: { ...meta },
        content: content || '',
        units: units.map(u => ({ ...u })),
        kind: meta.kind || 'source'
      });
    }
    return { sources };
  }

  async replaceAllSources(snapshot) {
    const sources = snapshot?.sources || [];
    await this._acquireLock();
    try {
      if (sources.length > this.maxSources) {
        throw new MRPError('KB_VALIDATION_MAX_SOURCES', MOD, `Snapshot exceeds max sources limit (${this.maxSources})`);
      }

      const allUnits = [];
      const sourceMap = new Map();
      const normalizedEntries = new Map();
      for (const entry of sources) {
        const meta = {
          ...(entry.meta || {}),
          sourceId: entry.meta?.sourceId,
          name: entry.meta?.name || entry.meta?.sourceId || 'unnamed',
          status: 'ready',
          updatedAt: new Date().toISOString()
        };
        const units = (entry.units || []).map(u => {
          return this._normalizeUnit(u, entry.meta || {});
        });
        if (units.length > this.maxUnitsPerSource) {
          throw new MRPError('KB_VALIDATION_MAX_UNITS_PER_SOURCE', MOD,
            `Source ${meta.sourceId} produces ${units.length} units, exceeding limit`);
        }
        meta.addedAt = meta.addedAt || new Date().toISOString();
        meta.chunkCount = new Set(units.map(u => u.chunkId)).size;
        meta.unitCount = units.length;
        meta.hash = meta.hash || createHash('sha256').update(entry.content || '').digest('hex');
        sourceMap.set(meta.sourceId, meta);
        normalizedEntries.set(meta.sourceId, { meta, content: entry.content || '', units });
        allUnits.push(...units);
      }

      if (allUnits.length > this.maxTotalUnits) {
        throw new MRPError('KB_VALIDATION_MAX_TOTAL_UNITS', MOD, 'Total units limit exceeded');
      }

      await this.persistence.resetRepository();
      for (const [sourceId, entry] of normalizedEntries) {
        const meta = sourceMap.get(sourceId);
        await this.persistence.saveSourceMeta(meta.sourceId, meta);
        await this.persistence.saveRawSource(meta.sourceId, meta.name, entry.content || '');
        await this.persistence.saveContextUnits(meta.sourceId, entry.units || []);
      }

      this.index.rebuild(allUnits);
      await this.persistence.saveIndex(this.index.toIndexData());
      this._sources = sourceMap;
      this._units = allUnits;
    } finally {
      this._releaseLock();
    }
  }
}
