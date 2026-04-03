const DELIBERATION_DEFAULTS = {
  0: {
    closureMode: 'first-valid',
    maxFrontier: 1,
    minFamilies: 1,
    maxComparisons: 0,
    validationFloor: 'sufficient'
  },
  1: {
    closureMode: 'best-effort',
    maxFrontier: 2,
    minFamilies: 1,
    maxComparisons: 1,
    validationFloor: 'sufficient'
  },
  2: {
    closureMode: 'comparative',
    maxFrontier: 4,
    minFamilies: 2,
    maxComparisons: 2,
    validationFloor: 'sufficient'
  },
  3: {
    closureMode: 'comparative',
    maxFrontier: 6,
    minFamilies: 2,
    maxComparisons: 4,
    validationFloor: 'strong'
  }
};

export function normalizeDeliberationLevel(value, fallback = 0) {
  const numeric = Number.parseInt(value, 10);
  if (!Number.isFinite(numeric)) return Math.max(0, Math.min(3, fallback));
  return Math.max(0, Math.min(3, numeric));
}

export function createDeliberationPolicy(policy = {}, parentPolicy = null) {
  const parentLevel = parentPolicy?.level ?? 0;
  const level = normalizeDeliberationLevel(policy.level, parentLevel);
  const defaults = DELIBERATION_DEFAULTS[level] || DELIBERATION_DEFAULTS[0];
  const maxFrontier = Math.max(1, Number.parseInt(policy.maxFrontier ?? defaults.maxFrontier, 10) || defaults.maxFrontier);
  const minFamilies = Math.max(1, Number.parseInt(policy.minFamilies ?? defaults.minFamilies, 10) || defaults.minFamilies);
  const maxComparisons = Math.max(0, Number.parseInt(policy.maxComparisons ?? defaults.maxComparisons, 10) || defaults.maxComparisons);
  return {
    level,
    closureMode: policy.closureMode || defaults.closureMode,
    maxFrontier,
    minFamilies: Math.min(minFamilies, maxFrontier),
    maxComparisons,
    validationFloor: policy.validationFloor || defaults.validationFloor,
    inheritedLevel: parentPolicy?.level ?? null
  };
}

function cloneComparisonState(state = {}) {
  return {
    openComparisons: [...(state.openComparisons || [])],
    resolvedDifferences: [...(state.resolvedDifferences || [])],
    openQuestions: [...(state.openQuestions || [])],
    challenges: [...(state.challenges || [])]
  };
}

export function createExecutionFrame({
  frameId,
  parentFrameId = null,
  requestId,
  depth = 0,
  maxDepth = 0,
  status = 'active',
  seedDetails = [],
  budgets = {},
  localState = {},
  purpose = null,
  deliberationPolicy = null,
  candidateSet = [],
  explorationFrontier = [],
  suspendedSet = [],
  comparisonState = {},
  branchFamilies = {},
  deliberationStatus = null
}) {
  return {
    frameId,
    parentFrameId,
    requestId,
    depth,
    maxDepth,
    status,
    purpose,
    seedIds: (seedDetails || []).map(seed => seed.seedId),
    seedDetails: [...(seedDetails || [])],
    activeBranchIds: [],
    completedBranchIds: [],
    failureMemory: [],
    deliberationPolicy: createDeliberationPolicy(deliberationPolicy || {}),
    candidateSet: [...(candidateSet || [])],
    explorationFrontier: [...(explorationFrontier || [])],
    suspendedSet: [...(suspendedSet || [])],
    comparisonState: cloneComparisonState(comparisonState),
    branchFamilies: { ...(branchFamilies || {}) },
    deliberationStatus: deliberationStatus || 'idle',
    localState: {
      intents: [...(localState.intents || [])],
      currentTurnKUs: [...(localState.currentTurnKUs || [])],
      retrievedKUs: [...(localState.retrievedKUs || [])],
      partialResults: [...(localState.partialResults || [])],
      plan: localState.plan || null
    },
    budgets: {
      remainingLLMCalls: budgets.remainingLLMCalls ?? 0,
      remainingTimeMs: budgets.remainingTimeMs ?? null
    }
  };
}

export function createBranchAttempt({
  branchId,
  frameId,
  intentId,
  seedId,
  pluginId,
  kbPluginId = null,
  plannerPluginId = null,
  validationId = null,
  status = 'queued',
  resultId = null,
  stageTraceIndex = null,
  error = null,
  outputPreview = null,
  evidenceProfileHash = null,
  familySignature = null
}) {
  return {
    branchId,
    frameId,
    intentId,
    seedId,
    pluginId,
    kbPluginId,
    plannerPluginId,
    validationId,
    status,
    resultId,
    stageTraceIndex,
    error,
    outputPreview,
    evidenceProfileHash,
    familySignature
  };
}

export function createTraceResult({
  resultId,
  frameId,
  branchId,
  kind = 'answer',
  validationStatus = null,
  preservesConstraints = null,
  structuralComplete = null,
  body = null,
  supportIds = []
}) {
  return {
    resultId,
    frameId,
    branchId,
    kind,
    validationStatus,
    preservesConstraints,
    structuralComplete,
    body,
    supportIds: [...(supportIds || [])]
  };
}

export function createTraceFailure({
  failureId,
  frameId,
  branchId,
  seedId,
  pluginId,
  reason,
  error = null,
  evidenceProfileHash = null
}) {
  return {
    failureId,
    frameId,
    branchId,
    seedId,
    pluginId,
    reason,
    error,
    evidenceProfileHash
  };
}
