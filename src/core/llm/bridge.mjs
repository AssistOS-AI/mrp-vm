// DS015 — LLMBridge (AchillesAgentLib adapter) with disk cache
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { statSync, readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { loadConfig } from '../platform/config.mjs';
import { logger } from '../platform/logger.mjs';
import { MRPError } from '../platform/errors.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MOD = 'llm';

function summarizeText(text, maxChars = 180) {
  const normalized = String(text || '').replace(/\s+/g, ' ').trim();
  if (!normalized) return '';
  if (normalized.length <= maxChars) return normalized;
  const remaining = normalized.length - maxChars;
  return `${normalized.slice(0, maxChars)} (+${remaining} chars)`;
}

export class LLMBridge {
  constructor(config) {
    this.config = config;
    this.agent = null;
    this._modes = [];
    this._callSeq = 0;
    // Accumulated statistics for debugging
    this._stats = { totalCalls: 0, totalDurationMs: 0, totalPromptChars: 0, totalResponseChars: 0, cacheHits: 0 };
    // Cache: hash(prompt+model) → response on disk
    const cacheDir = config.cacheDir || resolve(__dirname, '../../../data/cache');
    this._cacheEnabled = config.cache !== false;
    this._cacheDir = cacheDir;
    if (this._cacheEnabled) mkdirSync(cacheDir, { recursive: true });
  }

  async init() {
    let achillesPath = resolve(__dirname, '../../../', this.config.achillesPath);
    try {
      if (statSync(achillesPath).isDirectory()) {
        try {
          const pkg = JSON.parse(readFileSync(resolve(achillesPath, 'package.json'), 'utf-8'));
          achillesPath = resolve(achillesPath, pkg.main || 'index.mjs');
        } catch { achillesPath = resolve(achillesPath, 'index.mjs'); }
      }
    } catch { /* try as-is */ }
    try {
      const mod = await import(achillesPath);
      const AgentClass = mod.LLMAgent;
      if (AgentClass) {
        this.agent = new AgentClass({ name: 'mrp-vm' });
        this._modes = this.agent.getSupportedModes?.() || [];
      }
    } catch (e) {
      logger.warn(MOD, `AchillesAgentLib not available: ${e.message}`);
    }
  }

  _cacheKey(prompt, mode) {
    return createHash('sha256').update(`${mode}\n${prompt}`).digest('hex');
  }

  _cacheGet(key) {
    if (!this._cacheEnabled) return undefined;
    const fp = resolve(this._cacheDir, `${key}.json`);
    if (!existsSync(fp)) return undefined;
    try {
      const entry = JSON.parse(readFileSync(fp, 'utf-8'));
      if (!entry.response) return undefined;
      logger.debug(MOD, 'Cache hit', { key: key.slice(0, 12) });
      return entry.response;
    } catch { return undefined; }
  }

  _cachePut(key, mode, prompt, response) {
    if (!this._cacheEnabled) return;
    const fp = resolve(this._cacheDir, `${key}.json`);
    writeFileSync(fp, JSON.stringify({ mode, prompt, response, cachedAt: new Date().toISOString() }, null, 2), 'utf-8');
  }

  async call(systemPrompt, userMessage, opts = {}) {
    if (!this.agent) throw new MRPError('LLM_NOT_AVAILABLE', MOD, 'LLM agent not initialized');
    const mode = opts.model || this.config.defaultModel || 'fast';
    const operation = opts.operation || opts.label || 'unspecified';
    const timeout = opts.timeout ?? this.config.timeoutMs ?? 30000;
    const noCache = opts.noCache === true || opts.bypassCache === true;
    const prompt = systemPrompt ? `${systemPrompt}\n\n${userMessage}` : userMessage;
    const promptChars = prompt.length;
    const promptPreview = summarizeText(prompt);
    const callId = `llm-${String(++this._callSeq).padStart(5, '0')}`;

    // Check cache
    const key = this._cacheKey(prompt, mode);
    const cached = noCache ? undefined : this._cacheGet(key);
    if (cached !== undefined) {
      this._stats.cacheHits++;
      logger.info(MOD, '⚡ LLM CACHE HIT', {
        callId,
        operation,
        model: mode,
        promptChars,
        responseChars: cached.length,
        durationMs: 0
      });
      return cached;
    }

    const startedAt = Date.now();
    logger.info(MOD, '🔄 LLM call started', {
      callId,
      operation,
      model: mode,
      promptChars,
      timeoutMs: timeout
    });

    try {
      const result = await Promise.race([
        this.agent.complete({ prompt, mode }),
        new Promise((_, reject) => setTimeout(() => reject(new MRPError('LLM_TIMEOUT', MOD, 'LLM call timed out')), timeout))
      ]);
      const text = typeof result === 'string' ? result : result?.content || result?.text || String(result);
      const durationMs = Date.now() - startedAt;

      // Update stats
      this._stats.totalCalls++;
      this._stats.totalDurationMs += durationMs;
      this._stats.totalPromptChars += promptChars;
      this._stats.totalResponseChars += text.length;

      if (!noCache && text && text.trim()) this._cachePut(key, mode, prompt, text);
      logger.info(MOD, `✅ LLM call completed in ${(durationMs / 1000).toFixed(1)}s`, {
        callId,
        operation,
        model: mode,
        promptChars,
        responseChars: text.length,
        durationMs,
        totalLLMCalls: this._stats.totalCalls,
        totalLLMTimeMs: this._stats.totalDurationMs
      });
      return text;
    } catch (error) {
      const durationMs = Date.now() - startedAt;
      logger.warn(MOD, `❌ LLM call failed after ${(durationMs / 1000).toFixed(1)}s`, {
        callId,
        operation,
        model: mode,
        promptChars,
        durationMs,
        code: error.code || null,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Get accumulated LLM statistics for this bridge instance.
   */
  getStats() {
    return { ...this._stats };
  }

  /**
   * Reset accumulated statistics.
   */
  resetStats() {
    this._stats = { totalCalls: 0, totalDurationMs: 0, totalPromptChars: 0, totalResponseChars: 0, cacheHits: 0 };
  }

  async callWithRetry(systemPrompt, userMessage, opts = {}, maxRetries) {
    const retries = maxRetries ?? this.config.maxTransportRetriesPerAttempt ?? 2;
    const operation = opts.operation || opts.label || 'unspecified';
    const mode = opts.model || this.config.defaultModel || 'fast';
    let lastErr;
    for (let i = 0; i <= retries; i++) {
      try {
        return await this.call(systemPrompt, userMessage, opts);
      } catch (e) {
        lastErr = e;
        if (!this._isRetryable(e)) throw e;
        logger.warn(MOD, `LLM transport retry ${i + 1}/${retries}`, {
          operation,
          model: mode,
          error: e.message
        });
        await new Promise(r => setTimeout(r, Math.min(1000 * 2 ** i, 10000)));
      }
    }
    throw lastErr;
  }

  _isRetryable(e) {
    if (e.code === 'LLM_TIMEOUT') return true;
    if (e.status === 429) return true;
    if (e.message?.includes('ECONNRESET') || e.message?.includes('ETIMEDOUT')) return true;
    return false;
  }

  getAvailableModels() {
    return this._modes.map(m => ({
      id: m,
      provider: 'achilles',
      tags: m === 'fast' || m === 'test-fast' ? ['fast'] : []
    }));
  }

  resolveModel(requestModel, sessionModel) {
    return requestModel || sessionModel || this.config.defaultModel || 'fast';
  }
}
