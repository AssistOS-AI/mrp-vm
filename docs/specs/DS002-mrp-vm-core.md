# DS002 — MRP-VM Core Kernel

## Purpose
Defines the lightweight orchestration kernel of
MRP-VM:

- session-scoped execution
- deterministic admission of SOP control documents
- execution frames
- bounded parallel seed scheduling
- backtracking
- DAG explainability

## Core Responsibility Boundary

The core owns:

- request lifecycle
- session/workspace lifecycle
- execution frames
- request and frame budgets
- typed plugin resolution
- deterministic SOP interpretation
- branch/backtracking orchestration
- execution tracing
- commit/rollback semantics

The core does not own:

- retrieval algorithms
- KB indexing internals
- goal-solving heuristics
- plugin-specific ranking logic

## Core Directory Boundary

The repository MUST keep the core split explicit:

```text
src/core/
  engine/        # orchestration loop and stage execution
  interpreter/   # SOP tokenizer/parser/validator/interpreter
```

`src/core/interpreter/**` is the long-term home of
SOP language semantics. The engine consumes admitted
objects from that directory rather than re-parsing
ad hoc text inside stage execution.

## Standard Execution Loop

Each execution frame MUST run the following loop:

1. run `sd-plugin` candidates to produce problem
   seeds and current-turn KUs as SOP Lang Control
2. admit those control documents through the core
   interpreter
3. stage admitted current-turn KUs into the session
   and notify enabled `kb-plugin`s
4. build a plan with `mrp-plan-plugin`
5. create runnable branch candidates for admitted
   seeds
6. execute independent runnable seeds in parallel,
   bounded by frame budget and engine limits
7. run KB retrieval and goal solving in planner
   order for each branch
8. backtrack on weak evidence, plugin failure,
   validation rejection, or decomposition demand
9. assemble, validate, and commit the final result

## ExecutionFrame

The canonical frame shape is:

```javascript
{
  frameId: string,
  parentFrameId: string | null,
  requestId: string,
  depth: number,
  maxDepth: number,
  status: "active" | "succeeded" | "failed",
  seedIds: string[],
  activeBranchIds: string[],
  completedBranchIds: string[],
  failureMemory: Array<{
    branchId: string,
    seedId: string,
    pluginId: string,
    reason: string,
    evidenceProfileHash: string | null
  }>,
  localState: {
    intents: object[],
    currentTurnKUs: object[],
    retrievedKUs: object[],
    plan: object | null,
    partialResults: object[]
  },
  budgets: {
    remainingLLMCalls: number,
    remainingTimeMs: number
  }
}
```

## Branch Attempt Model

The core schedules and records explicit branch
attempts:

```javascript
{
  branchId: string,
  frameId: string,
  intentId: string,
  seedId: string,
  pluginId: string,
  validationId: string | null,
  status: "queued" | "active" | "succeeded" | "failed",
  resultId: string | null
}
```

A branch is the unit of retry and failure memory.
The runtime does not backtrack by vaguely
"trying again". It moves to the next valid branch
candidate.

## Frame Creation

A child frame is created when:

- the planner explicitly requests decomposition
- a goal solver returns `needs-decomposition`
- direct solving produced only weak `no-context`
  outcomes and the planner authorizes decomposition
- strategy guidance must be gathered in a separate
  bounded frame

Child frames inherit the remaining request budget
minus already consumed resources.

The core MUST enforce `maxDepth` to prevent
unbounded recursion.

## Parallel Seed Scheduling

Seeds are evaluated in parallel only when they are
independent and runnable.

A seed is runnable when:

- it is active
- its intent is admitted in the current frame
- any `split_from` dependency has been satisfied
- failure memory does not rule out the same
  seed/plugin/evidence tuple

The engine MUST bound concurrency with configuration
such as `maxParallelSeeds`. Parallelism is not
unbounded fan-out.

## Backtracking Semantics

Backtracking order is:

1. next plugin candidate within the current stage
2. next evidence or knowledge view
3. next decomposition branch
4. heavier planner or planner-directed fallback

Validation rejection is a retryable branch failure.
It MUST NOT erase earlier branch records from the
trace.

If frame depth is exhausted, the frame returns the
best available weak result or a structured failure
according to planner policy.

## Main Interface

```javascript
class MRPEngine {
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

## Stage Outputs

### Seed stage

The `sd-plugin` contract remains:

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

`intentCNL` and `currentTurnContextCNL` now carry
SOP Lang Control documents defined by DS004/DS005,
not Markdown heading blocks.

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
    llmCalls: number
  }
}
```

## Execution Trace

The canonical trace MUST be a DAG rather than a flat
stage list.

It MUST record:

- root frame id
- frame nodes
- seed nodes
- branch nodes
- plugin execution nodes
- result/failure nodes
- edges for parentage, usage, retries, and produced
  results
- planner attempts
- final answer status

For explainability and observability, the trace MUST
also carry enough structured data to support the
graph contract defined in DS034.

At minimum, each plugin execution node MUST expose:

- `pluginId`
- `pluginName`
- `pluginType`
- `frameId`
- `status`
- `durationMs`
- input detail payload or detail reference
- output detail payload or detail reference

Each frame node MUST expose enough data to support a
nested frame-container view:

- `frameId`
- `parentFrameId`
- `purpose`
- `status`
- `durationMs`
- input detail payload or detail reference
- output detail payload or detail reference

The graph label for a plugin node is the plugin
name, not the dynamic input or output text. Payloads
belong in node-detail inspection, not in the node
label.

The trace may still include a flat `stages` summary
for convenience, but the DAG is the canonical
explainability structure.

## Dependencies

- DS003 — plugin registry/runtime
- DS034 — execution graph explainability
- DS019 — session state
- DS027 — typed plugin contracts
- DS028 — model-role settings
- DS029 — planner plugins
- DS030 — Knowledge Unit model
- DS031 — SOP Lang Control
- DS032 — SOP interpreter
