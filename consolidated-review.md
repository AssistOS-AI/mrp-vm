# consolidated-review.md — Remaining Implementation Backlog

Date: 2026-04-03

Scope: only unresolved work after the shipped
DS031/DS032 interpreter, DS033 foundation,
graph-trace payload, UI deliberation selector,
`mrp-vm-sdk/nlp-util/**`, `mrp-vm-sdk/slc/**`,
interpreter-owned pragmatics enums, deduplicated KB
helpers, and the current green `npm test` /
`npm run eval` / server-boot baseline.

Implemented work is intentionally omitted rather than
retained as history.

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

## P1. Finish DS033 Comparative Runtime Behavior

- [ ] Replace the selected-branch-only finalize path
  in `src/core/engine/engine.mjs` with real
  policy-driven candidate promotion.
  - Promote candidates based on `validationFloor`,
    not only `selectedBranchIds`.
  - Add dominance filtering and candidate
    competitiveness updates.
- [ ] Make planner/runtime proposal generation
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
- [ ] Decide whether comparative deliberation ships
  behind an experimental gate and document downgrade
  behavior.
- [ ] Revisit branch/seed scheduling only where
  necessary to keep multiple families alive and
  preserve `split_from` lineage constraints under
  comparative policies.

## P1. Bring Explainability UI to DS014 / DS034

- [ ] Make the selected turn open graph-first.
  - Move the current user-input / assistant-output
    text blocks below the graph or behind collapsible
    detail panels.
- [ ] Replace the current lane-card layout with a
  real graph canvas.
  - Show directed arrows, visible parent/child frame
    nesting, a compact status legend, and
    selection-centered navigation.
- [ ] Keep frames and plugin executions as the
  primary visible graph objects.
  - Render seeds / results / candidates /
    comparisons / challenges as compact badges,
    overlays, or togglable secondary nodes rather
    than equal-weight standalone cards.
- [ ] Add comparative explainability at the frame
  level.
  - Show `candidateSet`, `comparisonState`, family
    coverage, closure reason, and budget / coverage
    shortfall in the detail surface.
- [ ] Add DS034-oriented UI coverage for graph
  layout, legend, deep linking, and comparative
  inspection.

## P2. Retire Legacy Markdown-CNL as an Active Runtime Contract

- [ ] Shrink `src/core/parser/cnl-validator-parser.mjs`
  to a migration boundary or remove it after
  persisted content and fixtures are migrated.
- [ ] Stop introducing new runtime paths that depend
  on `parseIntentCNL()` / `parseContextCNL()` or
  legacy Markdown sections.
- [ ] Remove remaining legacy seed-bundle and
  `# Intent CNL` / `# Session Context CNL`
  assumptions from
  `src/mrp-vm-sdk/strategies/llm-assisted.mjs`.
- [ ] Verify `src/core/kb/persistence.mjs` and ingest
  flows operate on the final single control-language
  contract.

## P2. Finish SDK Strategy Cleanup

- [ ] Refactor
  `src/mrp-vm-sdk/strategies/symbolic-only.mjs` so
  the remaining sentence grouping, subject
  extraction, and answer-shaping helpers move into
  reusable `nlp-util/**` or synthesis modules where
  stable.
- [ ] Refactor
  `src/mrp-vm-sdk/strategies/llm-assisted.mjs` so
  plugin-facing SLC formatting lives in `slc/**` and
  strategy modules remain orchestration-first.

## P2. Keep Verification and Docs Aligned During the Refactor

- [ ] Preserve green `npm test`, `npm run eval`, and
  real server boot after each phase.
- [ ] Update DS013, DS014, DS019, DS020, DS021,
  DS033, DS034, and the SDK README whenever behavior
  or ownership boundaries change.
