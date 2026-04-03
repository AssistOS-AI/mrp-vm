# AGENTS.md — MRP-VM Design Specifications Map

## About This Project

MRP-VM (Meta-Rational-Pragmatics Virtual Machine) is
a Node.js system organized as a lightweight plugin
kernel. The core manages sessions, budgets, and
generic orchestration. Most behavior is implemented
through typed plugins:

- `sd-plugin` — seed detectors
- `kb-plugin` — context retrievers / KB backends
- `gs-plugin` — goal solvers
- `mrp-plan-plugin` — meta-rational planners
- `val-plugin` — response validators

It communicates with LLMs exclusively through
AchillesAgentLib.

## Language Policy

All documentation, code, comments, and Markdown files
MUST be written in English. Temporary review files
(e.g. `*.review.md`) may be in any language.
Agent conversations may use Romanian or other
languages.

---

## Architecture & Core

| DS | File | Role |
|----|------|------|
| DS001 | [DS001-general-architecture.md](docs/specs/DS001-general-architecture.md) | General architecture: plugin-kernel model, data flow, cross-cutting conventions, and configuration surface. |
| DS002 | [DS002-mrp-vm-core.md](docs/specs/DS002-mrp-vm-core.md) | Lightweight VM kernel: session-scoped orchestration, plugin-stage execution, budgets, and tracing. |
| DS003 | [DS003-plugin-system.md](docs/specs/DS003-plugin-system.md) | Typed plugin runtime: discovery, registration, execution context, security, and source-text propagation. |
| DS027 | [DS027-plugin-types.md](docs/specs/DS027-plugin-types.md) | Rigorous interfaces for `sd-plugin`, `kb-plugin`, `gs-plugin`, `val-plugin`, and `mrp-plan-plugin`. |
| DS029 | [DS029-mrp-plan-plugins.md](docs/specs/DS029-mrp-plan-plugins.md) | Planner plugins: execution-order planning, logging, learning, and adaptive escalation. |

## Plugin System & External Interpreters

| DS | File | Role |
|----|------|------|
| DS016 | [DS016-wrapper-convention.md](docs/specs/DS016-wrapper-convention.md) | Wrapper convention for external plugin processes and manifest-driven execution. |

## CNL (Controlled Natural Language)

| DS | File | Role |
|----|------|------|
| DS004 | [DS004-intent-cnl.md](docs/specs/DS004-intent-cnl.md) | Intent CNL schema. |
| DS005 | [DS005-context-cnl.md](docs/specs/DS005-context-cnl.md) | Context CNL schema. |
| DS007 | [DS007-cnl-validator-parser.md](docs/specs/DS007-cnl-validator-parser.md) | Validator and parser for the shared CNL formats. |
| DS031 | [DS031-sop-lang-control.md](docs/specs/DS031-sop-lang-control.md) | SOP Lang Control surface syntax and command catalog. |
| DS032 | [DS032-sop-interpreter.md](docs/specs/DS032-sop-interpreter.md) | Deterministic SOP interpreter semantics, frame admission, and trace integration. |

## NL ↔ CNL Normalization

| DS | File | Role |
|----|------|------|
| DS006 | [DS006-nl-normalizer.md](docs/specs/DS006-nl-normalizer.md) | Shared normalizer helpers used by seed detectors and KB ingest flows. |

## Intent Processing

| DS | File | Role |
|----|------|------|
| DS011 | [DS011-intent-decomposition.md](docs/specs/DS011-intent-decomposition.md) | Symbolic decomposition and context-profile derivation used by plugins and core helpers. |

## Knowledge Base

| DS | File | Role |
|----|------|------|
| DS008 | [DS008-knowledge-base.md](docs/specs/DS008-knowledge-base.md) | KB substrate, semantic units, derived memories, and repository/workspace semantics. |
| DS009 | [DS009-kb-indexing-retrieval.md](docs/specs/DS009-kb-indexing-retrieval.md) | BM25 lexical backend reused by KB plugins. |
| DS010 | [DS010-kb-persistence.md](docs/specs/DS010-kb-persistence.md) | Persistence for KB data plus plugin-private artifacts. |
| DS018 | [DS018-source-ingestion-chunking.md](docs/specs/DS018-source-ingestion-chunking.md) | Semantic-unit extraction and source ingest. |
| DS026 | [DS026-kb-repositories-workspaces.md](docs/specs/DS026-kb-repositories-workspaces.md) | KB repositories and session workspaces. |

## Retrieval & Matching

| DS | File | Role |
|----|------|------|
| DS012 | [DS012-retrieval-context-matching.md](docs/specs/DS012-retrieval-context-matching.md) | Resolved-intent assembly and evidence bundling across KB plugins. |
| DS023 | [DS023-retrieval-strategies.md](docs/specs/DS023-retrieval-strategies.md) | KB plugin family and goal-conditioned retrieval principles. |
| DS024 | [DS024-hdc-vsa-retrieval.md](docs/specs/DS024-hdc-vsa-retrieval.md) | HDC/VSA backend used by `kb-balanced` or similar plugins. |
| DS025 | [DS025-thinkingdb-symbolic-retrieval.md](docs/specs/DS025-thinkingdb-symbolic-retrieval.md) | ThinkingDB backend used by `kb-thinkingdb` or future symbolic KB plugins. |

## Goal Formation & Solving

| DS | File | Role |
|----|------|------|
| DS017 | [DS017-answer-synthesis.md](docs/specs/DS017-answer-synthesis.md) | Final answer semantics consumed by goal solver plugins. |
| DS022 | [DS022-processing-strategies.md](docs/specs/DS022-processing-strategies.md) | Seed detector and goal solver plugin families, replacing monolithic processing modes. |

## Server, Settings & Interface

| DS | File | Role |
|----|------|------|
| DS013 | [DS013-server-api.md](docs/specs/DS013-server-api.md) | API surface for chat, typed plugin selection, plugin catalogs, and settings. |
| DS014 | [DS014-chat-ui.md](docs/specs/DS014-chat-ui.md) | Static chat UI with plugin selectors and settings page/panel. |
| DS028 | [DS028-llm-role-settings.md](docs/specs/DS028-llm-role-settings.md) | Shared role-based LLM settings visible to all plugins. |

## Conversation

| DS | File | Role |
|----|------|------|
| DS019 | [DS019-conversation-state.md](docs/specs/DS019-conversation-state.md) | Session-centric state, plugin preferences, and workspace visibility. |

## Testing & Evaluation

| DS | File | Role |
|----|------|------|
| DS020 | [DS020-integration-testing.md](docs/specs/DS020-integration-testing.md) | Integration testing across typed plugins, kernel, KB, and sessions. |
| DS021 | [DS021-evaluation.md](docs/specs/DS021-evaluation.md) | Evaluation matrix for planner behavior, plugin combinations, and grounded outputs. |

## LLM Integration

| DS | File | Role |
|----|------|------|
| DS015 | [DS015-llmagent-integration.md](docs/specs/DS015-llmagent-integration.md) | AchillesAgentLib integration, model discovery, retries, and role-based model resolution. |

## Knowledge Unit Model

| DS | File | Role |
|----|------|------|
| DS030 | [DS030-knowledge-unit.md](docs/specs/DS030-knowledge-unit.md) | Knowledge Unit (KU): hierarchical knowledge abstraction, provenance, and KU-based context construction. |

---

## Dependency Diagram

```text
DS013 / DS014
      |
      v
DS002 Core Kernel (frames + loop)
      |
      +--> DS019 Conversation
      +--> DS003 Typed Plugin System
      |      +--> DS027 Plugin Type Contracts
      |      +--> DS029 Planner Plugins
      |      +--> DS028 LLM Role Settings
      |
      +--> DS030 Knowledge Unit Model
      |      +--> DS005 Context CNL (KU serialization)
      |      +--> DS008 KB substrate
      |      +--> DS018 KU tree extraction
      |
      +--> DS006 / DS007 / DS011 shared helpers
      +--> DS031 / DS032 control language + interpreter
      +--> DS010 persistence
      +--> DS015 Achilles bridge
      |
      +--> DS022 sd/gs plugin families
      +--> DS023 kb-plugin family
             +--> DS024 HDC/VSA backend
             +--> DS025 ThinkingDB backend
```
