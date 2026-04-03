# DS001 — General Architecture

## Purpose
Defines the system-wide architecture of MRP-VM.

## Architectural Thesis

The current architecture is a plugin-centered recursive interpretation and resolution runtime operating over natural language and heterogeneous knowledge units. Its purpose is to solve user problems by progressively extracting intentions, discovering relevant knowledge, constructing local plans, selecting appropriate interpretation regimes, and recursively resolving subproblems with backtracking when a path is weak, invalid, or unproductive.

MRP-VM is organized around five typed plugin families:
- `sd-plugin` — seed detectors (intent + knowledge extraction)
- `kb-plugin` — knowledge/context retrievers
- `gs-plugin` — goal solvers
- `val-plugin` — response validators
- `mrp-plan-plugin` — meta-rational planners

The core is intentionally thin. It owns session state, operational budgets, shared utilities, the execution frame stack, and the generic orchestration loop that executes plugin plans.

## Core Directory Boundary

The core boundary must remain explicit in the
repository layout:

- `src/core/engine/**` owns orchestration, stage
  scheduling, and budget enforcement
- `src/core/interpreter/**` owns SOP Lang Control
  tokenization, parsing, validation, and semantic
  admission

The interpreter is not a plugin and not an SDK
feature. It is a first-class core subsystem.

## Core Principles

- **Pluralistic Knowledge**: Knowledge is not stored in a single canonical knowledge base. Instead, the system uses multiple knowledge plugins, each of which may organize, index, enrich, or reinterpret the same source material differently. Duplication across plugins is acceptable and treated as different epistemic views.
- **Recursive Interpretive Search**: The runtime does not assume that the first chosen regime is correct. Control proceeds through a form of interpretive search with backtracking over seeds, knowledge views, plugins, and decompositions.
- **Selective CNL Membrane (SOP Lang Control)**: A controlled natural language is used *only* for control-critical objects: intents, seeds, subproblem descriptors, plugin capability descriptors, and Knowledge Unit (KU) metadata. The body of a KU may remain in rich natural language. This provides stable routing, symbolic filtering, and fast refusal without forcing premature formalization.
- **Parallel Seed Execution**: Seeds are operational directions of inquiry. They are evaluated and executed in parallel within execution frames, forming a Directed Acyclic Graph (DAG) rather than a strict linear pipeline.
- All LLM communication goes exclusively through `LLMAgent` from AchillesAgentLib via one local bridge (DS015).
- The core MUST NOT hardcode concrete operating modes. Alternative behaviors are expressed as plugins of the appropriate type.

## Standard Execution Loop

Every execution frame runs a loop with five phases:

1. **Seed generation** — an `sd-plugin` extracts intents and current-turn KUs as SOP Lang Control documents.
2. **Control admission** — the core interpreter admits those documents into typed intent, seed, and KU objects.
3. **Plan generation** — an `mrp-plan-plugin` builds an execution plan that orders KB and goal solver plugins for the extracted seeds.
4. **Task resolution** — a `kb-plugin` retrieves relevant KUs from the hierarchical KB and session memory, selecting the appropriate abstraction level. Then a `gs-plugin` solves the goal using the assembled context.
5. **Result composition** — results are assembled into the response document and Markdown output.

A sub-loop is triggered when:
- The planner cannot identify suitable plugins for the current task.
- Candidate plugins refuse the task because it is too vague, too broad, or too complex.
- The goal solver produces a weak `no-context` result and the planner determines that decomposition may help.

In such cases, the VM opens a new child execution frame and runs a subordinate loop for decomposition, clarification, or progressive solving.

## Execution Frames

Task resolution is recursive and parallel. The VM models this through execution frames (DS002).

Each frame represents a local execution context:
```text
ExecutionFrame {
  frameId          — unique identifier
  parentFrameId    — null for root frame
  depth            — nesting level (0 for root)
  maxDepth         — budget limit for recursion
  localState {
    seeds          — admitted seed objects for this frame
                     (executed in parallel when independent)
    plan           — execution plan for this frame
    evidence       — retrieved KUs
    partialResults — intermediate goal solver output
  }
  globalStateRef   — reference to session/request
                     shared state (budgets, trace)
}
```

Frame lifecycle:
1. Parent frame detects that a task needs decomposition (planner decision or plugin refusal).
2. Core creates a child frame with inherited budget minus consumed resources.
3. Child frame runs the standard loop for its assigned seeds in parallel.
4. Child frame result is returned to parent frame.
5. Parent frame integrates the result and continues its own loop.

The root frame corresponds to the top-level request. Most simple requests complete in a single frame.

## Plugin-Kernel View

```text
Server/UI
   |
   v
MRP Core Kernel
   |
   +-- session + workspace state
   +-- budget + tracing (DAG tracking)
   +-- execution frame stack
   +-- typed plugin registry
   +-- shared model-role settings
   +-- SOP interpreter (`src/core/interpreter/**`)
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

1. The server receives a chat turn and resolves or creates the session.
2. The core creates a root execution frame.
3. The core resolves the active planner plugin plus any explicit plugin selections or session preferences.
4. The planner builds an execution plan for seed detection, KB retrieval, and goal solving.
5. The core runs `sd-plugin` candidates in order until valid intent seeds and knowledge KUs are produced or the stage is exhausted.
6. The core interpreter admits the produced SOP Lang Control documents and derives decomposition/context metadata.
7. The core stages current-turn KUs into the session and notifies all enabled `kb-plugin`s.
8. **Parallel Task Resolution:** For multiple independent seeds, the core may execute paths in parallel, creating branches that backtrack if they fail or become implausible.
9. The core runs `kb-plugin` candidates in planner order until evidence is sufficient or the stage is exhausted. KB plugins retrieve KUs at the appropriate abstraction level.
10. The core runs `gs-plugin` candidates in planner order until a grounded answer is produced, the stage is exhausted, or only a weak deterministic `no-context` result remains.
11. If a `gs-plugin` or the planner determines that a task requires decomposition, the core MAY open a child execution frame and run a sub-loop.
12. If a `val-plugin` is registered and the goal solver produced a successful answer, the core runs validation. If the validator rejects the answer, the core treats this as a retryable failure (`VALIDATION_REJECTED`) and the planner backtracking loop may attempt an alternative plan.
13. The planner receives the execution trace (represented as a true DAG of attempts, parallel executions, and backtracks) and records outcome statistics for later adaptation.
14. The session commits only after a successful and validated final response.

## Shared Services

The following remain core/shared infrastructure:
- DS004 Intent CNL schema
- DS005 Context CNL schema (KU serialization)
- DS007 validator/parser
- DS032 SOP interpreter
- DS010 persistence
- DS019 conversation/session state
- DS015 AchillesAgentLib bridge
- DS028 shared LLM role settings
- DS030 Knowledge Unit model
- DS031 SOP Lang Control (Selective Control Membrane)

These services are callable from plugins through the plugin execution context.

## KB Architecture

The KB is natural-language-first and hierarchical, organized around Knowledge Units (DS030).
It stores:
- hierarchical KU trees per source (root summary → intermediate aggregates → leaf KUs)
- session-derived KUs
- derived textual memory KUs
- provenance and parent/child relations
- plugin-private artifacts and indices

Relevance is goal-conditioned and budget-aware. KB plugins retrieve KUs by expected marginal utility at the appropriate abstraction level, not by flat similarity ranking. KUs carry metadata strictly typed via SOP Lang Control to enable fast filtering and compatibility matching.

## Cross-Cutting Conventions

### Error Model & Failure Semantics

- Structured errors remain mandatory.
- Failure of one candidate plugin does not fail the whole request if the planner has more candidates for the same stage. Backtracking will attempt the next candidate branch.
- A plugin may return a weak non-terminal outcome such as `unsupported`, `insufficient`, or `no-context` so that the core can continue cheap-first backtracking.
- If a `val-plugin` rejects an answer, the core MUST throw `VALIDATION_REJECTED` so the planner backtracking loop can attempt an alternative plan.

### Logging & Explainability

Every request MUST emit a plugin execution trace. Because execution supports parallel seeds and backtracking, the trace must form a **Directed Acyclic Graph (DAG)** of execution paths, rather than a linear sequence.
The DAG must capture:
- Parent-child frame relationships
- Parallel seed paths
- Backtracking branches when plugins or validations fail
- Latency, plugin candidates tried, final answer statuses.

Session-level explainability is exposed via the server API (DS013) and UI (DS014) as a per-request execution registry for the current session, correctly rendering the non-linear execution frames.

## Configuration Surface
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
- DS031 — SOP Lang Control
- DS032 — SOP interpreter
