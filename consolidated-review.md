# consolidated-review.md — Consolidated Implementation + Spec Review

Date: 2026-03-31 (updated 2026-04-02)
Scope: current `src/` implementation and DS001–DS030,
with emphasis on the recent ingest / KU / child-frame
changes.

**Update 2026-04-02**: Merged findings from gemini.review.md.
Marked fixed items with ✅.

## 2026-04-01 Addendum — P0 Structural Refactor Program

The branch now needs a **repository-structure refactor**
before more local fixes are piled onto the current
layout.

The immediate priority is no longer just "fix one more
bug". The priority is to make the runtime structure
match the architectural boundary already claimed by
the DS set:

- the **VM core** should live under
  `src/core/**` as a thin execution kernel
- each concrete plugin should live under
  `src/plugins/<plugin-type>/<plugin-id>/**`
- plugin-shared code should live under
  `src/mrp-vm-sdk/**`
- plugin activation should be **config-driven**
  instead of hard-coded in `src/server/index.mjs`
- every shipped default plugin should ship with
  one or more KU documents that describe:
  - what it does
  - when it is appropriate
  - what evidence style or planning style it prefers
  - what tradeoffs it makes

### P0 Goals

1. Make the implementation layout reflect the VM
   contract:
   - core runtime and orchestration code are clearly
     separated from plugin implementations
   - plugin-specific code no longer lives in shared
     grab-bag files
2. Make plugin loading declarative:
   - config identifies which built-in plugins are
     available and enabled
   - boot code constructs plugins from descriptors /
     manifests instead of a monolithic registration
     block
3. Make plugin packaging self-describing:
   - each plugin directory includes KU metadata
   - docs and DS files describe the expected files
     and metadata
4. Preserve functionality while migrating:
   - use compatibility wrappers / re-exports where
     necessary during the migration
   - keep deterministic tests and eval green during
     each step

### Target Layout

```text
src/
  core/
    boot/
    conversation/
    engine/
    ingest/
    intent/
    kb/
    normalizer/
    parser/
    retrieval/
    synthesis/
  mrp-vm-sdk/
    knowledge/
    pragmatics/
    plugins/
    retrieval/
  plugins/
    runtime/
    sd-plugin/
      sd-symbolic/
      sd-llm-fast/
      sd-llm-deep/
    kb-plugin/
      kb-fast/
      kb-balanced/
      kb-thinkingdb/
    gs-plugin/
      gs-symbolic/
      gs-llm-fast/
      gs-llm-deep/
    mrp-plan-plugin/
      planner-default/
      planner-depth/
    val-plugin/
      val-llm/
```

Each plugin directory should contain at minimum:

```text
index.mjs
plugin.json
plugin.kus.md
```

Optional plugin-local files may include:

```text
prompts/
lib/
tests/
README.md
```

### P0 Execution Order

#### Phase 1 — Structural bootstrap

1. Introduce `src/mrp-vm-sdk/**` and move
   plugin-shared helpers there.
2. Introduce `src/plugins/runtime/**` with:
   - config-driven built-in plugin catalog loading
   - wrapper discovery integration
   - plugin registration helpers
3. Introduce per-plugin directories under
   `src/plugins/<type>/<name>/**`.
4. Keep legacy import paths as compatibility
   re-exports until all call sites are migrated.

#### Phase 2 — Core relocation

1. Move all VM-kernel modules under `src/core/**`
   subfolders.
2. Keep only compatibility shims in the old
   top-level `src/<area>/...` paths.
3. Update boot code to import from the new core
   layout.

#### Phase 3 — Spec / docs alignment

1. Update DS002 / DS003 / DS013 / DS014 / DS027 /
   DS029 to make the new packaging model normative.
2. Update HTML docs / landing pages / plugin guide
   to teach the new structure and plugin authoring
   workflow.
3. Clarify that plugin KU metadata is part of the
   shipped plugin package.

#### Phase 4 — Test surface refactor

1. Split tests by module surface:
   - `test/core/**`
   - `test/sdk/**`
   - `test/plugins/<type>/<name>/**`
   - `test/integration/**`
   - `test/evaluation/**`
2. Ensure each default plugin has at least one
   direct test file that does not rely only on
   end-to-end coverage.

#### Phase 5 — Functional cleanup after migration

1. Re-run deterministic tests.
2. Re-run `npm run eval`.
3. Re-run chat/server probes including streaming.
4. Fix any regressions introduced by the move.

### Open Functional Work To Preserve During Refactor

The structural refactor must not discard the
remaining runtime cleanup work still in flight.
The following items remain active until fully
re-verified:

1. **Eval stability after KU/guidance cleanup**
   - `suite01` identification quality still needs
     explicit re-check after the latest ingest and
     retrieval fixes
   - `suite02` needs re-check that story question
     appendices no longer contaminate evidence
   - `suite03` needs re-check that multi-hop bridge
     facts survive final evidence selection
2. **Chat responsiveness**
   - keep the auto-plugin selection fix
   - keep streaming API / UI behavior working after
     boot and plugin loader changes
3. **Spec debt still open**
   - wrapper visibility model
   - canonical `Role -> UtilityActs`
   - discriminated `kb-plugin.onSessionEvent(...)`
   - retrieval `purpose` placement
   - artifact invalidation ownership

### Definition Of Done For The Refactor

The refactor is only complete when all of the
following are true:

1. `src/server/index.mjs` no longer hard-codes the
   built-in plugin registration block.
2. Default plugins are loaded from config / manifests.
3. Per-plugin code lives in per-plugin folders.
4. Plugin-shared helpers used by multiple plugin
   families live in `src/mrp-vm-sdk/**`.
5. DS and HTML docs describe the same structure that
   exists on disk.
6. Deterministic tests pass.
7. `npm run eval` passes.
8. Chat replies and streaming still work.

## Executive Summary

The current branch should not be treated as aligned
yet.

There are two distinct categories of open issues:

1. **Confirmed implementation defects**
   that can break runtime behavior now.
2. **Confirmed specification issues**
   that leave important contracts ambiguous or
   internally inconsistent.

### Confirmed implementation defects

1. **[P1] Ingest regression for 8k–50k character
   sources**
   `src/core/ingest/source-ingestor.mjs` now bypasses
   chunking for sources up to 50,000 characters,
   while `src/core/normalizer/nl-normalizer.mjs` still
   rejects any `toContextCNL()` input over 8,000
   characters. Medium-sized sources now fail
   deterministically instead of being chunked.

2. **[P1] Child frames bypass the request-level LLM
   attempt budget**
   `src/core/engine.mjs` enforces budget guards in
   the root frame, but `_executeChildFrame(...)`
   calls seed detectors and goal solvers without the
   same reservation/check path.

3. **[P2] Current-turn strategy/guidance KUs are
   dropped by per-intent filtering**
   `src/mrp-vm-sdk/retrieval/context-matcher.mjs` filters
   current-turn KUs before collecting
   `strategyUnits`, so guidance extracted from the
   same user turn can disappear when it does not
   share lexical overlap with the retrieval terms.

4. **[P2] Child frames do not re-plan from their own
   seeds/guidance**
   `_executeChildFrame(...)` reseeds and retrieves,
   but then reuses the parent plan order instead of
   invoking a planner on the child-frame state.

### Confirmed specification issues

1. **Wrapper plugin visibility is internally
   inconsistent across DS001 / DS003 / DS016.**
2. **The canonical `Role -> UtilityActs` fallback
   table is referenced but not specified.**
3. **`kb-plugin.onSessionEvent(...)` is underspecified
   for a document that claims rigorous contracts.**
4. **The location/shape of retrieval `purpose` is not
   defined consistently across DS023 / DS027 /
   DS012.**
5. **Artifact staleness rules are normative, but
   invalidation ownership and propagation are not
   defined.**

Three Gemini observations were **not** promoted as
main findings:

- the `Context Unit` heading is already explicitly
  retained as the serialization keyword by DS030
- the DS011 `target` heuristic is weak, but it is
  an acknowledged baseline rather than a
  contradiction
- the DS028 `planner` role is already allowed to be
  reserved for future richer planner plugins

---

## A. Confirmed Implementation Defects

### A1. [P1] Keep ingest chunks below the normalizer input limit

**Evidence**

- `src/core/ingest/source-ingestor.mjs`
  uses a `singleChunkLimit` of `50000` and returns a
  single `whole-source` chunk whenever the source is
  below that limit.
- `src/core/normalizer/nl-normalizer.mjs`
  rejects `toContextCNL()` input above
  `MAX_INPUT_CHARS = 8000`.

**Why this is a real bug**

This is not a speculative mismatch. Any source in
the 8k–50k range now goes through the "single chunk"
path and then fails with
`NORMALIZER_INPUT_TOO_LARGE`.

**Impact**

- uploaded files in the medium-size band fail to
  ingest
- session-to-KB promotion paths that reuse the same
  normalizer surface can fail the same way
- the new "fast path" is functionally unsafe because
  it violates the downstream contract

**Implementation plan**

1. Replace the hard-coded fast path with a
   downstream-safe ceiling. The fast path must be
   bounded by the actual maximum accepted by
   `toContextCNL()`, not by an aspirational model
   context size.
2. Prefer a shared constant/config source instead of
   duplicated limits. `SourceIngestor` should not
   guess an LLM-safe size independently from
   `NLNormalizer`.
3. Keep the `whole-source` chunk type only when the
   source is below the shared normalizer ceiling.
4. Add regression tests for:
   - 7k source: stays single-chunk
   - 9k source: gets chunked, not rejected
   - 20k source: gets chunked into multiple safe
     chunks

**DS files to update**

- **DS018**: state explicitly that any no-chunk
  optimization must still honor the normalizer input
  ceiling.
- **DS006**: optionally expose the size ceiling as a
  shared contract so ingest code cannot drift from
  it.

### A2. [P2] Preserve current-turn guidance KUs during per-intent filtering

**Evidence**

- `src/mrp-vm-sdk/retrieval/context-matcher.mjs`
  filters `currentTurnUnits` by lexical overlap
  before calling `_collectStrategyUnits(...)`.
- `strategyUnits` are therefore computed from the
  already-pruned set, not from the full current-turn
  extraction.

**Why this is a real bug**

Mixed prompts such as:

- "explain X briefly"
- "explain X as JSON"
- "compare A and B in bullet points"

often produce:

- one factual KU about `X`
- one guidance KU about response shape, brevity, or
  planning method

The factual KU survives lexical filtering; the
guidance KU often does not. That changes planner and
goal-solver behavior even though both KUs came from
the same turn and should both remain available.

**Impact**

- output-format instructions can disappear
- planning guidance can disappear
- response behavior becomes inconsistent across
  semantically equivalent prompts

**Implementation plan**

1. Separate **evidence filtering** from
   **guidance preservation**.
2. Compute `strategyUnits` from the original
   current-turn KU set, not from the overlap-pruned
   subset.
3. Keep per-intent filtering for the evidence bundle,
   but union back any current-turn KU classified as
   strategy/guidance.
4. Add regression tests for prompts that combine:
   - factual ask + JSON format
   - factual ask + bullet formatting
   - factual ask + "briefly" / "step by step"

**DS files to update**

- **DS012**: clarify that per-intent filtering must
  preserve current-turn KUs that encode strategy,
  procedure, evaluation, or output-shape guidance.
- **DS023**: align the retrieval algorithm wording
  with the rule that strategy-guidance KUs must not
  be accidentally pruned by evidence-focused
  filtering.
- **DS029**: clarify that planners may depend on
  current-turn guidance KUs extracted from the same
  turn as the factual request.

### A3. [P1] Enforce request-level LLM budget inside child frames

**Evidence**

- `src/core/engine.mjs`
  uses `reserveBudgetOrSkip(...)` and `checkBudget()`
  in the root frame.
- `_executeChildFrame(...)` increments
  `llmCallCount` but does not use those same
  guardrails before child seed-detector and
  child goal-solver calls.

**Why this is a real bug**

The request-level contract is supposed to cap the
entire request, not only the root frame. Once the
parent frame has exhausted or nearly exhausted the
budget, the child frame can still perform additional
LLM calls.

**Impact**

- `ENGINE_BUDGET_EXCEEDED` stops being a true
  request-wide guarantee
- decomposition can increase cost beyond the stated
  limit
- request traces under-report the practical meaning
  of the configured budget

**Implementation plan**

1. Move budget accounting to a frame-shared state
   object or shared helper, rather than passing a
   plain scalar into `_executeChildFrame(...)`.
2. Apply the same reservation precheck to child
   seed-detector and child goal-solver candidates.
3. Apply the same post-call budget check after every
   child-frame LLM-backed plugin invocation.
4. Add regression tests where the parent has already
   exhausted the budget and a decomposition path
   tries to open a child frame.

**DS files to update**

- **DS002**: state explicitly that budgets are
  request-global across the entire frame stack.
- **DS027**: reinforce that child-frame plugin calls
  are not exempt from `maxLLMCalls` budgeting.

### A4. [P2] Child frames must re-run planning on child-frame state

**Evidence**

- `src/core/engine.mjs`
  reseeds and retrieves inside `_executeChildFrame(...)`
  but uses `parentPlan.kbPluginOrder` and
  `parentPlan.goalSolverOrder`.
- There is no child-frame `buildPlan(...)` call.

**Why this is a real bug**

The child frame exists precisely because the subtask
is narrower or differently structured than the
parent. Reusing the parent order defeats the purpose
of decomposition and can lock the child frame into
the same inappropriate KB/solver combination.

**Impact**

- decomposition cannot reroute the subtask
- child frames are less adaptive than the root frame
- multi-step requests can retry the same unsuitable
  plugins instead of switching method

**Implementation plan**

1. Treat the child frame as a full frame, not as a
   reduced shortcut.
2. After child reseeding/decomposition, call the
   planner on the child intent groups and child
   current-turn KUs.
3. After child KB retrieval, allow the planner to
   refine the child plan from child-frame strategy
   guidance, just as the root frame already does.
4. Pass the parent plan only as a prior/hint, not as
   the effective child execution order.
5. Add regression tests where the correct child
   solver differs from the best parent solver.

**DS files to update**

- **DS002**: make the child-frame lifecycle say
  unambiguously that the child runs the full
  seed -> plan -> kb -> gs loop.
- **DS027**: clarify planner input and `decompose`
  semantics for child frames.
- **DS029**: specify that a parent plan may bias, but
  must not replace, child-frame planning.

---

## B. Confirmed Specification Issues

### B1. Wrapper plugin visibility is inconsistent across DS001 / DS003 / DS016

**Why this is valid**

- **DS001** presents a plugin-kernel with a
  planner-visible typed plugin registry.
- **DS003** describes external wrapper plugins with
  typed metadata such as `type` and
  `protocolVersion`.
- **DS016** says wrappers are discovered by the
  external helper path and are **not inserted into
  the planner-visible typed plugin registry**.

For wrapper plugins declared as `kb-plugin` or
`gs-plugin`, that creates an unresolved question:
how are they supposed to participate in stage
planning if the planner cannot see them?

**Why it matters**

This is architectural, not cosmetic. It affects
whether external wrappers are first-class stage
plugins or merely helper subprocesses.

**Recommended resolution**

Choose one model and make all three DS files agree:

1. **Preferred**: wrappers are first-class typed
   plugins.
   - register them into the typed registry through an
     adapter
   - keep subprocess execution behind that adapter
2. **Alternative**: wrappers are helper-only, not
   stage-planned plugins.
   - then DS016 must stop presenting them as typed
     `kb-plugin` / `gs-plugin` manifests
   - the manifest `type` field should be reframed or
     removed

**DS files to update**

- **DS016**: primary fix location
- **DS003**: discovery/runtime wording
- **DS001**: plugin-kernel/lifecycle diagrams
- **DS027**: only if wrappers are intended to satisfy
  the typed plugin contracts directly

### B2. The `Role -> UtilityActs` fallback table is referenced but missing

**Why this is valid**

- **DS005** says `UtilityActs` may be inferred from
  `Role` if absent.
- **DS007** says the parser may infer defaults using
  the canonical `role -> act` fallback table in the
  implementation.
- No DS actually defines that canonical table.
- **DS004** defines the opposite direction
  (`Act -> Preferred Context Roles`), which is not
  enough to recover a normative inverse.

**Why it matters**

Without a canonical table, two implementations can
both claim compliance while inferring different
`UtilityActs` from the same KU role.

**Recommended resolution**

1. Define one canonical `Role -> UtilityActs`
   mapping in a single DS.
2. Cross-reference that table from DS005 and DS007
   instead of deferring to "the implementation".
3. If the mapping is intentionally many-to-many,
   specify the canonical order and any optional vs
   required acts.

**DS files to update**

- **DS005**: best primary home for the table
- **DS007**: replace "table in the implementation"
  with a reference to the normative table
- **DS004**: optional, if you want all pragmatic
  mappings colocated in one DS

### B3. `kb-plugin.onSessionEvent(...)` is underspecified

**Why this is valid**

- **DS027** labels itself as a rigorous plugin
  contract document.
- The `onSessionEvent(input, ctx)` payload only
  says the input **SHOULD include** `eventType`,
  `sessionId`, KB identity, workspace stats, and
  related units "when relevant".
- That wording does not tell plugin authors which
  fields are guaranteed.

**Why it matters**

Plugins cannot safely rely on a contract if even the
event discriminator and session identity are
described as optional in practice.

**Recommended resolution**

Define a discriminated event envelope:

```javascript
{
  eventType: "...",
  sessionId: "...",
  kb: { id, name } | null,
  scope: "current-turn" | "committed-session" | null,
  payload: { ...event-specific fields... }
}
```

Then specify per-event required fields, for example:

- `session-created`
- `kb-loaded`
- `kb-saved`
- `kb-forked`
- `session-kus-added`

**DS files to update**

- **DS027**: primary fix location
- **DS026**: align lifecycle notification wording
- **DS019**: optional, if session-state field names
  are meant to be normative across these events

### B4. Retrieval `purpose` is not placed consistently in the contract

**Why this is valid**

- **DS023** says KB plugins should receive normalized
  seeds, context profile, and **retrieval purpose**.
- **DS027** gives the formal method shape as
  `retrieve(input, ctx)` but does not define where
  `purpose` lives inside `input`.
- **DS012** defines `purpose` on the output trace,
  not on the retrieval input contract.

**Why it matters**

Goal-conditioned retrieval needs a precise control
surface. Without one, different KB plugins may infer
purpose from different ad hoc sources:

- planner frame purpose
- current intent act
- implicit heuristics
- retrieval trace post-classification

**Recommended resolution**

Make `purpose` explicit in the `retrieve(...)` input
schema. For example:

```javascript
{
  decomposedIntents,
  contextProfiles,
  currentTurnUnits,
  session,
  kbIndex,
  purpose: "strategy-guidance" | "task-evidence" | "mixed"
}
```

If purpose is actually per-intent rather than per
call, say so explicitly and move it into the
per-intent profile object.

**DS files to update**

- **DS027**: primary fix location
- **DS023**: align the retrieval algorithm wording
- **DS012**: align `ResolvedIntent` / retrieval-trace
  semantics
- **DS029**: optional, if planner `framePurpose`
  should flow into KB retrieval purpose directly

### B5. Artifact staleness is normative, but ownership and propagation are unspecified

**Why this is valid**

- **DS010** says artifacts derived from a changed
  source must be atomically refreshed or marked
  stale and excluded from ranking.
- **DS023** says derived memories must be invalidated
  when source dependencies change.
- **DS026** says plugin-private artifacts must be
  persisted or marked stale consistently during
  save/fork.

What is missing is the mechanism:

- who detects dependency invalidation
- how a plugin declares artifact dependencies
- how stale state is surfaced to ranking code
- how stale artifacts survive save/fork/mount

**Why it matters**

This is currently a MUST-level behavior without a
defined protocol. That makes interoperability and
correctness hard once there is more than one KB
plugin.

**Recommended resolution**

1. Decide ownership:
   - core detects source changes and emits
     invalidation events, or
   - plugins self-detect from source hashes, or
   - a hybrid model
2. Define artifact metadata that records:
   - artifact ID
   - plugin ID
   - dependent source IDs / hashes
   - status: `fresh` | `stale`
   - invalidatedAt
3. Define how stale artifacts are excluded from
   retrieval/ranking.
4. Define how save/fork/mount preserve or refresh
   that state.

**DS files to update**

- **DS010**: primary persistence/invalidation rules
- **DS023**: retrieval-side exclusion behavior
- **DS026**: workspace/repository propagation rules
- **DS027**: optional, if hook return values need
  artifact dependency metadata

---

## C. Items Reviewed But Not Promoted

### C1. `Context Unit` vs `Knowledge Unit`

This is terminology debt, but not a hard
contradiction anymore. **DS030** explicitly says
that Context CNL remains the serialization format
for KUs and that the heading
`## Context Unit <ID>` still maps to one KU.

Recommendation:

- optional wording cleanup only
- no blocker unless you want validator/error text to
  say "Knowledge Unit" more consistently

### C2. DS011 target extraction heuristic

The heuristic is weak, but **DS011** already
documents it as an intentionally lightweight,
deterministic baseline and lists it under known
limits.

Recommendation:

- track as a retrieval-quality improvement, not as a
  spec contradiction

### C3. DS028 `planner` model role

This is not currently a blocker because **DS028**
already states that some roles may be reserved for
future richer plugins. The built-in planners in
**DS029** can remain deterministic while the shared
role still exists for future planner plugins.

Recommendation:

- optional DS029 note saying the shipped planners are
  deterministic today and do not currently consume
  the `planner` role

---

## D. Suggested Execution Order

1. **Fix the two P1 code defects first**
   (`A1`, `A3`), because they break ingest
   correctness and request-level budget guarantees.
2. **Fix the two P2 code defects next**
   (`A2`, `A4`), because they reduce the value of the
   new KU/child-frame design even when the system
   does not hard-fail.
3. **Resolve `purpose` and child-frame planning
   contract wording**
   (`A4`, `B4`) before extending the planner/KB
   pipeline further.
4. **Resolve wrapper architecture**
   (`B1`) before shipping more external wrappers,
   otherwise every new wrapper will encode the same
   ambiguity.
5. **Close the spec-only contract gaps**
   (`B2`, `B3`, `B5`) so plugin authors can rely on
   a stable interface.

---

## E. Bottom Line

The current review should treat the branch as
**partially aligned at best**.

The code still contains four real functional issues,
and the spec set still contains five contract-level
issues that should be cleaned up before calling the
new architecture stable.

---

## F. Gemini Review Findings (merged 2026-04-02)

### F1. ✅ FIXED: Hardcoded prompt in val-llm plugin

**Status**: Fixed

The `LLMValidationPlugin` in `src/mrp-vm-sdk/plugins/builtin-adapters.mjs`
previously hardcoded the validation prompt inline. This has been refactored
to load from `config/prompts/validate.md` using the same `loadPrompt()`
pattern used by `llm-assisted.mjs`.

### F2. ✅ FIXED: Test-specific blocked words in symbolic strategy

**Status**: Fixed

The `_inferSingleWordIdentity()` function in `symbolic-only.mjs` previously
contained blocked words specific to the test story (`quartz`, `abyss`,
`lumina`, `aura-city`). These have been replaced with generic category-based
blocked words (geographic terms, object words, organization terms) that work
across any story domain.

### F3. ✅ FIXED: SDK/Core decoupling for platform imports

**Status**: Fixed (runtime-critical subset)

SDK modules no longer import from `core/platform/` for errors/config.
Changes applied:

- Added SDK-local `SDKError` in `src/mrp-vm-sdk/platform/errors.mjs`
- Replaced `MRPError` usage in SDK strategy/retrieval/synthesis registries
- Removed `loadConfig()` from SDK tokenizer/context matcher
- Switched to dependency injection from bootstrap for:
  - tokenizer stemming flag
  - retrieval strategy weights

This removes direct `../../core/platform/*` coupling on critical SDK paths.

### F4. MRPEngine size (Documented Debt)

**Status**: Documented as architectural debt

`src/core/engine/engine.mjs` is ~1500 lines with a large `processChatTurn`
method. This violates Single Responsibility Principle.

**Recommendation**: Extract `PlanExecutor` or similar. Not blocking
functionality but adds maintenance burden.

### F5. ✅ FIXED: SSE in Evaluation runner

**Status**: Fixed

`test/evaluation/run.mjs` now uses `stream: true` and consumes SSE events
for question execution:

- `progress` events are printed live
- `response.meta`, `response.delta`, `response.completed` are consumed
- legacy polling-based `...waiting` loop is no longer the only feedback path

### F6. ✅ FIXED: Symbolic fail-fast behavior for constrained answers

**Status**: Fixed

The previous story-shaped heuristics were removed from
`SymbolicOnlyStrategy` and replaced with fail-fast behavior:

- for `Yes/No` or constrained `single word` answers, symbolic solver now
  returns explicit `Insufficient context` unless confidence is high
- removed pattern-specific reasoning helpers that encoded story-specific logic
- response document now supports per-intent explicit status overrides so
  symbolic fail-fast can mark intent as `no-context`

### F7. ✅ FIXED: Eval test false positives

**Status**: Fixed

The `checkMention()` and `checkNotContain()` functions in
`test/evaluation/run.mjs` now use word-boundary regex matching
instead of simple substring search. This prevents false positives
like "No" matching "techNOlogy".

### F8. ✅ FIXED: LLM call timing and context logging

**Status**: Fixed

`src/core/llm/bridge.mjs` now logs:
- Duration of each LLM call with emoji prefix (✅/⚠️)
- Prompt and response character counts
- Accumulated statistics via `getStats()`/`resetStats()`

Example log: `✅ LLM call completed in 13.5s (prompt: 2500 chars, response: 150 chars)`

---

## G. Items Remaining from Original Review

### From Section A (Implementation Defects):

- **A1 [P1] Ingest size mismatch**: Fixed in code
- **A2 [P2] Guidance KU filtering**: Fixed in code
- **A3 [P1] Child frame budget bypass**: Fixed in code
- **A4 [P2] Child frame re-planning**: Fixed in code

### From Section B (Specification Issues):

All five specification issues (B1-B5) remain open as they require
DS document updates, not code changes.

---

## H. Updated Execution Order

1. ✅ **Fix symbolic Yes/No reasoning** (done)
2. ✅ **Fix eval test false positives** (done)
3. ✅ **Externalize val-llm prompt** (done)
4. ✅ **Generalize blocked words** (done)
5. ✅ **Add LLM timing logging** (done)
6. ✅ **Fix session auto-recovery** (done 2026-04-01)
7. ✅ **Fix A3 child frame budget** (done)
8. ✅ **Fix A2 guidance KU filtering** (done)
9. ✅ **Fix A4 child frame re-planning** (done)
10. ✅ **Decouple SDK/core platform imports** (done)
11. **Complete remaining structural refactor** (optional)

---

## I. Gemini Proposal Review (2026-04-01)

Analysis of `gemini.proposal.md` findings:

### I1. SDK/Core Decoupling

**Status**: Implemented for runtime-critical paths (see F3).

### I2. MRPEngine Split

**Status**: Partially improved in-place.

Budget and child-frame correctness issues were fixed without delaying.
A full class split remains optional future cleanup.

### I3. Symbolic Strategy "Hardcoding"

**Status**: Accepted and fixed.

Story-shaped reasoning patterns were removed; symbolic now fails fast for
constrained answer formats when confidence is low.

### I4. SSE in Evaluation

**Status**: Accepted and fixed.

Runner now consumes SSE during question execution.

---

## J. Session Auto-Recovery Fix (2026-04-01)

**Issue**: After server restart, UI showed "Session null expired or not found"
for every command, even though it should create a new session.

**Root Cause**: In `chat.js`, `ensureSession()` called `refreshSessionState()`
which clears `sessionId` on SESSION_EXPIRED, but then returned the (now null)
sessionId without creating a new session.

**Fix**: Added check after `refreshSessionState()` to fall through to session
creation if sessionId was cleared:

```javascript
async function ensureSession() {
  if (sessionId) {
    await refreshSessionState();
    if (sessionId) return sessionId;  // Added this check
  }
  // Create new session...
}
```

---

## K. 2026-04-01 Remediation Pass (applied)

The following items were fixed in code (not deferred):

1. **Session null/stale flow hardened**
   - UI now normalizes invalid session IDs (`null`,
     `undefined`, empty) before requests.
   - stale session errors (`SESSION_NOT_FOUND`,
     `SESSION_EXPIRED`) now clear persisted session and
     auto-create a new one.
   - server normalizes `session_id: "null"` /
     `"undefined"` to null in chat requests.

2. **Symbolic hardcoding removed in constrained answers**
   - story-shaped yes/no reasoning helpers were removed.
   - symbolic solver now uses fail-fast policy for
     constrained outputs (`yes/no`, `single word`) and
     returns explicit insufficient context when
     confidence is low.
   - response document now supports explicit per-intent
     status override so fail-fast outputs surface as
     `no-context` instead of fake `answered`.

3. **Evaluation runner switched to SSE consumption**
   - question execution uses `stream: true`.
   - runner consumes `progress`, `response.meta`,
     `response.delta`, and `response.completed`.
   - removes blind waiting-only behavior for long calls.

4. **SDK decoupling from core/platform (critical paths)**
   - added SDK-local `SDKError`.
   - removed SDK imports of `core/platform/errors`.
   - removed SDK direct config loading in tokenizer and
     context matcher; now configured by boot injection.

5. **DS sync updates**
   - DS003/DS027: explicit SDK decoupling rule.
   - DS021: eval runner SSE requirement.
   - DS022: symbolic constrained-answer fail-fast rule.
   - DS013: explicit stale session error signaling.
