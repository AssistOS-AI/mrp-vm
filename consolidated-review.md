# consolidated-review.md — Implementation Status

Date: 2026-04-03
Scope: spec/code alignment around selective SOP,
execution tracing, explainability, and evaluation.

## Completed in this pass

- [x] Added `src/core/interpreter/**` as the canonical
  SOP tokenizer/parser/validator/interpreter layer,
  with structured interpreter errors and typed object
  admission.
- [x] Replaced the old parser entrypoint with a
  compatibility facade that admits SOP natively while
  still reading legacy Markdown-CNL for migration
  safety.
- [x] Migrated symbolic seed emission and persistent KU
  shell emission to SOP Lang Control.
- [x] Updated normalization prompts and retry prompts
  to speak SOP rather than legacy Markdown blocks.
- [x] Added explicit runtime objects for
  `ExecutionFrame`, `BranchAttempt`, trace results,
  and trace failures.
- [x] Upgraded engine tracing so request execution now
  records frames, branches, results, failures, and a
  canonical `executionTrace.graph`.
- [x] Fixed child-frame tracing to use stable unique
  frame ids and to propagate selected branch ids back
  to the root request.
- [x] Updated the chat Explainability surface to read
  the canonical graph model and render per-frame DAG
  groups instead of reconstructing a linear stage
  strip.
- [x] Updated user-facing documentation pages to
  describe SOP Lang Control, frame-based execution,
  and graph explainability.
- [x] Tightened deterministic tests to match SOP KU
  output and reran the regression suite.
- [x] Adjusted validation guidance so terse `Yes`/`No`
  and single-word answers are judged as compact
  conclusions rather than rejected as invented long
  explanations.
- [x] Re-ran evaluation after the migration and brought
  it back to green.

## Remaining follow-up work

- [ ] Implement truly bounded parallel seed execution.
  The runtime now traces frames/branches explicitly,
  but branch scheduling still follows the existing
  planner/backtracking loop rather than a real
  parallel seed scheduler.
- [ ] Implement `split_from`-aware scheduling and
  lineage-aware branch constraints for derived seeds.
- [ ] Deepen branch semantics for future comparative
  deliberation work so branch objects map one-to-one to
  first-class deliberation alternatives rather than the
  current pragmatic execution attempts.
