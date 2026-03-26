# AGENTS.md — MRP-VM Design Specifications Map

## About This Project

MRP-VM (Meta-Rational-Pragmatics Virtual Machine) is
a Node.js system that processes natural language requests
through intent decomposition, CNL (Controlled Natural
Language) normalization, Knowledge Base retrieval, and
answer synthesis. It uses external plugins for
specialized interpretation (Z3, custom code, etc.)
and communicates with LLMs exclusively through
AchillesAgentLib.

## Language Policy

All documentation, code, comments, and Markdown files
MUST be written in English. Temporary review files
(e.g. `*.review.md`) may be in any language.
Agent conversations may use Romanian or other languages.

---

## Architecture & Core

| DS | File | Role |
|----|------|------|
| DS001 | [DS001-general-architecture.md](docs/specs/DS001-general-architecture.md) | General architecture: components, data flow, cross-cutting conventions (error model, logging, security, testing, NFRs), directory structure. |
| DS002 | [DS002-mrp-vm-core.md](docs/specs/DS002-mrp-vm-core.md) | Central VM engine: session-scoped pipeline orchestration, boot sequence, operational budget, explicit failure handling. |

## Plugin System & External Interpreters

| DS | File | Role |
|----|------|------|
| DS003 | [DS003-plugin-system.md](docs/specs/DS003-plugin-system.md) | Plugin system: discovery, dispatch rules, conflict resolution, canonical PluginOutput, security. |
| DS016 | [DS016-wrapper-convention.md](docs/specs/DS016-wrapper-convention.md) | Wrapper convention: manifest.json, protocol I/O v1, format input/output exact, exit codes. |

## CNL (Controlled Natural Language)

| DS | File | Role |
|----|------|------|
| DS004 | [DS004-intent-cnl.md](docs/specs/DS004-intent-cnl.md) | Intent CNL: format with explicit Act field, pragmatic acts enum, canonical act→roles mapping, parsing rules and edge cases. |
| DS005 | [DS005-context-cnl.md](docs/specs/DS005-context-cnl.md) | Context CNL: format with provenance (sourceId, chunkId), structured UtilityActs, deterministic ID schema, roles enum. |
| DS007 | [DS007-cnl-validator-parser.md](docs/specs/DS007-cnl-validator-parser.md) | Validator & symbolic parser: structural validation separated from parsing, standardized error codes, enum verification. |

## NL ↔ CNL Normalization

| DS | File | Role |
|----|------|------|
| DS006 | [DS006-nl-normalizer.md](docs/specs/DS006-nl-normalizer.md) | Normalizer: NL→Intent CNL (with Act), NL→Context CNL, CNL→NL. Input limits, English-only v1. |

## Intent Processing

| DS | File | Role |
|----|------|------|
| DS011 | [DS011-intent-decomposition.md](docs/specs/DS011-intent-decomposition.md) | Intent decomposition: DecomposedIntent extraction, ContextProfile derivation, reference to canonical mapping in DS004. |

## Knowledge Base

| DS | File | Role |
|----|------|------|
| DS008 | [DS008-knowledge-base.md](docs/specs/DS008-knowledge-base.md) | KB: 3 file types, CRUD with atomic writes, per-source metadata, dirty/ready status, configurable limits. |
| DS009 | [DS009-kb-indexing-retrieval.md](docs/specs/DS009-kb-indexing-retrieval.md) | Internal BM25 indexing: complete indexed fields schema, English tokenization with hyphen/possessives rules, vendored stemming, scoring formula. |
| DS010 | [DS010-kb-persistence.md](docs/specs/DS010-kb-persistence.md) | File+memory persistence: atomic writes, boot validation, quarantine for invalid files, indexData format with schemaVersion. |
| DS018 | [DS018-source-ingestion-chunking.md](docs/specs/DS018-source-ingestion-chunking.md) | Ingest & Chunking: NL document segmentation, semantic chunking on Markdown structure, source→chunk→unit mapping, idempotency. |

## Retrieval & Matching

| DS | File | Role |
|----|------|------|
| DS012 | [DS012-retrieval-context-matching.md](docs/specs/DS012-retrieval-context-matching.md) | Intent CNL ↔ Context CNL matching: retrieval pipeline, deduplication, context aggregation with provenance, plugin handoff. |

## Retrieval Strategies

| DS | File | Role |
|----|------|------|
| DS023 | [DS023-retrieval-strategies.md](docs/specs/DS023-retrieval-strategies.md) | Retrieval strategy interface: pluggable lexical, semantic, HDC/VSA, and symbolic relevance filters, plus risk profiles and fusion rules. |

## Answer Synthesis

| DS | File | Role |
|----|------|------|
| DS017 | [DS017-answer-synthesis.md](docs/specs/DS017-answer-synthesis.md) | Answer synthesis: structured Markdown output, grounding policy, plugin output integration, explicit no-context rendering, LLM budget. |

## Server & Interface

| DS | File | Role |
|----|------|------|
| DS013 | [DS013-server-api.md](docs/specs/DS013-server-api.md) | Native HTTP server: OpenAI-shaped minimal API, KB CRUD endpoints, model discovery, retrieval-profile discovery, error payloads, health/readiness, HTTP status codes. |
| DS014 | [DS014-chat-ui.md](docs/specs/DS014-chat-ui.md) | Static chat page: text file attachment, ingest feedback, session-aware chat, model selector, processing-mode selector, retrieval-profile selector. |

## Conversation

| DS | File | Role |
|----|------|------|
| DS019 | [DS019-conversation-state.md](docs/specs/DS019-conversation-state.md) | Conversation management: session-centric turns, temporary session KB, systemPrompt propagation, TTL, processing-mode and retrieval-profile preferences. |

## Testing & Evaluation

| DS | File | Role |
|----|------|------|
| DS020 | [DS020-integration-testing.md](docs/specs/DS020-integration-testing.md) | Integration testing: code-level contract verification across server, core, KB, plugins, and session flow, without LLM mocks. |
| DS021 | [DS021-evaluation.md](docs/specs/DS021-evaluation.md) | Evaluation: NL input/output behavior assessment, expected Markdown properties, strategy-aware quality metrics. |

## LLM Integration

| DS | File | Role |
|----|------|------|
| DS015 | [DS015-llmagent-integration.md](docs/specs/DS015-llmagent-integration.md) | AchillesAgentLib integration: single local adapter for LLM-backed strategies, deterministic fast-model selection, model discovery, retry and logging. |

## Processing Strategies

| DS | File | Role |
|----|------|------|
| DS022 | [DS022-processing-strategies.md](docs/specs/DS022-processing-strategies.md) | Processing strategy interface: pluggable `llm-assisted` and `symbolic-only` backends for normalization, session context extraction, persistent context extraction, and synthesis. |

---

## Dependency Diagram

```
DS013 (Server) ──→ DS002 (Core)
  │                  │
  │                  ├→ DS019 (Conversation)
  │                  │
  │                  ├→ DS022 (Strategies)
  │                  │    └→ DS015 (LLM backend, when needed)
  │                  │
  │                  ├→ DS006 (Normalizer)
  │                  │    ├→ DS022 (active backend)
  │                  │    └→ DS007 (Validator)
  │                  │         ├→ DS004 (Intent CNL)
  │                  │         └→ DS005 (Context CNL)
  │                  │
  │                  ├→ DS011 (Decomposition)
  │                  │    └→ DS004 (canonical mapping)
  │                  │
  │                  ├→ DS012 (Retrieval)
  │                  │    ├→ DS009 (Indexing/BM25)
  │                  │    ├→ DS023 (retrieval strategies)
  │                  │    └→ DS004 (canonical mapping)
  │                  │
  │                  ├→ DS017 (Answer Synthesis)
  │                  │    └→ DS022 (active backend)
  │                  │
  │                  └→ DS003 (Plugins)
  │                       └→ DS016 (Wrapper Conv.)
  │
  ├→ DS008 (KB)
  │    ├→ DS018 (Ingest/Chunking)
  │    │    └→ DS006 (Normalizer)
  │    ├→ DS009 (Indexing)
  │    └→ DS010 (Persistence)
  │         └→ DS007 (Validator, at boot)
  │
  ├→ DS014 (Chat UI)
  ├→ DS020 (Integration Testing)
  └→ DS021 (Evaluation)
```
