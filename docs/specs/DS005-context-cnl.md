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
UtilityActs: <list of pragmatic acts served>
UtilityNote: <optional free-text explanation>
```

## Fields

| Field       | Required | Description                     |
|-------------|----------|---------------------------------|
| SourceId    | Yes      | ID of the original source       |
| ChunkId     | Yes      | ID of the chunk                 |
| Role        | Yes      | Pragmatic role (from enum)      |
| Topic       | Yes      | Main subject                    |
| Claim       | Yes*     | Central assertion               |
| Condition   | No       | Conditions, limitations         |
| Procedure   | Yes*     | Steps (only for Procedure role) |
| UtilityActs | Yes      | Pragmatic acts served (CSV)     |
| UtilityNote | No       | Free-text explanation           |

*Claim is required for all roles except Procedure.
Procedure is required only for the Procedure role.
A unit CANNOT have both Claim and Procedure.

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
Role: Comparison
Topic: BM25 and dense retrieval
Claim: BM25 has lower CPU cost in lexical
  retrieval settings.
Condition: CPU-only deployment.
UtilityActs: compare, recommend
UtilityNote: Useful when evaluating retrieval
  approaches for constrained environments.

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
