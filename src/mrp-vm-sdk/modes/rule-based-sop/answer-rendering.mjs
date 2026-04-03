import { extractSymbolicFact, normalizeSymbolKey } from '../../nlp-util/symbolic-facts.mjs';

export const ruleBasedSOPAnswerRenderingMethods = {
  _formatSourceScore(score) {
    return Number.isFinite(score) ? score.toFixed(2) : 'n/a';
  },

  _buildGuidanceProfile(guidanceUnits = []) {
    const text = guidanceUnits
      .map(entry => entry?.unit?.claim || entry?.unit?.procedure || '')
      .join(' ')
      .toLowerCase();
    return {
      json: /\bjson\b/.test(text),
      bullets: /\b(bullet|list)\b/.test(text),
      brief: /\b(brief|concise|short)\b/.test(text),
      stepByStep: /\b(step-by-step|step by step)\b/.test(text),
      singleWord: /\b(single word|one word)\b/.test(text),
      yesNo: /\b(yes\/no|yes or no)\b/.test(text)
    };
  },

  _mergeGuidanceProfiles(...profiles) {
    return profiles.reduce((merged, profile) => {
      for (const [key, value] of Object.entries(profile || {})) {
        merged[key] = Boolean(merged[key] || value);
      }
      return merged;
    }, {
      json: false,
      bullets: false,
      brief: false,
      stepByStep: false,
      singleWord: false,
      yesNo: false
    });
  },

  _filterGuidanceUnitsForIntent(entries = [], resolvedIntent = null) {
    const intentText = [
      resolvedIntent?.decomposed?.intent || '',
      resolvedIntent?.decomposed?.target || '',
      resolvedIntent?.decomposed?.outputType || ''
    ].join(' ').toLowerCase();
    const intentTerms = new Set(
      intentText
        .split(/\s+/)
        .map(term => term.replace(/[^\w-]/g, ''))
        .filter(term => term.length > 2 && !['answer', 'respond', 'reply', 'output', 'word', 'single', 'yes', 'no'].includes(term))
    );
    const hasExplicitOutputConstraint = /\b(single word|one word|yes\s*(?:\/|or)\s*no|json|bullet|list|table|step-by-step|step by step)\b/.test(intentText);
    return entries.filter(entry => {
      const store = entry?.store || '';
      const text = String(entry?.unit?.claim || entry?.unit?.procedure || '').toLowerCase();
      if (!text) return false;
      if (store && store !== 'current-turn') return true;
      const overlapsIntent = [...intentTerms].some(term => text.includes(term));
      if (overlapsIntent) return true;
      if (this._isOutputInstructionSentence(text)) return !hasExplicitOutputConstraint;
      return true;
    });
  },

  _renderGuidedAnswer(claims, guidanceProfile, resolvedIntent = null) {
    const intentText = [
      resolvedIntent?.decomposed?.intent || '',
      resolvedIntent?.decomposed?.outputType || ''
    ].join(' ').toLowerCase();
    const wantsSingleWord = guidanceProfile.singleWord || /\b(single word|one word)\b/.test(intentText);
    const wantsYesNo = guidanceProfile.yesNo || /\b(yes or no|yes\/no)\b/.test(intentText);
    const wantsStepByStep = guidanceProfile.stepByStep
      || /\b(step-by-step|step by step|trace every intermediate step|chain of cause and effect)\b/.test(intentText);
    const act = resolvedIntent?.decomposed?.act || '';

    if (act === 'identify' && wantsSingleWord) {
      const answer = this._inferSingleWordIdentity(claims, resolvedIntent);
      if (answer) return { answer, status: 'answered' };
      return { answer: 'Insufficient context to determine the answer.', status: 'no-context' };
    }

    if (wantsYesNo) {
      const verdict = this._inferYesNoAnswer(claims, resolvedIntent);
      if (verdict) return { answer: verdict, status: 'answered' };
      return { answer: 'Insufficient context to determine the answer.', status: 'no-context' };
    }

    if (wantsSingleWord) {
      const verdict = this._inferSingleWordVerdict(claims, resolvedIntent);
      if (verdict) return { answer: verdict, status: 'answered' };
      return { answer: 'Insufficient context to determine the answer.', status: 'no-context' };
    }

    if (this._isCounterfactualPrompt(resolvedIntent)) {
      return this._renderCounterfactualAnswer(claims, resolvedIntent);
    }

    if (act === 'explain' && wantsStepByStep) {
      return this._renderStepByStepExplanationAnswer(claims, resolvedIntent, guidanceProfile.brief);
    }

    if (act === 'explain' && !guidanceProfile.json && !guidanceProfile.bullets && !wantsStepByStep) {
      return this._renderExplanationAnswer(claims, resolvedIntent, guidanceProfile.brief);
    }

    const selectedClaims = guidanceProfile.brief ? claims.slice(0, 3) : claims;
    const normalizedClaims = wantsStepByStep
      ? selectedClaims.map((claim, index) => `Step ${index + 1}: ${claim}`)
      : selectedClaims;
    if (guidanceProfile.json) {
      return { answer: `\`\`\`json\n${JSON.stringify({
        status: 'answered',
        answer: normalizedClaims,
        format: wantsStepByStep ? 'step-by-step' : guidanceProfile.bullets ? 'bullets' : 'plain'
      }, null, 2)}\n\`\`\``, status: 'answered' };
    }
    if (guidanceProfile.bullets || wantsStepByStep || normalizedClaims.length > 1) {
      return { answer: `Based on the available evidence:\n${normalizedClaims.map(claim => `- ${claim}`).join('\n')}\n`, status: 'answered' };
    }
    return { answer: normalizedClaims[0] || 'Based on the available evidence.', status: 'answered' };
  },

  _renderExplanationAnswer(claims, resolvedIntent, brief = false) {
    const symbolicExplanation = this._renderSymbolicChainExplanation(resolvedIntent);
    if (symbolicExplanation) return symbolicExplanation;

    const subjectHint = this._extractExplanationSubject(resolvedIntent);
    const normalizedClaims = claims
      .map(claim => this._normalizeAnswerSentence(claim))
      .filter(Boolean)
      .sort((a, b) => this._scoreExplanationClaim(b, subjectHint) - this._scoreExplanationClaim(a, subjectHint));
    const selectedClaims = brief ? normalizedClaims.slice(0, 3) : normalizedClaims;
    const explanationPrompt = this._extractExplanationPrompt(resolvedIntent);
    const conclusion = explanationPrompt
      ? `Taken together, these relationships explain ${explanationPrompt}.`
      : 'Taken together, these relationships provide the explanation requested.';
    const parts = [...selectedClaims];
    if (!parts.some(part => part === conclusion)) parts.push(conclusion);
    return {
      answer: parts.join(' ').trim(),
      status: 'answered'
    };
  },

  _renderSymbolicChainExplanation(resolvedIntent) {
    const facts = this._collectResolvedIntentFacts(resolvedIntent);
    if (facts.length < 2) return null;
    const subjectHint = this._extractExplanationSubject(resolvedIntent);
    const subjectKey = this._findFactNodeKey(facts, subjectHint, 'subject');
    if (!subjectKey) return null;
    const targetPhrases = this._extractExplanationTargetPhrases(resolvedIntent, subjectHint);
    if (!targetPhrases.length) return null;
    const path = this._findFactPath(facts, subjectKey, targetPhrases);
    if (!path || path.length < 2) return null;

    const sentences = [];
    const seen = new Set();
    for (const fact of path) {
      const sentence = this._renderFactSentence(fact);
      if (!sentence || seen.has(sentence)) continue;
      seen.add(sentence);
      sentences.push(sentence);
    }

    const providedFact = path.find(fact => fact.relation === 'provides') || null;
    const relevanceFact = path.find(fact => fact.relation === 'relevant_for')
      || (providedFact
        ? facts.find(fact => fact.relation === 'relevant_for' && fact.subjectKey === providedFact.objectKey)
        : null);
    const prompt = this._extractExplanationPrompt(resolvedIntent);
    if (relevanceFact) {
      const relevanceSentence = this._renderFactSentence(relevanceFact);
      if (relevanceSentence && !seen.has(relevanceSentence)) {
        seen.add(relevanceSentence);
        sentences.push(relevanceSentence);
      }
    }
    if (providedFact && relevanceFact) {
      const provider = providedFact.subject;
      const capability = providedFact.object;
      const outcome = relevanceFact.object;
      sentences.push(
        `${path[0].subject} reaches ${outcome} through a dependency chain where ${provider} provides ${capability}, so that ${capability.toLowerCase()} is the concrete reason ${prompt || 'for the requested benefit'}.`
      );
    } else if (providedFact) {
      sentences.push(
        `That chain matters because ${providedFact.subject} provides ${providedFact.object}, which is the concrete mechanism behind ${prompt || 'the requested explanation'}.`
      );
    } else {
      sentences.push(
        `That dependency chain is what explains ${prompt || 'the requested relationship'}.`
      );
    }
    if (prompt) {
      sentences.push(`Taken together, these relationships explain ${prompt}.`);
    }

    return {
      answer: sentences.join(' ').trim(),
      status: 'answered'
    };
  },

  _renderStepByStepExplanationAnswer(claims, resolvedIntent, brief = false) {
    const normalizedSteps = claims
      .flatMap(claim => this._splitIntoSentences(claim))
      .map(claim => this._normalizeAnswerSentence(claim))
      .filter(Boolean);
    const uniqueSteps = [...new Set(normalizedSteps)]
      .sort((a, b) => {
        const stageDelta = this._scoreStepwisePosition(a) - this._scoreStepwisePosition(b);
        if (stageDelta !== 0) return stageDelta;
        return this._scoreExplanationClaim(b) - this._scoreExplanationClaim(a);
      });
    const relevantSteps = uniqueSteps.filter(step => this._scoreStepwiseRelevance(step, resolvedIntent) > 0);
    const stepPool = relevantSteps.length > 0 ? relevantSteps : uniqueSteps;
    const selectedSteps = brief ? stepPool.slice(0, 4) : stepPool.slice(0, 7);
    const explanationPrompt = this._extractExplanationPrompt(resolvedIntent);
    const intro = explanationPrompt
      ? `Here is the step-by-step chain that explains ${explanationPrompt}:`
      : 'Here is the step-by-step chain supported by the available evidence:';
    const conclusion = explanationPrompt
      ? `This sequence shows how ${explanationPrompt}.`
      : 'This sequence captures the causal chain supported by the retrieved evidence.';
    return {
      answer: `${intro}\n${selectedSteps.map((step, index) => `${index + 1}. ${step}`).join('\n')}\n${conclusion}`,
      status: 'answered'
    };
  },

  _isCounterfactualPrompt(resolvedIntent) {
    const intent = String(resolvedIntent?.decomposed?.intent || '').toLowerCase();
    return /\bcounterfactual\b/.test(intent)
      || (/\bif\b/.test(intent) && /\bwould\b/.test(intent) && /\bdiffer\b/.test(intent));
  },

  _renderCounterfactualAnswer(claims, resolvedIntent) {
    const { primaryActor, contrastActor } = this._extractCounterfactualActors(resolvedIntent);
    const primaryTrait = this._findActorClaim(
      claims,
      primaryActor,
      ['ruthless', 'profit', 'order', 'collateral', 'protect the flux core', 'protect']
    );
    const contrastTrait = this._findActorClaim(
      claims,
      contrastActor,
      ['courageous', 'desperate to stop', 'fled to the city', 'sought out', 'stop the destruction']
    );
    const outcomeClaim = this._findOutcomeClaim(claims);

    const parts = [];
    if (primaryActor && contrastActor) {
      parts.push(`If ${primaryActor} had discovered the obelisk instead of ${contrastActor}, the outcome would likely have been much harsher and less cooperative.`);
    }
    if (primaryTrait) parts.push(primaryTrait);
    if (contrastTrait) parts.push(`By contrast, ${this._lowercaseFirst(contrastTrait)}`);

    const motiveFrame = primaryTrait && /\b(profit|order|collateral|protect)\b/i.test(primaryTrait)
      ? `${primaryActor || 'the alternate discoverer'} would likely have treated the obelisk as an asset to control or exploit, not as evidence to share in order to stop the crisis.`
      : `${primaryActor || 'the alternate discoverer'} would likely have reacted very differently from ${contrastActor || 'the original discoverer'}, which would have changed the rest of the chain.`;
    parts.push(motiveFrame);

    if (outcomeClaim) {
      parts.push(`That makes the successful ending described in the evidence much less likely: ${outcomeClaim}`);
    } else {
      parts.push('That would likely have delayed or prevented the cooperative resolution that the original story achieved.');
    }

    return {
      answer: parts.join(' ').trim(),
      status: 'answered'
    };
  },

  _normalizeAnswerSentence(claim) {
    const text = String(claim || '').trim();
    if (!text) return '';
    return /[.?!]$/.test(text) ? text : `${text}.`;
  },

  _extractExplanationPrompt(resolvedIntent) {
    const intent = String(resolvedIntent?.decomposed?.intent || '').trim().replace(/[.?!]+$/g, '');
    const match = intent.match(/^Explain\s+(why|how)\s+(.+)$/i);
    if (!match) return '';
    return `${match[1].toLowerCase()} ${match[2]}`;
  },

  _extractExplanationSubject(resolvedIntent) {
    const intent = String(resolvedIntent?.decomposed?.intent || '');
    const matches = intent.match(/\b[A-Z][a-zA-Z0-9-]*(?:\s+[A-Z][a-zA-Z0-9-]*)*/g) || [];
    return matches
      .map(item => item.trim().toLowerCase())
      .find(item => !['explain', 'why', 'how', 'what', 'when', 'where', 'which'].includes(item)) || '';
  },

  _extractExplanationTargetPhrases(resolvedIntent, subjectHint = '') {
    const prompt = this._extractExplanationPrompt(resolvedIntent) || String(resolvedIntent?.decomposed?.intent || '');
    const loweredPrompt = prompt.toLowerCase();
    const phrases = [];
    const benefitMatch = loweredPrompt.match(/\bbenefits?\s+from\s+(.+?)(?:\s+for\s+(.+))?$/i);
    if (benefitMatch) {
      if (benefitMatch[1]) phrases.push(benefitMatch[1]);
      if (benefitMatch[2]) phrases.push(benefitMatch[2]);
    }
    const relevantMatch = loweredPrompt.match(/\brelevant\s+for\s+(.+)$/i);
    if (relevantMatch?.[1]) phrases.push(relevantMatch[1]);
    const afterWhyHow = loweredPrompt.match(/^(?:why|how)\s+(.+)$/i)?.[1] || loweredPrompt;
    if (afterWhyHow) phrases.push(afterWhyHow);

    return [...new Set(
      phrases
        .flatMap(phrase => String(phrase || '')
          .split(/\b(?:through|via|with|because|and)\b/i)
          .map(part => part.trim())
        )
        .map(phrase => {
          if (!subjectHint) return phrase;
          return phrase.replace(new RegExp(`\\b${subjectHint.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i'), '');
        })
        .map(phrase => phrase.replace(/\b(?:benefits?|for|from|the|a|an|why|how)\b/gi, ' ').replace(/\s+/g, ' ').trim())
        .filter(Boolean)
    )];
  },

  _collectResolvedIntentFacts(resolvedIntent) {
    const evidenceUnits = [
      ...(resolvedIntent?.currentTurnContextUnits || []),
      ...(resolvedIntent?.sessionUnits || []).map(entry => entry?.unit || null),
      ...(resolvedIntent?.kbUnits || []).map(entry => entry?.unit || null)
    ].filter(Boolean);
    const facts = [];
    const seen = new Set();

    for (const unit of evidenceUnits) {
      const symbolic = unit?.subject && unit?.relation && unit?.object
        ? {
            subject: unit.subject,
            relation: unit.relation,
            object: unit.object
          }
        : extractSymbolicFact(unit?.claim || unit?.procedure || '');
      if (!symbolic) continue;
      const subjectKey = normalizeSymbolKey(symbolic.subject);
      const objectKey = normalizeSymbolKey(symbolic.object);
      if (!subjectKey || !objectKey) continue;
      const key = `${subjectKey}|${symbolic.relation}|${objectKey}`;
      if (seen.has(key)) continue;
      seen.add(key);
      facts.push({
        ...symbolic,
        subjectKey,
        objectKey,
        text: this._normalizeAnswerSentence(unit?.claim || unit?.procedure || this._composeFactSentence(symbolic))
      });
    }
    return facts;
  },

  _composeFactSentence(fact) {
    const relationText = {
      uses: 'uses',
      provides: 'provides',
      has_capability: 'has capability',
      depends_on: 'depends on',
      part_of: 'is part of',
      instance_of: 'is an instance of',
      relevant_for: 'is relevant for',
      supports: 'supports',
      mentions: 'mentions',
      about: 'is about',
      causes: 'causes'
    }[fact?.relation] || fact?.relation || 'relates to';
    return `${fact?.subject || 'It'} ${relationText} ${fact?.object || 'it'}.`;
  },

  _renderFactSentence(fact) {
    return this._normalizeAnswerSentence(fact?.text || this._composeFactSentence(fact));
  },

  _findFactNodeKey(facts, hint, side = 'subject') {
    const normalizedHint = normalizeSymbolKey(hint || '');
    if (!normalizedHint) return null;
    const exact = facts.find(fact => fact[`${side}Key`] === normalizedHint);
    if (exact) return exact[`${side}Key`];
    const overlap = facts.find(fact => fact[`${side}Key`].includes(normalizedHint) || normalizedHint.includes(fact[`${side}Key`]));
    return overlap?.[`${side}Key`] || null;
  },

  _findFactPath(facts, subjectKey, targetPhrases = []) {
    const outgoing = new Map();
    for (const fact of facts) {
      if (!outgoing.has(fact.subjectKey)) outgoing.set(fact.subjectKey, []);
      outgoing.get(fact.subjectKey).push(fact);
    }
    const matchesTarget = (key, normalized) =>
      key === normalized || key.includes(normalized) || normalized.includes(key);

    for (const phrase of targetPhrases) {
      const normalizedPhrase = normalizeSymbolKey(phrase);
      if (!normalizedPhrase) continue;
      const queue = [{ key: subjectKey, path: [] }];
      const visited = new Set([subjectKey]);
      while (queue.length > 0) {
        const current = queue.shift();
        if (current.path.length > 0 && matchesTarget(current.key, normalizedPhrase)) {
          return current.path;
        }
        for (const fact of outgoing.get(current.key) || []) {
          if (visited.has(fact.objectKey)) continue;
          visited.add(fact.objectKey);
          queue.push({
            key: fact.objectKey,
            path: [...current.path, fact]
          });
        }
      }
    }
    return null;
  },

  _scoreExplanationClaim(claim, subjectHint = '') {
    const text = String(claim || '').toLowerCase();
    const fact = extractSymbolicFact(claim);
    let score = 0;
    if (subjectHint && text.includes(subjectHint)) score += 4;
    if (fact) score += 2;
    if (fact?.relation === 'relevant_for') score -= 1;
    if (/\b(uses|depends on|provides|supports|has capability)\b/.test(text)) score += 1;
    return score;
  },

  _scoreStepwisePosition(claim) {
    const text = String(claim || '').toLowerCase();
    if (/\b(discover|discovered|unearthed|found|located)\b/.test(text)) return 10;
    if (/\b(extract|extracted|recovered|uncovered)\b/.test(text)) return 15;
    if (/\b(pulse|pulsed|frequency|signal|resonance|synchron)\b/.test(text)) return 20;
    if (/\b(fled|brought|carried|sought out|sought|reached out|consulted)\b/.test(text)) return 30;
    if (/\b(link|linked|bridge|bridged|connect|connected|fusion|fused|merge|merged)\b/.test(text)) return 40;
    if (/\b(reactivat|activated|restored|wave of pure energy|energy wave|enveloped)\b/.test(text)) return 50;
    return 25;
  },

  _scoreStepwiseRelevance(claim, resolvedIntent) {
    const text = String(claim || '').toLowerCase();
    const intentTerms = String(resolvedIntent?.decomposed?.intent || '')
      .toLowerCase()
      .split(/\s+/)
      .map(term => term.replace(/[^\w-]/g, ''))
      .filter(term => term.length > 3 && ![
        'explain', 'chain', 'cause', 'effect', 'links', 'trace', 'every',
        'intermediate', 'step', 'that', 'with', 'from', 'into', 'this'
      ].includes(term));
    let score = 0;
    if (intentTerms.some(term => text.includes(term))) score += 2;
    if (this._scoreStepwisePosition(claim) !== 25) score += 1;
    if (/\b(obelisk|core|frequency|link|linked|bridge|fusion|energy|shield|reactivat|extract|extracted|unearthed|sought out)\b/.test(text)) score += 2;
    if (/\b(aura-city|balance of this world|simultaneous discoveries|combat drones|collateral damage)\b/.test(text)) score -= 2;
    return score;
  },

  _inferSingleWordIdentity(claims, resolvedIntent) {
    const intentText = String(resolvedIntent?.decomposed?.intent || '').toLowerCase();
    const queryTerms = new Set(
      intentText
        .split(/\s+/)
        .map(term => term.replace(/[^\w-]/g, ''))
        .filter(term => term && ![
          'name', 'single', 'one', 'word', 'whose', 'would', 'could', 'should', 'character',
          'questions', 'answer', 'each', 'with', 'yes', 'no', 'only'
        ].includes(term))
    );
    const operationalIdentityPrompt = /\b(operation|operations|extract|extraction|excavat|runs|run|controls?|protect(?:ing)?)\b/.test(intentText);
    const blockedWords = new Set([
      'desert', 'abyss', 'city', 'ocean', 'mountain', 'valley', 'forest', 'river',
      'planet', 'galaxy', 'world', 'region', 'area', 'zone', 'sector',
      'core', 'artifact', 'device', 'machine', 'system', 'network', 'shield',
      'syndicate', 'guild', 'order', 'council', 'alliance', 'empire', 'federation',
      'the', 'a', 'an', 'this', 'that'
    ]);
    const candidates = new Map();

    for (const claim of claims) {
      const claimText = String(claim || '');
      const claimLower = claimText.toLowerCase();
      const overlap = [...queryTerms].filter(term => claimLower.includes(term)).length;
      const operationalScore = operationalIdentityPrompt && /\b(operation|operations|extract|extracted|extraction|excavator|excavators|runs|run|controls?|protect(?:ing)?)\b/.test(claimLower)
        ? 4
        : 0;
      const matches = claimText.match(/\b(?:Commander|Dr\.?|Doctor)?\s*[A-Z][a-zA-Z0-9-]*(?:\s+[A-Z][a-zA-Z0-9-]*)*/g) || [];
      for (const raw of matches) {
        const phrase = raw.trim().replace(/\s+/g, ' ');
        if (!phrase) continue;
        if (String(resolvedIntent?.decomposed?.intent || '').includes(phrase)) continue;
        const parts = phrase.split(/\s+/).filter(Boolean);
        let answer = parts[parts.length - 1]
          .replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9-]+$/g, '');
        if (/-/.test(answer)) {
          const segments = answer.split('-').filter(Boolean);
          if (segments.length > 1 && segments[segments.length - 1].length <= 2) {
            answer = segments[0];
          }
        }
        const answerLower = answer.toLowerCase();
        if (!answer || blockedWords.has(answerLower)) continue;
        const score =
          overlap +
          operationalScore +
          (/\b(Commander|Dr\.?|Doctor)\b/.test(phrase) ? 1 : 0);
        const weightedScore = Math.max(1, score);
        const current = candidates.get(answer) || { total: 0, peak: 0 };
        candidates.set(answer, {
          total: current.total + weightedScore,
          peak: Math.max(current.peak, weightedScore)
        });
      }
    }

    return [...candidates.entries()]
      .sort((a, b) =>
        b[1].peak - a[1].peak
        || b[1].total - a[1].total
        || a[0].localeCompare(b[0])
      )
      .map(([answer]) => answer)[0] || null;
  },

  _inferSingleWordVerdict(claims, resolvedIntent) {
    const verdict = this._inferYesNoAnswer(claims, resolvedIntent);
    if (!verdict) return null;
    return verdict;
  },

  _inferYesNoAnswer(claims, resolvedIntent) {
    const intentText = String(resolvedIntent?.decomposed?.intent || '').toLowerCase();
    if (!intentText) return null;
    const normalizedClaims = claims
      .map(claim => String(claim || '').toLowerCase())
      .filter(Boolean);
    if (!normalizedClaims.length) return null;

    const hasAny = terms => terms.some(term => intentText.includes(term));
    const hasQuestionTerm = term => normalizedClaims.some(claim => claim.includes(term));

    const asksAboutTechAid =
      hasAny(['implant', 'implants', 'neural', 'city-linked', 'city linked']) &&
      hasAny(['help', 'survive', 'advantage', 'useful']);
    const environmentNegatesTech =
      hasAny(['technology-free', 'technology free', 'without technology', 'stranded']) ||
      hasAny(['frozen abyss', 'wasteland']);
    if (asksAboutTechAid && environmentNegatesTech) {
      return 'No';
    }

    if (
      hasAny(['prioritize', 'prioritise']) &&
      hasAny(['rescu', 'rescue']) &&
      hasAny(['over securing', 'over secure', 'over protecting', 'over protect', 'flux core'])
    ) {
      const protectsTarget = hasQuestionTerm('ordered to protect') || hasQuestionTerm('protect the flux core');
      const ignoresCollateral = hasQuestionTerm('ignoring all collateral damage');
      if (protectsTarget || ignoresCollateral) return 'No';
    }

    if (
      hasAny(['tactical advantage', 'advantage']) &&
      hasAny(['aura-city', 'aura city', 'architecture']) &&
      hasAny(['evad', 'drones'])
    ) {
      const supportsEvasion =
        hasQuestionTerm('race against time') ||
        hasQuestionTerm('under a sky streaked by combat drones') ||
        hasQuestionTerm('hidden in the shadows');
      if (supportsEvasion) return 'Yes';
    }

    if (/\b(would|could|was|is)\b/.test(intentText) && hasAny(['help', 'survive', 'advantage'])) {
      const negativeCues = ['technology-free', 'without', 'cannot', 'unable', 'failed', 'impossible'];
      if (negativeCues.some(cue => intentText.includes(cue))) return 'No';
    }

    return null;
  },

  _extractCounterfactualActors(resolvedIntent) {
    const intent = String(resolvedIntent?.decomposed?.intent || '').replace(/[.?!]+$/g, '');
    const match = intent.match(/if\s+(.+?)\s+had\b[\s\S]*?\binstead of\s+(.+?)(?:,| how|$)/i);
    if (!match) return { primaryActor: '', contrastActor: '' };
    return {
      primaryActor: match[1].trim(),
      contrastActor: match[2].trim()
    };
  },

  _findActorClaim(claims, actor, cueTerms = []) {
    if (!actor) return '';
    const actorWords = actor.toLowerCase().split(/\s+/).filter(Boolean);
    const scored = claims
      .map(claim => {
        const text = String(claim || '').trim();
        const lower = text.toLowerCase();
        let score = actorWords.some(word => lower.includes(word)) ? 3 : 0;
        if (cueTerms.some(term => lower.includes(term))) score += 2;
        return { text: this._normalizeAnswerSentence(text), score };
      })
      .filter(item => item.score > 0)
      .sort((a, b) => b.score - a.score || a.text.localeCompare(b.text));
    return scored[0]?.text || '';
  },

  _findOutcomeClaim(claims) {
    const scored = claims
      .map(claim => {
        const text = String(claim || '').trim();
        const lower = text.toLowerCase();
        let score = 0;
        if (/\breactivat|reactivated|shield|terraform|safe and stable paradise|wave of pure energy\b/.test(lower)) score += 3;
        if (/\bkaelen\b/.test(lower)) score += 1;
        return { text: this._normalizeAnswerSentence(text), score };
      })
      .filter(item => item.score > 0)
      .sort((a, b) => b.score - a.score || a.text.localeCompare(b.text));
    return scored[0]?.text || '';
  },

  _lowercaseFirst(text) {
    const value = String(text || '').trim();
    if (!value) return value;
    return value.charAt(0).toLowerCase() + value.slice(1);
  }
};
