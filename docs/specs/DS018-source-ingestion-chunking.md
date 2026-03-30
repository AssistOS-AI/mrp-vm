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

## Ingest Flow

1. source text enters the workspace
2. a seed detector normalizes persistent context
3. semantic units are stored in the KB substrate
4. raw text plus units are offered to all enabled
   KB plugins
5. KB plugins may build plugin-private indices or
   derived memory

## Dependencies

- DS006 — normalization helpers
- DS008 — semantic-unit storage
- DS023 — KB plugins
