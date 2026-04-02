# DS007 — CNL Validator & Parser

## Purpose
Validates and parses CNL Markdown documents (both
Intent CNL and Context CNL). Fully symbolic — does
not use LLM.

## Separate Responsibilities

Three distinct functions, implemented separately:

1. **Structural validation** — checks Markdown
   conformance with CNL rules.
2. **Parsing** — transforms the validated document
   into an internal data structure.
3. **Enum verification** — checks that Act and Role
   values belong to the canonical enums from DS004
   and DS005.

Pragmatic act classification is NOT done here.
The act is emitted by the Normalizer (DS006) and
only verified by the Validator.

Implementation invariant:
- after successful `validateIntentCNL`, every parsed
  `IntentGroup` must contain `act`
- `parseIntentCNL` must never return an `IntentGroup`
  with missing `act`
- if parser is called directly on malformed input
  that omits `Act`, it must fail, not synthesize a
  default act

## Main Interface

```javascript
class CNLValidator {
  validateIntentCNL(markdown) → ValidationResult
  validateContextCNL(markdown) → ValidationResult
}

class CNLParser {
  parseIntentCNL(markdown) → IntentGroup[]
  parseContextCNL(markdown) → ContextUnit[]
}
```

## ValidationResult

```javascript
{
  valid: boolean,
  errors: [{
    code: "MISSING_REQUIRED_FIELD",
    line: 3,
    column: 1,
    field: "Act",
    message: "Required field 'Act' is missing
      in Intent Group 1"
  }]
}
```

Validator error codes:
- `MISSING_REQUIRED_FIELD`
- `UNKNOWN_FIELD`
- `INVALID_HEADING_FORMAT`
- `INVALID_GROUP_NUMBER`
- `INVALID_ACT_VALUE`
- `INVALID_ROLE_VALUE`
- `INVALID_RELATION_VALUE`
- `INVALID_CONFIDENCE_VALUE`
- `INCOMPLETE_SYMBOLIC_FACT`
- `CLAIM_AND_PROCEDURE_CONFLICT`
- `MISSING_CLAIM_FOR_ROLE`
- `MISSING_PROCEDURE_FOR_ROLE`
- `MALFORMED_LINE`

## IntentGroup (Internal Structure)

```javascript
{
  groupNumber: number,
  act: string,
  intent: string,
  context: string | null,
  criterion: string | null,
  evidence: string | null,
  output: string
}
```

`act` is required in this internal structure.

## ContextUnit (Internal Structure)

```javascript
{
  id: string,
  kuType: string | null,
  title: string | null,
  sourceId: string,
  sourceName: string | null,
  sourceType: string | null,
  author: string | null,
  ingestedAt: string | null,
  knowledgeDate: string | null,
  chunkId: string,
  chunkIndex: number | null,
  unitIndex: number | null,
  unitType: string | null,
  textBody: string | null,
  role: string,
  topic: string,
  claim: string | null,
  condition: string | null,
  procedure: string | null,
  subject: string | null,
  relation: string | null,
  object: string | null,
  confidence: number | null,
  utilityActs: string[],
  utilityNote: string | null,
  hash: string | null,
  parentUnitIds: string[],
  childUnitIds: string[],
  derivedFromUnitIds: string[],
  charStart: number | null,
  charEnd: number | null,
  createdAt: string | null,
  chunkType: string | null,
  sectionTitle: string | null
}
```

## Intent CNL Validation Rules

- Heading: `## Intent Group N` with N ascending
  starting from 1.
- Required fields: Act, Intent, Output.
- Allowed fields: Act, Intent, Context, Criterion,
  Evidence, Output.
- Act must be from the DS004 enum.
- Unknown fields → `UNKNOWN_FIELD`.
- Continuation lines (2+ space indent) are
  concatenated to the preceding field.
- Missing `Act` → `MISSING_REQUIRED_FIELD`.
- Empty `Act:` value → `INVALID_ACT_VALUE`.

## Context CNL Validation Rules

- Heading: `## Context Unit <ID>`.
- Required fields: SourceId, ChunkId, Role,
  Topic.
- Allowed fields: SourceId, ChunkId, KUType, Title,
  Role, Topic, Claim, Condition, Procedure, Subject,
  Relation, Object, Confidence, UtilityActs,
  UtilityNote, Hash, SourceName, SourceType, Author,
  IngestedAt, KnowledgeDate, ChunkIndex, UnitIndex,
  UnitType, TextBody, ParentUnitIds, ChildUnitIds,
  DerivedFromUnitIds, CharStart, CharEnd, CreatedAt,
  ChunkType, SectionTitle.
- Claim required if Role ≠ Procedure.
- Procedure required if Role = Procedure.
- Claim and Procedure cannot coexist →
  `CLAIM_AND_PROCEDURE_CONFLICT`.
- Role must be from the DS005 enum.
- UtilityActs, when present, is a CSV of acts from
  the DS004 enum.
- If UtilityActs is absent, the parser MUST derive a
  default list from Role using the canonical mapping:
  - Comparison -> compare
  - Explanation -> explain
  - Procedure -> implement
  - Definition -> define
  - Evaluation -> evaluate
  - Diagnostic -> diagnose
  - Constraint -> verify
  - Narrative -> explain, describe
  - Description -> describe
- `Subject`, `Relation`, and `Object` are optional
  as a single block. Partial symbolic facts are
  rejected with `INCOMPLETE_SYMBOLIC_FACT`.
- `Relation` must belong to the runtime symbolic
  relation vocabulary.
- `Confidence`, when present, must be numeric in
  `[0, 1]`.
- Unknown `Role` is a hard validation error
  (`INVALID_ROLE_VALUE`), not a warning.
- DS007 does not infer or auto-correct roles.

## Common Parsing Rules

- First `:` on a line separates field from value.
- Continuation lines: 2+ leading spaces →
  concatenated to the preceding field with a space.
- Blank lines separate groups/units.
- `##` at the start of a value line →
  `MALFORMED_LINE` error.

## Dependencies

- DS004 (Intent CNL) — act enum, format.
- DS005 (Context CNL) — role enum, format.
