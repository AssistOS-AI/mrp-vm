# DS021 — Evaluation

## Purpose
Defines the behavioral evaluation layer used to
compare plugin choices and retrieval quality.

## Current Runner

The shipped runner is:

```text
test/evaluation/run.mjs
```

It starts an isolated server and exercises the
canonical conversational path by default.

In default mode:

- one session is created per suite
- the suite story is loaded once through
  `POST /sessions/:id/context`
- the same stable `session_id` is reused for all
  later questions in that suite
- all suite questions are sent through
  `/chat/completions`
- plugin selection is left to the engine unless the
  caller explicitly requests matrix mode

This is the preferred evaluation path because it
matches the canonical session-backed API usage:
session creation, explicit reusable context load, and
later question answering through chat.

The runner MAY also support:

- an explicit matrix mode that expands
  `pluginCombos` for comparative runs
- an explicit workspace-ingest path for suites that
  intentionally need staged KB/workspace sources

Workspace source staging is secondary. It SHOULD NOT
be treated as the default conversational evaluation
path.

## Suite Layout

Each suite directory contains:

```text
suiteXX/
  eval.json
  story.nl
```

`eval.json` defines:

- suite metadata
- optional `pluginCombos` entries describing typed
  plugin requests for matrix mode
- optional legacy `modes` / `profiles` only for
  migration coverage
- questions
- expected intent/content/context checks

Preferred combo shape for matrix mode:

```json
{
  "label": "symbolic-thinkingdb",
  "plannerPlugin": "planner-default",
  "seedDetectorPlugin": "sd-symbolic",
  "kbPlugin": "kb-thinkingdb",
  "goalSolverPlugin": "gs-symbolic"
}
```

When matrix mode is enabled, the runner MAY derive
compatibility aliases from those plugin IDs for
reporting. If `pluginCombos` are absent, it may still
expand legacy `modes × profiles` into compatibility
combos.

## Recorded Runtime Surface

Suites SHOULD record or preserve:

- requested combo surface
- planner plugin used
- seed detector plugin used
- KB plugin used
- goal solver plugin used
- LLM role assignments used
- response document returned by the API

The runner MAY still accept legacy compatibility
aliases such as `processing_mode` and
`retrieval_profile` during migration, but plugin IDs
remain the preferred reporting and filtering surface.

## Metrics

The current baseline computes three families of
signals.

### Answer pass rate

A question passes the answer dimension when:

- expected intents are matched
- required answer mentions are present
- forbidden answer mentions are absent

### Context pass rate

A question passes the context dimension when:

- expected context mentions are present in retrieved
  or rendered context
- forbidden context mentions are absent

### Context quality

The runner computes:

- recall
- precision
- F1

using:

```text
recall =
  1 - missingRequiredMentions / requiredMentions

precision =
  1 - unwantedMentionsFound / forbiddenMentions
```

The suite-level reported context score is the average
question F1.

## Evaluation Output

Per default suite run, and per combination in matrix
mode, the runner reports:

- delivery path used for the suite
- total passed / failed
- answer-pass count
- context-pass count
- average context F1
- per-question failures

## Intended Use

DS021 is for comparative behavior assessment, not for
strict protocol validation.

Use DS020 when testing contract correctness.
Use DS021 when comparing:

- planner choices
- KB plugin quality
- session-based conversational behavior
- symbolic vs LLM tradeoffs after the normal chat
  path has selected them
- expensive-plugin avoidance

## Dependencies

- DS013 — API contract exercised by the runner
- DS017 — response document used for scoring
- DS020 — integration test boundary
