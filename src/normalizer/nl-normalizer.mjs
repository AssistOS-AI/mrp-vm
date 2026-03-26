// DS006 — NL Normalizer
import { CNLValidator } from '../parser/cnl-validator-parser.mjs';
import { MRPError } from '../lib/errors.mjs';
import { logger } from '../lib/logger.mjs';

const MOD = 'normalizer';
const MAX_INPUT_CHARS = 8000;

// Strip markdown code fences that LLMs sometimes wrap around output
function stripCodeFences(text) {
  if (!text) return text;
  return text.replace(/^```(?:markdown)?\s*\n?/gm, '').replace(/\n?```\s*$/gm, '').trim();
}

export class NLNormalizer {
  constructor(strategyRegistry) {
    this.strategyRegistry = strategyRegistry;
    this.validator = new CNLValidator();
  }

  async toIntentCNL(rawNL, history, systemPrompt, strategy, requestedModel = null) {
    if (rawNL.length > MAX_INPUT_CHARS) {
      throw new MRPError('NORMALIZER_INPUT_TOO_LARGE', MOD, `Input exceeds ${MAX_INPUT_CHARS} characters`);
    }
    return this._normalizeWithRetry(
      (input) => strategy.normalizeIntent(input),
      { rawNL, history, systemPrompt, requestedModel },
      r => r.intentCNL,
      md => this.validator.validateIntentCNL(md),
      'NORMALIZER_FAILED', 'NORMALIZER_VALIDATION_FAILED',
      strategy
    );
  }

  async toSessionContextCNL(rawNL, systemPrompt, strategy, requestedModel = null) {
    if (rawNL.length > MAX_INPUT_CHARS) {
      throw new MRPError('NORMALIZER_INPUT_TOO_LARGE', MOD, `Input exceeds ${MAX_INPUT_CHARS} characters`);
    }
    return this._normalizeWithRetry(
      (input) => strategy.extractSessionContext(input),
      { rawNL, systemPrompt, requestedModel },
      r => r.contextCNL,
      md => {
        if (!md || !md.trim()) return { valid: true, errors: [] };
        return this.validator.validateContextCNL(md);
      },
      'SESSION_CONTEXT_FAILED', 'SESSION_CONTEXT_VALIDATION_FAILED',
      strategy
    );
  }

  async toContextCNL(chunkText, provenance, strategy, requestedModel = null) {
    return this._normalizeWithRetry(
      (input) => strategy.normalizePersistentContext(input),
      { chunkText, provenance, requestedModel },
      r => r.contextCNL,
      md => {
        if (!md || !md.trim()) return { valid: true, errors: [] };
        return this.validator.validateContextCNL(md);
      },
      'KB_CONTEXT_FAILED', 'KB_CONTEXT_VALIDATION_FAILED',
      strategy
    );
  }

  async toNaturalLanguage(cnl) {
    const lines = cnl.split('\n');
    const parts = [];
    for (const line of lines) {
      const m = line.match(/^(?:Claim|Intent|Procedure):\s*(.+)/);
      if (m) parts.push(m[1]);
    }
    return parts.join(' ') || cnl;
  }

  async _normalizeWithRetry(callFn, initialInput, extractFn, validateFn, failCode, validationFailCode, strategy) {
    let result;
    try {
      result = await callFn(initialInput);
    } catch (e) {
      throw new MRPError(failCode, MOD, e.message, { originalError: e.code });
    }
    let cnl = stripCodeFences(extractFn(result));
    const vr = validateFn(cnl);
    if (vr.valid) return cnl;

    logger.warn(MOD, 'Validation failed, attempting corrective retry', { errors: vr.errors });

    if (!strategy.usesLLM()) {
      throw new MRPError(validationFailCode, MOD, 'Validation failed (symbolic, no retry)', { errors: vr.errors });
    }

    const correctionPrompt = `Previous attempt produced invalid CNL. Errors:\n${vr.errors.map(e => `- ${e.code}: ${e.message}`).join('\n')}\n\nPrevious invalid output:\n${cnl}\n\nPlease fix the output. Output raw Markdown only, no code fences.`;
    const correctionInput = { ...initialInput, systemPrompt: correctionPrompt };

    try {
      result = await callFn(correctionInput);
    } catch (e) {
      throw new MRPError(failCode, MOD, `Corrective retry failed: ${e.message}`);
    }
    const cnl2 = stripCodeFences(extractFn(result));
    const vr2 = validateFn(cnl2);
    if (vr2.valid) return cnl2;
    throw new MRPError(validationFailCode, MOD, 'Validation failed after corrective retry', { errors: vr2.errors });
  }
}
