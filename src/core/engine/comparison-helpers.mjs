function snipCandidateLabel(text, max = 80) {
  const normalized = String(text || '').replace(/\s+/g, ' ').trim();
  if (!normalized) return 'candidate';
  return normalized.length <= max ? normalized : `${normalized.slice(0, max)}…`;
}

const STRENGTH_RANK = {
  weak: 0,
  sufficient: 1,
  strong: 2
};

function strengthRank(value = 'weak') {
  return STRENGTH_RANK[value] ?? 0;
}

function verdictRank(value = null) {
  if (value === 'accepted' || value === 'answered') return 2;
  if (value === 'candidate') return 1;
  return 0;
}

export const comparisonHelperMethods = {
  _deriveBranchFamilySignature(seed = null, resolvedIntent = null, kbPluginId = null, goalSolverPluginId = null) {
    return [
      resolvedIntent?.decomposed?.act || resolvedIntent?.act || 'unknown',
      seed?.mode || 'direct',
      seed?.action || 'answer',
      kbPluginId || 'kb-auto',
      goalSolverPluginId || 'gs-auto'
    ].join('::');
  },

  _buildCandidateRecord({
    frameId,
    branchId,
    resultId,
    resultBody,
    familySignature,
    validationStatus,
    kbSufficient,
    selected = true,
    score = null,
    strength = null,
    branchIds = []
  }) {
    const resolvedStrength = strength || (
      validationStatus === 'accepted'
        ? (kbSufficient ? 'strong' : 'sufficient')
        : 'weak'
    );
    const resolvedScore = Number.isFinite(score)
      ? score
      : validationStatus === 'accepted'
        ? (kbSufficient ? 2 : 1)
        : 0;
    return {
      candidateId: `cand-${resultId || branchId}`,
      frameId,
      branchId,
      branchIds: [...(branchIds || []).filter(Boolean)],
      resultId,
      label: resultBody ? snipCandidateLabel(resultBody) : `candidate ${resultId || branchId}`,
      familySignature: familySignature || null,
      validationStatus: validationStatus || null,
      strength: resolvedStrength,
      score: resolvedScore,
      selected
    };
  },

  _summarizeExecutionFamily(branches = []) {
    return [...new Set((branches || []).map(branch => branch?.familySignature || null).filter(Boolean))]
      .sort()
      .join('|') || 'default';
  },

  _estimateResponseCoverage(responseMarkdown = '', intentCount = 1) {
    const text = String(responseMarkdown || '').trim();
    if (!text) return 0;
    const numbered = (text.match(/(?:^|\n)\s*\d+[\).\:-]\s+/g) || []).length;
    const bullets = (text.match(/(?:^|\n)\s*[-*]\s+/g) || []).length;
    const paragraphs = text.split(/\n{2,}/).map(part => part.trim()).filter(Boolean).length;
    const segments = Math.max(numbered, bullets, paragraphs, 1);
    return Math.min(Math.max(1, intentCount), segments);
  },

  _deriveOutcomeStrength(outcome = {}) {
    if (outcome.validationVerdict === 'rejected') return 'weak';
    if (outcome.goalResult?.status !== 'success') return 'weak';
    const intentCount = outcome.resolvedIntents?.length || 1;
    const coverage = this._estimateResponseCoverage(outcome.goalResult?.responseMarkdown || '', intentCount);
    if (outcome.kbSufficient && coverage >= Math.max(1, intentCount)) return 'strong';
    if (outcome.kbSufficient || coverage >= 1) return 'sufficient';
    return 'weak';
  },

  _meetsValidationFloor(outcome = {}, policy = null) {
    const floor = policy?.validationFloor || 'sufficient';
    return strengthRank(this._deriveOutcomeStrength(outcome)) >= strengthRank(floor);
  },

  _deriveOutcomeCriteria(outcome = {}, policy = null) {
    const intentCount = outcome.resolvedIntents?.length || 1;
    const coverage = this._estimateResponseCoverage(outcome.goalResult?.responseMarkdown || '', intentCount);
    const validationStrength = strengthRank(this._deriveOutcomeStrength(outcome));
    const robustness = (
      (outcome.goalResult?.status === 'success' ? 1 : 0) +
      (outcome.kbSufficient ? 1 : 0) +
      Math.min(1, Math.max(0, coverage - 1))
    );
    const cost = -(outcome.goalResult?.metadata?.llmCalls || 0);
    const diversity = Math.max(1, outcome.familyCount || 1);
    return {
      validation_strength: validationStrength,
      robustness,
      cost,
      diversity,
      coverage,
      floorMet: this._meetsValidationFloor(outcome, policy)
    };
  },

  _dominatesOutcome(left = {}, right = {}, policy = null) {
    const leftCriteria = this._deriveOutcomeCriteria(left, policy);
    const rightCriteria = this._deriveOutcomeCriteria(right, policy);
    const keys = ['validation_strength', 'robustness', 'cost', 'diversity'];
    let strictlyBetter = false;
    for (const key of keys) {
      if ((leftCriteria[key] ?? 0) < (rightCriteria[key] ?? 0)) {
        return false;
      }
      if ((leftCriteria[key] ?? 0) > (rightCriteria[key] ?? 0)) {
        strictlyBetter = true;
      }
    }
    return strictlyBetter;
  },

  _filterDominatedOutcomes(outcomes = [], policy = null) {
    return outcomes.filter((candidate, index) =>
      !outcomes.some((other, otherIndex) =>
        otherIndex !== index && this._dominatesOutcome(other, candidate, policy)
      )
    );
  },

  _scoreExecutionOutcome(outcome = {}, policy = null) {
    const response = outcome.goalResult?.responseMarkdown || '';
    const familyCount = outcome.familyCount || 1;
    const criteria = this._deriveOutcomeCriteria(outcome, policy);
    let score = 0;
    if (outcome.goalResult?.status === 'success') score += 20;
    if (outcome.kbSufficient) score += 25;
    score += criteria.validation_strength * 18;
    score += criteria.robustness * 10;
    score += criteria.coverage * 8;
    score += Math.min(12, Math.round(response.length / 80));
    score += familyCount * 3;
    if (criteria.floorMet) score += 6;
    if (policy?.validationFloor === 'strong' && outcome.kbSufficient) score += 4;
    return score;
  },

  _shouldContinueComparativeExploration(policy = null, successfulOutcomes = [], options = {}) {
    const level = policy?.level ?? 0;
    if (level <= 0) return false;
    const maxCandidates = Math.max(1, policy?.maxFrontier ?? 1);
    const remainingAttempts = Math.max(0, options.remainingAttempts ?? 0);
    const eligibleOutcomes = successfulOutcomes.filter(outcome => outcome?.goalResult?.status === 'success');
    const floorMetOutcomes = eligibleOutcomes.filter(outcome => this._meetsValidationFloor(outcome, policy));
    const familyCount = new Set(eligibleOutcomes.map(outcome => outcome.familyKey || 'default')).size;
    if (!eligibleOutcomes.length) return remainingAttempts > 0;
    if (eligibleOutcomes.length >= maxCandidates || remainingAttempts <= 0) return false;
    if (level === 1) {
      return floorMetOutcomes.length === 0
        || (eligibleOutcomes.length < Math.min(2, maxCandidates) && familyCount < 2);
    }
    const requiredFamilies = Math.max(1, policy?.minFamilies ?? 1);
    if (!floorMetOutcomes.length) return true;
    if (familyCount < requiredFamilies) return true;
    const configuredComparisons = Math.max(0, policy?.maxComparisons ?? 0);
    const requiredComparisons = configuredComparisons > 0
      ? Math.max(1, Math.min(configuredComparisons, Math.max(1, requiredFamilies) - 1 || 1))
      : 0;
    if (requiredComparisons > 0 && eligibleOutcomes.length <= requiredComparisons) return true;
    const nonDominated = this._filterDominatedOutcomes(floorMetOutcomes, policy);
    if (level >= 3) {
      return nonDominated.length > 1 && eligibleOutcomes.length < maxCandidates;
    }
    return false;
  },

  _selectComparativeOutcome(successfulOutcomes = [], policy = null) {
    if (!successfulOutcomes.length) return null;
    const eligibleOutcomes = successfulOutcomes.filter(outcome => outcome?.goalResult?.status === 'success');
    if (!eligibleOutcomes.length) return null;
    const floorMetOutcomes = eligibleOutcomes.filter(outcome => this._meetsValidationFloor(outcome, policy));
    const candidatePool = floorMetOutcomes.length ? floorMetOutcomes : eligibleOutcomes;
    const nonDominated = this._filterDominatedOutcomes(candidatePool, policy);
    return [...nonDominated].sort((left, right) => {
      const scoreDelta = this._scoreExecutionOutcome(right, policy) - this._scoreExecutionOutcome(left, policy);
      if (scoreDelta) return scoreDelta;
      const verdictDelta = verdictRank(right.validationVerdict) - verdictRank(left.validationVerdict);
      if (verdictDelta) return verdictDelta;
      const strengthDelta =
        strengthRank(this._deriveOutcomeStrength(right)) - strengthRank(this._deriveOutcomeStrength(left));
      if (strengthDelta) return strengthDelta;
      const familyDelta = (right.familyCount || 0) - (left.familyCount || 0);
      if (familyDelta) return familyDelta;
      const costDelta = (left.goalResult?.metadata?.llmCalls || 0) - (right.goalResult?.metadata?.llmCalls || 0);
      if (costDelta) return costDelta;
      return (left.order ?? 0) - (right.order ?? 0);
    })[0];
  },

  _buildComparisonState(candidateSet = [], policy = null, validationVerdict = null, validationReason = null) {
    const selectedCandidate = candidateSet.find(candidate => candidate.selected) || candidateSet[0] || null;
    const alternatives = candidateSet.filter(candidate => !candidate.selected);
    const maxComparisons = Math.max(0, policy?.maxComparisons ?? 0);
    const openComparisons = [];
    const challenges = [];
    if (selectedCandidate) {
      alternatives.slice(0, maxComparisons).forEach((candidate, index) => {
        const scoreDelta = (selectedCandidate.score ?? 0) - (candidate.score ?? 0);
        const selectedWins = scoreDelta >= 0;
        const decisive = scoreDelta >= 6;
        openComparisons.push({
          comparisonId: `${selectedCandidate.frameId || 'frame'}-cmp-${index + 1}`,
          label: `${selectedCandidate.label} vs ${candidate.label}`,
          status: decisive ? 'resolved' : 'open',
          candidateIds: [selectedCandidate.candidateId, candidate.candidateId],
          objectiveId: null,
          criterion: selectedWins ? 'validation-strength-and-coverage' : 'alternative-strength',
          summary: {
            selected: selectedCandidate.label,
            alternative: candidate.label,
            outcome: decisive
              ? (selectedWins
                ? 'selected candidate retained the stronger composite score'
                : 'alternative remained competitive')
              : 'comparison remains open because the candidates stayed close'
          }
        });
        challenges.push({
          challengeId: `${selectedCandidate.frameId || 'frame'}-challenge-${index + 1}`,
          label: `Stress-test ${selectedCandidate.label}`,
          status: selectedWins && decisive ? 'resolved' : 'open',
          targetId: selectedCandidate.candidateId,
          kind: 'discriminative-followup',
          severity: selectedWins && decisive ? 'medium' : 'high',
          prompt: selectedWins && decisive
            ? `Confirm why ${selectedCandidate.label} outranked ${candidate.label}.`
            : `Collect evidence that separates ${selectedCandidate.label} from ${candidate.label}.`
        });
      });
    }

    const resolvedDifferences = candidateSet.map(candidate => ({
      candidateId: candidate.candidateId,
      familySignature: candidate.familySignature || null,
      verdict: candidate.selected ? 'selected' : 'alternative',
      score: candidate.score ?? null
    }));

    const openQuestions = [];
    if ((policy?.level ?? 0) >= 2) {
      const familyCount = new Set(candidateSet.map(candidate => candidate.familySignature || 'default')).size;
      if (familyCount < Math.max(1, policy?.minFamilies ?? 1)) {
        openQuestions.push('Comparative closure completed before reaching the preferred family coverage.');
      }
    }
    if (candidateSet.some(candidate => candidate.validationStatus === 'rejected')) {
      openQuestions.push('One or more competitive candidates were rejected by validation and removed from final selection.');
    }
    if (alternatives.some(candidate => (candidate.score ?? 0) >= ((selectedCandidate?.score ?? 0) - 6))) {
      openQuestions.push('At least one alternative stayed competitive and may justify more discriminative evidence gathering.');
    }
    if (validationVerdict && validationVerdict !== 'accepted') {
      openQuestions.push(validationReason || 'Selected candidate did not reach the requested validation floor.');
    }

    return {
      openComparisons,
      resolvedDifferences,
      openQuestions,
      challenges
    };
  }
};
