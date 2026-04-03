function buildSyntheticResolvedIntent(intentGroup, decomposed) {
  return {
    intentRef: intentGroup.groupNumber,
    intentGroup: {
      groupNumber: intentGroup.groupNumber,
      act: intentGroup.act,
      intent: intentGroup.intent,
      output: intentGroup.output
    },
    decomposed,
    currentTurnContextUnits: [],
    sessionUnits: [],
    kbUnits: [],
    retrievalTrace: {},
    guidanceUnits: {}
  };
}

export function deriveIndependentIntentBatches(seedDetails = [], intentGroups = [], decomposedIntents = []) {
  if ((seedDetails || []).length < 2 || (decomposedIntents || []).length < 2) return [];
  const activeSeeds = (seedDetails || [])
    .filter(seed => !seed?.status || seed.status === 'active');
  if (activeSeeds.length < 2) return [];
  if (activeSeeds.some(seed => seed.splitFrom)) return [];

  const groupByNumber = new Map((intentGroups || []).map(group => [group.groupNumber, group]));
  const decomposedByNumber = new Map((decomposedIntents || []).map(decomposed => [decomposed.groupNumber, decomposed]));
  const batches = activeSeeds
    .map(seed => {
      const intentRef = seed.intentGroupNumber;
      const intentGroup = groupByNumber.get(intentRef);
      const decomposed = decomposedByNumber.get(intentRef);
      if (!intentGroup || !decomposed) return null;
      return {
        seedId: seed.seedId,
        intentRef,
        intentGroup,
        decomposed,
        resolvedIntents: [buildSyntheticResolvedIntent(intentGroup, decomposed)]
      };
    })
    .filter(Boolean)
    .sort((left, right) => left.intentRef - right.intentRef);

  return batches.length > 1 ? batches : [];
}

export async function runWithConcurrency(items = [], concurrency = 1, worker) {
  const limit = Math.max(1, Number.parseInt(concurrency, 10) || 1);
  const results = new Array(items.length);
  let nextIndex = 0;

  async function runWorker() {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await worker(items[currentIndex], currentIndex);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => runWorker())
  );
  return results;
}

function firstGroup(goalResult = null) {
  return goalResult?.responseDocument?.groups?.[0] || null;
}

function summarizeSourceIds(group = null) {
  const ids = [];
  for (const unit of group?.currentTurnContext || []) ids.push(unit.id || unit.unitId || null);
  for (const source of group?.sessionSources || []) ids.push(source.unitId || null);
  for (const source of group?.kbSources || []) ids.push(source.unitId || null);
  return ids.filter(Boolean);
}

export function mergeFrontierResults(sessionId, batches = [], frontierResults = []) {
  const resultByIntentRef = new Map(frontierResults.map(result => [result.intentRef, result]));
  const groups = [];
  const answers = [];
  const resolvedIntentsForValidation = [];
  const selectedBranchIds = [];
  const kbPluginCounts = new Map();
  const goalSolverCounts = new Map();
  let allNoContext = true;
  let allSufficient = true;

  const bump = (map, value) => {
    if (!value) return;
    map.set(value, (map.get(value) || 0) + 1);
  };

  for (const batch of batches) {
    const item = resultByIntentRef.get(batch.intentRef) || null;
    const childResult = item?.childResult || null;
    const goalResult = childResult?.goalResult || null;
    const group = firstGroup(goalResult);
    const status = group?.status
      || (goalResult?.status === 'no-context' ? 'no-context' : goalResult ? 'answered' : 'plugin-error');
    const answerMarkdown = group?.answerMarkdown
      || goalResult?.responseMarkdown
      || (status === 'no-context'
        ? 'The session context and persistent KB do not contain enough evidence to answer this intent.'
        : 'Plugin execution failed.');
    const currentTurnContext = [...(group?.currentTurnContext || [])];
    const sessionSources = [...(group?.sessionSources || [])];
    const kbSources = [...(group?.kbSources || [])];
    const warnings = [...(group?.warnings || [])];

    if (status !== 'no-context') allNoContext = false;
    if (!childResult?.kbSufficient) allSufficient = false;
    selectedBranchIds.push(...(childResult?.selectedBranchIds || []));
    bump(kbPluginCounts, childResult?.selectedKBPlugin);
    bump(goalSolverCounts, childResult?.selectedGoalSolverPlugin);

    groups.push({
      intentRef: batch.intentRef,
      act: batch.decomposed.act,
      intent: batch.decomposed.intent,
      status,
      currentTurnContext,
      sessionSources,
      kbSources,
      pluginOutput: group?.pluginOutput || null,
      answerMarkdown,
      warnings
    });

    resolvedIntentsForValidation.push({
      ...batch.resolvedIntents[0],
      currentTurnContextUnits: currentTurnContext,
      sessionUnits: sessionSources.map(source => ({
        unitId: source.unitId,
        score: source.score,
        unit: source.unit
      })),
      kbUnits: kbSources.map(source => ({
        sourceId: source.sourceId,
        unitId: source.unitId,
        score: source.score,
        unit: source.unit
      }))
    });

    answers.push([
      `## Intent Group ${batch.intentRef}`,
      `Act: ${batch.decomposed.act}`,
      `Intent: ${batch.decomposed.intent}`,
      `Status: ${status}`,
      '',
      '### Answer',
      answerMarkdown,
      '',
      '### Sources Used',
      summarizeSourceIds({
        currentTurnContext,
        sessionSources,
        kbSources
      }).map(sourceId => `- ${sourceId}`).join('\n') || '(none)',
      ''
    ].join('\n'));
  }

  const dominantPlugin = map => [...map.entries()]
    .sort((left, right) => right[1] - left[1] || String(left[0]).localeCompare(String(right[0])))[0]?.[0] || null;

  return {
    goalResult: {
      status: allNoContext ? 'no-context' : 'success',
      responseMarkdown: `# MRP Response\nSession: ${sessionId}\n\n${answers.join('\n')}`.trim(),
      responseDocument: {
        sessionId,
        groups
      }
    },
    resolvedIntentsForValidation,
    selectedBranchIds,
    selectedKBPlugin: dominantPlugin(kbPluginCounts),
    selectedGoalSolverPlugin: dominantPlugin(goalSolverCounts),
    kbSufficient: allSufficient,
    frontierSize: batches.length
  };
}
