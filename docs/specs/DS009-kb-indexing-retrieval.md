# DS009 — BM25 Lexical Backend (kb-fast, kb-balanced)

## Purpose
Defines the lexical indexing backend used internally
by the built-in `kb-fast` and `kb-balanced` plugins.

This is a plugin-private backend, not a VM-level
shared service. The VM core does not depend on or
reference BM25 directly. Other KB plugins are free
to use entirely different indexing strategies.

## Architectural Position

- BM25 is a backend owned by specific `kb-plugin`
  implementations.
- The VM core provides only the LLM bridge and the
  execution frame machinery. All indexing, scoring,
  and retrieval logic belongs to plugins.
- `kb-plugin`s decide when to call BM25 and how to
  fuse its scores with other backends.

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

The current implementation indexes these KU fields:

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

## Tokenization Contract

The index delegates tokenization to a shared
tokenizer responsible for:

- lowercasing
- stopword removal
- hyphen handling
- possessive stripping
- stemming

## Scoring Formula

Standard BM25 with field weights:

```text
fieldScore(term, field, unit) =
  idf(term) *
  tf(term, field, unit) * (k1 + 1) /
  (tf(term, field, unit) +
   k1 * (1 - b + b * dl / avgdl))
```

Constants: `k1 = 1.2`, `b = 0.75`.

## Role-Aware Boosting

After lexical scoring, the backend MAY apply a role
boost using `actBoost` from the context profile.
Current `roleBoostFactor`: `1.3`.

## Persistence Format

`toIndexData()` persists: `schemaVersion`,
`createdAt`, `unitCount`, `unitHashes`,
`invertedIndex`, `docLengths`, `avgDocLengths`,
`idfCache`.

## Non-Goals

DS009 does not specify multi-backend fusion, planner
ordering, sufficiency checks, symbolic closure, or
derived-memory generation. Those belong to the
`kb-plugin` implementations and DS029.

## Dependencies

- DS005 — KU fields being indexed
- DS010 — index snapshot persistence
- DS030 — Knowledge Unit model
