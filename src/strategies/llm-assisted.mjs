// DS022 — LLM-Assisted Strategy
import { LanguageProcessingStrategy } from './registry.mjs';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildResponseDocument, extractGroupAnswerBlocks } from '../synthesis/response-document.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROMPTS_DIR = resolve(__dirname, '../../config/prompts');

function loadPrompt(name) {
  const fp = resolve(PROMPTS_DIR, name);
  return existsSync(fp) ? readFileSync(fp, 'utf-8') : '';
}

function stripFences(text) {
  if (!text) return text;
  return text.replace(/^```(?:markdown)?\s*\n?/gm, '').replace(/\n?```\s*$/gm, '').trim();
}

export class LLMAssistedStrategy extends LanguageProcessingStrategy {
  constructor(llmBridge) {
    super();
    this.llm = llmBridge;
  }

  getId() { return 'llm-assisted'; }
  usesLLM() { return true; }
  supportsModelOverride() { return true; }
  getCapabilities() {
    return ['normalize-intent', 'extract-session-context', 'normalize-persistent-context', 'synthesize-response'];
  }

  async normalizeIntent({ rawNL, history, systemPrompt, requestedModel }) {
    const prompt = loadPrompt('normalize-intent.md');
    const historyText = (history || []).map(m => `${m.role}: ${m.content}`).join('\n');
    const userMsg = `${systemPrompt ? `System instructions: ${systemPrompt}\n` : ''}${historyText ? `Conversation history:\n${historyText}\n\n` : ''}Current request:\n${rawNL}`;
    const result = await this.llm.callWithRetry(prompt, userMsg, { model: requestedModel });
    return { intentCNL: result };
  }

  async extractSessionContext({ rawNL, systemPrompt, requestedModel }) {
    const prompt = loadPrompt('normalize-session-context.md');
    const userMsg = `${systemPrompt ? `System instructions: ${systemPrompt}\n` : ''}Current user message:\n${rawNL}`;
    const result = await this.llm.callWithRetry(prompt, userMsg, { model: requestedModel });
    return { contextCNL: result };
  }

  async normalizePersistentContext({ chunkText, provenance, requestedModel, systemPrompt }) {
    const prompt = loadPrompt('normalize-context.md');
    const userMsg = `${systemPrompt ? `${systemPrompt}\n\n` : ''}Source: ${provenance.sourceId}\nChunk: ${provenance.chunkId}\nChunk index: ${provenance.chunkIndex}\n\nText:\n${chunkText}`;
    const result = await this.llm.callWithRetry(prompt, userMsg, { model: requestedModel });
    return { contextCNL: result };
  }

  async synthesizeResponse({ sessionId, resolvedIntents, pluginOutputs, systemPrompt, requestedModel }) {
    const prompt = loadPrompt('synthesize.md');
    // Build evidence document (session ID excluded for cache stability)
    let evidenceDoc = '';
    for (const ri of resolvedIntents) {
      // Normalize source/unit IDs for cache stability
      evidenceDoc += ri.resolvedMarkdown.replace(/src-[a-f0-9]+/g, 'src-REF').replace(/sess-[a-f0-9-]+/g, 'sess-REF') + '\n\n';
      const po = (pluginOutputs || []).find(p => p.intentRef === ri.intentRef);
      if (po && po.status === 'success') {
        evidenceDoc += `### Plugin Evidence\nPlugin: ${po.pluginName}\nConfidence: ${po.confidence}\nResult: ${po.resultCNL}\n\n`;
      }
    }
    const userMsg = `${systemPrompt ? `System instructions: ${systemPrompt}\n\n` : ''}${evidenceDoc}`;
    let result = await this.llm.callWithRetry(prompt, userMsg, { model: requestedModel });
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
