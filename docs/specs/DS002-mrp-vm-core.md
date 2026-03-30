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

The current baseline kernel intentionally keeps a
fixed stage skeleton rather than an arbitrary planner-
defined DAG. That is:

`planner -> seed -> parse/decompose -> kb -> goal`

This is still considered plugin-kernel compliant
because the core stays neutral about concrete plugin
behavior inside each stage.

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
}
```

## Internal Pipeline

1. Resolve/create session.
2. Resolve explicit plugin selections, session
   preferences, and default planner plugin.
   If no planner is explicitly pinned by the request,
   the core MAY rank available planner candidates
   through the shared planner statistics store before
   execution.
3. Build a plugin execution context containing:
   - parser helpers
   - decomposer helpers
   - session/conversation handles
   - external helper manager
   - shared model-role settings
   - logging/budget helpers
4. Invoke one or more `mrp-plan-plugin` candidates in
   configured order until one produces an executable
   plan.
5. Execute the seed-detection stage:
   - try `sd-plugin` candidates in order
   - stop at first valid seed bundle
6. Parse seed output and derive decomposition/context
   metadata.
7. Execute the KB stage:
   - try `kb-plugin` candidates in planner order
   - stop when evidence is sufficient
8. Execute the goal-solving stage:
   - try `gs-plugin` candidates in planner order
   - stop at first grounded answer
   - keep a weak `no-context` result only as a
     fallback candidate while heavier goal solvers
     still remain
   - the active goal solver MAY invoke subordinate
     DS016 helper wrappers through the plugin context
9. Record planner outcome/trace.
10. Commit the successful turn, including the plugin
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
  status: "success" | "no-context" | "error",
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

If multiple planner plugins are available and the
current planner exhausts its stage plan with a
retryable failure, the core MAY fall back to the next
planner candidate in configured order.

The current retryable planner failures include both:

- structural exhaustion (`PLUGIN_STAGE_EXHAUSTED`)
- weak semantic failure
  (`PLAN_INSUFFICIENT_EVIDENCE`)

## Operational Budget

Budgets remain enforced centrally:

- max LLM attempts per request
- request timeout
- maximum plugin candidates per stage
- conservative pre-invocation budget checks using the
  plugin descriptor's `maxLLMCalls`

The planner may propose order, but the core enforces
hard limits.

External helper wrappers also enforce subprocess
timeouts through the wrapper manager. Typed in-process
plugins currently rely on the global request timeout
plus budget checks rather than a separate kernel-side
per-plugin timer.

If the remaining LLM budget is lower than a plugin's
declared `maxLLMCalls`, the core MUST skip that
plugin, record a `skipped-budget` stage outcome, and
continue with cheaper or budget-compatible candidates
when available.

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
- A deterministic `no-context` answer is a weak
  outcome, not automatically the best final outcome.
  If retrieval was insufficient, the core SHOULD try
  a heavier planner when available before committing
  the weak answer.

### Goal solver failure

- One goal solver failure is non-fatal if more
  candidates remain.
- A `no-context` result from one goal solver is also
  non-fatal if more candidates remain.
- If all fail, return `PLUGIN_STAGE_EXHAUSTED` with
  `stage: "goal-solver"`.

## Execution Trace

The kernel trace MUST record:

- `plannerPluginId` for the final planner
- `plannerAttempts` in attempted order
- per-stage `plannerPluginId`, `pluginId`, `status`,
  `durationMs`, `llmCalls`, `sufficient`, `model`,
  and `modelRole`
- `finalStatus`
- `finalAnswerStatus` with `answered` or `no-context`

## Boot Sequence

1. Validate config.
2. Initialize shared services.
3. Initialize the typed plugin registry.
4. Register built-in plugins.
5. Scan external wrappers and register them with the
   external helper plugin manager when valid.
6. Load KB repositories/workspaces.
7. Initialize planner statistics/settings stores.
8. Mark readiness.

## Configuration

`config/engine.json`:

```json
{
  "maxLLMAttemptsPerRequest": 5,
  "requestTimeoutMs": 60000,
  "pluginTimeoutMs": 30000,
  "maxPluginsPerStage": 4,
  "defaultPlannerPlugin": "planner-default",
  "plannerFallbackOrder": ["planner-default", "planner-depth"],
  "pluginAllowlist": ["z3-solver"]
}
```

## Dependencies

- DS003 — plugin registry/runtime
- DS019 — session state
- DS027 — typed plugin contracts
- DS028 — shared LLM role settings
- DS029 — planner plugins
