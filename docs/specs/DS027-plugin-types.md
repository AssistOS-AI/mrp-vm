# DS027 — Plugin Type Contracts

## Purpose
Defines the rigorous interfaces for the five typed
plugin families used by MRP-VM.

## Common Rules

All plugins MUST:

- expose a common descriptor (DS003) with a concise,
  operationally useful `description`
- be deterministic with respect to explicit inputs,
  configuration, and planner order unless they
  explicitly document stochastic behavior
- return structured status objects
- report whether they used LLM calls
- declare a conservative `maxLLMCalls` bound in
  their descriptor when they may consume LLM budget
- receive shared model settings through the plugin
  context
- publish `plannerHints` in the descriptor (required
  for `sd-plugin`, `kb-plugin`, `gs-plugin`;
  optional for `val-plugin` and `mrp-plan-plugin`)

## `sd-plugin`

```javascript
class SeedDetectorPlugin {
  getDescriptor() -> PluginDescriptor

  async detectSeeds(input, ctx) -> {
    status: "success" | "unsupported" | "error",
    intentCNL: string | null,
    currentTurnContextCNL: string | null,
    metadata: {
      llmCalls: number,
      model: string | null
    },
    error: null | { code, message }
  }

  async normalizePersistentContext(input, ctx) -> {
    status: "success" | "unsupported" | "error",
    contextCNL: string | null,
    metadata: object,
    error: null | { code, message }
  }
}
```

### Seed Detector Granularity Contract

`detectSeeds` produces two outputs with different
granularity:

- `intentCNL` — fine-grained problem/task seeds.
  Each distinct task or subtask gets its own Intent
  Group.
- `currentTurnContextCNL` — semantically coherent
  Knowledge Units. Related information is grouped
  into useful knowledge objects, not fragmented per
  sentence.

The preferred execution model is one detection pass
that emits both outputs together. For LLM-backed
seed detectors, this SHOULD be one logical LLM call
plus at most a corrective validation retry.

After a successful `detectSeeds(...)`, the core MUST:

1. parse the returned current-turn KUs
2. stage them into the current session's transient
   turn context
3. notify all enabled `kb-plugin`s before retrieval

`normalizePersistentContext` produces KUs for KB
ingest. It MUST NOT default to sentence-level
fragmentation. It SHOULD group related information
and extract symbolic facts from each fact-bearing
sentence.

## `kb-plugin`

```javascript
class KBPlugin {
  getDescriptor() -> PluginDescriptor

  async retrieve(input, ctx) -> {
    status: "success" | "insufficient" | "error",
    resolvedIntents: ResolvedIntent[] | null,
    sufficient: boolean,
    retrievalTrace: {
      kuLevelsUsed: string[],
      totalKUsConsidered: number,
      selectedKUCount: number
    },
    error: null | { code, message }
  }

  async onSourceText(input, ctx) -> {
    status: "accepted" | "skipped" | "error",
    artifacts: object[],
    error: null | { code, message }
  }

  async onSessionEvent(input, ctx) -> {
    status: "accepted" | "skipped" | "error",
    error: null | { code, message }
  }
}
```

### KB Plugin Retrieval Contract

KB plugins retrieve hierarchical Knowledge Units
(DS030) and decide:

- which KUs are relevant to the current task
- at which abstraction level to load them (summary,
  intermediate, or leaf)
- whether to load a full KU or only selected child
  fragments when a KU is too large

The `retrievalTrace` SHOULD report which KU levels
were used and how many KUs were considered vs
selected.

### KB Plugin Session Lifecycle Contract

`onSessionEvent` is the notification surface for
session-scoped KB behavior.

The input SHOULD include:

- `eventType` such as `session-created`,
  `kb-loaded`, `kb-saved`, `kb-forked`, or
  `session-kus-added`
- `sessionId`
- current `kbId` / `kbName`
- previous KB identity when relevant
- repository metadata when relevant
- workspace stats for the current session
- newly staged or committed session units when
  relevant
- `scope` such as `current-turn` or
  `committed-session` when the event concerns
  session KUs

When a session is created or a KB is loaded/saved/
forked for a session, or when session KUs are staged
or committed, the core/server layer MUST call
`onSessionEvent` for every enabled `kb-plugin`.

The core does not require a plugin to cache anything
in response. The contract is that the plugin is
notified and may maintain in-memory or persisted
derived state however it chooses.

## `gs-plugin`

```javascript
class GoalSolverPlugin {
  getDescriptor() -> PluginDescriptor

  async solve(input, ctx) -> {
    status: "success" | "no-context" | "error"
          | "needs-decomposition",
    responseMarkdown: string | null,
    responseDocument: object | null,
    metadata: {
      llmCalls: number,
      model: string | null
    },
    error: null | { code, message }
  }
}
```

### Goal Solver Decomposition Signal

When a goal solver determines that the task is too
broad, too vague, or too complex for direct
resolution, it MAY return
`status: "needs-decomposition"`. The core (DS002)
then creates a child execution frame for the
sub-task.

## `val-plugin`

```javascript
class ValidationPlugin {
  getDescriptor() -> PluginDescriptor

  async validate(input, ctx) -> {
    status: "accepted" | "rejected",
    verdict: "accepted" | "rejected",
    reason: string,
    metadata: {
      llmCalls: number,
      model: string | null
    },
    error: null | { code, message }
  }
}
```

The validation plugin runs after a successful goal
solver. If it returns `rejected`, the core MUST throw
`VALIDATION_REJECTED` so the planner backtracking
loop can attempt an alternative plan.

## `mrp-plan-plugin`

```javascript
class MRPPlanPlugin {
  getDescriptor() -> PluginDescriptor

  async buildPlan(input, ctx) -> {
    plannerPluginId: string,
    kbPluginOrder: string[],
    goalSolverOrder: string[],
    decompose: boolean,
    framePurpose: "strategy-guidance"
                | "subtask-decomposition"
                | null,
    notes: string[]
  }

  async recordOutcome(outcome, ctx) -> void
}
```

### Planner Input Contract

`buildPlan(input, ctx)` MUST receive enough
structured state to make an intent-aware and
KB-aware decision. The input SHOULD include:

- parsed intent groups
- decomposed intents and context profiles
- current-turn KUs staged in the session
- mounted KB identity and session KB metadata
- any previously retrieved strategy guidance
- explicit request-level pins
- session preferences

When `decompose` is `true`, the core MUST create a
child execution frame before direct solver dispatch.

## Planner Outcome Schema

```javascript
{
  requestId,
  sessionId,
  plannerPluginId,
  plannerAttempts: string[],
  stages: [{
    plannerPluginId: string,
    stage: "seed-detector" | "kb" | "goal-solver"
         | "validation",
    pluginId,
    status: "success" | "insufficient" | "error"
          | "unsupported" | "skipped-budget"
          | "accepted" | "rejected"
          | "needs-decomposition",
    durationMs,
    llmCalls,
    sufficient: boolean | null,
    model: string | null,
    modelRole: string | null
  }],
  finalStatus: "success" | "failure",
  finalAnswerStatus: "answered" | "no-context" | null,
  frameDepth: number,
  framePurpose: "strategy-guidance"
             | "subtask-decomposition"
             | null
}
```

## Dependencies

- DS003 — runtime and registry
- DS028 — model-role settings
- DS029 — planner learning semantics
- DS030 — Knowledge Unit model
