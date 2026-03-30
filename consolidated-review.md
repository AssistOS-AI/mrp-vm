# consolidated-review.md — Final Audit (All Reviewers Merged)

Data: 2026-03-30 | Sources: Kiro CLI, Gemini CLI, Codex

---

## Architecture Verdict

**Core-thin/plugin-rich:** ✅ Solid. Engine is a neutral orchestrator.
**Multiple implementations per type:** ✅ 3 sd + 3 kb + 3 gs + 2 planners.
**Backtracking:** ✅ 3 levels (intra-stage, cross-planner, weak-outcome recovery).

---

## Fixed in This Session

1. ✅ `_deriveSignals` no longer called twice — `_defaultsForInput` now receives pre-computed signals
2. ✅ Ingest context now passes real `parser`/`decomposer` from engine instead of null
3. ✅ Evaluation runner defaults to planner-centric combos instead of legacy mode×profile matrix
4. ✅ HTML docs: new **Meta-Rational Planning** page (DS029 content)
5. ✅ HTML docs: **Processing Modes** page replaced with **Plugin Types & Strategies** (DS003/DS022/DS027)
6. ✅ HTML docs: **Evaluation** page rewritten for planner-centric combos
7. ✅ HTML docs: index.html nav updated, Planner card added, badges updated
8. ✅ Old review files deleted (gemini.review.md, codex.review.md, kiro.review.md, kiro_real.md)
9. ✅ Execution trace enriched with `inputMessage`, `lastPlan`, `inputSnippet`/`outputSnippet` per stage
10. ✅ Chat UI: collapsible trace visualizer showing plan, stage pipeline, status icons, I/O snippets, timing

---

## Remaining Forward Work (Not Bugs)

### KB plugins share one internal retrieval stack (Codex finding)

`kb-fast`, `kb-balanced`, `kb-thinkingdb` all delegate to `ContextMatcher` with different profile IDs. They're typed plugins but not independently implemented. DS023/DS029 acknowledge this as transitional.

### Planner learning is global, not topic-conditioned (Codex finding)

EWMA stats are per-plugin-ID, not per-task-family. DS029 documents the baseline. Bucketing by act/topic is forward work.

### Planner scoring weights are hardcoded

`_scoreCandidate()` has magic numbers. Could be externalized to config. Not a bug — the scoring works — but harder to tune.
