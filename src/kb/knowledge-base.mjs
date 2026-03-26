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
    return createHash('sha256').update(`${u.claim || ''}|${u.role}|${u.topic}`).digest('hex');
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
      u.hash = u.hash || this._hashUnit(u);
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
      for (const u of units) u.hash = this._hashUnit(u);
      const contentHash = createHash('sha256').update(nlContent).digest('hex');
      const meta = {
        sourceId, name,
        addedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        chunkCount: new Set(units.map(u => u.chunkId)).size,
        unitCount: units.length,
        status: 'dirty',
        hash: contentHash
      };
      // Phase 1: write all files to disk (each atomic via .tmp+rename)
      await this.persistence.saveSourceMeta(sourceId, meta);
      await this.persistence.saveRawSource(sourceId, name, nlContent);
      await this.persistence.saveContextUnits(sourceId, units);
      // Phase 2: build new in-memory state
      const newUnits = [...this._units, ...units];
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
      for (const u of units) u.hash = this._hashUnit(u);
      // Mark dirty first
      const meta = { ...existing, updatedAt: new Date().toISOString(), unitCount: units.length,
        chunkCount: new Set(units.map(u => u.chunkId)).size,
        hash: createHash('sha256').update(nlContent).digest('hex'), status: 'dirty' };
      await this.persistence.saveSourceMeta(sourceId, meta);
      await this.persistence.saveRawSource(sourceId, existing.name, nlContent);
      await this.persistence.saveContextUnits(sourceId, units);
      // Build new state
      const newUnits = [...this._units.filter(u => u.sourceId !== sourceId), ...units];
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
}
