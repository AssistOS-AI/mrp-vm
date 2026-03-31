# DS006 — NL Normalizer

## Purpose
Defines shared normalization helpers used by
`sd-plugin`s and KB ingest flows.

## Architectural Position

The normalizer is no longer a top-level operating
mode selector. It is a shared service invoked by
plugins.

Typical users:

- `sd-plugin.detectSeeds(...)`
- `sd-plugin.normalizePersistentContext(...)`
- KB ingest helpers during source staging

## Responsibilities

- NL -> seed bundle
- validation of both problem seeds and session KUs
- validation-correction retry loop for LLM-backed
  plugins
- shared input-size enforcement

## Main Interface

```javascript
class NLNormalizer {
  async toSeedBundleCNL(rawNL, history, systemPrompt,
    strategy, requestedModel) -> {
      intentCNL: string,
      currentTurnContextCNL: string,
      attemptCount: number
    }
  async toContextCNL(chunkText, provenance,
    strategy, requestedModel) -> string
}
```

`strategy` here is an implementation helper used by a
plugin, not a user-visible VM mode.

## Seed Bundle Rule

For a chat turn, the normalizer SHOULD treat problem
seeds and session knowledge units as one normalization
job.

That means:

- one extraction pass over the user turn
- one logical `sd-plugin.detectSeeds(...)` result
- one validation/correction loop over the combined
  seed bundle

Separate intent-only and context-only normalization
passes for the same user turn are no longer the
preferred design because they duplicate semantic work
and often duplicate LLM cost.

## Dependencies

- DS007 — validator/parser
- DS015 — LLM bridge
- DS022 — seed detector plugins
