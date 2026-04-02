function firstNonEmpty(values = []) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

function buildPrompt(resolvedIntent = {}) {
  const decomposed = resolvedIntent.decomposed || {};
  const intentGroup = resolvedIntent.intentGroup || {};
  const act = firstNonEmpty([decomposed.act, intentGroup.act]) || 'resolve';
  const intent = firstNonEmpty([decomposed.intent, intentGroup.intent]) || '';
  const output = firstNonEmpty([decomposed.outputType, intentGroup.output]);
  const promptLines = [`[${act}] ${intent}`.trim()];
  if (output) promptLines.push(`Expected output: ${output}`);
  return promptLines.join('\n').trim();
}

function buildContextText(unit = {}, extras = {}) {
  const lines = [];
  if (unit.role) lines.push(`Role: ${unit.role}`);
  if (unit.topic) lines.push(`Topic: ${unit.topic}`);
  if (unit.claim) lines.push(`Claim: ${unit.claim}`);
  if (unit.procedure) lines.push(`Procedure: ${unit.procedure}`);
  if (unit.condition) lines.push(`Condition: ${unit.condition}`);
  if (unit.utilityActs?.length) lines.push(`UtilityActs: ${unit.utilityActs.join(', ')}`);
  if (unit.utilityNote) lines.push(`UtilityNote: ${unit.utilityNote}`);
  if (Number.isFinite(extras.score)) lines.push(`Score: ${extras.score.toFixed(4)}`);
  if (lines.length === 0) {
    lines.push(
      firstNonEmpty([unit.textBody, unit.claim, unit.procedure, unit.topic]) ||
      '(empty context unit)'
    );
  }
  return lines.join('\n');
}

function pushContextItem(target, seen, {
  title,
  sourceLink,
  text
}) {
  const normalized = {
    title: title || 'context-unit',
    sourceLink: sourceLink || 'unknown',
    text: text || '(empty context unit)'
  };
  const dedupeKey = `${normalized.sourceLink}::${normalized.title}::${normalized.text}`;
  if (seen.has(dedupeKey)) return;
  seen.add(dedupeKey);
  target.push(normalized);
}

function ingestEvidenceUnits(context, seen, resolvedIntent = {}) {
  for (const unit of resolvedIntent.currentTurnContextUnits || []) {
    pushContextItem(context, seen, {
      title: unit.id || 'current-turn',
      sourceLink: 'current-turn',
      text: buildContextText(unit)
    });
  }

  for (const entry of resolvedIntent.sessionUnits || []) {
    const unit = entry.unit || {};
    pushContextItem(context, seen, {
      title: entry.unitId || unit.id || 'session-unit',
      sourceLink: unit.sourceId || 'session',
      text: buildContextText(unit, { score: entry.score })
    });
  }

  for (const entry of resolvedIntent.kbUnits || []) {
    const unit = entry.unit || {};
    pushContextItem(context, seen, {
      title: entry.unitId || unit.id || 'kb-unit',
      sourceLink: unit.sourceId || 'kb',
      text: buildContextText(unit, { score: entry.score })
    });
  }
}

function ingestGuidanceUnits(context, seen, resolvedIntent = {}) {
  const guidance = resolvedIntent.guidanceUnits || {};
  for (const [scope, entries] of Object.entries(guidance)) {
    for (const entry of entries || []) {
      const unit = entry.unit || {};
      const store = entry.store || 'guidance';
      pushContextItem(context, seen, {
        title: entry.unitId || unit.id || `${scope}-guidance`,
        sourceLink: `guidance:${scope}:${store}`,
        text: buildContextText(unit, { score: entry.score })
      });
    }
  }
}

export function buildResolvedIntentPayload(resolvedIntent = {}) {
  const context = [];
  const seen = new Set();
  ingestEvidenceUnits(context, seen, resolvedIntent);
  ingestGuidanceUnits(context, seen, resolvedIntent);
  return {
    prompt: buildPrompt(resolvedIntent),
    context
  };
}

export function renderResolvedIntentPayloadMarkdown(resolvedIntent = {}) {
  const payload = buildResolvedIntentPayload(resolvedIntent);
  const lines = [
    '## Prompt',
    payload.prompt || '(empty prompt)',
    '',
    '## Context'
  ];
  if (!payload.context.length) {
    lines.push('(no context units)');
  } else {
    for (const item of payload.context) {
      lines.push(`### ${item.title}`);
      lines.push(`Source: ${item.sourceLink}`);
      lines.push(item.text);
      lines.push('');
    }
  }
  return lines.join('\n').trim();
}

