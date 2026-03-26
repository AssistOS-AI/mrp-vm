# DS012 — Retrieval & Context Matching

## Purpose
Orchestrates matching between Intent CNL and
Context CNL. Executes one or more retrieval
strategies under a selected retrieval-risk profile
and assembles the final evidence bundle across two
stores: temporary session context and persistent KB.

## Retrieval Pipeline Per Intent

1. Receives one `ContextProfile` from DS011.
2. Resolves the active retrieval profile from the
   request, session preference, or deployment
   default (DS023).
3. Includes current-turn context units as direct
   evidence for the intent group.
4. Selects one or more enabled retrieval strategies
   for the profile.
5. Runs the primary strategy.
6. Escalates to secondary strategies only if the
   profile and current evidence state require it.
7. Secondary strategies may run in parallel.
8. Deduplicates by unit hash.
9. Fuses candidate scores across strategies.
10. Filters below `minScore`.
11. Returns top-N results split by evidence source.

## Final Score Formula

For every candidate unit returned by at least one
strategy:

```
fusedScore =
  sum(strategyWeight[s] * normalizedScore_s(unit))
  + agreementBonus * max(0, matchesAcrossStrategies - 1)

roleScore =
  roleBoostFactor if unit.role is in
  ContextProfile.neededRoles
  else 1.0

storeScore =
  sessionBoostFactor if candidate source is
  session context
  else 1.0

finalScore = fusedScore * roleScore * storeScore
```

Rules:
- `minScore` is applied to `finalScore`.
- Deduplication keeps the highest `finalScore` for
  duplicate hashes.
- Sorting is descending by `finalScore`, then by
  deterministic tie-break on unit ID.
- If the active profile uses hard symbolic pruning
  and a symbolic strategy rejects a candidate, that
  candidate is removed before ranking.

One Intent Group produces exactly one retrieval
resolution pass, because DS011 produces exactly one
`ContextProfile` per group.

When a user request contains multiple intent groups,
retrieval runs independently per group and produces
one `ResolvedIntent` per `intentRef`.

## Context Aggregation

For each intent, the final evidence bundle is:
- Current-turn context units extracted from the
  current user message.
- Retrieved session context units from the
  temporary session KB.
- Retrieved persistent KB units.

The three sources are combined into a structured
Markdown document with provenance:

```markdown
## Resolved Intent Group 1
Act: compare
Intent: Compare BM25 and dense retrieval.
Output: Comparative recommendation.

### Current-Turn Context
#### sess-abc123::turn-003::unit-000
Role: Condition
Claim: Deployment is CPU-only.

### Session Context
#### sess-abc123::turn-001::unit-001 (score: 0.82)
Role: Preference
Claim: The user prefers lower RAM usage.

### Persistent KB Context
#### src-001::chunk-000::unit-000 (score: 0.87)
Role: Comparison
Source: deployment-guide.md
Claim: BM25 has lower CPU cost in lexical
  retrieval settings.
```

## Main Interface

```javascript
class ContextMatcher {
  constructor(sessionIndexFactory, kbIndex,
    retrievalStrategyRegistry, config)
  async resolve(decomposedIntents, currentTurnUnits,
    session, retrievalProfile) → ResolvedIntent[]
}

// ResolvedIntent
{
  intentGroup: IntentGroup,
  decomposed: DecomposedIntent,
  intentRef: number,
  retrievalProfile: string,
  currentTurnContextUnits: ContextUnit[],
  sessionUnits: ScoredUnit[],
  kbUnits: ScoredUnit[],
  retrievalTrace: {
    strategiesRun: string[],
    escalated: boolean
  },
  resolvedMarkdown: string
}
```

## Plugin Handoff

If an intent requires a plugin (see DS003),
the `ResolvedIntent` is passed to the plugin
as input. The input format for the plugin is
`resolvedMarkdown` (see DS016).

Aggregation rule:
- `ResolvedIntent`, `PluginOutput`, and final
  response sections are joined strictly by
  `intentRef`.
- A plugin result for one intent group must not be
  reused for another intent group.

## Configuration

`config/retrieval.json`:
```json
{
  "minScore": 0.1,
  "maxResultsPerIntent": 10,
  "roleBoostFactor": 1.3,
  "sessionBoostFactor": 1.15,
  "agreementBonus": 0.10,
  "fieldWeights": {
    "topic": 1.5,
    "claim": 1.0,
    "procedure": 1.0,
    "role": 0.5,
    "utilityActs": 0.8,
    "utilityNote": 0.6,
    "condition": 0.6
  },
  "stemming": true
}
```

## Dependencies

- DS004 (Intent CNL) — act → roles mapping.
- DS009 (Indexing) — BM25 engine.
- DS011 (Decomposition) — context profiles.
- DS023 (Retrieval Strategies) — strategy and risk
  profile abstraction.
- DS019 (Conversation) — session context index.
- DS002 (Core) — consumes results.
