# DS011 — Intent Decomposition

## Purpose
Defines the shared symbolic decomposition step applied
after seed detection and before KB retrieval.

The decomposer turns validated Intent CNL into a
lighter query-oriented structure plus a retrieval
context profile.

## Inputs

The input is the parsed DS004 structure:

```javascript
{
  groupNumber,
  act,
  intent,
  context,
  criterion,
  evidence,
  output
}
```

`act` is assumed valid and mandatory by the time
DS011 runs.

## Main Interface

```javascript
class IntentDecomposer {
  decompose(intentGroups) -> DecomposedIntent[]
  deriveContextProfile(decomposedIntent) -> ContextProfile
}
```

## DecomposedIntent

```javascript
{
  groupNumber: number,
  act: string,
  intent: string,
  target: string,
  criteria: string[],
  evidence: string[],
  explicitContext: string | null,
  outputType: string
}
```

## Decomposition Heuristics

The current baseline implementation is symbolic and
heuristic.

For each intent group it:

1. validates that `act` is present
2. derives `target` by removing the first token from
   the raw intent text
3. splits `criterion` on commas into `criteria[]`
4. splits `evidence` on commas into `evidence[]`
5. forwards `context` as `explicitContext`
6. forwards `output` as `outputType`

Example:

```text
Intent: Compare BM25 and dense retrieval.
```

becomes:

```text
target = "BM25 and dense retrieval"
```

This heuristic is intentionally lightweight. It is
good enough for retrieval query shaping, but it is
not a full semantic parse.

## ContextProfile

```javascript
{
  intentGroupNumber: number,
  neededRoles: string[],
  queryText: string,
  queryTerms: string[],
  actBoost: string,
  maxResults: number
}
```

## Context Profile Derivation

The profile is derived as follows:

- `neededRoles` comes from the canonical
  `ACT_TO_ROLES` mapping in DS004
- `queryText` is the concatenation of:
  - target
  - criteria
  - explicit context
- `queryTerms` are tokenized heuristically from that
  text, lowercased, stripped of punctuation, and
  filtered through the stopword list
- `actBoost` is the original act and is used by the
  lexical backend for role-aware boosting
- `maxResults` is the default retrieval budget per
  intent group

## Design Constraints

- DS011 is shared infrastructure, not a plugin type.
- It must remain deterministic.
- It does not decide final retrieval sufficiency.
- It does not classify acts; it only consumes them.

## Known Limits

- target extraction is only a heuristic
- criteria and evidence splitting is comma-based
- no deep syntax tree is built
- no ontology normalization is attempted here

These limits are acceptable because DS011 exists to
shape retrieval, not to solve the task fully.

## Dependencies

- DS004 — canonical acts and role preferences
- DS006 — normalized intent input
- DS012 — resolved-intent assembly
