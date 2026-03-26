# DS009 — KB Indexing & Retrieval (BM25)

## Purpose
Indexing and lexical search module for the Knowledge
Base. Implements BM25 internally and provides the
built-in `bm25-lexical` retrieval strategy used by
DS012/DS023.

## Description

Indexing is performed on Context CNL units. Each
field of a unit is indexed separately to enable
granular retrieval.

## BM25 — Internal Implementation

BM25 is implemented internally in Node.js with no
external dependencies. Standard parameters:
- k1 = 1.2 (term frequency saturation)
- b = 0.75 (document length normalization)

### Data Structures

- **Inverted index**: term → list of
  (unitId, field, frequency).
- **Document lengths**: unitId → length per field.
- **Average document length**: per field.
- **IDF cache**: term → IDF score.

## Indexed Fields (Complete Schema)

All text fields from ContextUnit are indexed:
- `role`
- `topic`
- `claim`
- `condition`
- `procedure`
- `utilityActs`
- `utilityNote`

## Tokenization

Tokenization for English language:

- Lowercase.
- Split on whitespace.
- Strip punctuation from edges, but:
  - Hyphenated terms are kept as one token AND
    parts are also indexed separately
    (e.g. "CPU-only" → ["cpu-only", "cpu", "only"]).
  - Alphanumeric terms are kept whole
    (e.g. "BM25" → ["bm25"]).
  - Possessives: strip `'s`
    (e.g. "user's" → ["user"]).
  - Contractions: kept whole
    (e.g. "don't" → ["don't"]).
- Stopword removal (minimal English list,
  vendored in `src/lib/vendor/stopwords.js`).
- Optional stemming: minimal Porter Stemmer,
  vendored in `src/lib/vendor/porter.js`.
  Enabled via config.

## Main Interface

```javascript
class KBIndex {
  addUnit(contextUnit) → void
  removeUnit(unitId) → void
  updateUnit(contextUnit) → void
  search(query, options) → ScoredUnit[]
  rebuild(allUnits) → void
  getStats() → IndexStats
}

// ScoredUnit
{
  unitId: string,
  score: number,
  unit: ContextUnit
}

// options
{
  maxResults: number,
  fieldWeights: object,
  roleFilter: string | null,
  actBoost: string | null
}

// IndexStats
{
  totalUnits: number,
  totalTerms: number,
  avgDocLength: object
}
```

Optional strategy wrapper:

```javascript
class BM25LexicalStrategy {
  constructor(sessionIndexFactory, kbIndex, config)
  async retrieve(input) → StrategyResult
}
```

## Field Weights

BM25 scores per field are combined with weights:
- topic: 1.5
- claim: 1.0
- procedure: 1.0
- role: 0.5
- utilityActs: 0.8
- utilityNote: 0.6
- condition: 0.6

Weights are configurable in `config/retrieval.json`.

## Pragmatic Role Scoring Adjustment

After BM25, scores are adjusted based on
compatibility between the intent's pragmatic act
and the unit's pragmatic role.

The canonical mapping is defined in DS004.
Referenced from here, not duplicated.

Boost factor: 1.3x for preferred role
(configurable).

## Combined Scoring Formula

```
finalScore = sum(fieldWeight[f] * bm25(query, unit[f]))
           * roleBoost(intentAct, unitRole)
```

Where `roleBoost` = 1.3 if the unit's role is in
the preferred roles list for the intent's act,
otherwise 1.0.

## Deduplication

If two units have the same `hash` (from DS005),
only the one with the higher score is kept.

## Role In The Architecture

DS009 is one concrete retrieval strategy backend.
It is not the only possible matching approach after
DS023 is introduced.

Current required baseline:
- `bm25-lexical`

Optional future strategies outside DS009:
- semantic embedding search
- HDC/VSA associative search
- symbolic fixed-point pruning

## Dependencies

- DS004 (Intent CNL) — act → roles mapping.
- DS005 (Context CNL) — unit structure.
- DS010 (Persistence) — save/load index.
- DS012 (Retrieval) — orchestrates results.
- DS023 (Retrieval Strategies) — treats this DS as
  the built-in lexical strategy.
