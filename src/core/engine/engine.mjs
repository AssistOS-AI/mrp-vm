// DS002 — MRP-VM Core Kernel
import { randomUUID } from 'node:crypto';
import { MRPError } from '../platform/errors.mjs';
import { logger } from '../platform/logger.mjs';
import { buildExecutionGraph } from './trace-builder.mjs';
import { comparisonHelperMethods } from './comparison-helpers.mjs';
import { traceStateHelperMethods } from './trace-state-helpers.mjs';
import {
  createDeliberationPolicy,
  createExecutionFrame,
  normalizeDeliberationLevel
} from './runtime-objects.mjs';

const MOD = 'core';

function unique(ids = []) {
  return [...new Set(ids.filter(Boolean))];
}

function snipCandidateLabel(text, max = 80) {
  const normalized = String(text || '').replace(/\s+/g, ' ').trim();
  if (!normalized) return 'candidate';
  return normalized.length <= max ? normalized : `${normalized.slice(0, max)}…`;
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

  _createBudgetState(initialLLMCalls = 0) {
    return { llmCallCount: Math.max(0, Number(initialLLMCalls) || 0) };
  }

  _consumeLLMCalls(budgetState, result = null) {
    budgetState.llmCallCount += result?.metadata?.llmCalls || 0;
  }

  _checkBudgetState(budgetState) {
    if (budgetState.llmCallCount > this.maxLLMAttempts) {
      throw new MRPError(
        'ENGINE_BUDGET_EXCEEDED',
        MOD,
        `LLM attempt budget exhausted (${this.maxLLMAttempts})`
      );
    }
  }

  _getReservedLLMCalls(plugin) {
    const reserved = Number(plugin?.getDescriptor?.().maxLLMCalls ?? 0);
    if (!Number.isFinite(reserved) || reserved < 0) return 0;
    return reserved;
  }

  _reserveBudgetOrSkip(budgetState, stage, pluginId, plugin, addStageTrace = null) {
    const reserved = this._getReservedLLMCalls(plugin);
    const remaining = Math.max(0, this.maxLLMAttempts - budgetState.llmCallCount);
    if (reserved <= remaining) return true;
    if (addStageTrace) {
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
    }
    return false;
  }

  _guidanceEntryKey(entry = null) {
    return entry?.unit?.hash || `${entry?.store || 'unknown'}:${entry?.unitId || entry?.unit?.id || ''}`;
  }

  _dedupeGuidanceEntries(entries = []) {
    const deduped = [];
    const seen = new Set();
    for (const entry of entries) {
      const key = this._guidanceEntryKey(entry);
      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push(entry);
    }
    return deduped;
  }

  _collectCommonGuidanceEntries(resolvedIntents = [], scope = 'goalSolver') {
    if (!resolvedIntents.length) return [];
    const scopedMaps = resolvedIntents.map(intent => new Map(
      (intent.guidanceUnits?.[scope] || []).map(entry => [this._guidanceEntryKey(entry), entry])
    ));
    if (!scopedMaps.length) return [];
    const commonKeys = new Set(scopedMaps[0].keys());
    for (const scopedMap of scopedMaps.slice(1)) {
      for (const key of [...commonKeys]) {
        if (!scopedMap.has(key)) commonKeys.delete(key);
      }
    }
    return this._dedupeGuidanceEntries(
      [...commonKeys].map(key => scopedMaps[0].get(key)).filter(Boolean)
    );
  }

  _emitProgress(reporter, payload) {
    if (typeof reporter !== 'function') return;
    try {
      reporter({
        timestamp: new Date().toISOString(),
        ...payload
      });
    } catch (error) {
      logger.warn(MOD, `Progress reporter failed: ${error.message}`);
    }
  }

  /**
   * DS002: Execute a child frame for task decomposition.
   * Re-runs the standard loop (seed → plan → kb → gs) on the
   * resolved intents from the parent frame, at depth + 1.
   */
  async _executeChildFrame(parentCtx, parentPlan, resolvedIntents, session, requestedModel, budgetState, options = {}) {
    const childDepth = parentCtx.frameDepth + 1;
    const childTrace = parentCtx.executionTrace || null;
    const childFrameId = childTrace
      ? this._allocateFrameId(parentCtx.requestId, childTrace)
      : `frame-${parentCtx.requestId}-${childDepth}`;
    const childDeliberationPolicy = this._resolveDeliberationPolicy(
      options.deliberationLevel ?? parentCtx.deliberationPolicy?.level ?? 0,
      parentCtx.deliberationPolicy,
      parentPlan?.deliberationPolicy || null
    );
    const childCtx = this._buildPluginContext(
      parentCtx.requestId,
      session,
      childFrameId,
      childDepth,
      childTrace,
      childDeliberationPolicy
    );
    const emitProgress = payload => this._emitProgress(options.onProgress, {
      requestId: parentCtx.requestId,
      sessionId: session.sessionId,
      frameId: childFrameId,
      frameDepth: childDepth,
      ...payload
    });
    if (childTrace) {
      this._ensureFrameRecord(childTrace, createExecutionFrame({
        frameId: childFrameId,
        parentFrameId: parentCtx.frameId,
        requestId: parentCtx.requestId,
        depth: childDepth,
        maxDepth: this.maxFrameDepth,
        status: 'active',
        purpose: parentPlan.framePurpose || 'decomposition',
        seedDetails: [],
        deliberationPolicy: childDeliberationPolicy,
        deliberationStatus: childDeliberationPolicy.level > 0 ? 'exploring' : 'single-shot',
        budgets: {
          remainingLLMCalls: Math.max(0, this.maxLLMAttempts - (budgetState?.llmCallCount || 0)),
          remainingTimeMs: null
        },
        localState: {
          intents: [],
          currentTurnKUs: [],
          retrievedKUs: [],
          partialResults: [],
          plan: null
        },
        comparisonState: {}
      }));
    }

    emitProgress({
      type: 'frame',
      event: 'start',
      purpose: parentPlan.framePurpose || null,
      message: `Opening child frame ${childDepth}`
    });

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
      if (!this._reserveBudgetOrSkip(budgetState, 'seed-detector', pluginId, plugin)) continue;
      emitProgress({
        type: 'stage',
        event: 'start',
        stage: 'seed-detector',
        pluginId,
        message: `Child frame: running seed detector ${pluginId}`
      });
      const result = await plugin.detectSeeds({
        currentMessage: inputText,
        historyForPrompt: [],
        systemPrompt: options.systemPrompt || null,
        requestedModel,
        sessionModel: session.preferredModel
      }, childCtx);
      this._consumeLLMCalls(budgetState, result);
      this._checkBudgetState(budgetState);
      emitProgress({
        type: 'stage',
        event: 'finish',
        stage: 'seed-detector',
        pluginId,
        status: result.status,
        llmCalls: result.metadata?.llmCalls || 0,
        message: `Child frame: seed detector ${pluginId} finished with ${result.status}`
      });
      if (result.status === 'success') { seedResult = result; break; }
    }
    if (!seedResult) {
      this._patchFrameRecord(childTrace, childFrameId, {
        status: 'failed',
        budgets: {
          remainingLLMCalls: Math.max(0, this.maxLLMAttempts - (budgetState?.llmCallCount || 0))
        }
      });
      emitProgress({
        type: 'frame',
        event: 'finish',
        status: 'failed',
        message: `Child frame ${childDepth} did not produce seeds`
      });
      return { goalResult: null, llmCallCount: budgetState.llmCallCount };
    }

    const admittedSeedDocs = this._admitSeedDocuments(seedResult, childFrameId);
    const {
      intentGroups,
      currentTurnUnits,
      seedDetails
    } = admittedSeedDocs;
    if (!intentGroups.length) {
      this._patchFrameRecord(childTrace, childFrameId, {
        status: 'failed',
        budgets: {
          remainingLLMCalls: Math.max(0, this.maxLLMAttempts - (budgetState?.llmCallCount || 0))
        }
      });
      emitProgress({
        type: 'frame',
        event: 'finish',
        status: 'failed',
        message: `Child frame ${childDepth} produced no intents`
      });
      return { goalResult: null, llmCallCount: budgetState.llmCallCount };
    }
    this._patchFrameRecord(childTrace, childFrameId, {
      seedDetails,
      localState: {
        intents: intentGroups,
        currentTurnKUs: currentTurnUnits
      }
    });
    const decomposed = this.decomposer.decompose(intentGroups);
    const profiles = decomposed.map(d => this.decomposer.deriveContextProfile(d));

    const plannerPluginId =
      options.plannerPluginId ||
      parentPlan.plannerPluginId ||
      this.defaultPlannerPlugin;
    const planner = plannerPluginId
      ? this.pluginRegistry.get('mrp-plan-plugin', plannerPluginId)
      : null;
    const buildPlannerInput = (overrides = {}) => ({
      request: options.request || null,
      phase: overrides.phase || 'post-seed',
      currentMessage: inputText,
      historyForPrompt: [],
      systemPrompt: options.systemPrompt || null,
      intentGroups,
      decomposedIntents: decomposed,
      contextProfiles: profiles,
      currentTurnUnits,
      strategyGuidanceUnits: overrides.strategyGuidanceUnits || [],
      plannerGuidanceUnits: overrides.plannerGuidanceUnits || [],
      goalSolverGuidanceUnits: overrides.goalSolverGuidanceUnits || [],
      decompositionGuidanceUnits: overrides.decompositionGuidanceUnits || [],
      validationGuidanceUnits: overrides.validationGuidanceUnits || [],
      seedDetectorGuidanceUnits: overrides.seedDetectorGuidanceUnits || [],
      kbResultSummaries: overrides.kbResultSummaries || [],
      priorPlan: overrides.priorPlan || null,
      explicitSelections: options.explicitSelections || {},
      sessionPreferences: options.sessionPreferences || {
        seedDetectorPlugin: session.preferredSeedDetectorPlugin,
        kbPlugin: session.preferredKBPlugin,
        goalSolverPlugin: session.preferredGoalSolverPlugin,
        deliberationLevel: session.preferredDeliberationLevel ?? childDeliberationPolicy.level
      },
      sessionState: {
        sessionId: session.sessionId,
        mountedKbId: session.mountedKbId || null,
        mountedKbName: session.mountedKbName || null,
        messageCount: session.messageLog?.length || 0,
        sessionContextUnitCount: session.sessionContextUnits?.length || 0,
        pendingTurnContextUnitCount: session.pendingTurnContextUnits?.length || 0,
        deliberationLevel: childDeliberationPolicy.level
      }
    });

    let childPlan = {
      ...parentPlan,
      plannerPluginId,
      kbPluginOrder: parentPlan.kbPluginOrder || [],
      goalSolverOrder: parentPlan.goalSolverOrder || []
    };
    if (planner?.buildPlan) {
      emitProgress({
        type: 'planner',
        event: 'start',
        plannerPluginId,
        phase: 'post-seed',
        message: `Child frame: planning with ${plannerPluginId}`
      });
      const planned = await planner.buildPlan(
        buildPlannerInput({
          phase: 'post-seed',
          priorPlan: parentPlan
        }),
        childCtx
      );
      if (planned) {
        childPlan = {
          ...childPlan,
          ...planned,
          plannerPluginId: planned.plannerPluginId || plannerPluginId,
          kbPluginOrder: planned.kbPluginOrder || childPlan.kbPluginOrder,
          goalSolverOrder: planned.goalSolverOrder || childPlan.goalSolverOrder,
          notes: planned.notes || childPlan.notes || [],
          framePurpose: planned.framePurpose ?? childPlan.framePurpose ?? null,
          decompose: planned.decompose ?? false
        };
      }
      emitProgress({
        type: 'planner',
        event: 'finish',
        plannerPluginId: childPlan.plannerPluginId,
        phase: 'post-seed',
        status: 'success',
        message: `Child frame: planner selected ${childPlan.kbPluginOrder?.[0] || 'kb-auto'} -> ${childPlan.goalSolverOrder?.[0] || 'gs-auto'}`
      });
    }

    // KB retrieval in child frame
    const kbCandidates = (childPlan.kbPluginOrder || []).slice(0, this.maxPluginsPerStage);
    const kbResults = [];
    for (const pluginId of kbCandidates) {
      const plugin = this.pluginRegistry.get('kb-plugin', pluginId);
      if (!plugin) continue;
      emitProgress({
        type: 'stage',
        event: 'start',
        stage: 'kb',
        pluginId,
        message: `Child frame: retrieving context with ${pluginId}`
      });
      const result = await plugin.retrieve({
        decomposedIntents: decomposed, contextProfiles: profiles, currentTurnUnits, session,
        kbIndex: session.workspace?.getIndex() || this.kbIndex
      }, childCtx);
      emitProgress({
        type: 'stage',
        event: 'finish',
        stage: 'kb',
        pluginId,
        status: result.status,
        message: `Child frame: KB plugin ${pluginId} finished with ${result.status}`
      });
      if (result.status === 'success' || result.status === 'insufficient') {
        kbResults.push({ result, pluginId, sufficient: result.status === 'success' });
      }
    }
    if (!kbResults.length) {
      this._patchFrameRecord(childTrace, childFrameId, {
        status: 'failed',
        budgets: {
          remainingLLMCalls: Math.max(0, this.maxLLMAttempts - (budgetState?.llmCallCount || 0))
        }
      });
      emitProgress({
        type: 'frame',
        event: 'finish',
        status: 'failed',
        message: `Child frame ${childDepth} could not retrieve context`
      });
      return { goalResult: null, llmCallCount: budgetState.llmCallCount };
    }

    const strategyGuidanceUnits = this._collectStrategyGuidanceUnits(kbResults);
    const plannerGuidanceUnits = this._collectScopedGuidanceUnits(kbResults, 'planner');
    const goalSolverGuidanceUnits = this._collectScopedGuidanceUnits(kbResults, 'goalSolver');
    const decompositionGuidanceUnits = this._collectScopedGuidanceUnits(kbResults, 'decomposition');
    const validationGuidanceUnits = this._collectScopedGuidanceUnits(kbResults, 'validation');
    const seedDetectorGuidanceUnits = this._collectScopedGuidanceUnits(kbResults, 'seedDetector');
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

    let refinedPlan = childPlan;
    if (planner?.buildPlan) {
      emitProgress({
        type: 'planner',
        event: 'start',
        plannerPluginId: childPlan.plannerPluginId,
        phase: 'post-kb',
        message: `Child frame: replanning after retrieval`
      });
      const replanned = await planner.buildPlan(
        buildPlannerInput({
          phase: 'post-kb',
          strategyGuidanceUnits,
          plannerGuidanceUnits,
          goalSolverGuidanceUnits,
          decompositionGuidanceUnits,
          validationGuidanceUnits,
          seedDetectorGuidanceUnits,
          kbResultSummaries,
          priorPlan: childPlan
        }),
        childCtx
      );
      if (replanned) {
        refinedPlan = {
          ...childPlan,
          ...replanned,
          plannerPluginId: replanned.plannerPluginId || childPlan.plannerPluginId,
          kbPluginOrder: replanned.kbPluginOrder || childPlan.kbPluginOrder,
          goalSolverOrder: replanned.goalSolverOrder || childPlan.goalSolverOrder,
          notes: replanned.notes || childPlan.notes || [],
          framePurpose: replanned.framePurpose ?? childPlan.framePurpose ?? null,
          decompose: replanned.decompose ?? false
        };
      }
      emitProgress({
        type: 'planner',
        event: 'finish',
        plannerPluginId: refinedPlan.plannerPluginId,
        phase: 'post-kb',
        status: 'success',
        message: `Child frame: planner refined route to ${refinedPlan.goalSolverOrder?.[0] || 'gs-auto'}`
      });
    }
    this._patchFrameRecord(childTrace, childFrameId, {
      localState: {
        plan: {
          plannerPluginId: refinedPlan.plannerPluginId,
          kbPluginOrder: refinedPlan.kbPluginOrder,
          goalSolverOrder: refinedPlan.goalSolverOrder,
          decompose: !!refinedPlan.decompose,
          framePurpose: refinedPlan.framePurpose || null,
          notes: refinedPlan.notes || []
        }
      }
    });

    if (refinedPlan.decompose) {
      if (childDepth >= this.maxFrameDepth) {
        throw new MRPError(
          'FRAME_DEPTH_EXCEEDED',
          MOD,
          'Planner requested decomposition beyond the configured frame depth'
        );
      }
      const bestKB = this._pickBestKBResult(kbResults);
      if (bestKB?.result?.resolvedIntents?.length) {
        const currentSignature = this._resolvedIntentSignature(resolvedIntents);
        const nextSignature = this._resolvedIntentSignature(bestKB.result.resolvedIntents);
        if (currentSignature && currentSignature === nextSignature) {
          emitProgress({
            type: 'frame',
            event: 'info',
            status: 'stalled-decomposition',
            message: 'Child frame detected no-progress decomposition and will try direct solving'
          });
        } else {
          const nestedResult = await this._executeChildFrame(
            childCtx,
            refinedPlan,
            bestKB.result.resolvedIntents,
            session,
            requestedModel,
            budgetState,
            {
              ...options,
              plannerPluginId: refinedPlan.plannerPluginId || plannerPluginId,
              systemPrompt: options.systemPrompt || null
            }
          );
          this._patchFrameRecord(childTrace, childFrameId, {
            status: nestedResult?.goalResult ? 'succeeded' : 'failed',
            budgets: {
              remainingLLMCalls: Math.max(0, this.maxLLMAttempts - (budgetState?.llmCallCount || 0))
            }
          });
          return nestedResult;
        }
      }
    }

    // Goal solving in child frame
    const goalCandidates = (refinedPlan.goalSolverOrder || []).slice(0, this.maxPluginsPerStage);
    const totalGoalAttempts = kbResults.length * Math.max(1, goalCandidates.length);
    let goalResult = null;
    let selectedGoalSolverPlugin = null;
    let selectedKBPlugin = null;
    let selectedBranchIds = [];
    let candidateExecutions = [];
    let weakGoalResult = null;
    let weakGoalSolverPlugin = null;
    let weakKBPlugin = null;
    let weakBranchIds = [];
    let executionOrder = 0;
    let startedGoalAttempts = 0;
    for (const kb of kbResults) {
      const resolvedIntentsForKB = kb.result.resolvedIntents || [];
      const guidanceUnits = this._collectCommonGuidanceEntries(resolvedIntentsForKB, 'goalSolver');
      for (const pluginId of goalCandidates) {
        const plugin = this.pluginRegistry.get('gs-plugin', pluginId);
        if (!plugin) continue;
        if (!this._reserveBudgetOrSkip(budgetState, 'goal-solver', pluginId, plugin)) continue;
        emitProgress({
          type: 'stage',
          event: 'start',
          stage: 'goal-solver',
          pluginId,
          kbPluginId: kb.pluginId,
          message: `Child frame: solving with ${pluginId}`
        });
        startedGoalAttempts += 1;
        const result = await plugin.solve({
          sessionId: session.sessionId,
          resolvedIntents: resolvedIntentsForKB,
          guidanceUnits,
          systemPrompt: options.systemPrompt || null,
          requestedModel,
          sessionModel: session.preferredModel
        }, childCtx);
        this._consumeLLMCalls(budgetState, result);
        this._checkBudgetState(budgetState);
        emitProgress({
          type: 'stage',
          event: 'finish',
          stage: 'goal-solver',
          pluginId,
          kbPluginId: kb.pluginId,
          status: result.status,
          llmCalls: result.metadata?.llmCalls || 0,
          message: `Child frame: goal solver ${pluginId} finished with ${result.status}`
        });
        const activeBranches = childTrace
          ? resolvedIntentsForKB.map(ri => {
            const intentGroup = intentGroups.find(group => group.groupNumber === ri.intentRef) || null;
            const seed = seedDetails.find(candidate => candidate.intentGroupNumber === ri.intentRef) || seedDetails[0] || null;
            const familySignature = this._deriveBranchFamilySignature(seed, ri, kb.pluginId, pluginId);
            return this._recordBranchAttempt(childTrace, {
              frameId: childFrameId,
              intentId: intentGroup?.intentId || `intent-${ri.intentRef}`,
              seedId: seed?.seedId || null,
              pluginId,
              kbPluginId: kb.pluginId,
              plannerPluginId: refinedPlan.plannerPluginId || plannerPluginId || null,
              status: 'active',
              outputPreview: result.responseMarkdown || null,
              evidenceProfileHash: this._resolvedIntentSignature(resolvedIntentsForKB),
              familySignature
            });
          })
          : [];
        if (result.status === 'success') {
          candidateExecutions.push({
            order: executionOrder++,
            goalResult: result,
            goalSolverPlugin: pluginId,
            kbPlugin: kb.pluginId,
            kbSufficient: kb.sufficient,
            branchIds: activeBranches.map(branch => branch.branchId),
            branches: activeBranches,
            resolvedIntents: resolvedIntentsForKB,
            familyKey: this._summarizeExecutionFamily(activeBranches),
            familyCount: new Set(activeBranches.map(branch => branch.familySignature || 'default')).size,
            validationVerdict: null,
            validationReason: ''
          });
          if (!this._shouldContinueComparativeExploration(
            childDeliberationPolicy,
            candidateExecutions,
            { remainingAttempts: Math.max(0, totalGoalAttempts - startedGoalAttempts) }
          )) {
            const selectedExecution = this._selectComparativeOutcome(candidateExecutions, childDeliberationPolicy);
            goalResult = selectedExecution?.goalResult || result;
            selectedGoalSolverPlugin = selectedExecution?.goalSolverPlugin || pluginId;
            selectedKBPlugin = selectedExecution?.kbPlugin || kb.pluginId;
            selectedBranchIds = selectedExecution?.branchIds || activeBranches.map(branch => branch.branchId);
            break;
          }
          continue;
        }
        if (result.status === 'needs-decomposition' && childDepth < this.maxFrameDepth) {
          for (const branch of activeBranches) {
            this._patchBranchAttempt(childTrace, branch.branchId, {
              status: 'failed',
              error: { code: 'NEEDS_DECOMPOSITION', message: 'Goal solver requested decomposition' }
            });
            this._recordFailure(childTrace, {
              frameId: branch.frameId,
              branchId: branch.branchId,
              seedId: branch.seedId,
              pluginId,
              reason: 'needs-decomposition',
              error: { code: 'NEEDS_DECOMPOSITION', message: 'Goal solver requested decomposition' },
              evidenceProfileHash: branch.evidenceProfileHash
            });
          }
          const nestedResult = await this._executeChildFrame(
            childCtx,
            refinedPlan,
            resolvedIntentsForKB,
            session,
            requestedModel,
            budgetState,
            {
              ...options,
              plannerPluginId: refinedPlan.plannerPluginId || plannerPluginId
            }
          );
          this._patchFrameRecord(childTrace, childFrameId, {
            status: nestedResult?.goalResult ? 'succeeded' : 'failed',
            budgets: {
              remainingLLMCalls: Math.max(0, this.maxLLMAttempts - (budgetState?.llmCallCount || 0))
            }
          });
          return nestedResult;
        }
        if (result.status === 'no-context' && !weakGoalResult) {
          weakGoalResult = result;
          weakGoalSolverPlugin = pluginId;
          weakKBPlugin = kb.pluginId;
          weakBranchIds = activeBranches.map(branch => branch.branchId);
          continue;
        }
        for (const branch of activeBranches) {
          this._patchBranchAttempt(childTrace, branch.branchId, {
            status: 'failed',
            error: result.error || { code: 'GOAL_NO_CONTEXT', message: 'Goal solver returned no-context' }
          });
          this._recordFailure(childTrace, {
            frameId: branch.frameId,
            branchId: branch.branchId,
            seedId: branch.seedId,
            pluginId,
            reason: result.status || 'error',
            error: result.error || { code: 'GOAL_NO_CONTEXT', message: 'Goal solver returned no-context' },
            evidenceProfileHash: branch.evidenceProfileHash
          });
        }
      }
      if (goalResult) break;
    }
    if (!goalResult && candidateExecutions.length > 0) {
      const selectedExecution = this._selectComparativeOutcome(candidateExecutions, childDeliberationPolicy);
      goalResult = selectedExecution?.goalResult || null;
      selectedGoalSolverPlugin = selectedExecution?.goalSolverPlugin || null;
      selectedKBPlugin = selectedExecution?.kbPlugin || null;
      selectedBranchIds = selectedExecution?.branchIds || [];
    }
    if (!goalResult && weakGoalResult) {
      goalResult = weakGoalResult;
      selectedGoalSolverPlugin = weakGoalSolverPlugin;
      selectedKBPlugin = weakKBPlugin;
      selectedBranchIds = weakBranchIds;
    } else if (goalResult && weakBranchIds.length > 0) {
      for (const branchId of weakBranchIds) {
        const branch = this._patchBranchAttempt(childTrace, branchId, {
          status: 'failed',
          error: { code: 'GOAL_NO_CONTEXT', message: 'Replaced by a stronger goal result' }
        });
        if (!branch) continue;
        this._recordFailure(childTrace, {
          frameId: branch.frameId,
          branchId: branch.branchId,
          seedId: branch.seedId,
          pluginId: branch.pluginId,
          reason: 'superseded',
          error: { code: 'GOAL_NO_CONTEXT', message: 'Replaced by a stronger goal result' },
          evidenceProfileHash: branch.evidenceProfileHash
        });
      }
    }
    if (goalResult) {
      const selectedResolvedIntents =
        (kbResults.find(item => item.pluginId === selectedKBPlugin) || kbResults[0])?.result?.resolvedIntents || [];
      const childSelectedBranchIdSet = new Set(selectedBranchIds || []);
      const childCandidateSet = candidateExecutions.map(outcome => {
        const branchIds = outcome.branchIds || [];
        const representativeBranch = outcome.branches?.[0]
          || childTrace?.branches?.find(branch => branch.branchId === branchIds[0])
          || null;
        const selected = branchIds.some(branchId => childSelectedBranchIdSet.has(branchId));
        for (const branchId of branchIds) {
          this._patchBranchAttempt(childTrace, branchId, { status: 'succeeded' });
        }
        return this._buildCandidateRecord({
          frameId: representativeBranch?.frameId || childFrameId,
          branchId: representativeBranch?.branchId || branchIds[0] || null,
          branchIds,
          resultId: representativeBranch?.resultId || branchIds[0] || null,
          resultBody: outcome.goalResult?.responseMarkdown || null,
          familySignature: outcome.familyKey || representativeBranch?.familySignature || null,
          validationStatus: selected ? 'accepted' : 'candidate',
          kbSufficient: !!outcome.kbSufficient,
          selected,
          score: this._scoreExecutionOutcome(outcome, childDeliberationPolicy),
          strength: this._deriveOutcomeStrength(outcome)
        });
      });
      const childComparisonState = this._buildComparisonState(
        childCandidateSet,
        childDeliberationPolicy,
        'accepted',
        ''
      );
      const childSuspendedSet = candidateExecutions
        .filter(outcome => !(outcome.branchIds || []).some(branchId => childSelectedBranchIdSet.has(branchId)))
        .flatMap(outcome => outcome.branchIds || []);
      this._patchFrameRecord(childTrace, childFrameId, {
        status: 'succeeded',
        budgets: {
          remainingLLMCalls: Math.max(0, this.maxLLMAttempts - (budgetState?.llmCallCount || 0))
        },
        candidateSet: childCandidateSet,
        comparisonState: childComparisonState,
        suspendedSet: childSuspendedSet,
        deliberationStatus: childComparisonState.openQuestions.length > 0 ? 'comparative_open' : 'settled',
        localState: {
          retrievedKUs: selectedResolvedIntents.map(ri => ({
            intentRef: ri.intentRef,
            currentTurnCount: ri.currentTurnContextUnits?.length || 0,
            sessionCount: ri.sessionUnits?.length || 0,
            kbCount: ri.kbUnits?.length || 0
          }))
        }
      });
      emitProgress({
        type: 'frame',
        event: 'finish',
        status: 'success',
        message: `Child frame ${childDepth} solved successfully`
      });
      return {
        goalResult,
        selectedGoalSolverPlugin,
        selectedKBPlugin,
        llmCallCount: budgetState.llmCallCount,
        selectedBranchIds,
        candidateExecutions
      };
    }
    emitProgress({
      type: 'frame',
      event: 'finish',
      status: 'failed',
      message: `Child frame ${childDepth} did not produce an answer`
    });
    this._patchFrameRecord(childTrace, childFrameId, {
      status: 'failed',
      budgets: {
        remainingLLMCalls: Math.max(0, this.maxLLMAttempts - (budgetState?.llmCallCount || 0))
      }
    });
    return { goalResult: null, llmCallCount: budgetState.llmCallCount };
  }

  _buildPluginContext(requestId, session, frameId = null, frameDepth = 0, executionTrace = null, deliberationPolicy = null) {
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
      frameDepth,
      executionTrace,
      deliberationPolicy
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

  _collectScopedGuidanceUnits(kbResults = [], scope = 'goalSolver') {
    const units = [];
    const seen = new Set();
    for (const kb of kbResults) {
      for (const ri of kb.result?.resolvedIntents || []) {
        for (const entry of ri.guidanceUnits?.[scope] || []) {
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

  _resolvedIntentSignature(resolvedIntents = []) {
    return resolvedIntents
      .map(ri => `${ri.decomposed?.act || ''}:${ri.decomposed?.intent || ''}`)
      .join('|');
  }

  _remainingBudgetSnapshot(budgetState, startTime) {
    return {
      remainingLLMCalls: Math.max(0, this.maxLLMAttempts - (budgetState?.llmCallCount || 0)),
      remainingTimeMs: Math.max(0, this.requestTimeout - (Date.now() - startTime))
    };
  }

  _resolveDeliberationPolicy(level, parentPolicy = null, overrides = null) {
    return createDeliberationPolicy({
      ...(overrides || {}),
      level: normalizeDeliberationLevel(level, parentPolicy?.level ?? 0)
    }, parentPolicy);
  }

  async processChatTurn(request) {
    const requestId = `req-${randomUUID().substring(0, 12)}`;
    const startTime = Date.now();
    const budgetState = this._createBudgetState(0);
        let planner = null;
        let pluginCtx = null;
        let prepared = null;
        const executionTrace = {
      requestId,
      sessionId: null,
      rootFrameId: null,
      deliberationLevel: 0,
      deliberationPolicy: null,
      plannerPluginId: null,
      plannerAttempts: [],
      stages: [],
      frames: [],
      branches: [],
      results: [],
      failures: [],
      graph: { rootFrameId: null, nodes: [], edges: [] },
      finalStatus: 'failure',
      finalAnswerStatus: null,
      frameDepth: 0,
      frameTransitions: 0,
      _frameSequence: 0
    };

    const emitProgress = payload => this._emitProgress(request.onProgress, {
      requestId,
      sessionId: executionTrace.sessionId,
      frameId: pluginCtx?.frameId || null,
      frameDepth: pluginCtx?.frameDepth || 0,
      ...payload
    });

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
      outputSnippet = null,
      kbPluginId = null
    ) => {
      executionTrace.stages.push({
        stage,
        frameId: pluginCtx?.frameId || null,
        plannerPluginId: executionTrace.plannerPluginId,
        pluginId,
        kbPluginId,
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
      emitProgress({
        type: 'stage',
        event: 'finish',
        stage,
        pluginId,
        status,
        llmCalls,
        sufficient,
        model,
        modelRole,
        error,
        message: `${stage} ${pluginId} finished with ${status}`
      });
    };

    const snip = (text, max = 300) => {
      if (!text) return null;
      const s = typeof text === 'string' ? text : JSON.stringify(text);
      return s.length <= max ? s : s.slice(0, max) + '…';
    };

    const checkBudget = () => this._checkBudgetState(budgetState);
    const reserveBudgetOrSkip = (stage, pluginId, plugin) =>
      this._reserveBudgetOrSkip(budgetState, stage, pluginId, plugin, addStageTrace);

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
        prepared = await this.conversationHandler.prepareTurn(
          request.session_id,
          request.messages,
          request.model,
          request.kb_id || null,
          request.planner_plugin || null,
          request.seed_detector_plugin || null,
          request.kb_plugin || null,
          request.goal_solver_plugin || null,
          request.deliberation_level ?? null
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
          requestedDeliberationLevel,
          requestedPlannerPlugin,
          requestedSeedDetectorPlugin,
          requestedKBPlugin,
          requestedGoalSolverPlugin
        } = prepared;
        activeSession = session;

        executionTrace.sessionId = session.sessionId;
        executionTrace.inputMessage = snip(currentMessage, 500);
        executionTrace.deliberationLevel = requestedDeliberationLevel ?? 0;
        executionTrace.deliberationPolicy = this._resolveDeliberationPolicy(requestedDeliberationLevel ?? 0);
        const rootFrameId = this._allocateFrameId(requestId, executionTrace);
        pluginCtx = this._buildPluginContext(
          requestId,
          session,
          rootFrameId,
          0,
          executionTrace,
          executionTrace.deliberationPolicy
        );
        executionTrace.rootFrameId = rootFrameId;
        emitProgress({
          type: 'request',
          event: 'start',
          message: 'Processing chat turn'
        });
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
          executionTrace.plannerPluginId = plannerId;
          for (const stage of executionTrace.stages) {
            if (!stage.plannerPluginId) stage.plannerPluginId = plannerId;
          }
          executionTrace.finalStatus = 'success';
          executionTrace.finalAnswerStatus =
            executed.goalResult.status === 'no-context' ? 'no-context' : 'answered';
          const resolvedFrame = this._patchFrameRecord(executionTrace, pluginCtx.frameId, {
            deliberationStatus: executed.goalResult.status === 'no-context' ? 'fallback' : 'settled'
          });
          const executionOutcomes = executed.candidateExecutions?.length
            ? executed.candidateExecutions
            : [{
                order: 0,
                goalResult: executed.goalResult,
                goalSolverPlugin: executed.selectedGoalSolverPlugin,
                kbPlugin: executed.selectedKBPlugin,
                kbSufficient: executed.kbSufficient,
                branchIds: executed.selectedBranchIds || [],
                branches: (executed.selectedBranchIds || [])
                  .map(branchId => executionTrace.branches.find(branch => branch.branchId === branchId))
                  .filter(Boolean),
                resolvedIntents: [],
                familyKey: this._summarizeExecutionFamily(
                  (executed.selectedBranchIds || [])
                    .map(branchId => executionTrace.branches.find(branch => branch.branchId === branchId))
                    .filter(Boolean)
                ),
                familyCount: new Set(
                  (executed.selectedBranchIds || [])
                    .map(branchId => executionTrace.branches.find(branch => branch.branchId === branchId)?.familySignature || 'default')
                ).size
              }];
          const selectedBranchIdSet = new Set(executed.selectedBranchIds || []);
          const candidateSet = [];
          for (const outcome of executionOutcomes) {
            const branchIds = outcome.branchIds || [];
            const rejectedByValidation = outcome.validationVerdict === 'rejected';
            const representativeBranch = outcome.branches?.[0]
              || executionTrace.branches.find(branch => branch.branchId === branchIds[0])
              || null;
            const recordedResultIds = [];
            for (const branchId of branchIds) {
              const branch = this._patchBranchAttempt(executionTrace, branchId, {
                status: rejectedByValidation ? 'failed' : 'succeeded'
              });
              if (!branch) continue;
              const resultRecord = this._recordResult(executionTrace, {
                frameId: branch.frameId,
                branchId,
                kind: outcome.goalResult?.status === 'no-context' ? 'no-context' : 'answer',
                validationStatus: rejectedByValidation
                  ? 'rejected'
                  : selectedBranchIdSet.has(branchId)
                    ? (executed.validationVerdict || executionTrace.finalAnswerStatus)
                    : (outcome.validationVerdict || 'candidate'),
                preservesConstraints: outcome.goalResult?.status === 'no-context' ? 'unknown' : 'yes',
                structuralComplete: outcome.goalResult?.status === 'no-context' ? 'partial' : 'yes',
                body: outcome.goalResult?.responseMarkdown || null
              });
              this._patchBranchAttempt(executionTrace, branchId, { resultId: resultRecord.resultId });
              recordedResultIds.push(resultRecord.resultId);
            }
            if (!representativeBranch && !recordedResultIds.length) continue;
            const selected = !rejectedByValidation
              && branchIds.some(branchId => selectedBranchIdSet.has(branchId));
            candidateSet.push(this._buildCandidateRecord({
              frameId: representativeBranch?.frameId || pluginCtx.frameId,
              branchId: representativeBranch?.branchId || branchIds[0] || null,
              branchIds,
              resultId: recordedResultIds[0] || representativeBranch?.resultId || null,
              resultBody: outcome.goalResult?.responseMarkdown || null,
              familySignature: outcome.familyKey || representativeBranch?.familySignature || null,
              validationStatus: rejectedByValidation
                ? 'rejected'
                : selected
                  ? (executed.validationVerdict || executionTrace.finalAnswerStatus)
                  : (outcome.validationVerdict || 'candidate'),
              kbSufficient: !!outcome.kbSufficient,
              selected,
              score: this._scoreExecutionOutcome(outcome, resolvedFrame?.deliberationPolicy || executionTrace.deliberationPolicy),
              strength: rejectedByValidation ? 'weak' : this._deriveOutcomeStrength(outcome)
            }));
          }
          const comparisonState = this._buildComparisonState(
            candidateSet,
            resolvedFrame?.deliberationPolicy || executionTrace.deliberationPolicy,
            executed.validationVerdict,
            executed.validationReason
          );
          const suspendedSet = executionOutcomes
            .filter(outcome =>
              outcome.validationVerdict !== 'rejected'
              && !(outcome.branchIds || []).some(branchId => selectedBranchIdSet.has(branchId))
            )
            .flatMap(outcome => outcome.branchIds || []);
          this._patchFrameRecord(executionTrace, pluginCtx.frameId, {
            status: 'succeeded',
            budgets: this._remainingBudgetSnapshot(budgetState, startTime),
            candidateSet,
            comparisonState,
            suspendedSet,
            deliberationStatus: comparisonState.openQuestions.length > 0 ? 'comparative_open' : 'settled',
            localState: {
              partialResults: executionTrace.results,
              plan: executionTrace.lastPlan || null
            }
          });
          executionTrace.graph = buildExecutionGraph(executionTrace);

          await this.conversationHandler.commitSuccessfulTurn(
            session,
            currentMessage,
            executed.goalResult.responseMarkdown,
            executed.currentTurnUnits,
            requestedModel,
            plannerId,
            executed.selectedSeedDetectorPlugin,
            executed.selectedKBPlugin,
            executed.selectedGoalSolverPlugin,
            {
              requestId,
              createdAt: new Date().toISOString(),
            answerStatus: executed.goalResult.status === 'no-context' ? 'no-context' : 'answered',
            responseDocument: executed.goalResult.responseDocument || null,
            executionTrace: executionTrace || null
            }
          );

          const finalPlanner = this.pluginRegistry.get('mrp-plan-plugin', plannerId);
          await finalPlanner?.recordOutcome?.(executionTrace, pluginCtx);

          emitProgress({
            type: 'response',
            event: 'ready',
            plannerPluginId: plannerId,
            message: 'Response is ready'
          });

          return {
            sessionId: session.sessionId,
            responseMarkdown: executed.goalResult.responseMarkdown,
            responseDocument: executed.goalResult.responseDocument,
            requestId,
            llmCallCount: budgetState.llmCallCount,
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
          emitProgress({
            type: 'stage',
            event: 'start',
            stage: 'seed-detector',
            pluginId,
            message: `Running seed detector ${pluginId}`
          });
          const result = await plugin.detectSeeds({
            currentMessage,
            historyForPrompt,
            systemPrompt,
            requestedModel,
            sessionModel: session.preferredModel
          }, pluginCtx);
          this._consumeLLMCalls(budgetState, result);
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

        const admittedSeedDocs = this._admitSeedDocuments(seedResult, pluginCtx.frameId);
        const { intentGroups, currentTurnUnits, interpretedIntentDoc, seedDetails } = admittedSeedDocs;
        if (intentGroups.length === 0) {
          throw new MRPError('DECOMPOSER_EMPTY_RESULT', MOD, 'No intent groups produced');
        }
        if (this.conversationHandler.stageDetectedContextUnits) {
          await this.conversationHandler.stageDetectedContextUnits(session, currentTurnUnits, {
            reason: 'seed-detection',
            scope: 'current-turn'
          });
        }
        const decomposedIntents = this.decomposer.decompose(intentGroups);
        const contextProfiles = decomposedIntents.map(d => this.decomposer.deriveContextProfile(d));
        this._ensureFrameRecord(executionTrace, createExecutionFrame({
          frameId: pluginCtx.frameId,
          parentFrameId: null,
          requestId,
          depth: 0,
          maxDepth: this.maxFrameDepth,
          status: 'active',
          purpose: 'chat-turn',
          seedDetails,
          deliberationPolicy: executionTrace.deliberationPolicy,
          deliberationStatus: executionTrace.deliberationLevel > 0 ? 'exploring' : 'single-shot',
          budgets: this._remainingBudgetSnapshot(budgetState, startTime),
          localState: {
            intents: intentGroups,
            currentTurnKUs: currentTurnUnits,
            retrievedKUs: [],
            partialResults: [],
            plan: null
          },
          comparisonState: {}
        }));
        const decomposeNodeSnapshot = {
          type: 'decompose',
          intentGroups: intentGroups.map(g => ({
            groupNumber: g.groupNumber,
            act: g.act,
            intent: g.intent,
            output: g.output,
            intentId: g.intentId || null
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
          plannerGuidanceUnits: overrides.plannerGuidanceUnits || [],
          goalSolverGuidanceUnits: overrides.goalSolverGuidanceUnits || [],
          decompositionGuidanceUnits: overrides.decompositionGuidanceUnits || [],
          validationGuidanceUnits: overrides.validationGuidanceUnits || [],
          seedDetectorGuidanceUnits: overrides.seedDetectorGuidanceUnits || [],
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
            goalSolverPlugin: session.preferredGoalSolverPlugin,
            deliberationLevel: executionTrace.deliberationLevel
          },
          sessionState: {
            sessionId: session.sessionId,
            mountedKbId: session.mountedKbId || null,
            mountedKbName: session.mountedKbName || null,
            messageCount: session.messageLog?.length || 0,
            sessionContextUnitCount: session.sessionContextUnits?.length || 0,
            pendingTurnContextUnitCount: session.pendingTurnContextUnits?.length || 0,
            deliberationLevel: executionTrace.deliberationLevel
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
            emitProgress({
              type: 'stage',
              event: 'start',
              stage: 'kb',
              pluginId,
              message: `Retrieving context with ${pluginId}`
            });
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
              resolvedPayload: ri.resolvedPayload || null
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
              snip(`${evidenceCount} evidence units, strategy=${strategyCount}, sufficient=${result.sufficient}`),
              pluginId);
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
          const plannerGuidanceUnits = this._collectScopedGuidanceUnits(kbResults, 'planner');
          const goalSolverGuidanceUnits = this._collectScopedGuidanceUnits(kbResults, 'goalSolver');
          const decompositionGuidanceUnits = this._collectScopedGuidanceUnits(kbResults, 'decomposition');
          const validationGuidanceUnits = this._collectScopedGuidanceUnits(kbResults, 'validation');
          const seedDetectorGuidanceUnits = this._collectScopedGuidanceUnits(kbResults, 'seedDetector');
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
            emitProgress({
              type: 'planner',
              event: 'start',
              plannerPluginId: plan.plannerPluginId,
              phase: 'post-kb',
              message: `Replanning with ${plan.plannerPluginId} after KB retrieval`
            });
            const replanned = await plannerPluginInstance.buildPlan(
              buildPlannerInput({
                phase: 'post-kb',
                strategyGuidanceUnits,
                plannerGuidanceUnits,
                goalSolverGuidanceUnits,
                decompositionGuidanceUnits,
                validationGuidanceUnits,
                seedDetectorGuidanceUnits,
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
            emitProgress({
              type: 'planner',
              event: 'finish',
              plannerPluginId: refinedPlan.plannerPluginId,
              phase: 'post-kb',
              status: 'success',
              message: `Planner refined route to ${refinedPlan.goalSolverOrder?.[0] || 'gs-auto'}`
            });
          }
          planNode.kbPluginOrder = refinedPlan.kbPluginOrder;
          planNode.goalSolverOrder = refinedPlan.goalSolverOrder;
          planNode.framePurpose = refinedPlan.framePurpose || null;
          if (strategyGuidanceUnits.length > 0) {
            planNode.strategyGuidanceUnitCount = strategyGuidanceUnits.length;
          }
          if (goalSolverGuidanceUnits.length > 0) {
            planNode.goalSolverGuidanceUnitCount = goalSolverGuidanceUnits.length;
          }
          if (decompositionGuidanceUnits.length > 0) {
            planNode.decompositionGuidanceUnitCount = decompositionGuidanceUnits.length;
          }
          if (validationGuidanceUnits.length > 0) {
            planNode.validationGuidanceUnitCount = validationGuidanceUnits.length;
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
          let selectedBranchIds = [];
          let weakBranchIds = [];
          let candidateExecutions = [];
          let executionOrder = 0;
          const goalCandidates = (refinedPlan.goalSolverOrder || []).slice(0, this.maxPluginsPerStage);
          const totalGoalAttempts = kbResults.length * Math.max(1, goalCandidates.length);
          let startedGoalAttempts = 0;

          executionTrace.lastPlan = {
            plannerPluginId: refinedPlan.plannerPluginId,
            seedDetectorOrder: seedCandidates,
            kbPluginOrder: refinedPlan.kbPluginOrder,
            goalSolverOrder: refinedPlan.goalSolverOrder,
            decompose: !!refinedPlan.decompose,
            framePurpose: refinedPlan.framePurpose || null,
            notes: refinedPlan.notes || []
          };
          this._patchFrameRecord(executionTrace, pluginCtx.frameId, {
            localState: {
              plan: executionTrace.lastPlan
            }
          });

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
                  budgetState,
                  {
                    seedDetectorOrder: seedCandidates,
                    systemPrompt,
                    plannerPluginId: refinedPlan.plannerPluginId || plan.plannerPluginId,
                    explicitSelections: buildPlannerInput().explicitSelections,
                    sessionPreferences: buildPlannerInput().sessionPreferences,
                    request,
                    onProgress: request.onProgress
                  }
                );
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
                    weakOutcome: false,
                    selectedBranchIds: childResult.selectedBranchIds || [],
                    candidateExecutions: childResult.candidateExecutions || []
                  };
                }
              } catch {
                // Fall through to direct solver attempts if the child frame fails.
              }
            }
          }

          for (const kb of kbResults) {
            const resolvedIntentsForKB = kb.result.resolvedIntents || [];
            const goalSolverGuidance = this._collectCommonGuidanceEntries(resolvedIntentsForKB, 'goalSolver');
            for (const pluginId of goalCandidates) {
              const plugin = this.pluginRegistry.get('gs-plugin', pluginId);
              if (!plugin) continue;
              if (!reserveBudgetOrSkip('goal-solver', pluginId, plugin)) {
                goalNode.children.push({ type: 'plugin', pluginId, status: 'skipped-budget' });
                continue;
              }
              const startedAt = Date.now();
              emitProgress({
                type: 'stage',
                event: 'start',
                stage: 'goal-solver',
                pluginId,
                kbPluginId: kb.pluginId,
                message: `Solving with ${pluginId}`
              });
              startedGoalAttempts += 1;
              const result = await plugin.solve({
                sessionId: session.sessionId,
                resolvedIntents: resolvedIntentsForKB,
                guidanceUnits: goalSolverGuidance,
                systemPrompt,
                requestedModel, sessionModel: session.preferredModel
              }, pluginCtx);
              this._consumeLLMCalls(budgetState, result);
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
                snip(result.responseMarkdown),
                kb.pluginId);
              const stageTraceIndex = executionTrace.stages.length - 1;
              const activeBranches = resolvedIntentsForKB.map(ri => {
                const intentGroup = intentGroups.find(group => group.groupNumber === ri.intentRef) || null;
                const seed = seedDetails.find(candidate => candidate.intentGroupNumber === ri.intentRef) || seedDetails[0] || null;
                const familySignature = this._deriveBranchFamilySignature(seed, ri, kb.pluginId, pluginId);
                return this._recordBranchAttempt(executionTrace, {
                  frameId: pluginCtx.frameId,
                  intentId: intentGroup?.intentId || `intent-${ri.intentRef}`,
                  seedId: seed?.seedId || null,
                  pluginId,
                  kbPluginId: kb.pluginId,
                  plannerPluginId: refinedPlan.plannerPluginId || plan.plannerPluginId || null,
                  status: 'active',
                  stageTraceIndex,
                  outputPreview: snip(result.responseMarkdown),
                  evidenceProfileHash: this._resolvedIntentSignature(resolvedIntentsForKB),
                  familySignature
                });
              });
              if (result.status === 'success') {
                candidateExecutions.push({
                  order: executionOrder++,
                  goalResult: result,
                  goalSolverPlugin: pluginId,
                  kbPlugin: kb.pluginId,
                  kbSufficient: kb.sufficient,
                  branchIds: activeBranches.map(branch => branch.branchId),
                  branches: activeBranches,
                  resolvedIntents: resolvedIntentsForKB,
                  familyKey: this._summarizeExecutionFamily(activeBranches),
                  familyCount: new Set(activeBranches.map(branch => branch.familySignature || 'default')).size,
                  validationVerdict: null,
                  validationReason: ''
                });
                if (!this._shouldContinueComparativeExploration(
                  executionTrace.deliberationPolicy,
                  candidateExecutions,
                  { remainingAttempts: Math.max(0, totalGoalAttempts - startedGoalAttempts) }
                )) {
                  const selectedExecution = this._selectComparativeOutcome(candidateExecutions, executionTrace.deliberationPolicy);
                  goalResult = selectedExecution?.goalResult || result;
                  selectedGoalSolverPlugin = selectedExecution?.goalSolverPlugin || pluginId;
                  selectedKBPlugin = selectedExecution?.kbPlugin || kb.pluginId;
                  kbSufficient = !!selectedExecution?.kbSufficient;
                  selectedBranchIds = selectedExecution?.branchIds || activeBranches.map(branch => branch.branchId);
                  break;
                }
                continue;
              }
              if (result.status === 'needs-decomposition') {
                for (const branch of activeBranches) {
                  this._patchBranchAttempt(executionTrace, branch.branchId, {
                    status: 'failed',
                    error: { code: 'NEEDS_DECOMPOSITION', message: 'Goal solver requested decomposition' }
                  });
                  this._recordFailure(executionTrace, {
                    frameId: branch.frameId,
                    branchId: branch.branchId,
                    seedId: branch.seedId,
                    pluginId,
                    reason: 'needs-decomposition',
                    error: { code: 'NEEDS_DECOMPOSITION', message: 'Goal solver requested decomposition' },
                    evidenceProfileHash: branch.evidenceProfileHash
                  });
                }
                addStageTrace('goal-solver', pluginId, 'needs-decomposition', startedAt,
                  result.metadata?.llmCalls || 0, false, null,
                  result.metadata?.model || null,
                  plugin.getDescriptor().modelRoles?.[0] || null,
                  null, snip('needs-decomposition'),
                  kb.pluginId);
                // DS002: attempt child-frame decomposition if depth budget allows
                if (pluginCtx.frameDepth < this.maxFrameDepth) {
                  try {
                    const childResult = await this._executeChildFrame(
                      pluginCtx,
                      refinedPlan,
                      resolvedIntentsForKB,
                      session,
                      requestedModel,
                      budgetState,
                      {
                        seedDetectorOrder: seedCandidates,
                        systemPrompt,
                        plannerPluginId: refinedPlan.plannerPluginId || plan.plannerPluginId,
                        explicitSelections: buildPlannerInput().explicitSelections,
                        sessionPreferences: buildPlannerInput().sessionPreferences,
                        request,
                        onProgress: request.onProgress
                      }
                    );
                    if (childResult.goalResult?.status === 'success') {
                      goalResult = childResult.goalResult;
                      selectedGoalSolverPlugin = childResult.selectedGoalSolverPlugin || pluginId;
                      selectedKBPlugin = kb.pluginId; kbSufficient = kb.sufficient;
                      executionTrace.frameTransitions = (executionTrace.frameTransitions || 0) + 1;
                      selectedBranchIds = childResult.selectedBranchIds || [];
                      candidateExecutions = childResult.candidateExecutions || [];
                      break;
                    }
                  } catch { /* child frame failed, continue backtracking */ }
                }
                continue;
              }
              if (result.status === 'no-context' && !weakGoalResult) {
                weakGoalResult = result; weakGoalSolverPlugin = pluginId;
                weakKBPlugin = kb.pluginId; weakKBSufficient = kb.sufficient;
                weakBranchIds = activeBranches.map(branch => branch.branchId);
                continue;
              }
              for (const branch of activeBranches) {
                this._patchBranchAttempt(executionTrace, branch.branchId, {
                  status: 'failed',
                  error: result.error || { code: 'GOAL_NO_CONTEXT', message: 'Goal solver returned no-context' }
                });
                this._recordFailure(executionTrace, {
                  frameId: branch.frameId,
                  branchId: branch.branchId,
                  seedId: branch.seedId,
                  pluginId,
                  reason: result.status || 'error',
                  error: result.error || { code: 'GOAL_NO_CONTEXT', message: 'Goal solver returned no-context' },
                  evidenceProfileHash: branch.evidenceProfileHash
                });
              }
            }
            if (goalResult) break; // found a good answer, stop backtracking
          }

          if (!goalResult && candidateExecutions.length > 0) {
            const selectedExecution = this._selectComparativeOutcome(candidateExecutions, executionTrace.deliberationPolicy);
            goalResult = selectedExecution?.goalResult || null;
            selectedGoalSolverPlugin = selectedExecution?.goalSolverPlugin || null;
            selectedKBPlugin = selectedExecution?.kbPlugin || null;
            kbSufficient = !!selectedExecution?.kbSufficient;
            selectedBranchIds = selectedExecution?.branchIds || [];
          }

          if (!goalResult && weakGoalResult) {
            goalResult = weakGoalResult; selectedGoalSolverPlugin = weakGoalSolverPlugin;
            selectedKBPlugin = weakKBPlugin; kbSufficient = weakKBSufficient;
            selectedBranchIds = weakBranchIds;
          } else if (goalResult && weakBranchIds.length > 0) {
            for (const branchId of weakBranchIds) {
              const branch = this._patchBranchAttempt(executionTrace, branchId, {
                status: 'failed',
                error: { code: 'GOAL_NO_CONTEXT', message: 'Replaced by a stronger goal result' }
              });
              if (!branch) continue;
              this._recordFailure(executionTrace, {
                frameId: branch.frameId,
                branchId: branch.branchId,
                seedId: branch.seedId,
                pluginId: branch.pluginId,
                reason: 'superseded',
                error: { code: 'GOAL_NO_CONTEXT', message: 'Replaced by a stronger goal result' },
                evidenceProfileHash: branch.evidenceProfileHash
              });
            }
          }
          if (!goalResult) {
            throw new MRPError('PLUGIN_STAGE_EXHAUSTED', MOD,
              'No goal solver plugin produced a final answer',
              { stage: 'goal-solver', pluginsTried: goalCandidates });
          }

          let selectedExecution = candidateExecutions.find(outcome =>
            outcome.goalResult === goalResult &&
            outcome.goalSolverPlugin === selectedGoalSolverPlugin &&
            outcome.kbPlugin === selectedKBPlugin
          ) || null;
          if (!selectedExecution && candidateExecutions.length > 0) {
            selectedExecution = this._selectComparativeOutcome(candidateExecutions, executionTrace.deliberationPolicy);
            if (selectedExecution) {
              goalResult = selectedExecution.goalResult;
              selectedGoalSolverPlugin = selectedExecution.goalSolverPlugin;
              selectedKBPlugin = selectedExecution.kbPlugin;
              kbSufficient = !!selectedExecution.kbSufficient;
              selectedBranchIds = selectedExecution.branchIds || [];
            }
          }
          let resolvedIntents = (kbResults.find(k => k.pluginId === selectedKBPlugin) || kbResults[0]).result.resolvedIntents || [];
          this._patchFrameRecord(executionTrace, pluginCtx.frameId, {
            localState: {
              retrievedKUs: resolvedIntents.map(ri => ({
                intentRef: ri.intentRef,
                currentTurnCount: ri.currentTurnContextUnits?.length || 0,
                sessionCount: ri.sessionUnits?.length || 0,
                kbCount: ri.kbUnits?.length || 0
              }))
            }
          });

          // --- Validation ---
          const valCandidates = this.pluginRegistry.listByType('val-plugin').map(d => d.id);
          let validationVerdict = 'accepted';
          let validationReason = '';
          if (valCandidates.length > 0 && goalResult.status === 'success') {
            const valNode = { type: 'stage', stage: 'validation', children: [] };
            planNode.children.push(valNode);
            let candidateValidationPool = candidateExecutions
              .filter(outcome => outcome.goalResult?.status === 'success' && outcome.validationVerdict !== 'rejected');
            if (!candidateValidationPool.length && selectedExecution) {
              candidateValidationPool = [selectedExecution];
            }
            while (true) {
              validationVerdict = 'accepted';
              validationReason = '';
              resolvedIntents = (kbResults.find(k => k.pluginId === selectedKBPlugin) || kbResults[0]).result.resolvedIntents || [];
              const validationGuidance = this._collectCommonGuidanceEntries(resolvedIntents, 'validation');
              for (const valId of valCandidates.slice(0, this.maxPluginsPerStage)) {
                const valPlugin = this.pluginRegistry.get('val-plugin', valId);
                if (!valPlugin) continue;
                if (!reserveBudgetOrSkip('validation', valId, valPlugin)) {
                  valNode.children.push({ type: 'plugin', pluginId: valId, status: 'skipped-budget' });
                  continue;
                }
                const startedAt = Date.now();
                emitProgress({
                  type: 'stage',
                  event: 'start',
                  stage: 'validation',
                  pluginId: valId,
                  message: `Validating response with ${valId}`
                });
                const valResult = await valPlugin.validate({
                  originalMessage: currentMessage,
                  responseMarkdown: goalResult.responseMarkdown,
                  resolvedIntents,
                  guidanceUnits: validationGuidance,
                  requestedModel,
                  sessionModel: session.preferredModel
                }, pluginCtx);
                this._consumeLLMCalls(budgetState, valResult);
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
              if (validationVerdict !== 'rejected') {
                if (selectedExecution) {
                  selectedExecution.validationVerdict = validationVerdict;
                  selectedExecution.validationReason = validationReason;
                }
                break;
              }
              if (selectedExecution) {
                selectedExecution.validationVerdict = 'rejected';
                selectedExecution.validationReason = validationReason;
              }
              for (const branchId of selectedBranchIds) {
                const branch = this._patchBranchAttempt(executionTrace, branchId, {
                  status: 'failed',
                  error: { code: 'VALIDATION_REJECTED', message: validationReason }
                });
                if (!branch) continue;
                this._recordFailure(executionTrace, {
                  frameId: branch.frameId,
                  branchId: branch.branchId,
                  seedId: branch.seedId,
                  pluginId: branch.pluginId,
                  reason: validationReason,
                  error: { code: 'VALIDATION_REJECTED', message: validationReason },
                  evidenceProfileHash: branch.evidenceProfileHash
                });
              }
              candidateValidationPool = candidateValidationPool.filter(outcome => outcome !== selectedExecution);
              const fallbackExecution = this._selectComparativeOutcome(
                candidateValidationPool,
                executionTrace.deliberationPolicy
              );
              if (!fallbackExecution) break;
              selectedExecution = fallbackExecution;
              goalResult = fallbackExecution.goalResult;
              selectedGoalSolverPlugin = fallbackExecution.goalSolverPlugin;
              selectedKBPlugin = fallbackExecution.kbPlugin;
              kbSufficient = !!fallbackExecution.kbSufficient;
              selectedBranchIds = fallbackExecution.branchIds || [];
              resolvedIntents = (kbResults.find(k => k.pluginId === selectedKBPlugin) || kbResults[0]).result.resolvedIntents || [];
              emitProgress({
                type: 'validation',
                event: 'retry',
                status: 'fallback-candidate',
                message: `Validation rejected a candidate, retrying with ${selectedGoalSolverPlugin}`
              });
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
          this._patchFrameRecord(executionTrace, pluginCtx.frameId, {
            localState: {
              retrievedKUs: resolvedIntents.map(ri => ({
                intentRef: ri.intentRef,
                currentTurnCount: ri.currentTurnContextUnits?.length || 0,
                sessionCount: ri.sessionUnits?.length || 0,
                kbCount: ri.kbUnits?.length || 0
              }))
            }
          });

            return {
              goalResult,
              currentTurnUnits,
              selectedSeedDetectorPlugin,
              selectedKBPlugin,
              selectedGoalSolverPlugin,
              kbSufficient,
              weakOutcome: goalResult.status === 'no-context',
              selectedBranchIds,
              candidateExecutions,
              validationVerdict,
              validationReason
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
            emitProgress({
              type: 'planner',
              event: 'start',
              plannerPluginId: plannerId,
              phase: 'post-seed',
              message: `Planning with ${plannerId}`
            });
            const plan = await planner.buildPlan(
              buildPlannerInput({ phase: 'post-seed' }),
              pluginCtx
            );
            emitProgress({
              type: 'planner',
              event: 'finish',
              plannerPluginId: plan?.plannerPluginId || plannerId,
              phase: 'post-seed',
              status: 'success',
              message: `Planner selected ${plan?.kbPluginOrder?.[0] || 'kb-auto'} -> ${plan?.goalSolverOrder?.[0] || 'gs-auto'}`
            });

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
        executionTrace.finalStatus = 'failed';
        executionTrace.finalAnswerStatus = 'failed';
        executionTrace.error = {
          code: error?.code || 'ENGINE_ERROR',
          message: error?.message || String(error)
        };
        this._patchFrameRecord(executionTrace, pluginCtx.frameId, {
          status: 'failed',
          budgets: this._remainingBudgetSnapshot(budgetState, startTime)
        });
        executionTrace.graph = buildExecutionGraph(executionTrace);
        if (planner) {
          try {
            await planner.recordOutcome(executionTrace, pluginCtx);
          } catch (plannerError) {
            logger.warn(MOD, `Planner outcome recording failed: ${plannerError.message}`);
          }
        }
        if (activeSession && prepared?.currentMessage && this.conversationHandler.commitFailedTurn) {
          try {
            await this.conversationHandler.commitFailedTurn(
              activeSession,
              prepared.currentMessage,
              prepared.requestedModel,
              executionTrace.plannerPluginId ||
                prepared.explicitPlannerPlugin ||
                prepared.requestedPlannerPlugin ||
                activeSession.preferredPlannerPlugin ||
                null,
              prepared.explicitSeedDetectorPlugin ||
                prepared.requestedSeedDetectorPlugin ||
                activeSession.preferredSeedDetectorPlugin ||
                null,
              prepared.explicitKBPlugin ||
                prepared.requestedKBPlugin ||
                activeSession.preferredKBPlugin ||
                null,
              prepared.explicitGoalSolverPlugin ||
                prepared.requestedGoalSolverPlugin ||
                activeSession.preferredGoalSolverPlugin ||
                null,
              {
                requestId,
                createdAt: new Date().toISOString(),
                answerStatus: 'failed',
                responseDocument: null,
                executionTrace,
                assistantPreview: error?.message || 'Execution failed',
                error: {
                  code: error?.code || 'ENGINE_ERROR',
                  message: error?.message || String(error)
                }
              }
            );
          } catch (commitError) {
            logger.warn(MOD, `Failed explainability commit failed: ${commitError.message}`);
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

Object.assign(MRPEngine.prototype, comparisonHelperMethods, traceStateHelperMethods);
