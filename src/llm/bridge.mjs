// DS015 — LLMBridge (AchillesAgentLib adapter) with disk cache
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { statSync, readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { loadConfig } from '../lib/config.mjs';
import { logger } from '../lib/logger.mjs';
import { MRPError } from '../lib/errors.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MOD = 'llm';

export class LLMBridge {
  constructor(config) {
    this.config = config;
    this.agent = null;
    this._modes = [];
    // Cache: hash(prompt+model) → response on disk
    const cacheDir = config.cacheDir || resolve(__dirname, '../../data/cache');
    this._cacheEnabled = config.cache !== false;
    this._cacheDir = cacheDir;
    if (this._cacheEnabled) mkdirSync(cacheDir, { recursive: true });
  }

  async init() {
    let achillesPath = resolve(__dirname, '../../', this.config.achillesPath);
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
    const timeout = opts.timeout ?? this.config.timeoutMs ?? 30000;
    const prompt = systemPrompt ? `${systemPrompt}\n\n${userMessage}` : userMessage;

    // Check cache
    const key = this._cacheKey(prompt, mode);
    const cached = this._cacheGet(key);
    if (cached !== undefined) return cached;

    const result = await Promise.race([
      this.agent.complete({ prompt, mode }),
      new Promise((_, reject) => setTimeout(() => reject(new MRPError('LLM_TIMEOUT', MOD, 'LLM call timed out')), timeout))
    ]);
    const text = typeof result === 'string' ? result : result?.content || result?.text || String(result);

    // Only cache successful, non-empty responses
    if (text && text.trim()) this._cachePut(key, mode, prompt, text);
    return text;
  }

  async callWithRetry(systemPrompt, userMessage, opts = {}, maxRetries) {
    const retries = maxRetries ?? this.config.maxTransportRetriesPerAttempt ?? 2;
    let lastErr;
    for (let i = 0; i <= retries; i++) {
      try {
        return await this.call(systemPrompt, userMessage, opts);
      } catch (e) {
        lastErr = e;
        if (!this._isRetryable(e)) throw e;
        logger.warn(MOD, `LLM transport retry ${i + 1}/${retries}`, { error: e.message });
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
