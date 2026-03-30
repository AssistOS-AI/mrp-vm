# MRP-VM Review Report — Gemini Analysis (Plugin-Kernel Fresh Review)

## Overview
This report provides a comprehensive review of the current implementation of the MRP-VM project, focusing on its adherence to the "Plugin-Kernel" architecture (DS001, DS002, DS003) and identifying any remaining "bloated" areas or discrepancies.

---

## 1. Architectural Integrity: Plugin vs. Kernel

### 1.1 Neutral Orchestration Skeleton
- **Observation:** `MRPEngine` (`src/core/engine.mjs`) correctly implements a neutral orchestration skeleton. It does not contain domain-specific logic, retrieval algorithms, or LLM prompting.
- **Verification:** The engine follows a fixed but spec-compliant pipeline: `planner -> seed-detector -> parse/decompose -> kb -> goal-solver`.
- **Finding:** The kernel is successfully "thin." It owns request lifecycle, budgeting, and plugin resolution, but delegates all semantic work to typed plugins.

### 1.2 Multi-Implementation & Selection
- **Observation:** The system avoids oversimplification by registering and using multiple implementations for each plugin type (`src/server/index.mjs`):
  - **Seed Detectors:** `sd-symbolic`, `sd-llm-fast`, `sd-llm-deep`.
  - **KB Plugins:** `kb-fast`, `kb-balanced`, `kb-thinkingdb`.
  - **Goal Solvers:** `gs-symbolic`, `gs-llm-fast`, `gs-llm-deep`.
  - **Planners:** `planner-default`, `planner-depth`.
- **Finding:** The architecture supports and utilizes multiple specialized plugins, allowing for sophisticated escalation and routing based on cost, latency, and intent.

### 1.3 Backtracking & Escalation
- **Observation:** Backtracking is robustly implemented. `MRPEngine` handles non-terminal statuses such as `unsupported` (from seed detectors) and `insufficient` (from KB plugins), attempting the next available candidate.
- **Escalation Logic:** The engine includes a specific escalation loop for weak semantic outcomes (`PLAN_INSUFFICIENT_EVIDENCE`). If the first planner produces only a `no-context` result after insufficient retrieval, the core attempts a heavier planner (e.g., `planner-depth`) before committing the weak answer.
- **Finding:** Backtracking and escalation are stable, well-implemented, and align with DS001/DS002 failure semantics.

---

## 2. Bloated Areas & Simplification Suggestions

### 2.1 ContextMatcher & Retrieval Logic
- **Current State:** `ContextMatcher` (`src/retrieval/context-matcher.mjs`) has been improved by moving Markdown rendering to `renderResolvedIntentMarkdown`.
- **Remaining Bloat:** The internal escalation logic within `ContextMatcher` (primary vs. secondary strategies) is technically a "leaky" version of the planner's responsibility.
- **Suggestion:** While DS001 allows internal backend escalation as an "implementation detail," a cleaner approach would be to express these secondary strategies as separate `kb-plugin`s and let the `mrp-plan-plugin` manage the escalation globally.

### 2.2 Seed Detector Strategies
- **Current State:** `StrategySeedDetectorPlugin` wraps legacy strategies.
- **Bloat:** The `NLNormalizer` and `Strategy` classes still hold significant logic that is essentially "plugin content."
- **Suggestion:** Further consolidate the `normalizer` and `strategy` code directly into the plugin classes to reduce the number of shared service dependencies.

---

## 3. Adherence to Specifications (DS Files)

### 3.1 Proactive Budgeting (DS002)
- **Observation:** `MRPEngine` now implements `reserveBudgetOrSkip`, which performs a pre-invocation check using the plugin's `maxLLMCalls`.
- **Finding:** This correctly implements the proactive budgeting mandate in DS002, preventing budget overruns by skipping expensive plugins when resources are low.

### 3.2 Planner Hints & Learning (DS003/DS029)
- **Observation:** `DefaultPlannerPlugin` utilizes `plannerHints` from plugin descriptors and historical data from `PlannerStatsStore`.
- **Finding:** The system successfully implements "adaptive routing," where the planner uses both initial priors (hints) and learned utility scores to optimize plugin selection.

### 3.3 External Helper Plugins (DS016)
- **Observation:** `PluginManager` provides a `collectOutputs` method, which is invoked by `gs-plugin` via the plugin context.
- **Finding:** This removes the hardcoded external plugin loop from the core and places it correctly within the goal-solving stage, as mandated by DS001/DS016.

---

## 4. Summary of Remaining Doubts & Discrepancies

1. **Wait for Success in Stage:** In `MRPEngine`, the seed-detection stage stops at the *first* success. For KB plugins, it stops if a plugin reports `success` (sufficient evidence), but it also allows an `insufficient` result to stand if no other candidates succeed. This is correct, but the "weak outcome" check at the end of the pipeline ensures this doesn't result in a poor user experience.
2. **Deterministic no-context path:** DS017 specifies a deterministic `no-context` path. The current implementation relies on `gs-plugin` returning a `no-context` status, which is then verified against the retrieval sufficiency in the engine's escalation loop. This is a robust implementation of a previously vague requirement.

---
*Report generated by Gemini CLI.*
