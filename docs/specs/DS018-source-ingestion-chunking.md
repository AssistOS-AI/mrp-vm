# DS018 — Source Ingestion & Semantic Unit Extraction

## Purpose
Defines how raw documents become semantic units for
the KB substrate and how KB plugins receive ingest
signals.

## Design Rule

The right storage unit is the smallest stable
meaningful semantic unit, not the file and not an
arbitrary token window.

## Hierarchical Granularity

Examples:

- literature: scene -> chapter -> work
- legal: clause -> article -> instrument
- procedure: step -> procedure -> handbook
- technical writing: claim block -> section ->
  document

These hierarchies are the target design vocabulary.
The current baseline implements two levels:

- **Leaf units** are produced by grouping related
  sentences that share subjects, entities, or
  narrative continuity. A single unit may contain
  multiple sentences when they describe the same
  scene, entity, or concept.
- **Section aggregates** are created when a section
  (heading or paragraph group) contains multiple
  leaf units. They summarize the section and carry
  `childUnitIds` pointing to their leaf units.
- **Source aggregates** are created when a source
  has multiple sections. They summarize the whole
  source and carry `childUnitIds` pointing to
  section aggregates.

Leaf units carry `parentUnitIds` back-references to
their containing aggregate.

KB plugins can use these hierarchical links to:

- expand retrieval to parent units when broader
  context is needed
- drill down to child units for detail
- decide retrieval granularity based on the question

## Ingest Flow

1. source text enters the workspace
2. a seed detector normalizes persistent context
3. semantic units are stored in the KB substrate
4. raw text plus units are offered to all enabled
   KB plugins
5. KB plugins may build plugin-private indices or
   derived memory

## Current Provenance Surface

For each chunk, the baseline ingest pipeline
materializes:

```javascript
{
  sourceId,
  sourceName,
  chunkId,
  chunkIndex,
  charStart,
  charEnd,
  chunkType,
  sectionTitle,
  createdAt
}
```

These chunk-level signals are then propagated onto
derived Context CNL units as optional provenance and
lineage fields.

## Dependencies

- DS006 — normalization helpers
- DS008 — semantic-unit storage
- DS023 — KB plugins
