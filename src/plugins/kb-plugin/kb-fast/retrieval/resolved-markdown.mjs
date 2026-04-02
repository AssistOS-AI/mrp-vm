export function renderResolvedIntentMarkdown(decomposed, currentTurnUnits, sessionUnits, kbUnits, guidanceUnits = null) {
  let md = `## Resolved Intent Group ${decomposed.groupNumber}\n`;
  md += `Act: ${decomposed.act}\n`;
  md += `Intent: ${decomposed.intent}\n`;
  md += `Output: ${decomposed.outputType}\n\n`;
  if (currentTurnUnits?.length > 0) {
    md += '### Current-Turn Context\n';
    for (const unit of currentTurnUnits) {
      md += `#### ${unit.id}\nRole: ${unit.role}\nClaim: ${unit.claim || unit.procedure || ''}\n\n`;
    }
  }
  if (sessionUnits.length > 0) {
    md += '### Session Context\n';
    for (const source of sessionUnits) {
      md += `#### ${source.unitId} (score: ${source.score.toFixed(2)})\nRole: ${source.unit?.role || ''}\nClaim: ${source.unit?.claim || source.unit?.procedure || ''}\n`;
      if (source.notes?.length) md += `Notes: ${source.notes.join(' | ')}\n`;
      md += '\n';
    }
  }
  if (kbUnits.length > 0) {
    md += '### Persistent KB Context\n';
    for (const source of kbUnits) {
      md += `#### ${source.unitId} (score: ${source.score.toFixed(2)})\nRole: ${source.unit?.role || ''}\nSource: ${source.unit?.sourceId || ''}\nClaim: ${source.unit?.claim || source.unit?.procedure || ''}\n`;
      if (source.notes?.length) md += `Notes: ${source.notes.join(' | ')}\n`;
      md += '\n';
    }
  }
  const guidanceSections = [
    ['Planner Guidance', guidanceUnits?.planner || []],
    ['Goal Solver Guidance', guidanceUnits?.goalSolver || []],
    ['Decomposition Guidance', guidanceUnits?.decomposition || []],
    ['Validation Guidance', guidanceUnits?.validation || []]
  ];
  for (const [label, entries] of guidanceSections) {
    if (!entries.length) continue;
    md += `### ${label}\n`;
    for (const entry of entries) {
      md += `#### ${entry.unitId} (${entry.store})\nRole: ${entry.unit?.role || ''}\nClaim: ${entry.unit?.claim || entry.unit?.procedure || ''}\n\n`;
    }
  }
  return md;
}
