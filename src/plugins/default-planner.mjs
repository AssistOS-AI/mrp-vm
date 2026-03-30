function unique(ids = []) {
  return [...new Set(ids.filter(Boolean))];
}

export class DefaultPlannerPlugin {
  constructor(pluginRegistry, statsStore, config = {}) {
    this.pluginRegistry = pluginRegistry;
    this.statsStore = statsStore;
    this.config = config;
  }

  getDescriptor() {
    return {
      id: 'planner-default',
      type: 'mrp-plan-plugin',
      name: 'Default Planner',
      version: '1.0.0',
      description: 'Cheap-first planner with adaptive ranking from historical plugin outcomes.',
      costClass: 'cheap',
      usesLLM: false,
      modelRoles: [],
      tags: ['builtin', 'default'],
      timeoutMs: this.config.timeoutMs || 1000,
      provides: ['build-plan', 'record-outcome'],
      accepts: ['chat-turn']
    };
  }

  async buildPlan(input) {
    const explicit = input?.explicitSelections || {};
    const sessionPrefs = input?.sessionPreferences || {};
    return {
      plannerPluginId: this.getDescriptor().id,
      seedDetectorOrder: this._order(
        explicit.seedDetectorPlugin,
        sessionPrefs.seedDetectorPlugin,
        this.config.defaultSeedDetectorPlan || ['sd-symbolic', 'sd-llm-fast', 'sd-llm-deep']
      ),
      kbPluginOrder: this._order(
        explicit.kbPlugin,
        sessionPrefs.kbPlugin,
        this.config.defaultKBPlan || ['kb-fast', 'kb-balanced', 'kb-thinkingdb']
      ),
      goalSolverOrder: this._order(
        explicit.goalSolverPlugin,
        sessionPrefs.goalSolverPlugin,
        this.config.defaultGoalSolverPlan || ['gs-symbolic', 'gs-llm-fast', 'gs-llm-deep']
      ),
      notes: ['cheap-first', 'adaptive-ranking']
    };
  }

  async recordOutcome(outcome) {
    this.statsStore?.recordOutcome(outcome);
  }

  _order(explicitId, sessionId, defaults) {
    if (explicitId) return [explicitId];
    const ranked = this.statsStore?.rank(unique(defaults)) || unique(defaults);
    if (!sessionId) return ranked;
    return unique([sessionId, ...ranked]);
  }
}
