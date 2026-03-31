# codex-review.md — Spec vs Code Audit

Date: 2026-03-31
Scope: `docs/specs/DS001` through `DS030`, current `src/`, `config/`, `test/`, and `consolidated-review.md`.

## Executive summary

The repository is much closer to the new plugin-kernel / KU architecture than the older review suggested, and several previously open items are genuinely fixed. However, `consolidated-review.md` is still too optimistic in a few important areas.

The most important remaining mismatches are:

1. **Execution frames are not actually implemented yet.** The engine exposes `frameId` / `frameDepth`, but it still runs a single root flow. `plan.decompose` is never acted on, and `needs-decomposition` is only logged as a weak outcome.
2. **Planner filtering is still only hint-based.** The built-in planners use `plannerHints` and stats, but they do not consume plugin `description` text and they do not discard clearly irrelevant plugins.
3. **KU-aware retrieval is only partially implemented.** Aggregate expansion exists, but there is no real abstraction-level selection, partial child loading policy, or spec-shaped KU metrics in `retrievalTrace`.
4. **Rich KU provenance is only partially materialized.** Parser/validator support the new fields, but the ingest pipeline usually persists only minimal provenance.
5. **DS021 is only partially satisfied.** The evaluation runner now supports `pluginCombos`, but the saved evaluation results still do not preserve LLM role assignments or the response document payload.
6. **Wrapper manifest validation is still partial.** Wrong `protocolVersion` is rejected, but missing `protocolVersion` is still accepted.

`npm test --silent` is currently green (`4/4` deterministic test files passing).

---

## Check against `consolidated-review.md`

### Confirmed as true

- **Validation rejection is now retryable.** `src/core/engine.mjs` throws `VALIDATION_REJECTED`, and that error is included in the retryable planner-error set.
- **Persistent symbolic ingest no longer drops later triples.** `src/strategies/symbolic-only.mjs` now emits one KU per fact-bearing sentence in `normalizePersistentContext()`.
- **`toContextCNL()` has an input-size guard.** Present in `src/normalizer/nl-normalizer.mjs`.
- **The UI persists session ID per tab.** `src/ui/chat.js` uses `sessionStorage`.
- **HDC/VSA cache invalidation is wired.** `src/server/index.mjs` subscribes to KB index change events and invalidates `HDCVSAStrategy` cache entries.
- **The deterministic suite is green.** Verified locally with `npm test --silent`.
- **Typed plugin descriptions / planner hints were added to built-in sd/kb/gs plugins.** Verified in `src/server/index.mjs` registrations and `src/plugins/builtin-plugins.mjs` descriptors.

### No longer accurate or only partially true

- **“Execution frame support in engine ✓” is not true yet.** The engine has frame metadata, but no child-frame creation, no frame stack, and no per-frame state/budget objects.
- **“needs-decomposition handled ✓” is only partial.** `needs-decomposition` is logged, then ignored; no child frame is opened.
- **“Planner uses descriptions for filtering ✓” is not true yet.** `src/plugins/default-planner.mjs` scores `plannerHints` and stats only; `descriptor.description` is never used in ranking.
- **“KU-based retrieval with level selection ✓” is only partial.** `src/retrieval/context-matcher.mjs` only expands aggregates to children; it does not choose summary vs intermediate vs leaf levels explicitly.
- **“Eval runner fixed (DS021) ✓” is only partial.** `pluginCombos` are supported, but the runner does not persist LLM role assignments or response documents in the saved result objects.
- **“Validate protocolVersion in wrapper manifests ✓” is only partial.** `src/plugins/manager.mjs` rejects unsupported values, but it still accepts manifests that omit `protocolVersion` entirely.
- **“KU ingest adds provenance fields ✓” is only partial.** Parser support exists, but the symbolic ingest path does not infer/populate `sourceType`, `author`, `ingestedAt`, or `knowledgeDate`.

---

## High-value confirmed discrepancies

### 1) DS001 / DS002 / DS027 / DS029 — recursive execution frames are still missing

Evidence:
- `src/core/engine.mjs` builds plugin context with `frameId` / `frameDepth`, but never creates a child frame.
- `plan.decompose` is produced by the planner contract but never read by the engine.
- `gs-plugin` status `needs-decomposition` is recorded, then treated as a weak non-terminal outcome.
- `MRPError.frameId` exists, but the engine never sets it.

Impact:
- The code currently implements a **single-frame planner/backtracking engine**, not the recursive frame model described in DS001 / DS002.

### 2) DS003 / DS029 — planner does not use plugin descriptions for relevance filtering

Evidence:
- `src/plugins/default-planner.mjs` stores planner/plugin descriptions but the scoring path reads only `plannerHints`, utility stats, and simple lexical request cues.
- No code path consumes `descriptor.description` during ranking or filtering.
- No code path discards “clearly irrelevant” plugins; the planner only reorders the candidate set.

Impact:
- The documentation now claims description-driven planner filtering, but the implementation is still hint-only.

### 3) DS012 / DS023 / DS027 — retrieval trace and KU level selection are still below spec

Evidence:
- `src/plugins/builtin-plugins.mjs` returns `retrievalTrace` with `profileId`, `evidenceCount`, and `intentAssessments`, not the DS027 shape (`kuLevelsUsed`, `totalKUsConsidered`, `selectedKUCount`).
- `src/retrieval/context-matcher.mjs` returns only `{ strategiesRun, escalated }` in its per-intent trace.
- The only hierarchy-specific behavior is `_expandAggregateKUs()`, which replaces aggregates with children; there is no explicit summary/intermediate/leaf selection policy.

Impact:
- KU hierarchy exists in storage, but retrieval is still mostly “flat ranking + aggregate expansion”.

### 4) DS018 / DS008 / DS030 — richer KU provenance is supported by schema, not by ingest

Evidence:
- Parser and validator accept `KUType`, `Title`, `SourceType`, `Author`, `IngestedAt`, and `KnowledgeDate`.
- `src/ingest/source-ingestor.mjs` passes only minimal provenance (`sourceId`, `chunkId`, `sourceName`, `chunkIndex`, `charStart`, `charEnd`, `chunkType`, `sectionTitle`, `createdAt`) into normalization.
- `src/strategies/symbolic-only.mjs` does not emit `Title`, `SourceType`, `Author`, `IngestedAt`, or `KnowledgeDate` in `normalizePersistentContext()`.
- `src/kb/persistence.mjs` does not serialize many of the richer provenance fields even when present.

Impact:
- The KU schema is ahead of the actual persisted KU population logic.

### 5) DS021 — evaluation output still omits part of the required runtime surface

Evidence:
- `test/evaluation/run.mjs` records the selected planner/sd/kb/gs runtime surface.
- The saved result objects do **not** keep LLM role assignments.
- The saved per-question result objects also do **not** preserve the `response_document`, even though the runner reads it for scoring.

Impact:
- Comparative evaluation still loses part of the audit surface described in DS021.

### 6) DS016 — wrapper manifest validation still accepts missing `protocolVersion`

Evidence:
- `src/plugins/manager.mjs` only rejects the manifest when `manifest.protocolVersion` exists and is not `1`.
- A wrapper manifest with no `protocolVersion` still passes registration.

Impact:
- The implementation is still more permissive than the v1 manifest contract described by DS016.

### 7) DS012 — current-turn context is still injected wholesale into every resolved intent

Evidence:
- `src/retrieval/context-matcher.mjs` always assigns `currentTurnContextUnits: currentTurnUnits || []` for each resolved intent.
- There is no per-intent filtering step for current-turn KUs.

Impact:
- DS012 explicitly prefers intent-level filtering; the current code still uses the fallback path for all requests.

### 8) DS018 / DS023 — hierarchy depth is shallower than the spec target

Evidence:
- `src/ingest/source-ingestor.mjs` creates:
  - leaf KUs,
  - optional section aggregates,
  - optional source aggregate.
- It does **not** create the richer 2–3 abstraction levels “when possible” that the revised specs now describe.

Impact:
- The hierarchy exists, but it is a minimal two-level / three-level shape, not the richer source model described in the new docs.

### 9) DS023 / DS026 — plugin-private artifact staleness is still implicit

Evidence:
- Workspace/repository artifact promotion exists in `src/kb/repository-manager.mjs`.
- There is no explicit stale-marking or dependency invalidation path when a source is updated or deleted from a workspace/repository.

Impact:
- Artifact persistence exists, but lifecycle consistency is weaker than the new wording in DS023 / DS026 suggests.

---

## Spec-by-spec status matrix

| DS | Status | Notes |
|----|--------|-------|
| DS001 | **Partial** | Plugin-kernel architecture is in place, but recursive execution frames are not implemented. |
| DS002 | **Partial** | Root orchestration/backtracking works; child frames, frame-local state, and `plan.decompose` handling are missing. |
| DS003 | **Partial** | Typed registry, descriptors, hooks, and wrapper loading exist; description-driven planner filtering and strict manifest validation are incomplete. |
| DS004 | **Mostly aligned** | Intent CNL enums, parsing, and role mapping are implemented. |
| DS005 | **Partial** | Context CNL format/parsing is implemented; richer KU provenance is only sparsely populated at ingest time. |
| DS006 | **Aligned** | Normalizer, validation retry, and input-size guard are implemented. |
| DS007 | **Aligned** | Validator/parser cover the updated KU fields and current CNL rules. |
| DS008 | **Partial** | KB stores hierarchical KUs and plugin artifacts, but richer provenance is not consistently materialized. |
| DS009 | **Aligned** | BM25 lexical backend and persistence contract are implemented. |
| DS010 | **Aligned** | File persistence uses atomic writes and supports plugin-private artifacts. |
| DS011 | **Aligned** | Intent decomposition and context-profile derivation are implemented. |
| DS012 | **Partial** | Resolved intents exist, but current-turn filtering and KU-level metrics/selection remain limited. |
| DS013 | **Aligned** | Typed plugin, settings, session, KB, and workspace endpoints are present. |
| DS014 | **Mostly aligned** | Runtime selectors, settings panel, sessionStorage, and Enter/Ctrl+Enter behavior are implemented. |
| DS015 | **Aligned** | Shared Achilles bridge and DS028-based model resolution are in place. |
| DS016 | **Partial** | Wrapper protocol v1 exists, but missing `protocolVersion` is still accepted. |
| DS017 | **Aligned** | Shared response-document builder and deterministic `no-context` path are implemented. |
| DS018 | **Partial** | Ingest builds leaf + section + source KUs, but provenance inference and deeper hierarchies are still limited. |
| DS019 | **Aligned** | Session preparation, commit, KB mounting, save/fork, and preference persistence are implemented. |
| DS020 | **Mostly aligned** | Deterministic suite is green and covers major contracts; live-LLM coverage is scaffolded, not visible here. |
| DS021 | **Partial** | `pluginCombos` support is present, but saved evaluation output still omits LLM role assignments and response documents. |
| DS022 | **Mostly aligned** | Intent vs knowledge extraction split exists; current-turn symbolic extraction is still less rigorous than persistent ingest. |
| DS023 | **Partial** | Goal-conditioned hybrid retrieval exists, but explicit KU level selection, redundancy penalties, and artifact invalidation are still limited. |
| DS024 | **Mostly aligned** | HDC/VSA backend and cache invalidation are implemented. |
| DS025 | **Aligned** | ThinkingDB bounded symbolic retrieval backend is implemented as a plugin-private strategy. |
| DS026 | **Mostly aligned** | Mounted repository + workspace draft + conversation state are composed; artifact staleness handling is still implicit. |
| DS027 | **Partial** | Type contracts exist, but decomposition semantics and KB retrievalTrace shape are not fully implemented. |
| DS028 | **Aligned** | Shared role settings store, API, and plugin-side resolution are implemented. |
| DS029 | **Partial** | Adaptive planners, multi-planner fallback, and stats exist; description-based filtering and decomposition requests are not implemented. |
| DS030 | **Partial** | KU shape/hierarchy exist, but provenance richness and level-aware retrieval are still incomplete. |

---

## Recommended next edits

### If the goal is to align code to the current specs

1. Implement real child-frame execution in `MRPEngine`.
2. Either make planners use `description` text and discard irrelevant plugins, or relax DS003 / DS029 wording.
3. Extend retrieval traces to report KU levels considered/selected, and add an explicit abstraction-level selection policy.
4. Decide whether rich provenance is required in practice; if yes, teach ingest/persistence to populate and serialize it consistently.
5. Tighten DS016 manifest validation to require `protocolVersion: 1`.
6. Extend `test/evaluation/run.mjs` result persistence with LLM role settings and `response_document`.

### If the goal is to align the review/docs to the current code

At minimum, `consolidated-review.md` should stop marking the following items as fully complete:

- execution frame support
- needs-decomposition handling
- planner description filtering
- KU-level retrieval selection
- wrapper `protocolVersion` validation
- DS021 runtime-surface completeness
- rich KU provenance population

