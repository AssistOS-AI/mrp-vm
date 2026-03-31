// MRP-VM — Main entry point (DS002 boot sequence)
import { loadConfig } from '../lib/config.mjs';
import { logger } from '../lib/logger.mjs';
import { CNLParser } from '../parser/cnl-validator-parser.mjs';
import { NLNormalizer } from '../normalizer/nl-normalizer.mjs';
import { IntentDecomposer } from '../intent/decomposer.mjs';
import { KBIndex } from '../retrieval/kb-index.mjs';
import { ContextMatcher } from '../retrieval/context-matcher.mjs';
import { AnswerSynthesizer } from '../synthesis/answer-synthesizer.mjs';
import { ConversationHandler } from '../conversation/handler.mjs';
import { PluginManager } from '../plugins/manager.mjs';
import { TypedPluginRegistry } from '../plugins/typed-registry.mjs';
import { StrategySeedDetectorPlugin, RetrievalKBPlugin, StrategyGoalSolverPlugin, LLMValidationPlugin } from '../plugins/builtin-plugins.mjs';
import { LLMRoleSettingsStore } from '../plugins/settings.mjs';
import { PlannerStatsStore } from '../plugins/planner-stats.mjs';
import { DefaultPlannerPlugin } from '../plugins/default-planner.mjs';
import { StrategyRegistry } from '../strategies/registry.mjs';
import { LLMAssistedStrategy } from '../strategies/llm-assisted.mjs';
import { SymbolicOnlyStrategy } from '../strategies/symbolic-only.mjs';
import { LLMBridge } from '../llm/bridge.mjs';
import { KnowledgeBase } from '../kb/knowledge-base.mjs';
import { FileMemoryPersistence } from '../kb/persistence.mjs';
import { KBRepositoryManager } from '../kb/repository-manager.mjs';
import { SourceIngestor } from '../ingest/source-ingestor.mjs';
import { BM25LexicalStrategy, RetrievalStrategyRegistry } from '../retrieval/strategies/registry.mjs';
import { HDCVSAStrategy } from '../retrieval/strategies/hdc-vsa.mjs';
import { ThinkingDBSymbolicStrategy } from '../retrieval/strategies/thinkingdb.mjs';
import { MRPEngine } from '../core/engine.mjs';
import { MRPServer } from './http-server.mjs';

const MOD = 'boot';

async function boot() {
  // 1. Validate config
  logger.info(MOD, 'Loading configuration');
  const engineConfig = loadConfig('engine');
  const serverConfig = loadConfig('server');
  const llmConfig = loadConfig('llm');
  const strategiesConfig = loadConfig('strategies');
  const retrievalConfig = loadConfig('retrieval');
  const retrievalStrategiesConfig = loadConfig('retrieval-strategies');
  const thinkingdbConfig = loadConfig('thinkingdb');
  const pluginsConfig = loadConfig('plugins');
  const llmRoleSettingsConfig = loadConfig('llm-role-settings');
  const kbConfig = loadConfig('kb');
  const conversationConfig = loadConfig('conversation');

  // 2. Initialize StrategyRegistry
  const strategyRegistry = new StrategyRegistry();

  // 3. Initialize strategies
  let llmBridge = null;
  if (strategiesConfig.enabledModes.includes('llm-assisted')) {
    logger.info(MOD, 'Initializing LLM bridge');
    llmBridge = new LLMBridge(llmConfig);
    await llmBridge.init();
    if (!llmBridge.agent) {
      logger.warn(MOD, 'AchillesAgentLib not available — llm-assisted strategy registered but LLM calls will fail at request time');
    }
    strategyRegistry.register(new LLMAssistedStrategy(llmBridge));
  }
  if (strategiesConfig.enabledModes.includes('symbolic-only')) {
    strategyRegistry.register(new SymbolicOnlyStrategy());
  }

  // 4. Initialize ConversationHandler
  const conversationHandler = new ConversationHandler(conversationConfig);

  // 5. Scan wrappers → register plugins
  const pluginManager = new PluginManager(engineConfig);
  await pluginManager.scanWrappers();

  // 6-7. Load persistent KB + index
  const normalizer = new NLNormalizer(strategyRegistry);
  const ingestor = new SourceIngestor(normalizer, kbConfig);
  const kbRepositoryManager = new KBRepositoryManager(ingestor, retrievalConfig, kbConfig);
  logger.info(MOD, 'Loading Knowledge Base');
  await kbRepositoryManager.boot();
  conversationHandler.attachKBRepositoryManager(kbRepositoryManager);
  const defaultKb = kbRepositoryManager.getDefaultRepository().kb;
  const kbIndex = defaultKb.getIndex();

  // 8. Initialize RetrievalStrategyRegistry
  const retrievalStrategyRegistry = new RetrievalStrategyRegistry();
  retrievalStrategyRegistry.register(new BM25LexicalStrategy(retrievalConfig));
  const hdcStrategy = new HDCVSAStrategy();
  retrievalStrategyRegistry.register(hdcStrategy);
  retrievalStrategyRegistry.register(new ThinkingDBSymbolicStrategy(thinkingdbConfig));
  retrievalStrategyRegistry.setProfiles(retrievalStrategiesConfig.profiles);

  // Wire HDC cache invalidation to KB index changes
  kbIndex.onChange((event, unitId) => {
    if (event === 'rebuild') hdcStrategy.invalidate(null);
    else if (unitId) hdcStrategy.invalidate(unitId);
  });

  // Build remaining components
  const parser = new CNLParser();
  const decomposer = new IntentDecomposer();
  const retrieval = new ContextMatcher(retrievalStrategyRegistry, retrievalConfig);
  const synthesizer = new AnswerSynthesizer(strategyRegistry, engineConfig);
  const typedPluginRegistry = new TypedPluginRegistry();
  const llmRoleSettings = new LLMRoleSettingsStore(llmRoleSettingsConfig, llmBridge);
  const plannerStats = new PlannerStatsStore(pluginsConfig);
  const symbolicStrategy = strategyRegistry.get('symbolic-only');
  const llmStrategy = strategyRegistry.get('llm-assisted');

  if (symbolicStrategy) {
    typedPluginRegistry.register(new StrategySeedDetectorPlugin(
      'sd-symbolic',
      symbolicStrategy,
      normalizer,
      {
        description: 'Rule-based extraction of problem seeds and session knowledge units in one pass. Fast, deterministic, no LLM cost.',
        costClass: 'cheap',
        plannerHints: {
          expectedLatencyMs: 30,
          expectedLLMCalls: 0,
          relativeCost: 0.05,
          supportedActs: ['verify', 'define', 'identify', 'describe', 'explain'],
          topicTags: ['symbolic', 'technical'],
          preferredDepth: 'shallow',
          fallbackRole: 'cheap-probe',
          confidenceWhenMatched: 0.82
        }
      }
    ));
  }
  if (llmStrategy) {
    typedPluginRegistry.register(new StrategySeedDetectorPlugin(
      'sd-llm-fast',
      llmStrategy,
      normalizer,
      {
        description: 'Lightweight LLM-backed extraction of problem seeds and session knowledge units in one pass.',
        costClass: 'moderate',
        modelRole: 'seed-fast',
        ingestModelRole: 'kb-ingest',
        plannerHints: {
          expectedLatencyMs: 800,
          expectedLLMCalls: 1,
          relativeCost: 0.35,
          supportedActs: ['compare', 'define', 'explain', 'identify', 'recommend', 'verify'],
          topicTags: ['general', 'technical', 'literature'],
          preferredDepth: 'medium',
          fallbackRole: 'default',
          confidenceWhenMatched: 0.72
        }
      }
    ));
    typedPluginRegistry.register(new StrategySeedDetectorPlugin(
      'sd-llm-deep',
      llmStrategy,
      normalizer,
      {
        description: 'Thorough LLM extraction of problem seeds and session knowledge units in one pass for ambiguous or multi-part requests.',
        costClass: 'expensive',
        modelRole: 'seed-deep',
        ingestModelRole: 'kb-ingest',
        plannerHints: {
          expectedLatencyMs: 1800,
          expectedLLMCalls: 1,
          relativeCost: 0.75,
          supportedActs: ['compare', 'diagnose', 'explain', 'recommend', 'verify'],
          topicTags: ['general', 'technical', 'legal', 'literature'],
          preferredDepth: 'deep',
          fallbackRole: 'heavy-recovery',
          confidenceWhenMatched: 0.8
        }
      }
    ));
  }
  conversationHandler.attachPluginRegistry(typedPluginRegistry);
  typedPluginRegistry.register(new RetrievalKBPlugin(
    'kb-fast',
    retrieval,
    'fast',
    {
      description: 'Lexical-first retrieval with small result budget. Cheapest path, suitable for simple focused questions with clear keywords.',
      costClass: 'cheap',
      plannerHints: {
        expectedLatencyMs: 50,
        expectedLLMCalls: 0,
        relativeCost: 0.08,
        supportedActs: ['define', 'identify', 'describe', 'explain'],
        topicTags: ['technical', 'procedural'],
        preferredDepth: 'shallow',
        evidenceStyle: ['lexical'],
        fallbackRole: 'cheap-probe',
        confidenceWhenMatched: 0.7
      }
    }
  ));
  typedPluginRegistry.register(new RetrievalKBPlugin(
    'kb-balanced',
    retrieval,
    'balanced',
    {
      description: 'Lexical + associative retrieval with diversity-aware reranking. Recommended default for moderate-complexity questions.',
      costClass: 'moderate',
      plannerHints: {
        expectedLatencyMs: 120,
        expectedLLMCalls: 0,
        relativeCost: 0.22,
        supportedActs: ['compare', 'define', 'describe', 'explain', 'identify', 'recommend'],
        topicTags: ['technical', 'legal', 'literature', 'procedural'],
        preferredDepth: 'medium',
        evidenceStyle: ['lexical', 'hybrid'],
        fallbackRole: 'default',
        confidenceWhenMatched: 0.76
      }
    }
  ));
  typedPluginRegistry.register(new RetrievalKBPlugin(
    'kb-thinkingdb',
    retrieval,
    'thinkingdb',
    {
      description: 'Lexical + bounded symbolic closure. Best for multi-hop, relation-sensitive, or proof-bearing retrieval tasks.',
      costClass: 'expensive',
      plannerHints: {
        expectedLatencyMs: 220,
        expectedLLMCalls: 0,
        relativeCost: 0.35,
        supportedActs: ['compare', 'diagnose', 'explain', 'recommend', 'verify'],
        topicTags: ['symbolic', 'technical', 'legal'],
        preferredDepth: 'deep',
        evidenceStyle: ['hybrid', 'symbolic-facts'],
        fallbackRole: 'heavy-recovery',
        confidenceWhenMatched: 0.84
      }
    }
  ));
  if (symbolicStrategy) {
    typedPluginRegistry.register(new StrategyGoalSolverPlugin(
      'gs-symbolic',
      symbolicStrategy,
      synthesizer,
      {
        description: 'Deterministic answer assembly from retrieved evidence. No LLM cost. Produces structured bullet-point answers from KB claims.',
        costClass: 'cheap',
        plannerHints: {
          expectedLatencyMs: 25,
          expectedLLMCalls: 0,
          relativeCost: 0.05,
          supportedActs: ['verify', 'define', 'identify', 'describe', 'explain'],
          topicTags: ['symbolic', 'technical', 'procedural'],
          preferredDepth: 'shallow',
          fallbackRole: 'cheap-probe',
          confidenceWhenMatched: 0.78
        }
      }
    ));
  }
  if (llmStrategy) {
    typedPluginRegistry.register(new StrategyGoalSolverPlugin(
      'gs-llm-fast',
      llmStrategy,
      synthesizer,
      {
        description: 'Lightweight LLM synthesis from evidence. Good fluency with low latency for most questions.',
        costClass: 'moderate',
        modelRole: 'goal-fast',
        plannerHints: {
          expectedLatencyMs: 900,
          expectedLLMCalls: 1,
          relativeCost: 0.4,
          supportedActs: ['compare', 'define', 'describe', 'diagnose', 'explain', 'identify', 'recommend'],
          topicTags: ['general', 'technical', 'literature', 'legal'],
          preferredDepth: 'medium',
          fallbackRole: 'default',
          confidenceWhenMatched: 0.74
        }
      }
    ));
    typedPluginRegistry.register(new StrategyGoalSolverPlugin(
      'gs-llm-deep',
      llmStrategy,
      synthesizer,
      {
        description: 'Thorough LLM synthesis with richer reasoning. Best for complex, nuanced, or multi-faceted answers.',
        costClass: 'expensive',
        modelRole: 'goal-deep',
        plannerHints: {
          expectedLatencyMs: 2200,
          expectedLLMCalls: 1,
          relativeCost: 0.78,
          supportedActs: ['compare', 'diagnose', 'explain', 'recommend', 'verify'],
          topicTags: ['general', 'technical', 'literature', 'legal', 'symbolic'],
          preferredDepth: 'deep',
          fallbackRole: 'heavy-recovery',
          confidenceWhenMatched: 0.82
        }
      }
    ));
  }
  typedPluginRegistry.register(new DefaultPlannerPlugin(
    typedPluginRegistry,
    plannerStats,
    pluginsConfig
  ));
  typedPluginRegistry.register(new DefaultPlannerPlugin(
    typedPluginRegistry,
    plannerStats,
    {
      ...pluginsConfig,
      id: 'planner-depth',
      name: 'Depth Planner',
      description: 'Heavy-first fallback planner for multi-hop or recovery paths.',
      plannerStyle: 'deep-first'
    }
  ));

  // Validation plugin
  if (llmBridge) {
    typedPluginRegistry.register(new LLMValidationPlugin(
      'val-llm',
      llmBridge,
      { description: 'LLM-backed response validator.', costClass: 'moderate', modelRole: 'validation' }
    ));
  }

  // Build engine
  const engine = new MRPEngine(
    {
      ...engineConfig,
      defaultPlannerPlugin: engineConfig.defaultPlannerPlugin || pluginsConfig.defaultPlannerPlugin || 'planner-default',
      plannerFallbackOrder: engineConfig.plannerFallbackOrder || pluginsConfig.plannerFallbackOrder || ['planner-default', 'planner-depth'],
      maxPluginsPerStage: engineConfig.maxPluginsPerStage || pluginsConfig.maxPluginsPerStage || 4,
      maxFrameDepth: engineConfig.maxFrameDepth ?? 3
    },
    typedPluginRegistry,
    conversationHandler,
    parser,
    decomposer,
    pluginManager,
    llmRoleSettings,
    kbIndex,
    plannerStats
  );

  // 9. Mark readiness
  engine.setReady(true);
  logger.info(MOD, 'Engine ready');

  // 10. Start HTTP server
  const server = new MRPServer(
    engine,
    kbRepositoryManager,
    conversationHandler,
    llmBridge,
    typedPluginRegistry,
    llmRoleSettings,
    serverConfig
  );
  server.start();

  // Periodic session cleanup
  setInterval(() => conversationHandler.expireInactiveSessions(), 60000);
}

boot().catch(e => {
  logger.error(MOD, `Fatal boot error: ${e.message}`, { stack: e.stack });
  process.exit(1);
});
