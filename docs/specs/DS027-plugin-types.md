# DS027 — Plugin Type Contracts

## Purpose
Defines the rigorous interfaces for the four typed
plugin families used by MRP-VM.

## Common Rules

All plugins MUST:

- expose a common descriptor (DS003)
- be deterministic with respect to explicit inputs,
  configuration, and planner order unless they
  explicitly document stochastic behavior
- return structured status objects
- report whether they used LLM calls
- declare a conservative `maxLLMCalls` bound in
  their descriptor when they may consume LLM budget
- receive shared model settings through the plugin
  context
- optionally publish `plannerHints` in the descriptor
  so planners can make a reasonable cold-start routing
  decision before learning converges

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

## `kb-plugin`

```javascript
class KBPlugin {
  getDescriptor() -> PluginDescriptor

  async retrieve(input, ctx) -> {
    status: "success" | "insufficient" | "error",
    resolvedIntents: ResolvedIntent[] | null,
    sufficient: boolean,
    retrievalTrace: object,
    error: null | { code, message }
  }

  async onSourceText(input, ctx) -> {
    status: "accepted" | "skipped" | "error",
    artifacts: object[],
    error: null | { code, message }
  }
}
```

## `gs-plugin`

```javascript
class GoalSolverPlugin {
  getDescriptor() -> PluginDescriptor

  async solve(input, ctx) -> {
    status: "success" | "no-context" | "error",
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
solver. It receives the original user message, the
produced response, and the resolved intents with
evidence. If it returns `rejected`, the core treats
this as a retryable error (`VALIDATION_REJECTED`)
and the planner backtracking loop may attempt an
alternative plan.

## `mrp-plan-plugin`

```javascript
class MRPPlanPlugin {
  getDescriptor() -> PluginDescriptor

  async buildPlan(input, ctx) -> {
    plannerPluginId: string,
    seedDetectorOrder: string[],
    kbPluginOrder: string[],
    goalSolverOrder: string[],
    notes: string[]
  }

  async recordOutcome(outcome, ctx) -> void
}
```

## Planner Outcome Schema

```javascript
{
  requestId,
  sessionId,
  plannerPluginId,
  plannerAttempts: string[],
  stages: [{
    plannerPluginId: string,
    stage: "seed-detector" | "kb" | "goal-solver" | "validation",
    pluginId,
    status: "success" | "insufficient" | "error" | "unsupported" | "skipped-budget" | "accepted" | "rejected",
    durationMs,
    llmCalls,
    sufficient: boolean | null,
    model: string | null,
    modelRole: string | null
  }],
  finalStatus: "success" | "failure",
  finalAnswerStatus: "answered" | "no-context" | null
}
```

## Dependencies

- DS003 — runtime and registry
- DS028 — model-role settings
- DS029 — planner learning semantics
