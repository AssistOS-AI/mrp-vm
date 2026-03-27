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
      const rx = { reqId: requestId };

      // 1. Prepare turn
      logger.debug(MOD, 'Phase 1/12: Preparing turn', { sessionId: request.session_id || '(new)' }, rx);
      const { session, currentMessage, historyForPrompt, systemPrompt,
        requestedModel, requestedProcessingMode, requestedRetrievalProfile
      } = this.conversationHandler.prepareTurn(
        request.session_id, request.messages,
        request.model, request.processing_mode, request.retrieval_profile
      );
      const sx = { ...rx, sessionId: session.sessionId };
      logger.debug(MOD, 'Turn prepared', { historyLen: historyForPrompt.length, msgPreview: currentMessage.slice(0, 80) }, sx);

      // 2. Resolve strategy
      const strategy = this.strategyRegistry.resolve(
        requestedProcessingMode, session.preferredProcessingMode,
        this.config.defaultProcessingMode || 'llm-assisted'
      );
      logger.debug(MOD, 'Phase 2/12: Strategy resolved', { strategy: strategy.id, usesLLM: strategy.usesLLM() }, sx);

      // 3. Resolve and validate retrieval profile
      const retrievalProfileId = requestedRetrievalProfile || session.preferredRetrievalProfile || 'balanced';
      this.retrievalStrategyRegistry.resolveProfile(
        retrievalProfileId, null, retrievalProfileId
      );
      logger.debug(MOD, 'Phase 3/12: Retrieval profile resolved', { profile: retrievalProfileId }, sx);

      const model = requestedModel || session.preferredModel || null;

      // 4. Intent normalization
      logger.info(MOD, 'Phase 4/12: Normalizing intent', { model }, sx);
      if (strategy.usesLLM()) checkBudget();
      const intentCNL = await this.normalizer.toIntentCNL(
        currentMessage, historyForPrompt, systemPrompt, strategy, model
      );
      if (strategy.usesLLM()) llmCallCount++;
      logger.debug(MOD, 'Intent CNL produced', { length: intentCNL?.length || 0 }, sx);

      // 5. Parse intent CNL
      logger.debug(MOD, 'Phase 5/12: Parsing intent CNL', {}, sx);
      const intentGroups = this.parser.parseIntentCNL(intentCNL);
      if (intentGroups.length === 0) {
        throw new MRPError('DECOMPOSER_EMPTY_RESULT', MOD, 'No intent groups produced');
      }
      logger.debug(MOD, 'Intent groups parsed', { count: intentGroups.length }, sx);

      // 6. Session context extraction
      logger.info(MOD, 'Phase 6/12: Extracting session context', {}, sx);
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
      logger.debug(MOD, 'Phase 7/12: Parsing context units', {}, sx);
      let currentTurnUnits = [];
      if (currentTurnContextCNL?.trim()) {
        currentTurnUnits = this.parser.parseContextCNL(currentTurnContextCNL);
      }
      logger.debug(MOD, 'Context units parsed', { count: currentTurnUnits.length }, sx);

      // 8. Decompose intents
      logger.debug(MOD, 'Phase 8/12: Decomposing intents', {}, sx);
      const decomposedIntents = this.decomposer.decompose(intentGroups);
      const contextProfiles = decomposedIntents.map(d => this.decomposer.deriveContextProfile(d));
      logger.debug(MOD, 'Intents decomposed', { count: decomposedIntents.length }, sx);

      // 9. Retrieval per intent group
      logger.info(MOD, 'Phase 9/12: Running retrieval', { profile: retrievalProfileId }, sx);
      const resolvedIntents = await this.retrieval.resolve(
        decomposedIntents, contextProfiles, currentTurnUnits,
        session, retrievalProfileId, this.kbIndex
      );
      logger.debug(MOD, 'Retrieval complete', { resolvedCount: resolvedIntents.length }, sx);

      // 10. Plugin invocation per intent group
      logger.debug(MOD, 'Phase 10/12: Plugin invocation', {}, sx);
      const pluginOutputs = [];
      for (const ri of resolvedIntents) {
        const manifest = this.pluginManager.selectPlugin(ri.intentGroup);
        if (manifest) {
          logger.info(MOD, `Invoking plugin ${manifest.name}`, {}, sx);
          const po = await this.pluginManager.invoke(manifest, ri.resolvedMarkdown);
          po.intentRef = ri.intentRef;
          pluginOutputs.push(po);
        }
      }

      // 11. Synthesis
      logger.info(MOD, 'Phase 11/12: Synthesizing answer', { llmCalls: llmCallCount }, sx);
      if (strategy.usesLLM()) checkBudget();
      const { responseDocument, responseMarkdown } = await this.synthesizer.synthesize(
        session.sessionId, resolvedIntents, pluginOutputs, systemPrompt, strategy, model
      );
      if (strategy.usesLLM()) llmCallCount++;

      // 12. Commit turn
      logger.debug(MOD, 'Phase 12/12: Committing turn', {}, sx);
      this.conversationHandler.commitSuccessfulTurn(
        session, currentMessage, responseMarkdown, currentTurnUnits,
        requestedModel, requestedProcessingMode, requestedRetrievalProfile
      );

      const durationMs = Date.now() - startTime;
      logger.info(MOD, 'Turn complete', { durationMs, llmCalls: llmCallCount, plugins: pluginOutputs.length }, sx);

      return {
        sessionId: session.sessionId,
        responseMarkdown,
        responseDocument,
        requestId,
        llmCallCount,
        durationMs
      };
    })();

    return Promise.race([processPromise, timeoutPromise]);
  }
}
