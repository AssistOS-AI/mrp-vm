# DS032 — SOP Lang Control Interpreter

## Purpose
Defines the deterministic interpreter that admits
SOP Lang Control documents into the MRP-VM core.

DS031 defines the language surface.
DS032 defines:

- interpreter ownership inside `src/core/**`
- the admission pipeline
- typed runtime objects produced by interpretation
- frame integration
- branch, backtracking, and trace semantics

## Core Ownership and Directory Boundary

The SOP interpreter MUST live under:

```text
src/core/interpreter/
```

This directory owns:

- lexical tokenization
- statement parsing
- command/field validation
- semantic interpretation
- frame admission helpers
- trace-graph helpers for control objects
- interpreter-specific error classes

The orchestration loop remains under:

```text
src/core/engine/
```

`src/core/parser/**` may exist temporarily for
legacy helpers, but it MUST NOT remain the long-term
home of SOP Lang Control semantics. The control
language contract belongs to `src/core/interpreter/**`.

## Interpreter Boundary

The interpreter is purely deterministic.

It MUST NOT:

- call an LLM
- infer missing fields from free text
- silently repair malformed control documents
- invent fallback objects to keep execution going

Its job is to either:

1. admit a well-formed control document into typed
   runtime state, or
2. fail with structured deterministic errors

## Admission Pipeline

Every SOP document admission follows the same
pipeline:

1. tokenize the source text
2. parse statements in order
3. validate command signatures and allowed fields
4. resolve references
5. materialize typed objects
6. apply semantic invariants
7. emit an interpreted control document

No object is considered admitted before all seven
steps succeed.

## Main Interfaces

The exact file split may vary, but the core MUST
expose equivalent responsibilities to:

```javascript
class SOPTokenizer {
  tokenize(sourceText) -> Token[]
}

class SOPParser {
  parseDocument(sourceText) -> ParsedStatement[]
}

class SOPValidator {
  validate(parsedStatements, options) -> ValidationResult
}

class SOPInterpreter {
  interpretDocument(sourceText, options) -> InterpretedControlDocument
}
```

`options` SHOULD include:

- `documentKind`: `intent` | `context` | `mixed`
- `frameContext`
- `externalRefs` when the core injects known runtime
  objects

## InterpretedControlDocument

The admitted output SHOULD expose typed collections
similar to:

```javascript
{
  intents: Map<string, IntentObject>,
  seeds: Map<string, SeedObject>,
  subproblems: Map<string, SubproblemObject>,
  plugins: Map<string, PluginDescriptorObject>,
  kus: Map<string, KUControlObject>,
  validations: Map<string, ValidationObject>,
  branches: Map<string, BranchAttemptObject>,
  results: Map<string, ResultObject>,
  relationEdges: Array<{
    type: string,
    from: string,
    to: string
  }>
}
```

Each typed object keeps:

- its constructor id
- normalized fields
- source-location metadata for diagnostics

## Semantic Rules by Object Family

### Intent objects

An intent is admitted only if:

- the constructor provides a valid pragmatic act
- the constructor provides a quoted target
- `output` is assigned

`constrain` adds constraints cumulatively.
`context`, `criterion`, and `evidence` remain
optional.

### Seed objects

A seed is admitted only if:

- it references an existing intent
- it declares `mode`, `action`, and `focus`

Recommended defaults:

- `state: active` when omitted

`split_from` creates a lineage edge.
A deactivated seed remains in the interpreted graph
but MUST NOT enter the scheduler's runnable set.

### Subproblem objects

A subproblem is admitted only if it references an
existing parent intent.

It SHOULD also carry:

- `reason`
- `successSignal`

`allows` expresses regime permissions and is
additive.

### Plugin descriptor objects

A plugin descriptor is admitted only if:

- `pluginType` is one of the typed plugin families
- `pluginId` is present

Capability fields such as `acceptsTasks`,
`acceptsModes`, `acceptsKinds`, `outputs`, and
`validates` are validated as lists of atoms.

### KU control objects

A KU metadata shell is admitted only if it has:

- `sourceId`
- `chunkId`
- `role`
- `topic`
- exactly one of `claim` or `procedure`

Additional rules:

- `utilityActs` defaults from KU role if omitted
- `phaseScopes` defaults to `["kb-plugin"]` if
  omitted
- the symbolic triple is all-or-nothing
- `confidence` is valid only with a complete
  symbolic triple

`parent` and `derived_from` create lineage edges.

### Validation objects

A validation object is admitted only if it has:

- `mode`
- `strength`
- `partialAllowed`
- `preserveConstraints`

### Branch objects

A branch object records a single attempt over:

- one intent
- one seed
- one plugin

The branch becomes schedulable only after a
validation target is linked through `needs`.

Status transitions are explicit:

- `status ... active`
- `status ... succeeded`
- `fail ... <reason>`

The interpreter MUST reject contradictory branch
end-states in the same admitted document.

### Result objects

A result object is admitted only if:

- it has `kind`
- it is linked from a branch through `result`

`supports` edges remain additive.

## Execution Frame Integration

The interpreter does not execute plugins. It
materializes the control state that the engine uses
to do so.

The core execution model MUST maintain an
`ExecutionFrame` shape equivalent to:

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
  failureMemory: object[],
  localState: {
    intents: Map<string, IntentObject>,
    currentTurnKUs: Map<string, KUControlObject>,
    retrievedKUs: Map<string, KUControlObject>,
    partialResults: Map<string, ResultObject>,
    plan: object | null
  },
  budgets: {
    remainingLLMCalls: number,
    remainingTimeMs: number
  }
}
```

The interpreter MUST provide the engine with enough
typed objects to populate this frame state without
re-parsing text later in the loop.

## Parallel Seed Scheduling

The engine schedules seeds, but DS032 defines the
minimum semantic information needed for that
scheduler.

A seed is runnable only when:

- it is not deactivated
- its parent intent is admitted
- any `split_from` parent has already been admitted
- no frame-local failure memory forbids retry of the
  same seed/plugin/evidence combination

Independent runnable seeds MAY execute in parallel.
The actual concurrency limit is owned by DS002 and
engine configuration.

## Backtracking and Failure Memory

Backtracking is not ad hoc text retry. It is a
structured transition over admitted objects.

Each failed attempt SHOULD record:

- `frameId`
- `branchId`
- `seedId`
- `pluginId`
- failure reason
- evidence profile hash when available

The core uses this failure memory to avoid retrying
the same incompatible combination unless new
evidence, a different plugin, or a different
subproblem changes the branch conditions.

Validation rejection is a branch failure, not an
automatic request failure.

## Execution Trace Semantics

The explainability graph MUST be assembled from
typed frame/branch/result objects rather than from a
flat list of stage logs.

The canonical trace graph SHOULD support:

- node types: `frame`, `seed`, `branch`, `plugin`,
  `result`, `failure`
- edge types: `contains`, `spawned_from`, `uses`,
  `needs`, `produced`, `failed_as`

The interpreter MUST emit stable object ids so the
engine and UI can reference the same branch/frame
entities across stages.

## Error Model

The interpreter MUST produce structured errors.
Minimum error classes:

- lexical error
- parse error
- unknown command
- invalid field for object kind
- duplicate constructor id
- unresolved reference
- missing required field
- semantic conflict
- invalid state transition

Malformed control documents are hard failures for
the current stage. They are not silently coerced
into weak success.

## Dependencies

- DS002 — core loop and execution frames
- DS004 — intent semantics
- DS005 — KU metadata semantics
- DS007 — tokenizer/parser/validator contract
- DS030 — Knowledge Unit model
- DS031 — language surface
