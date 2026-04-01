# DS030 — Knowledge Unit (KU)

## Purpose

Defines the Knowledge Unit (KU) as the standard
first-class abstraction for representing knowledge
in MRP-VM, both in session/chat-derived memory and
in the persistent Knowledge Base.

## Motivation

The previous baseline used "Context Unit" and
"semantic unit" interchangeably, with no formal
distinction between sentence-level fragments and
semantically coherent knowledge objects. This led to
over-fragmentation during ingest and weak retrieval
for tasks requiring broader context.

The KU replaces those informal terms with a rigorous,
hierarchical model that supports multiple levels of
abstraction and explicit provenance.

## Definition

A Knowledge Unit (KU) is a self-contained,
provenance-bearing knowledge object that represents
a coherent piece of information at a defined level
of abstraction.

A KU may be:

- **atomic** — contains a single coherent piece of
  knowledge (a claim, a fact, a procedure step, a
  constraint)
- **composite** — groups multiple related atomic KUs
  into a thematically coherent unit (a scene, a
  section, a thematic cluster)
- **aggregate** — summarizes a collection of child
  KUs at a higher abstraction level (a chapter
  summary, a source summary)

## KU Structure

Every KU carries the following fields:

### Identity

- `id` — deterministic unique identifier
- `kuType` — `atomic` | `composite` | `aggregate`

### Content

- `title` — short descriptive title (required)
- `role` — pragmatic role from the DS005 enum
- `topic` — dominant subject
- `claim` — main assertion (required unless
  Procedure role)
- `procedure` — procedural steps (required for
  Procedure role; mutually exclusive with `claim`)
- `condition` — conditions or limitations (optional)
- `textBody` — normalized body text (optional,
  may be longer than `claim` for composite KUs)

### Symbolic Facts

- `subject` — canonical symbolic subject (optional)
- `relation` — canonical symbolic relation (optional)
- `object` — canonical symbolic object (optional)
- `confidence` — numeric confidence in `[0, 1]`
  (optional, requires complete symbolic fact block)

An atomic KU MAY carry one symbolic fact triple.
A composite or aggregate KU does not carry symbolic
facts directly; its children do.

### Hierarchy

- `parentUnitIds` — IDs of parent KUs (may be empty
  for root-level KUs)
- `childUnitIds` — IDs of child KUs (empty for
  atomic KUs)
- `derivedFromUnitIds` — IDs of source KUs when
  this KU is a derived memory

### Provenance

- `sourceId` — ID of the original source
- `sourceName` — file name or source name
- `sourceType` — source kind when available
  (e.g. `markdown`, `plain-text`, `legal`,
  `literary`, `technical`, `chat-turn`)
- `author` — author name when detectable (optional)
- `ingestedAt` — timestamp of ingestion into the
  system
- `knowledgeDate` — relevant date of the knowledge
  itself when available (optional)
- `chunkId` — chunk-level provenance reference
- `chunkIndex` — numeric chunk index
- `unitIndex` — numeric unit index within chunk
- `charStart` — start offset in source text
- `charEnd` — end offset in source text

### Utility

- `utilityActs` — list of pragmatic acts served
  (from DS004 enum)
- `phaseScopes` — optional list of plugin phases for
  which this KU is specifically relevant as guidance
- `utilityNote` — free-text explanation (optional)

### Integrity

- `hash` — deterministic content hash for
  deduplication
- `createdAt` — KU creation timestamp

### Structural Hints

- `unitType` — semantic unit kind (e.g.
  `semantic-unit`, `section-aggregate`,
  `source-aggregate`, `scene`, `chapter`,
  `clause`, `procedure-step`)
- `chunkType` — chunk kind from ingest
- `sectionTitle` — enclosing section title

## ID Schema

Deterministic format:

- Leaf/atomic: `<sourceId>::<chunkIndex>::<unitIndex>`
- Section aggregate: `<sourceId>::section-<NNN>`
- Source aggregate: `<sourceId>::source-summary`
- Session-derived: `session::<turnId>::unit-<NNN>`

On source update, all IDs are regenerated.

## Hierarchical Model

For each ingested source, the system SHOULD produce
a hierarchical KU tree:

```text
Source aggregate (root summary)
  ├── Section aggregate (intermediate summary)
  │     ├── Atomic KU (leaf claim/fact)
  │     ├── Atomic KU (leaf claim/fact)
  │     └── Composite KU (grouped related claims)
  ├── Section aggregate
  │     └── ...
  └── ...
```

The general rule is:

- Avoid one KU per sentence unless there is a strong
  reason (e.g. each sentence carries an independent
  symbolic fact).
- Group related information at a useful level of
  semantic coherence.
- Produce 2–3 intermediate levels of abstraction
  when the source material supports it.

Domain-specific examples:

- Literary: scene → chapter → work
- Legal: clause → section → chapter → document
- Procedural: step → procedure → handbook
- Technical: statement group → thematic section →
  full document

## KU in Session Memory

When the `sd-plugin` extracts knowledge from the
current chat turn, it produces session-derived KUs.

Session KUs follow the same structure but carry:

- `sourceType: "chat-turn"`
- `sourceId: "session"`
- minimal provenance (no file offsets)

Session KUs are typically atomic but MAY be composite
when the user provides a block of related context.

They MAY also carry phase-scoping metadata when a
seed detector can distinguish:

- factual retrieval context
- output-shaping instructions
- planning hints
- decomposition hints
- validation rules

## KU in Persistent KB

When a source document is ingested, the ingest
pipeline produces a full hierarchical KU tree.

All KUs are stored in the KB substrate (DS008) and
indexed by KB plugins (DS023).

## Relationship to Context CNL (DS005)

Context CNL remains the serialization format for KUs.
The `## Context Unit <ID>` heading in CNL corresponds
to one KU. The CNL fields map directly to KU fields.

DS005 is updated to reference DS030 as the semantic
model behind the CNL format.

## Relationship to Intent CNL (DS004)

Intent CNL represents extracted intents/tasks, not
knowledge. Intents may be fine-grained (one per
subtask). KUs represent knowledge and should be
grouped at a useful semantic granularity.

The `sd-plugin` produces both:

- Intent CNL (fine-grained task seeds)
- Context CNL / KUs (semantically coherent knowledge)

These two outputs have different granularity goals
by design.

## Context Construction with KUs

When constructing context for task resolution, KB
plugins (DS023) operate over hierarchical KUs:

1. Identify which KUs are relevant to the current
   task
2. Decide at which abstraction level to load them:
   - summary level for broad context
   - intermediate level for moderate detail
   - leaf level for specific evidence
3. If a relevant KU is too large, extract only the
   most relevant child KUs or fragments
4. Assemble the selected KUs into the working context

This replaces the flat "retrieve top-N units" model
with a hierarchical, level-aware selection.

## Dependencies

- DS005 — CNL serialization format
- DS008 — KB storage substrate
- DS018 — ingest produces KU trees
- DS023 — KB plugins retrieve KUs
- DS012 — context matching over KUs
