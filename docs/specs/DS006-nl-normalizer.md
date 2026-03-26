# DS006 — NL Normalizer

## Purpose
The normalization module that transforms NL
(Natural Language) into CNL (Controlled Natural
Language). It is a distinct module, implemented and
tested separately, and delegates the actual language
processing backend to a selected strategy (DS022).

## Working Language

v1: Input may be in any language. The Normalizer
(via the active strategy) translates all input into
English CNL. Internal processing, tokenization,
indexing, and output remain English-only.

## Responsibilities

### NL → Intent CNL (for user requests)
- Receives raw English text + bounded conversation
  history (DS019) + system prompt (if present).
- Uses LLMAgent (via LLMBridge, DS015) with low
  temperature and strict instructions when the
  selected strategy is `llm-assisted`.
- The LLM does NOT answer the problem and does NOT
  perform retrieval. Its only role is to rewrite the
  request into valid Intent CNL Markdown, including
  the `Act` field.
- Separates intent groups.
- Clearly expresses the explicit context of each
  intent.

Valid minimal example:

```markdown
## Intent Group 1
Act: define
Intent: What is the capital of France?
Output: Short factual answer.
```

An output that omits `Act` is invalid and must be
rejected by DS007, then retried or failed according
to the normalizer contract.

### NL → Session Context CNL (for temporary session KB)
- Receives only the current user message, not the
  whole transcript.
- Extracts contextual facts that may matter in later
  turns: assumptions, constraints, user preferences,
  environment details, stable project facts.
- MUST exclude direct requests, questions, commands,
  task descriptions, and any assistant-authored text.
- Produces zero or more Context CNL units suitable
  for insertion into the session temporary context
  store (DS019).

### NL → Persistent Context CNL (for KB ingest)
- Receives NL chunks from SourceIngestor (DS018),
  not entire documents.
- Transforms each chunk into one or more Context
  CNL units with pragmatic role, topic, claim,
  UtilityActs, etc.
- Uses LLMAgent with a dedicated prompt.
  In `symbolic-only` mode this capability may be
  fulfilled by rule-based extraction instead.
- Receives provenance (sourceId, chunkId) and
  includes them in the output.

### CNL → NL
- This direction is not part of the main v1 chat/API
  pipeline.
- It may exist as an auxiliary utility, but
  `POST /v1/chat/completions` returns structured
  Markdown directly (see DS013 and DS017).

## Main Interface

```javascript
class NLNormalizer {
  constructor(strategyRegistry)
  async toIntentCNL(rawNL, history,
    systemPrompt, strategy) → string
  async toSessionContextCNL(rawNL,
    systemPrompt, strategy) → string
  async toContextCNL(chunkText, provenance,
    strategy) →
    string
  async toNaturalLanguage(cnl) → string
}
```

## Prompts

Each conversion direction has a dedicated prompt
stored in `config/prompts/`:
- `normalize-intent.md` — NL → Intent CNL
- `normalize-session-context.md` —
  NL → session Context CNL
- `normalize-context.md` — NL → persistent
  Context CNL
- `synthesize.md` — answer synthesis (DS017)

Prompts contain:
- Strict instructions not to invent facts.
- The pragmatic acts enum (DS004).
- The pragmatic roles enum (DS005).
- Input/output examples.
- CNL formatting rules.
- Explicit negative instructions for what must be
  excluded from session context extraction.

## LLM Parameters

- Temperature: 0.1 (very low, maximum determinism).
- Max tokens: configurable per direction.
- System prompt: from the files above.
- Model: selected per DS015 policy
  (request override > session preference >
  default `fast`) when the strategy uses LLMs.

## Input Limits

- Max input for intent normalization:
  configurable, default 8000 characters.
- Max input for session-context extraction:
  configurable, default 8000 characters.
- If an input exceeds its limit, return
  `NORMALIZER_INPUT_TOO_LARGE`.
- No truncation is allowed.
- Max input for persistent context normalization:
  controlled by chunking (DS018), but the
  normalizer must still validate and return
  `NORMALIZER_INPUT_TOO_LARGE` if the contract is
  violated.

## Post-Normalization Validation

After the LLM produces output, it must pass
through the Validator (DS007). If invalid,
perform at most 1 corrective retry as defined
below. Each retry logs the failure reason.

## Validation-Correction Retry Loop

The retry contract for `toIntentCNL`,
`toSessionContextCNL`, and `toContextCNL` is:

1. Run the normal prompt once.
2. Validate the produced CNL with DS007.
3. If valid, return it immediately.
4. If invalid, build a corrective retry prompt
   containing:
   - the original source input
   - the invalid CNL from the previous attempt
   - the validator errors (`code`, `field`,
     `line`, `message`)
   - an instruction to repair the document without
     changing the original intent more than needed
5. Retry at most 1 corrective retry per stage by
   default.
6. If the corrective retry still fails validation,
   return an explicit stage error.

This retry loop applies only to strategies that use
LLM generation. Deterministic strategies may return
validation failure immediately without corrective
retry.

Stage error codes:
- `NORMALIZER_FAILED`
- `NORMALIZER_VALIDATION_FAILED`
- `SESSION_CONTEXT_FAILED`
- `SESSION_CONTEXT_VALIDATION_FAILED`
- `KB_CONTEXT_FAILED`
- `KB_CONTEXT_VALIDATION_FAILED`

Budget interaction:
- Every initial attempt and every corrective retry
  consumes one LLM attempt from the request/source
  budget.
- If no budget remains for the corrective retry,
  fail immediately with `ENGINE_BUDGET_EXCEEDED`
  or `KB_INGEST_BUDGET_EXCEEDED`, depending on the
  pipeline.

## Testing

Integration tests (no LLM mocks):
- Sets of NL requests → verify valid Intent CNL.
- Sets of current-turn messages → verify filtered
  Session Context CNL.
- Sets of KB chunks → verify persistent
  Context CNL.
- Run through AchillesAgentLib on `fast` models.
- Full test strategy is defined in DS020.
- NL input/output evaluation is defined in DS021.

## Dependencies

- DS022 (Processing Strategies) — active backend.
- DS015 (LLMBridge) — LLM calls.
- DS007 (Validator) — output validation.
- DS004 (Intent CNL) — target format for requests.
- DS005 (Context CNL) — target format for KB and
  session context.
- DS019 (Conversation) — session state.
