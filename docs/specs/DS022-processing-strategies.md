# DS022 — Processing Strategies

## Purpose
Defines the pluggable strategy interface for all
language-processing capabilities that may currently
be implemented with LLMs. This allows MRP-VM to run
with different backends, including a faster
`symbolic-only` mode.

## Scope

DS022 covers the capabilities currently fulfilled in
the LLM-assisted path by DS006 and DS017:
- intent normalization
- session-context extraction
- persistent context normalization for ingest
- answer synthesis

It does NOT replace:
- DS007 validation/parsing
- DS011 symbolic decomposition
- DS012 retrieval
- DS003 plugin execution

## Design Goal

Every place in the architecture that currently uses
LLM-backed language processing must depend on a
strategy object, not directly on a concrete LLM
backend.

This enables:
- `llm-assisted` implementation using
  AchillesAgentLib
- `symbolic-only` implementation using wink-nlp,
  regex/rule pipelines, deterministic templates,
  or similar tooling
- future hybrid or more advanced implementations

## Core Interface

```javascript
class LanguageProcessingStrategy {
  getId() → string
  usesLLM() → boolean
  supportsModelOverride() → boolean
  getCapabilities() → string[]

  async normalizeIntent(input) → {
    intentCNL: string
  }

  async extractSessionContext(input) → {
    contextCNL: string
  }

  async normalizePersistentContext(input) → {
    contextCNL: string
  }

  async synthesizeResponse(input) → {
    responseDocument,
    responseMarkdown
  }
}
```

Input contracts:

```javascript
// normalizeIntent
{
  rawNL: string,
  history: Message[],
  systemPrompt: string | null,
  requestedModel: string | null
}

// extractSessionContext
{
  rawNL: string,
  systemPrompt: string | null,
  requestedModel: string | null
}

// normalizePersistentContext
{
  chunkText: string,
  provenance: object,
  requestedModel: string | null
}

// synthesizeResponse
{
  sessionId: string,
  resolvedIntents: ResolvedIntent[],
  pluginOutputs: PluginOutput[],
  systemPrompt: string | null,
  requestedModel: string | null
}
```

## Strategy Registry

```javascript
class StrategyRegistry {
  register(strategy) → void
  get(strategyId) → LanguageProcessingStrategy | null
  list() → StrategyInfo[]
  resolve(requestedMode, sessionMode, defaultMode) →
    LanguageProcessingStrategy
}

// StrategyInfo
{
  id: "llm-assisted" | "symbolic-only",
  usesLLM: boolean,
  supportsModelOverride: boolean,
  capabilities: string[]
}
```

Resolution order:
1. request explicit `processing_mode`
2. session preference
3. deployment default

There is no silent fallback from one strategy to
another. If the selected strategy is unavailable or
cannot handle the input, return an explicit error.

## Built-In Modes

### `llm-assisted`
- Uses AchillesAgentLib through DS015.
- Supports all v1 capabilities.
- Supports model override.
- Uses corrective retry rules from DS006.

### `symbolic-only`
- Uses no LLM.
- Does not support model override.
- May be implemented with wink-nlp, deterministic
  tokenizers, regex rules, and Markdown templates.
- If wink-nlp is used, it is an implementation
  backend of this strategy, not a core dependency
  of MRP-VM.

Expected v1 limits of `symbolic-only`:
- lower recall and narrower NL coverage
- better latency and cost profile
- deterministic failure on unsupported inputs

## Symbolic-Only Capability Envelope

The initial symbolic-only implementation is allowed
to support only a restricted subset well:
- intent normalization for common request patterns
- session-context extraction for stable facts,
  preferences, and constraints
- persistent context normalization for structured
  technical prose and procedural text
- answer synthesis via deterministic Markdown
  templates, not free-form prose generation

If a request falls outside this supported envelope,
the strategy should return:
- `STRATEGY_UNSUPPORTED_INPUT`, or
- `STRATEGY_CAPABILITY_NOT_AVAILABLE`

It must not silently delegate to LLM.

## Configuration

`config/strategies.json`:
```json
{
  "defaultMode": "llm-assisted",
  "enabledModes": ["llm-assisted", "symbolic-only"]
}
```

## UI/API Integration

- DS013 exposes `processing_mode` in chat/session
  requests and `GET /v1/processing-strategies`.
- DS014 exposes a strategy selector in the chat UI.
- DS019 stores the selected mode as a session
  preference.

## Dependencies

- DS006 — normalization capabilities
- DS017 — synthesis capability
- DS015 — `llm-assisted` backend
- DS013 — API surface
- DS014 — UI selector
- DS019 — session preference
