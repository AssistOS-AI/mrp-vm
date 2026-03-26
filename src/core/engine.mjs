// DS002 — MRP-VM Core Engine
import { randomUUID } from 'node:crypto';
import { MRPError } from '../lib/errors.mjs';
import { logger } from '../lib/logger.mjs';
import { CNLParser } from '../parser/cnl-validator-parser.mjs';

const MOD = 'core';

export class MRPEngine {
  constructor(config, normalizer, parser, decomposer, retrieval, synthesizer,
    pluginManager, conversationHandler, strategyRegistry, retrievalStrategyRegistry, kbIndex) {
    this.config = config;
    this.normalizer = normalizer;
    this.parser = parser || new CNLParser();
    this.decomposer = decomposer;
    this.retrieval = retrieval;
    this.synthesizer = synthesizer;
    this.pluginManager = pluginManager;
    this.conversationHandler = conversationHandler;
    this.strategyRegistry = strategyRegistry;
    this.retrievalStrategyRegistry = retrievalStrategyRegistry;
    this.kbIndex = kbIndex;
    this.maxLLMAttempts = config.maxLLMAttemptsPerRequest || 5;
    this.requestTimeout = config.requestTimeoutMs || 60000;
    this._ready = false;
  }

  isReady() { return this._ready; }
  setReady(v) { this._ready = v; }

  async processChatTurn(request) {
    const requestId = `req-${randomUUID().substring(0, 12)}`;
    const startTime = Date.now();
    let llmCallCount = 0;

    const checkBudget = () => {
      if (llmCallCount >= this.maxLLMAttempts) {
        throw new MRPError('ENGINE_BUDGET_EXCEEDED', MOD,
          `LLM attempt budget exhausted (${this.maxLLMAttempts})`);
      }
    };

    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new MRPError('ENGINE_TIMEOUT', MOD, 'Request timeout exceeded')), this.requestTimeout)
    );

    const processPromise = (async () => {
      // 1. Prepare turn
      const { session, currentMessage, historyForPrompt, systemPrompt,
        requestedModel, requestedProcessingMode, requestedRetrievalProfile
      } = this.conversationHandler.prepareTurn(
        request.session_id, request.messages,
        request.model, request.processing_mode, request.retrieval_profile
      );

      // 2. Resolve strategy
      const strategy = this.strategyRegistry.resolve(
        requestedProcessingMode, session.preferredProcessingMode,
        this.config.defaultProcessingMode || 'llm-assisted'
      );

      // 3. Resolve and validate retrieval profile
      const retrievalProfileId = requestedRetrievalProfile || session.preferredRetrievalProfile || 'balanced';
      // Validate profile exists — throws if unknown
      this.retrievalStrategyRegistry.resolveProfile(
        retrievalProfileId, null, retrievalProfileId
      );

      // Wrap strategy to count LLM calls via budget
      const model = requestedModel || session.preferredModel || null;

      // 4. Intent normalization
      logger.info(MOD, 'Normalizing intent', {}, { reqId: requestId, sessionId: session.sessionId });
      if (strategy.usesLLM()) checkBudget();
      const intentCNL = await this.normalizer.toIntentCNL(
        currentMessage, historyForPrompt, systemPrompt, strategy, model
      );
      if (strategy.usesLLM()) llmCallCount++;

      // 5. Parse intent CNL
      const intentGroups = this.parser.parseIntentCNL(intentCNL);
      if (intentGroups.length === 0) {
        throw new MRPError('DECOMPOSER_EMPTY_RESULT', MOD, 'No intent groups produced');
      }

      // 6. Session context extraction
      logger.info(MOD, 'Extracting session context', {}, { reqId: requestId });
      if (strategy.usesLLM()) checkBudget();
      let currentTurnContextCNL;
      try {
        currentTurnContextCNL = await this.normalizer.toSessionContextCNL(
          currentMessage, systemPrompt, strategy, model
        );
        if (strategy.usesLLM()) llmCallCount++;
      } catch (e) {
        if (e.code?.startsWith('SESSION_CONTEXT_') || e.code === 'ENGINE_BUDGET_EXCEEDED') throw e;
        throw new MRPError('SESSION_CONTEXT_FAILED', MOD, e.message);
      }

      // 7. Parse current-turn context units
      let currentTurnUnits = [];
      if (currentTurnContextCNL?.trim()) {
        currentTurnUnits = this.parser.parseContextCNL(currentTurnContextCNL);
      }

      // 8. Decompose intents
      const decomposedIntents = this.decomposer.decompose(intentGroups);
      const contextProfiles = decomposedIntents.map(d => this.decomposer.deriveContextProfile(d));

      // 9. Retrieval per intent group
      logger.info(MOD, 'Running retrieval', {}, { reqId: requestId });
      const resolvedIntents = await this.retrieval.resolve(
        decomposedIntents, contextProfiles, currentTurnUnits,
        session, retrievalProfileId, this.kbIndex
      );

      // 10. Plugin invocation per intent group
      const pluginOutputs = [];
      for (const ri of resolvedIntents) {
        const manifest = this.pluginManager.selectPlugin(ri.intentGroup);
        if (manifest) {
          logger.info(MOD, `Invoking plugin ${manifest.name}`, {}, { reqId: requestId });
          const po = await this.pluginManager.invoke(manifest, ri.resolvedMarkdown);
          po.intentRef = ri.intentRef;
          pluginOutputs.push(po);
        }
      }

      // 11. Synthesis
      logger.info(MOD, 'Synthesizing answer', {}, { reqId: requestId });
      if (strategy.usesLLM()) checkBudget();
      const { responseDocument, responseMarkdown } = await this.synthesizer.synthesize(
        session.sessionId, resolvedIntents, pluginOutputs, systemPrompt, strategy, model
      );
      if (strategy.usesLLM()) llmCallCount++;

      // 12. Commit turn
      this.conversationHandler.commitSuccessfulTurn(
        session, currentMessage, responseMarkdown, currentTurnUnits,
        requestedModel, requestedProcessingMode, requestedRetrievalProfile
      );

      return {
        sessionId: session.sessionId,
        responseMarkdown,
        responseDocument,
        requestId,
        llmCallCount,
        durationMs: Date.now() - startTime
      };
    })();

    return Promise.race([processPromise, timeoutPromise]);
  }
}
