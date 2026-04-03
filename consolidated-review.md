# consolidated-review.md — Remaining Implementation Backlog

Date: 2026-04-03
Scope: remaining implementation work required to
align runtime behavior with the active DS set.

This file tracks only open work. Completed work is
removed rather than retained as history.

## 1. SOP Interpreter in Core

- [ ] Create the `src/core/interpreter/**`
  subsystem as the canonical home for SOP Lang
  Control tokenization, parsing, validation,
  interpretation, and interpreter-specific errors.
- [ ] Implement deterministic tokenization for SOP
  statements, references, quoted strings, and lists.
- [ ] Implement statement parsing with source
  positions for diagnostics.
- [ ] Implement command-signature validation for all
  constructors, `set`, relation commands, and status
  commands defined in DS031.
- [ ] Implement field validation for `set`, keyed by
  object kind, as defined in DS031/DS005.
- [ ] Implement semantic interpretation that emits
  typed intent, seed, subproblem, plugin, KU,
  validation, branch, and result objects.
- [ ] Implement structured interpreter errors for
  malformed syntax, duplicate ids, invalid fields,
  unresolved references, missing required fields,
  and semantic conflicts.

## 2. Migrate Seed and KU Flows to SOP

- [ ] Update `sd-plugin` implementations to emit SOP
  Lang Control in `intentCNL` and
  `currentTurnContextCNL`.
- [ ] Update persistent-context normalization to
  emit SOP-based KU metadata shells rather than the
  legacy Markdown block format.
- [ ] Remove runtime dependence on
  `parseIntentCNL()` and `parseContextCNL()` from
  the legacy Markdown parser path once the
  interpreter is in place.
- [ ] Align seed-detector prompts, examples, and
  validation retries with the DS031 command syntax.

## 3. Frame Runtime and Branch Scheduling

- [ ] Introduce explicit `ExecutionFrame` and
  `BranchAttempt` runtime structures matching DS002
  and DS032.
- [ ] Materialize branch creation from admitted
  intent/seed/plugin objects rather than implicit
  stage-local loops.
- [ ] Implement bounded parallel execution for
  independent runnable seeds.
- [ ] Implement `split_from`-aware seed scheduling so
  derived seeds respect lineage constraints.
- [ ] Implement frame-local failure memory keyed by
  seed, plugin, and evidence profile.
- [ ] Implement backtracking over plugin candidates,
  knowledge views, decomposition branches, and
  validation rejection without collapsing to a
  linear retry loop.
- [ ] Route child-frame creation through explicit
  subproblem and branch records.

## 4. Execution Trace and Explainability DAG

- [ ] Replace the current flat/partial
  `executionTrace` model with a canonical DAG that
  records frames, seeds, branches, plugin attempts,
  results, and failures.
- [ ] Emit stable ids and typed edges so the UI can
  render parent/child frame relationships, parallel
  seed paths, and backtracking.
- [ ] Update planner outcome recording to consume the
  DAG trace rather than only flat stage summaries.
- [ ] Update `GET /sessions/:id/explainability` and
  related server serialization to expose the DAG
  trace cleanly.
- [ ] Update the explainability UI to render the DAG
  rather than a linear execution list.

## 5. Documentation and Surface Alignment

- [ ] Align `docs/index.html` with the active DS
  story around SOP Lang Control,
  `src/core/interpreter/**`, recursive frames, and
  DAG explainability.
- [ ] Align linked overview pages
  (`docs/concepts/cnl-formats.html`,
  `docs/overview/PIPELINE.html`,
  `docs/overview/ARCH-VM.html`) with DS031 and
  DS032.
- [ ] Update any remaining DS documents that still
  describe seed or KU control payloads as Markdown
  heading blocks instead of SOP statements.
- [ ] Update code comments and developer-facing notes
  that still refer to the legacy sequential
  Markdown-CNL pipeline.

## 6. Test and Evaluation Coverage

- [ ] Add unit tests for SOP tokenization, parsing,
  validation, and interpretation.
- [ ] Add fixture coverage for valid and invalid
  intent documents, KU documents, mixed control
  documents, and branch/result records.
- [ ] Add integration coverage for session staging,
  child-frame creation, backtracking, and bounded
  parallel seed execution.
- [ ] Re-run evaluation suites after the migration
  and update failing fixtures to the SOP syntax
  where required.
