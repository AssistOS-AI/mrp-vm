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
import { StrategyRegistry } from '../strategies/registry.mjs';
import { LLMAssistedStrategy } from '../strategies/llm-assisted.mjs';
import { SymbolicOnlyStrategy } from '../strategies/symbolic-only.mjs';
import { LLMBridge } from '../llm/bridge.mjs';
import { KnowledgeBase } from '../kb/knowledge-base.mjs';
import { FileMemoryPersistence } from '../kb/persistence.mjs';
import { SourceIngestor } from '../ingest/source-ingestor.mjs';
import { BM25LexicalStrategy, RetrievalStrategyRegistry } from '../retrieval/strategies/registry.mjs';
import { HDCVSAStrategy } from '../retrieval/strategies/hdc-vsa.mjs';
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
  const persistence = new FileMemoryPersistence(kbConfig);
  const kbIndex = new KBIndex(retrievalConfig);
  const normalizer = new NLNormalizer(strategyRegistry);
  const ingestor = new SourceIngestor(normalizer, kbConfig);
  const kb = new KnowledgeBase(ingestor, kbIndex, persistence, kbConfig);
  logger.info(MOD, 'Loading Knowledge Base');
  await kb.boot();

  // 8. Initialize RetrievalStrategyRegistry
  const retrievalStrategyRegistry = new RetrievalStrategyRegistry();
  retrievalStrategyRegistry.register(new BM25LexicalStrategy(retrievalConfig));
  retrievalStrategyRegistry.register(new HDCVSAStrategy());
  retrievalStrategyRegistry.setProfiles(retrievalStrategiesConfig.profiles);

  // Build remaining components
  const parser = new CNLParser();
  const decomposer = new IntentDecomposer();
  const retrieval = new ContextMatcher(retrievalStrategyRegistry, retrievalConfig);
  const synthesizer = new AnswerSynthesizer(strategyRegistry, engineConfig);

  // Build engine
  const engine = new MRPEngine(
    engineConfig, normalizer, parser, decomposer, retrieval, synthesizer,
    pluginManager, conversationHandler, strategyRegistry, retrievalStrategyRegistry, kbIndex
  );

  // 9. Mark readiness
  engine.setReady(true);
  logger.info(MOD, 'Engine ready');

  // 10. Start HTTP server
  const server = new MRPServer(engine, kb, conversationHandler, llmBridge, strategyRegistry, retrievalStrategyRegistry, serverConfig);
  server.start();

  // Periodic session cleanup
  setInterval(() => conversationHandler.expireInactiveSessions(), 60000);
}

boot().catch(e => {
  logger.error(MOD, `Fatal boot error: ${e.message}`, { stack: e.stack });
  process.exit(1);
});
