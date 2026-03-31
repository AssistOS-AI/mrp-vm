# DS002 — MRP-VM Core Kernel

## Purpose
Defines the lightweight orchestration kernel of the
VM, including the execution frame stack and the
standard execution loop.

## Responsibility Boundary

The core owns only:

- request lifecycle
- session/workspace lifecycle
- execution frame stack
- budget enforcement (per-request and per-frame)
- typed plugin resolution
- execution tracing
- shared utility injection
- commit/rollback semantics

The core does NOT own concrete retrieval profiles,
processing modes, or reasoning algorithms.

## Standard Execution Loop

Each execution frame MUST run the following loop:

1. **Seed generation** — an `sd-plugin` extracts
   problem seeds (Intent CNL) and current-turn
   knowledge (Context CNL / KUs) from the incoming
   text.
2. **Session staging** — the core parses the
   returned KUs, stages them in the current session,
   and notifies every enabled `kb-plugin` before any
   retrieval step.
3. **Plan generation** — `mrp-plan-plugin` builds an
   execution plan from parsed intents, decomposed
   intents, current-turn KUs, session state, mounted
   KB identity, and available plugin metadata. The
   planner decides whether the request may proceed
   directly to solver dispatch or whether it first
   requires strategy guidance, more retrieval, or a
   child frame.
4. **Strategy/evidence retrieval** — `kb-plugin`
   retrieves both task evidence and any
   procedure/evaluation guidance needed to justify
   solver selection.
5. **Goal solving** — `gs-plugin` solves the goal
   only after the planner has justified direct
   dispatch or after KB guidance has established an
   appropriate solving method.
6. **Result composition** — results are assembled,
   validated, and committed to the session.

The root frame receives the original user request.
Child frames receive decomposed sub-tasks.

## Execution Frames

```javascript
{
  frameId: string,
  parentFrameId: string | null,
  depth: number,
  maxDepth: number,
  localState: {
    seeds: IntentGroup[],
    plan: ExecutionPlan | null,
    evidence: ResolvedIntent[],
    partialResults: object[]
  },
  budgets: {
    remainingLLMCalls: number,
    remainingTimeMs: number
  }
}
```

### Frame Creation

A child frame is created when:

- The planner explicitly requests decomposition
  because the solver path is not yet justified.
- The planner explicitly requests a strategy-guidance
  frame because the KB or current context may define
  how the task must be solved.
- A `gs-plugin` returns `status: "needs-decomposition"`
  indicating the task is too broad or complex.
- All goal solver candidates produce only weak
  `no-context` results and the planner determines
  decomposition may help.

### Frame Budget

Child frames inherit the remaining budget from the
parent frame minus already consumed resources. The
core enforces `maxDepth` (default: 3) to prevent
unbounded recursion.

### Frame Result Flow

When a child frame completes:

1. Its result (response or partial evidence) is
   returned to the parent frame.
2. The parent frame integrates the result into its
   own `localState.partialResults`.
3. The parent frame continues its loop from the
   task resolution phase.

## Main Interface

```javascript
class MRPEngine {
  constructor(config, pluginRegistry,
    conversationHandler, parser, decomposer,
    externalPluginManager, modelSettings,
    kbIndex, plannerStatsStore)

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

## Internal Pipeline (Root Frame)

1. Resolve/create session.
2. Create root execution frame.
3. Resolve explicit plugin selections, session
   preferences, the initial seed detector policy,
   and the planner plugin.
   If no planner is explicitly pinned by the request,
   the core MAY rank available planner candidates
   through the shared planner statistics store.
4. Build a plugin execution context containing:
   - parser helpers
   - decomposer helpers
   - session/conversation handles
   - external helper manager
   - shared model-role settings
   - logging/budget helpers
   - current frame reference
5. Execute the seed-detection stage:
   - choose an initial `sd-plugin` from explicit
     request pin, session preference, or default seed
     routing policy
   - stop at first valid seed bundle
6. Parse seed output and derive decomposition/context
   metadata.
7. Stage current-turn KUs into the session and notify
   all enabled `kb-plugin`s.
8. Invoke one or more `mrp-plan-plugin` candidates
   until one produces an executable plan from the
   parsed intents and staged session context.
9. If the planner returns `decompose: true`, create a
   child frame before direct solver dispatch.
10. Execute the KB stage:
   - try `kb-plugin` candidates in planner order
   - retrieve both strategy guidance and task
     evidence at the appropriate abstraction level
   - stop when the planner's guidance/evidence
     requirements are satisfied
11. Execute the goal-solving stage:
   - try `gs-plugin` candidates in planner order
   - stop at first grounded answer
   - if a goal solver returns `needs-decomposition`,
     the core MUST create a child frame when depth
     budget allows
   - keep a weak `no-context` result only as a
     fallback while heavier solvers remain
12. Execute validation stage:
    - if a `val-plugin` is registered and the goal
      solver produced a successful answer, run
      validation
    - if the validator rejects the answer, throw
      `VALIDATION_REJECTED` so the planner
      backtracking loop can attempt an alternative
13. Record planner outcome/trace.
14. Commit the successful turn, including the plugin
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

The seed stage produces two distinct outputs:
- `intentCNL` — fine-grained intent/task seeds
- `currentTurnContextCNL` — semantically coherent
  Knowledge Units extracted from the input

### KB stage

```javascript
{
  pluginId: "kb-balanced",
  resolvedIntents: ResolvedIntent[],
  sufficient: boolean,
  retrievalTrace: {
    kuLevelsUsed: string[],
    totalKUsConsidered: number,
    selectedKUCount: number
  }
}
```

### Goal stage

```javascript
{
  pluginId: "gs-llm-fast",
  status: "success" | "no-context" | "error"
        | "needs-decomposition",
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
  kbPluginOrder: ["kb-balanced", "kb-thinkingdb"],
  goalSolverOrder: ["gs-symbolic", "gs-llm-fast"],
  decompose: false,
  framePurpose: null,
  notes: ["guidance-before-direct-dispatch"]
}
```

When `decompose` is `true`, the core MUST create a
child frame before direct solver dispatch.

`framePurpose` MUST distinguish whether the new frame
exists to:

- gather strategy guidance
- decompose into narrower sub-problems

The current retryable planner failures include:

- `PLUGIN_STAGE_EXHAUSTED`
- `PLAN_INSUFFICIENT_EVIDENCE`
- `VALIDATION_REJECTED`

## Operational Budget

Budgets remain enforced centrally:

- max LLM attempts per request (shared across frames)
- request timeout (shared across frames)
- maximum plugin candidates per stage
- maximum frame depth (default: 3)
- conservative pre-invocation budget checks using the
  plugin descriptor's `maxLLMCalls`

If the remaining LLM budget is lower than a plugin's
declared `maxLLMCalls`, the core MUST skip that
plugin, record a `skipped-budget` stage outcome, and
continue with cheaper candidates when available.

## Failure Handling

### Seed detector failure

- One plugin failure is non-fatal if more candidates
  remain.
- If all fail, return `PLUGIN_STAGE_EXHAUSTED` with
  `stage: "seed-detector"`.

### KB plugin failure

- One failure is non-fatal if more candidates remain.
- If all fail, return `PLUGIN_STAGE_EXHAUSTED` with
  `stage: "kb"`.

### No evidence

- No evidence is valid only if the goal solver can
  render deterministic `no-context` output.
- A `no-context` answer is a weak outcome. The core
  SHOULD try a heavier planner or open a child frame
  before committing the weak answer.

### Goal solver failure

- One failure is non-fatal if more candidates remain.
- `no-context` from one solver is non-fatal if more
  remain.
- `needs-decomposition` triggers child frame creation
  if frame depth budget allows.
- If all fail, return `PLUGIN_STAGE_EXHAUSTED` with
  `stage: "goal-solver"`.

### Validation rejection

- If a `val-plugin` returns `rejected`, the core
  MUST throw `VALIDATION_REJECTED`.
- This is a retryable error that enters the planner
  backtracking loop.

### Frame depth exceeded

- If a child frame would exceed `maxDepth`, the core
  returns `FRAME_DEPTH_EXCEEDED` and the parent frame
  falls back to the best available weak result.

## Execution Trace

The kernel trace MUST record:

- `plannerPluginId` for the final planner
- `plannerAttempts` in attempted order
- per-stage `plannerPluginId`, `pluginId`, `status`,
  `durationMs`, `llmCalls`, `sufficient`, `model`,
  and `modelRole`
- `finalStatus`
- `finalAnswerStatus` with `answered` or `no-context`
- `frameDepth` and `frameTransitions`

## Boot Sequence

1. Validate config.
2. Initialize shared services.
3. Initialize the typed plugin registry.
4. Register built-in plugins.
5. Scan external wrappers and register them.
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
  "maxFrameDepth": 3,
  "defaultPlannerPlugin": "planner-default",
  "plannerFallbackOrder": ["planner-default",
    "planner-depth"],
  "pluginAllowlist": ["z3-solver"]
}
```

## Dependencies

- DS003 — plugin registry/runtime
- DS019 — session state
- DS027 — typed plugin contracts
- DS028 — shared LLM role settings
- DS029 — planner plugins
- DS030 — Knowledge Unit model
