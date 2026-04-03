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
  purpose = null
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
  evidenceProfileHash = null
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
    evidenceProfileHash
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

