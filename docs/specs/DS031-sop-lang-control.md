# DS031 — SOP Lang Control

## Purpose
Defines the textual control language used for
runtime-critical objects in MRP-VM.

SOP Lang Control is the selective CNL membrane of
the system. It is used only where the runtime needs
deterministic structure:

- intents
- seeds
- subproblems
- plugin descriptors
- KU metadata shells
- validation targets
- branch/result records

This document defines the surface syntax, command
catalog, and well-formedness rules of the language.
DS032 defines how the core interpreter admits these
statements into frame state and execution traces.

## Design Boundary

SOP Lang Control is not:

- a universal representation for all knowledge
- a replacement for rich natural-language KU bodies
- a proof language
- a deep ontology language

The body of a Knowledge Unit may remain ordinary
natural language, code, or another convenient form.
Only the control shell is normalized into SOP Lang
Control.

## Statement Model

A control document is an ordered sequence of
statements.

Each statement occupies one logical line:

```text
@id command arg1 arg2 ...
```

The first token declares the statement id.
The second token is the command.
Remaining tokens are arguments.

The language uses a constructor-plus-refinement
model:

- constructor commands create typed objects
- `set` assigns scalar or list fields to an object
- relation commands connect objects
- status commands record lifecycle transitions

Constructors MUST appear before any `set`,
relation, or status statement that references the
created object. Forward references are not part of
the required language contract.

## Lexical Rules

### Statement ids

- every statement id starts with `@`
- ids use ASCII letters, digits, `_`, `-`, or `:`
- ids are unique within one document

### References

Object references start with `$` and point to the
statement id of a previously declared constructor:

```text
$i1
$k12
```

### Atoms

Atoms are unquoted single tokens without whitespace.
They are used for enums, statuses, plugin ids, and
compact identifiers.

Examples:

- `compare`
- `kb-plugin`
- `runtime_control`
- `source_grounded`

### Quoted strings

Free text MUST be quoted.

Example:

```text
"CPU-only deployment environment"
```

Escaping rules follow normal backslash escaping for
quotes inside strings.

### Lists

Lists use square brackets:

```text
[compare recommend]
[kb-plugin gs-plugin]
```

Each list item is an atom or a reference. Free text
must remain quoted outside the list rather than as a
multi-word list item.

## Constructor Commands

The interpreter MUST support the following
constructors.

| Command | Signature | Meaning |
|---------|-----------|---------|
| `intent` | `intent <act> "<target>"` | Creates one intent object. |
| `seed` | `seed <intentRef> <mode> <action> "<focus>"` | Creates one operational seed for an intent. |
| `subproblem` | `subproblem <intentRef> "<goal>"` | Creates one explicit recursive subproblem. |
| `plugin` | `plugin <pluginType> <pluginId>` | Declares one planner-visible plugin descriptor. |
| `ku` | `ku <kuType> "<kuId>"` | Creates one KU metadata shell. |
| `validate` | `validate <mode>` | Creates one validation target. |
| `branch` | `branch <intentRef> <seedRef> <pluginRef>` | Creates one execution attempt record. |
| `result_record` | `result_record <kind>` | Creates one result object. |

## Assignment Command

### `set`

Signature:

```text
set <objectRef> <fieldName> <value>
```

`set` is the canonical way to attach scalar or list
fields to an existing object. The interpreter MUST
validate that each field is legal for the referenced
object kind.

### Allowed intent fields

- `context`
- `criterion`
- `evidence`
- `output`
- `outputLabel`

### Allowed seed fields

- `domain`
- `evidenceNeed`
- `state`
- `priority`

### Allowed subproblem fields

- `reason`
- `successSignal`

### Allowed plugin fields

- `name`
- `description`
- `acceptsTasks`
- `acceptsModes`
- `acceptsKinds`
- `acceptsStatuses`
- `rejectsKinds`
- `rejectsRules`
- `outputs`
- `validates`
- `cost`

### Allowed KU fields

- `title`
- `role`
- `topic`
- `claim`
- `procedure`
- `condition`
- `sourceId`
- `chunkId`
- `utilityActs`
- `utilityNote`
- `phaseScopes`
- `symbolicSubject`
- `symbolicRelation`
- `symbolicObject`
- `confidence`
- `hash`
- `sourceName`
- `sourceType`
- `author`
- `ingestedAt`
- `knowledgeDate`
- `chunkIndex`
- `unitIndex`
- `unitType`
- `textBody`
- `charStart`
- `charEnd`
- `createdAt`
- `chunkType`
- `sectionTitle`

### Allowed validation fields

- `strength`
- `partialAllowed`
- `preserveConstraints`

### Allowed branch fields

- `status`
- `failureReason`

### Allowed result fields

- `validationStatus`
- `preservesConstraints`
- `structuralComplete`
- `body`

## Relation Commands

The interpreter MUST support the following relation
commands:

| Command | Signature | Meaning |
|---------|-----------|---------|
| `constrain` | `constrain <objectRef> <constraint>` | Adds one constraint atom or quoted rule. |
| `allows` | `allows <subproblemRef> <regime>` | Declares an allowed solving regime. |
| `needs` | `needs <branchRef> <validationRef>` | Attaches a validation target to a branch. |
| `uses` | `uses <branchRef> <kuRef>` | Records KU usage by a branch. |
| `supports` | `supports <resultRef> <kuRef>` | Records evidence support for a result. |
| `describes` | `describes <kuRef> <pluginRef>` | Links a KU metadata shell to a plugin descriptor. |
| `parent` | `parent <kuRef> <parentKuRef>` | Declares KU hierarchy. |
| `derived_from` | `derived_from <kuRef> <sourceKuRef>` | Declares derived-memory lineage. |
| `split_from` | `split_from <seedRef> <parentSeedRef>` | Declares seed lineage for decomposition. |
| `result` | `result <branchRef> <resultRef>` | Links a branch to its result record. |

## Status Commands

The interpreter MUST support the following status
commands:

| Command | Signature | Meaning |
|---------|-----------|---------|
| `status` | `status <objectRef> <state>` | Sets an explicit lifecycle state. |
| `fail` | `fail <branchRef> <reason>` | Marks a branch as failed. |
| `deactivate` | `deactivate <seedRef> <reason>` | Removes a seed from scheduling. |

## Object Profiles

### Intent profile

An admitted intent object MUST have:

- constructor `intent <act> "<target>"`
- `output` assigned through `set`

Optional additions:

- `context`
- `criterion`
- `evidence`
- one or more `constrain` statements

The canonical pragmatic act enum is defined in
DS004.

### Seed profile

A seed belongs to exactly one intent.

Recommended fields:

- constructor `seed <intentRef> <mode> <action> "<focus>"`
- `domain`
- `evidenceNeed`
- `state`

`split_from` declares that a seed comes from an
earlier seed and may inherit planner context.

### Subproblem profile

A subproblem refines one parent intent and records:

- `reason`
- `successSignal`
- allowed regimes through `allows`
- optional constraints through `constrain`

### Plugin descriptor profile

Planner-visible plugins are described as small,
typed objects. The constructor records type and id.
Capabilities and refusals are attached through
`set`.

### KU metadata profile

A KU metadata shell MUST use the `ku` constructor
plus required KU fields from DS005:

- `sourceId`
- `chunkId`
- `role`
- `topic`
- exactly one of `claim` or `procedure`

Optional lineage is expressed through `parent` and
`derived_from`.

The KU body may remain in `textBody` or in a
separate external body store. SOP Lang Control does
not require that rich knowledge be reduced to atoms.

### Validation profile

A validation object MUST declare:

- constructor `validate <mode>`
- `strength`
- `partialAllowed`
- `preserveConstraints`

### Branch/result profile

A branch records one concrete attempt:

- one intent
- one seed
- one plugin
- one validation target through `needs`
- zero or more KU links through `uses`

A result record captures the branch outcome and
evidence support.

## Well-Formedness Rules

- every referenced object MUST already exist
- duplicate statement ids are invalid
- duplicate constructor ids are invalid
- unknown commands are invalid
- unknown `set` fields for an object kind are invalid
- free text MUST be quoted
- an intent without `output` is invalid
- a KU without `sourceId`, `chunkId`, `role`, or
  `topic` is invalid
- a KU cannot carry both `claim` and `procedure`
- `confidence` is valid only when
  `symbolicSubject`, `symbolicRelation`, and
  `symbolicObject` are all present
- when `utilityActs` is omitted, the interpreter
  derives it from KU role using DS005
- when `phaseScopes` is omitted, the default is
  `kb-plugin`
- a deactivated seed is not schedulable
- a failed branch remains in trace state and is not
  silently discarded

## Intent Example

```text
@i1 intent compare "BM25 and dense retrieval for lexical search"
@i2 set $i1 context "CPU-only deployment environment"
@i3 set $i1 criterion "Fast response time and low memory"
@i4 set $i1 output comparative_recommendation
@i5 constrain $i1 self_contained

@s1 seed $i1 explore locate "retrieval tradeoffs"
@s2 set $s1 domain runtime_control
@s3 set $s1 evidenceNeed structural
@s4 set $s1 state active
```

## KU Metadata Example

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

- DS004 — intent semantics and pragmatic act enum
- DS005 — KU metadata semantics and role enum
- DS030 — Knowledge Unit model
- DS032 — interpreter semantics and frame admission
