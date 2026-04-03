// DS022 — Processing Modes
import { SDKError } from '../platform/errors.mjs';

// ── Mode Interface ──

export class LanguageProcessingMode {
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

// ── Mode Registry ──

export class ModeRegistry {
  constructor() { this._modes = new Map(); }

  register(mode) { this._modes.set(mode.getId(), mode); }

  get(id) { return this._modes.get(id) || null; }

  list() {
    return [...this._modes.values()].map(mode => ({
      id: mode.getId(),
      usesLLM: mode.usesLLM(),
      supportsModelOverride: mode.supportsModelOverride(),
      capabilities: mode.getCapabilities()
    }));
  }

  resolve(requestedMode, sessionMode, defaultMode) {
    const mode = requestedMode || sessionMode || defaultMode;
    const resolved = this._modes.get(mode);
    if (!resolved) throw new SDKError('CONFIG_INVALID_MODE', 'modes', `Mode '${mode}' not available`);
    return resolved;
  }
}

export { LanguageProcessingMode as LanguageProcessingStrategy };
export { ModeRegistry as StrategyRegistry };
