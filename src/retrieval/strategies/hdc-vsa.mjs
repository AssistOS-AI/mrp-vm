// DS023 — HDC/VSA Associative Retrieval Strategy
import { RetrievalStrategy } from './registry.mjs';
import { randomHV, bind, bundle, encodeTokens, similarity, basis } from '../../lib/hdc.mjs';
import { tokenize } from '../tokenizer.mjs';

export class HDCVSAStrategy extends RetrievalStrategy {
  constructor() {
    super();
    this._unitVectors = new Map(); // unitId → Uint32Array
  }

  getId() { return 'hdc-vsa'; }
  getKind() { return 'hdc-vsa'; }
  getCostClass() { return 'cheap'; }
  supportsParallelExecution() { return true; }

  // Encode a context unit into a hypervector
  _encodeUnit(unit) {
    const parts = [];
    if (unit.role) parts.push(bind(basis('role'), randomHV(unit.role)));
    if (unit.topic) parts.push(bind(basis('topic'), encodeTokens(tokenize(unit.topic))));
    if (unit.claim) parts.push(bind(basis('claim'), encodeTokens(tokenize(unit.claim))));
    if (unit.procedure) parts.push(bind(basis('procedure'), encodeTokens(tokenize(unit.procedure))));
    if (unit.utilityActs?.length) parts.push(bind(basis('acts'), encodeTokens(unit.utilityActs)));
    return parts.length ? bundle(parts) : encodeTokens(tokenize(unit.topic || ''));
  }

  // Encode a query from context profile
  _encodeQuery(contextProfile) {
    const parts = [];
    if (contextProfile.neededRoles?.length) {
      parts.push(bind(basis('role'), bundle(contextProfile.neededRoles.map(r => randomHV(r)))));
    }
    if (contextProfile.queryTerms?.length) {
      parts.push(bind(basis('topic'), encodeTokens(contextProfile.queryTerms)));
      parts.push(bind(basis('claim'), encodeTokens(contextProfile.queryTerms)));
    }
    if (contextProfile.actBoost) {
      parts.push(bind(basis('acts'), randomHV(contextProfile.actBoost)));
    }
    return parts.length ? bundle(parts) : encodeTokens(contextProfile.queryTerms || []);
  }

  async retrieve({ contextProfile, sessionIndex, kbIndex, budget }) {
    const start = Date.now();
    const queryVec = this._encodeQuery(contextProfile);
    const maxCandidates = budget?.maxCandidates || 10;
    const candidates = [];

    // Score all units from session + KB
    const sources = [];
    if (sessionIndex) for (const [id, u] of sessionIndex.units) sources.push({ unitId: id, unit: u, store: 'session' });
    if (kbIndex) for (const [id, u] of kbIndex.units) sources.push({ unitId: id, unit: u, store: 'kb' });

    for (const { unitId, unit, store } of sources) {
      // Cache encoded vectors
      if (!this._unitVectors.has(unitId)) this._unitVectors.set(unitId, this._encodeUnit(unit));
      const score = similarity(queryVec, this._unitVectors.get(unitId));
      if (score > 0.45) { // baseline threshold — random vectors have ~0.50 similarity
        candidates.push({ unitId, store, rawScore: score, normalizedScore: 0, unit, notes: ['hdc-vsa'] });
      }
    }

    // Normalize: shift so that 0.45→0, 1.0→1
    const minThresh = 0.45;
    for (const c of candidates) c.normalizedScore = Math.max(0, (c.rawScore - minThresh) / (1 - minThresh));

    // Sort and limit
    candidates.sort((a, b) => b.normalizedScore - a.normalizedScore);
    return {
      strategyId: 'hdc-vsa',
      candidates: candidates.slice(0, maxCandidates),
      durationMs: Date.now() - start,
      exhaustedBudget: false
    };
  }

  // Clear cache when KB changes
  invalidate(unitId) { if (unitId) this._unitVectors.delete(unitId); else this._unitVectors.clear(); }
}
