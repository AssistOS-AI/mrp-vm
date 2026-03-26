# DS011 — Intent Decomposition & Context Profiles

## Purpose
Decomposes the validated Intent CNL document into
independent intent groups and derives a context
profile for each.

## Description

This module is fully symbolic. It receives the
parser output (DS007) and produces internal
structures that guide retrieval.

DS011 does NOT perform LLM-assisted recursive
decomposition in v1. The split into Intent Groups is
already completed upstream by the selected strategy
used in DS006.

## Steps

### 1. Extract Internal Structures

From each parsed IntentGroup, a DecomposedIntent
is extracted:

```javascript
{
  groupNumber: 1,
  act: "compare",
  intent: "Compare BM25 and dense retrieval
    for lexical search.",
  target: "BM25 and dense retrieval",
  criteria: ["fast response time", "low memory"],
  evidence: [],
  explicitContext: "CPU-only deployment environment",
  outputType: "comparative recommendation"
}
```

`act` is a required field of `DecomposedIntent`.
It is copied directly from the validated `Act`
field of the source Intent Group and is preserved
through all downstream steps.

Implementation invariant:
- DS011 must not create a `DecomposedIntent`
  without `act`
- if `act` is absent upstream, the failure belongs
  to DS007 validation/parsing and decomposition must
  not run

### Extraction Rules

- `act` — directly from the Act field (DS004).
- `target` — extracted from the Intent field
  using the following deterministic algorithm:
  1. Remove the first word (the act verb) from
     the Intent value.
  2. Remove trailing punctuation (`.`, `?`, `!`).
  3. The remaining text is the `target`.
  No NLP noun-phrase extraction is attempted.
  The full remaining text is used as-is.
  Example: `"Compare BM25 and dense retrieval
  for lexical search."` → act verb `"Compare"`
  is removed → target = `"BM25 and dense
  retrieval for lexical search"`.
- `criteria` — from the Criterion field, split
  on `, ` (comma + space). If the field is
  absent, empty array.
- `evidence` — from the Evidence field, split
  on `, ` (comma + space). If the field is
  absent, empty array.
- `explicitContext` — from the Context field,
  verbatim. Null if absent.
- `outputType` — from the Output field, verbatim.

### 2. Derive Context Profile

For each DecomposedIntent, a profile is generated:

```javascript
{
  intentGroupNumber: 1,
  neededRoles: ["Comparison", "Evaluation"],
  queryTerms: ["BM25", "dense retrieval",
    "CPU", "response time"],
  actBoost: "compare",
  maxResults: 10
}
```

### Derivation Rules

`neededRoles` is derived from the canonical
mapping defined in DS004 (act → roles table).
Not duplicated here.

`queryTerms` are extracted from:
- target
- criteria
- explicit context
With stopword removal (same list as DS009).

One Intent Group produces exactly one
ContextProfile.

One Intent Group also produces exactly one
`DecomposedIntent`, so all downstream modules use
the same `act` value for retrieval boosts, plugin
dispatch, and synthesis grouping.

There is no recursive split depth and no sub-intent
tree in v1. The decomposition step is a 1:1
transformation from validated Intent Groups to
DecomposedIntent objects.

## Main Interface

```javascript
class IntentDecomposer {
  decompose(intentGroups) → DecomposedIntent[]
  deriveContextProfile(decomposed) →
    ContextProfile
}
```

## Dependencies

- DS004 (Intent CNL) — act → roles mapping.
- DS007 (Parser) — provides IntentGroup[].
- DS012 (Retrieval) — consumes ContextProfile.
