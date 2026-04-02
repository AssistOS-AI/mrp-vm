// DS012 — Retrieval & Context Matching
import { ACT_TO_ROLES, inferPhaseScopes } from '../knowledge/pragmatics.mjs';
import { buildResolvedIntentPayload } from '../../../../mrp-vm-sdk/synthesis/resolved-intent-payload.mjs';

export class ContextMatcher {
  constructor(retrievalStrategyRegistry, config = {}) {
    this.strategyRegistry = retrievalStrategyRegistry;
    this.minScore = config.minScore ?? 0.1;
    this.maxResultsPerIntent = config.maxResultsPerIntent ?? 10;
    this.roleBoostFactor = config.roleBoostFactor ?? 1.3;
    this.sessionBoostFactor = config.sessionBoostFactor ?? 1.15;
    this.agreementBonus = config.agreementBonus ?? 0.10;
    this.strategyWeights = config.strategyWeights || {};
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
    const profileMaxResults = contextProfile?.maxResults || profileConfig?.maxResults || this.maxResultsPerIntent;
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
      const candidateCount = [...allCandidates.values()].filter(entry =>
        this._isEvidenceUnit(entry.unit, decomposed, contextProfile)
      ).length;
      const minAcceptable = profileConfig?.minAcceptableCandidates || 5;
      const shouldRunSecondary = profileConfig?.alwaysRunSecondary === true || candidateCount < minAcceptable;
      if (shouldRunSecondary) {
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

    const evidenceCandidates = deduped.filter(entry =>
      this._isEvidenceUnit(entry.unit, decomposed, contextProfile)
    );
    const guidanceCandidates = deduped.filter(entry => this._isGuidanceUnit(entry.unit));

    const topEvidence = evidenceCandidates.slice(0, profileMaxResults);
    const topGuidance = guidanceCandidates.slice(0, profileMaxResults);

    // DS012/DS030: compute KU-level metrics
    const kuLevelsUsed = [...new Set(topEvidence.map(s => s.unit?.kuType || s.unit?.unitType || 'unknown'))];
    const totalKUsConsidered = allCandidates.size;
    const selectedKUCount = topEvidence.length;

    // Split by store and keep evidence/guidance on separate paths.
    const topSessionEntries = topEvidence.filter(s => s.store === 'session');
    const topKbEntries = topEvidence.filter(s => s.store === 'kb');
    const guidanceSessionEntries = this._dedupeEntries([
      ...topGuidance.filter(s => s.store === 'session'),
      ...topSessionEntries.filter(entry => this._isGuidanceUnit(entry.unit))
    ]);
    const guidanceKbEntries = this._dedupeEntries([
      ...topGuidance.filter(s => s.store === 'kb'),
      ...topKbEntries.filter(entry => this._isGuidanceUnit(entry.unit))
    ]);
    const sessionUnits = topSessionEntries;
    const kbUnits = topKbEntries;

    // DS012: filter current-turn KUs per intent when possible, but only for evidence KUs.
    const intentTerms = new Set((contextProfile.queryTerms || []).map(t => t.toLowerCase()));
    let filteredCurrentTurn = (currentTurnUnits || []).filter(unit =>
      this._isEvidenceUnit(unit, decomposed, contextProfile)
    );
    if (filteredCurrentTurn.length > 0 && intentTerms.size > 0) {
      const relevant = filteredCurrentTurn.filter(u => {
        const text = `${u.topic || ''} ${u.claim || ''} ${u.procedure || ''}`.toLowerCase();
        return [...intentTerms].some(t => text.includes(t));
      });
      if (relevant.length > 0) filteredCurrentTurn = relevant;
    }

    const guidanceUnits = this._collectGuidanceUnits({
      currentTurnUnits: currentTurnUnits || [],
      retrievedSessionUnits: guidanceSessionEntries,
      retrievedKbUnits: guidanceKbEntries,
      session,
      kbIndex
    });
    const strategyUnits = this._dedupeEntries([
      ...guidanceUnits.planner,
      ...guidanceUnits.decomposition,
      ...guidanceUnits.validation
    ]);
    const evidenceUnitCount =
      filteredCurrentTurn.length +
      sessionUnits.length +
      kbUnits.length;
    const retrievalPurpose =
      strategyUnits.length === 0 ? 'task-evidence' :
      strategyUnits.length >= evidenceUnitCount ? 'strategy-guidance' :
      'mixed';

    const resolvedIntent = {
      intentGroup: { groupNumber: decomposed.groupNumber, act: decomposed.act, intent: decomposed.intent, output: decomposed.outputType },
      decomposed,
      intentRef,
      retrievalProfile: typeof retrievalProfile === 'string' ? retrievalProfile : profileConfig?.id || 'unknown',
      strategyUnits,
      guidanceUnits,
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
      }
    };
    resolvedIntent.resolvedPayload = buildResolvedIntentPayload(resolvedIntent);
    return resolvedIntent;
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

  _isEvidenceUnit(unit, decomposed, contextProfile) {
    if (!unit) return false;
    if (!inferPhaseScopes(unit).includes('kb-plugin')) return false;
    if (unit.subject && unit.relation && unit.object) return true;
    const role = String(unit.role || '');
    const preferredRoles = new Set(
      contextProfile?.neededRoles?.length
        ? contextProfile.neededRoles
        : (ACT_TO_ROLES[decomposed?.act] || [])
    );
    if (preferredRoles.has(role)) return true;
    return ['Comparison', 'Explanation', 'Definition', 'Diagnostic', 'Narrative', 'Description'].includes(role);
  }

  _isGuidanceUnit(unit) {
    if (!unit) return false;
    return inferPhaseScopes(unit).some(scope => scope !== 'kb-plugin');
  }

  _entryFromUnit(unit, store, score = 1, notes = []) {
    return {
      unitId: unit.id || unit.hash || `${store}-guidance`,
      score,
      store,
      unit
    };
  }

  _dedupeEntries(entries = []) {
    const seen = new Set();
    return entries.filter(entry => {
      const key = entry.unit?.hash || `${entry.store}:${entry.unitId}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  _guidanceBuckets() {
    return {
      seedDetector: [],
      planner: [],
      goalSolver: [],
      decomposition: [],
      validation: []
    };
  }

  _addGuidanceEntry(buckets, entry) {
    const scopes = inferPhaseScopes(entry.unit);
    if (scopes.includes('sd-plugin')) buckets.seedDetector.push(entry);
    if (scopes.includes('mrp-plan-plugin')) buckets.planner.push(entry);
    if (scopes.includes('gs-plugin')) buckets.goalSolver.push(entry);
    if (scopes.includes('frame')) buckets.decomposition.push(entry);
    if (scopes.includes('val-plugin')) buckets.validation.push(entry);
  }

  _collectGuidanceUnits({ currentTurnUnits = [], retrievedSessionUnits = [], retrievedKbUnits = [], session = null, kbIndex = null } = {}) {
    const buckets = this._guidanceBuckets();

    for (const unit of currentTurnUnits) {
      if (!this._isGuidanceUnit(unit)) continue;
      this._addGuidanceEntry(buckets, this._entryFromUnit(unit, 'current-turn', 1));
    }
    for (const entry of [...retrievedSessionUnits, ...retrievedKbUnits]) {
      if (!this._isGuidanceUnit(entry.unit)) continue;
      this._addGuidanceEntry(buckets, entry);
    }
    for (const unit of (session?.sessionContextUnits || []).slice(0, 40)) {
      if (!this._isGuidanceUnit(unit)) continue;
      this._addGuidanceEntry(buckets, this._entryFromUnit(unit, 'session', 0.9));
    }
    if (kbIndex?.units?.values) {
      let scanned = 0;
      for (const unit of kbIndex.units.values()) {
        if (scanned >= 400) break;
        scanned += 1;
        if (!this._isGuidanceUnit(unit)) continue;
        this._addGuidanceEntry(buckets, this._entryFromUnit(unit, 'kb', 0.6));
      }
    }

    return {
      seedDetector: this._dedupeEntries(buckets.seedDetector),
      planner: this._dedupeEntries(buckets.planner),
      goalSolver: this._dedupeEntries(buckets.goalSolver),
      decomposition: this._dedupeEntries(buckets.decomposition),
      validation: this._dedupeEntries(buckets.validation)
    };
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
