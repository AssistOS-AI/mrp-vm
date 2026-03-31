# DS005 — Context CNL (Controlled Natural Language
# for Knowledge Units)

## Purpose
Defines the controlled natural language format used
to serialize Knowledge Units (DS030) from the
Knowledge Base and session memory.

## Description

Context CNL is the serialization format for Knowledge
Units (KUs). Each raw NL fragment is transformed into
a structured KU with an explicit pragmatic role,
provenance, and hierarchical position.

For chat turns, these KUs are normally emitted
together with Intent CNL from the same seed-detection
pass. They represent contextual knowledge, not
problem seeds or requested actions.

The semantic model behind Context CNL is defined in
DS030. This document defines the Markdown
serialization format and validation rules.

## Context Unit Structure

```markdown
## Context Unit <ID>
SourceId: <sourceId>
ChunkId: <chunkId>
KUType: <atomic | composite | aggregate>
Title: <short descriptive title>
Role: <pragmatic role>
Topic: <dominant subject>
Claim: <main assertion or information>
Condition: <conditions or limitations, optional>
Procedure: <procedural steps, optional>
Subject: <canonical symbolic subject, optional>
Relation: <canonical symbolic relation, optional>
Object: <canonical symbolic object, optional>
Confidence: <0..1 confidence for symbolic fact, optional>
UtilityActs: <list of pragmatic acts served>
UtilityNote: <optional free-text explanation>
Hash: <optional deterministic content hash>
SourceName: <optional source file name>
SourceType: <optional source kind>
Author: <optional author name>
IngestedAt: <optional ingestion timestamp>
KnowledgeDate: <optional knowledge-relevant date>
ChunkIndex: <optional numeric chunk index>
UnitIndex: <optional numeric unit index within chunk>
UnitType: <optional semantic unit kind>
TextBody: <optional normalized body text>
ParentUnitIds: <optional CSV of parent KU IDs>
ChildUnitIds: <optional CSV of child KU IDs>
DerivedFromUnitIds: <optional CSV of source KU IDs>
CharStart: <optional start offset in source text>
CharEnd: <optional end offset in source text>
CreatedAt: <optional unit creation timestamp>
ChunkType: <optional chunk kind emitted by ingest>
SectionTitle: <optional enclosing section title>
```

## Fields

| Field       | Required | Description                        |
|-------------|----------|------------------------------------|
| SourceId    | Yes      | ID of the original source          |
| ChunkId     | Yes      | ID of the chunk                    |
| Role        | Yes      | Pragmatic role (from enum)         |
| Topic       | Yes      | Main subject                       |
| Claim       | Yes*     | Central assertion                  |
| Condition   | No       | Conditions, limitations            |
| Procedure   | Yes*     | Steps (only for Procedure role)    |
| Subject     | No**     | Canonical symbolic fact subject    |
| Relation    | No**     | Canonical symbolic fact relation   |
| Object      | No**     | Canonical symbolic fact object     |
| Confidence  | No***    | Numeric confidence in `[0, 1]`     |
| UtilityActs | No       | Pragmatic acts served (CSV).       |
|             |          | Inferred from Role if absent.      |
| UtilityNote | No       | Free-text explanation              |
| Hash        | No       | Content hash for deduplication     |

*Claim is required for all roles except Procedure.
Procedure is required only for the Procedure role.
A unit CANNOT have both Claim and Procedure.

**`Subject`, `Relation`, and `Object` form a single
optional symbolic fact block. If any of them is
present, all three MUST be present.

***`Confidence` MAY appear only together with a
complete symbolic fact block.

Additional optional provenance and lineage fields may
also appear on persisted KB-derived units:
`SourceName`, `ChunkIndex`, `UnitIndex`, `UnitType`,
`TextBody`, `ParentUnitIds`, `ChildUnitIds`,
`DerivedFromUnitIds`, `CharStart`, `CharEnd`,
`CreatedAt`, `ChunkType`, and `SectionTitle`.

## ID Schema

Deterministic format:
`<sourceId>::<chunkIndex>::<unitIndex>`

Example: `src-001::chunk-002::unit-000`

On source update, all IDs are regenerated.

## Pragmatic Roles (Canonical Enum)

- `Comparison` — compares entities or approaches
- `Explanation` — explains causes or mechanisms
- `Procedure` — describes implementation steps
- `Definition` — defines a concept
- `Evaluation` — qualitative or quantitative eval
- `Diagnostic` — identifies problems and causes
- `Constraint` — expresses a constraint or rule
- `Narrative` — events, actions, and story facts
- `Description` — character traits, locations, and
  settings

## UtilityActs — Structured Format

Instead of free text, UtilityActs is a CSV list
of pragmatic acts from the DS004 enum:

```
UtilityActs: compare, recommend
UtilityNote: Useful when evaluating retrieval
  approaches for constrained environments.
```

This enables structural matching between the
intent's pragmatic act and the context unit's
utility.

## Optional Symbolic Fact Block

Context CNL MAY embed one normalized symbolic fact
inside a unit. This is the only symbolic extension
needed by DS025 `ThinkingDB`.

Allowed relation values are defined by the runtime
symbolic relation vocabulary. In v1, they include:

- `uses`
- `provides`
- `has_capability`
- `depends_on`
- `part_of`
- `instance_of`
- `relevant_for`
- `supports`
- `mentions`
- `about`
- `causes`

When present, the symbolic fields capture a
canonical triple derived from the unit claim or
procedure-free assertion.

## Provenance

The current baseline persists a minimal provenance
surface directly on each unit:

```javascript
{
  id: "src-001::chunk-002::unit-000",
  sourceId: "src-001",
  chunkId: "src-001::chunk-002",
  hash: "<sha256 of claim+role+topic>"
}
```

The design also reserves a richer provenance shape
that the current ingest pipeline now tries to persist
for KB-derived units when that information is
available:

```javascript
{
  id: "src-001::chunk-002::unit-000",
  sourceId: "src-001",
  sourceName: "deployment-guide.md",
  chunkId: "src-001::chunk-002",
  chunkIndex: 2,
  unitIndex: 0,
  charStart: 2800,
  charEnd: 4200,
  createdAt: "2026-03-26T09:00:00Z",
  hash: "<sha256 of claim+role+topic>"
}
```

Those extended fields are expected for KB-ingested
units, but session/current-turn units may still carry
only the minimal provenance subset.

## Parsing Rules and Edge Cases

Same rules as DS004:
- First `:` separates field from value.
- Continuation lines with 2+ spaces indent.
- `##` forbidden in values.
- Blank lines separate units.

## Complete Example

```markdown
## Context Unit src-001::chunk-000::unit-000
SourceId: src-001
ChunkId: src-001::chunk-000
Role: Explanation
Topic: AchillesIDE and secure execution
Claim: AchillesIDE uses Ploinky.
Subject: AchillesIDE
Relation: uses
Object: Ploinky
Confidence: 0.90
UtilityActs: explain, verify
Hash: 6d8f0f7a...

## Context Unit src-001::chunk-001::unit-000
SourceId: src-001
ChunkId: src-001::chunk-001
Role: Procedure
Topic: Retrieval pipeline deployment
Procedure: Build and validate the lexical
  index before enabling reranking.
Condition: CPU-constrained deployment.
UtilityActs: implement
```

## Related DS Files

- DS030 (KU) — semantic model behind Context CNL.
- DS008 (KB) — stores Knowledge Units.
- DS009 (Indexing) — indexes based on fields.
- DS012 (Retrieval) — matches Intent CNL with KUs.
- DS006 (Normalizer) — converts NL → Context CNL.
- DS018 (Ingest) — produces hierarchical KU trees.
