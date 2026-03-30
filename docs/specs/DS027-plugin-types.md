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
- receive shared model settings through the plugin
  context

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
  stages: [{
    stage: "seed-detector" | "kb" | "goal-solver",
    pluginId,
    status,
    durationMs,
    llmCalls,
    sufficient: boolean | null
  }],
  finalStatus: "success" | "failure"
}
```

## Dependencies

- DS003 — runtime and registry
- DS028 — model-role settings
- DS029 — planner learning semantics
