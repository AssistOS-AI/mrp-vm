// DS002 — MRP-VM Core Kernel
import { randomUUID } from 'node:crypto';
import { MRPError } from '../lib/errors.mjs';
import { logger } from '../lib/logger.mjs';

const MOD = 'core';

export class MRPEngine {
  constructor(config, pluginRegistry, conversationHandler, parser, decomposer,
    externalPluginManager, modelSettings, kbIndex) {
    this.config = config;
    this.pluginRegistry = pluginRegistry;
    this.conversationHandler = conversationHandler;
    this.parser = parser;
    this.decomposer = decomposer;
    this.externalPluginManager = externalPluginManager;
    this.modelSettings = modelSettings;
    this.kbIndex = kbIndex;
    this.maxLLMAttempts = config.maxLLMAttemptsPerRequest || 6;
    this.requestTimeout = config.requestTimeoutMs || 60000;
    this.maxPluginsPerStage = config.maxPluginsPerStage || 4;
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
      stages: [],
      finalStatus: 'failure'
    };

    const addStageTrace = (stage, pluginId, status, startedAt, llmCalls = 0, sufficient = null, error = null) => {
      executionTrace.stages.push({
        stage,
        pluginId,
        status,
        durationMs: Date.now() - startedAt,
        llmCalls,
        sufficient,
        error
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

    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new MRPError('ENGINE_TIMEOUT', MOD, 'Request timeout exceeded')), this.requestTimeout)
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
          requestedPlannerPlugin,
          requestedSeedDetectorPlugin,
          requestedKBPlugin,
          requestedGoalSolverPlugin
        } = prepared;

        executionTrace.sessionId = session.sessionId;
        pluginCtx = this._buildPluginContext(requestId, session);

        planner = this.pluginRegistry.resolve(
          'mrp-plan-plugin',
          requestedPlannerPlugin,
          session.preferredPlannerPlugin,
          this.defaultPlannerPlugin
        );
        executionTrace.plannerPluginId = planner.getDescriptor().id;

        const plan = await planner.buildPlan({
          request,
          currentMessage,
          historyForPrompt,
          systemPrompt,
          explicitSelections: {
            seedDetectorPlugin: requestedSeedDetectorPlugin,
            kbPlugin: requestedKBPlugin,
            goalSolverPlugin: requestedGoalSolverPlugin
          },
          sessionPreferences: {
            seedDetectorPlugin: session.preferredSeedDetectorPlugin,
            kbPlugin: session.preferredKBPlugin,
            goalSolverPlugin: session.preferredGoalSolverPlugin
          }
        }, pluginCtx);

        let seedResult = null;
        let selectedSeedDetectorPlugin = null;
        const seedCandidates = (plan.seedDetectorOrder || []).slice(0, this.maxPluginsPerStage);
        for (const pluginId of seedCandidates) {
          const plugin = this.pluginRegistry.get('sd-plugin', pluginId);
          if (!plugin) continue;
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
            result.error || null
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
            break;
          }
          if (result.status === 'insufficient') {
            kbResult = result;
            selectedKBPlugin = pluginId;
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
        const pluginOutputs = [];
        for (const ri of resolvedIntents) {
          const manifest = this.externalPluginManager.selectPlugin(ri.intentGroup);
          if (!manifest) continue;
          const po = await this.externalPluginManager.invoke(manifest, ri.resolvedMarkdown);
          po.intentRef = ri.intentRef;
          pluginOutputs.push(po);
        }

        let goalResult = null;
        let selectedGoalSolverPlugin = null;
        const goalCandidates = (plan.goalSolverOrder || []).slice(0, this.maxPluginsPerStage);
        for (const pluginId of goalCandidates) {
          const plugin = this.pluginRegistry.get('gs-plugin', pluginId);
          if (!plugin) continue;
          const startedAt = Date.now();
          const result = await plugin.solve({
            sessionId: session.sessionId,
            resolvedIntents,
            pluginOutputs,
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
            result.status === 'success',
            result.error || null
          );
          if (result.status === 'success') {
            goalResult = result;
            selectedGoalSolverPlugin = pluginId;
            break;
          }
        }
        if (!goalResult) {
          throw new MRPError(
            'PLUGIN_STAGE_EXHAUSTED',
            MOD,
            'No goal solver plugin produced a final answer',
            { stage: 'goal-solver', pluginsTried: goalCandidates }
          );
        }

        this.conversationHandler.commitSuccessfulTurn(
          session,
          currentMessage,
          goalResult.responseMarkdown,
          currentTurnUnits,
          requestedModel,
          request.processing_mode || null,
          request.retrieval_profile || null,
          planner.getDescriptor().id,
          selectedSeedDetectorPlugin,
          selectedKBPlugin,
          selectedGoalSolverPlugin
        );

        executionTrace.finalStatus = 'success';
        await planner.recordOutcome(executionTrace, pluginCtx);

        return {
          sessionId: session.sessionId,
          responseMarkdown: goalResult.responseMarkdown,
          responseDocument: goalResult.responseDocument,
          requestId,
          llmCallCount,
          durationMs: Date.now() - startTime,
          executionTrace
        };
      } catch (error) {
        if (planner) {
          try {
            await planner.recordOutcome(executionTrace, pluginCtx);
          } catch (plannerError) {
            logger.warn(MOD, `Planner outcome recording failed: ${plannerError.message}`);
          }
        }
        throw error;
      }
    })();

    return Promise.race([processPromise, timeoutPromise]);
  }
}
