// MRP-VM — Core boot sequence
import { loadConfig } from '../platform/config.mjs';
import { logger } from '../platform/logger.mjs';
import { CNLParser } from '../parser/cnl-validator-parser.mjs';
import { NLNormalizer } from '../normalizer/nl-normalizer.mjs';
import { ConversationHandler } from '../conversation/handler.mjs';
import { PluginManager } from '../../plugins/runtime/wrapper-manager.mjs';
import { TypedPluginRegistry } from '../../plugins/runtime/typed-registry.mjs';
import { LLMRoleSettingsStore } from '../../plugins/runtime/llm-role-settings.mjs';
import { PlannerStatsStore } from '../../plugins/runtime/planner-stats.mjs';
import { loadBuiltInPlugins } from '../../plugins/runtime/builtin-loader.mjs';
import {
  LLMAssistedSeedBundleGenerator,
  RuleBasedSOPSeedBundleGenerator
} from '../../mrp-vm-sdk/seed-detection/builtin-helpers.mjs';
import {
  LLMAssistedContextNormalizer,
  RuleBasedSOPContextNormalizer
} from '../../mrp-vm-sdk/context-normalization/builtin-helpers.mjs';
import {
  LLMAssistedResponseRenderer,
  RuleBasedSOPResponseRenderer
} from '../../mrp-vm-sdk/response-rendering/builtin-helpers.mjs';
import { IntentDecomposer } from '../../mrp-vm-sdk/nlp-util/intent-decomposer.mjs';
import { AnswerSynthesizer } from '../../mrp-vm-sdk/synthesis/answer-synthesizer.mjs';
import { LLMBridge } from '../llm/bridge.mjs';
import { SourceIngestor } from '../ingest/source-ingestor.mjs';
import { KBRepositoryManager } from '../kb/repository-manager.mjs';
import { MRPEngine } from '../engine/engine.mjs';
import { MRPServer } from '../../server/http-server.mjs';

const MOD = 'boot';

export async function boot() {
  logger.info(MOD, 'Loading configuration');
  const engineConfig = loadConfig('engine');
  const serverConfig = loadConfig('server');
  const llmConfig = loadConfig('llm');
  const strategiesConfig = loadConfig('strategies');
  const retrievalConfig = loadConfig('retrieval');
  const pluginsConfig = loadConfig('plugins');
  const llmRoleSettingsConfig = loadConfig('llm-role-settings');
  const kbConfig = loadConfig('kb');
  const conversationConfig = loadConfig('conversation');

  const seedBundleGenerators = new Map();
  const contextNormalizers = new Map();
  const responseRenderers = new Map();

  let llmBridge = null;
  if (strategiesConfig.enabledModes.includes('llm-assisted')) {
    logger.info(MOD, 'Initializing LLM bridge');
    llmBridge = new LLMBridge(llmConfig);
    await llmBridge.init();
    if (!llmBridge.agent) {
      logger.warn(MOD, 'AchillesAgentLib not available — llm-assisted mode registered but LLM calls will fail at request time');
    }
    seedBundleGenerators.set('llm-assisted', new LLMAssistedSeedBundleGenerator(llmBridge));
    contextNormalizers.set('llm-assisted', new LLMAssistedContextNormalizer(llmBridge));
    responseRenderers.set('llm-assisted', new LLMAssistedResponseRenderer(llmBridge));
  }
  if (strategiesConfig.enabledModes.includes('symbolic-only')) {
    seedBundleGenerators.set('symbolic-only', new RuleBasedSOPSeedBundleGenerator());
    contextNormalizers.set('symbolic-only', new RuleBasedSOPContextNormalizer());
    responseRenderers.set('symbolic-only', new RuleBasedSOPResponseRenderer());
  }

  const conversationHandler = new ConversationHandler(conversationConfig);

  const pluginManager = new PluginManager(engineConfig);
  await pluginManager.scanWrappers(pluginsConfig.wrappersDir || 'wrappers');

  const normalizer = new NLNormalizer();
  const ingestor = new SourceIngestor(normalizer, kbConfig);
  const kbRepositoryManager = new KBRepositoryManager(ingestor, retrievalConfig, kbConfig);
  logger.info(MOD, 'Loading Knowledge Base');
  await kbRepositoryManager.boot();
  conversationHandler.attachKBRepositoryManager(kbRepositoryManager);
  const defaultKb = kbRepositoryManager.getDefaultRepository().kb;
  const kbIndex = defaultKb.getIndex();

  const parser = new CNLParser();
  const decomposer = new IntentDecomposer();
  const synthesizer = new AnswerSynthesizer(engineConfig);
  const typedPluginRegistry = new TypedPluginRegistry();
  const llmRoleSettings = new LLMRoleSettingsStore(llmRoleSettingsConfig, llmBridge);
  const plannerStats = new PlannerStatsStore(pluginsConfig);

  conversationHandler.attachPluginRegistry(typedPluginRegistry);
  await loadBuiltInPlugins(typedPluginRegistry, pluginsConfig, {
    seedBundleGenerators,
    contextNormalizers,
    responseRenderers,
    normalizer,
    synthesizer,
    llmBridge,
    plannerStats,
    kbRepositoryManager
  });

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

  engine.setReady(true);
  logger.info(MOD, 'Engine ready');

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

  setInterval(() => conversationHandler.expireInactiveSessions(), 60000);

  return {
    engine,
    server,
    conversationHandler,
    typedPluginRegistry,
    kbRepositoryManager,
    llmBridge
  };
}
