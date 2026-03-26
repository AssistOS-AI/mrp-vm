# DS002 — MRP-VM Core Engine

## Purpose
Central engine of the VM. Orchestrates the processing
pipeline: receives session-scoped NL requests from the
Server, coordinates normalization, session-context
extraction, retrieval, plugins, and answer synthesis.

## Responsibilities

- Receives raw NL requests from Server (DS013).
- Resolves the active session and current turn through
  ConversationHandler (DS019).
- Resolves the active language processing strategy
  through StrategyRegistry (DS022).
- Resolves the active retrieval profile and evidence
  selection plan through DS023.
- Invokes Normalizer for NL → Intent CNL.
- Invokes Normalizer for current-turn NL →
  Session Context CNL.
- Sends each intent group through the decomposition
  and retrieval pipeline.
- Coordinates calls to external plugins/interpreters
  when an intent requires specialized processing.
- Invokes AnswerSynthesizer for the final Markdown
  response.
- Commits the turn to session state only after a
  successful response is produced.
- Manages the request lifecycle and operational
  budgets.

## Main Interface

```javascript
class MRPEngine {
  constructor(config, normalizer, parser,
    decomposer, retrieval, synthesizer,
    pluginManager, conversationHandler,
    strategyRegistry)

  async processChatTurn(request) → {
    sessionId: string,
    responseMarkdown: string,
    responseDocument: ResponseDocument,
    requestId: string,
    llmCallCount: number,
    durationMs: number
  }

  async boot() → void
}
```

## Internal Pipeline

1. Server passes:
   `{ sessionId?, model?, processingMode?,
   retrievalProfile?, messages[] }`.
2. `ConversationHandler.prepareTurn(...)` resolves or
   creates the session and returns:
   `{ session, currentMessage, historyForPrompt,
   systemPrompt, requestedModel,
   requestedProcessingMode,
   requestedRetrievalProfile }`.
3. `strategyRegistry.resolve(...)` returns the active
   `LanguageProcessingStrategy`.
4. Retrieval profile resolution picks the active
   `RetrievalRiskProfile`.
5. `currentMessage + historyForPrompt + systemPrompt`
   → `Normalizer.toIntentCNL(..., strategy)` →
   `intentCNL` (LLM call #1).
6. `intentCNL` → Validator → validated or error.
7. `currentMessage + systemPrompt` →
   `Normalizer.toSessionContextCNL(..., strategy)` →
   `currentTurnContextCNL` (LLM call #2).
8. `currentTurnContextCNL` → Validator/Parser →
   `currentTurnContextUnits[]`.
9. `intentCNL` → IntentDecomposer →
   `decomposedIntents[]`.
10. For each decomposed intent:
   a. Derive context profile.
   b. Retrieval runs through DS012 using the active
      retrieval profile. It may execute one or more
      retrieval strategies sequentially or in
      parallel.
   c. If needed, invoke one deterministic plugin
      keyed by `intentRef`.
11. `resolvedIntents[] + pluginOutputs[]` →
   `AnswerSynthesizer.synthesize(..., strategy)` →
   `responseDocument` and `responseMarkdown`
   (LLM call #3 only if at least one group has
   evidence to synthesize).
12. `ConversationHandler.commitSuccessfulTurn(...)`
    persists:
    - current user message
    - assistant Markdown response
    - current-turn context units
    - selected model preference
    - selected processing mode
    - selected retrieval profile
13. Return response.

## Operational Budget Per Request

- Primary LLM stages per request: 3
  (intent normalization, session-context
  extraction, synthesis).
- Max actual LLM attempts per request: 5
  (configurable). This includes corrective retries
  for validation failures.
- Total timeout: 60s (configurable).
- Parallel calls allowed: retrieval per intent
  group (when multiple groups exist).
- Retrieval strategies inside one intent group may
  also run in parallel when the active retrieval
  profile allows it.
- If the budget is exceeded, return
  `ENGINE_BUDGET_EXCEEDED`.
- There is no partial return on budget exhaustion.

## Boot Sequence

Initialization order at startup:

1. Validate config (fatal if invalid).
2. Initialize StrategyRegistry.
3. Initialize enabled strategies:
   a. Initialize LLMBridge if `llm-assisted`
      strategy is enabled (fatal if fails).
   b. Initialize symbolic-only strategy if enabled.
4. Initialize SessionManager/ConversationHandler.
5. Scan wrappers → register plugins
   (warning if a wrapper is invalid).
6. Load persistent KB from persistence:
   a. Read CNL files.
   b. Validate each with Validator (skip +
      warning if invalid).
   c. Load into memory.
7. Rebuild or load BM25 index
   (rebuild if index does not match).
8. Initialize RetrievalStrategyRegistry and enabled
   retrieval strategies (fatal if a required
   strategy cannot initialize).
9. Mark readiness.
10. Start HTTP server.

Fatal errors stop boot. Warnings are logged
and boot continues.

## Failure Handling

### Intent normalization failure
- Initial attempt + max 1 corrective retry.
- If the LLM call itself fails: return
  `NORMALIZER_FAILED`.
- If the produced CNL remains invalid after the
  corrective retry: return
  `NORMALIZER_VALIDATION_FAILED`.

### Session-context extraction failure
- Initial attempt + max 1 corrective retry.
- If the LLM call itself fails: return
  `SESSION_CONTEXT_FAILED`.
- If the produced CNL remains invalid after the
  corrective retry: return
  `SESSION_CONTEXT_VALIDATION_FAILED`.

### Decomposition failure
- If parsing succeeds but decomposition yields
  zero intent groups: return
  `DECOMPOSER_EMPTY_RESULT`.

### Retrieval result = no evidence
- This is a valid result state.
- The corresponding intent group is marked
  `no-context` in the final Markdown.
- No LLM fallback is attempted.

### Mixed group outcomes in one request
- Requests with multiple intent groups are handled
  per group, not all-or-nothing.
- Some groups may be `answered` while others are
  `no-context` or `plugin-error`.
- `AnswerSynthesizer` always receives the full
  per-group result set and renders one section per
  `intentRef`.
- A request fails only when a critical global stage
  fails before per-group resolution can complete
  (normalization, session-context extraction,
  decomposition, or synthesis).

### Plugin failure or timeout
- The corresponding intent group is marked
  `plugin-error`.
- The exact plugin error is surfaced in the
  response document.
- No secondary plugin is tried automatically.

### Synthesis failure
- Return `SYNTHESIS_FAILED`.
- No raw-context fallback is emitted.

## Configuration

`config/engine.json`:
```json
{
  "maxPrimaryLLMStagesPerRequest": 3,
  "maxLLMAttemptsPerRequest": 5,
  "requestTimeoutMs": 60000,
  "maxValidationCorrectionRetriesPerStage": 1,
  "pluginAllowlist": ["z3-solver"],
  "pluginTimeoutMs": 30000,
  "pluginMemoryLimitMB": 256
}
```

## Internal Dependencies

- `src/conversation/` (DS019)
- `src/normalizer/` (DS006)
- `src/strategies/` (DS022)
- `src/parser/` (DS007)
- `src/intent/` (DS011)
- `src/retrieval/` (DS012)
- `src/retrieval/strategies/` (DS023)
- `src/synthesis/` (DS017)
- `src/plugins/` (DS003)
- `src/llm/` (DS015)
