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

Every retrievable unit MUST have:

```javascript
{
  id,
  sourceId,
  unitType,
  textBody,
  provenance,
  parentUnitIds: [],
  childUnitIds: [],
  derivedFromUnitIds: []
}
```

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

The KB MUST preserve at least:

- where a unit came from
- what smaller units it contains or depends on
- what larger units it belongs to

## Dependencies

- DS010 — persistence
- DS018 — unit extraction
- DS023 — KB plugins
- DS026 — repository/workspace semantics
