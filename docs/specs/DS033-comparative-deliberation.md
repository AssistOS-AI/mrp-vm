# DS033 — Comparative Deliberation Control

## Purpose
Defines the optional frame-local control policy that
lets MRP-VM keep a frame open after the first valid
result and perform bounded comparative exploration
before final closure.

This DS is an additive extension over the current
architecture. It does not replace frames, intents,
seeds, KUs, branches, results, or validation. It
changes only:

- frame closure policy
- branch/frontier management inside a frame
- candidate comparison behavior

## Design Review

The proposal is sound and should be accepted with
the following refinements:

- The user-facing concept should be exposed as
  `deliberation_level`, not as a vague "thinking"
  mode.
- The policy must be local to a frame, but the root
  frame should be initializable from a request-level
  parameter.
- A validated result must first become a candidate
  when the policy requires comparative closure; it
  must not automatically become the final result.
- Branch families should be an internal derived
  notion in v1, not a mandatory new first-class SLC
  object.
- Existing plugin contracts should remain valid in
  v1. The change belongs primarily to core control,
  planner behavior, and explainability.
- Comparative deliberation may be gated behind an
  experimental SLCI flag in the reference
  implementation, but the semantics in this DS are
  normative when the feature is enabled.

## Scope

This DS defines:

- the `deliberation_level` parameter
- frame-local deliberation policy
- candidate-set semantics
- comparative exploration semantics
- branch-family grouping
- new provisional SLC commands required for
  implementation
- the list of DS files that must be updated when the
  feature is implemented

This DS does not define:

- a new plugin family
- a universal multi-objective optimizer
- deep semantic comparison algorithms
- mandatory changes to KU taxonomy

## Terminology

This DS uses `SLCI` as shorthand for the control
layer built on top of DS031 and DS032 inside:

- `src/core/interpreter/**`
- `src/core/engine/**`

SLCI is not a separate runtime type. It is the
interpreter-driven control layer that maintains
frame state, frontier state, and closure policy.

## Request-Level Entry Point

The intended task/request surface is an optional
parameter:

```text
deliberation_level: 0 | 1 | 2 | 3
```

This parameter initializes the root frame policy.
It is not itself the full frame state; it is the
entry point into frame-local deliberation control.

Root-frame default:

- if omitted, `deliberation_level = 0`

Child-frame inheritance:

- child frames inherit the parent frame policy by
  default
- a child frame MAY narrow the inherited policy
- a child frame SHOULD NOT exceed the root-frame
  level unless the root request explicitly allowed
  that escalation

## Deliberation Levels

### `deliberation_level = 0`

Minimal behavior. Equivalent to the current
first-valid baseline:

- the first sufficiently validated result may close
  the frame
- no comparative exploration is required
- comparison objects are not required

### `deliberation_level = 1`

Cheap comparative behavior:

- the frame may keep one or two low-cost
  alternatives alive
- comparative exploration is opportunistic, not
  mandatory
- the first valid candidate may still close the
  frame if no clearly distinct cheap alternative is
  available

### `deliberation_level = 2`

Real comparative exploration:

- the frame should cover more than one branch family
  when available within budget
- at least one explicit comparison step is required
  before final selection when multiple
  non-equivalent candidates exist
- a valid result becomes a candidate, not an
  automatic final answer

### `deliberation_level = 3`

Strict comparative closure:

- the frame must not close on the first successful
  result if accessible non-equivalent alternatives
  still exist within budget
- closure requires either justified comparative
  selection or controlled budget exhaustion
- candidate dominance, family coverage, and
  comparison state all participate in closure

The scale stops at `3` in v1. A finer scale is out
of scope until real usage justifies it.

## Deliberation Policy

Each frame gains a local policy object:

```javascript
{
  level: 0 | 1 | 2 | 3,
  closureMode: "first_valid" | "best_effort"
             | "comparative" | "scientific",
  maxFrontier: number,
  minFamilies: number,
  maxComparisons: number,
  validationFloor: "weak" | "sufficient" | "strong"
}
```

Recommended defaults:

- level `0` -> `first_valid`
- level `1` -> `best_effort`
- level `2` -> `comparative`
- level `3` -> `scientific`

The policy is a control contract, not a vague style
preference.

## Frame State Extension

The current frame model must be extended with:

```javascript
{
  deliberationPolicy: object,
  candidateSet: Array<object>,
  explorationFrontier: string[],
  suspendedSet: string[],
  comparisonState: {
    openComparisons: string[],
    resolvedDifferences: object[],
    openQuestions: string[]
  },
  branchFamilies: Record<string, string>,
  deliberationStatus: "default" | "candidate_found"
                    | "comparative_open"
}
```

These fields extend the existing frame state. They
do not replace it.

### `candidateSet`

Contains results that:

- passed the minimum validator acceptance barrier
- met the frame's `validationFloor`
- are eligible for final comparative selection

### `explorationFrontier`

Contains branches still eligible for expansion or
execution under the current frame policy.

### `suspendedSet`

Contains paused branches or branch families that are
not currently active but remain resumable if:

- new evidence appears
- a comparison requires discriminative follow-up
- the current leading candidate becomes dominated or
  invalidated

### `comparisonState`

Tracks:

- open candidate comparisons
- already identified differentiators
- unresolved discriminative questions

## Branch Families

Comparative deliberation must operate over
meaningfully different alternatives, not ten near-
duplicates of the same idea.

Therefore SLCI must maintain a derived internal
notion of branch family.

In v1, family membership SHOULD be computed from a
structural signature using:

- intent task/act
- seed mode
- seed action
- dominant plugin class or plugin family
- dominant KU profile
- validation profile

Two branches with the same structural signature
belong to the same family for exploration-policy
purposes.

Branch families are internal in v1. They do not need
to become explicit SLC objects yet.

## Candidate Evaluation Criteria

Final selection must not collapse immediately to one
scalar score.

The minimum useful criteria set is:

- `validation_strength`
- `robustness`
- `cost`
- `diversity`

The v1 selection model is two-step:

1. apply simple dominance filtering
2. choose among non-dominated candidates according
   to the frame objective and policy

A candidate is dominated if another candidate is at
least as good on all active criteria and strictly
better on at least one.

Weighted multi-objective optimization is not
required in v1.

## Proposal Generation Semantics

In the baseline system, proposal generation is
mostly local-greedy.

Under this DS, proposal generation becomes
portfolio-aware:

- level `0`: return the local top move only
- level `1`: allow one or two cheap alternatives if
  they are clearly accessible
- level `2`: preserve family diversity and allow
  explicit comparison proposals
- level `3`: refuse early closure when comparative
  obligations remain unmet and budget still permits
  meaningful exploration

Proposal generation may now return not only branch
expansion, but also:

- comparison creation
- discriminative challenge creation
- selective reactivation from `suspendedSet`

## Frame Closure Rules

A frame closes when one of the following holds:

1. `closureMode = first_valid` and one candidate
   meets the floor.
2. One candidate dominates the active alternatives
   and the policy no longer requires coverage of
   unvisited families.
3. The frame has reached `maxComparisons` or
   exhausted its usable budget and must return the
   best current candidate with truthful status.
4. All remaining alternatives are blocked, dominated,
   invalid, or structurally unpromising.

At higher deliberation levels, "first successful
result" is not by itself a sufficient closure
condition.

## Provisional SLC Extension

The following commands are required for
implementation. They extend DS031, but that DS is
not modified by this document directly.

### Frame references

These commands use `$frame` references.
In v1, frame refs are runtime-provided external refs
injected by the interpreter as described by DS032.
They do not require a new DS031 constructor before
implementation begins.

### `policy`

```text
@id policy $frame <level> <closureMode>
           <maxFrontier> <minFamilies>
           <maxComparisons> <validationFloor>
```

Example:

```text
@pol1 policy $f1 2 comparative 6 2 2 sufficient
```

Semantics:

- sets the local deliberation policy of the frame
- modifies closure behavior
- constrains exploration breadth and comparison load

### `objective`

```text
@id objective $frame [criterion1 criterion2 ...]
```

Example:

```text
@obj1 objective $f1
  [validation_strength robustness cost diversity]
```

Semantics:

- defines the priority order of comparison criteria
- v1 requires no numeric weights

### `candidate`

```text
@id candidate $frame $branch $result <strength>
```

Example:

```text
@cand1 candidate $f1 $b3 $r7 strong
```

Semantics:

- records that a validated result enters the frame's
  `candidateSet`
- `strength` is a competitiveness summary:
  `weak | sufficient | strong`
- this does not replace validator verdicts

### `compare`

```text
@id compare $frame [$result1 $result2 ...]
    "<question>"
```

Example:

```text
@cmp1 compare $f1 [$r7 $r9]
  "identify decisive differences and missing evidence"
```

Semantics:

- creates an explicit comparison control object
- comparison may later be handled by planner logic,
  helper logic, or a future specialized plugin path

### `challenge`

```text
@id challenge $frame $result "<goal>" <evidenceMode>
```

Example:

```text
@ch1 challenge $f1 $r9
  "seek source-grounded support for the missing assumption"
  source
```

Semantics:

- creates a discriminative follow-up task targeted
  at uncertainty in one candidate
- may justify opening a focused child frame

## Semantics of New Commands

- `policy` changes local frame closure semantics and
  exploration limits
- `objective` defines comparison criteria ordering
- `candidate` promotes a validated result into the
  competitive selection set
- `compare` creates an explicit comparative control
  unit
- `challenge` creates targeted evidence-seeking
  control for a candidate uncertainty

## Experimental Gate

The reference implementation MAY expose an internal
experimental gate such as:

```text
comparativeDeliberationEnabled = true | false
```

When disabled:

- the runtime SHOULD behave as
  `deliberation_level = 0`
- higher levels MAY be downgraded rather than
  partially emulated

This gate is an implementation detail, not part of
the semantic model.

## DS Files That Must Change at Implementation Time

The following DS files will require coordinated
updates when DS033 is implemented:

- `DS002`
  Extend `ExecutionFrame`, closure semantics,
  frontier handling, candidate handling, and trace
  semantics.
- `DS013`
  Add optional request parameter
  `deliberation_level` and expose comparative state
  in explainability payloads.
- `DS014`
  Add UI surface for choosing deliberation level and
  viewing candidate/comparison state.
- `DS019`
  Define whether a session may keep a default
  deliberation preference.
- `DS020`
  Add integration coverage for candidate-set
  behavior, comparative closure, and challenge-based
  child frames.
- `DS021`
  Add evaluation scenarios for comparative
  deliberation quality, budget use, and false early
  closure.
- `DS027`
  Clarify planner input surface if candidate or
  comparison state is passed into `mrp-plan-plugin`.
- `DS029`
  Extend planner behavior from purely ordered stage
  selection to portfolio-aware proposal generation
  within a frame.
- `DS031`
  Add `policy`, `objective`, `candidate`, `compare`,
  and `challenge` to the language surface.
- `DS032`
  Add interpreter semantics for the new commands,
  runtime frame refs, candidate objects, comparison
  objects, and challenge objects.

No DS changes are required in v1 for KU taxonomy or
base plugin-family taxonomy.

## Temporary Backlog for DS033 Implementation

- [x] Add request-level `deliberation_level` input
  for the root frame.
- [x] Extend frame state with `deliberationPolicy`,
  `candidateSet`, `explorationFrontier`,
  `suspendedSet`, `comparisonState`, and
  `branchFamilies`.
- [x] Implement branch-family derivation from
  structural signatures.
- [ ] Teach planner/control logic to keep multiple
  branch families alive when policy requires it.
- [ ] Teach proposal generation to emit `compare`
  and `challenge` proposals, not only branch
  expansion.
- [ ] Implement candidate promotion and dominance
  filtering.
- [ ] Implement comparative frame-closure rules.
- [x] Add explainability trace nodes/edges for
  candidates, comparisons, and challenges.
- [ ] Decide whether the reference implementation
  ships with `comparativeDeliberationEnabled`
  defaulting to `false` or `true`.

The current reference implementation now covers the
request/session/UI surface, frame-state foundation,
branch-family signatures, interpreter support for
`policy` / `objective` / `candidate` / `compare` /
`challenge`, and graph-level explainability nodes.
What remains open is stronger comparative scheduling,
multi-candidate dominance filtering, and explicit
proposal generation for compare/challenge control.

## Dependencies

- DS002 — core frames and closure
- DS029 — planner behavior
- DS031 — language surface
- DS032 — interpreter semantics
