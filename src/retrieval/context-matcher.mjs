// DS012 — Retrieval & Context Matching
import { loadConfig } from '../lib/config.mjs';

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

    const top = pruned.slice(0, profileMaxResults);

    // Split by store
    const sessionUnits = top.filter(s => s.store === 'session');
    const kbUnits = top.filter(s => s.store === 'kb');

    // Build resolved markdown
    const resolvedMarkdown = this._buildResolvedMarkdown(decomposed, currentTurnUnits, sessionUnits, kbUnits);

    return {
      intentGroup: { groupNumber: decomposed.groupNumber, act: decomposed.act, intent: decomposed.intent, output: decomposed.outputType },
      decomposed,
      intentRef,
      retrievalProfile: typeof retrievalProfile === 'string' ? retrievalProfile : profileConfig?.id || 'unknown',
      currentTurnContextUnits: currentTurnUnits || [],
      sessionUnits,
      kbUnits,
      retrievalTrace: { strategiesRun, escalated },
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

  _buildResolvedMarkdown(decomposed, currentTurnUnits, sessionUnits, kbUnits) {
    let md = `## Resolved Intent Group ${decomposed.groupNumber}\n`;
    md += `Act: ${decomposed.act}\n`;
    md += `Intent: ${decomposed.intent}\n`;
    md += `Output: ${decomposed.outputType}\n\n`;
    if (currentTurnUnits?.length > 0) {
      md += `### Current-Turn Context\n`;
      for (const u of currentTurnUnits) {
        md += `#### ${u.id}\nRole: ${u.role}\nClaim: ${u.claim || u.procedure || ''}\n\n`;
      }
    }
    if (sessionUnits.length > 0) {
      md += `### Session Context\n`;
      for (const s of sessionUnits) {
        md += `#### ${s.unitId} (score: ${s.score.toFixed(2)})\nRole: ${s.unit?.role || ''}\nClaim: ${s.unit?.claim || s.unit?.procedure || ''}\n`;
        if (s.notes?.length) md += `Notes: ${s.notes.join(' | ')}\n`;
        md += `\n`;
      }
    }
    if (kbUnits.length > 0) {
      md += `### Persistent KB Context\n`;
      for (const s of kbUnits) {
        md += `#### ${s.unitId} (score: ${s.score.toFixed(2)})\nRole: ${s.unit?.role || ''}\nSource: ${s.unit?.sourceId || ''}\nClaim: ${s.unit?.claim || s.unit?.procedure || ''}\n`;
        if (s.notes?.length) md += `Notes: ${s.notes.join(' | ')}\n`;
        md += `\n`;
      }
    }
    return md;
  }
}
