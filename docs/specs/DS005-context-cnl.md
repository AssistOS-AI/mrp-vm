# DS005 — Context CNL

## Purpose
Defines the KU metadata-control profile within SOP
Lang Control (DS031).

Context CNL is the serialization format for the
metadata shell of Knowledge Units (DS030). It does
not force the KU body into a universal symbolic
representation. It only normalizes the control
surface needed for routing, filtering, compatibility
matching, and provenance.

## Context Unit Structure

Each KU metadata shell starts with:

```text
@k1 ku <atomic|composite|aggregate> "<kuId>"
```

Required assignments:

```text
@kx set $k1 sourceId <sourceIdAtom>
@kx set $k1 chunkId <chunkIdAtom>
@kx set $k1 role <RoleEnum>
@kx set $k1 topic "<topic text>"
```

Then exactly one of:

```text
@kx set $k1 claim "<claim text>"
@kx set $k1 procedure "<procedure text>"
```

Optional relations:

```text
@kx parent $k1 $parentKu
@kx derived_from $k1 $sourceKu
```

## Field Model

| Field | Required | SOP representation |
|-------|----------|-------------------|
| `SourceId` | Yes | `set <kuRef> sourceId ...` |
| `ChunkId` | Yes | `set <kuRef> chunkId ...` |
| `KUType` | Yes | `ku <kuType> "<kuId>"` |
| `Title` | No | `set <kuRef> title ...` |
| `Role` | Yes | `set <kuRef> role ...` |
| `Topic` | Yes | `set <kuRef> topic ...` |
| `Claim` | Yes* | `set <kuRef> claim ...` |
| `Condition` | No | `set <kuRef> condition ...` |
| `Procedure` | Yes* | `set <kuRef> procedure ...` |
| `UtilityActs` | No | `set <kuRef> utilityActs [..]` |
| `UtilityNote` | No | `set <kuRef> utilityNote ...` |
| `PhaseScopes` | No | `set <kuRef> phaseScopes [..]` |
| `Hash` | No | `set <kuRef> hash ...` |
| `SourceName` | No | `set <kuRef> sourceName ...` |
| `SourceType` | No | `set <kuRef> sourceType ...` |
| `Author` | No | `set <kuRef> author ...` |
| `IngestedAt` | No | `set <kuRef> ingestedAt ...` |
| `KnowledgeDate` | No | `set <kuRef> knowledgeDate ...` |
| `ChunkIndex` | No | `set <kuRef> chunkIndex ...` |
| `UnitIndex` | No | `set <kuRef> unitIndex ...` |
| `UnitType` | No | `set <kuRef> unitType ...` |
| `TextBody` | No | `set <kuRef> textBody ...` |
| `CharStart` | No | `set <kuRef> charStart ...` |
| `CharEnd` | No | `set <kuRef> charEnd ...` |
| `CreatedAt` | No | `set <kuRef> createdAt ...` |
| `ChunkType` | No | `set <kuRef> chunkType ...` |
| `SectionTitle` | No | `set <kuRef> sectionTitle ...` |

*`claim` is required unless role is `Procedure`.
`procedure` is required only for role `Procedure`.
The two are mutually exclusive.

## ID Schema

Deterministic format:

`<sourceId>::<chunkIndex>::<unitIndex>`

Example:

`src-001::chunk-002::unit-000`

## Pragmatic Roles (Canonical Enum)

- `Comparison`
- `Explanation`
- `Procedure`
- `Definition`
- `Evaluation`
- `Diagnostic`
- `Constraint`
- `Narrative`
- `Description`

## UtilityActs

`utilityActs` is a list of pragmatic acts from the
DS004 enum.

Example:

```text
@k7 set $k1 utilityActs [compare recommend]
```

If `utilityActs` is omitted, the interpreter derives
it from the role using the canonical mapping:

- `Comparison` -> `compare`
- `Explanation` -> `explain`
- `Procedure` -> `implement`
- `Definition` -> `define`
- `Evaluation` -> `evaluate`
- `Diagnostic` -> `diagnose`
- `Constraint` -> `verify`
- `Narrative` -> `explain`, `describe`
- `Description` -> `describe`

## PhaseScopes

`phaseScopes` is an optional list describing which
plugin phases should treat the KU as guidance.

Allowed atoms:

- `sd-plugin`
- `mrp-plan-plugin`
- `kb-plugin`
- `gs-plugin`
- `frame`
- `val-plugin`

When omitted, the default is:

```text
[kb-plugin]
```

## Optional Symbolic Fact Block

Context CNL MAY embed one normalized symbolic fact
through:

- `symbolicSubject`
- `symbolicRelation`
- `symbolicObject`
- `confidence`

The symbolic block is all-or-nothing.
`confidence` is legal only when the full triple is
present.

Allowed relation atoms include:

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

## Complete Example

```text
@k1 ku atomic "src-001::chunk-000::unit-000"
@k2 set $k1 sourceId src-001
@k3 set $k1 chunkId src-001::chunk-000
@k4 set $k1 role Explanation
@k5 set $k1 topic "AchillesIDE and secure execution"
@k6 set $k1 claim "AchillesIDE uses Ploinky."
@k7 set $k1 utilityActs [explain verify]
@k8 set $k1 symbolicSubject AchillesIDE
@k9 set $k1 symbolicRelation uses
@k10 set $k1 symbolicObject Ploinky
@k11 set $k1 confidence 0.90
```

## Dependencies

- DS004 — pragmatic act enum
- DS007 — tokenizer/parser/validator contract
- DS030 — Knowledge Unit semantic model
- DS031 — language surface
- DS032 — interpreter semantics
