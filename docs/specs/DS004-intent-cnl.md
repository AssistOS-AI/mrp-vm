# DS004 — Intent CNL (Controlled Natural Language
# for Intents)

## Purpose
Defines the controlled natural language format used
to express user intents after normalization.

## Description

Intent CNL is the form into which a raw NL request
is transformed after normalization. It is structured
Markdown, easy to read, validate, and process
symbolically.

## Document Structure

A document contains one or more Intent Groups.
Each group corresponds to a distinct intent.

```markdown
## Intent Group 1
Act: compare
Intent: Compare BM25 and dense retrieval
  for lexical search.
Context: CPU-only deployment environment.
Criterion: Fast response time, low memory.
Output: Comparative recommendation.
```

## Fields

| Field     | Required | Description                    |
|-----------|----------|--------------------------------|
| Act       | Yes      | Pragmatic act (from enum)      |
| Intent    | Yes      | The action or question         |
| Context   | No       | Conditions, constraints        |
| Criterion | No       | Evaluation criteria            |
| Evidence  | No       | Observations from input        |
| Output    | Yes      | Expected result type           |

## Act Invariant

`Act` is mandatory in every Intent Group, with no
exceptions.

- An Intent Group without `Act` is invalid.
- The Normalizer must always emit `Act`.
- The Validator must reject any Intent Group that
  omits `Act`.
- The Parser must not produce an `IntentGroup`
  object without `act`.
- Downstream modules (DS011, DS012, DS003, DS017)
  may assume `act` is always present after
  validation.

## Pragmatic Acts (Canonical Enum)

Defined once here, referenced from DS007, DS009,
DS011, DS012:

- `compare` — comparison between entities
- `explain` — causal explanation
- `recommend` — recommendation
- `diagnose` — diagnosis
- `implement` — implementation procedure
- `verify` — constraint verification
- `define` — definition
- `evaluate` — evaluation

The pragmatic act is emitted by the Normalizer
(DS006) based on LLM semantic understanding.
The Validator (DS007) only checks enum membership.

## Canonical Act → Preferred Roles Mapping

Defined once here. All DS files (DS009, DS011,
DS012) reference this table. Can be externalized
to `config/pragmatic-mappings.json`.

| Act         | Preferred Context Roles            |
|-------------|-------------------------------------|
| compare     | Comparison, Evaluation              |
| explain     | Explanation, Diagnostic             |
| recommend   | Comparison, Evaluation, Procedure   |
| diagnose    | Diagnostic, Explanation             |
| implement   | Procedure, Constraint               |
| verify      | Constraint, Definition              |
| define      | Definition, Explanation             |
| evaluate    | Evaluation, Comparison              |

This table is a retrieval preference table, not a
validation schema.

- Missing preferred roles in retrieved evidence is
  not a validation error.
- The table guides retrieval weighting and ranking.
- Unknown Context CNL roles are still invalid and
  must be rejected by DS007.

## Validation Rules

- Heading: `## Intent Group N` with N ascending
  (starting from 1).
- Fields Act, Intent, and Output are required.
- Act must be from the enum above.
- Allowed fields: Act, Intent, Context, Criterion,
  Evidence, Output.
- Unknown fields → validation error.
- Any example or generated document that omits
  `Act` must be treated as invalid, not as an
  alternative abbreviated form.

## Parsing Rules and Edge Cases

### Field:value separator
- The first `:` on a line separates the field name
  from the value. Additional `:` in the value are
  allowed.
- Valid example: `Context: Deploy on CPU: 4 cores.`

### Continuation lines
- A line starting with 2+ spaces is a continuation
  of the preceding field.
- Example:
  ```
  Intent: Compare BM25 and dense retrieval
    for lexical search in production.
  ```

### Group separation
- A blank line between groups is optional but
  recommended.
- A new `## Intent Group N` heading always marks
  a new group.

### Forbidden characters in values
- `##` at the start of a value line (would be
  interpreted as a heading).
- Blank lines inside a field (would be interpreted
  as a group separator).

## Complete Example

```markdown
## Intent Group 1
Act: compare
Intent: Compare BM25 and dense retrieval
  for lexical search.
Context: CPU-only deployment environment.
Criterion: Fast response time, low memory.
Output: Comparative recommendation.

## Intent Group 2
Act: explain
Intent: Explain why latency degrades
  on long documents.
Context: CPU text-processing pipeline.
Evidence: Latency increases as document
  length grows.
Output: Causal explanation.
```

## Invalid Example

The following is invalid and MUST be rejected:

```markdown
## Intent Group 1
Intent: What is the capital of France?
Output: Short factual answer.
```

Reason: missing required field `Act`.

## Related DS Files

- DS006 (Normalizer) — produces Intent CNL,
  including the Act field.
- DS007 (Validator) — validates structure and
  Act enum membership.
- DS011 (Decomposition) — parses and extracts
  internal structures from Intent CNL.
