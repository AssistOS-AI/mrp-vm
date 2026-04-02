# consolidated-review.md — Consolidated Implementation + Spec Review

Date: 2026-03-31 (updated 2026-04-02)
Scope: current `src/` implementation and DS001–DS030, with emphasis on the recent ingest / KU / child-frame changes.

*Note: This checklist is the current authoritative status for remaining work. Completed items are checked and intentionally kept for traceability.*

## 1. P0 Structural Refactor Program

The repository needs a **structure refactor** to match the architectural boundary claimed by the DS set:
- **VM core** should live under `src/core/**` as a thin execution kernel.
- Concrete plugins should live under `src/plugins/<plugin-type>/<plugin-id>/**`.
- Shared code should live under `src/mrp-vm-sdk/**`.
- Plugin activation should be **config-driven** instead of hard-coded in `src/server/index.mjs`.

**Target Layout:**
```text
src/
  core/
  mrp-vm-sdk/
  plugins/
    runtime/
    sd-plugin/
    kb-plugin/
    gs-plugin/
    mrp-plan-plugin/
    val-plugin/
```

**Tasks (Open Functional Work):**
- [x] Implement config-driven built-in plugin catalog loading (`config/plugins.json`).
- [x] Migrate default plugins into self-describing packages (`index.mjs`, `plugin.json`, `plugin.kus.md`).
- [x] Ensure `test/evaluation/run.mjs` (eval stability) is stable after the structural shift.

---

## 2. Confirmed Specification Issues (Open)

These issues leave important contracts ambiguous or internally inconsistent:

- [x] **B1. Wrapper plugin visibility is internally consistent:** DS001 / DS003 / DS016 now align wrappers as helper subprocesses, not planner-visible typed stage plugins.
- [x] **B2. Canonical `Role -> UtilityActs` fallback table is now specified:** DS005/DS007 define the mapping explicitly.
- [x] **B3. `kb-plugin.onSessionEvent(...)` envelope is specified:** DS027/DS026 now define a discriminated payload contract.
- [x] **B4. Retrieval `purpose` is explicit in schemas:** DS023 / DS027 / DS012 all carry purpose placement.
- [x] **B5. Artifact staleness ownership/propagation specified:** DS010/DS023/DS026 now define detection ownership and propagation channel.

---

## 3. Undocumented Heuristics & Magic Routing (Open)

The following issues represent undocumented heuristics, magic routing, and test-specific hardcoding that MUST be removed or formally documented:

- [x] **L1. Magic Routing removed:** `inferPhaseScopes` now uses explicit/default behavior only.
- [x] **L2. Test-cheating hardcodes removed:** decomposer no longer injects legacy special tokens.
- [x] **L3. Confidence-gap pruning removed:** no undocumented gap-threshold pruning remains.
- [x] **L4. Undocumented focus-phrase lexical boost removed:** retrieval scoring no longer uses that hidden heuristic.
- [x] **L5. Aggregate extrapolation hacks removed:** `_buildAggregateUnits` and `_expandAggregateKUs` no longer exist in runtime paths.

---

## 4. Structured Plugin Communication (Object-based) (Open)

**Requirement:** Plugins MUST NOT communicate via compacted Markdown/text. Communication payloads to plugins must be passed as an explicit **object structure**:
```javascript
{
  prompt: "The current intent or request to be solved...",
  context: [
    {
      title: "Short title of the KU",
      sourceLink: "Link or reference to bibliographic source",
      text: "The actual content of the KU"
    }
  ]
}
```

**Tasks:**
- [x] Refactor VM-to-Plugin calls (in `engine.mjs` and plugins) to pass this explicit object structure instead of concatenated strings.
- [x] Ensure all `kb-plugin` implementations return KUs in a format that maps cleanly to this array structure.
- [x] Audit the codebase to ensure no plugin receives raw concatenated Markdown for processing.
- [x] Update DS files (e.g., DS003, DS016, DS027) to mandate this object structure for plugin inputs and clarify that Markdown string passing is an anti-pattern.
- [x] **Verify Wrapper Plugin Adapter:** Wrapper invocation serializes JSON object payloads over `stdin`.
- [x] **Ensure `mrp-plan-plugin`s Receive Objects:** planners receive structured planner-input objects.
- [x] **Fully Remove Markdown Interfaces:** runtime plugin communication no longer depends on `resolvedMarkdown`; DS012 now declares `resolvedPayload`.

---

## 5. Code Cleanup: Unused, Redundant, and Legacy Code (Open)

**Tasks:**
- [x] **Legacy Aliases removed:** runtime/API/chat use explicit typed plugin IDs.
- [x] **Unused Imports removed:** stale imports (`loadConfig`, `bind`, `MRPError`) cleaned where applicable.
- [x] **Unused Exports removed:** dead exports (`clearConfigCache`, `hasPhaseScope`, `isValidRelation`, `resetTokenizerCache`) removed.
- [x] **Redundant Aggregate Extrapolation removed:** no `_buildAggregateUnits` / `_expandAggregateKUs` runtime leftovers.

---

## 6. SDK vs. Plugin Boundary Violations (Open)

**Issue:** `mrp-vm-sdk` contains highly specific, implementation-heavy logic (like HDC/VSA and KB indexing) that should belong inside individual plugins.

**Tasks:**
- [x] **Relocate HDC/VSA Logic:** algorithm implementations now live under plugin-owned retrieval modules.
- [x] **Relocate KB Indexing Logic:** KB indexing/thinkingdb logic moved out of SDK retrieval path into plugin/core ownership.
- [x] **Audit ContextMatcher & IntentDecomposer:** plugin-specific routing removed from shared SDK path; generic decomposition remains in core.
- [x] **Update DS Specifications (SDK boundaries):** DS003/DS016/DS027/DS001 now reflect strict SDK boundaries.

---

## 7. Explainability & Testing (Open)

- [x] Add session-level **Explainability** view with per-request execution registry.
- [x] Include per-response jump entry into the exact explainability segment.
- [x] Restore `npm run eval` and chat behavior confirming it works with the fully refactored payload objects and plugin boundaries.
