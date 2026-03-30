# DS002 — MRP-VM Core Kernel

## Purpose
Defines the lightweight orchestration kernel of the
 VM.

## Responsibility Boundary

The core owns only:

- request lifecycle
- session/workspace lifecycle
- budget enforcement
- typed plugin resolution
- execution tracing
- shared utility injection
- commit/rollback semantics

The core does NOT own concrete retrieval profiles,
processing modes, or reasoning algorithms.

## Main Interface

```javascript
class MRPEngine {
  constructor(config, pluginRegistry,
    conversationHandler, parser, decomposer,
    externalPluginManager, modelSettings,
    kbIndex)

  async processChatTurn(request) -> {
    sessionId,
    responseMarkdown,
    responseDocument,
    requestId,
    llmCallCount,
    durationMs,
    executionTrace
  }

  async boot() -> void
}
```

## Internal Pipeline

1. Resolve/create session.
2. Resolve explicit plugin selections, session
   preferences, and default planner plugin.
3. Build a plugin execution context containing:
   - parser helpers
   - decomposer helpers
   - session/conversation handles
   - shared model-role settings
   - logging/budget helpers
4. Invoke the selected `mrp-plan-plugin`.
5. Execute the seed-detection stage:
   - try `sd-plugin` candidates in order
   - stop at first valid seed bundle
6. Parse seed output and derive decomposition/context
   metadata.
7. Execute the KB stage:
   - try `kb-plugin` candidates in planner order
   - stop when evidence is sufficient
8. Optionally invoke external helper plugins for
   intent-local specialized work.
9. Execute the goal-solving stage:
   - try `gs-plugin` candidates in planner order
   - stop at first successful final answer
10. Record planner outcome/trace.
11. Commit the successful turn, including the plugin
    IDs actually used.

## Canonical Stage Outputs

### Seed stage

```javascript
{
  pluginId: "sd-symbolic",
  intentCNL: string,
  currentTurnContextCNL: string,
  metadata: {
    valid: true,
    llmCalls: 0
  }
}
```

### KB stage

```javascript
{
  pluginId: "kb-balanced",
  resolvedIntents: ResolvedIntent[],
  sufficient: boolean,
  retrievalTrace: object
}
```

### Goal stage

```javascript
{
  pluginId: "gs-llm-fast",
  responseMarkdown: string,
  responseDocument: object,
  metadata: {
    llmCalls: 1
  }
}
```

## Planner Interaction

The planner returns an `ExecutionPlan`:

```javascript
{
  plannerPluginId: "planner-default",
  seedDetectorOrder: ["sd-symbolic", "sd-llm-fast"],
  kbPluginOrder: ["kb-fast", "kb-balanced"],
  goalSolverOrder: ["gs-symbolic", "gs-llm-fast"],
  notes: ["cheap-first"]
}
```

The core is responsible only for executing the plan
faithfully and reporting outcomes back.

## Operational Budget

Budgets remain enforced centrally:

- max LLM attempts per request
- request timeout
- per-plugin timeout
- maximum plugin candidates per stage

The planner may propose order, but the core enforces
hard limits.

## Failure Handling

### Seed detector failure

- One plugin failure is non-fatal if more seed
  detector candidates remain.
- If all seed detector candidates fail or produce
  invalid output, return `PLUGIN_STAGE_EXHAUSTED`
  with `stage: "seed-detector"`.

### KB plugin failure

- One KB plugin failure is non-fatal if more
  candidates remain.
- If all candidates fail, return
  `PLUGIN_STAGE_EXHAUSTED` with `stage: "kb"`.

### No evidence

- No evidence is a valid state only if the selected
  goal solver can render deterministic `no-context`
  output.

### Goal solver failure

- One goal solver failure is non-fatal if more
  candidates remain.
- If all fail, return `PLUGIN_STAGE_EXHAUSTED` with
  `stage: "goal-solver"`.

## Boot Sequence

1. Validate config.
2. Initialize shared services.
3. Initialize the typed plugin registry.
4. Register built-in plugins.
5. Scan external wrappers and register typed external
   plugins when valid.
6. Load KB repositories/workspaces.
7. Initialize planner statistics/settings stores.
8. Mark readiness.

## Configuration

`config/engine.json`:

```json
{
  "maxLLMAttemptsPerRequest": 6,
  "requestTimeoutMs": 60000,
  "pluginTimeoutMs": 30000,
  "maxPluginsPerStage": 4,
  "defaultPlannerPlugin": "planner-default",
  "pluginAllowlist": ["z3-solver"]
}
```

## Dependencies

- DS003 — plugin registry/runtime
- DS019 — session state
- DS027 — typed plugin contracts
- DS028 — shared LLM role settings
- DS029 — planner plugins
