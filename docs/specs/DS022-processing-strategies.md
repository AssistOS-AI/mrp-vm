# DS022 — Seed Detectors and Goal Solvers

## Purpose
Defines how the old concept of "processing strategy"
is decomposed into two plugin families:

- `sd-plugin` for seed detection
- `gs-plugin` for goal solving

This DS replaces the old first-class notion of
`processing_mode`.

## Design Rule

The core MUST NOT select between `symbolic-only` and
`llm-assisted` as hardcoded modes. Those behaviors
must be expressed as plugins.

## Built-In Seed Detector Plugins

- `sd-symbolic`
- `sd-llm-fast`
- `sd-llm-deep`

### Responsibilities of an `sd-plugin`

- normalize user request into Intent CNL
- extract current-turn/session context seeds
- normalize persistent context during ingest
- report validation or unsupported-input failures

## Built-In Goal Solver Plugins

- `gs-symbolic`
- `gs-llm-fast`
- `gs-llm-deep`

### Responsibilities of a `gs-plugin`

- consume resolved intents plus optional helper
  plugin output
- produce final grounded Markdown response
- render deterministic `no-context` response when
  configured to do so

## Legacy Mapping

- `symbolic-only` -> `sd-symbolic` + `gs-symbolic`
- `llm-assisted` -> planner chooses among
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
