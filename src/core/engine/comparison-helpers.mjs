function snipCandidateLabel(text, max = 80) {
  const normalized = String(text || '').replace(/\s+/g, ' ').trim();
  if (!normalized) return 'candidate';
  return normalized.length <= max ? normalized : `${normalized.slice(0, max)}…`;
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

  _scoreExecutionOutcome(outcome = {}, policy = null) {
    const response = outcome.goalResult?.responseMarkdown || '';
    const intentCount = outcome.resolvedIntents?.length || 1;
    const coverage = this._estimateResponseCoverage(response, intentCount);
    const familyCount = outcome.familyCount || 1;
    let score = 0;
    if (outcome.goalResult?.status === 'success') score += 20;
    if (outcome.kbSufficient) score += 25;
    score += coverage * 8;
    score += Math.min(12, Math.round(response.length / 80));
    score += familyCount * 3;
    if (policy?.validationFloor === 'strong' && outcome.kbSufficient) score += 4;
    return score;
  },

  _shouldContinueComparativeExploration(policy = null, successfulOutcomes = []) {
    const level = policy?.level ?? 0;
    if (level <= 0) return false;
    const maxCandidates = Math.max(
      1,
      Math.min(policy?.maxFrontier ?? 1, (policy?.maxComparisons ?? 0) + 1)
    );
    const familyCount = new Set(successfulOutcomes.map(outcome => outcome.familyKey)).size;
    if (successfulOutcomes.length >= maxCandidates) return false;
    if (level === 1) {
      return successfulOutcomes.length < Math.min(2, maxCandidates) && familyCount < 2;
    }
    if (familyCount < Math.max(1, policy?.minFamilies ?? 1)) return true;
    if (level >= 3) {
      return successfulOutcomes.length < Math.min(maxCandidates, Math.max(2, policy?.minFamilies ?? 2));
    }
    return false;
  },

  _selectComparativeOutcome(successfulOutcomes = [], policy = null) {
    if (!successfulOutcomes.length) return null;
    return [...successfulOutcomes].sort((left, right) => {
      const scoreDelta = this._scoreExecutionOutcome(right, policy) - this._scoreExecutionOutcome(left, policy);
      if (scoreDelta) return scoreDelta;
      const familyDelta = (right.familyCount || 0) - (left.familyCount || 0);
      if (familyDelta) return familyDelta;
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
        const selectedWins = (selectedCandidate.score ?? 0) >= (candidate.score ?? 0);
        openComparisons.push({
          comparisonId: `${selectedCandidate.frameId || 'frame'}-cmp-${index + 1}`,
          label: `${selectedCandidate.label} vs ${candidate.label}`,
          status: 'resolved',
          candidateIds: [selectedCandidate.candidateId, candidate.candidateId],
          objectiveId: null,
          criterion: selectedWins ? 'evidence-and-coverage' : 'alternative-strength',
          summary: {
            selected: selectedCandidate.label,
            alternative: candidate.label,
            outcome: selectedWins
              ? 'selected candidate retained the stronger composite score'
              : 'alternative remained competitive'
          }
        });
        challenges.push({
          challengeId: `${selectedCandidate.frameId || 'frame'}-challenge-${index + 1}`,
          label: `Stress-test ${selectedCandidate.label}`,
          status: selectedWins ? 'resolved' : 'open',
          targetId: selectedCandidate.candidateId,
          kind: 'discriminative-followup',
          severity: selectedWins ? 'medium' : 'high',
          prompt: selectedWins
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
