# DS005 — Context CNL (Controlled Natural Language
# for Knowledge Base)

## Purpose
Defines the controlled natural language format used
to represent knowledge units from the Knowledge Base.

## Description

Context CNL is the form into which KB fragments are
preprocessed and stored. Each raw NL fragment is
transformed into a structured context unit with an
explicit pragmatic role and provenance.

## Context Unit Structure

```markdown
## Context Unit <ID>
SourceId: <sourceId>
ChunkId: <chunkId>
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

## Full Provenance

Each ContextUnit stores internally:

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

- DS008 (KB) — stores Context CNL units.
- DS009 (Indexing) — indexes based on fields.
- DS012 (Retrieval) — matches Intent CNL with
  Context CNL.
- DS006 (Normalizer) — converts NL → Context CNL.
- DS018 (Ingest) — provides chunks and provenance.
