// DS024 — HDC/VSA Associative Retrieval Strategy
// Per-field structural matching with weighted fusion
import { RetrievalStrategy } from './registry.mjs';
import { randomHV, bind, encodeNgrams, encodeTokens, similarity } from '../hdc.mjs';
import { tokenize } from '../../../../../mrp-vm-sdk/nlp-util/lexical-tokenizer.mjs';

// Field weights for final score
const FIELD_WEIGHTS = { role: 0.20, topic: 0.35, claim: 0.35, acts: 0.10 };

export class HDCVSAStrategy extends RetrievalStrategy {
  constructor() {
    super();
    this._cache = new Map(); // unitId → { role, topic, claim, acts } vectors
  }

  getId() { return 'hdc-vsa'; }
  getKind() { return 'hdc-vsa'; }
  getCostClass() { return 'cheap'; }
  supportsParallelExecution() { return true; }

  _encodeUnit(unit) {
    return {
      role: unit.role ? randomHV(unit.role) : null,
      topic: unit.topic ? encodeNgrams(tokenize(unit.topic)) : null,
      claim: unit.claim ? encodeNgrams(tokenize(unit.claim)) : unit.procedure ? encodeNgrams(tokenize(unit.procedure)) : null,
      acts: unit.utilityActs?.length ? encodeTokens(unit.utilityActs) : null
    };
  }

  _encodeQuery(contextProfile) {
    const roleVecs = (contextProfile.neededRoles || []).map(r => randomHV(r));
    return {
      role: roleVecs.length ? encodeTokens(contextProfile.neededRoles) : null,
      topic: contextProfile.queryTerms?.length ? encodeNgrams(contextProfile.queryTerms) : null,
      claim: contextProfile.queryTerms?.length ? encodeNgrams(contextProfile.queryTerms) : null,
      acts: contextProfile.actBoost ? randomHV(contextProfile.actBoost) : null
    };
  }

  _scoreUnit(queryVecs, unitVecs) {
    let total = 0, weightSum = 0;
    for (const [field, weight] of Object.entries(FIELD_WEIGHTS)) {
      const qv = queryVecs[field];
      const uv = unitVecs[field];
      if (!qv || !uv) continue;
      const sim = similarity(qv, uv);
      // Shift: random baseline is ~0.50, so meaningful signal is above that
      const shifted = Math.max(0, (sim - 0.50) * 2); // maps 0.50→0, 0.75→0.50, 1.0→1.0
      total += weight * shifted;
      weightSum += weight;
    }
    return weightSum > 0 ? total / weightSum : 0;
  }

  async retrieve({ contextProfile, sessionIndex, kbIndex, budget }) {
    const start = Date.now();
    const queryVecs = this._encodeQuery(contextProfile);
    const maxCandidates = budget?.maxCandidates || 10;
    const candidates = [];

    const sources = [];
    if (sessionIndex) for (const [id, u] of sessionIndex.units) sources.push({ unitId: id, unit: u, store: 'session' });
    if (kbIndex) for (const [id, u] of kbIndex.units) sources.push({ unitId: id, unit: u, store: 'kb' });

    for (const { unitId, unit, store } of sources) {
      if (!this._cache.has(unitId)) this._cache.set(unitId, this._encodeUnit(unit));
      const score = this._scoreUnit(queryVecs, this._cache.get(unitId));
      if (score > 0.05) {
        candidates.push({ unitId, store, rawScore: score, normalizedScore: score, unit, notes: ['hdc-vsa'] });
      }
    }

    candidates.sort((a, b) => b.normalizedScore - a.normalizedScore);
    return {
      strategyId: 'hdc-vsa',
      candidates: candidates.slice(0, maxCandidates),
      durationMs: Date.now() - start,
      exhaustedBudget: false
    };
  }

  invalidate(unitId) { if (unitId) this._cache.delete(unitId); else this._cache.clear(); }
}
