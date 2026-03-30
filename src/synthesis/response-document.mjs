function hasEvidence(resolvedIntent) {
  return (
    (resolvedIntent.currentTurnContextUnits || []).length > 0 ||
    (resolvedIntent.sessionUnits || []).length > 0 ||
    (resolvedIntent.kbUnits || []).length > 0
  );
}

export function extractGroupAnswerBlocks(markdown) {
  const blocks = {};
  const groupPattern = /## Intent Group (\d+)[\s\S]*?(?=## Intent Group \d+|$)/g;
  let match;
  while ((match = groupPattern.exec(markdown)) !== null) {
    const ref = parseInt(match[1], 10);
    const answerMatch = match[0].match(/### Answer\n([\s\S]*?)(?=###|$)/);
    blocks[ref] = answerMatch ? answerMatch[1].trim() : null;
  }
  return blocks;
}

export function buildResponseDocument(
  sessionId,
  resolvedIntents,
  pluginOutputs = [],
  answersByIntentRef = {}
) {
  return {
    sessionId,
    groups: (resolvedIntents || []).map(resolvedIntent => {
      const pluginOutput = pluginOutputs.find(output => output.intentRef === resolvedIntent.intentRef);
      const status = pluginOutput?.status === 'error'
        ? 'plugin-error'
        : hasEvidence(resolvedIntent)
          ? 'answered'
          : 'no-context';
      return {
        intentRef: resolvedIntent.intentRef,
        act: resolvedIntent.decomposed.act,
        intent: resolvedIntent.decomposed.intent,
        status,
        currentTurnContext: resolvedIntent.currentTurnContextUnits,
        sessionSources: resolvedIntent.sessionUnits.map(source => ({
          unitId: source.unitId,
          score: source.score,
          unit: source.unit
        })),
        kbSources: resolvedIntent.kbUnits.map(source => ({
          sourceId: source.unit?.sourceId,
          unitId: source.unitId,
          score: source.score,
          unit: source.unit
        })),
        pluginOutput: pluginOutput || null,
        answerMarkdown: answersByIntentRef[resolvedIntent.intentRef] || null,
        warnings: pluginOutput?.status === 'error'
          ? [`Plugin error: ${pluginOutput.error?.message || 'unknown'}`]
          : []
      };
    })
  };
}
