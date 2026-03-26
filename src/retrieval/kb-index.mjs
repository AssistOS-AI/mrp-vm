// DS009 — BM25 Index (internal, no external deps)
import { tokenize } from './tokenizer.mjs';
import { ACT_TO_ROLES } from '../lib/pragmatics.mjs';

const INDEXED_FIELDS = ['role', 'topic', 'claim', 'condition', 'procedure', 'utilityActs', 'utilityNote'];
const DEFAULT_WEIGHTS = { topic: 1.5, claim: 1.0, procedure: 1.0, role: 0.5, utilityActs: 0.8, utilityNote: 0.6, condition: 0.6 };
const K1 = 1.2;
const B = 0.75;

export class KBIndex {
  constructor(config = {}) {
    this.fieldWeights = config.fieldWeights || DEFAULT_WEIGHTS;
    this.roleBoostFactor = config.roleBoostFactor || 1.3;
    // inverted index: term → Map<unitId, Map<field, freq>>
    this.invertedIndex = new Map();
    // doc lengths: unitId → { field: length }
    this.docLengths = new Map();
    // avg doc lengths per field
    this.avgDocLengths = {};
    // idf cache: term → idf
    this.idfCache = new Map();
    // units store
    this.units = new Map();
    this.totalDocs = 0;
  }

  _fieldText(unit, field) {
    if (field === 'utilityActs') return (unit.utilityActs || []).join(' ');
    return unit[field] || '';
  }

  _indexUnit(unit) {
    const lengths = {};
    for (const field of INDEXED_FIELDS) {
      const text = this._fieldText(unit, field);
      const tokens = tokenize(text);
      lengths[field] = tokens.length;
      const freq = {};
      for (const t of tokens) freq[t] = (freq[t] || 0) + 1;
      for (const [term, f] of Object.entries(freq)) {
        if (!this.invertedIndex.has(term)) this.invertedIndex.set(term, new Map());
        const termMap = this.invertedIndex.get(term);
        if (!termMap.has(unit.id)) termMap.set(unit.id, {});
        termMap.get(unit.id)[field] = f;
      }
    }
    this.docLengths.set(unit.id, lengths);
  }

  _rebuildAvgAndIdf() {
    const sums = {};
    for (const f of INDEXED_FIELDS) sums[f] = 0;
    for (const lengths of this.docLengths.values()) {
      for (const f of INDEXED_FIELDS) sums[f] += (lengths[f] || 0);
    }
    const n = this.docLengths.size || 1;
    for (const f of INDEXED_FIELDS) this.avgDocLengths[f] = sums[f] / n;
    this.totalDocs = n;
    this.idfCache.clear();
    for (const [term, postings] of this.invertedIndex) {
      const df = postings.size;
      this.idfCache.set(term, Math.log((this.totalDocs - df + 0.5) / (df + 0.5) + 1));
    }
  }

  addUnit(unit) {
    this.units.set(unit.id, unit);
    this._indexUnit(unit);
    this._rebuildAvgAndIdf();
  }

  removeUnit(unitId) {
    this.units.delete(unitId);
    this.docLengths.delete(unitId);
    for (const [, postings] of this.invertedIndex) postings.delete(unitId);
    this._rebuildAvgAndIdf();
  }

  updateUnit(unit) {
    this.removeUnit(unit.id);
    this.addUnit(unit);
  }

  rebuild(allUnits) {
    this.invertedIndex.clear();
    this.docLengths.clear();
    this.units.clear();
    for (const u of allUnits) {
      this.units.set(u.id, u);
      this._indexUnit(u);
    }
    this._rebuildAvgAndIdf();
  }

  search(query, options = {}) {
    const { maxResults = 10, roleFilter = null, actBoost = null } = options;
    const queryTokens = tokenize(query);
    if (queryTokens.length === 0) return [];
    const scores = new Map();
    for (const unitId of this.units.keys()) {
      let total = 0;
      for (const field of INDEXED_FIELDS) {
        const w = this.fieldWeights[field] || 1.0;
        const dl = this.docLengths.get(unitId)?.[field] || 0;
        const avgdl = this.avgDocLengths[field] || 1;
        for (const term of queryTokens) {
          const idf = this.idfCache.get(term) || 0;
          const tf = this.invertedIndex.get(term)?.get(unitId)?.[field] || 0;
          if (tf === 0) continue;
          const num = tf * (K1 + 1);
          const den = tf + K1 * (1 - B + B * dl / avgdl);
          total += w * idf * (num / den);
        }
      }
      if (total <= 0) continue;
      // Role boost
      const unit = this.units.get(unitId);
      if (actBoost && unit) {
        const preferred = ACT_TO_ROLES[actBoost] || [];
        if (preferred.includes(unit.role)) total *= this.roleBoostFactor;
      }
      if (roleFilter && unit?.role !== roleFilter) continue;
      scores.set(unitId, total);
    }
    return [...scores.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, maxResults)
      .map(([unitId, score]) => ({ unitId, score, unit: this.units.get(unitId) }));
  }

  getStats() {
    return {
      totalUnits: this.units.size,
      totalTerms: this.invertedIndex.size,
      avgDocLength: { ...this.avgDocLengths }
    };
  }

  // Serialization for persistence (DS010)
  toIndexData() {
    const invertedIndex = {};
    for (const [term, postings] of this.invertedIndex) {
      invertedIndex[term] = {};
      for (const [unitId, fields] of postings) invertedIndex[term][unitId] = fields;
    }
    const docLengths = {};
    for (const [uid, lens] of this.docLengths) docLengths[uid] = lens;
    const idfCache = {};
    for (const [t, v] of this.idfCache) idfCache[t] = v;
    const unitHashes = {};
    for (const [uid, u] of this.units) unitHashes[uid] = u.hash || '';
    return {
      schemaVersion: 1,
      createdAt: new Date().toISOString(),
      unitCount: this.units.size,
      unitHashes,
      invertedIndex,
      docLengths,
      avgDocLengths: { ...this.avgDocLengths },
      idfCache
    };
  }

  loadFromIndexData(data, allUnits) {
    this.units.clear();
    for (const u of allUnits) this.units.set(u.id, u);
    this.invertedIndex.clear();
    for (const [term, postings] of Object.entries(data.invertedIndex)) {
      this.invertedIndex.set(term, new Map(Object.entries(postings)));
    }
    this.docLengths.clear();
    for (const [uid, lens] of Object.entries(data.docLengths)) this.docLengths.set(uid, lens);
    this.avgDocLengths = { ...data.avgDocLengths };
    this.idfCache.clear();
    for (const [t, v] of Object.entries(data.idfCache)) this.idfCache.set(t, v);
    this.totalDocs = this.units.size;
  }
}
