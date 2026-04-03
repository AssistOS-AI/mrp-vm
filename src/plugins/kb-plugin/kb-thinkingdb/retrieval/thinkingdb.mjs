import {
  buildFactKey,
  canonicalizeSymbol,
  extractSymbolicFact,
  normalizeSymbolKey,
  tokenizeSymbolText
} from '../../../../mrp-vm-sdk/nlp-util/symbolic-facts.mjs';

function uniqueStrings(items) {
  return [...new Set((items || []).filter(Boolean))];
}

function mergeSteps(proofs) {
  const seen = new Set();
  const steps = [];
  for (const proof of proofs) {
    for (const step of proof.steps || []) {
      const key = `${step.kind}:${step.key || step.id || ''}`;
      if (seen.has(key)) continue;
      seen.add(key);
      steps.push(step);
    }
  }
  return steps;
}

function mergeBaseFactKeys(proofs) {
  const keys = [];
  for (const proof of proofs) keys.push(...(proof.baseFactKeys || []));
  return uniqueStrings(keys);
}

function instantiateTerm(term, binding) {
  if (typeof term !== 'string') return term;
  if (!term.startsWith('?')) return term;
  return binding[term] || null;
}

function unifyTerm(patternTerm, factTerm, binding) {
  const normalizedFactTerm = normalizeSymbolKey(factTerm);
  if (!patternTerm.startsWith('?')) {
    return normalizeSymbolKey(patternTerm) === normalizedFactTerm ? binding : null;
  }
  const existing = binding[patternTerm];
  if (existing && normalizeSymbolKey(existing) !== normalizedFactTerm) return null;
  return { ...binding, [patternTerm]: factTerm };
}

function unifyPattern(pattern, fact, binding) {
  let next = unifyTerm(pattern.s, fact.s, binding);
  if (!next) return null;
  next = unifyTerm(pattern.r, fact.r, next);
  if (!next) return null;
  next = unifyTerm(pattern.o, fact.o, next);
  return next;
}

export class ThinkingDB {
  constructor(options = {}) {
    this.maxDepth = options.maxDepth ?? 3;
    this.maxDerivedFactsPerQuery = options.maxDerivedFactsPerQuery ?? 64;
    this.maxProofs = options.maxProofs ?? 32;
    this.maxSeedFacts = options.maxSeedFacts ?? 8;
    this.maxFocusedProofs = options.maxFocusedProofs ?? 12;
    this.defaultRuleWeight = options.defaultRuleWeight ?? 0.9;
    this.minConfidence = options.minConfidence ?? 0.5;
    this.distancePenaltyFactor = options.distancePenalty ?? 0.25;
    this.goalBonus = options.goalBonus ?? 1.15;
    this.seedBonus = options.seedBonus ?? 1.10;
    this.preferredRelations = options.preferredRelations || [
      'relevant_for',
      'has_capability',
      'depends_on',
      'causes'
    ];

    this.rules = [];
    this.facts = new Map();
    this.unitFacts = new Map();
    this.subjectIndex = new Map();
    this.objectIndex = new Map();
    this.tokenIndex = new Map();
  }

  registerRules(rules) {
    this.rules = (rules || []).map(rule => ({
      ...rule,
      weight: rule.weight ?? this.defaultRuleWeight
    }));
  }

  addUnit(contextUnit, store = 'kb') {
    const fact = this._extractFactFromUnit(contextUnit);
    if (!fact) return false;

    const key = buildFactKey(fact.subject, fact.relation, fact.object);
    const occurrence = {
      unitId: contextUnit.id,
      sourceId: contextUnit.sourceId,
      store,
      unit: contextUnit,
      conf: fact.confidence
    };

    if (!this.facts.has(key)) {
      this.facts.set(key, {
        key,
        s: canonicalizeSymbol(fact.subject),
        r: fact.relation,
        o: canonicalizeSymbol(fact.object),
        conf: fact.confidence,
        derived: false,
        occurrences: [occurrence]
      });
      this._indexFact(this.facts.get(key));
    } else {
      const entry = this.facts.get(key);
      entry.conf = Math.max(entry.conf, fact.confidence);
      if (!entry.occurrences.some(o => o.unitId === contextUnit.id)) {
        entry.occurrences.push(occurrence);
      }
    }

    if (!this.unitFacts.has(contextUnit.id)) this.unitFacts.set(contextUnit.id, new Set());
    this.unitFacts.get(contextUnit.id).add(key);
    return true;
  }

  removeUnit(unitId) {
    const factKeys = this.unitFacts.get(unitId);
    if (!factKeys) return;
    for (const key of factKeys) {
      const entry = this.facts.get(key);
      if (!entry) continue;
      entry.occurrences = entry.occurrences.filter(o => o.unitId !== unitId);
      if (entry.occurrences.length === 0) {
        this.facts.delete(key);
        this._deindexFact(entry);
      }
    }
    this.unitFacts.delete(unitId);
  }

  rebuild(units, store = 'kb') {
    this.facts.clear();
    this.unitFacts.clear();
    this.subjectIndex.clear();
    this.objectIndex.clear();
    this.tokenIndex.clear();
    for (const unit of units || []) this.addUnit(unit, store);
  }

  query(contextProfile, options = {}) {
    const queryTerms = uniqueStrings((contextProfile?.queryTerms || []).map(t => t.toLowerCase()));
    const queryText = normalizeSymbolKey(contextProfile?.queryText || queryTerms.join(' '));
    if (queryTerms.length === 0 || this.facts.size === 0) {
      return { queryTerms, seedFactKeys: [], derivedFacts: [], candidates: [], proofs: [] };
    }

    const maxDepth = options.maxDepth ?? this.maxDepth;
    const maxCandidates = options.maxCandidates ?? this.maxProofs;
    const seedFacts = this._resolveSeedFacts(queryTerms, queryText).slice(0, this.maxSeedFacts);
    const seedFactKeys = seedFacts.map(fact => fact.key);
    if (seedFactKeys.length === 0) {
      return { queryTerms, seedFactKeys: [], derivedFacts: [], candidates: [], proofs: [] };
    }

    const localFacts = this._buildLocalFactMap(seedFactKeys, maxDepth);
    const known = new Map();
    for (const fact of localFacts.values()) {
      known.set(fact.key, {
        key: fact.key,
        s: fact.s,
        r: fact.r,
        o: fact.o,
        rawScore: fact.conf,
        steps: [{ kind: 'fact', key: fact.key }],
        baseFactKeys: [fact.key],
        ruleIds: [],
        isBase: true
      });
    }

    const derivedFacts = [];
    for (let depth = 1; depth <= maxDepth; depth++) {
      let createdThisRound = 0;
      const knownFacts = [...known.values()].map(proof => ({
        key: proof.key,
        s: proof.s,
        r: proof.r,
        o: proof.o,
        proof
      }));

      for (const rule of this.rules) {
        const matches = this._matchRule(rule, knownFacts);
        for (const match of matches) {
          const s = instantiateTerm(rule.then.s, match.binding);
          const r = instantiateTerm(rule.then.r, match.binding);
          const o = instantiateTerm(rule.then.o, match.binding);
          if (!s || !r || !o) continue;

          const key = buildFactKey(s, r, o);
          const premiseProofs = match.premises.map(p => p.proof);
          const rawScore = premiseProofs.reduce((acc, proof) => acc * proof.rawScore, 1) * (rule.weight ?? this.defaultRuleWeight);
          const candidate = {
            key,
            s: canonicalizeSymbol(s),
            r,
            o: canonicalizeSymbol(o),
            rawScore,
            steps: [...mergeSteps(premiseProofs), { kind: 'rule', id: rule.id }],
            baseFactKeys: mergeBaseFactKeys(premiseProofs),
            ruleIds: [...uniqueStrings(premiseProofs.flatMap(p => p.ruleIds || [])), rule.id],
            isBase: false
          };

          const existing = known.get(key);
          if (existing?.isBase) continue;
          if (!existing || candidate.rawScore > existing.rawScore) {
            known.set(key, candidate);
            if (!localFacts.has(key)) {
              createdThisRound++;
              const prior = derivedFacts.findIndex(f => f.key === key);
              if (prior >= 0) derivedFacts.splice(prior, 1);
              derivedFacts.push(candidate);
            }
          }
          if (derivedFacts.length >= this.maxDerivedFactsPerQuery) break;
        }
        if (derivedFacts.length >= this.maxDerivedFactsPerQuery) break;
      }

      if (createdThisRound === 0 || derivedFacts.length >= this.maxDerivedFactsPerQuery) break;
    }

    const allProofs = [...known.values()]
      .sort((a, b) => b.rawScore - a.rawScore)
      .slice(0, this.maxProofs);
    const proofs = this._selectFocusedProofs(allProofs, derivedFacts, seedFactKeys, queryTerms, queryText);

    const unitScores = new Map();
    for (const proof of proofs) {
      const score = this._scoreProof(proof, seedFactKeys, queryTerms);
      for (const baseKey of proof.baseFactKeys) {
        const fact = localFacts.get(baseKey);
        if (!fact) continue;
        for (const occurrence of fact.occurrences) {
          if (score < this.minConfidence) continue;
          const current = unitScores.get(occurrence.unitId);
          if (!current || score > current.score) {
            unitScores.set(occurrence.unitId, {
              unitId: occurrence.unitId,
              unit: occurrence.unit,
              store: occurrence.store,
              score,
              proof
            });
          }
        }
      }
    }

    const ranked = [...unitScores.values()]
      .sort((a, b) => b.score - a.score || a.unitId.localeCompare(b.unitId))
      .slice(0, maxCandidates);

    const maxScore = Math.max(...ranked.map(r => r.score), 1);
    const candidates = ranked.map(item => ({
      unitId: item.unitId,
      store: item.store,
      rawScore: item.score,
      normalizedScore: item.score / maxScore,
      unit: item.unit,
      notes: this._notesForProof(item.proof)
    }));

    return {
      queryTerms,
      seedFactKeys,
      derivedFacts,
      candidates,
      proofs
    };
  }

  stats() {
    return {
      factCount: this.facts.size,
      unitCount: this.unitFacts.size,
      ruleCount: this.rules.length
    };
  }

  _extractFactFromUnit(unit) {
    if (unit?.subject && unit?.relation && unit?.object) {
      return {
        subject: canonicalizeSymbol(unit.subject),
        relation: unit.relation,
        object: canonicalizeSymbol(unit.object),
        confidence: Number.isFinite(unit.confidence) ? unit.confidence : 1
      };
    }
    return extractSymbolicFact(unit?.claim || unit?.procedure || unit?.topic || '');
  }

  _indexFact(fact) {
    this._indexSymbol(this.subjectIndex, normalizeSymbolKey(fact.s), fact.key);
    this._indexSymbol(this.objectIndex, normalizeSymbolKey(fact.o), fact.key);
    for (const token of uniqueStrings([...tokenizeSymbolText(fact.s), ...tokenizeSymbolText(fact.o)])) {
      this._indexSymbol(this.tokenIndex, token, fact.key);
    }
  }

  _deindexFact(fact) {
    this._deleteIndex(this.subjectIndex, normalizeSymbolKey(fact.s), fact.key);
    this._deleteIndex(this.objectIndex, normalizeSymbolKey(fact.o), fact.key);
    for (const token of uniqueStrings([...tokenizeSymbolText(fact.s), ...tokenizeSymbolText(fact.o)])) {
      this._deleteIndex(this.tokenIndex, token, fact.key);
    }
  }

  _indexSymbol(index, key, factKey) {
    if (!key) return;
    if (!index.has(key)) index.set(key, new Set());
    index.get(key).add(factKey);
  }

  _deleteIndex(index, key, factKey) {
    const set = index.get(key);
    if (!set) return;
    set.delete(factKey);
    if (set.size === 0) index.delete(key);
  }

  _resolveSeedFacts(queryTerms, queryText) {
    const queryTermSet = new Set(queryTerms);
    return [...this.facts.values()]
      .map(fact => ({ key: fact.key, score: this._seedScoreFact(fact, queryTermSet, queryText) }))
      .filter(item => item.score > 0)
      .sort((a, b) => b.score - a.score || a.key.localeCompare(b.key));
  }

  _buildLocalFactMap(seedFactKeys, maxDepth) {
    const local = new Map();
    const seenSymbols = new Set();
    let frontier = new Set();

    for (const key of seedFactKeys) {
      const fact = this.facts.get(key);
      if (!fact) continue;
      local.set(key, fact);
      for (const symbol of [normalizeSymbolKey(fact.s), normalizeSymbolKey(fact.o)]) {
        if (!symbol) continue;
        frontier.add(symbol);
        seenSymbols.add(symbol);
      }
    }

    for (let depth = 0; depth < maxDepth; depth++) {
      const next = new Set();
      for (const symbol of frontier) {
        for (const key of [...(this.subjectIndex.get(symbol) || []), ...(this.objectIndex.get(symbol) || [])]) {
          const fact = this.facts.get(key);
          if (!fact) continue;
          local.set(key, fact);
          for (const neighbor of [normalizeSymbolKey(fact.s), normalizeSymbolKey(fact.o)]) {
            if (neighbor && !seenSymbols.has(neighbor)) {
              seenSymbols.add(neighbor);
              next.add(neighbor);
            }
          }
        }
      }
      if (next.size === 0) break;
      frontier = next;
    }

    return local;
  }

  _matchRule(rule, facts) {
    const results = [];
    const backtrack = (premiseIndex, binding, premises) => {
      if (premiseIndex >= rule.when.length) {
        results.push({ binding, premises });
        return;
      }
      const pattern = rule.when[premiseIndex];
      for (const fact of facts) {
        if (!pattern.r.startsWith('?') && fact.r !== pattern.r) continue;
        const nextBinding = unifyPattern(pattern, fact, binding);
        if (!nextBinding) continue;
        if (premises.some(p => p.key === fact.key)) continue;
        backtrack(premiseIndex + 1, nextBinding, [...premises, fact]);
      }
    };
    backtrack(0, {}, []);
    return results;
  }

  _scoreProof(proof, seedFactKeys, queryTerms) {
    const pathLength = Math.max(1, proof.steps.length);
    const distancePenalty = 1 / (1 + pathLength * this.distancePenaltyFactor);
    const proofTokens = tokenizeSymbolText(`${proof.s} ${proof.o}`);
    const touchesGoal = queryTerms.some(term => proofTokens.includes(term));
    const startsFromSeed = proof.baseFactKeys.some(key => seedFactKeys.includes(key));
    return proof.rawScore
      * distancePenalty
      * (touchesGoal ? this.goalBonus : 1)
      * (startsFromSeed ? this.seedBonus : 1);
  }

  _seedScoreFact(fact, queryTermSet, queryText) {
    const subjectNorm = normalizeSymbolKey(fact.s);
    const objectNorm = normalizeSymbolKey(fact.o);
    const subjectTokens = tokenizeSymbolText(fact.s);
    const objectTokens = tokenizeSymbolText(fact.o);
    const subjectMatches = subjectTokens.filter(token => queryTermSet.has(token)).length;
    const objectMatches = objectTokens.filter(token => queryTermSet.has(token)).length;
    const exactSubject = subjectNorm && queryText.includes(subjectNorm);
    const exactObject = objectNorm && queryText.includes(objectNorm);
    let score = subjectMatches * 2 + objectMatches * 2;
    if (exactSubject) score += 4;
    if (exactObject) score += 4;
    if (fact.r === 'relevant_for' && objectMatches > 0) score += 2;
    if ((subjectMatches > 0 && objectMatches > 0) || (exactSubject && exactObject)) score += 2;
    return score;
  }

  _selectFocusedProofs(allProofs, derivedFacts, seedFactKeys, queryTerms, queryText) {
    const derivedKeys = new Set(derivedFacts.map(fact => fact.key));
    const scored = allProofs
      .map(proof => ({
        proof,
        score: this._focusScoreProof(proof, seedFactKeys, queryTerms, queryText, derivedKeys)
      }))
      .filter(item => item.score > 0)
      .sort((a, b) => b.score - a.score || b.proof.rawScore - a.proof.rawScore || a.proof.key.localeCompare(b.proof.key));

    const derivedPreferred = scored.filter(item => derivedKeys.has(item.proof.key));
    const focused = (derivedPreferred.length > 0 ? derivedPreferred : scored)
      .slice(0, this.maxFocusedProofs)
      .map(item => item.proof);

    return focused.length > 0 ? focused : allProofs.slice(0, this.maxFocusedProofs);
  }

  _focusScoreProof(proof, seedFactKeys, queryTerms, queryText, derivedKeys) {
    const queryTermSet = new Set(queryTerms);
    const subjectNorm = normalizeSymbolKey(proof.s);
    const objectNorm = normalizeSymbolKey(proof.o);
    const subjectMatches = tokenizeSymbolText(proof.s).filter(token => queryTermSet.has(token)).length;
    const objectMatches = tokenizeSymbolText(proof.o).filter(token => queryTermSet.has(token)).length;
    const exactSubject = subjectNorm && queryText.includes(subjectNorm);
    const exactObject = objectNorm && queryText.includes(objectNorm);

    let score = 0;
    score += subjectMatches * 2;
    score += objectMatches * 2;
    if (exactSubject) score += 4;
    if (exactObject) score += 4;
    if (subjectMatches > 0 && objectMatches > 0) score += 3;
    if (this.preferredRelations.includes(proof.r)) score += 2;
    if (derivedKeys.has(proof.key)) score += 3;
    if (proof.baseFactKeys.some(key => seedFactKeys.includes(key))) score += 1;
    return score;
  }

  _notesForProof(proof) {
    if (proof.isBase) return ['thinkingdb', `base: ${proof.s} ${proof.r} ${proof.o}`];
    return [
      'thinkingdb',
      `derived: ${proof.s} ${proof.r} ${proof.o}`,
      `via: ${(proof.ruleIds || []).join(' -> ')}`
    ];
  }
}
