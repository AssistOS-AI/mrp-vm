function unique(ids = []) {
  return [...new Set(ids.filter(Boolean))];
}

export class DefaultPlannerPlugin {
  constructor(pluginRegistry, statsStore, config = {}) {
    this.pluginRegistry = pluginRegistry;
    this.statsStore = statsStore;
    this.config = config;
    this.id = config.id || 'planner-default';
    this.name = config.name || 'Default Planner';
    this.description = config.description || 'Cheap-first planner with adaptive ranking from historical plugin outcomes.';
    this.plannerStyle = config.plannerStyle || 'adaptive-cheap-first';
  }

  getDescriptor() {
    return {
      id: this.id,
      type: 'mrp-plan-plugin',
      name: this.name,
      version: '1.0.0',
      description: this.description,
      costClass: 'cheap',
      usesLLM: false,
      modelRoles: [],
      maxLLMCalls: 0,
      tags: ['builtin', 'default'],
      timeoutMs: this.config.timeoutMs || 1000,
      provides: ['build-plan', 'record-outcome'],
      accepts: ['chat-turn']
    };
  }

  async buildPlan(input) {
    const explicit = input?.explicitSelections || {};
    const sessionPrefs = input?.sessionPreferences || {};
    const notes = ['adaptive-ranking'];
    const defaults = this._defaultsForInput(input, notes);
    const signals = this._deriveSignals(input);
    return {
      plannerPluginId: this.getDescriptor().id,
      seedDetectorOrder: this._order(
        'sd-plugin',
        explicit.seedDetectorPlugin,
        sessionPrefs.seedDetectorPlugin,
        defaults.seedDetectorPlan,
        signals,
        notes
      ),
      kbPluginOrder: this._order(
        'kb-plugin',
        explicit.kbPlugin,
        sessionPrefs.kbPlugin,
        defaults.kbPlan,
        signals,
        notes
      ),
      goalSolverOrder: this._order(
        'gs-plugin',
        explicit.goalSolverPlugin,
        sessionPrefs.goalSolverPlugin,
        defaults.goalSolverPlan,
        signals,
        notes
      ),
      notes
    };
  }

  async recordOutcome(outcome) {
    this.statsStore?.recordOutcome(outcome);
  }

  _order(type, explicitId, sessionId, defaults, signals, notes) {
    if (explicitId) return [explicitId];
    const ranked = this._rank(type, this._candidatePool(type, defaults), defaults, signals, notes);
    if (!sessionId) return ranked;
    return unique([sessionId, ...ranked]);
  }

  _candidatePool(type, defaults) {
    const registered = this.pluginRegistry?.listByType?.(type)?.map(item => item.id) || [];
    return unique([...(defaults || []), ...registered]);
  }

  _deriveSignals(input) {
    const text = `${input?.currentMessage || ''} ${
      (input?.historyForPrompt || []).map(message => message.content || '').join(' ')
    }`.toLowerCase();
    const topicTags = new Set();
    if (/\b(legal|contract|policy|compliance|regulation|clause|obligation)\b/.test(text)) topicTags.add('legal');
    if (/\b(story|character|theme|chapter|scene|book|narrative|literature)\b/.test(text)) topicTags.add('literature');
    if (/\b(procedure|step|workflow|runbook|operational|sop|process)\b/.test(text)) topicTags.add('procedural');
    if (/\b(api|code|runtime|system|architecture|debug|deploy|latency|technical)\b/.test(text)) topicTags.add('technical');
    if (/\b(symbolic|constraint|proof|formal|rule|invariant|logic)\b/.test(text)) topicTags.add('symbolic');

    return {
      text,
      wantsDepth: /\b(deep|thorough|careful|step-by-step|multi-hop|ambiguous|trade-?off|synthesi[sz]e|proof|prove|reason)\b/.test(text),
      wantsSpeed: /\b(quick|brief|fast|concise|short answer)\b/.test(text),
      symbolicCue: /\b(verify|constraint|satisfiable|formal|rule|invariant)\b/.test(text),
      retrievalHeavy: /\b(compare|relationship|connect|dependency|dependencies|across|why|because|context|evidence)\b/.test(text),
      supportedAct:
        /\bcompare\b/.test(text) ? 'compare' :
        /\bverify|prove|confirm|validate|check\b/.test(text) ? 'verify' :
        /\brecommend|best\b/.test(text) ? 'recommend' :
        /\bdefine|what is\b/.test(text) ? 'define' :
        /\bidentify|which|who\b/.test(text) ? 'identify' :
        /\bdescribe\b/.test(text) ? 'describe' :
        'explain',
      topicTags
    };
  }

  _rank(type, ids, defaults, signals, notes) {
    const defaultOrder = new Map((defaults || []).map((id, index) => [id, index]));
    const scored = ids.map(id => ({
      id,
      score: this._scoreCandidate(type, id, signals, defaultOrder)
    }));
    const routedIds = scored
      .sort((a, b) => b.score - a.score || (defaultOrder.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (defaultOrder.get(b.id) ?? Number.MAX_SAFE_INTEGER) || a.id.localeCompare(b.id))
      .map(item => item.id);
    const novelIds = routedIds.filter(id => !defaultOrder.has(id));
    if (novelIds.length > 0) {
      notes.push(`${type}:dynamic-candidates=${novelIds.join(',')}`);
    }
    return routedIds;
  }

  _scoreCandidate(type, id, signals, defaultOrder) {
    const plugin = this.pluginRegistry?.get?.(type, id);
    const descriptor = plugin?.getDescriptor?.() || {};
    const hints = descriptor.plannerHints || {};
    const supportedActs = new Set(hints.supportedActs || []);
    const topicTags = new Set(hints.topicTags || []);
    const evidenceStyle = new Set(hints.evidenceStyle || []);
    const preferredDepth = hints.preferredDepth || 'medium';
    const fallbackRole = hints.fallbackRole || 'default';
    const expectedLatencyMs = Number(hints.expectedLatencyMs ?? descriptor.timeoutMs ?? 1000);
    const expectedLLMCalls = Number(hints.expectedLLMCalls ?? descriptor.maxLLMCalls ?? 0);
    const relativeCost = Number(hints.relativeCost ?? this._relativeCostFor(descriptor.costClass));
    const confidenceWhenMatched = Number(hints.confidenceWhenMatched ?? 0.5);
    const statsScore = this.statsStore?.getUtility?.(id) ?? 0.6;
    const position = defaultOrder.get(id);
    let score = statsScore;

    if (Number.isFinite(position)) score += Math.max(0, 0.18 - (position * 0.04));
    else score -= 0.02;

    if (supportedActs.has(signals.supportedAct)) score += 0.24;
    else if (supportedActs.size > 0) score -= 0.04;

    let matchedTopics = 0;
    for (const tag of signals.topicTags) {
      if (topicTags.has(tag)) matchedTopics += 1;
    }
    score += matchedTopics * 0.08;

    if (signals.wantsDepth) {
      if (preferredDepth === 'deep') score += 0.16;
      if (fallbackRole === 'heavy-recovery') score += 0.08;
    }
    if (signals.wantsSpeed) {
      if (fallbackRole === 'cheap-probe') score += 0.12;
      score -= relativeCost * 0.25;
      score -= Math.min(expectedLatencyMs / 5000, 0.15);
    }
    if (signals.symbolicCue && (topicTags.has('symbolic') || evidenceStyle.has('symbolic-facts'))) {
      score += 0.12;
    }
    if (signals.retrievalHeavy && type === 'kb-plugin') {
      if (evidenceStyle.has('hybrid')) score += 0.10;
      if (evidenceStyle.has('symbolic-facts')) score += 0.08;
    }

    score += confidenceWhenMatched * 0.1;
    score -= expectedLLMCalls * 0.03;

    return score;
  }

  _relativeCostFor(costClass) {
    if (costClass === 'expensive') return 0.8;
    if (costClass === 'moderate') return 0.45;
    return 0.1;
  }

  _defaultsForInput(input, notes) {
    const cheapFirst = {
      seedDetectorPlan: this.config.defaultSeedDetectorPlan || ['sd-symbolic', 'sd-llm-fast', 'sd-llm-deep'],
      kbPlan: this.config.defaultKBPlan || ['kb-fast', 'kb-balanced', 'kb-thinkingdb'],
      goalSolverPlan: this.config.defaultGoalSolverPlan || ['gs-symbolic', 'gs-llm-fast', 'gs-llm-deep']
    };
    const { wantsDepth, wantsSpeed, symbolicCue, retrievalHeavy } = this._deriveSignals(input);

    if (wantsDepth) {
      notes.push('depth-signals');
      return {
        seedDetectorPlan: ['sd-llm-deep', 'sd-llm-fast', 'sd-symbolic'],
        kbPlan: ['kb-thinkingdb', 'kb-balanced', 'kb-fast'],
        goalSolverPlan: ['gs-llm-deep', 'gs-llm-fast', 'gs-symbolic']
      };
    }

    if (this.plannerStyle === 'deep-first') {
      notes.push('planner-style-deep-first');
      return {
        seedDetectorPlan: ['sd-llm-deep', 'sd-llm-fast', 'sd-symbolic'],
        kbPlan: ['kb-thinkingdb', 'kb-balanced', 'kb-fast'],
        goalSolverPlan: ['gs-llm-deep', 'gs-llm-fast', 'gs-symbolic']
      };
    }

    if (symbolicCue) {
      notes.push('symbolic-cue');
      return {
        seedDetectorPlan: ['sd-symbolic', 'sd-llm-fast', 'sd-llm-deep'],
        kbPlan: retrievalHeavy ? ['kb-thinkingdb', 'kb-balanced', 'kb-fast'] : ['kb-fast', 'kb-balanced', 'kb-thinkingdb'],
        goalSolverPlan: ['gs-symbolic', 'gs-llm-fast', 'gs-llm-deep']
      };
    }

    if (retrievalHeavy && !wantsSpeed) {
      notes.push('retrieval-heavy');
      return {
        seedDetectorPlan: cheapFirst.seedDetectorPlan,
        kbPlan: ['kb-balanced', 'kb-fast', 'kb-thinkingdb'],
        goalSolverPlan: ['gs-llm-fast', 'gs-symbolic', 'gs-llm-deep']
      };
    }

    notes.push(wantsSpeed ? 'speed-signals' : 'cheap-first');
    return cheapFirst;
  }
}
