// DS017 — Answer Synthesis
import { MRPError } from '../lib/errors.mjs';

export class AnswerSynthesizer {
  constructor(strategyRegistry, config = {}) {
    this.strategyRegistry = strategyRegistry;
    this.config = config;
  }

  async synthesize(sessionId, resolvedIntents, pluginOutputs, systemPrompt, strategy, requestedModel = null) {
    const hasEvidence = resolvedIntents.some(ri =>
      ri.currentTurnContextUnits.length > 0 || ri.sessionUnits.length > 0 || ri.kbUnits.length > 0
    );
    if (!hasEvidence && !pluginOutputs?.some(p => p.status === 'success')) {
      return this._renderNoContext(sessionId, resolvedIntents, pluginOutputs);
    }
    try {
      const result = await strategy.synthesizeResponse({
        sessionId, resolvedIntents, pluginOutputs, systemPrompt, requestedModel
      });
      return result;
    } catch (e) {
      throw new MRPError('SYNTHESIS_FAILED', 'synthesis', e.message);
    }
  }

  _renderNoContext(sessionId, resolvedIntents, pluginOutputs) {
    let md = `# MRP Response\nSession: ${sessionId}\n\n`;
    const groups = [];
    for (const ri of resolvedIntents) {
      const po = (pluginOutputs || []).find(p => p.intentRef === ri.intentRef);
      const status = po?.status === 'error' ? 'plugin-error' : 'no-context';
      const groupMd = status === 'no-context'
        ? 'The session context and persistent KB do not contain enough evidence to answer this intent.'
        : `Plugin execution failed: ${po?.error?.message || 'unknown error'}`;
      md += `## Intent Group ${ri.intentRef}\nAct: ${ri.decomposed.act}\nIntent: ${ri.decomposed.intent}\nStatus: ${status}\n\n### Answer\n${groupMd}\n\n### Sources Used\n(none)\n\n`;
      groups.push({
        intentRef: ri.intentRef, act: ri.decomposed.act, intent: ri.decomposed.intent,
        status, currentTurnContext: [], sessionSources: [], kbSources: [],
        pluginOutput: po || null, answerMarkdown: groupMd,
        warnings: po?.status === 'error' ? [`Plugin error: ${po.error?.message}`] : []
      });
    }
    return { responseDocument: { sessionId, groups }, responseMarkdown: md };
  }
}
