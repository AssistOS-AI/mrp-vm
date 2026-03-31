// DS002 — MRP-VM Core Kernel
import { randomUUID } from 'node:crypto';
import { MRPError } from '../lib/errors.mjs';
import { logger } from '../lib/logger.mjs';

const MOD = 'core';

function unique(ids = []) {
  return [...new Set(ids.filter(Boolean))];
}

export class MRPEngine {
  constructor(config, pluginRegistry, conversationHandler, parser, decomposer,
    externalPluginManager, modelSettings, kbIndex, plannerStatsStore = null) {
    this.config = config;
    this.pluginRegistry = pluginRegistry;
    this.conversationHandler = conversationHandler;
    this.parser = parser;
    this.decomposer = decomposer;
    this.externalPluginManager = externalPluginManager;
    this.modelSettings = modelSettings;
    this.kbIndex = kbIndex;
    this.plannerStatsStore = plannerStatsStore;
    this.maxLLMAttempts = config.maxLLMAttemptsPerRequest ?? 5;
    this.requestTimeout = config.requestTimeoutMs ?? 60000;
    this.maxPluginsPerStage = config.maxPluginsPerStage ?? 4;
    this.maxFrameDepth = config.maxFrameDepth ?? 3;
    this.defaultPlannerPlugin = config.defaultPlannerPlugin || 'planner-default';
    this._ready = false;
  }

  isReady() { return this._ready; }
  setReady(v) { this._ready = v; }

  /**
   * DS002: Execute a child frame for task decomposition.
   * Re-runs the standard loop (seed → plan → kb → gs) on the
   * resolved intents from the parent frame, at depth + 1.
   */
  async _executeChildFrame(parentCtx, parentPlan, resolvedIntents, session, requestedModel, currentLLMCount, options = {}) {
    const childDepth = parentCtx.frameDepth + 1;
    const childFrameId = `frame-${parentCtx.requestId}-${childDepth}`;
    const childCtx = this._buildPluginContext(parentCtx.requestId, session, childFrameId, childDepth);
    let llmCallCount = currentLLMCount;

    // Re-seed from the resolved intents' markdown (the evidence bundle becomes the new input)
    const inputText = resolvedIntents.map(ri =>
      `[${ri.decomposed?.act}] ${ri.decomposed?.intent || ''}`
    ).join('. ');

    // Try seed detection on the decomposed input
    const seedCandidates = (options.seedDetectorOrder || this._defaultSeedDetectorOrder(null, null, session))
      .slice(0, this.maxPluginsPerStage);
    let seedResult = null;
    for (const pluginId of seedCandidates) {
      const plugin = this.pluginRegistry.get('sd-plugin', pluginId);
      if (!plugin) continue;
      const result = await plugin.detectSeeds({
        currentMessage: inputText,
        historyForPrompt: [],
        systemPrompt: options.systemPrompt || null,
        requestedModel,
        sessionModel: session.preferredModel
      }, childCtx);
      llmCallCount += result.metadata?.llmCalls || 0;
      if (result.status === 'success') { seedResult = result; break; }
    }
    if (!seedResult) return { goalResult: null, llmCallCount };

    const intentGroups = this.parser.parseIntentCNL(seedResult.intentCNL);
    if (!intentGroups.length) return { goalResult: null, llmCallCount };

    let currentTurnUnits = [];
    if (seedResult.currentTurnContextCNL?.trim()) {
      currentTurnUnits = this.parser.parseContextCNL(seedResult.currentTurnContextCNL);
    }
    const decomposed = this.decomposer.decompose(intentGroups);
    const profiles = decomposed.map(d => this.decomposer.deriveContextProfile(d));

    // KB retrieval in child frame
    const kbCandidates = (parentPlan.kbPluginOrder || []).slice(0, this.maxPluginsPerStage);
    let kbResult = null;
    for (const pluginId of kbCandidates) {
      const plugin = this.pluginRegistry.get('kb-plugin', pluginId);
      if (!plugin) continue;
      const result = await plugin.retrieve({
        decomposedIntents: decomposed, contextProfiles: profiles, currentTurnUnits, session,
        kbIndex: session.workspace?.getIndex() || this.kbIndex
      }, childCtx);
      if (result.status === 'success' || result.status === 'insufficient') {
        kbResult = result; break;
      }
    }
    if (!kbResult) return { goalResult: null, llmCallCount };

    // Goal solving in child frame
    const goalCandidates = (parentPlan.goalSolverOrder || []).slice(0, this.maxPluginsPerStage);
    for (const pluginId of goalCandidates) {
      const plugin = this.pluginRegistry.get('gs-plugin', pluginId);
      if (!plugin) continue;
      const result = await plugin.solve({
        sessionId: session.sessionId,
        resolvedIntents: kbResult.resolvedIntents || [],
        systemPrompt: null,
        requestedModel,
        sessionModel: session.preferredModel
      }, childCtx);
      llmCallCount += result.metadata?.llmCalls || 0;
      if (result.status === 'success') {
        return { goalResult: result, selectedGoalSolverPlugin: pluginId, llmCallCount };
      }
    }
    return { goalResult: null, llmCallCount };
  }

  _buildPluginContext(requestId, session, frameId = null, frameDepth = 0) {
    return {
      requestId,
      session,
      conversation: this.conversationHandler,
      parser: this.parser,
      decomposer: this.decomposer,
      externalHelpers: this.externalPluginManager,
      modelSettings: this.modelSettings,
      logger,
      budgets: {
        maxLLMAttemptsPerRequest: this.maxLLMAttempts,
        requestTimeoutMs: this.requestTimeout,
        maxPluginsPerStage: this.maxPluginsPerStage,
        maxFrameDepth: this.maxFrameDepth
      },
      frameId,
      frameDepth
    };
  }

  _cloneNode(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
  }

  _defaultSeedDetectorOrder(explicitSeedDetectorPlugin = null, requestedSeedDetectorPlugin = null, session = null) {
    return unique([
      explicitSeedDetectorPlugin,
      requestedSeedDetectorPlugin,
      session?.preferredSeedDetectorPlugin || null,
      this.config.defaultSeedDetectorPlugin || null,
      this.conversationHandler?.defaultSeedDetectorPlugin || null,
      ...(this.config.seedDetectorFallbackOrder || ['sd-symbolic', 'sd-llm-fast', 'sd-llm-deep']),
      ...((this.pluginRegistry?.listByType?.('sd-plugin') || []).map(item => item.id))
    ]).slice(0, this.maxPluginsPerStage);
  }

  _collectStrategyGuidanceUnits(kbResults = []) {
    const units = [];
    const seen = new Set();
    for (const kb of kbResults) {
      for (const ri of kb.result?.resolvedIntents || []) {
        for (const entry of ri.strategyUnits || []) {
          const key = entry?.unit?.hash || `${entry?.store || 'unknown'}:${entry?.unitId || entry?.unit?.id || ''}`;
          if (seen.has(key)) continue;
          seen.add(key);
          units.push(entry);
        }
      }
    }
    return units;
  }

  _pickBestKBResult(kbResults = []) {
    if (!kbResults.length) return null;
    return [...kbResults].sort((a, b) => {
      const aResolved = a.result?.resolvedIntents || [];
      const bResolved = b.result?.resolvedIntents || [];
      const aStrategy = aResolved.reduce((sum, ri) => sum + (ri.strategyUnits?.length || 0), 0);
      const bStrategy = bResolved.reduce((sum, ri) => sum + (ri.strategyUnits?.length || 0), 0);
      const aEvidence = aResolved.reduce((sum, ri) => sum +
        (ri.currentTurnContextUnits?.length || 0) +
        (ri.sessionUnits?.length || 0) +
        (ri.kbUnits?.length || 0), 0);
      const bEvidence = bResolved.reduce((sum, ri) => sum +
        (ri.currentTurnContextUnits?.length || 0) +
        (ri.sessionUnits?.length || 0) +
        (ri.kbUnits?.length || 0), 0);
      return Number(b.sufficient) - Number(a.sufficient) ||
        bStrategy - aStrategy ||
        bEvidence - aEvidence ||
        a.pluginId.localeCompare(b.pluginId);
    })[0];
  }

  async processChatTurn(request) {
    const requestId = `req-${randomUUID().substring(0, 12)}`;
    const startTime = Date.now();
    let llmCallCount = 0;
    let planner = null;
    let pluginCtx = null;
    const executionTrace = {
      requestId,
      sessionId: null,
      plannerPluginId: null,
      plannerAttempts: [],
      stages: [],
      finalStatus: 'failure',
      finalAnswerStatus: null,
      frameDepth: 0,
      frameTransitions: 0
    };

    const addStageTrace = (
      stage,
      pluginId,
      status,
      startedAt,
      llmCalls = 0,
      sufficient = null,
      error = null,
      model = null,
      modelRole = null,
      inputSnippet = null,
      outputSnippet = null
    ) => {
      executionTrace.stages.push({
        stage,
        plannerPluginId: executionTrace.plannerPluginId,
        pluginId,
        status,
        durationMs: Date.now() - startedAt,
        llmCalls,
        sufficient,
        error,
        model,
        modelRole,
        inputSnippet,
        outputSnippet
      });
    };

    const snip = (text, max = 300) => {
      if (!text) return null;
      const s = typeof text === 'string' ? text : JSON.stringify(text);
      return s.length <= max ? s : s.slice(0, max) + '…';
    };

    const checkBudget = () => {
      if (llmCallCount > this.maxLLMAttempts) {
        throw new MRPError(
          'ENGINE_BUDGET_EXCEEDED',
          MOD,
          `LLM attempt budget exhausted (${this.maxLLMAttempts})`
        );
      }
    };

    const getReservedLLMCalls = (plugin) => {
      const reserved = Number(plugin?.getDescriptor?.().maxLLMCalls ?? 0);
      if (!Number.isFinite(reserved) || reserved < 0) return 0;
      return reserved;
    };

    const reserveBudgetOrSkip = (stage, pluginId, plugin) => {
      const reserved = getReservedLLMCalls(plugin);
      const remaining = Math.max(0, this.maxLLMAttempts - llmCallCount);
      if (reserved <= remaining) return true;
      const startedAt = Date.now();
      addStageTrace(
        stage,
        pluginId,
        'skipped-budget',
        startedAt,
        0,
        null,
        {
          code: 'ENGINE_BUDGET_PRECHECK',
          message: `Skipping ${pluginId}: requires up to ${reserved} LLM calls, only ${remaining} remaining`
        },
        null,
        plugin?.getDescriptor?.().modelRoles?.[0] || null
      );
      return false;
    };

    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => {
        const error = new MRPError('ENGINE_TIMEOUT', MOD, 'Request timeout exceeded');
        error.requestId = requestId;
        error.sessionId = executionTrace.sessionId;
        reject(error);
      }, this.requestTimeout)
    );

    const processPromise = (async () => {
      let activeSession = null;
      try {
        const prepared = await this.conversationHandler.prepareTurn(
          request.session_id,
          request.messages,
          request.model,
          request.processing_mode,
          request.retrieval_profile,
          request.kb_id || null,
          request.planner_plugin || null,
          request.seed_detector_plugin || null,
          request.kb_plugin || null,
          request.goal_solver_plugin || null
        );

        const {
          session,
          currentMessage,
          historyForPrompt,
          systemPrompt,
          requestedModel,
          explicitPlannerPlugin,
          explicitSeedDetectorPlugin,
          explicitKBPlugin,
          explicitGoalSolverPlugin,
          requestedPlannerPlugin,
          requestedSeedDetectorPlugin,
          requestedKBPlugin,
          requestedGoalSolverPlugin
        } = prepared;
        activeSession = session;

        executionTrace.sessionId = session.sessionId;
        executionTrace.inputMessage = snip(currentMessage, 500);
        pluginCtx = this._buildPluginContext(requestId, session, `frame-${requestId}-0`, 0);
        const seedCandidates = this._defaultSeedDetectorOrder(
          explicitSeedDetectorPlugin ?? request.seed_detector_plugin ?? null,
          requestedSeedDetectorPlugin,
          session
        );
        executionTrace.seedDetectorCandidates = seedCandidates;
        let plannerCandidates = unique([
          requestedPlannerPlugin,
          session.preferredPlannerPlugin,
          this.defaultPlannerPlugin,
          ...(this.config.plannerFallbackOrder || []),
          ...this.pluginRegistry.listByType('mrp-plan-plugin').map(item => item.id)
        ]);
        if (!explicitPlannerPlugin && this.plannerStatsStore?.rankPlanners) {
          plannerCandidates = this.plannerStatsStore.rankPlanners(plannerCandidates);
        }
        plannerCandidates = plannerCandidates.slice(0, this.maxPluginsPerStage);
        executionTrace.plannerCandidates = plannerCandidates;

        const finalizeExecution = async (executed, plannerId) => {
          await this.conversationHandler.commitSuccessfulTurn(
            session,
            currentMessage,
            executed.goalResult.responseMarkdown,
            executed.currentTurnUnits,
            requestedModel,
            plannerId,
            executed.selectedSeedDetectorPlugin,
            executed.selectedKBPlugin,
            executed.selectedGoalSolverPlugin
          );

          executionTrace.plannerPluginId = plannerId;
          for (const stage of executionTrace.stages) {
            if (!stage.plannerPluginId) stage.plannerPluginId = plannerId;
          }
          executionTrace.finalStatus = 'success';
          executionTrace.finalAnswerStatus =
            executed.goalResult.status === 'no-context' ? 'no-context' : 'answered';

          const finalPlanner = this.pluginRegistry.get('mrp-plan-plugin', plannerId);
          await finalPlanner?.recordOutcome?.(executionTrace, pluginCtx);

          return {
            sessionId: session.sessionId,
            responseMarkdown: executed.goalResult.responseMarkdown,
            responseDocument: executed.goalResult.responseDocument,
            requestId,
            llmCallCount,
            durationMs: Date.now() - startTime,
            executionTrace
          };
        };

        const seedNodeSnapshot = { type: 'stage', stage: 'seed-detector', children: [] };
        let seedResult = null;
        let selectedSeedDetectorPlugin = null;
        for (const pluginId of seedCandidates) {
          const plugin = this.pluginRegistry.get('sd-plugin', pluginId);
          if (!plugin) continue;
          if (!reserveBudgetOrSkip('seed-detector', pluginId, plugin)) {
            seedNodeSnapshot.children.push({ type: 'plugin', pluginId, status: 'skipped-budget' });
            continue;
          }
          const startedAt = Date.now();
          const result = await plugin.detectSeeds({
            currentMessage,
            historyForPrompt,
            systemPrompt,
            requestedModel,
            sessionModel: session.preferredModel
          }, pluginCtx);
          llmCallCount += result.metadata?.llmCalls || 0;
          checkBudget();
          const pluginNode = {
            type: 'plugin',
            pluginId,
            status: result.status,
            durationMs: Date.now() - startedAt,
            llmCalls: result.metadata?.llmCalls || 0,
            model: result.metadata?.model || null,
            input: currentMessage,
            output: result.intentCNL || null,
            contextCNL: result.currentTurnContextCNL || null,
            error: result.error || null
          };
          seedNodeSnapshot.children.push(pluginNode);
          addStageTrace(
            'seed-detector',
            pluginId,
            result.status,
            startedAt,
            result.metadata?.llmCalls || 0,
            result.status === 'success',
            result.error || null,
            result.metadata?.model || null,
            plugin.getDescriptor().modelRoles?.[0] || null,
            snip(currentMessage),
            snip(result.intentCNL)
          );
          if (result.status === 'success') {
            seedResult = result;
            selectedSeedDetectorPlugin = pluginId;
            break;
          }
        }
        if (!seedResult) {
          throw new MRPError(
            'PLUGIN_STAGE_EXHAUSTED',
            MOD,
            'No seed detector plugin produced valid seeds',
            { stage: 'seed-detector', pluginsTried: seedCandidates }
          );
        }

        const intentGroups = this.parser.parseIntentCNL(seedResult.intentCNL);
        if (intentGroups.length === 0) {
          throw new MRPError('DECOMPOSER_EMPTY_RESULT', MOD, 'No intent groups produced');
        }
        let currentTurnUnits = [];
        if (seedResult.currentTurnContextCNL?.trim()) {
          currentTurnUnits = this.parser.parseContextCNL(seedResult.currentTurnContextCNL);
        }
        if (this.conversationHandler.stageDetectedContextUnits) {
          await this.conversationHandler.stageDetectedContextUnits(session, currentTurnUnits, {
            reason: 'seed-detection',
            scope: 'current-turn'
          });
        }
        const decomposedIntents = this.decomposer.decompose(intentGroups);
        const contextProfiles = decomposedIntents.map(d => this.decomposer.deriveContextProfile(d));
        const decomposeNodeSnapshot = {
          type: 'decompose',
          intentGroups: intentGroups.map(g => ({
            groupNumber: g.groupNumber,
            act: g.act,
            intent: g.intent,
            output: g.output
          })),
          contextProfiles: contextProfiles.map(p => ({
            intentGroupNumber: p.intentGroupNumber,
            neededRoles: p.neededRoles,
            queryTerms: p.queryTerms?.slice(0, 15)
          })),
          currentTurnUnitCount: currentTurnUnits.length
        };

        const buildPlannerInput = (overrides = {}) => ({
          request,
          phase: overrides.phase || 'post-seed',
          currentMessage,
          historyForPrompt,
          systemPrompt,
          intentGroups,
          decomposedIntents,
          contextProfiles,
          currentTurnUnits,
          strategyGuidanceUnits: overrides.strategyGuidanceUnits || [],
          kbResultSummaries: overrides.kbResultSummaries || [],
          priorPlan: overrides.priorPlan || null,
          explicitSelections: {
            seedDetectorPlugin:
              explicitSeedDetectorPlugin ??
              request.seed_detector_plugin ??
              null,
            kbPlugin:
              explicitKBPlugin ??
              request.kb_plugin ??
              null,
            goalSolverPlugin:
              explicitGoalSolverPlugin ??
              request.goal_solver_plugin ??
              null
          },
          sessionPreferences: {
            seedDetectorPlugin: session.preferredSeedDetectorPlugin,
            kbPlugin: session.preferredKBPlugin,
            goalSolverPlugin: session.preferredGoalSolverPlugin
          },
          sessionState: {
            sessionId: session.sessionId,
            mountedKbId: session.mountedKbId || null,
            mountedKbName: session.mountedKbName || null,
            messageCount: session.messageLog?.length || 0,
            sessionContextUnitCount: session.sessionContextUnits?.length || 0,
            pendingTurnContextUnitCount: session.pendingTurnContextUnits?.length || 0
          }
        });

        const executePlan = async (plan, plannerPluginInstance) => {
          const planNode = {
            type: 'plan',
            plannerPluginId: plan.plannerPluginId,
            notes: plan.notes,
            framePurpose: plan.framePurpose || null,
            seedDetectorOrder: seedCandidates,
            kbPluginOrder: plan.kbPluginOrder,
            goalSolverOrder: plan.goalSolverOrder,
            children: []
          };
          executionTrace.trees = executionTrace.trees || [];
          executionTrace.trees.push(planNode);
          planNode.children.push(this._cloneNode(seedNodeSnapshot));
          planNode.children.push(this._cloneNode(decomposeNodeSnapshot));

          // --- KB retrieval (collect all results for backtracking) ---
          const kbNode = { type: 'stage', stage: 'kb', children: [] };
          planNode.children.push(kbNode);
          const kbResults = []; // ordered best-first
          const kbCandidates = (plan.kbPluginOrder || []).slice(0, this.maxPluginsPerStage);
          for (const pluginId of kbCandidates) {
            const plugin = this.pluginRegistry.get('kb-plugin', pluginId);
            if (!plugin) continue;
            const startedAt = Date.now();
            const result = await plugin.retrieve({
              decomposedIntents, contextProfiles, currentTurnUnits, session,
              kbIndex: session.workspace?.getIndex() || this.kbIndex
            }, pluginCtx);
            const evidenceCount = (result.resolvedIntents || []).reduce((s, ri) =>
              s + (ri.currentTurnContextUnits?.length || 0) + (ri.sessionUnits?.length || 0) + (ri.kbUnits?.length || 0), 0);
            const strategyCount = (result.resolvedIntents || []).reduce((s, ri) =>
              s + (ri.strategyUnits?.length || 0), 0);
            const riSummary = (result.resolvedIntents || []).map(ri => ({
              intentRef: ri.intentRef,
              act: ri.decomposed?.act,
              intent: ri.decomposed?.intent || '',
              retrievalProfile: ri.retrievalProfile || '',
              strategyCount: ri.strategyUnits?.length || 0,
              currentTurnCount: ri.currentTurnContextUnits?.length || 0,
              sessionCount: ri.sessionUnits?.length || 0,
              kbCount: ri.kbUnits?.length || 0,
              currentTurnClaims: (ri.currentTurnContextUnits || []).slice(0, 3).map(u => `[${u.role}] ${u.claim || u.procedure || ''}`).filter(Boolean),
              sessionClaims: (ri.sessionUnits || []).slice(0, 3).map(u => `[${u.unit?.role}] ${u.unit?.claim || u.unit?.procedure || ''} (${u.score?.toFixed(2)})`).filter(Boolean),
              kbClaims: (ri.kbUnits || []).slice(0, 5).map(u => `[${u.unit?.role}] ${u.unit?.claim || u.unit?.procedure || ''} (${u.score?.toFixed(2)})`).filter(Boolean),
              resolvedMarkdown: ri.resolvedMarkdown || null
            }));
            kbNode.children.push({
              type: 'plugin', pluginId, status: result.status,
              durationMs: Date.now() - startedAt,
              sufficient: result.sufficient,
              evidenceCount,
              strategyCount,
              resolvedIntents: riSummary,
              input: decomposedIntents.map(d => `[${d.act}] ${d.intent}`).join('\n'),
              error: result.error || null
            });
            addStageTrace('kb', pluginId, result.status, startedAt, 0,
              result.sufficient, result.error || null, null, null,
              snip(contextProfiles.map(p => p.queryText).join(' | ')),
              snip(`${evidenceCount} evidence units, strategy=${strategyCount}, sufficient=${result.sufficient}`));
            if (result.status === 'success' || result.status === 'insufficient') {
              kbResults.push({ result, pluginId, sufficient: result.status === 'success' });
            }
          }
          if (!kbResults.length) {
            throw new MRPError('PLUGIN_STAGE_EXHAUSTED', MOD,
              'No KB plugin produced a retrieval result',
              { stage: 'kb', pluginsTried: kbCandidates });
          }

          const strategyGuidanceUnits = this._collectStrategyGuidanceUnits(kbResults);
          const kbResultSummaries = kbResults.map(kb => {
            const resolved = kb.result?.resolvedIntents || [];
            return {
              pluginId: kb.pluginId,
              sufficient: kb.sufficient,
              evidenceCount: resolved.reduce((sum, ri) =>
                sum +
                (ri.currentTurnContextUnits?.length || 0) +
                (ri.sessionUnits?.length || 0) +
                (ri.kbUnits?.length || 0), 0),
              strategyUnitCount: resolved.reduce((sum, ri) => sum + (ri.strategyUnits?.length || 0), 0)
            };
          });
          let refinedPlan = plan;
          if (plannerPluginInstance?.buildPlan) {
            const replanned = await plannerPluginInstance.buildPlan(
              buildPlannerInput({
                phase: 'post-kb',
                strategyGuidanceUnits,
                kbResultSummaries,
                priorPlan: plan
              }),
              pluginCtx
            );
            if (replanned) {
              refinedPlan = {
                ...plan,
                ...replanned,
                plannerPluginId: replanned.plannerPluginId || plan.plannerPluginId,
                kbPluginOrder: replanned.kbPluginOrder || plan.kbPluginOrder,
                goalSolverOrder: replanned.goalSolverOrder || plan.goalSolverOrder,
                notes: replanned.notes || plan.notes,
                framePurpose: replanned.framePurpose ?? plan.framePurpose ?? null,
                decompose: replanned.decompose ?? false
              };
            }
          }
          planNode.kbPluginOrder = refinedPlan.kbPluginOrder;
          planNode.goalSolverOrder = refinedPlan.goalSolverOrder;
          planNode.framePurpose = refinedPlan.framePurpose || null;
          if (strategyGuidanceUnits.length > 0) {
            planNode.strategyGuidanceUnitCount = strategyGuidanceUnits.length;
          }

          // --- Goal solving with KB backtracking ---
          const goalNode = { type: 'stage', stage: 'goal-solver', children: [] };
          planNode.children.push(goalNode);
          let goalResult = null;
          let selectedGoalSolverPlugin = null;
          let selectedKBPlugin = null;
          let kbSufficient = false;
          let weakGoalResult = null;
          let weakGoalSolverPlugin = null;
          let weakKBPlugin = null;
          let weakKBSufficient = false;
          const goalCandidates = (refinedPlan.goalSolverOrder || []).slice(0, this.maxPluginsPerStage);

          executionTrace.lastPlan = {
            plannerPluginId: refinedPlan.plannerPluginId,
            seedDetectorOrder: seedCandidates,
            kbPluginOrder: refinedPlan.kbPluginOrder,
            goalSolverOrder: refinedPlan.goalSolverOrder,
            decompose: !!refinedPlan.decompose,
            framePurpose: refinedPlan.framePurpose || null,
            notes: refinedPlan.notes || []
          };

          if (refinedPlan.decompose) {
            if (pluginCtx.frameDepth >= this.maxFrameDepth) {
              throw new MRPError(
                'FRAME_DEPTH_EXCEEDED',
                MOD,
                'Planner requested decomposition beyond the configured frame depth'
              );
            }
            const bestKB = this._pickBestKBResult(kbResults);
            if (bestKB?.result?.resolvedIntents?.length) {
              try {
                const childResult = await this._executeChildFrame(
                  pluginCtx,
                  refinedPlan,
                  bestKB.result.resolvedIntents,
                  session,
                  requestedModel,
                  llmCallCount,
                  {
                    seedDetectorOrder: seedCandidates,
                    systemPrompt
                  }
                );
                llmCallCount = childResult.llmCallCount;
                if (childResult.goalResult?.status === 'success') {
                  executionTrace.frameTransitions = (executionTrace.frameTransitions || 0) + 1;
                  executionTrace.framePurpose = refinedPlan.framePurpose || null;
                  return {
                    goalResult: childResult.goalResult,
                    currentTurnUnits,
                    selectedSeedDetectorPlugin,
                    selectedKBPlugin: bestKB.pluginId,
                    selectedGoalSolverPlugin: childResult.selectedGoalSolverPlugin || goalCandidates[0] || null,
                    kbSufficient: bestKB.sufficient,
                    weakOutcome: false
                  };
                }
              } catch {
                // Fall through to direct solver attempts if the child frame fails.
              }
            }
          }

          for (const kb of kbResults) {
            const resolvedIntentsForKB = kb.result.resolvedIntents || [];
            for (const pluginId of goalCandidates) {
              const plugin = this.pluginRegistry.get('gs-plugin', pluginId);
              if (!plugin) continue;
              if (!reserveBudgetOrSkip('goal-solver', pluginId, plugin)) {
                goalNode.children.push({ type: 'plugin', pluginId, status: 'skipped-budget' });
                continue;
              }
              const startedAt = Date.now();
              const result = await plugin.solve({
                sessionId: session.sessionId, resolvedIntents: resolvedIntentsForKB, systemPrompt,
                requestedModel, sessionModel: session.preferredModel
              }, pluginCtx);
              llmCallCount += result.metadata?.llmCalls || 0;
              checkBudget();
              goalNode.children.push({
                type: 'plugin', pluginId, status: result.status,
                durationMs: Date.now() - startedAt,
                llmCalls: result.metadata?.llmCalls || 0,
                model: result.metadata?.model || null,
                kbPluginId: kb.pluginId,
                input: resolvedIntentsForKB.map(ri => `[${ri.decomposed?.act}] ${ri.decomposed?.intent || ''}`).join('\n'),
                output: result.responseMarkdown || null,
                error: result.error || null
              });
              addStageTrace('goal-solver', pluginId, result.status, startedAt,
                result.metadata?.llmCalls || 0,
                result.status === 'success' ? true : result.status === 'no-context' ? false : null,
                result.error || null, result.metadata?.model || null,
                plugin.getDescriptor().modelRoles?.[0] || null,
                snip(`${resolvedIntentsForKB.length} resolved intents (kb:${kb.pluginId})`),
                snip(result.responseMarkdown));
              if (result.status === 'success') {
                goalResult = result; selectedGoalSolverPlugin = pluginId;
                selectedKBPlugin = kb.pluginId; kbSufficient = kb.sufficient;
                break;
              }
              if (result.status === 'needs-decomposition') {
                addStageTrace('goal-solver', pluginId, 'needs-decomposition', startedAt,
                  result.metadata?.llmCalls || 0, false, null,
                  result.metadata?.model || null,
                  plugin.getDescriptor().modelRoles?.[0] || null,
                  null, snip('needs-decomposition'));
                // DS002: attempt child-frame decomposition if depth budget allows
                if (pluginCtx.frameDepth < this.maxFrameDepth) {
                  try {
                    const childResult = await this._executeChildFrame(
                      pluginCtx,
                      refinedPlan,
                      resolvedIntentsForKB,
                      session,
                      requestedModel,
                      llmCallCount,
                      {
                        seedDetectorOrder: seedCandidates,
                        systemPrompt
                      }
                    );
                    llmCallCount = childResult.llmCallCount;
                    if (childResult.goalResult?.status === 'success') {
                      goalResult = childResult.goalResult;
                      selectedGoalSolverPlugin = childResult.selectedGoalSolverPlugin || pluginId;
                      selectedKBPlugin = kb.pluginId; kbSufficient = kb.sufficient;
                      executionTrace.frameTransitions = (executionTrace.frameTransitions || 0) + 1;
                      break;
                    }
                  } catch { /* child frame failed, continue backtracking */ }
                }
                continue;
              }
              if (result.status === 'no-context' && !weakGoalResult) {
                weakGoalResult = result; weakGoalSolverPlugin = pluginId;
                weakKBPlugin = kb.pluginId; weakKBSufficient = kb.sufficient;
              }
            }
            if (goalResult) break; // found a good answer, stop backtracking
          }

          if (!goalResult && weakGoalResult) {
            goalResult = weakGoalResult; selectedGoalSolverPlugin = weakGoalSolverPlugin;
            selectedKBPlugin = weakKBPlugin; kbSufficient = weakKBSufficient;
          }
          if (!goalResult) {
            throw new MRPError('PLUGIN_STAGE_EXHAUSTED', MOD,
              'No goal solver plugin produced a final answer',
              { stage: 'goal-solver', pluginsTried: goalCandidates });
          }

          const resolvedIntents = (kbResults.find(k => k.pluginId === selectedKBPlugin) || kbResults[0]).result.resolvedIntents || [];

          // --- Validation ---
          const valCandidates = this.pluginRegistry.listByType('val-plugin').map(d => d.id);
          let validationVerdict = 'accepted';
          let validationReason = '';
          if (valCandidates.length > 0 && goalResult.status === 'success') {
            const valNode = { type: 'stage', stage: 'validation', children: [] };
            planNode.children.push(valNode);
            for (const valId of valCandidates.slice(0, this.maxPluginsPerStage)) {
              const valPlugin = this.pluginRegistry.get('val-plugin', valId);
              if (!valPlugin) continue;
              if (!reserveBudgetOrSkip('validation', valId, valPlugin)) {
                valNode.children.push({ type: 'plugin', pluginId: valId, status: 'skipped-budget' });
                continue;
              }
              const startedAt = Date.now();
              const valResult = await valPlugin.validate({
                originalMessage: currentMessage,
                responseMarkdown: goalResult.responseMarkdown,
                resolvedIntents,
                requestedModel,
                sessionModel: session.preferredModel
              }, pluginCtx);
              llmCallCount += valResult.metadata?.llmCalls || 0;
              checkBudget();
              valNode.children.push({
                type: 'plugin', pluginId: valId, status: valResult.status,
                durationMs: Date.now() - startedAt,
                llmCalls: valResult.metadata?.llmCalls || 0,
                model: valResult.metadata?.model || null,
                input: currentMessage,
                output: `${valResult.verdict}: ${valResult.reason}`,
                error: valResult.error || null
              });
              addStageTrace('validation', valId, valResult.status, startedAt,
                valResult.metadata?.llmCalls || 0, valResult.verdict === 'accepted',
                valResult.error || null, valResult.metadata?.model || null,
                valPlugin.getDescriptor().modelRoles?.[0] || null,
                snip(currentMessage), snip(`${valResult.verdict}: ${valResult.reason}`));
              validationVerdict = valResult.verdict;
              validationReason = valResult.reason;
              break;
            }
          }
          if (validationVerdict === 'rejected') {
            throw new MRPError(
              'VALIDATION_REJECTED',
              MOD,
              `Validation rejected: ${validationReason}`,
              {
                goalSolverPlugin: selectedGoalSolverPlugin,
                kbPlugin: selectedKBPlugin,
                reason: validationReason
              }
            );
          }

          return {
            goalResult,
            currentTurnUnits,
            selectedSeedDetectorPlugin,
            selectedKBPlugin,
            selectedGoalSolverPlugin,
            kbSufficient,
            weakOutcome: goalResult.status === 'no-context'
          };
        };

        let lastError = null;
        let lastWeakExecution = null;
        const retryablePlannerErrors = new Set([
          'PLUGIN_STAGE_EXHAUSTED',
          'ENGINE_BUDGET_EXCEEDED',
          'DECOMPOSER_EMPTY_RESULT',
          'PLAN_INSUFFICIENT_EVIDENCE',
          'VALIDATION_REJECTED',
          'FRAME_DEPTH_EXCEEDED'
        ]);

        for (const plannerId of plannerCandidates) {
          planner = this.pluginRegistry.get('mrp-plan-plugin', plannerId);
          if (!planner) continue;
          executionTrace.plannerPluginId = planner.getDescriptor().id;
          executionTrace.plannerAttempts.push(planner.getDescriptor().id);

          try {
            const plan = await planner.buildPlan(
              buildPlannerInput({ phase: 'post-seed' }),
              pluginCtx
            );

            const executed = await executePlan(plan, planner);
            if (executed.weakOutcome && executed.kbSufficient === false) {
              lastWeakExecution = {
                executed,
                plannerPluginId: planner.getDescriptor().id
              };
              throw new MRPError(
                'PLAN_INSUFFICIENT_EVIDENCE',
                MOD,
                'Planner produced only weak no-context output after insufficient retrieval evidence',
                {
                  plannerPluginId: planner.getDescriptor().id,
                  seedDetectorPlugin: executed.selectedSeedDetectorPlugin,
                  kbPlugin: executed.selectedKBPlugin,
                  goalSolverPlugin: executed.selectedGoalSolverPlugin
                }
              );
            }

            return finalizeExecution(executed, planner.getDescriptor().id);
          } catch (error) {
            lastError = error;
            const explicitPlannerPinned = !!explicitPlannerPlugin;
            const retryable = error instanceof MRPError && retryablePlannerErrors.has(error.code);
            if (explicitPlannerPinned || !retryable) break;
          }
        }

        if (lastWeakExecution) {
          return finalizeExecution(
            lastWeakExecution.executed,
            lastWeakExecution.plannerPluginId
          );
        }

        throw lastError || new MRPError(
          'PLAN_STAGE_EXHAUSTED',
          MOD,
          'No planner plugin could produce an executable plan'
        );
      } catch (error) {
        if (planner) {
          try {
            await planner.recordOutcome(executionTrace, pluginCtx);
          } catch (plannerError) {
            logger.warn(MOD, `Planner outcome recording failed: ${plannerError.message}`);
          }
        }
        if (error instanceof MRPError) {
          error.requestId = error.requestId || requestId;
          error.sessionId = error.sessionId || executionTrace.sessionId || null;
        }
        throw error;
      } finally {
        if (activeSession && this.conversationHandler.clearPendingTurnContext) {
          this.conversationHandler.clearPendingTurnContext(activeSession);
        }
      }
    })();

    return Promise.race([processPromise, timeoutPromise]);
  }
}
