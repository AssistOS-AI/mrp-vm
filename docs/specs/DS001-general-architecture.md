# DS001 — General Architecture

## Purpose
Defines the system-wide architecture of MRP-VM after
the plugin-kernel refactor.

## Architectural Thesis

MRP-VM is no longer primarily organized around
hardcoded processing modes or retrieval profiles in
the core engine. External wrappers remain subordinate
helpers, but they are now consumed through plugin
execution context rather than through a hardcoded
core-stage loop.

The system is organized around four typed plugin
families:

- `sd-plugin` — seed detectors
- `kb-plugin` — knowledge/context retrievers
- `gs-plugin` — goal solvers
- `mrp-plan-plugin` — meta-rational planners

The core is intentionally thin. It owns session
state, operational budgets, shared utilities, and the
generic orchestration loop that executes plugin plans.
The current baseline deliberately keeps a fixed
execution skeleton:

- `mrp-plan-plugin`
- `sd-plugin`
- shared parse/decompose helpers
- `kb-plugin`
- `gs-plugin`

This fixed skeleton is considered conformant for the
current VM generation because the kernel remains
neutral with respect to *which* plugins are chosen and
what internal algorithms they use. The core does not
encode concrete retrieval logic, seed extraction
algorithms, answer synthesis policies, or helper
interpreter loops.

## Core Principles

- All LLM communication goes exclusively through
  `LLMAgent` from AchillesAgentLib via one local
  bridge (DS015).
- The core MUST NOT hardcode concrete operating
  modes such as `symbolic-only`, `llm-assisted`,
  `fast`, or `balanced`.
- Alternative behaviors are expressed as plugins of
  the appropriate type.
- The planner decides the execution order of plugins
  per request and may escalate from cheap plugins to
  more expensive ones.
- The planner MUST be able to learn from outcomes and
  adapt future plugin ordering.
- `wide-recall` is removed from the active design and
  from the supported implementation surface.
- Internal knowledge remains English CNL plus
  natural-language semantic units with provenance.
- Validation, parsing, CNL schemas, and KB
  persistence remain shared services, not plugin
  types.
- The KB is a repository/workspace substrate; plugin-
  specific retrieval indices and derived memories sit
  on top of it.

## Plugin-Kernel View

```text
Server/UI
   |
   v
MRP Core Kernel
   |
   +-- session + workspace state
   +-- budget + tracing
   +-- typed plugin registry
   +-- shared model-role settings
   +-- validator/parser/CNL helpers
   +-- Achilles bridge
   |
   v
mrp-plan-plugin
   |
   +-- ordered sd-plugin candidates
   +-- ordered kb-plugin candidates
   +-- ordered gs-plugin candidates
   |
   v
sd-plugin -> parser/decomposer -> kb-plugin -> gs-plugin
```

## Request Lifecycle

1. The server receives a chat turn and resolves or
   creates the session.
2. The core resolves the active planner plugin plus
   any explicit plugin selections or session
   preferences.
3. The planner builds an execution plan for:
   - seed detection
   - KB retrieval
   - goal solving
4. The core runs `sd-plugin` candidates in order
   until valid goal seeds and context seeds are
   produced or the stage is exhausted.
5. Shared symbolic utilities parse the produced CNL
   and derive decomposition/context metadata.
6. The core runs `kb-plugin` candidates in planner
   order until evidence is sufficient or the stage is
   exhausted.
7. The selected `gs-plugin` MAY invoke subordinate
   external helper wrappers through the plugin
   context for one or more intents.
8. The core runs `gs-plugin` candidates in planner
   order until a grounded answer is produced, the
   stage is exhausted, or only a weak deterministic
   `no-context` result remains.
9. The planner receives the execution trace and
   records outcome statistics for later adaptation.
10. The session commits only after a successful final
    response.

## Shared Services

The following remain core/shared infrastructure:

- DS004 Intent CNL schema
- DS005 Context CNL schema
- DS007 validator/parser
- DS010 persistence
- DS019 conversation/session state
- DS015 AchillesAgentLib bridge
- DS028 shared LLM role settings

These services are callable from plugins through the
plugin execution context.

## Selection Model

The old terms map to the new model as follows:

- old processing mode -> `sd-plugin` and `gs-plugin`
- old retrieval profile -> `kb-plugin`
- old strategy registry -> typed plugin registry
- old retrieval profile selection -> planner-selected
  `kb-plugin`
- old top-level retrieval escalation -> planner logic
  at the `kb-plugin` stage; built-in KB plugins may
  still perform internal backend escalation as an
  implementation detail

Example migration:

- `symbolic-only` -> `sd-symbolic` + `gs-symbolic`
- `llm-assisted` -> one of `sd-llm-fast`,
  `sd-llm-deep`, `gs-llm-fast`, `gs-llm-deep`
- `fast` retrieval profile -> `kb-fast`
- `balanced` retrieval profile -> `kb-balanced`
- `thinkingdb` retrieval profile -> `kb-thinkingdb`

Legacy aliases remain migration-only compatibility
labels. The authoritative session state is the typed
plugin selection, and compatibility values are
derived from those plugin IDs when needed by legacy
API surfaces.

## KB Architecture

The KB is now explicitly natural-language-first and
hierarchical.

It stores:

- source semantic units
- aggregate semantic units
- derived textual memory units
- provenance and parent/child relations
- plugin-private artifacts and indices

Relevance is goal-conditioned and budget-aware. KB
plugins retrieve units by expected marginal utility,
not similarity in the abstract.

## Cross-Cutting Conventions

### Error Model

Structured errors remain mandatory:

```javascript
{
  code: "PLUGIN_STAGE_EXHAUSTED",
  module: "core",
  message: "No goal solver plugin produced a final answer",
  details: {
    stage: "goal-solver",
    pluginsTried: ["gs-symbolic", "gs-llm-fast"]
  },
  requestId,
  sessionId,
  timestamp
}
```

Additional families introduced by the plugin-kernel
design:

- `PLAN_*`
- `PLUGIN_REGISTRY_*`
- `PLUGIN_STAGE_*`
- `SETTINGS_*`

### Failure Semantics

- Failure of one candidate plugin does not fail the
  whole request if the planner has more candidates
  for the same stage.
- A plugin may return a weak non-terminal outcome such
  as `unsupported`, `insufficient`, or `no-context`
  so that the core can continue cheap-first
  backtracking.
- Exhaustion of a stage without a usable result is a
  request failure unless DS017 defines a valid
  deterministic no-context rendering path.
- If a planner yields only weak `no-context` output
  after insufficient retrieval evidence, the core MAY
  escalate to a heavier planner before accepting that
  weak answer.
- Planner learning MUST NOT silently override an
  explicit user/plugin selection.

### Logging

Every request MUST emit a plugin execution trace with:

- planner plugin used
- plugin candidates tried per stage
- planner plugin responsible for each stage attempt
- latency per plugin
- success/failure outcome
- final answer status (`answered` vs `no-context`)
- LLM role and resolved model when applicable
- fallback/escalation path

## Configuration Surface

The config surface now centers on:

- `config/plugins.json`
- `config/llm-role-settings.json`
- `config/engine.json`
- `config/kb.json`
- `config/conversation.json`

Legacy config files for strategies/retrieval profiles
MAY still exist temporarily as compatibility inputs
for built-in plugins, but the core architecture no
longer depends on them as first-class concepts.

## Dependencies

- DS002 — core kernel
- DS003 — typed plugin system
- DS022 — seed detector and goal solver plugin
  families
- DS023 — KB plugin family
- DS027 — plugin type contracts
- DS028 — shared LLM role settings
- DS029 — planner plugins
