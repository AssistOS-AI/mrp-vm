# DS022 — Seed Detectors and Goal Solvers

## Purpose
Defines the `sd-plugin` and `gs-plugin` families.

## Design Rule

The core MUST NOT select between `symbolic-only` and
`llm-assisted` as hardcoded modes. Those behaviors
must be expressed as plugins.

## Seed Detector Unified Pass

An `sd-plugin` has one seed-detection pass with two
outputs:

1. problem seeds as Intent CNL
2. session knowledge units as Context CNL

The distinction is semantic, not procedural. The
plugin SHOULD analyze the user turn once and produce
both outputs together.

### Problem Seed Extraction (fine-grained)

The plugin detects all distinct problem seeds present
in the input — every meaningful task or subtask that
should be tracked separately. Each seed becomes an
Intent Group in Intent CNL (DS004).

Problem seed extraction MAY be fine-grained: if the
user asks three related questions, each gets its own
Intent Group.

### Session Knowledge Extraction (semantically coherent)

The same seed-detection pass extracts knowledge from
the input and produces Knowledge Units (DS030)
serialized as Context CNL (DS005).

Session knowledge extraction MUST NOT default to
sentence-level fragmentation. It SHOULD group related
information into semantically coherent KUs, even when
a KU spans multiple sentences.

The distinction is explicit:

- **Problem seeds/tasks** may remain relatively
  fine-grained.
- **Knowledge units** should be grouped at a more
  useful semantic granularity.

For LLM-backed implementations, the intended baseline
is one logical LLM call that produces both outputs
together. Two separate LLM prompts for the same user
turn are not the preferred design.

## Built-In Seed Detector Plugins

- `sd-symbolic` — rule-based one-pass extraction
- `sd-llm-fast` — lightweight one-pass LLM seed
  bundle extraction
- `sd-llm-deep` — thorough one-pass LLM seed bundle
  extraction

### Responsibilities of an `sd-plugin`

- normalize the user turn into problem seeds as
  Intent CNL
- extract current-turn/session knowledge as KUs
  during the same detection pass
- stage those KUs for the current session so they can
  be reused during retrieval
- normalize persistent context during ingest
  (KU-oriented, not sentence-oriented)
- report validation or unsupported-input failures

### Session Staging Rule

After `detectSeeds(...)` succeeds, the core MUST
stage the returned current-turn KUs into the current
session before KB retrieval. `kb-plugin`s MUST be
notified so they can update any session-local
structures they maintain.

The staged KUs become durable session context only
after the turn commits successfully.

## Built-In Goal Solver Plugins

- `gs-symbolic` — deterministic, no LLM
- `gs-llm-fast` — lightweight LLM synthesis
- `gs-llm-deep` — thorough LLM synthesis

### Responsibilities of a `gs-plugin`

- consume resolved intents plus optional helper
  plugin output
- produce final grounded Markdown response
- render deterministic `no-context` response when
  configured to do so
- return `needs-decomposition` when the task is too
  broad or complex for direct resolution (DS002)

## Legacy Mapping

- `symbolic-only` → `sd-symbolic` + `gs-symbolic`
- `llm-assisted` → planner chooses among
  `sd-llm-fast`, `sd-llm-deep`, `gs-llm-fast`,
  `gs-llm-deep`

## Selection Semantics

- The planner chooses ordered candidates per stage.
- The user may pin a specific seed detector plugin,
  goal solver plugin, or both.
- A session stores plugin preferences, not a single
  monolithic mode.

## Dependencies

- DS015 — LLM bridge
- DS017 — synthesis semantics used by `gs-plugin`
- DS027 — plugin contracts
- DS028 — model-role settings
- DS029 — planner ordering
- DS030 — Knowledge Unit model
