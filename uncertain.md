# uncertain.md

This file records implementation decisions that are
reasonable for the current runtime, but may deserve a
later design discussion.

## 1. Legacy read compatibility remains at the parser boundary

The runtime now emits SOP Lang Control for seed and KU
control surfaces, but it still accepts legacy
Markdown-CNL on read through the compatibility parser
facade.

This was kept intentionally so persisted KB material,
older fixtures, and migration-era artifacts do not
become brittle all at once.

## 2. The canonical trace graph is explicit, but branch scheduling is still pragmatic

`executionTrace.graph` is now the canonical
explainability object, with stable frame, branch,
result, and failure identities.

However, branch creation still mirrors the current
planner/retrieval/goal-solver backtracking runtime,
not a future fully parallel seed scheduler with
lineage constraints.

## 3. Validation is slightly more permissive for terse answers

The validation prompt now accepts compact `Yes`/`No`
or other single-word answers when they are a direct
inference from the retrieved evidence and do not add
new unsupported details.

This was needed to keep evaluation aligned with the
intended behavior for terse answers, but it is still a
policy choice that could be tightened or relaxed later
if validation becomes more structured.
