# DS015 — LLMAgent Integration (AchillesAgentLib)

## Purpose
Defines how the LLMAgent class from the
AchillesAgentLib library integrates into the
`llm-assisted` processing strategy of MRP-VM.

## Principle

All LLM calls go exclusively through `LLMAgent`
from `AchillesAgentLib`. No other libraries or
direct API calls to LLMs are used when the active
strategy uses LLMs.

## Location

The path to AchillesAgentLib is configured in
`config/llm.json`, field `achillesPath`.
Default: `"../AchillesAgentLib"`.

A single local adapter is created:
`src/llm/achilles.js` which resolves the path
and exports LLMAgent. All modules import from
this adapter, never directly.

```javascript
// src/llm/achilles.js
const config = require('../../config/llm.json');
const path = require('path');
const resolved = path.resolve(__dirname,
  '../../', config.achillesPath);
module.exports = require(resolved);
```

## Model Selection Policy

Override order:
1. Request explicit — `model` field in the current
   API request body (see DS013).
2. Session preference — last accepted `model`
   stored on the active session (DS019).
3. Default discovery — a model tagged `fast` by
   one of the providers discovered by
   AchillesAgentLib. If multiple `fast` models
   exist, sort by provider name, then by model ID,
   and select the first result (deterministic).

## Model Discovery

LLMBridge exposes a method to list available
models, consumed by `GET /v1/models` (DS013):

```javascript
class LLMBridge {
  constructor(config)
  async call(systemPrompt, userMessage, opts) →
    string
  async callWithRetry(systemPrompt, userMessage,
    opts, maxRetries) → string
  getAvailableModels() → ModelInfo[]
}

// ModelInfo
{
  id: "provider/model-name",
  provider: "provider",
  tags: ["fast"]
}
```

Responsibilities:
- Configures LLMAgent with appropriate parameters.
- Manages retries with exponential backoff for
  transient provider failures only.
- Logs calls (requestId, sessionId, duration,
  model, tokens when available).
- Propagates timeout and cancellation.
- Counts calls per request (for budget).

Retry terminology:
- **Transport/provider retry** — handled here in
  DS015 when a provider call fails transiently.
- **Validation-correction retry** — handled in
  DS006 after a syntactically successful LLM output
  fails DS007 validation.

These are distinct mechanisms and must not be
collapsed into one setting.

## Retryability Rules

Retryable errors:
- provider timeout
- transient network failure
- HTTP 429 / rate limit
- temporary provider unavailability

Non-retryable errors:
- invalid prompt/input
- invalid or empty provider response
- validator rejection of LLM output
- unknown model ID

Retries are not fallback behavior. They reuse the
same model and the same prompt contract.

Budget interaction:
- Each transport/provider retry is a real LLM
  attempt and counts toward
  `maxLLMAttemptsPerRequest` (DS002) or the ingest
  attempt budget.
- A validation-correction retry from DS006 also
  counts as a separate LLM attempt.

## Configuration

`config/llm.json`:
```json
{
  "achillesPath": "../AchillesAgentLib",
  "defaultTemperature": 0.1,
  "maxTransportRetriesPerAttempt": 2,
  "timeoutMs": 30000,
  "defaultModel": "fast"
}
```

## Dependencies

- AchillesAgentLib (external, configurable path).
- DS022 (Processing Strategies) — this DS defines
  the `llm-assisted` strategy backend.
- DS006 (Normalizer) — primary consumer.
- DS017 (Synthesis) — consumer.
- DS019 (Session model preference) — model source.
