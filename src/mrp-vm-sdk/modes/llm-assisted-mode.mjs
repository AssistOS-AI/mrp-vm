// Legacy compatibility bundle for the LLM-backed helper set.
// Active built-in plugin wiring consumes explicit helper adapters from
// seed-detection/, context-normalization/, and response-rendering/.
import { LanguageProcessingMode } from './registry.mjs';
import { buildResponseDocument, extractGroupAnswerBlocks } from '../synthesis/response-document.mjs';
import { renderResolvedIntentPayloadMarkdown } from '../synthesis/resolved-intent-payload.mjs';

const DEFAULT_SEED_BUNDLE_PROMPT = [
  'You are a seed detection engine.',
  'Extract both problem seeds and current-turn Knowledge Units in one pass.',
  'Output raw text only with the exact sections `# Intent CNL` and `# Session Context CNL`.'
].join(' ');

const DEFAULT_CONTEXT_PROMPT = [
  'You are a knowledge normalization engine.',
  'Transform the input chunk into valid SOP KU control statements.',
  'Output raw SOP only.'
].join(' ');

const DEFAULT_SYNTHESIS_PROMPT = [
  'You are an answer synthesis engine.',
  'Produce grounded Markdown answers per intent group from the evidence provided.',
  'Output raw Markdown only.'
].join(' ');

function stripFences(text) {
  if (!text) return text;
  return text.replace(/^```(?:markdown|json)?\s*\n?/gm, '').replace(/\n?```\s*$/gm, '').trim();
}

function splitSeedBundle(text) {
  const normalized = stripFences(text || '');
  const match = normalized.match(/^# Intent CNL\s*\n([\s\S]*?)\n# Session Context CNL\s*\n?([\s\S]*)$/);
  if (!match) {
    throw new Error('Invalid seed bundle format');
  }
  return {
    intentCNL: match[1].trim(),
    currentTurnContextCNL: match[2].trim()
  };
}

export class LLMAssistedMode extends LanguageProcessingMode {
  constructor(llmBridge) {
    super();
    this.llm = llmBridge;
  }

  getId() { return 'llm-assisted'; }
  usesLLM() { return true; }
  supportsModelOverride() { return true; }
  getCapabilities() {
    return ['detect-seeds', 'normalize-persistent-context', 'synthesize-response'];
  }

  async detectSeedBundle({ rawNL, history, systemPrompt, requestedModel, prompts = {} }) {
    const prompt = prompts.detectSeedBundle || DEFAULT_SEED_BUNDLE_PROMPT;
    const historyText = (history || []).map(m => `${m.role}: ${m.content}`).join('\n');
    const stableHistory = historyText
      .replace(/sess-[a-f0-9-]+/g, 'sess-REF')
      .replace(/src-[a-f0-9]+/g, 'src-REF')
      .replace(/req-[a-f0-9]+/g, 'req-REF');
    const userMsg = [
      systemPrompt ? `System instructions: ${systemPrompt}` : null,
      stableHistory ? `Conversation history:\n${stableHistory}` : null,
      `Current request:\n${rawNL}`
    ].filter(Boolean).join('\n\n');
    const result = await this.llm.callWithRetry(prompt, userMsg, {
      model: requestedModel,
      operation: 'detect-seeds'
    });
    return splitSeedBundle(result);
  }

  async normalizeIntent({ rawNL, history, systemPrompt, requestedModel, prompts = {} }) {
    const result = await this.detectSeedBundle({ rawNL, history, systemPrompt, requestedModel, prompts });
    return { intentCNL: result.intentCNL };
  }

  async extractSessionContext({ rawNL, systemPrompt, requestedModel, prompts = {} }) {
    const result = await this.detectSeedBundle({ rawNL, history: [], systemPrompt, requestedModel, prompts });
    return { contextCNL: result.currentTurnContextCNL };
  }

  async normalizePersistentContext({ chunkText, provenance, requestedModel, systemPrompt, prompts = {} }) {
    const prompt = prompts.normalizePersistentContext || DEFAULT_CONTEXT_PROMPT;
    const stableSource = provenance.sourceName || 'source';
    const stableChunk = `chunk-${provenance.chunkIndex ?? 0}`;
    const userMsg = `${systemPrompt ? `${systemPrompt}\n\n` : ''}Source: ${stableSource}\nChunk: ${stableChunk}\nChunk index: ${provenance.chunkIndex}\n\nText:\n${chunkText}`;
    const result = await this.llm.callWithRetry(prompt, userMsg, {
      model: requestedModel,
      operation: 'normalize-persistent-context'
    });
    return { contextCNL: result };
  }

  async synthesizeResponse({ sessionId, resolvedIntents, pluginOutputs, systemPrompt, requestedModel, guidanceUnits = [], prompts = {} }) {
    const prompt = prompts.synthesizeResponse || DEFAULT_SYNTHESIS_PROMPT;
    let evidenceDoc = '';
    for (const ri of resolvedIntents) {
      const resolvedMarkdown = renderResolvedIntentPayloadMarkdown(ri);
      evidenceDoc += resolvedMarkdown
        .replace(/src-[a-f0-9]+/g, 'src-REF')
        .replace(/sess-[a-f0-9-]+/g, 'sess-REF') + '\n\n';
      const po = (pluginOutputs || []).find(p => p.intentRef === ri.intentRef);
      if (po && po.status === 'success') {
        evidenceDoc += `### Plugin Evidence\nPlugin: ${po.pluginName}\nConfidence: ${po.confidence}\nResult: ${po.resultCNL}\n\n`;
      }
    }
    const guidanceDoc = guidanceUnits.length > 0
      ? `## Goal-Solver Guidance\n${guidanceUnits.map(entry =>
        `- (${entry.store}) ${entry.unit?.claim || entry.unit?.procedure || ''}`
          .replace(/src-[a-f0-9]+/g, 'src-REF')
          .replace(/sess-[a-f0-9-]+/g, 'sess-REF')
      ).join('\n')}\n\n`
      : '';
    const userMsg = `${systemPrompt ? `System instructions: ${systemPrompt}\n\n` : ''}${guidanceDoc}${evidenceDoc}`;
    let result = await this.llm.callWithRetry(prompt, userMsg, {
      model: requestedModel,
      operation: 'synthesize-response'
    });
    result = stripFences(result);
    const responseDocument = buildResponseDocument(
      sessionId,
      resolvedIntents,
      pluginOutputs,
      extractGroupAnswerBlocks(result)
    );
    return { responseDocument, responseMarkdown: result };
  }
}

export { LLMAssistedMode as LLMAssistedStrategy };
