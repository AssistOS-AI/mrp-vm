# DS029 — MRP Plan Plugins

## Purpose
Defines `mrp-plan-plugin`, the meta-rational planning
layer that orders plugin execution per request.

## Responsibilities

- choose cheap-first or heavy-first order depending
  on task signals
- decide fallback/escalation chains
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

The current baseline also records planner-level EWMA
statistics in the shared store:

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

- seed detection:
  `sd-symbolic -> sd-llm-fast -> sd-llm-deep`
- retrieval:
  `kb-fast -> kb-balanced -> kb-thinkingdb`
- goal solving:
  `gs-symbolic -> gs-llm-fast -> gs-llm-deep`

The planner currently orders whole plugins, not the
internal retrieval backends used inside a built-in
`kb-plugin`. Therefore stage-level planning and
plugin-internal backend escalation coexist in the
baseline implementation.

The planner MAY override this order when:

- the task looks multi-hop or ambiguous
- the user explicitly asks for depth
- past traces show a lightweight plugin repeatedly
  fails for similar tasks

The current baseline planner inspects the active
message/history for simple depth, speed, symbolic,
and retrieval-heavy cues before ranking the final
order.

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

The current baseline implementation ships two built-
in planners:

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

## Current Baseline Boundaries

The built-in planners order the fixed VM stages
(`sd -> kb -> gs`). They do not yet define arbitrary
new stage kinds or agentic loops. This is intentional
for the current baseline and should not be read as a
claim that planner plugins are limited to a single
implementation per type.

The baseline also still ships built-in `kb-plugin`s
that internally reuse the shared retrieval stack and
legacy profile configuration. This is acceptable as a
transitional implementation detail, but it is not the
long-term target architecture.

## Dependencies

- DS002 — execution
- DS027 — planner interface
- DS028 — planner model role
