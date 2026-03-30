# DS009 — KB Indexing (BM25 Backend)

## Purpose
Defines the lexical indexing backend used by the
built-in BM25 retrieval strategy.

This DS documents the shared `KBIndex` component
behind `bm25-lexical`, which is then consumed by
`kb-fast` and `kb-balanced`.

## Architectural Position

- BM25 is a backend, not a user-visible plugin.
- `kb-plugin`s decide when to call it and how to fuse
  its scores with other backends.
- The index stores current unit fields only; it does
  not own planner logic or sufficiency decisions.

## Main Interface

```javascript
class KBIndex {
  addUnit(unit) -> void
  removeUnit(unitId) -> void
  updateUnit(unit) -> void
  rebuild(allUnits) -> void

  search(query, options) -> [{
    unitId,
    score,
    unit
  }]

  getStats() -> {
    totalUnits,
    totalTerms,
    avgDocLength
  }

  toIndexData() -> object
  loadFromIndexData(data, allUnits) -> void
}
```

## Indexed Fields

The current implementation indexes these unit fields:

- `role`
- `topic`
- `claim`
- `condition`
- `procedure`
- `utilityActs`
- `utilityNote`

For `utilityActs`, the indexed text is the
space-joined act list.

## Default Field Weights

The shipped defaults are:

```javascript
{
  topic: 1.5,
  claim: 1.0,
  procedure: 1.0,
  role: 0.5,
  utilityActs: 0.8,
  utilityNote: 0.6,
  condition: 0.6
}
```

Projects MAY override these via config, but the
relative priority should remain:

1. topical content
2. claim/procedure body
3. task hints and constraints

## Tokenization Contract

The index delegates tokenization to the shared
tokenizer.

That tokenizer is responsible for:

- lowercasing
- stopword removal
- hyphen handling
- possessive stripping
- stemming

DS009 does not redefine tokenization rules; it
consumes the canonical tokens emitted by the
tokenizer.

## Scoring Formula

For each candidate unit and indexed field:

```text
fieldScore(term, field, unit) =
  idf(term) *
  tf(term, field, unit) * (k1 + 1) /
  (tf(term, field, unit) +
   k1 * (1 - b + b * dl(field, unit) / avgdl(field)))
```

The final lexical score is:

```text
score(unit, query) =
  sum over indexed fields(
    fieldWeight(field) *
    sum over query terms(fieldScore)
  )
```

Current constants:

- `k1 = 1.2`
- `b = 0.75`

## Role-Aware Boosting

After lexical scoring, the backend MAY apply a role
boost using `actBoost` from the context profile.

If the unit role appears in the DS004
`Act -> Preferred Context Roles` mapping for the
current act, the score is multiplied by
`roleBoostFactor` (currently `1.3`).

This is a ranking preference, not a filter.

## Search Input

```javascript
index.search(query, {
  maxResults = 10,
  roleFilter = null,
  actBoost = null
})
```

- `query` is plain text, usually built from
  `contextProfile.queryTerms`.
- `roleFilter`, when present, is an exact role
  filter.
- `actBoost` activates the role preference heuristic.

## Search Output

The backend returns sorted candidates:

```javascript
[
  {
    unitId: "src-001::chunk-000::unit-000",
    score: 2.137,
    unit: { ...ContextUnit }
  }
]
```

Sorting is:

1. descending score
2. ascending `unitId` as deterministic tiebreaker

## Persistence Format

`toIndexData()` persists:

- `schemaVersion`
- `createdAt`
- `unitCount`
- `unitHashes`
- `invertedIndex`
- `docLengths`
- `avgDocLengths`
- `idfCache`

`loadFromIndexData()` restores the index plus a
separate unit collection supplied by KB persistence.

The lexical backend does not persist full unit bodies
inside the index snapshot.

## Non-Goals

DS009 does not specify:

- multi-backend fusion
- planner ordering
- sufficiency checks
- symbolic closure
- derived-memory generation

Those belong to DS023, DS025, and DS029.

## Dependencies

- DS005 — indexed unit fields
- DS010 — index snapshot persistence
- DS023 — KB plugins that consume the backend
