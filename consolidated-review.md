# consolidated-review.md — Remaining Implementation Backlog

Date: 2026-04-03

Scope: only unresolved work after the shipped
interpreter/SLC foundation, explainability graph
canvas, DS033 comparative baseline, explicit SDK
helper families for seed detection / context
normalization / response rendering, and the
restored green `npm test` /
`npm run eval` / server boot baseline.

Implemented work is intentionally omitted rather than
retained as history.

## P1. Break the Remaining Monoliths

- [ ] Split `src/core/engine/engine.mjs` into focused
  runtime helpers until the main engine file drops
  under the repository target size ceiling.
  - Extract candidate-promotion / comparison-state
    helpers first.
  - Extract request-surface / planner-routing /
    frame-finalization helpers next.
- [ ] Split `test/deterministic/core.test.mjs` by
  runtime concern.
  - Separate engine policy tests, planner-routing
    tests, and budget / retry behavior into distinct
    files.
- [ ] Continue the new explicit SDK helper split for
  rule-based SOP processing.
  - Keep the active helper surface in
    `seed-detection/**`, `context-normalization/**`,
    and `response-rendering/**`.
  - Keep any remaining `modes/**` code as internal
    compatibility only until it can be retired.
  - Move remaining prompt segmentation / grouping
    helpers into dedicated modules where stable.

## P1. Finish Architecture Boundary Follow-Through

- [ ] Move the remaining sentence / paragraph chunking
  heuristics out of `src/core/ingest/source-ingestor.mjs`,
  keeping only provenance, limits, and orchestration
  in core.
- [ ] Split `src/mrp-vm-sdk/knowledge/pragmatics.mjs`
  into narrower modules.
  - Keep plugin-facing act-to-role and phase-scope
    helpers in the SDK.
  - Remove remaining language-contract style exports
    that now belong to
    `src/core/interpreter/pragmatics.mjs`.
  - Rewire consumers such as `src/core/kb/index.mjs`
    to the narrower helper surface.
- [ ] Re-check and update DS006, DS009, DS011,
  DS018, DS031, and DS032 once the final ownership
  model lands.

## P1. Deepen DS033 Comparative Runtime Behavior

- [ ] Replace the remaining selected-branch-oriented
  finalize assumptions in `src/core/engine/engine.mjs`
  with fully policy-driven candidate promotion.
  - Promote candidates based on `validationFloor`,
    not only branch selection.
  - Add dominance filtering and candidate
    competitiveness updates.
- [ ] Make planner/runtime proposal generation more
  family-aware.
  - Respect `minFamilies`, `maxFrontier`, and
    `maxComparisons`.
  - Avoid near-duplicate family expansion while
    relevant families remain unexplored.
  - Emit explicit `compare` and `challenge`
    proposals and support reactivation from
    `suspendedSet`.
- [ ] Implement truthful closure behavior for
  `first_valid`, `best_effort`, `comparative`, and
  `scientific`.
  - Do not auto-close on first success when
    comparative coverage is still open.
  - Return honest partial statuses when budgets end
    before closure.

## P2. Retire Legacy Markdown-CNL as an Active Runtime Contract

- [ ] Shrink `src/core/parser/cnl-validator-parser.mjs`
  to a migration boundary or remove it after
  persisted content and fixtures are migrated.
- [ ] Stop introducing new runtime paths that depend
  on `parseIntentCNL()` / `parseContextCNL()` or
  legacy Markdown sections.
- [ ] Remove remaining legacy seed-bundle and
  `# Intent CNL` / `# Session Context CNL`
  assumptions from the LLM-backed SDK helper
  implementations.
- [ ] Verify `src/core/kb/persistence.mjs` and ingest
  flows operate on the final single control-language
  contract.

## P2. Keep Specs and Docs Aligned

- [ ] Update DS013, DS014, DS019, DS020, DS021,
  DS033, DS034, and the SDK README whenever behavior
  or ownership boundaries change.
- [ ] Sweep architecture docs for lingering SDK
  `strategy` / `mode` terminology where the active
  concept is now explicit helper families.
