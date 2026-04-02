# DS012 — Retrieval & Context Matching

## Purpose
Defines the assembly of `ResolvedIntent` objects from
shared decomposition metadata plus a chosen
`kb-plugin`, operating over hierarchical Knowledge
Units (DS030).

## Architectural Position

The core no longer resolves a retrieval profile by
itself. A planner selects an ordered list of
`kb-plugin`s, and one plugin produces a retrieval
result bundle.

Retrieval serves two consumers:

1. the planner, which may need strategy-guidance KUs
   before solver dispatch
2. the goal solver, which needs evidence KUs to
   produce the final answer

A `kb-plugin` retrieval result MUST therefore be able
to carry both:

- method/procedure/evaluation guidance
- task evidence

## KU-Aware Context Construction

When constructing context for task resolution, KB
plugins operate over hierarchical KUs:

1. Identify which KUs are relevant to the current
   task and which KUs describe how the task should be
   solved, using the context profile from DS011.
2. Decide at which abstraction level to load them:
   - **summary level** for broad context orientation
   - **intermediate level** for moderate detail
   - **leaf level** for specific evidence and facts
3. If a relevant KU is too large, extract only the
   most relevant child KUs or fragments rather than
   loading the entire KU verbatim.
4. Assemble the selected KUs into the resolved intent
   evidence bundle.

This replaces the flat "retrieve top-N units" model
with a hierarchical, level-aware selection.

## Main Interface

```javascript
class ContextMatcher {
  async resolve(decomposedIntents, contextProfiles,
    currentTurnUnits, session,
    retrievalProfileOrConfig, kbIndex) ->
    ResolvedIntent[]
}
```

## ResolvedIntent

```javascript
{
  intentRef,
  retrievalProfile,
  intentGroup,
  decomposed,
  strategyUnits,
  guidanceUnits: {
    planner,
    goalSolver,
    decomposition,
    validation
  },
  currentTurnContextUnits,
  sessionUnits,
  kbUnits,
  retrievalTrace: {
    purpose: "strategy-guidance" | "task-evidence"
           | "mixed",
    strategiesRun: string[],
    escalated: boolean,
    kuLevelsUsed: string[],
    totalKUsConsidered: number
  },
  resolvedPayload: {
    prompt: string,
    context: Array<{
      title: string,
      sourceLink: string,
      text: string
    }>
  }
}
```

## Current-Turn Context Filtering

Current-turn KUs SHOULD be filtered per intent when
possible, rather than injected wholesale into every
resolved intent. If intent-level filtering is not
feasible, the full set may be included as a fallback.

Evidence filtering MUST NOT discard current-turn KUs
that encode planner guidance, decomposition guidance,
validation rules, or output-shaping instructions for
the goal solver. Those KUs remain available through
`guidanceUnits` even when they do not share lexical
overlap with the retrieval terms.

## Dependency

- DS023 — KB plugins
- DS026 — effective workspace view
- DS030 — Knowledge Unit model
