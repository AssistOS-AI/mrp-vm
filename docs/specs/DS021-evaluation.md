# DS021 — Evaluation

## Purpose
Defines the behavioral evaluation layer used to
compare plugin choices and retrieval quality.

## Current Runner

The shipped runner is:

```text
test/evaluation/run.mjs
```

It starts an isolated server, stages suite knowledge
into a temporary workspace, runs one or more
question/strategy combinations, and reports answer
quality plus context quality.

## Suite Layout

Each suite directory contains:

```text
suiteXX/
  eval.json
  story.nl
```

`eval.json` defines:

- suite metadata
- preferred `pluginCombos` entries describing typed
  plugin requests
- optional legacy `modes` / `profiles` only for
  migration coverage
- questions
- expected intent/content/context checks

Preferred combo shape:

```json
{
  "label": "symbolic-thinkingdb",
  "plannerPlugin": "planner-default",
  "seedDetectorPlugin": "sd-symbolic",
  "kbPlugin": "kb-thinkingdb",
  "goalSolverPlugin": "gs-symbolic"
}
```

The runner MAY derive compatibility aliases from
those plugin IDs for reporting. If `pluginCombos`
are absent, it may still expand legacy
`modes × profiles` into compatibility combos.

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

Per combination, the runner reports:

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
- symbolic vs LLM tradeoffs
- expensive-plugin avoidance

## Dependencies

- DS013 — API contract exercised by the runner
- DS017 — response document used for scoring
- DS020 — integration test boundary
