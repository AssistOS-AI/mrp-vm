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
    "thinkingdb",
  primaryStrategies: string[],
  secondaryStrategies: string[],
  allowParallel: boolean,
  maxStrategiesPerIntent: number,
  maxResults: number,
  minScore: number,
  minAcceptableCandidates: number,
  confidenceGapThreshold: number,
  hardSymbolicPruning: boolean,
  targetLatencyMs: number
}
```

`maxResults` controls how many top candidates are
returned after scoring and deduplication.

`minScore` is the minimum fused score threshold.
Candidates below this are discarded before ranking.

These two parameters are the primary differentiators
between profiles when using the same strategies.

### Built-in Profile Semantics

#### `fast`
- BM25 only. No secondary strategies.
- `maxResults: 3`, `minScore: 0.3`.
- Prioritizes precision and latency over recall.
- Best for simple, focused questions.

#### `balanced`
- BM25 primary, HDC/VSA as secondary (escalation).
- `maxResults: 7`, `minScore: 0.15`.
- HDC/VSA runs only when BM25 returns fewer than
  `minAcceptableCandidates`.
- Recommended default.

#### `wide-recall` (obsolete compatibility profile)
- Kept only for backward compatibility.
- Marked obsolete and incomplete.
- Not part of the default evaluation matrix.
- Superseded conceptually by the future
  `thinkingdb` profile from DS025.
- Should not be chosen as the recommended path for
  new symbolic or multi-hop retrieval work.

#### `thinkingdb` (planned replacement profile)
- Defined by DS025.
- BM25 remains primary.
- A symbolic `thinkingdb-symbolic` strategy runs as
  bounded local-closure expansion.
- Intended to replace `wide-recall` as the richer
  multi-hop retrieval profile.

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
- Cheap, deterministic, explainable.
- High precision on exact token matches.

### `hdc-vsa-associative`
- Implemented through DS024.
- Uses hyperdimensional binary vectors (4096-bit)
  for per-field structural matching.
- Cheap (bitwise operations), deterministic.
- Complements BM25 by capturing structural
  similarity when lexical overlap is partial.
- See DS024 for full specification.

### `semantic-embedding`
- Optional future strategy.
- Uses vector similarity over stored embeddings.
- Not part of the current baseline.

### `symbolic-fixedpoint`
- Optional future strategy.
- Uses symbolic propagation or constraint narrowing.
- Not part of the current baseline.

## Current Baseline

Implemented strategies:
- `bm25-lexical` (DS009)
- `hdc-vsa-associative` (DS024)

Planned symbolic strategy:
- `thinkingdb-symbolic` (DS025)

## Configuration

`config/retrieval-strategies.json`:
```json
{
  "defaultProfile": "balanced",
  "enabledStrategies": ["bm25-lexical", "hdc-vsa"],
  "profiles": {
    "fast": {
      "primaryStrategies": ["bm25-lexical"],
      "secondaryStrategies": [],
      "allowParallel": false,
      "maxStrategiesPerIntent": 1,
      "maxResults": 3,
      "minScore": 0.3,
      "minAcceptableCandidates": 2,
      "confidenceGapThreshold": 0.20,
      "hardSymbolicPruning": false,
      "targetLatencyMs": 200
    },
    "balanced": {
      "primaryStrategies": ["bm25-lexical"],
      "secondaryStrategies": ["hdc-vsa"],
      "allowParallel": false,
      "maxStrategiesPerIntent": 2,
      "maxResults": 7,
      "minScore": 0.15,
      "minAcceptableCandidates": 4,
      "confidenceGapThreshold": 0.15,
      "hardSymbolicPruning": false,
      "targetLatencyMs": 500
    },
    "wide-recall": {
      "primaryStrategies": ["bm25-lexical", "hdc-vsa"],
      "secondaryStrategies": [],
      "allowParallel": true,
      "maxStrategiesPerIntent": 2,
      "maxResults": 15,
      "minScore": 0.05,
      "minAcceptableCandidates": 6,
      "confidenceGapThreshold": 0.10,
      "hardSymbolicPruning": false,
      "targetLatencyMs": 1500
    }
  },
  "strategyWeights": {
    "bm25-lexical": 1.0,
    "hdc-vsa": 0.7
  },
  "agreementBonus": 0.15
}
```

`wide-recall` remains in config only as a legacy
compatibility profile. It SHOULD be marked obsolete
in documentation and SHOULD be excluded from the
default evaluation matrix. DS025 defines
`thinkingdb` as its intended successor.

## UI/API Integration

- DS013 exposes `retrieval_profile` in chat and
  session requests.
- DS013 exposes `GET /retrieval-profiles`.
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
