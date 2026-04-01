# DS029 — MRP Plan Plugins

## Purpose
Defines `mrp-plan-plugin`, the meta-rational planning
layer that orders plugin execution per request.

## Responsibilities

- consume parsed problem seeds, current-turn KUs,
  session state, and KB-scoped guidance
- choose cheap-first or heavy-first order depending
  on task signals plus retrieved strategy guidance
- decide fallback/escalation chains
- use plugin descriptions and `plannerHints` to rank
  plugins by relevance and discard clearly irrelevant
  candidates
- decide whether direct solver dispatch is justified
  or whether a new frame must be opened first
- request task decomposition by setting
  `decompose: true` in the execution plan when the
  task appears too broad, too underspecified, or not
  yet method-justified
- log outcomes
- adapt future ordering from historical evidence

## Initial Learning Strategy

The initial planner SHOULD use a deterministic
adaptive score per stage-plugin:

```text
utility =
  successRateEWMA
  - latencyPenalty
  - llmCostPenalty
  + sufficiencyBonus
```

Tracked per plugin:

- attempts
- successes
- failures
- insufficiency count
- exponentially weighted average latency
- exponentially weighted average LLM call count

Cold-start priors SHOULD mildly favor cheaper
plugins.

The reference implementation also records planner-
level EWMA statistics in the shared store:

- attempts
- successes
- `noContext`
- failures
- latency EWMA

This allows the core to rank multiple
`mrp-plan-plugin` candidates before execution when
the request does not explicitly pin a planner.

## Planning Heuristics

Typical default order:

- retrieval:
  `kb-fast -> kb-balanced -> kb-thinkingdb`
- goal solving:
  `gs-symbolic -> gs-llm-fast -> gs-llm-deep`

The planner currently orders whole plugins, not the
internal retrieval backends used inside a built-in
`kb-plugin`. Therefore stage-level planning and
plugin-internal backend escalation coexist.

The planner MAY override this order when:

- the task looks multi-hop or ambiguous
- the user explicitly asks for depth
- past traces show a lightweight plugin repeatedly
  fails for similar tasks

The planner MUST inspect:

- parsed Intent CNL and decomposed intents
- current-turn KUs staged in the session
- mounted KB identity and session-scoped KB state
- plugin descriptions and `plannerHints`
- explicit request pins and session preferences
- historical planner/plugin utility

When available, the planner SHOULD treat these as
distinct guidance channels rather than one undiffer-
entiated bag of strategy KUs:

- planner guidance
- goal-solver guidance
- decomposition guidance
- validation guidance
- seed-routing guidance

The planner SHOULD also consume KB-resident strategy
guidance when available, especially KUs describing:

- required procedure
- evaluation policy
- allowed or forbidden solver families
- proof or validation expectations
- domain-specific resolution rules

The built-in adaptive planner now combines:

- registry discovery of all currently registered
  plugins for the stage
- default cheap-first priors from `config/plugins.json`
- optional plugin `plannerHints`
- shared historical plugin utility from the planner
  stats store

It distinguishes between:

- explicit request-level pins, which collapse the
  stage order to the requested plugin
- session preferences, which bias the first candidate
  position but still allow fallback ordering behind
  them

`plannerHints` currently include fields such as:

- `expectedLatencyMs`
- `expectedLLMCalls`
- `relativeCost`
- `supportedActs`
- `topicTags`
- `preferredDepth`
- `fallbackRole`
- `evidenceStyle`
- `confidenceWhenMatched`

## Multiple Planner Plugins

The system MAY register multiple planner plugins.
Backtracking MAY happen:

1. across planner plugins
2. within a planner's stage order

The core MUST still enforce global budget and safety
limits.

## Packaging

Each concrete planner plugin SHOULD live in its own
package directory under:

```text
src/plugins/mrp-plan-plugin/<planner-id>/
```

The reference implementation ships:

- `planner-default`
- `planner-depth`

Both SHOULD be loadable from the same config-driven
built-in plugin catalog used by the other plugin
families.

The reference implementation ships two built-in
planners:

- `planner-default` — adaptive cheap-first
- `planner-depth` — heavy-first fallback

The engine may backtrack across these planner plugins
using configured fallback order, and planner utility
statistics are recorded through the shared EWMA
store. The shipped config prior is
`planner-default -> planner-depth`, but the engine
may reorder that candidate set through planner-level
utility scores when the request does not explicitly
pin a planner.

## Dispatch Rule

The planner MUST NOT dispatch a goal solver blindly
from a static ranking alone.

Direct solver dispatch is allowed only when at least
one of the following holds:

- the user explicitly pinned the solver/plugin family
- plugin metadata strongly matches the parsed problem
- KB guidance or session context explicitly prescribes
  the solving method
- a parent frame already established the method and
  passed that decision downward

If solver applicability is still uncertain, the
planner MUST prefer one of these actions before
direct dispatch:

- retrieve strategy guidance from KB/session context
- open a child frame for decomposition
- escalate to a heavier planner or solver family

## Frame-Opening Rule

The planner uses plugin `description` fields and
`plannerHints` to:

- rank plugins by likely relevance to the current
  problem
- discard plugins that are clearly irrelevant for
  the current task
- decide whether decomposition or strategy-guidance
  framing is required before attempting direct
  resolution

When the planner returns `decompose: true`, the core
MUST create a child frame before direct solver
dispatch.

The planner MUST treat KB-stored procedural and
evaluation knowledge as first-class planning input,
not merely as downstream evidence for the final
answer.

Decomposition guidance may justify opening a child
frame even when the task is otherwise lexically
simple. Conversely, explicit direct-dispatch
guidance may block unnecessary decomposition.

## Dependencies

- DS002 — execution
- DS027 — planner interface
- DS028 — planner model role
