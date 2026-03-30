import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

function ensureParent(filePath) {
  mkdirSync(dirname(filePath), { recursive: true });
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export class PlannerStatsStore {
  constructor(config = {}) {
    this.filePath = resolve(process.cwd(), config.statsFile || 'data/settings/plugin-stats.json');
    this.alpha = config.alpha ?? 0.25;
    this.state = this._load();
  }

  _load() {
    ensureParent(this.filePath);
    if (!existsSync(this.filePath)) return { plugins: {} };
    try {
      return JSON.parse(readFileSync(this.filePath, 'utf-8'));
    } catch {
      return { plugins: {} };
    }
  }

  _persist() {
    ensureParent(this.filePath);
    writeFileSync(this.filePath, JSON.stringify(this.state, null, 2), 'utf-8');
  }

  _get(pluginId) {
    if (!this.state.plugins[pluginId]) {
      this.state.plugins[pluginId] = {
        attempts: 0,
        successes: 0,
        failures: 0,
        insufficient: 0,
        successEWMA: 0.7,
        sufficiencyEWMA: 0.7,
        latencyMsEWMA: 250,
        llmCallsEWMA: 0
      };
    }
    return this.state.plugins[pluginId];
  }

  recordStage(stage) {
    if (!stage?.pluginId) return;
    const stats = this._get(stage.pluginId);
    const success = stage.status === 'success' ? 1 : 0;
    const sufficient = stage.sufficient === false ? 0 : 1;
    stats.attempts += 1;
    if (success) stats.successes += 1;
    else stats.failures += 1;
    if (stage.sufficient === false) stats.insufficient += 1;
    stats.successEWMA = this.alpha * success + (1 - this.alpha) * stats.successEWMA;
    stats.sufficiencyEWMA = this.alpha * sufficient + (1 - this.alpha) * stats.sufficiencyEWMA;
    stats.latencyMsEWMA = this.alpha * (stage.durationMs || 0) + (1 - this.alpha) * stats.latencyMsEWMA;
    stats.llmCallsEWMA = this.alpha * (stage.llmCalls || 0) + (1 - this.alpha) * stats.llmCallsEWMA;
    this._persist();
  }

  recordOutcome(outcome) {
    for (const stage of outcome?.stages || []) this.recordStage(stage);
  }

  getUtility(pluginId) {
    const stats = this._get(pluginId);
    const latencyPenalty = clamp(stats.latencyMsEWMA / 5000, 0, 0.5);
    const llmPenalty = clamp(stats.llmCallsEWMA * 0.05, 0, 0.3);
    return stats.successEWMA + (0.15 * stats.sufficiencyEWMA) - latencyPenalty - llmPenalty;
  }

  rank(pluginIds = []) {
    return [...pluginIds].sort((a, b) => this.getUtility(b) - this.getUtility(a) || a.localeCompare(b));
  }
}
