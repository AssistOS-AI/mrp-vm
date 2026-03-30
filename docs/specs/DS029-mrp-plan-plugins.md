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
adaptive score per plugin:

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

## Planning Heuristics

Typical default order:

- seed detection:
  `sd-symbolic -> sd-llm-fast -> sd-llm-deep`
- retrieval:
  `kb-fast -> kb-balanced -> kb-thinkingdb`
- goal solving:
  `gs-symbolic -> gs-llm-fast -> gs-llm-deep`

The planner MAY override this order when:

- the task looks multi-hop or ambiguous
- the user explicitly asks for depth
- past traces show a lightweight plugin repeatedly
  fails for similar tasks

## Multiple Planner Plugins

The system MAY register multiple planner plugins.
Backtracking MAY happen:

1. across planner plugins
2. within a planner's stage order

The core MUST still enforce global budget and safety
limits.

The current baseline implementation ships one active
built-in planner, `planner-default`, and records
EWMA-based plugin utility statistics for later
ordering decisions.

## Dependencies

- DS002 — execution
- DS027 — planner interface
- DS028 — planner model role
