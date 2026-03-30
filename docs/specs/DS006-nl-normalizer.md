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

- NL -> Intent CNL
- NL -> Context CNL
- validation-correction retry loop for LLM-backed
  plugins
- shared input-size enforcement

## Main Interface

```javascript
class NLNormalizer {
  async toIntentCNL(rawNL, history, systemPrompt,
    strategy, requestedModel) -> string
  async toSessionContextCNL(rawNL, systemPrompt,
    strategy, requestedModel) -> string
  async toContextCNL(chunkText, provenance,
    strategy, requestedModel) -> string
}
```

`strategy` here is an implementation helper used by a
plugin, not a user-visible VM mode.

## Dependencies

- DS007 — validator/parser
- DS015 — LLM bridge
- DS022 — seed detector plugins
