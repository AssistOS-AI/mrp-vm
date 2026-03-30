import { createHash } from 'node:crypto';

function buildDescriptor(overrides) {
  return {
    version: '1.0.0',
    description: '',
    costClass: 'cheap',
    usesLLM: false,
    modelRoles: [],
    tags: ['builtin'],
    timeoutMs: 30000,
    maxLLMCalls: 0,
    provides: [],
    accepts: ['chat-turn'],
    plannerHints: null,
    ...overrides
  };
}

export class StrategySeedDetectorPlugin {
  constructor(id, strategy, normalizer, options = {}) {
    this.id = id;
    this.strategy = strategy;
    this.normalizer = normalizer;
    this.modelRole = options.modelRole || null;
    this.ingestModelRole = options.ingestModelRole || this.modelRole;
    this.description = options.description || '';
    this.costClass = options.costClass || 'cheap';
    this.plannerHints = options.plannerHints || null;
  }

  getDescriptor() {
    return buildDescriptor({
      id: this.id,
      type: 'sd-plugin',
      name: this.id,
      description: this.description,
      costClass: this.costClass,
      usesLLM: this.strategy.usesLLM(),
      modelRoles: [this.modelRole, this.ingestModelRole].filter(Boolean),
      maxLLMCalls: this.strategy.usesLLM() ? 4 : 0,
      provides: ['detect-seeds', 'normalize-persistent-context'],
      plannerHints: this.plannerHints
    });
  }

  async detectSeeds(input, ctx) {
    const model = ctx.modelSettings.resolveModel({
      pluginId: this.id,
      role: this.modelRole,
      requestedModel: input.requestedModel || null,
      sessionModel: input.sessionModel || null
    });
    try {
      const intentCNL = await this.normalizer.toIntentCNL(
        input.currentMessage,
        input.historyForPrompt,
        input.systemPrompt,
        this.strategy,
        model
      );
      const currentTurnContextCNL = await this.normalizer.toSessionContextCNL(
        input.currentMessage,
        input.systemPrompt,
        this.strategy,
        model
      );
      return {
        status: 'success',
        intentCNL,
        currentTurnContextCNL,
        metadata: {
          llmCalls: this.strategy.usesLLM() ? 2 : 0,
          model
        },
        error: null
      };
    } catch (error) {
      return {
        status: error.code === 'STRATEGY_UNSUPPORTED_INPUT' ? 'unsupported' : 'error',
        intentCNL: null,
        currentTurnContextCNL: null,
        metadata: {
          llmCalls: this.strategy.usesLLM() ? 1 : 0,
          model
        },
        error: { code: error.code || 'SEED_PLUGIN_FAILED', message: error.message }
      };
    }
  }

  async normalizePersistentContext(input, ctx) {
    const model = ctx.modelSettings.resolveModel({
      pluginId: this.id,
      role: this.ingestModelRole,
      requestedModel: input.requestedModel || null,
      sessionModel: input.sessionModel || null
    });
    try {
      const result = await this.strategy.normalizePersistentContext({
        ...input,
        requestedModel: model
      });
      return {
        status: 'success',
        contextCNL: result.contextCNL || '',
        metadata: {
          llmCalls: this.strategy.usesLLM() ? 1 : 0,
          model
        },
        error: null
      };
    } catch (error) {
      return {
        status: error.code === 'STRATEGY_UNSUPPORTED_INPUT' ? 'unsupported' : 'error',
        contextCNL: null,
        metadata: {
          llmCalls: this.strategy.usesLLM() ? 1 : 0,
          model
        },
        error: { code: error.code || 'INGEST_PLUGIN_FAILED', message: error.message }
      };
    }
  }

  createIngestStrategy(ctx, requestedModel = null, sessionModel = null) {
    return {
      usesLLM: () => this.strategy.usesLLM(),
      normalizePersistentContext: async (input) => {
        const result = await this.normalizePersistentContext({
          ...input,
          requestedModel,
          sessionModel
        }, ctx);
        return { contextCNL: result.contextCNL || '' };
      }
    };
  }
}

export class RetrievalKBPlugin {
  constructor(id, contextMatcher, profileId, options = {}) {
    this.id = id;
    this.contextMatcher = contextMatcher;
    this.profileId = profileId;
    this.description = options.description || '';
    this.costClass = options.costClass || 'cheap';
    this.plannerHints = options.plannerHints || null;
  }

  getDescriptor() {
    return buildDescriptor({
      id: this.id,
      type: 'kb-plugin',
      name: this.id,
      description: this.description,
      costClass: this.costClass,
      maxLLMCalls: 0,
      provides: ['retrieve-context', 'source-text-hook'],
      plannerHints: this.plannerHints
    });
  }

  async retrieve(input) {
    try {
      const resolvedIntents = await this.contextMatcher.resolve(
        input.decomposedIntents,
        input.contextProfiles,
        input.currentTurnUnits,
        input.session,
        this.profileId,
        input.kbIndex
      );
      const intentAssessments = resolvedIntents.map((ri, index) => {
        const profile = input.contextProfiles?.[index] || {};
        const allUnits = [
          ...(ri.currentTurnContextUnits || []),
          ...(ri.sessionUnits || []).map(item => item.unit).filter(Boolean),
          ...(ri.kbUnits || []).map(item => item.unit).filter(Boolean)
        ];
        const evidenceCount =
          (ri.currentTurnContextUnits || []).length +
          (ri.sessionUnits || []).length +
          (ri.kbUnits || []).length;
        const roleSet = new Set(allUnits.map(unit => unit.role).filter(Boolean));
        const sourceSet = new Set([
          ...(ri.sessionUnits || []).map(item => `session:${item.unitId}`),
          ...(ri.kbUnits || []).map(item => `kb:${item.unit?.sourceId || item.unitId}`)
        ]);
        const neededRoles = new Set(profile.neededRoles || []);
        const matchedRoles = [...roleSet].filter(role => neededRoles.has(role));
        const sufficient =
          evidenceCount > 0 &&
          (neededRoles.size === 0 || matchedRoles.length > 0 || evidenceCount >= 2);
        return {
          intentRef: ri.intentRef,
          evidenceCount,
          neededRoles: [...neededRoles],
          coveredRoles: [...roleSet].sort(),
          matchedRoles,
          uniqueSourceCount: sourceSet.size,
          sufficient
        };
      });
      const evidenceCount = intentAssessments.reduce((sum, item) => sum + item.evidenceCount, 0);
      const sufficient = intentAssessments.length > 0 && intentAssessments.every(item => item.sufficient);
      return {
        status: sufficient ? 'success' : 'insufficient',
        resolvedIntents,
        sufficient,
        retrievalTrace: {
          profileId: this.profileId,
          evidenceCount,
          intentAssessments
        },
        error: null
      };
    } catch (error) {
      return {
        status: 'error',
        resolvedIntents: null,
        sufficient: false,
        retrievalTrace: { profileId: this.profileId },
        error: { code: error.code || 'KB_PLUGIN_FAILED', message: error.message }
      };
    }
  }

  async onSourceText(input, ctx = {}) {
    const deriveModel = ctx.modelSettings?.resolveModel?.({
      pluginId: this.id,
      role: 'kb-derive',
      requestedModel: input.requestedModel || null,
      sessionModel: ctx.session?.preferredModel || null
    }) || null;
    const roleCounts = {};
    for (const unit of input.units || []) {
      const role = unit.role || 'Unknown';
      roleCounts[role] = (roleCounts[role] || 0) + 1;
    }
    const artifact = {
      pluginId: this.id,
      sourceId: input.sourceId,
      sessionId: input.sessionId || null,
      sourceHash: createHash('sha256').update(input.content || '').digest('hex'),
      unitCount: (input.units || []).length,
      procedureCount: (input.units || []).filter(unit => !!unit.procedure).length,
      symbolicFactCount: (input.units || []).filter(unit => unit.subject && unit.relation && unit.object).length,
      roles: [...new Set((input.units || []).map(unit => unit.role).filter(Boolean))].sort(),
      roleCounts,
      deriveModel,
      generatedAt: new Date().toISOString()
    };
    const summaryMarkdown = [
      `# ${this.id} Derived Note`,
      `SourceId: ${input.sourceId}`,
      `SourceName: ${input.name || input.sourceId}`,
      `ConfiguredModel: ${deriveModel || '(none)'}`,
      `UnitCount: ${artifact.unitCount}`,
      `ProcedureCount: ${artifact.procedureCount}`,
      `SymbolicFactCount: ${artifact.symbolicFactCount}`,
      `Roles: ${Object.entries(roleCounts).sort((a, b) => a[0].localeCompare(b[0])).map(([role, count]) => `${role}=${count}`).join(', ') || '(none)'}`,
      '',
      'This is a lightweight derived note generated by the built-in KB plugin ingest hook.'
    ].join('\n');
    const artifactStore = ctx.kbRepositoryManager;
    if (!artifactStore?.saveWorkspacePluginArtifact || !input.sessionId) {
      return {
        status: 'skipped',
        artifacts: [],
        error: null
      };
    }
    const artifactPath = await artifactStore.saveWorkspacePluginArtifact(
      input.sessionId,
      this.id,
      `${input.sourceId}.json`,
      artifact
    );
    const summaryPath = await artifactStore.saveWorkspacePluginArtifact(
      input.sessionId,
      this.id,
      `${input.sourceId}.summary.md`,
      summaryMarkdown
    );
    return {
      status: 'accepted',
      artifacts: [{ ...artifact, artifactPath, summaryPath }],
      error: null
    };
  }
}

export class StrategyGoalSolverPlugin {
  constructor(id, strategy, synthesizer, options = {}) {
    this.id = id;
    this.strategy = strategy;
    this.synthesizer = synthesizer;
    this.modelRole = options.modelRole || null;
    this.description = options.description || '';
    this.costClass = options.costClass || 'cheap';
    this.plannerHints = options.plannerHints || null;
  }

  getDescriptor() {
    return buildDescriptor({
      id: this.id,
      type: 'gs-plugin',
      name: this.id,
      description: this.description,
      costClass: this.costClass,
      usesLLM: this.strategy.usesLLM(),
      modelRoles: [this.modelRole].filter(Boolean),
      maxLLMCalls: this.strategy.usesLLM() ? 1 : 0,
      provides: ['solve-goal'],
      plannerHints: this.plannerHints
    });
  }

  async solve(input, ctx) {
    const model = ctx.modelSettings.resolveModel({
      pluginId: this.id,
      role: this.modelRole,
      requestedModel: input.requestedModel || null,
      sessionModel: input.sessionModel || null
    });
    try {
      const helperOutputs = ctx.externalHelpers?.collectOutputs
        ? await ctx.externalHelpers.collectOutputs(input.resolvedIntents || [])
        : [];
      const pluginOutputs = input.pluginOutputs || helperOutputs || [];
      const result = await this.synthesizer.synthesize(
        input.sessionId,
        input.resolvedIntents,
        pluginOutputs,
        input.systemPrompt,
        this.strategy,
        model
      );
      return {
        status: result.status === 'no-context' ? 'no-context' : 'success',
        responseMarkdown: result.responseMarkdown,
        responseDocument: result.responseDocument,
        metadata: {
          llmCalls: this.strategy.usesLLM() ? 1 : 0,
          model,
          helperPluginCount: pluginOutputs.length
        },
        error: null
      };
    } catch (error) {
      return {
        status: 'error',
        responseMarkdown: null,
        responseDocument: null,
        metadata: {
          llmCalls: this.strategy.usesLLM() ? 1 : 0,
          model
        },
        error: { code: error.code || 'GOAL_SOLVER_FAILED', message: error.message }
      };
    }
  }
}

export class LLMValidationPlugin {
  constructor(id, llmBridge, options = {}) {
    this.id = id;
    this.llmBridge = llmBridge;
    this.modelRole = options.modelRole || 'validation';
    this.description = options.description || '';
    this.costClass = options.costClass || 'moderate';
  }

  getDescriptor() {
    return buildDescriptor({
      id: this.id,
      type: 'val-plugin',
      name: this.id,
      description: this.description,
      costClass: this.costClass,
      usesLLM: true,
      modelRoles: [this.modelRole],
      maxLLMCalls: 1,
      provides: ['validate-response'],
      plannerHints: {
        expectedLatencyMs: 800,
        expectedLLMCalls: 1,
        relativeCost: 0.35,
        fallbackRole: 'default',
        confidenceWhenMatched: 0.8
      }
    });
  }

  async validate(input, ctx) {
    const model = ctx.modelSettings.resolveModel({
      pluginId: this.id,
      role: this.modelRole,
      requestedModel: input.requestedModel || null,
      sessionModel: input.sessionModel || null
    });
    if (!this.llmBridge?.call) {
      return { status: 'accepted', verdict: 'accepted', reason: 'No LLM bridge available, accepting by default', metadata: { llmCalls: 0, model: null }, error: null };
    }
    const prompt = [
      'You are a response validator for a meta-rational VM.',
      'The user asked a question. The system produced an answer using retrieved evidence.',
      'Your job: decide if the answer is CORRECT and GROUNDED in the evidence.',
      'Reply with exactly one JSON object: {"verdict":"accepted","reason":"..."} or {"verdict":"rejected","reason":"..."}',
      'Reject if: the answer contradicts the evidence, fabricates facts not in evidence, or fails to address the question.',
      'Accept if: the answer is grounded, addresses the question, and does not contradict evidence.'
    ].join('\n');
    const userMsg = [
      '## Original Question', input.originalMessage || '',
      '## System Answer', input.responseMarkdown || '',
      '## Evidence Used', (input.resolvedIntents || []).map(ri => ri.resolvedMarkdown || '').join('\n---\n')
    ].join('\n\n');
    try {
      const raw = await this.llmBridge.call(prompt, userMsg, { model });
      const parsed = JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0] || '{}');
      const verdict = parsed.verdict === 'rejected' ? 'rejected' : 'accepted';
      return {
        status: verdict,
        verdict,
        reason: parsed.reason || '',
        metadata: { llmCalls: 1, model },
        error: null
      };
    } catch (error) {
      return { status: 'accepted', verdict: 'accepted', reason: `Validation error, accepting: ${error.message}`, metadata: { llmCalls: 1, model }, error: { code: 'VAL_PLUGIN_FAILED', message: error.message } };
    }
  }
}
