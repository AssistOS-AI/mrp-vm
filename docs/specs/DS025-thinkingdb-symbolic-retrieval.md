# DS025 — ThinkingDB Symbolic Retrieval

## Purpose
Defines `ThinkingDB`, a bounded symbolic retrieval
component for MRP-VM. It supplements lexical and
associative retrieval with local logical closure
over explicitly normalized symbolic facts derived
from Context CNL.

`ThinkingDB` answers a narrower and more useful
question than generic reasoning:

- given a small set of relevant symbolic facts
- plus a bounded rule set
- plus an intent-local seed neighborhood

which evidence chains become newly relevant after
controlled symbolic composition?

## Scope Boundary

This DS introduces:

- a dependency-free in-memory class named
  `ThinkingDB`
- a symbolic retrieval strategy that wraps it
- a CNL-compatible symbolic fact representation
- bounded positive-Horn closure for retrieval
  support and explanation

This DS does NOT introduce:

- a replacement for DS008 persistent KB storage
- a replacement for DS009 BM25 indexing
- a new public query language such as
  `ask ...` or `result ...`
- a general theorem prover
- negation, contradiction management, or truth
  maintenance in v1

`ThinkingDB` is a retrieval-side index, not a new
top-level KB subsystem.

## Architectural Position

`ThinkingDB` belongs under DS023 as a retrieval
strategy of kind `symbolic`.

Its position is:

- DS005 provides the normalized Context CNL units
- DS007 validates and parses those units
- DS025 extracts symbolic facts from those units
- DS012 orchestrates `ThinkingDB` beside BM25 and
  other strategies under a retrieval profile

Persistent source files, generated Context CNL, and
index snapshots remain governed by DS008 and DS010.

## Why Not A New CNL Dialect

The earlier proposal used a separate line-based
syntax with forms such as `entity`, `fact`, `rule`,
and `ask`.

MRP-VM already has strict, validated CNL formats for
intent and knowledge:

- DS004 Intent CNL
- DS005 Context CNL
- DS007 symbolic validation/parsing

Introducing a second public CNL dialect would create
an unnecessary split in the normalization contract.

Therefore:

- user queries remain DS004 Intent CNL
- KB content remains DS005 Context CNL
- `ThinkingDB` consumes symbolic fields embedded in
  Context CNL units
- rules are configured structurally in code or JSON,
  not emitted as public CNL in v1

## Context CNL Symbolic Extension

DS025 requires a narrow extension of DS005 Context
CNL. A Context Unit MAY carry one normalized
symbolic fact in addition to its normal pragmatic
fields.

### Additional Optional Fields

| Field      | Required | Description                    |
|------------|----------|--------------------------------|
| Subject    | No*      | Canonical fact subject         |
| Relation   | No*      | Canonical relation label       |
| Object     | No*      | Canonical fact object          |
| Confidence | No       | Fact confidence in `[0, 1]`    |

`*` If one of `Subject`, `Relation`, or `Object` is
present, all three are required.

These fields are additive only:

- they do NOT replace `Role`, `Topic`, `Claim`,
  `Procedure`, or `UtilityActs`
- a unit without symbolic fields remains a valid
  DS005 Context Unit
- a unit with symbolic fields must still satisfy all
  DS005 role/claim/procedure rules

### Example

```markdown
## Context Unit src-001::chunk-000::unit-000
SourceId: src-001
ChunkId: src-001::chunk-000
Role: Explanation
Topic: AchillesIDE and Ploinky
Claim: AchillesIDE uses Ploinky.
Subject: AchillesIDE
Relation: uses
Object: Ploinky
Confidence: 1.00
UtilityActs: explain
```

### Validation Rules

DS007 MUST enforce the following when symbolic
fields are present:

- `Subject`, `Relation`, `Object` are all-or-none
- `Relation` must belong to the configured relation
  registry
- `Confidence`, if present, must parse as a number
  in `[0, 1]`
- symbolic fields are validated independently from
  the pragmatic `Role` enum

## Canonical Relations

v1 uses a controlled relation registry. The normal
path is explicit configuration, not free invention by
the normalizer.

Recommended built-in relations:

- `uses`
- `provides`
- `has_capability`
- `depends_on`
- `part_of`
- `instance_of`
- `relevant_for`
- `supports`
- `mentions`
- `about`

Extensions MAY be added deliberately through config,
but the normalizer SHOULD NOT invent arbitrary
relations at runtime.

## Rule Model

Rules are not public CNL in v1. They are registered
programmatically or loaded from configuration and
compiled into `ThinkingDB`.

### Rule Shape

```javascript
{
  id: "tool_to_capability",
  when: [
    { s: "?x", r: "uses", o: "?y" },
    { s: "?y", r: "provides", o: "?z" }
  ],
  then: { s: "?x", r: "has_capability", o: "?z" },
  weight: 0.95,
  maxDepth: 3
}
```

### Allowed Rule Fragment

`ThinkingDB` v1 implements a bounded fragment of
positive Horn logic:

- positive atoms only
- one conclusion atom
- 1 to 3 premise atoms
- variables start with `?`
- recursive rules are allowed only under the query
  depth budget

Allowed examples:

- relation composition
- transitive propagation
- capability inheritance
- bounded part-whole propagation
- derived relevance propagation

Forbidden in v1:

- negation
- disjunction in the rule head
- existential function terms
- contradiction resolution
- unrestricted global closure over the whole KB

## Internal Data Model

The core class stores symbolic facts, source links,
rule definitions, and proof traces.

### Base Fact

```javascript
{
  key: "AchillesIDE|uses|Ploinky",
  s: "AchillesIDE",
  r: "uses",
  o: "Ploinky",
  conf: 1.0,
  unitId: "src-001::chunk-000::unit-000",
  sourceId: "src-001",
  store: "kb",
  derived: false
}
```

### Derived Fact

```javascript
{
  key: "AchillesIDE|has_capability|sandboxing",
  s: "AchillesIDE",
  r: "has_capability",
  o: "sandboxing",
  conf: 0.9025,
  derived: true,
  viaRule: "tool_to_capability",
  support: [
    "AchillesIDE|uses|Ploinky",
    "Ploinky|provides|sandboxing"
  ]
}
```

### Proof Record

```javascript
{
  conclusionKey: "AchillesIDE|relevant_for|secure_execution",
  score: 0.81,
  steps: [
    { kind: "fact", key: "AchillesIDE|uses|Ploinky" },
    { kind: "fact", key: "Ploinky|provides|sandboxing" },
    { kind: "rule", id: "tool_to_capability" },
    { kind: "fact", key: "sandboxing|relevant_for|secure_execution" },
    { kind: "rule", id: "capability_to_relevance" }
  ]
}
```

## Core Interface

The `ThinkingDB` class is intentionally synchronous.
It performs no I/O and requires no external
dependencies.

```javascript
class ThinkingDB {
  constructor(options = {}) {}

  registerRules(rules) {}
  addUnit(contextUnit, store = "kb") {}
  removeUnit(unitId) {}
  rebuild(units, store = "kb") {}

  query(contextProfile, options = {}) {}
  stats() {}
}
```

Recommended constructor options:

- `maxDepth`
- `maxDerivedFactsPerQuery`
- `maxProofs`
- `defaultRuleWeight`
- `minConfidence`
- `distancePenalty`
- `goalBonus`
- `seedBonus`

The DS023 strategy wrapper remains `async` and may
cache `ThinkingDB` instances per store.

## Query Semantics

`ThinkingDB` does not receive a separate query DSL.
It receives the existing `ContextProfile` from DS011
plus the current-turn units and store views supplied
through DS023.

### Seed Resolution

For a given `ContextProfile`, the strategy resolves
seed symbols using:

1. exact matches between query terms and symbolic
   subjects or objects
2. exact matches on `Topic`
3. optional current-turn symbolic facts
4. deterministic alias tables if configured

No fuzzy LLM step is allowed inside `ThinkingDB`.

### Local Neighborhood

Closure MUST run only on a local symbolic subgraph:

- facts touching a seed symbol
- plus adjacent facts within `maxDepth` hops
- plus facts mentioning explicit goal symbols, if
  such symbols are resolved

The full KB MUST NOT be globally saturated at query
time.

### Bounded Fixpoint

Closure runs until:

- no new facts are produced
- `maxDepth` is reached
- or `maxDerivedFactsPerQuery` is reached

Logical sketch:

```javascript
agenda = seedFacts
known = new Map(seedFacts)
derived = []

for depth in 1..maxDepth:
  newFacts = []
  for rule in rules:
    for binding in match(rule.when, known, localFacts):
      fact = instantiate(rule.then, binding)
      if !known.has(fact.key):
        record fact and proof
        newFacts.push(fact)
  if newFacts.length === 0:
    break
  add newFacts to known
  derived.push(...newFacts)
```

## Ranking

The primary ranking target is the original Context
Unit evidence that participates in the best proof
paths. `ThinkingDB` v1 does NOT materialize synthetic
Context Units as first-class retrieval output.

### Path Score

Recommended formula:

```text
pathScore =
  product(baseFact.conf) *
  product(rule.weight) *
  distancePenalty(pathLength) *
  goalBonus *
  seedBonus
```

Where:

- `distancePenalty(n) = 1 / (1 + n * 0.25)`
- `goalBonus = 1.15` when the path reaches a symbol
  strongly aligned with the query goal
- `seedBonus = 1.10` when the path starts directly
  from a resolved seed

### Unit Score

Each source `ContextUnit` receives the best score of
all proof paths in which one of its symbolic facts
participates.

The strategy wrapper converts those ranked units into
DS023 candidates:

```javascript
{
  unitId,
  store,
  rawScore,
  normalizedScore,
  notes: [
    "thinkingdb",
    "derived: AchillesIDE relevant_for secure_execution",
    "via: capability_to_relevance"
  ]
}
```

## Strategy Wrapper

The DS023 wrapper SHOULD be named
`thinkingdb-symbolic`.

### Wrapper Responsibilities

- extract symbolic facts from Context Units
- maintain a `ThinkingDB` instance or cache
- register the configured rule set
- run bounded query closure
- map proof-bearing source units back to DS023
  retrieval candidates
- expose compact proof summaries in `notes`

### Current-Turn Context

The wrapper MAY use current-turn symbolic units as
query constraints or seed facts.

Until DS012 is extended to support scored
`current-turn` candidates in the final split, the
wrapper SHOULD return only `session` and `kb`
candidates and let DS012 include current-turn units
through its existing direct-evidence path.

## Retrieval Profile Guidance

This DS introduces the future retrieval profile
`thinkingdb`.

Recommended semantics:

- BM25 remains the primary precision anchor
- `thinkingdb-symbolic` runs as secondary symbolic
  expansion
- symbolic output is fused with lexical evidence
  rather than replacing it

Recommended initial profile shape:

```json
{
  "thinkingdb": {
    "primaryStrategies": ["bm25-lexical"],
    "secondaryStrategies": ["thinkingdb-symbolic"],
    "allowParallel": false,
    "maxStrategiesPerIntent": 2,
    "maxResults": 8,
    "minScore": 0.12,
    "minAcceptableCandidates": 4,
    "confidenceGapThreshold": 0.25,
    "hardSymbolicPruning": false,
    "targetLatencyMs": 700
  }
}
```

`wide-recall` is not the long-term direction for
symbolic expansion. DS025 treats `thinkingdb` as the
intended replacement profile for richer multi-hop
retrieval.

## Required Amendments To Other DS Files

DS025 is not self-sufficient without narrow updates
to nearby specs:

- DS005 must allow `Subject`, `Relation`, `Object`,
  and `Confidence` as optional Context CNL fields.
- DS007 must validate those fields and their
  all-or-none constraint.
- DS012 should extend `retrievalTrace` to carry
  strategy-specific proof summaries.
- DS023 should register `thinkingdb-symbolic` as a
  symbolic retrieval strategy and define the
  `thinkingdb` profile.
- DS021 should add `thinkingdb` coverage to the
  evaluation matrix once implemented.

## Non-Goals For v1

The following are deliberately out of scope for the
first implementation:

- public rule CNL
- public query CNL
- alias learning from free text
- contradiction detection
- confidence calibration by LLM
- macro materialization or proof compression
- persistence of derived facts as authoritative KB
  truth

## Dependencies

- DS005 — Context CNL base structure
- DS007 — validation/parsing
- DS011 — `ContextProfile` query input
- DS012 — retrieval orchestration
- DS023 — strategy/profile abstraction
- DS008 and DS010 — source of persisted Context CNL
