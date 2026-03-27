# DS024 — HDC/VSA Associative Retrieval Strategy

## Purpose
Provides a complementary retrieval strategy based on
Hyperdimensional Computing (HDC) / Vector Symbolic
Architecture (VSA) for fast associative matching
between intent queries and context units.

## Description

HDC/VSA represents concepts as high-dimensional
binary vectors (hypervectors) and uses algebraic
operations to compose and compare structured
representations. Unlike BM25 which matches exact
tokens, HDC captures structural co-occurrence
patterns across fields (role, topic, claim, acts),
enabling approximate matching when lexical overlap
is partial.

## Core Primitives

All operations use binary hypervectors of 4096 bits
stored as `Uint32Array(128)`. Zero external
dependencies.

### Random Hypervector Generation
Each unique token or symbol gets a deterministic
random hypervector via seeded PRNG from its string
hash. The same token always produces the same vector.

### Bind (⊗)
Bitwise XOR. Associates a field name with its value:
```
ROLE_FIELD ⊗ role_vector
```
Binding is its own inverse and preserves
dissimilarity with unrelated vectors.

### Bundle (+)
Majority vote across bit positions. Combines multiple
concepts into a composite that is similar to all
inputs:
```
bundle(topic_tokens) ≈ each individual token
```

### Similarity
Normalized Hamming distance:
```
similarity(a, b) = 1 - hamming(a, b) / 4096
```
Range `[0, 1]`. Random vectors have expected
similarity ~0.50. Meaningful similarity starts
above ~0.55.

## Unit Encoding

Each context unit is encoded as a **set of per-field
vectors**, not a single composite:

```javascript
{
  role:  randomHV(unit.role),
  topic: encodeNgrams(tokenize(unit.topic)),
  claim: encodeNgrams(tokenize(unit.claim)),
  acts:  encodeTokens(unit.utilityActs)
}
```

`encodeNgrams` produces positional unigrams (token
bound to position index) plus bigrams (consecutive
token pairs bound together). This captures word
order and local structure, not just bag-of-words.

## Query Encoding

```javascript
{
  role:  encodeTokens(neededRoles),
  topic: encodeNgrams(queryTerms),
  claim: encodeNgrams(queryTerms),
  acts:  randomHV(actBoost)
}
```

## Scoring

Each field is scored independently:
```
fieldScore = max(0, (similarity(q.field, u.field) - 0.50) × 2)
```

The 0.50 baseline subtraction removes random noise.
Fields are combined with weights:
```
finalScore = weighted_avg(
  role:  0.20,
  topic: 0.35,
  claim: 0.35,
  acts:  0.10
)
```

This per-field approach means a unit that matches
on topic but not on role gets a partial score,
rather than the match being diluted in a single
composite vector.

## Complementarity with BM25

| Property | BM25 | HDC/VSA |
|----------|------|---------|
| Match type | Exact token | Structural pattern |
| Synonym handling | None (needs stemming) | Partial (via co-occurrence) |
| Field structure | Weighted per-field TF-IDF | Bound field-value pairs |
| Speed | O(query_terms × posting_lists) | O(units × 128 XOR+popcount) |
| Precision | High on exact match | Moderate |
| Recall on partial overlap | Low | Higher |

The two strategies are most effective when fused:
BM25 provides precise lexical hits, HDC fills gaps
where lexical overlap is weak but structural
similarity exists.

## Profile Integration

| Profile | HDC Role |
|---------|----------|
| `fast` | Not used. BM25 only. |
| `balanced` | Secondary. Escalation when BM25 returns fewer than `minAcceptableCandidates`. |
| `wide-recall` | Primary alongside BM25. Parallel execution, results fused with agreement bonus. |

## Fusion with BM25

When both strategies return candidates for the same
unit, DS012 computes:
```
fusedScore = bm25_weight × bm25_score
           + hdc_weight × hdc_score
           + agreementBonus
```

Default weights: BM25 = 1.0, HDC = 0.7.
Agreement bonus: 0.15 (rewarding independent
confirmation).

## Caching

Unit vectors are cached in memory by unitId. The
cache is invalidated when KB units change. Query
vectors are computed per request (cheap: ~0.1ms for
4096-bit operations).

## Performance

For a KB of 1000 units:
- Encoding: ~2ms total (one-time at ingest)
- Query: <1ms (128 XOR + popcount per unit)
- Memory: ~0.5KB per unit vector

## File Structure

```
src/lib/hdc.mjs                         — primitives
src/retrieval/strategies/hdc-vsa.mjs    — strategy
```

## Dependencies

- DS009 — tokenizer (shared with BM25)
- DS012 — orchestration and fusion
- DS023 — strategy interface and profile config
