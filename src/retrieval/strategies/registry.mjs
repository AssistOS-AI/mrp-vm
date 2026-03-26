// DS023 — Retrieval Strategies & Risk Profiles
import { MRPError } from '../../lib/errors.mjs';

// ── Strategy Interface ──

export class RetrievalStrategy {
  getId() { throw new Error('Not implemented'); }
  getKind() { return 'lexical'; }
  getCostClass() { return 'cheap'; }
  supportsProfile(_profileId) { return true; }
  supportsParallelExecution() { return false; }
  async retrieve(_input) { throw new Error('Not implemented'); }
}

// ── BM25 Lexical Strategy (wraps DS009) ──

export class BM25LexicalStrategy extends RetrievalStrategy {
  constructor(config = {}) {
    super();
    this.config = config;
  }

  getId() { return 'bm25-lexical'; }
  getKind() { return 'lexical'; }
  getCostClass() { return 'cheap'; }
  supportsProfile() { return true; }
  supportsParallelExecution() { return true; }

  async retrieve({ contextProfile, sessionIndex, kbIndex, budget }) {
    const start = Date.now();
    const query = contextProfile.queryTerms.join(' ');
    const opts = {
      maxResults: budget?.maxCandidates || contextProfile.maxResults || 10,
      actBoost: contextProfile.actBoost
    };
    const candidates = [];
    // Search session index
    if (sessionIndex) {
      const sessionResults = sessionIndex.search(query, opts);
      for (const r of sessionResults) {
        candidates.push({
          unitId: r.unitId, store: 'session', rawScore: r.score,
          normalizedScore: 0, unit: r.unit, notes: []
        });
      }
    }
    // Search KB index
    if (kbIndex) {
      const kbResults = kbIndex.search(query, opts);
      for (const r of kbResults) {
        candidates.push({
          unitId: r.unitId, store: 'kb', rawScore: r.score,
          normalizedScore: 0, unit: r.unit, notes: []
        });
      }
    }
    // Normalize scores
    const maxScore = Math.max(...candidates.map(c => c.rawScore), 1);
    for (const c of candidates) c.normalizedScore = c.rawScore / maxScore;
    return {
      strategyId: 'bm25-lexical',
      candidates,
      durationMs: Date.now() - start,
      exhaustedBudget: false
    };
  }
}

// ── Retrieval Strategy Registry ──

export class RetrievalStrategyRegistry {
  constructor() { this._strategies = new Map(); this._profiles = {}; }

  register(strategy) { this._strategies.set(strategy.getId(), strategy); }
  get(id) { return this._strategies.get(id) || null; }

  list() {
    return [...this._strategies.values()].map(s => ({
      id: s.getId(), kind: s.getKind(), costClass: s.getCostClass()
    }));
  }

  setProfiles(profiles) { this._profiles = profiles; }

  getProfile(id) { return this._profiles[id] || null; }

  getEnabledForProfile(profileId) {
    const profile = this._profiles[profileId];
    if (!profile) return [];
    const ids = [...(profile.primaryStrategies || []), ...(profile.secondaryStrategies || [])];
    return ids.map(id => this._strategies.get(id)).filter(Boolean);
  }

  listProfiles() {
    return Object.entries(this._profiles).map(([id, p]) => ({
      id,
      enabled_strategies: [...(p.primaryStrategies || []), ...(p.secondaryStrategies || [])]
    }));
  }

  resolveProfile(requested, sessionPref, defaultProfile) {
    const id = requested || sessionPref || defaultProfile;
    if (!this._profiles[id]) throw new MRPError('CONFIG_INVALID_RETRIEVAL_PROFILE', 'retrieval', `Profile '${id}' not available`);
    return this._profiles[id];
  }
}
