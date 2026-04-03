// DS017 — Answer Synthesis
import { SDKError } from '../platform/errors.mjs';
import { buildResponseDocument } from './response-document.mjs';

export class AnswerSynthesizer {
  constructor(modeRegistry, config = {}) {
    this.modeRegistry = modeRegistry;
    this.config = config;
  }

  async synthesize(
    sessionId,
    resolvedIntents,
    pluginOutputs,
    systemPrompt,
    mode,
    requestedModel = null,
    guidanceUnits = [],
    options = {}
  ) {
    const hasEvidence = resolvedIntents.some(ri =>
      ri.currentTurnContextUnits.length > 0 || ri.sessionUnits.length > 0 || ri.kbUnits.length > 0
    );
    if (!hasEvidence && !pluginOutputs?.some(p => p.status === 'success')) {
      return this._renderNoContext(sessionId, resolvedIntents, pluginOutputs);
    }
    try {
      const result = await mode.synthesizeResponse({
        sessionId,
        resolvedIntents,
        pluginOutputs,
        systemPrompt,
        requestedModel,
        guidanceUnits,
        ...options
      });
      return {
        status: result.status || 'answered',
        responseDocument: result.responseDocument,
        responseMarkdown: result.responseMarkdown
      };
    } catch (e) {
      throw new SDKError('SYNTHESIS_FAILED', 'synthesis', e.message);
    }
  }

  _renderNoContext(sessionId, resolvedIntents, pluginOutputs) {
    let md = `# MRP Response\nSession: ${sessionId}\n\n`;
    const answersByIntentRef = {};
    for (const ri of resolvedIntents) {
      const po = (pluginOutputs || []).find(p => p.intentRef === ri.intentRef);
      const status = po?.status === 'error' ? 'plugin-error' : 'no-context';
      const groupMd = status === 'no-context'
        ? 'The session context and persistent KB do not contain enough evidence to answer this intent.'
        : `Plugin execution failed: ${po?.error?.message || 'unknown error'}`;
      answersByIntentRef[ri.intentRef] = groupMd;
      md += `## Intent Group ${ri.intentRef}\nAct: ${ri.decomposed.act}\nIntent: ${ri.decomposed.intent}\nStatus: ${status}\n\n### Answer\n${groupMd}\n\n### Sources Used\n(none)\n\n`;
    }
    return {
      status: 'no-context',
      responseDocument: buildResponseDocument(
        sessionId,
        resolvedIntents,
        pluginOutputs,
        answersByIntentRef
      ),
      responseMarkdown: md
    };
  }
}
