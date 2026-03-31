// DS012 — Retrieval & Context Matching
import { loadConfig } from '../lib/config.mjs';
import { renderResolvedIntentMarkdown } from './resolved-markdown.mjs';

export class ContextMatcher {
  constructor(retrievalStrategyRegistry, config = {}) {
    this.strategyRegistry = retrievalStrategyRegistry;
    this.minScore = config.minScore ?? 0.1;
    this.maxResultsPerIntent = config.maxResultsPerIntent ?? 10;
    this.roleBoostFactor = config.roleBoostFactor ?? 1.3;
    this.sessionBoostFactor = config.sessionBoostFactor ?? 1.15;
    this.agreementBonus = config.agreementBonus ?? 0.10;
    let strategyWeights;
    try { strategyWeights = loadConfig('retrieval-strategies').strategyWeights; } catch { strategyWeights = {}; }
    this.strategyWeights = strategyWeights;
  }

  async resolve(decomposedIntents, contextProfiles, currentTurnUnits, session, retrievalProfile, kbIndex) {
    const results = [];
    for (let i = 0; i < decomposedIntents.length; i++) {
      const decomposed = decomposedIntents[i];
      const profile = contextProfiles[i];
      const ri = await this._resolveOne(decomposed, profile, currentTurnUnits, session, retrievalProfile, kbIndex);
      results.push(ri);
    }
    return results;
  }

  async _resolveOne(decomposed, contextProfile, currentTurnUnits, session, retrievalProfile, kbIndex) {
    const intentRef = decomposed.groupNumber;
    // Get strategies for profile
    const profileConfig = typeof retrievalProfile === 'string'
      ? this.strategyRegistry.getProfile(retrievalProfile)
      : retrievalProfile;
    const primaryIds = profileConfig?.primaryStrategies || ['bm25-lexical'];
    const secondaryIds = profileConfig?.secondaryStrategies || [];

    const allCandidates = new Map(); // unitId → { best candidate }
    const strategiesRun = [];
    let escalated = false;
    const profileMaxResults = profileConfig?.maxResults || this.maxResultsPerIntent;
    const profileMinScore = profileConfig?.minScore ?? this.minScore;

    // Run primary strategies
    for (const sid of primaryIds) {
      const strategy = this.strategyRegistry.get(sid);
      if (!strategy) continue;
      const result = await strategy.retrieve({
        intentRef,
        contextProfile,
        currentTurnUnits,
        sessionIndex: session?.sessionIndex || null,
        kbIndex,
        profile: profileConfig,
        budget: { timeoutMs: profileConfig?.targetLatencyMs || 500, maxCandidates: profileMaxResults }
      });
      strategiesRun.push(sid);
      for (const c of result.candidates) this._mergeCandidate(allCandidates, c, sid);
    }

    // Check escalation
    if (secondaryIds.length > 0) {
      const candidateCount = allCandidates.size;
      const minAcceptable = profileConfig?.minAcceptableCandidates || 5;
      if (candidateCount < minAcceptable) {
        escalated = true;
        for (const sid of secondaryIds) {
          const strategy = this.strategyRegistry.get(sid);
          if (!strategy) continue;
          const result = await strategy.retrieve({
            intentRef, contextProfile, currentTurnUnits,
            sessionIndex: session?.sessionIndex || null, kbIndex,
            profile: profileConfig,
            budget: { timeoutMs: profileConfig?.targetLatencyMs || 500, maxCandidates: profileMaxResults }
          });
          strategiesRun.push(sid);
          for (const c of result.candidates) this._mergeCandidate(allCandidates, c, sid);
        }
      }
    }

    // Compute final scores with fusion
    const scored = [];
    for (const [unitId, entry] of allCandidates) {
      let fusedScore = 0;
      for (const [sid, normScore] of Object.entries(entry.strategyScores)) {
        const w = this.strategyWeights[sid] || 1.0;
        fusedScore += w * normScore;
      }
      const matchCount = Object.keys(entry.strategyScores).length;
      fusedScore += this.agreementBonus * Math.max(0, matchCount - 1);
      // Role boost
      const neededRoles = contextProfile.neededRoles || [];
      const roleScore = neededRoles.includes(entry.unit?.role) ? this.roleBoostFactor : 1.0;
      // Store boost
      const storeScore = entry.store === 'session' ? this.sessionBoostFactor : 1.0;
      const finalScore = fusedScore * roleScore * storeScore;
      if (finalScore >= profileMinScore) {
        scored.push({ unitId, score: finalScore, unit: entry.unit, store: entry.store, notes: entry.notes || [] });
      }
    }

    // Sort and deduplicate by hash
    scored.sort((a, b) => b.score - a.score || a.unitId.localeCompare(b.unitId));
    const seen = new Set();
    const deduped = [];
    for (const s of scored) {
      const hash = s.unit?.hash || s.unitId;
      if (seen.has(hash)) continue;
      seen.add(hash);
      deduped.push(s);
    }

    // Confidence gap pruning: drop candidates scoring below threshold relative to top
    const gapThreshold = profileConfig?.confidenceGapThreshold || 0;
    let pruned = deduped;
    if (gapThreshold > 0 && deduped.length > 0) {
      const topScore = deduped[0].score;
      pruned = deduped.filter(s => s.score >= topScore * gapThreshold);
    }

    const top = this._expandAggregateKUs(pruned.slice(0, profileMaxResults), kbIndex, profileMaxResults);

    // DS012/DS030: compute KU-level metrics
    const kuLevelsUsed = [...new Set(top.map(s => s.unit?.kuType || s.unit?.unitType || 'unknown'))];
    const totalKUsConsidered = allCandidates.size;
    const selectedKUCount = top.length;

    // Split by store
    const sessionUnits = top.filter(s => s.store === 'session');
    const kbUnits = top.filter(s => s.store === 'kb');

    // DS012: filter current-turn KUs per intent when possible
    const intentAct = decomposed.act;
    const intentTerms = new Set((contextProfile.queryTerms || []).map(t => t.toLowerCase()));
    let filteredCurrentTurn = currentTurnUnits || [];
    if (filteredCurrentTurn.length > 0 && intentTerms.size > 0) {
      const relevant = filteredCurrentTurn.filter(u => {
        const text = `${u.topic || ''} ${u.claim || ''} ${u.procedure || ''}`.toLowerCase();
        return [...intentTerms].some(t => text.includes(t));
      });
      if (relevant.length > 0) filteredCurrentTurn = relevant;
    }

    const strategyUnits = this._collectStrategyUnits(filteredCurrentTurn, sessionUnits, kbUnits);
    const evidenceUnitCount =
      filteredCurrentTurn.length +
      sessionUnits.length +
      kbUnits.length;
    const retrievalPurpose =
      strategyUnits.length === 0 ? 'task-evidence' :
      strategyUnits.length >= evidenceUnitCount ? 'strategy-guidance' :
      'mixed';

    // Build resolved markdown
    const resolvedMarkdown = renderResolvedIntentMarkdown(
      decomposed,
      filteredCurrentTurn,
      sessionUnits,
      kbUnits
    );

    return {
      intentGroup: { groupNumber: decomposed.groupNumber, act: decomposed.act, intent: decomposed.intent, output: decomposed.outputType },
      decomposed,
      intentRef,
      retrievalProfile: typeof retrievalProfile === 'string' ? retrievalProfile : profileConfig?.id || 'unknown',
      strategyUnits,
      currentTurnContextUnits: filteredCurrentTurn,
      sessionUnits,
      kbUnits,
      retrievalTrace: {
        purpose: retrievalPurpose,
        strategiesRun,
        escalated,
        kuLevelsUsed,
        totalKUsConsidered,
        selectedKUCount
      },
      resolvedMarkdown
    };
  }

  _mergeCandidate(map, candidate, strategyId) {
    const existing = map.get(candidate.unitId);
    if (!existing) {
      map.set(candidate.unitId, {
        unit: candidate.unit,
        store: candidate.store,
        notes: [...(candidate.notes || [])],
        strategyScores: { [strategyId]: candidate.normalizedScore }
      });
    } else {
      existing.strategyScores[strategyId] = Math.max(
        existing.strategyScores[strategyId] || 0, candidate.normalizedScore
      );
      existing.notes = [...new Set([...(existing.notes || []), ...(candidate.notes || [])])];
    }
  }

  /**
   * DS030/DS012: Expand aggregate/composite KUs to their children when the
   * aggregate itself is too broad for the query. Returns the original list
   * with aggregates replaced by their children when beneficial.
   */
  _expandAggregateKUs(scored, kbIndex, maxResults) {
    if (!kbIndex) return scored;
    const expanded = [];
    for (const entry of scored) {
      const unit = entry.unit;
      const kuType = unit?.kuType || unit?.unitType || '';
      const childIds = unit?.childUnitIds || [];
      if ((kuType === 'aggregate' || kuType === 'composite' || kuType === 'section-aggregate' || kuType === 'source-aggregate') && childIds.length > 0) {
        // Replace aggregate with its children, inheriting the parent score with a small penalty
        for (const childId of childIds) {
          const childUnit = kbIndex.units?.get(childId);
          if (childUnit) {
            expanded.push({ ...entry, unitId: childId, unit: childUnit, score: entry.score * 0.95, notes: [...entry.notes, 'ku-expanded'] });
          }
        }
      } else {
        expanded.push(entry);
      }
    }
    // Re-sort and deduplicate
    expanded.sort((a, b) => b.score - a.score || a.unitId.localeCompare(b.unitId));
    const seen = new Set();
    return expanded.filter(e => { if (seen.has(e.unitId)) return false; seen.add(e.unitId); return true; }).slice(0, maxResults);
  }

  _collectStrategyUnits(currentTurnUnits = [], sessionUnits = [], kbUnits = []) {
    const strategyEntries = [];
    for (const unit of currentTurnUnits) {
      if (!this._isStrategyUnit(unit)) continue;
      strategyEntries.push({
        unitId: unit.id || unit.hash || unit.topic || 'current-turn',
        score: 1,
        store: 'current-turn',
        unit
      });
    }
    for (const entry of [...sessionUnits, ...kbUnits]) {
      if (!this._isStrategyUnit(entry.unit)) continue;
      strategyEntries.push(entry);
    }
    const seen = new Set();
    return strategyEntries.filter(entry => {
      const key = entry.unit?.hash || `${entry.store}:${entry.unitId}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  _isStrategyUnit(unit) {
    if (!unit) return false;
    const role = String(unit.role || '').toLowerCase();
    if (['procedure', 'evaluation', 'constraint', 'condition'].includes(role)) return true;
    const acts = new Set((unit.utilityActs || []).map(act => String(act).toLowerCase()));
    if (acts.has('implement') || acts.has('evaluate') || acts.has('recommend') || acts.has('verify')) return true;
    const text = `${unit.claim || ''} ${unit.procedure || ''} ${unit.utilityNote || ''}`.toLowerCase();
    return /\b(must|should|policy|procedure|step|evaluate|validation|solver|plugin|method|workflow|rule)\b/.test(text);
  }
}
