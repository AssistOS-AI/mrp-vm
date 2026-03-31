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
    if (chunkText.length > MAX_INPUT_CHARS) {
      throw new MRPError('NORMALIZER_INPUT_TOO_LARGE', MOD, `Input exceeds ${MAX_INPUT_CHARS} characters`);
    }
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

  async toSeedBundleCNL(rawNL, history, systemPrompt, strategy, requestedModel = null) {
    if (rawNL.length > MAX_INPUT_CHARS) {
      throw new MRPError('NORMALIZER_INPUT_TOO_LARGE', MOD, `Input exceeds ${MAX_INPUT_CHARS} characters`);
    }
    return this._normalizeSeedBundleWithRetry(
      input => strategy.detectSeedBundle(input),
      { rawNL, history, systemPrompt, requestedModel },
      strategy
    );
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

  _validateSeedBundle(bundle) {
    const intentCNL = stripCodeFences(bundle?.intentCNL || '');
    const currentTurnContextCNL = stripCodeFences(bundle?.currentTurnContextCNL || '');
    const intentValidation = this.validator.validateIntentCNL(intentCNL);
    const contextValidation = currentTurnContextCNL.trim()
      ? this.validator.validateContextCNL(currentTurnContextCNL)
      : { valid: true, errors: [] };
    return {
      intentCNL,
      currentTurnContextCNL,
      intentValidation,
      contextValidation,
      valid: intentValidation.valid && contextValidation.valid
    };
  }

  _buildSeedBundleCorrectionPrompt(validation) {
    const parts = [
      'Previous attempt produced an invalid seed bundle.'
    ];
    if (!validation.intentValidation.valid) {
      parts.push(
        'Intent CNL errors:',
        ...validation.intentValidation.errors.map(error => `- ${error.code}: ${error.message}`),
        '',
        'Previous invalid Intent CNL:',
        validation.intentCNL || '(empty)'
      );
    }
    if (!validation.contextValidation.valid) {
      parts.push(
        'Session Context CNL errors:',
        ...validation.contextValidation.errors.map(error => `- ${error.code}: ${error.message}`),
        '',
        'Previous invalid Session Context CNL:',
        validation.currentTurnContextCNL || '(empty)'
      );
    }
    parts.push(
      '',
      'Please regenerate BOTH sections as valid raw Markdown.'
    );
    return parts.join('\n');
  }

  async _normalizeSeedBundleWithRetry(callFn, initialInput, strategy) {
    let attempts = 0;
    let result;
    try {
      attempts += 1;
      result = await callFn(initialInput);
    } catch (error) {
      throw new MRPError('NORMALIZER_FAILED', MOD, error.message, {
        originalError: error.code,
        attemptCount: attempts
      });
    }

    let validation = this._validateSeedBundle(result);
    if (validation.valid) {
      return {
        intentCNL: validation.intentCNL,
        currentTurnContextCNL: validation.currentTurnContextCNL,
        attemptCount: attempts
      };
    }

    logger.warn(MOD, 'Seed bundle validation failed, attempting corrective retry', {
      intentErrors: validation.intentValidation.errors,
      contextErrors: validation.contextValidation.errors
    });

    if (!strategy.usesLLM()) {
      throw new MRPError('NORMALIZER_VALIDATION_FAILED', MOD, 'Seed bundle validation failed (symbolic, no retry)', {
        attemptCount: attempts,
        intentErrors: validation.intentValidation.errors,
        contextErrors: validation.contextValidation.errors
      });
    }

    const correctionPrompt = this._buildSeedBundleCorrectionPrompt(validation);
    const correctionInput = {
      ...initialInput,
      systemPrompt: [initialInput.systemPrompt, correctionPrompt].filter(Boolean).join('\n\n')
    };

    try {
      attempts += 1;
      result = await callFn(correctionInput);
    } catch (error) {
      throw new MRPError('NORMALIZER_FAILED', MOD, `Corrective retry failed: ${error.message}`, {
        attemptCount: attempts
      });
    }

    validation = this._validateSeedBundle(result);
    if (validation.valid) {
      return {
        intentCNL: validation.intentCNL,
        currentTurnContextCNL: validation.currentTurnContextCNL,
        attemptCount: attempts
      };
    }

    throw new MRPError('NORMALIZER_VALIDATION_FAILED', MOD, 'Seed bundle validation failed after corrective retry', {
      attemptCount: attempts,
      intentErrors: validation.intentValidation.errors,
      contextErrors: validation.contextValidation.errors
    });
  }
}
