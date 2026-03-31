# DS008 — Knowledge Base

## Purpose
Defines the persistent KB substrate used by KB
plugins, organized around hierarchical Knowledge
Units (DS030).

## Storage Model

The KB is natural-language-first and organized around
Knowledge Units (KUs), not raw files and not
fixed-size token slices.

The KB stores:

- hierarchical KU trees per source
- session-derived KUs
- derived textual memory KUs
- provenance metadata
- parent/child relations
- plugin-private artifacts

## KU Registry

The persisted KU shape follows DS030:

```javascript
{
  id,
  kuType,
  title,
  sourceId,
  sourceName,
  sourceType,
  author,
  ingestedAt,
  knowledgeDate,
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

Not every KU source can populate every field, but
this is the baseline persisted shape.

## Hierarchical Structure

For each ingested source, the KB stores a
hierarchical KU tree:

1. **Leaf KUs** (`kuType: "atomic"`) — semantically
   coherent knowledge objects. A leaf KU may contain
   multiple related sentences when they describe the
   same concept, scene, or entity. The system avoids
   one KU per sentence unless each sentence carries
   an independent symbolic fact.

2. **Section aggregates** (`kuType: "composite"`) —
   summaries of a section or thematic group, with
   `childUnitIds` pointing to leaf KUs.

3. **Source aggregates** (`kuType: "aggregate"`) —
   summaries of the whole source, with
   `childUnitIds` pointing to section aggregates.

When the source material supports it, 2–3
intermediate levels of abstraction SHOULD be
produced.

## KB vs Plugins

The KB substrate owns:

- named repository identities
- repository/workspace persistence
- committed KUs
- shared source metadata

KB plugins own:

- retrieval logic
- plugin-private indices
- derived memories/caches
- sufficiency logic
- abstraction-level selection during retrieval

## Required Relations

The baseline preserves:

- where a KU came from (`sourceId`, `chunkId`)
- which chunk it came from with offsets
- its source-level identity and hash
- structural hints: `unitType`, `chunkType`,
  `sectionTitle`
- hierarchical links: `parentUnitIds` and
  `childUnitIds` connecting leaf KUs to section
  aggregates and section aggregates to source
  aggregates
- provenance: `sourceName`, `sourceType`, `author`,
  `ingestedAt`, `knowledgeDate`

KB plugins can traverse these links to expand or
narrow retrieval granularity per question.

## Dependencies

- DS010 — persistence
- DS018 — KU tree extraction
- DS023 — KB plugins
- DS026 — repository/workspace semantics
- DS030 — Knowledge Unit model
