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
    this.defaultPlannerPlugin = config.defaultPlannerPlugin || 'planner-default';
    this._ready = false;
  }

  isReady() { return this._ready; }
  setReady(v) { this._ready = v; }

  _buildPluginContext(requestId, session) {
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
        maxPluginsPerStage: this.maxPluginsPerStage
      }
    };
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
      finalAnswerStatus: null
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
      modelRole = null
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
        modelRole
      });
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

        executionTrace.sessionId = session.sessionId;
        pluginCtx = this._buildPluginContext(requestId, session);
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

        const finalizeExecution = async (executed, plannerId) => {
          this.conversationHandler.commitSuccessfulTurn(
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

        const executePlan = async (plan) => {
          let seedResult = null;
          let selectedSeedDetectorPlugin = null;
          const seedCandidates = (plan.seedDetectorOrder || []).slice(0, this.maxPluginsPerStage);
          for (const pluginId of seedCandidates) {
            const plugin = this.pluginRegistry.get('sd-plugin', pluginId);
            if (!plugin) continue;
            if (!reserveBudgetOrSkip('seed-detector', pluginId, plugin)) continue;
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
            addStageTrace(
              'seed-detector',
              pluginId,
              result.status,
              startedAt,
              result.metadata?.llmCalls || 0,
              result.status === 'success',
              result.error || null,
              result.metadata?.model || null,
              plugin.getDescriptor().modelRoles?.[0] || null
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

          const decomposedIntents = this.decomposer.decompose(intentGroups);
          const contextProfiles = decomposedIntents.map(d => this.decomposer.deriveContextProfile(d));

          let kbResult = null;
          let selectedKBPlugin = null;
          let kbSufficient = false;
          const kbCandidates = (plan.kbPluginOrder || []).slice(0, this.maxPluginsPerStage);
          for (const pluginId of kbCandidates) {
            const plugin = this.pluginRegistry.get('kb-plugin', pluginId);
            if (!plugin) continue;
            const startedAt = Date.now();
            const result = await plugin.retrieve({
              decomposedIntents,
              contextProfiles,
              currentTurnUnits,
              session,
              kbIndex: session.workspace?.getIndex() || this.kbIndex
            }, pluginCtx);
            addStageTrace(
              'kb',
              pluginId,
              result.status,
              startedAt,
              0,
              result.sufficient,
              result.error || null
            );
            if (result.status === 'success') {
              kbResult = result;
              selectedKBPlugin = pluginId;
              kbSufficient = true;
              break;
            }
            if (result.status === 'insufficient') {
              kbResult = result;
              selectedKBPlugin = pluginId;
              kbSufficient = false;
            }
          }
          if (!kbResult) {
            throw new MRPError(
              'PLUGIN_STAGE_EXHAUSTED',
              MOD,
              'No KB plugin produced a retrieval result',
              { stage: 'kb', pluginsTried: kbCandidates }
            );
          }

          const resolvedIntents = kbResult.resolvedIntents || [];

          let goalResult = null;
          let selectedGoalSolverPlugin = null;
          let weakGoalResult = null;
          let weakGoalSolverPlugin = null;
          const goalCandidates = (plan.goalSolverOrder || []).slice(0, this.maxPluginsPerStage);
          for (const pluginId of goalCandidates) {
            const plugin = this.pluginRegistry.get('gs-plugin', pluginId);
            if (!plugin) continue;
            if (!reserveBudgetOrSkip('goal-solver', pluginId, plugin)) continue;
            const startedAt = Date.now();
            const result = await plugin.solve({
              sessionId: session.sessionId,
              resolvedIntents,
              systemPrompt,
              requestedModel,
              sessionModel: session.preferredModel
            }, pluginCtx);
            llmCallCount += result.metadata?.llmCalls || 0;
            checkBudget();
            addStageTrace(
              'goal-solver',
              pluginId,
              result.status,
              startedAt,
              result.metadata?.llmCalls || 0,
              result.status === 'success' ? true : result.status === 'no-context' ? false : null,
              result.error || null,
              result.metadata?.model || null,
              plugin.getDescriptor().modelRoles?.[0] || null
            );
            if (result.status === 'success') {
              goalResult = result;
              selectedGoalSolverPlugin = pluginId;
              break;
            }
            if (result.status === 'no-context') {
              weakGoalResult = result;
              weakGoalSolverPlugin = pluginId;
            }
          }
          if (!goalResult && weakGoalResult) {
            goalResult = weakGoalResult;
            selectedGoalSolverPlugin = weakGoalSolverPlugin;
          }
          if (!goalResult) {
            throw new MRPError(
              'PLUGIN_STAGE_EXHAUSTED',
              MOD,
              'No goal solver plugin produced a final answer',
              { stage: 'goal-solver', pluginsTried: goalCandidates }
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
          'PLAN_INSUFFICIENT_EVIDENCE'
        ]);

        for (const plannerId of plannerCandidates) {
          planner = this.pluginRegistry.get('mrp-plan-plugin', plannerId);
          if (!planner) continue;
          executionTrace.plannerPluginId = planner.getDescriptor().id;
          executionTrace.plannerAttempts.push(planner.getDescriptor().id);

          try {
            const plan = await planner.buildPlan({
              request,
              currentMessage,
              historyForPrompt,
              systemPrompt,
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
              }
            }, pluginCtx);

            const executed = await executePlan(plan);
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
      }
    })();

    return Promise.race([processPromise, timeoutPromise]);
  }
}
