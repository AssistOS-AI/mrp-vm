# DS023 — Retrieval Strategies & Risk Profiles

## Purpose
Defines the pluggable strategy layer for selecting,
ranking, and pruning evidence from session context and
persistent KB.

This layer is separate from DS022:
- DS022 covers language-processing strategies
  (normalization and synthesis).
- DS023 covers evidence-selection strategies
  (retrieval, relevance filtering, and fusion).

## Scope

DS023 generalizes the stage between DS011
`ContextProfile` and DS012 `ResolvedIntent`.

It covers:
- candidate generation from one or more stores
- relevance scoring
- risk/latency/recall profiles
- multi-strategy fusion
- adaptive escalation and parallel execution

It does NOT replace:
- DS009 BM25 indexing internals
- DS011 intent decomposition
- DS017 answer synthesis
- DS003 domain plugins

## Architectural Position

The retrieval layer now has two levels:
- DS009 — one concrete lexical strategy
- DS012 — orchestration and result assembly
- DS023 — strategy and risk-profile abstraction

## Core Interface

```javascript
class RetrievalStrategy {
  getId() → string
  getKind() → "lexical" | "semantic" |
    "hdc-vsa" | "symbolic"
  getCostClass() → "cheap" | "moderate" | "expensive"
  supportsProfile(profileId) → boolean
  supportsParallelExecution() → boolean

  async retrieve(input) → StrategyResult
}
```

Input contract:

```javascript
{
  intentRef: number,
  contextProfile: ContextProfile,
  currentTurnUnits: ContextUnit[],
  sessionIndex: KBIndexLike,
  kbIndex: KBIndexLike,
  profile: RetrievalRiskProfile,
  budget: {
    timeoutMs: number,
    maxCandidates: number
  }
}
```

Output contract:

```javascript
{
  strategyId: string,
  candidates: [{
    unitId: string,
    store: "current-turn" | "session" | "kb",
    rawScore: number,
    normalizedScore: number,
    notes: string[]
  }],
  durationMs: number,
  exhaustedBudget: boolean
}
```

## Strategy Registry

```javascript
class RetrievalStrategyRegistry {
  register(strategy) → void
  get(strategyId) → RetrievalStrategy | null
  list() → RetrievalStrategyInfo[]
  getEnabledForProfile(profileId) → RetrievalStrategy[]
}

// RetrievalStrategyInfo
{
  id: string,
  kind: "lexical" | "semantic" | "hdc-vsa" |
    "symbolic",
  costClass: "cheap" | "moderate" | "expensive"
}
```

## Risk Profiles

Risk profiles express the tradeoff between latency,
precision, recall, and explainability.

```javascript
{
  id: "fast" | "balanced" | "wide-recall" |
    "symbolic-grounded" | "meta-rational",
  primaryStrategies: string[],
  secondaryStrategies: string[],
  allowParallel: boolean,
  maxStrategiesPerIntent: number,
  minAcceptableCandidates: number,
  confidenceGapThreshold: number,
  hardSymbolicPruning: boolean,
  targetLatencyMs: number
}
```

### Built-in Profile Semantics

#### `fast`
- Run only the first enabled cheap strategy.
- No escalation.
- Prioritizes latency over recall.

#### `balanced`
- Run lexical retrieval first.
- Escalate to one secondary strategy only if recall
  or confidence is weak.
- This is the recommended default.

#### `wide-recall`
- Run all enabled cheap/moderate strategies in
  parallel.
- Maximize candidate coverage before fusion.

#### `symbolic-grounded`
- Run lexical recall first, then a symbolic strategy
  for pruning or relevance proof.
- When symbolic pruning marks a candidate as
  incompatible and `hardSymbolicPruning = true`,
  the candidate is removed even if lexical score is
  high.

#### `meta-rational`
- Start with a cheap primary strategy.
- Escalate adaptively if the first pass is too weak
  or ambiguous.
- Secondary strategies may run in parallel.
- Fusion rewards agreement across independent
  filters.

## Adaptive Escalation Rules

Escalation is triggered when at least one is true:
- fewer than `minAcceptableCandidates` remain
- top score is below the profile acceptance bar
- score gap between top-1 and top-2 is below
  `confidenceGapThreshold`
- a hard constraint is unresolved

If none of these hold, the orchestrator may stop
after the primary strategy.

## Fusion Formula

After each strategy returns normalized scores in
`[0, 1]`, DS012 computes:

```
fusedScore(unit) =
  sum(strategyWeight[s] * normalizedScore_s(unit))
  + agreementBonus * max(0, matchesAcrossStrategies - 1)

finalScore = fusedScore * storeBoost
```

Where:
- `strategyWeight[s]` comes from profile config
- `agreementBonus` is configurable
- `storeBoost` may favor session evidence over
  persistent KB

If a profile enables hard symbolic pruning and a
symbolic strategy rejects a candidate, that candidate
is removed before final ranking.

## Built-In Strategy Types

### `bm25-lexical`
- Implemented through DS009.
- Current default and only required v1 strategy.
- Cheap, deterministic, explainable.

### `semantic-embedding`
- Optional future strategy.
- Uses vector similarity over stored embeddings.
- Not part of the required v1 baseline.

### `hdc-vsa-associative`
- Optional future strategy.
- Uses hyperdimensional/vector symbolic
  representations for fast associative filtering and
  approximate relevance matching.
- Suitable when very low-latency broad filtering is
  needed.

### `symbolic-fixedpoint`
- Optional future strategy.
- Uses symbolic propagation, abstract
  interpretation, fixed-point iteration, constraint
  narrowing, or similar methods to reject or confirm
  candidates.
- Best suited for high-precision or safety-oriented
  profiles.

## Current v1 Baseline

Current specifications require only:
- `bm25-lexical`

Current specifications do NOT require:
- semantic search
- embeddings
- HDC/VSA
- symbolic fixed-point retrieval

These are extension targets enabled by DS023.

## Configuration

`config/retrieval-strategies.json`:
```json
{
  "defaultProfile": "balanced",
  "enabledStrategies": ["bm25-lexical"],
  "profiles": {
    "fast": {
      "primaryStrategies": ["bm25-lexical"],
      "secondaryStrategies": [],
      "allowParallel": false,
      "maxStrategiesPerIntent": 1,
      "minAcceptableCandidates": 3,
      "confidenceGapThreshold": 0.20,
      "hardSymbolicPruning": false,
      "targetLatencyMs": 200
    },
    "balanced": {
      "primaryStrategies": ["bm25-lexical"],
      "secondaryStrategies": [],
      "allowParallel": false,
      "maxStrategiesPerIntent": 1,
      "minAcceptableCandidates": 5,
      "confidenceGapThreshold": 0.15,
      "hardSymbolicPruning": false,
      "targetLatencyMs": 500
    },
    "wide-recall": {
      "primaryStrategies": ["bm25-lexical"],
      "secondaryStrategies": [],
      "allowParallel": true,
      "maxStrategiesPerIntent": 3,
      "minAcceptableCandidates": 8,
      "confidenceGapThreshold": 0.10,
      "hardSymbolicPruning": false,
      "targetLatencyMs": 1500
    },
    "symbolic-grounded": {
      "primaryStrategies": ["bm25-lexical"],
      "secondaryStrategies": [],
      "allowParallel": false,
      "maxStrategiesPerIntent": 2,
      "minAcceptableCandidates": 5,
      "confidenceGapThreshold": 0.12,
      "hardSymbolicPruning": true,
      "targetLatencyMs": 2000
    },
    "meta-rational": {
      "primaryStrategies": ["bm25-lexical"],
      "secondaryStrategies": [],
      "allowParallel": true,
      "maxStrategiesPerIntent": 3,
      "minAcceptableCandidates": 5,
      "confidenceGapThreshold": 0.15,
      "hardSymbolicPruning": false,
      "targetLatencyMs": 2500
    }
  },
  "strategyWeights": {
    "bm25-lexical": 1.0
  },
  "agreementBonus": 0.10
}
```

## UI/API Integration

- DS013 exposes `retrieval_profile` in chat and
  session requests.
- DS013 exposes `GET /v1/retrieval-profiles`.
- DS014 exposes a retrieval-profile selector.
- DS019 stores retrieval profile as a session
  preference.

## Dependencies

- DS009 — lexical BM25 implementation
- DS011 — ContextProfile input
- DS012 — orchestration and fusion
- DS013 — API surface
- DS014 — UI profile selector
- DS019 — session preference
