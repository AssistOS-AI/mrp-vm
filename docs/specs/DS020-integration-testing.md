# DS020 — Integration Testing

## Purpose
Defines the executable integration test surface for
the current MRP-VM baseline.

## Test Layers

The project currently distinguishes three layers:

1. deterministic code-level tests
2. live-LLM tests
3. end-to-end evaluation suites

## Deterministic Suite

Command:

```bash
npm test
```

The deterministic suite runs:

```text
test/deterministic/**/*.test.mjs
```

This layer MUST cover:

- CNL validation and parsing
- intent decomposition
- tokenizer and lexical index behavior
- plugin registry invariants
- planner ordering heuristics when deterministic
- planner ranking through the shared planner-stats
  store when deterministic
- session/workspace persistence semantics
- KB repository and draft workflow behavior

Deterministic tests MUST NOT depend on network access
or remote models.

## Live-LLM Suite

Command:

```bash
npm run test:live
```

This layer is allowed to exercise Achilles-backed
behavior and model discovery.

It SHOULD focus on:

- adapter correctness
- prompt/response contract sanity
- failure handling against real providers

## Evaluation Runner

Command:

```bash
npm run eval -- [filters]
```

Default behavior is session-centric: one shared
session per suite, one reusable source load through
`POST /sessions/:id/context`, then all suite
questions through `/chat/completions` with the same
stable `session_id`, with engine-selected plugins.
Explicit workspace source staging is secondary and
should only be enabled when the test is specifically
about workspace / KB ingest behavior. Use
runner-specific flags such as `--matrix` when
comparative plugin-combination coverage is needed.

The evaluation runner uses suite folders under:

```text
test/evaluation/suiteXX/
```

with at least:

- `eval.json`
- a story or knowledge file such as `story.nl`

## Determinism Rule

Planner learning MUST be disableable or effectively
deterministic in test mode.

In the current baseline, this means:

- seeded/default stats are acceptable
- ordering must not depend on nondeterministic clock
  races
- deterministic tests should not rely on mutable live
  provider state

## Compatibility Rule

Typed plugin IDs are the assertion surface for active
runtime tests. Legacy `processing_mode` and
`retrieval_profile` aliases should not be required in
new integration tests.

## Minimum Assertions

Integration tests SHOULD assert:

- success/failure code paths
- returned plugin IDs
- returned / stored `deliberation_level`
- response document shape
- weak-outcome fallback behavior (`insufficient`,
  `no-context`, cross-planner escalation)
- workspace dirty/save/fork semantics
- plugin-private artifact side effects when relevant
- explainability session endpoint shape and per-turn
  execution payload availability

The current deterministic suite includes regression
coverage for:

- dynamic plugin discovery by the built-in planner
- fallback from `gs-plugin` `no-context` to a heavier
  goal solver
- fallback from weak `no-context` plans to a heavier
  planner
- session-level explainability registry exposure from
  committed chat turns
- root-frame deliberation policy initialization and
  graph-node exposure for policy/candidate objects

## Dependencies

- DS013 — API entry points
- DS019 — session behavior
- DS021 — evaluation metrics and suite semantics
