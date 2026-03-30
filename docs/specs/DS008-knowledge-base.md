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

- where a unit came from
- which chunk it came from
- its source-level identity and hash
- optional structural hints such as chunk type,
  section title, and empty-or-populated lineage lists

Richer cross-unit hierarchies are still incremental
work, but the persisted schema now carries lineage
slots instead of omitting them entirely.

## Dependencies

- DS010 — persistence
- DS018 — unit extraction
- DS023 — KB plugins
- DS026 — repository/workspace semantics
