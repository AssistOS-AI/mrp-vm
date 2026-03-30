# DS008 — Knowledge Base

## Purpose
Defines the persistent KB substrate used by KB
plugins.

## Storage Model

The KB is natural-language-first and organized around
semantic units, not raw files and not fixed-size
token slices.

The KB stores:

- source semantic units
- aggregate semantic units
- derived textual memory units
- provenance metadata
- parent/child relations
- plugin-private artifacts

## Unit Registry

The current persisted v1 unit shape is:

```javascript
{
  id,
  sourceId,
  sourceName,
  chunkId,
  chunkIndex,
  unitIndex,
  unitType,
  textBody,
  role,
  topic,
  claim,
  condition,
  procedure,
  utilityActs,
  utilityNote,
  hash,
  subject,
  relation,
  object,
  confidence,
  parentUnitIds,
  childUnitIds,
  derivedFromUnitIds,
  charStart,
  charEnd,
  createdAt,
  chunkType,
  sectionTitle
}
```

Not every unit source can populate every field, but
this is the baseline persisted shape for KB-derived
semantic units.

## KB vs Plugins

The KB substrate owns:

- repository/workspace persistence
- committed semantic units
- shared source metadata

KB plugins own:

- retrieval logic
- plugin-private indices
- derived memories/caches
- sufficiency logic

## Required Relations

The current baseline preserves:

- where a unit came from (`sourceId`, `chunkId`)
- which chunk it came from with offsets
- its source-level identity and hash
- structural hints: `unitType`, `chunkType`,
  `sectionTitle`
- hierarchical links: `parentUnitIds` and
  `childUnitIds` connecting leaf units to section
  aggregates and section aggregates to source
  aggregates

The ingest pipeline (DS018) now produces three
levels of units:

1. **Leaf units** — grouped semantic claims
2. **Section aggregates** — summaries with
   `childUnitIds` pointing to leaf units
3. **Source aggregates** — summaries with
   `childUnitIds` pointing to section aggregates

KB plugins can traverse these links to expand or
narrow retrieval granularity per question.

## Dependencies

- DS010 — persistence
- DS018 — unit extraction
- DS023 — KB plugins
- DS026 — repository/workspace semantics
