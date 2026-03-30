import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

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
      provides: ['detect-seeds', 'normalize-persistent-context']
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

  createIngestStrategy(ctx, requestedModel = null, sessionModel = null) {
    return {
      usesLLM: () => this.strategy.usesLLM(),
      normalizePersistentContext: async (input) => {
        const model = ctx.modelSettings.resolveModel({
          pluginId: this.id,
          role: this.ingestModelRole,
          requestedModel,
          sessionModel
        });
        return this.strategy.normalizePersistentContext({
          ...input,
          requestedModel: model
        });
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
  }

  getDescriptor() {
    return buildDescriptor({
      id: this.id,
      type: 'kb-plugin',
      name: this.id,
      description: this.description,
      costClass: this.costClass,
      maxLLMCalls: 0,
      provides: ['retrieve-context', 'source-text-hook']
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
      const evidenceCount = resolvedIntents.reduce((sum, ri) =>
        sum + ri.currentTurnContextUnits.length + ri.sessionUnits.length + ri.kbUnits.length, 0);
      return {
        status: evidenceCount > 0 ? 'success' : 'insufficient',
        resolvedIntents,
        sufficient: evidenceCount > 0,
        retrievalTrace: {
          profileId: this.profileId,
          evidenceCount
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

  async onSourceText(input) {
    const artifact = {
      pluginId: this.id,
      sourceId: input.sourceId,
      sessionId: input.sessionId || null,
      sourceHash: createHash('sha256').update(input.content || '').digest('hex'),
      unitCount: (input.units || []).length,
      procedureCount: (input.units || []).filter(unit => !!unit.procedure).length,
      symbolicFactCount: (input.units || []).filter(unit => unit.subject && unit.relation && unit.object).length,
      roles: [...new Set((input.units || []).map(unit => unit.role).filter(Boolean))].sort(),
      generatedAt: new Date().toISOString()
    };
    const artifactPath = resolve(
      process.cwd(),
      'data',
      'workspaces',
      input.sessionId || 'global',
      'plugins',
      this.id,
      `${input.sourceId}.json`
    );
    mkdirSync(dirname(artifactPath), { recursive: true });
    writeFileSync(artifactPath, JSON.stringify(artifact, null, 2), 'utf-8');
    return {
      status: 'accepted',
      artifacts: [{ ...artifact, artifactPath }],
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
      provides: ['solve-goal']
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
      const result = await this.synthesizer.synthesize(
        input.sessionId,
        input.resolvedIntents,
        input.pluginOutputs,
        input.systemPrompt,
        this.strategy,
        model
      );
      return {
        status: 'success',
        responseMarkdown: result.responseMarkdown,
        responseDocument: result.responseDocument,
        metadata: {
          llmCalls: this.strategy.usesLLM() ? 1 : 0,
          model
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
