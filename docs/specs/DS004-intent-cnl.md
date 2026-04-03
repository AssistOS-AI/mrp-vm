# DS004 — Intent CNL

## Purpose
Defines the intent-control profile within SOP Lang
Control (DS031).

Intent CNL is a small SOP Lang Control document that
describes one or more intent objects admitted by the
core interpreter (DS032).

## Intent Object Contract

Each intent is created with:

```text
@i1 intent <act> "<target>"
```

An intent MUST then receive:

```text
@ix set $i1 output <outputAtom>
```

Optional refinements:

```text
@ix set $i1 context "<context text>"
@ix set $i1 criterion "<criterion text>"
@ix set $i1 evidence "<evidence text>"
@ix constrain $i1 <constraintAtomOrQuotedText>
```

## Field Model

| Semantic field | Required | SOP representation |
|----------------|----------|-------------------|
| `Act` | Yes | `intent <act> "<target>"` |
| `Intent` | Yes | `intent <act> "<target>"` |
| `Context` | No | `set <intentRef> context ...` |
| `Criterion` | No | `set <intentRef> criterion ...` |
| `Evidence` | No | `set <intentRef> evidence ...` |
| `Output` | Yes | `set <intentRef> output ...` |

The old conceptual fields remain part of the design.
Only the serialization changed.

## Act Invariant

Every admitted intent MUST carry a pragmatic act.
The interpreter MUST reject an intent that omits or
invalidly encodes its act.

## Pragmatic Acts (Canonical Enum)

- `compare`
- `explain`
- `recommend`
- `diagnose`
- `implement`
- `verify`
- `define`
- `evaluate`
- `identify`
- `describe`

For yes/no questions or logical deductions, use
`evaluate`.
For "which one" or "name the entity" tasks, use
`identify`.

## Canonical Act -> Preferred Roles Mapping

This table guides retrieval preference and ranking.
It is not itself a validation schema.

| Act | Preferred Context Roles |
|------|-------------------------|
| `compare` | `Comparison`, `Evaluation` |
| `explain` | `Explanation`, `Diagnostic`, `Narrative` |
| `recommend` | `Comparison`, `Evaluation`, `Procedure` |
| `diagnose` | `Diagnostic`, `Explanation` |
| `implement` | `Procedure`, `Constraint` |
| `verify` | `Constraint`, `Definition` |
| `define` | `Definition`, `Explanation` |
| `evaluate` | `Evaluation`, `Comparison`, `Narrative` |
| `identify` | `Narrative`, `Description`, `Definition` |
| `describe` | `Description`, `Narrative`, `Explanation` |

## Validation Rules

- constructor must be `intent <act> "<target>"`
- `act` must be from the enum above
- `output` is required before admission
- `context`, `criterion`, and `evidence` are optional
- `constrain` is additive and may appear multiple
  times
- one document may contain multiple intent objects

## Complete Example

```text
@i1 intent compare "BM25 and dense retrieval for lexical search"
@i2 set $i1 context "CPU-only deployment environment"
@i3 set $i1 criterion "Fast response time and low memory"
@i4 set $i1 output comparative_recommendation

@i5 intent explain "why latency degrades on long documents"
@i6 set $i5 context "CPU text-processing pipeline"
@i7 set $i5 evidence "Latency rises as document length grows"
@i8 set $i5 output causal_explanation
```

## Related DS Files

- DS006 — normalizer helpers
- DS007 — tokenizer/parser/validator contract
- DS011 — decomposition and shared intent helpers
- DS031 — language surface
- DS032 — interpreter semantics
