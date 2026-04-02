import { createHash } from 'node:crypto';
import { loadConfig } from '../../../core/platform/config.mjs';
import { loadLocalPluginManifest } from '../../runtime/manifest-loader.mjs';
import { ContextMatcher } from './retrieval/context-matcher.mjs';
import { configureTokenizer } from './retrieval/tokenizer.mjs';
import {
  BM25LexicalStrategy,
  RetrievalStrategyRegistry
} from './retrieval/strategies/registry.mjs';

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

function buildRetrievalRuntime() {
  const retrievalConfig = loadConfig('retrieval');
  const retrievalStrategiesConfig = loadConfig('retrieval-strategies');
  configureTokenizer({ stemming: retrievalConfig.stemming !== false });

  const strategyRegistry = new RetrievalStrategyRegistry();
  strategyRegistry.register(new BM25LexicalStrategy(retrievalConfig));
  strategyRegistry.setProfiles(retrievalStrategiesConfig.profiles || {});

  const contextMatcher = new ContextMatcher(strategyRegistry, {
    ...retrievalConfig,
    strategyWeights: retrievalStrategiesConfig.strategyWeights || {}
  });

  return { contextMatcher };
}

class FastKBPlugin {
  constructor(manifest, contextMatcher) {
    this.id = manifest.id;
    this.name = manifest.name || manifest.id;
    this.description = manifest.description || '';
    this.costClass = manifest.costClass || 'cheap';
    this.profileId = manifest.profileId || 'fast';
    this.plannerHints = manifest.plannerHints || null;
    this.contextMatcher = contextMatcher;
  }

  getDescriptor() {
    return buildDescriptor({
      id: this.id,
      type: 'kb-plugin',
      name: this.name,
      description: this.description,
      costClass: this.costClass,
      maxLLMCalls: 0,
      provides: ['retrieve-context', 'source-text-hook', 'session-lifecycle'],
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
          strategyCount: (ri.strategyUnits || []).length,
          neededRoles: [...neededRoles],
          coveredRoles: [...roleSet].sort(),
          matchedRoles,
          uniqueSourceCount: sourceSet.size,
          sufficient
        };
      });
      const evidenceCount = intentAssessments.reduce((sum, item) => sum + item.evidenceCount, 0);
      const strategyUnitCount = intentAssessments.reduce((sum, item) => sum + item.strategyCount, 0);
      const sufficient = intentAssessments.length > 0 && intentAssessments.every(item => item.sufficient);

      return {
        status: sufficient ? 'success' : 'insufficient',
        resolvedIntents,
        sufficient,
        retrievalTrace: {
          profileId: this.profileId,
          evidenceCount,
          strategyUnitCount,
          purpose:
            strategyUnitCount === 0 ? 'task-evidence' :
            strategyUnitCount >= evidenceCount ? 'strategy-guidance' :
            'mixed',
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

  async onSessionEvent() {
    return {
      status: 'accepted',
      error: null
    };
  }
}

export async function createPlugin() {
  const manifest = loadLocalPluginManifest(import.meta.url);
  const { contextMatcher } = buildRetrievalRuntime();
  return new FastKBPlugin(manifest, contextMatcher);
}
