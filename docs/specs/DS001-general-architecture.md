# DS001 — General Architecture

## Purpose
Defines the system-wide architecture of MRP-VM.

## Architectural Thesis

MRP-VM is a plugin-kernel system organized around
five typed plugin families:

- `sd-plugin` — seed detectors (intent + knowledge
  extraction)
- `kb-plugin` — knowledge/context retrievers
- `gs-plugin` — goal solvers
- `val-plugin` — response validators
- `mrp-plan-plugin` — meta-rational planners

The core is intentionally thin. It owns session
state, operational budgets, shared utilities, the
execution frame stack, and the generic orchestration
loop that executes plugin plans.

## Core Principles

- The VM core provides only: the LLM bridge (DS015),
  the execution frame stack (DS002), plugin
  orchestration, budget enforcement, and shared
  CNL validation/parsing utilities.
- All domain logic — indexing, retrieval, scoring,
  synthesis, knowledge extraction — belongs to
  plugins. The VM does not own any retrieval backend,
  scoring algorithm, or knowledge extraction strategy.
- Plugins communicate through natural language
  (Intent CNL, Context CNL). The VM is
  syntax-agnostic with respect to the content
  transmitted between plugins; it only enforces the
  structural delimiters defined by each plugin type's
  CNL schema (DS004, DS005).
- A future extension MAY allow plugins to exchange
  a more formal intermediate representation (IR) for
  specific domains (mathematical formulas, logical
  expressions, etc.), but the baseline assumes
  natural-language CNL as the universal inter-plugin
  format.
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
- Knowledge is represented as hierarchical Knowledge
  Units (DS030) at all levels: session memory,
  persistent KB, and retrieval context.
- Validation, parsing, CNL schemas, and KB
  persistence remain shared services, not plugin
  types.
- The KB is a repository/workspace substrate; plugin-
  specific retrieval indices and derived memories sit
  on top of it.

## Standard Execution Loop

Every execution frame runs a loop with four phases:

1. **Seed generation** — an `sd-plugin` extracts
   intents (fine-grained task seeds as Intent CNL)
   and knowledge (semantically coherent KUs as
   Context CNL) from the input.
2. **Plan generation** — an `mrp-plan-plugin` builds
   an execution plan that orders KB and goal solver
   plugins for the extracted seeds.
3. **Task resolution** — a `kb-plugin` retrieves
   relevant KUs from the hierarchical KB and session
   memory, selecting the appropriate abstraction
   level. Then a `gs-plugin` solves the goal using
   the assembled context.
4. **Result composition** — results are assembled
   into the response document and Markdown output.

A sub-loop is triggered when:

- The planner cannot identify suitable plugins for
  the current task.
- Candidate plugins refuse the task because it is
  too vague, too broad, or too complex.
- The goal solver produces a weak `no-context` result
  and the planner determines that decomposition may
  help.

In such cases, the VM opens a new child execution
frame and runs a subordinate loop for decomposition,
clarification, or progressive solving.

## Execution Frames

Task resolution is recursive. The VM models this
through execution frames (DS002).

Each frame represents a local execution context:

```text
ExecutionFrame {
  frameId          — unique identifier
  parentFrameId    — null for root frame
  depth            — nesting level (0 for root)
  maxDepth         — budget limit for recursion
  localState {
    seeds          — intent groups for this frame
    plan           — execution plan for this frame
    evidence       — retrieved KUs
    partialResults — intermediate goal solver output
  }
  globalStateRef   — reference to session/request
                     shared state (budgets, trace)
}
```

Frame lifecycle:

1. Parent frame detects that a task needs
   decomposition (planner decision or plugin refusal).
2. Core creates a child frame with inherited budget
   minus consumed resources.
3. Child frame runs the standard loop.
4. Child frame result is returned to parent frame.
5. Parent frame integrates the result and continues
   its own loop.

The root frame corresponds to the top-level request.
Most simple requests complete in a single frame.

## Plugin-Kernel View

```text
Server/UI
   |
   v
MRP Core Kernel
   |
   +-- session + workspace state
   +-- budget + tracing
   +-- execution frame stack
   +-- typed plugin registry
   +-- shared model-role settings
   +-- validator/parser/CNL helpers
   +-- Achilles bridge
   |
   v
Execution Frame (root)
   |
   +-- mrp-plan-plugin (plan generation)
   +-- sd-plugin (seed generation)
   +-- shared parse/decompose helpers
   +-- kb-plugin (KU retrieval + context)
   +-- gs-plugin (task resolution)
   +-- val-plugin (validation)
   |
   +-- [child frame if decomposition needed]
```

## Request Lifecycle

1. The server receives a chat turn and resolves or
   creates the session.
2. The core creates a root execution frame.
3. The core resolves the active planner plugin plus
   any explicit plugin selections or session
   preferences.
4. The planner builds an execution plan for:
   - seed detection
   - KB retrieval
   - goal solving
5. The core runs `sd-plugin` candidates in order
   until valid intent seeds and knowledge KUs are
   produced or the stage is exhausted.
6. Shared symbolic utilities parse the produced CNL
   and derive decomposition/context metadata.
7. The core runs `kb-plugin` candidates in planner
   order until evidence is sufficient or the stage is
   exhausted. KB plugins retrieve KUs at the
   appropriate abstraction level.
8. The core runs `gs-plugin` candidates in planner
   order until a grounded answer is produced, the
   stage is exhausted, or only a weak deterministic
   `no-context` result remains.
9. If a `gs-plugin` or the planner determines that
   a task requires decomposition, the core MAY open
   a child execution frame and run a sub-loop.
10. If a `val-plugin` is registered and the goal
    solver produced a successful answer, the core
    runs validation. If the validator rejects the
    answer, the core treats this as a retryable
    failure (`VALIDATION_REJECTED`) and the planner
    backtracking loop may attempt an alternative plan.
11. The planner receives the execution trace and
    records outcome statistics for later adaptation.
12. The session commits only after a successful and
    validated final response.

## Shared Services

The following remain core/shared infrastructure:

- DS004 Intent CNL schema
- DS005 Context CNL schema (KU serialization)
- DS007 validator/parser
- DS010 persistence
- DS019 conversation/session state
- DS015 AchillesAgentLib bridge
- DS028 shared LLM role settings
- DS030 Knowledge Unit model

These services are callable from plugins through the
plugin execution context.

## KB Architecture

The KB is natural-language-first and hierarchical,
organized around Knowledge Units (DS030).

It stores:

- hierarchical KU trees per source (root summary →
  intermediate aggregates → leaf KUs)
- session-derived KUs
- derived textual memory KUs
- provenance and parent/child relations
- plugin-private artifacts and indices

Relevance is goal-conditioned and budget-aware. KB
plugins retrieve KUs by expected marginal utility
at the appropriate abstraction level, not by flat
similarity ranking.

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
  frameId,
  timestamp
}
```

Error families:

- `PLAN_*`
- `PLUGIN_REGISTRY_*`
- `PLUGIN_STAGE_*`
- `SETTINGS_*`
- `FRAME_*` (new: frame depth exceeded, frame
  budget exhausted)

### Failure Semantics

- Failure of one candidate plugin does not fail the
  whole request if the planner has more candidates
  for the same stage.
- A plugin may return a weak non-terminal outcome
  such as `unsupported`, `insufficient`, or
  `no-context` so that the core can continue
  cheap-first backtracking.
- Exhaustion of a stage without a usable result is a
  request failure unless DS017 defines a valid
  deterministic no-context rendering path.
- If a planner yields only weak `no-context` output
  after insufficient retrieval evidence, the core MAY
  escalate to a heavier planner or open a child frame
  for decomposition before accepting that weak answer.
- Planner learning MUST NOT silently override an
  explicit user/plugin selection.
- If a `val-plugin` rejects an answer, the core MUST
  throw `VALIDATION_REJECTED` so the planner
  backtracking loop can attempt an alternative plan.

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
- frame depth and frame transitions

## Configuration Surface

The config surface centers on:

- `config/plugins.json`
- `config/llm-role-settings.json`
- `config/engine.json`
- `config/kb.json`
- `config/conversation.json`

## Dependencies

- DS002 — core kernel and frame lifecycle
- DS003 — typed plugin system
- DS022 — seed detector and goal solver families
- DS023 — KB plugin family
- DS027 — plugin type contracts
- DS028 — shared LLM role settings
- DS029 — planner plugins
- DS030 — Knowledge Unit model
