function unique(ids = []) {
  return [...new Set(ids.filter(Boolean))];
}

function toUnitText(item) {
  const unit = item?.unit || item || {};
  return [
    unit.role || '',
    unit.topic || '',
    unit.claim || '',
    unit.procedure || '',
    unit.utilityNote || '',
    (unit.utilityActs || []).join(' ')
  ].join(' ').trim();
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
    const signals = this._deriveSignals(input);
    const defaults = this._defaultsForInput(signals, notes);
    const decompose = this._shouldDecompose(input, signals, explicit, notes);
    return {
      plannerPluginId: this.getDescriptor().id,
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
      decompose,
      framePurpose: decompose ? this._framePurposeFor(signals) : null,
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
    const historyText = (input?.historyForPrompt || [])
      .map(message => message.content || '')
      .join(' ');
    const intentText = (input?.intentGroups || [])
      .map(group => [group.act, group.intent, group.context, group.criterion, group.evidence, group.output].filter(Boolean).join(' '))
      .join(' ');
    const currentTurnText = (input?.currentTurnUnits || [])
      .map(unit => toUnitText(unit))
      .join(' ');
    const guidanceUnits = [
      ...(input?.strategyGuidanceUnits || []),
      ...(input?.plannerGuidanceUnits || []),
      ...(input?.goalSolverGuidanceUnits || []),
      ...(input?.decompositionGuidanceUnits || []),
      ...(input?.validationGuidanceUnits || []),
      ...(input?.seedDetectorGuidanceUnits || [])
    ];
    const guidanceText = guidanceUnits
      .map(unit => toUnitText(unit))
      .join(' ');
    const text = `${input?.currentMessage || ''} ${historyText} ${intentText} ${currentTurnText} ${guidanceText}`.toLowerCase();
    const plannerGuidanceText = (input?.plannerGuidanceUnits || []).map(unit => toUnitText(unit)).join(' ').toLowerCase();
    const goalGuidanceText = (input?.goalSolverGuidanceUnits || []).map(unit => toUnitText(unit)).join(' ').toLowerCase();
    const decompositionGuidanceText = (input?.decompositionGuidanceUnits || []).map(unit => toUnitText(unit)).join(' ').toLowerCase();
    const validationGuidanceText = (input?.validationGuidanceUnits || []).map(unit => toUnitText(unit)).join(' ').toLowerCase();
    const topicTags = new Set();
    if (/\b(legal|contract|policy|compliance|regulation|clause|obligation)\b/.test(text)) topicTags.add('legal');
    if (/\b(story|character|theme|chapter|scene|book|narrative|literature)\b/.test(text)) topicTags.add('literature');
    if (/\b(procedure|step|workflow|runbook|operational|sop|process)\b/.test(text)) topicTags.add('procedural');
    if (/\b(api|code|runtime|system|architecture|debug|deploy|latency|technical)\b/.test(text)) topicTags.add('technical');
    if (/\b(symbolic|constraint|proof|formal|rule|invariant|logic)\b/.test(text)) topicTags.add('symbolic');

    const guidanceRoles = new Set(
      guidanceUnits
        .map(item => (item?.unit?.role || item?.role || '').toLowerCase())
        .filter(Boolean)
    );
    const guidanceActs = new Set(
      guidanceUnits
        .flatMap(item => item?.unit?.utilityActs || item?.utilityActs || [])
        .map(act => String(act).toLowerCase())
    );
    const parsedActs = (input?.intentGroups || [])
      .map(group => group?.act)
      .filter(Boolean);
    const primaryAct =
      parsedActs[0] ||
      (/\bcompare\b/.test(text) ? 'compare' :
      /\bverify|prove|confirm|validate|check\b/.test(text) ? 'verify' :
      /\brecommend|best\b/.test(text) ? 'recommend' :
      /\bdefine|what is\b/.test(text) ? 'define' :
      /\bidentify|which|who\b/.test(text) ? 'identify' :
      /\bdescribe\b/.test(text) ? 'describe' :
      'explain');

    return {
      text,
      phase: input?.phase || 'post-seed',
      wantsDepth: /\b(deep|thorough|careful|step-by-step|multi-hop|ambiguous|trade-?off|synthesi[sz]e|proof|prove|reason)\b/.test(text),
      wantsSpeed: /\b(quick|brief|fast|concise|short answer)\b/.test(text),
      symbolicCue:
        /\b(verify|constraint|satisfiable|formal|rule|invariant)\b/.test(text) ||
        guidanceRoles.has('constraint') ||
        guidanceRoles.has('condition'),
      retrievalHeavy:
        /\b(compare|relationship|connect|dependency|dependencies|across|why|because|context|evidence)\b/.test(text) ||
        (input?.decomposedIntents || []).length > 1,
      supportedAct: primaryAct,
      topicTags,
      intentCount: Math.max((input?.intentGroups || []).length, (input?.decomposedIntents || []).length, 1),
      hasStrategyGuidance: guidanceUnits.length > 0,
      hasPlannerGuidance: (input?.plannerGuidanceUnits || []).length > 0,
      hasGoalSolverGuidance: (input?.goalSolverGuidanceUnits || []).length > 0,
      hasDecompositionGuidance: (input?.decompositionGuidanceUnits || []).length > 0,
      hasValidationGuidance: (input?.validationGuidanceUnits || []).length > 0,
      hasProcedureGuidance:
        guidanceRoles.has('procedure') ||
        guidanceActs.has('implement') ||
        guidanceActs.has('recommend'),
      hasEvaluationGuidance:
        guidanceRoles.has('evaluation') ||
        guidanceActs.has('evaluate') ||
        guidanceActs.has('recommend'),
      hasConstraintGuidance:
        guidanceRoles.has('constraint') ||
        guidanceRoles.has('condition') ||
        guidanceActs.has('verify'),
      forceDecompose:
        /\b(decompose|split|subtask|break down|separate frame)\b/.test(decompositionGuidanceText) ||
        /\b(multi-step|step by step)\b/.test(decompositionGuidanceText) && !/\b(no decompose|single pass|single answer)\b/.test(decompositionGuidanceText),
      avoidDecompose:
        /\b(no decompose|single pass|single frame|direct answer|do not split)\b/.test(decompositionGuidanceText) ||
        /\b(direct dispatch|use direct solver)\b/.test(plannerGuidanceText),
      preferDeepSolver:
        /\b(deep|careful|comprehensive|thorough|full answer)\b/.test(goalGuidanceText) ||
        /\b(exhaustive|strict validation)\b/.test(validationGuidanceText),
      preferStructuredOutput:
        /\b(json|bullet|table|list|step by step|brief|concise)\b/.test(goalGuidanceText)
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
    if ((signals.symbolicCue || signals.hasConstraintGuidance) && (topicTags.has('symbolic') || evidenceStyle.has('symbolic-facts'))) {
      score += 0.12;
    }
    if (signals.retrievalHeavy && type === 'kb-plugin') {
      if (evidenceStyle.has('hybrid')) score += 0.10;
      if (evidenceStyle.has('symbolic-facts')) score += 0.08;
    }
    if (signals.hasProcedureGuidance && type === 'gs-plugin') {
      if (supportedActs.has('implement') || topicTags.has('procedural')) score += 0.08;
    }
    if (signals.hasEvaluationGuidance && type === 'kb-plugin') {
      if (evidenceStyle.has('hybrid')) score += 0.05;
    }

    score += confidenceWhenMatched * 0.1;
    score -= expectedLLMCalls * 0.03;

    // DS003/DS029: description-driven relevance filtering
    const description = (descriptor.description || '').toLowerCase();
    if (description && signals.text) {
      // Check if key query terms appear in the plugin description
      const queryWords = signals.text.split(/\s+/).filter(w => w.length > 3);
      let descHits = 0;
      for (const w of queryWords) {
        if (description.includes(w)) descHits++;
      }
      if (descHits > 0) score += Math.min(descHits * 0.03, 0.15);
    }

    return score;
  }

  _relativeCostFor(costClass) {
    if (costClass === 'expensive') return 0.8;
    if (costClass === 'moderate') return 0.45;
    return 0.1;
  }

  _defaultsForInput(signals, notes) {
    const cheapFirst = {
      kbPlan: this.config.defaultKBPlan || ['kb-fast', 'kb-balanced', 'kb-thinkingdb'],
      goalSolverPlan: this.config.defaultGoalSolverPlan || ['gs-symbolic', 'gs-llm-fast', 'gs-llm-deep']
    };
    const {
      wantsDepth,
      wantsSpeed,
      symbolicCue,
      retrievalHeavy,
      hasProcedureGuidance,
      hasEvaluationGuidance,
      hasConstraintGuidance
    } = signals;

    if (wantsDepth || hasEvaluationGuidance) {
      notes.push(hasEvaluationGuidance ? 'evaluation-guidance' : 'depth-signals');
      return {
        kbPlan: ['kb-thinkingdb', 'kb-balanced', 'kb-fast'],
        goalSolverPlan: ['gs-llm-deep', 'gs-llm-fast', 'gs-symbolic']
      };
    }

    if (this.plannerStyle === 'deep-first') {
      notes.push('planner-style-deep-first');
      return {
        kbPlan: ['kb-thinkingdb', 'kb-balanced', 'kb-fast'],
        goalSolverPlan: ['gs-llm-deep', 'gs-llm-fast', 'gs-symbolic']
      };
    }

    if (symbolicCue || hasConstraintGuidance) {
      notes.push(hasConstraintGuidance ? 'constraint-guidance' : 'symbolic-cue');
      return {
        kbPlan: retrievalHeavy ? ['kb-thinkingdb', 'kb-balanced', 'kb-fast'] : ['kb-fast', 'kb-balanced', 'kb-thinkingdb'],
        goalSolverPlan: ['gs-symbolic', 'gs-llm-fast', 'gs-llm-deep']
      };
    }

    if (signals.preferDeepSolver || signals.hasGoalSolverGuidance) {
      notes.push(signals.preferDeepSolver ? 'goal-guidance-depth' : 'goal-guidance');
      return {
        kbPlan: retrievalHeavy ? ['kb-balanced', 'kb-thinkingdb', 'kb-fast'] : ['kb-fast', 'kb-balanced', 'kb-thinkingdb'],
        goalSolverPlan: ['gs-llm-fast', 'gs-llm-deep', 'gs-symbolic']
      };
    }

    if (hasProcedureGuidance) {
      notes.push('procedure-guidance');
      return {
        kbPlan: ['kb-balanced', 'kb-thinkingdb', 'kb-fast'],
        goalSolverPlan: ['gs-symbolic', 'gs-llm-fast', 'gs-llm-deep']
      };
    }

    if (retrievalHeavy && !wantsSpeed) {
      notes.push('retrieval-heavy');
      return {
        kbPlan: ['kb-balanced', 'kb-fast', 'kb-thinkingdb'],
        goalSolverPlan: ['gs-llm-fast', 'gs-symbolic', 'gs-llm-deep']
      };
    }

    notes.push(wantsSpeed ? 'speed-signals' : 'cheap-first');
    return cheapFirst;
  }

  _shouldDecompose(input, signals, explicit, notes) {
    if (explicit?.goalSolverPlugin) return false;
    if (signals.phase !== 'post-kb') return false;

    if (signals.avoidDecompose) {
      notes.push('decompose:blocked-by-guidance');
      return false;
    }
    if (signals.forceDecompose || signals.hasDecompositionGuidance) {
      notes.push(signals.forceDecompose ? 'decompose:explicit-guidance' : 'decompose:guidance-present');
      return true;
    }
    if (signals.hasGoalSolverGuidance && signals.hasValidationGuidance) {
      notes.push('decompose:method-already-grounded');
      return false;
    }

    if (signals.intentCount > 1 && !signals.hasStrategyGuidance) {
      notes.push('decompose:multi-intent-without-guidance');
      return true;
    }
    if (signals.intentCount > 1 && signals.retrievalHeavy && signals.wantsDepth && !signals.hasStrategyGuidance) {
      notes.push('decompose:retrieval-heavy-without-guidance');
      return true;
    }
    return false;
  }

  _framePurposeFor(signals) {
    if (signals.hasDecompositionGuidance || signals.forceDecompose) return 'subtask-decomposition';
    return signals.hasPlannerGuidance || signals.hasGoalSolverGuidance
      ? 'strategy-guidance'
      : 'subtask-decomposition';
  }
}
