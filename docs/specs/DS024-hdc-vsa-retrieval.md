# DS024 — HDC/VSA Retrieval Backend (kb-balanced)

## Purpose
Defines the associative retrieval backend used
internally by the built-in `kb-balanced` plugin.

This is a plugin-private backend, not a VM-level
shared service. The VM core does not depend on or
reference HDC/VSA directly. Other KB plugins are free
to use entirely different associative strategies.

## Architectural Position

- DS024 is a backend owned by `kb-balanced`
- the VM core provides only the LLM bridge and
  execution frame machinery; all retrieval logic
  belongs to plugins
- it complements lexical BM25 by capturing structural
  and semantic similarity through hyperdimensional
  encodings

## Main Interface

```javascript
class HDCVSAStrategy extends RetrievalStrategy {
  getId() -> "hdc-vsa"
  retrieve({
    contextProfile,
    sessionIndex,
    kbIndex,
    budget
  }) -> RetrievalResult
}
```

## Encoded Views

Each unit is encoded into four field vectors:

- `role`
- `topic`
- `claim`
- `acts`

Current encoding choices:

- `role` -> random symbolic hypervector keyed by the
  role label
- `topic` -> n-gram encoding of tokenized topic text
- `claim` -> n-gram encoding of claim text, or
  procedure text when claim is absent
- `acts` -> token encoding of `utilityActs`

## Query Encoding

The query is encoded from the retrieval
`contextProfile`:

- needed roles -> role vector
- query terms -> topic vector
- query terms -> claim vector
- act boost -> acts vector

## Field Weights

The current shipped field weights are:

```javascript
{
  role: 0.20,
  topic: 0.35,
  claim: 0.35,
  acts: 0.10
}
```

## Similarity and Score Normalization

For each field present on both query and unit:

1. compute hypervector similarity
2. subtract the random baseline around `0.50`
3. clamp negative signal to zero
4. combine weighted field scores

The current shift is:

```text
shifted = max(0, (similarity - 0.50) * 2)
```

This means:

- random similarity contributes approximately zero
- clearly aligned vectors contribute positive signal

## Result Shape

```javascript
{
  strategyId: "hdc-vsa",
  candidates: [{
    unitId,
    store: "session" | "kb",
    rawScore,
    normalizedScore,
    unit,
    notes: ["hdc-vsa"]
  }],
  durationMs,
  exhaustedBudget
}
```

## Cache Behavior

The backend caches encoded unit vectors by `unitId`.

It MUST support invalidation:

- per unit
- full cache reset

This is required when units are updated or removed.

## Dependencies

- DS023 — multi-backend KB plugin fusion
- DS005 — unit fields being encoded
