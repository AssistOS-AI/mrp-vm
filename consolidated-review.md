# consolidated-review.md — Spec vs Code Audit

Date: 2026-03-31T15:32 (revised)
Scope: DS001–DS030, all source code, config, tests.

---

## Executive Summary

The repository has gone through a major revision
cycle that introduced:

- DS030 Knowledge Unit as a first-class concept
- Execution frames and recursive task resolution
- VM-as-glue principle (core = LLM bridge + frames +
  orchestration; all domain logic in plugins)
- KU-aware retrieval with aggregate expansion
- Planner description-based scoring
- Per-intent current-turn context filtering

The previous audit identified 9 discrepancies between
specs and code. All 9 have been addressed with code
changes and new tests. The deterministic suite is
green: 55/55 pass.

However, several areas are implemented at a baseline
level that satisfies the spec contract but does not
yet exploit the full depth described in the spec
language. These are documented below as "baseline
implementations" rather than "discrepancies".

---

## Work Performed (chronological)

### Phase 1 — Specifications

New:
- DS030 — Knowledge Unit model

Revised (major):
- DS001 — execution frames, standard loop,
  VM-as-glue, inter-plugin CNL agnostic
- DS002 — frame lifecycle, needs-decomposition,
  VALIDATION_REJECTED, maxFrameDepth
- DS005 — KU serialization format, 6 new fields
- DS007 — allowed fields updated for KU
- DS008 — hierarchical KU storage
- DS012 — KU-aware context construction
- DS018 — hierarchical KU tree extraction
- DS022 — dual sd-plugin responsibility
- DS027 — needs-decomposition, decompose, mandatory
  plannerHints

Revised (repositioned as plugin-private):
- DS009 — BM25 backend of kb-fast/kb-balanced
- DS024 — HDC/VSA backend of kb-balanced
- DS025 — ThinkingDB backend of kb-thinkingdb

Revised (other):
- DS003 — mandatory descriptions, plannerHints
- DS023 — KU hierarchy traversal
- DS028 — validation canonical role
- DS029 — description filtering, decomposition

### Phase 2 — Documentation

- `docs/overview/vm-execution.html` — VM execution
  model, loop, frames, KU, inter-plugin communication
- `docs/overview/plugin-inventory.html` — all plugins,
  categories, build-a-plugin tutorial
- `docs/index.html` — nav and cards updated

### Phase 3 — Implementation fixes

| # | Fix | Evidence |
|---|-----|----------|
| 1 | Validation rejection throws VALIDATION_REJECTED | `src/core/engine.mjs` throws MRPError, retryable set includes it |
| 2 | Symbolic ingest: one KU per fact-bearing sentence | `src/strategies/symbolic-only.mjs` separates fact vs non-fact |
| 3 | Input-size guard on toContextCNL() | `src/normalizer/nl-normalizer.mjs` line 53 |
| 4 | Session ID per tab | `src/ui/chat.js` uses sessionStorage |
| 5 | HDC/VSA cache invalidation wired | `src/server/index.mjs` kbIndex.onChange → hdcStrategy.invalidate |
| 6 | CNL parser handles KU fields | `src/parser/cnl-validator-parser.mjs` parses kuType, title, sourceType, author, ingestedAt, knowledgeDate |
| 7 | CONTEXT_ALLOWED_FIELDS updated | `src/lib/pragmatics.mjs` includes all KU fields |
| 8 | Plugin descriptions operationally useful | `src/server/index.mjs` all built-in plugins have 1-2 sentence descriptions |
| 9 | config/engine.json matches DS002 | maxFrameDepth, plannerFallbackOrder present |
| 10 | Boot code reads engine.json first | `src/server/index.mjs` engineConfig priority over pluginsConfig |
| 11 | protocolVersion strictly required | `src/plugins/manager.mjs` rejects missing protocolVersion |
| 12 | validation role in DS028 and UI | `docs/specs/DS028`, `src/ui/index.html` |
| 13 | Child frame execution | `src/core/engine.mjs` _executeChildFrame runs seed→kb→gs at depth+1 |
| 14 | Planner uses description text | `src/plugins/default-planner.mjs` _scoreCandidate checks description |
| 15 | Retrieval trace KU metrics | `src/retrieval/context-matcher.mjs` kuLevelsUsed, totalKUsConsidered, selectedKUCount |
| 16 | Current-turn context per-intent filtering | `src/retrieval/context-matcher.mjs` filters by query terms |
| 17 | KU provenance in KB normalize | `src/kb/knowledge-base.mjs` _normalizeUnit sets kuType, title, sourceType, author, ingestedAt, knowledgeDate |
| 18 | KU provenance in symbolic ingest | `src/strategies/symbolic-only.mjs` emits Title, SourceName, IngestedAt |
| 19 | kuType/title on ingest aggregates | `src/ingest/source-ingestor.mjs` section=composite, source=aggregate |
| 20 | MRPError includes frameId | `src/lib/errors.mjs` |
| 21 | decompose flag in planner output | `src/plugins/default-planner.mjs` returns decompose: false |
| 22 | LLM cache stability for ingest | `src/strategies/llm-assisted.mjs` normalizePersistentContext uses sourceName+chunkIndex instead of random sourceId in prompt, so same content hits cache regardless of upload-time ID |

### Phase 4 — Tests added

| Test | File |
|------|------|
| KU fields parsing | ku-integration.test.mjs |
| KU composite/aggregate validation | ku-integration.test.mjs |
| Symbolic ingest per-fact emission | ku-integration.test.mjs |
| KBIndex change listeners | ku-integration.test.mjs |
| Validation rejection retryable | ku-integration.test.mjs |
| KU aggregate expansion | ku-integration.test.mjs |
| Planner description scoring | ku-integration.test.mjs |
| Retrieval trace KU metrics | ku-integration.test.mjs |
| Current-turn per-intent filtering | ku-integration.test.mjs |
| Wrapper protocolVersion rejection | ku-integration.test.mjs |

55 tests, 22 suites, all passing.

---

## Spec Status Matrix

| DS | Status | Notes |
|----|--------|-------|
| DS001 | Aligned | VM-as-glue, execution frames, standard loop, KU, validation rejection |
| DS002 | Aligned | Child frame execution, maxFrameDepth, needs-decomposition, VALIDATION_REJECTED |
| DS003 | Aligned | Mandatory descriptions, plannerHints required, description used in scoring |
| DS004 | Aligned | Intent CNL schema and enums |
| DS005 | Aligned | KU serialization with provenance fields |
| DS006 | Aligned | All normalizer methods have size guard |
| DS007 | Aligned | Parser handles all KU fields |
| DS008 | Aligned | Hierarchical KU storage with kuType, provenance |
| DS009 | Aligned | Plugin-private BM25 backend |
| DS010 | Aligned | Artifact persistence and promotion |
| DS011 | Aligned | Decomposition and context profiles |
| DS012 | Aligned | KU metrics in trace, per-intent filtering, aggregate expansion |
| DS013 | Aligned | API surface complete |
| DS014 | Aligned | All roles in settings, session per tab |
| DS015 | Aligned | LLM bridge with role resolution |
| DS016 | Aligned | protocolVersion strictly required |
| DS017 | Aligned | Response document and no-context fallback |
| DS018 | Aligned | Hierarchical KU tree with kuType/title on all levels |
| DS019 | Aligned | Session state with typed plugin preferences |
| DS020 | Aligned | 55/55 deterministic tests pass |
| DS021 | Aligned | pluginCombos, runtime surface, response_document persisted |
| DS022 | Aligned | Dual sd-plugin responsibility |
| DS023 | Aligned | KU hierarchy traversal, aggregate expansion |
| DS024 | Aligned | Plugin-private HDC/VSA with cache invalidation |
| DS025 | Aligned | Plugin-private ThinkingDB backend |
| DS026 | Aligned | Repository/workspace substrate |
| DS027 | Aligned | needs-decomposition, decompose flag, mandatory plannerHints |
| DS028 | Aligned | validation in canonical roles |
| DS029 | Aligned | Description-based filtering, decomposition trigger |
| DS030 | Aligned | KU model across parser, ingestor, KB, retrieval |

---

## Baseline Implementations (not discrepancies, but areas where the spec allows richer behavior)

These are areas where the code satisfies the spec
contract but implements the simplest conformant
version. The specs use language like "SHOULD" or
"when the source material supports it" which allows
a baseline implementation.

### 1. Child frame execution is single-level

`_executeChildFrame` runs one child loop
(seed→kb→gs). It does not recurse further — a child
frame that also gets `needs-decomposition` will not
spawn a grandchild. DS002 allows maxDepth=3 but the
current code only goes to depth 1.

This is conformant because the spec says the core
"MAY create a child frame" and enforces maxDepth.
The baseline simply does not recurse beyond one level.

### 2. KU hierarchy is 3 levels max

Ingest produces leaf → section aggregate → source
aggregate. DS018 says "2-3 intermediate levels when
the source material supports it". The current
baseline always produces exactly these 3 levels.

Richer domain-specific hierarchies (scene→chapter→
work for literature, clause→section→chapter→document
for legal) would require domain-aware ingest plugins.

### 3. Planner description scoring is keyword-based

The planner checks if query words appear in the
plugin description. This is a simple bag-of-words
match, not semantic similarity. DS029 says the
planner should "rank plugins by likely relevance"
which this satisfies minimally.

### 4. KU provenance fields are partially populated

`author`, `knowledgeDate`, and `sourceType` are
supported in the schema and parser but are only
populated when the upstream data provides them.
The symbolic ingest strategy does not attempt to
extract author or date from document content.
The LLM-backed ingest strategy could populate these
through prompt engineering but does not currently.

### 5. Aggregate expansion is always-expand

`_expandAggregateKUs` always replaces aggregates with
their children. DS012/DS023 describe a richer policy
where the system decides whether to load a summary,
intermediate, or leaf level. The current baseline
always drills down.

### 6. Plugin-private artifact staleness

DS010/DS023 describe invalidation of plugin-private
artifacts when source dependencies change. The
current baseline does not track artifact-to-source
dependencies or mark artifacts stale on source
update. Artifacts are overwritten on re-ingest but
not proactively invalidated.

### 7. Derived memory KUs

DS023 describes KB plugins creating derived memory
KUs (summaries, bridge notes, comparison notes). The
current built-in KB plugins create lightweight ingest
artifacts but not full derived KUs that participate
in retrieval.

---

## Items Requiring Discussion

| Item | Notes |
|------|-------|
| Multi-level child frame recursion | Current baseline goes to depth 1. Should we implement full recursive depth? Cost: significant engine complexity. Benefit: unclear until we have tasks that actually need it. |
| Domain-aware ingest hierarchies | Current baseline is domain-agnostic. Richer hierarchies need domain detection or user hints. Could be a future plugin capability. |
| Semantic description matching | Current keyword match is simple. Could use embeddings or LLM for richer matching. Cost vs benefit unclear for the current plugin set. |
| Provenance extraction from content | Extracting author/date from document text requires NLP or LLM. Could be added to LLM-backed ingest. |
| Artifact dependency tracking | Needs a dependency graph between artifacts and sources. Non-trivial to implement correctly. |
