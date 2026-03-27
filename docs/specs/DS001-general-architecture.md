# DS001 — General Architecture

## Purpose
Defines the overall vision, components, data flow,
and cross-cutting conventions for MRP-VM.

## Description

MRP-VM (Meta-Rational-Pragmatics Virtual Machine) is a
Node.js system that processes natural language requests
through intent decomposition, CNL normalization,
session-context extraction, Knowledge Base retrieval,
and answer synthesis. It uses external plugins for
specialized interpretation (Z3, custom code, etc.)
and communicates with LLMs exclusively through
AchillesAgentLib when the selected language
processing strategy requires LLMs.

## Core Principles

- Zero npm dependencies in production; any external
  library is vendored or invoked as a separate process.
  Vendoring small code (stemmer, stopwords) is allowed
  and stored in `src/lib/vendor/`.
- All LLM communication goes exclusively through the
  `LLMAgent` class from `AchillesAgentLib` (parent
  directory).
- All language-understanding/generation entry points
  that may use LLMs are abstracted behind a strategy
  interface (DS022).
- All evidence-selection and relevance-matching entry
  points are abstracted behind retrieval strategies
  and risk profiles (DS023).
- External interpreters (Z3, custom code, etc.) are
  plugins invoked as separate processes with a
  standardized wrapper respecting CNL I/O conventions.
- All internal knowledge flows in CNL Markdown format.
- Chat/API output in v1 is structured Markdown, not a
  denormalized free-form NL answer.
- Conversation state is session-based in v1. Each
  session owns a temporary in-memory Context CNL store
  derived only from previous user turns.
- Requests, commands, and assistant answers are never
  inserted into the session context store.
- No hidden fallback behavior is allowed for LLM
  failures. If a required LLM step fails after the
  declared retries, the request fails explicitly.
- v1 supports selectable processing modes:
  `llm-assisted` and `symbolic-only`.
- v1 supports selectable retrieval profiles:
  `fast`, `balanced`, and legacy `wide-recall`
  compatibility coverage.
- DS025 defines `thinkingdb` as the intended
  symbolic successor to `wide-recall`.
- v1 baseline retrieval uses BM25 lexical search
  and HDC/VSA associative matching.
- Working language in v1: English-only. Input in other
  languages is unsupported and may produce
  unpredictable results. This constraint applies to
  normalization, tokenization, pattern matching,
  and stopwords.

## Component Architecture

The Core (MRPEngine) is the central orchestrator.
It is not a subordinate layer but coordinates all
other components:

```
                    ┌──────────────┐
                    │   Server     │
                    │  (DS013)     │
                    └──────┬───────┘
                           │
                    ┌──────▼───────┐
              ┌─────┤  MRP Core    ├─────┐
              │     │  (DS002)     │     │
              │     └──┬───┬───┬──┘     │
              │        │   │   │        │
     ┌────────▼──┐  ┌──▼───▼──┐  ┌─────▼────┐
     │Normalizer │  │ Intent  │  │ Answer   │
     │ (DS006)   │  │Decomp.  │  │Synthesis │
     │           │  │(DS011)  │  │ (DS017)  │
     └─────┬─────┘  └────┬────┘  └─────┬────┘
           │              │             │
     ┌─────▼─────┐  ┌────▼────┐  ┌─────▼────┐
     │Validator  │  │Retrieval│  │ Plugins  │
     │ (DS007)   │  │(DS012)  │  │ (DS003)  │
     └───────────┘  └────┬────┘  └─────┬────┘
                         │             │
              ┌──────────▼──────┐  ┌───▼──────┐
              │ Session State   │  │ Wrappers │
              │ + Temp Context  │  │ (DS016)  │
              │    (DS019)      │  └──────────┘
              └───────┬─────────┘
                      │
                    ┌─▼──┬──┬─┐
                    │ KB │In│Pe│
                    │008│18│10│
                    └────┴──┴─┘
```

## Main Data Flow

1. Raw NL request arrives via API or Chat UI with an
   optional `session_id`.
2. Server resolves or creates the session (DS019).
3. Core extracts the current user message, bounded
   prompt history, system instructions, and the
   session temporary context index.
4. Core invokes Normalizer → Intent CNL.
5. Validator checks Intent CNL structure.
6. Core invokes Normalizer again on the current user
   message to extract current-turn Context CNL units
   suitable for the temporary session KB.
7. Validator checks the current-turn Context CNL.
8. IntentDecomposer splits the request into groups
   and derives one context profile per group.
9. Retrieval resolves an evidence-selection plan from
   the active retrieval profile, then matches against
   two evidence stores: session temporary context and
   persistent KB.
10. If needed, Core invokes one deterministic plugin
   per intent group.
11. AnswerSynthesizer produces a structured Markdown
   response grouped by intent and evidence.
12. Only after a successful turn are the current-turn
   session context units committed to the session.
13. Server returns the Markdown response and the
   active `session_id`.

## Cross-Cutting Conventions

### Internal Format
Markdown CNL (see DS004, DS005).

### Public Output Format
`POST /v1/chat/completions` returns Markdown in
`choices[0].message.content`. The Markdown groups the
normalized intents, current-turn context, session
context, persistent KB evidence, plugin evidence, and
final answer per intent group.

### Error Model
All errors propagate as structured objects:
```javascript
{
  code: "NORMALIZER_VALIDATION_FAILED",
  module: "normalizer",
  message: "Intent CNL validation failed after
    corrective retry",
  details: { line: 3, field: "Intent" },
  requestId: "req-abc-123",
  sessionId: "sess-abc-123",
  timestamp: "2026-03-26T09:00:00Z"
}
```

Error code prefixes per module:
- `NORMALIZER_*` — normalization errors
- `VALIDATOR_*` — CNL validation errors
- `KB_*` — persistent Knowledge Base errors
- `SESSION_*` — session state errors
- `RETRIEVAL_*` — retrieval errors
- `PLUGIN_*` — plugin errors
- `SYNTHESIS_*` — synthesis errors
- `SERVER_*` — server/API errors
- `CONFIG_*` — configuration errors

HTTP mapping:
- `*_VALIDATION_*` → 400
- `*_NOT_FOUND` → 404
- `*_TIMEOUT` → 504
- `*_EXPIRED` → 410
- `*_INTERNAL_*` → 500

### Failure Semantics

- No silent truncation of request input is allowed.
  Oversized inputs return explicit errors.
- No `llmFallback` mode exists in v1.
- Normalization is atomic at request level: if
  Intent CNL generation fails, there is no partial
  "continue with what was parsed" mode.
- If normalization, session-context extraction, or
  synthesis fails after the allowed retries, the
  request returns an error.
- `no-context` is a valid result state, not a
  fallback: it means no supporting evidence was found
  in session context or persistent KB.
- Retrieval and plugin execution are resolved per
  intent group. A single response may therefore
  contain mixed group statuses: `answered`,
  `no-context`, and `plugin-error`.
- v1 has one fixed no-context behavior defined by
  DS017. It is not configurable per request.
- Plugin execution errors are surfaced explicitly in
  the relevant intent group; there is no automatic
  secondary plugin fallback.

### Logging
JSONL format on stderr:
```json
{"ts":"2026-03-26T09:00:00Z","level":"info",
 "module":"core","reqId":"req-abc",
 "sessionId":"sess-abc",
 "msg":"Pipeline started","details":{}}
```
Levels: `error`, `warn`, `info`, `debug`.
Configurable via `LOG_LEVEL` env var.

### Configuration
JSON files in `config/`. Env vars override file
values using the convention:
`MRP_<SECTION>_<KEY>` (e.g. `MRP_SERVER_PORT`).
Validation at boot — invalid config = fatal error.

Complete list of config files:
- `config/engine.json` — pipeline, timeouts
- `config/server.json` — port, host, CORS
- `config/llm.json` — temperature, retries, path
- `config/strategies.json` — enabled modes and
  default processing mode
- `config/retrieval.json` — weights, thresholds
- `config/retrieval-strategies.json` — enabled
  retrieval strategies, risk profiles, fusion rules
- `config/kb.json` — paths, chunking params
- `config/conversation.json` — session limits, TTL
- `config/prompts/` — LLM prompts

### Testing
- Symbolic modules (parser, validator, tokenizer,
  index, persistence): deterministic tests with
  fixtures, no mocks.
- LLM-dependent modules (normalizer, synthesis,
  session-context extraction): integration tests
  through AchillesAgentLib on real models tagged
  `fast`. No mocks or stubs for LLM.
- Default CI must remain runnable without live LLM
  dependencies; live-LLM suites are a separate lane
  defined by DS020.
- Code-level integration testing is defined in
  DS020.
- NL input/output evaluation is defined in DS021.

### Security
- Upload size limits (configurable, default 1MB).
- Allowlist for plugin executables in
  `config/engine.json`.
- Path sanitization — `..` and absolute paths
  are forbidden in source names.
- Timeout and memory budget per plugin.
- Configurable CORS (not `*` in production).
- v1 does not provide OS-level sandboxing for
  plugins. This limitation must be documented in
  deployment notes.

### Non-Functional Requirements (v1)

- End-to-end latency target for a simple request
  (no retrieval, no plugin): < 5s.
- End-to-end latency target with retrieval +
  plugin: < 30s.
- Ingest throughput target: < 60s per MB of
  source text.
- Session idle TTL: configurable, default 30 min.
- Recommended persistent KB limits for v1
  file-memory strategy: ≤ 500 sources,
  ≤ 10,000 units, ≤ 100MB total CNL.
- Main process memory envelope: ≤ 512MB for
  KB + indices + active sessions.
- Migration trigger: when KB exceeds the above
  envelope, migrate to a persistent backend
  (SQLite or similar).

## Directory Structure

```
mrp-vm/
├── config/
│   ├── engine.json
│   ├── server.json
│   ├── llm.json
│   ├── retrieval.json
│   ├── retrieval-strategies.json
│   ├── kb.json
│   ├── conversation.json
│   └── prompts/
├── docs/specs/
├── src/
│   ├── core/          # VM orchestration
│   ├── normalizer/    # NL ↔ CNL
│   ├── parser/        # CNL validator & parser
│   ├── intent/        # Intent decomposition
│   ├── kb/            # Persistent Knowledge Base
│   ├── ingest/        # Source chunking
│   ├── retrieval/     # Indexing & retrieval
│   │   └── strategies/ # Retrieval strategy backends
│   ├── synthesis/     # Answer synthesis
│   ├── conversation/  # Session state
│   ├── plugins/       # Plugin system
│   ├── llm/           # LLM bridge adapter
│   ├── server/        # HTTP server & API
│   ├── ui/            # Static chat page
│   └── lib/vendor/    # Vendored libs
├── wrappers/          # External interpreters
├── data/              # Runtime data (gitignored)
│   └── kb/
│       ├── sources/   # Original NL files
│       ├── cnl/       # Generated Context CNL
│       ├── meta/      # Per-source metadata
│       ├── index/     # Persistent index files
│       └── quarantine/# Invalid CNL at boot
├── AGENTS.md
└── package.json
```

## External Dependencies

- `AchillesAgentLib` — from parent directory,
  provides the `LLMAgent` class. Path configured
  in `config/llm.json` field `"achillesPath"`,
  default `"../AchillesAgentLib"`.
- Optional symbolic-only backends may use
  `wink-nlp` or equivalent NLP tooling behind the
  DS022 interface. This is an implementation choice,
  not a core architectural dependency.
- Optional retrieval backends may use embeddings,
  HDC/VSA, or symbolic-analysis workers behind the
  DS023 interface. This is an implementation choice,
  not a core architectural dependency.
- External interpreters — invoked as processes,
  not as Node.js dependencies.
