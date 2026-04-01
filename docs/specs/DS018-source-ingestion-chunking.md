# DS018 — Source Ingestion & KU Tree Extraction

## Purpose
Defines how raw documents become hierarchical
Knowledge Unit (KU) trees for the KB substrate and
how KB plugins receive ingest signals.

## Design Rule

The right storage unit is the smallest stable
meaningful Knowledge Unit, not the file and not an
arbitrary token window.

The system MUST NOT default to one KU per sentence.
It SHOULD group related information at a useful level
of semantic coherence.

## Hierarchical Granularity

For each ingested source, the ingest pipeline SHOULD
produce a hierarchical KU tree with:

- a root summary (`kuType: "aggregate"`)
- 2–3 intermediate levels of abstraction when the
  source material supports it
  (`kuType: "composite"`)
- leaf-level KUs with the most detailed content
  (`kuType: "atomic"`)

Domain-specific examples:

- Literature: scene → chapter → work
- Legal: clause → section → chapter → document
- Procedural: step → procedure → handbook
- Technical: statement group → thematic section →
  full document

### Leaf KU Granularity

A leaf KU SHOULD contain a semantically coherent
block of information. This may be:

- a single sentence when it carries an independent
  symbolic fact or a self-contained claim
- multiple related sentences when they describe the
  same concept, scene, entity, or procedure step

The grouping heuristic should prefer semantic
coherence over mechanical sentence splitting.

### Symbolic Facts in Leaf KUs

When a leaf KU contains a sentence with a detectable
symbolic fact (Subject/Relation/Object), the fact
MUST be extracted and attached to the KU.

If a group of sentences contains multiple independent
symbolic facts, each fact-bearing sentence SHOULD
become its own atomic KU so that symbolic retrieval
(DS025) can operate on individual triples.

### Section Aggregates

Section aggregates are created when a section
(heading, paragraph group, or thematic cluster)
contains multiple leaf KUs. They:

- summarize the section content
- carry `childUnitIds` pointing to their leaf KUs
- carry `kuType: "composite"`

### Source Aggregates

Source aggregates are created when a source has
multiple sections. They:

- summarize the whole source
- carry `childUnitIds` pointing to section aggregates
- carry `kuType: "aggregate"`

### Back-References

Leaf KUs carry `parentUnitIds` back-references to
their containing aggregate. Section aggregates carry
`parentUnitIds` to the source aggregate.

## Ingest Flow

1. Source text enters the workspace.
2. The ingest pipeline chunks the source text.
3. A seed detector normalizes each chunk into
   Context CNL (KU serialization format).
4. The parser produces KU objects from the CNL.
5. The ingest pipeline builds the hierarchical KU
   tree (leaf → section → source aggregates).
6. KUs are stored in the KB substrate.
7. Raw text plus KUs are offered to all enabled
   KB plugins through their `onSourceText` hook.
8. KB plugins may build plugin-private indices or
   derived memory.

## Chunk Safety Rule

Any optimization that keeps a source as a single
chunk MUST still honor the maximum input size
accepted by the active normalization surface
(DS006).

The ingest layer MUST therefore use a downstream-safe
single-chunk ceiling, not an independent guess about
what a model might support in theory. Sources above
that ceiling MUST be chunked before calling
`toContextCNL()`.

## Provenance Surface

For each KU, the ingest pipeline materializes:

```javascript
{
  sourceId,
  sourceName,
  sourceType,
  author,
  ingestedAt,
  knowledgeDate,
  chunkId,
  chunkIndex,
  charStart,
  charEnd,
  chunkType,
  sectionTitle,
  createdAt
}
```

`sourceType` is inferred from the file extension or
content when possible (e.g. `markdown`, `plain-text`,
`literary`, `legal`, `technical`).

`author` is extracted from metadata headers when
available.

## Dependencies

- DS006 — normalization helpers
- DS008 — KU storage
- DS023 — KB plugins
- DS030 — Knowledge Unit model
