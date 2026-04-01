// DS022 — Processing Strategies
import { SDKError } from '../platform/errors.mjs';

// ── Strategy Interface ──

export class LanguageProcessingStrategy {
  getId() { throw new Error('Not implemented'); }
  usesLLM() { return false; }
  supportsModelOverride() { return false; }
  getCapabilities() { return []; }
  async detectSeedBundle(input) {
    const intent = await this.normalizeIntent(input);
    const context = await this.extractSessionContext(input);
    return {
      intentCNL: intent?.intentCNL || '',
      currentTurnContextCNL: context?.contextCNL || ''
    };
  }
  async normalizeIntent(_input) { throw new Error('Not implemented'); }
  async extractSessionContext(_input) { throw new Error('Not implemented'); }
  async normalizePersistentContext(_input) { throw new Error('Not implemented'); }
  async synthesizeResponse(_input) { throw new Error('Not implemented'); }
}

// ── Strategy Registry ──

export class StrategyRegistry {
  constructor() { this._strategies = new Map(); }

  register(strategy) { this._strategies.set(strategy.getId(), strategy); }

  get(id) { return this._strategies.get(id) || null; }

  list() {
    return [...this._strategies.values()].map(s => ({
      id: s.getId(),
      usesLLM: s.usesLLM(),
      supportsModelOverride: s.supportsModelOverride(),
      capabilities: s.getCapabilities()
    }));
  }

  resolve(requestedMode, sessionMode, defaultMode) {
    const mode = requestedMode || sessionMode || defaultMode;
    const s = this._strategies.get(mode);
    if (!s) throw new SDKError('CONFIG_INVALID_STRATEGY', 'strategies', `Strategy '${mode}' not available`);
    return s;
  }
}
