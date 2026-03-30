export function renderResolvedIntentMarkdown(decomposed, currentTurnUnits, sessionUnits, kbUnits) {
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
  return md;
}
