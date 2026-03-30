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
The current baseline implementation is lighter:

- Markdown files are chunked by headings, then
  paragraphs, then sentences when needed
- plain text is chunked by paragraph, then sentence,
  then fixed windows as a fallback
- the persisted lineage today is
  `sourceId -> chunkId -> unitId`

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
