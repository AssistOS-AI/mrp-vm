// DS022 — LLM-Assisted Strategy
import { LanguageProcessingStrategy } from './registry.mjs';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildResponseDocument, extractGroupAnswerBlocks } from '../synthesis/response-document.mjs';
import { renderResolvedIntentPayloadMarkdown } from '../synthesis/resolved-intent-payload.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROMPTS_DIR = resolve(__dirname, '../../../config/prompts');

function loadPrompt(name) {
  const fp = resolve(PROMPTS_DIR, name);
  return existsSync(fp) ? readFileSync(fp, 'utf-8') : '';
}

function stripFences(text) {
  if (!text) return text;
  return text.replace(/^```(?:markdown)?\s*\n?/gm, '').replace(/\n?```\s*$/gm, '').trim();
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

export class LLMAssistedStrategy extends LanguageProcessingStrategy {
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

  async detectSeedBundle({ rawNL, history, systemPrompt, requestedModel }) {
    const prompt = loadPrompt('normalize-seed-bundle.md');
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

  async normalizeIntent({ rawNL, history, systemPrompt, requestedModel }) {
    const result = await this.detectSeedBundle({ rawNL, history, systemPrompt, requestedModel });
    return { intentCNL: result.intentCNL };
  }

  async extractSessionContext({ rawNL, systemPrompt, requestedModel }) {
    const result = await this.detectSeedBundle({ rawNL, history: [], systemPrompt, requestedModel });
    return { contextCNL: result.currentTurnContextCNL };
  }

  async normalizePersistentContext({ chunkText, provenance, requestedModel, systemPrompt }) {
    const prompt = loadPrompt('normalize-context.md');
    // Normalize source/chunk IDs for cache stability — same content should hit cache
    // regardless of the random source ID assigned at upload time
    const stableSource = provenance.sourceName || 'source';
    const stableChunk = `chunk-${provenance.chunkIndex ?? 0}`;
    const userMsg = `${systemPrompt ? `${systemPrompt}\n\n` : ''}Source: ${stableSource}\nChunk: ${stableChunk}\nChunk index: ${provenance.chunkIndex}\n\nText:\n${chunkText}`;
    const result = await this.llm.callWithRetry(prompt, userMsg, {
      model: requestedModel,
      operation: 'normalize-persistent-context'
    });
    return { contextCNL: result };
  }

  async synthesizeResponse({ sessionId, resolvedIntents, pluginOutputs, systemPrompt, requestedModel, guidanceUnits = [] }) {
    const prompt = loadPrompt('synthesize.md');
    // Build evidence document (session ID excluded for cache stability)
    let evidenceDoc = '';
    for (const ri of resolvedIntents) {
      // Normalize source/unit IDs for cache stability
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
        `- (${entry.store}) ${entry.unit?.claim || entry.unit?.procedure || ''}`.replace(/src-[a-f0-9]+/g, 'src-REF').replace(/sess-[a-f0-9-]+/g, 'sess-REF')
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
