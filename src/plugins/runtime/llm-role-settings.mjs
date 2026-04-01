import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function ensureParent(filePath) {
  mkdirSync(dirname(filePath), { recursive: true });
}

export class LLMRoleSettingsStore {
  constructor(config = {}, llmBridge = null) {
    this.config = config;
    this.llmBridge = llmBridge;
    this.storeFile = resolve(process.cwd(), config.storeFile || 'data/settings/llm-role-settings.json');
    this.defaults = {
      roles: { ...(config.roles || {}) },
      pluginOverrides: { ...(config.pluginOverrides || {}) }
    };
    this.state = this._load();
  }

  _load() {
    ensureParent(this.storeFile);
    if (!existsSync(this.storeFile)) {
      const initial = {
        ...clone(this.defaults),
        updatedAt: new Date().toISOString()
      };
      writeFileSync(this.storeFile, JSON.stringify(initial, null, 2), 'utf-8');
      return initial;
    }
    try {
      const raw = JSON.parse(readFileSync(this.storeFile, 'utf-8'));
      return {
        roles: { ...clone(this.defaults.roles), ...(raw.roles || {}) },
        pluginOverrides: { ...clone(this.defaults.pluginOverrides), ...(raw.pluginOverrides || {}) },
        updatedAt: raw.updatedAt || new Date().toISOString()
      };
    } catch {
      const fallback = {
        ...clone(this.defaults),
        updatedAt: new Date().toISOString()
      };
      writeFileSync(this.storeFile, JSON.stringify(fallback, null, 2), 'utf-8');
      return fallback;
    }
  }

  _persist() {
    ensureParent(this.storeFile);
    writeFileSync(this.storeFile, JSON.stringify(this.state, null, 2), 'utf-8');
  }

  getSnapshot() {
    return {
      ...clone(this.state),
      availableModels: this.llmBridge?.getAvailableModels?.() || []
    };
  }

  update(payload = {}) {
    this.state = {
      roles: { ...clone(this.defaults.roles), ...(payload.roles || this.state.roles || {}) },
      pluginOverrides: { ...clone(this.defaults.pluginOverrides), ...(payload.pluginOverrides || this.state.pluginOverrides || {}) },
      updatedAt: new Date().toISOString()
    };
    this._persist();
    return this.getSnapshot();
  }

  resolveModel({ pluginId = null, role = null, requestedModel = null, sessionModel = null } = {}) {
    const override = pluginId ? this.state.pluginOverrides?.[pluginId] : null;
    if (override?.model) return override.model;
    const resolvedRole = override?.role || role;
    if (resolvedRole && this.state.roles?.[resolvedRole]?.model) {
      return this.state.roles[resolvedRole].model;
    }
    return requestedModel || sessionModel || this.llmBridge?.resolveModel?.(requestedModel, sessionModel) || null;
  }
}
