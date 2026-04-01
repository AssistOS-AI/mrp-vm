# DS023 — KB Plugins and Goal-Conditioned Retrieval

## Purpose
Defines the `kb-plugin` family that replaces the old
concept of retrieval strategies plus retrieval risk
profiles.

## Design Rule

Retrieval relevance is not an intrinsic property of a
stored unit. It is a conditional judgment about
expected usefulness for the current goal under a
finite context budget.

Therefore KB plugins MUST be:

- goal-conditioned
- context-aware
- budget-aware
- diversity-aware
- able to surface strategy guidance for the planner
- able to perform sufficiency checks

The reference built-in plugins implement a
lightweight version of that rule:

- hybrid candidate generation through one or more
  backends
- deduplication and role-aware scoring
- heuristic sufficiency based on evidence count plus
  preferred-role coverage

Richer marginal-utility scoring and derived-memory
authoring remain forward work.

## Built-In KB Plugins

- `kb-fast`
- `kb-balanced`
- `kb-thinkingdb`

`wide-recall` is removed.

## Core Retrieval Algorithm

Every built-in KB plugin SHOULD implement this
family-level shape. This is not a VM-owned algorithm;
each plugin owns its concrete backends, scoring, and
fusion details.

1. receive normalized goal seeds, context profile,
   and retrieval purpose
2. generate candidates from multiple memory views,
   considering KUs at all hierarchy levels
3. distinguish strategy-guidance KUs from task-
   evidence KUs when both are relevant
4. score candidates by expected marginal utility
5. penalize redundancy
6. select the appropriate abstraction level per KU:
   - use summaries for broad context
   - use intermediate KUs for moderate detail
   - use leaf KUs for specific evidence
7. if a relevant KU is too large, extract only the
   most relevant child KUs or fragments
8. expand to parent KUs when broader context is
   required
9. check whether strategy guidance is sufficient for
   planner dispatch and whether task evidence is
   sufficient for the goal solver

The planner chooses among `kb-plugin`s at stage
granularity. A built-in KB plugin MAY still compose
multiple retrieval backends internally and MAY
perform local cheap-to-heavy escalation between its
primary and secondary retrieval strategies.

If the mounted KB contains procedure, policy,
evaluation, or solver-selection guidance, KB plugins
MUST make that guidance retrievable to the planner,
not only to the goal solver.

When current-turn KUs contain output instructions or
planning hints, KB plugins and retrieval helpers MUST
preserve them as guidance even if those KUs do not
survive evidence-oriented lexical filtering.

## Candidate Sources

KB plugins MAY retrieve from:

- current-turn context
- conversation journal
- session workspace draft
- mounted KB repository
- derived memory units
- plugin-private indices

These sources MAY contain:

- procedural guidance
- evaluation rules
- solver applicability notes
- task evidence

## Semantic Units

The storage/retrieval target is the Knowledge Unit
(DS030), not the file and not an arbitrary fixed
chunk.

A KU SHOULD be:

- semantically coherent at its abstraction level
- large enough to preserve local semantics
- linked to parent/child KUs in the hierarchy
- auditable through provenance

KB plugins MUST be able to traverse the KU hierarchy
to select the right abstraction level for the current
task.

## Derived Memory

KB plugins MAY create derived textual memory units
such as:

- summaries
- bridge notes
- ambiguity notes
- evidence packs
- comparison notes

Derived memories MUST retain provenance and MUST be
invalidated when source dependencies change.

## Built-In Plugin Semantics

### `kb-fast`

- cheapest path
- lexical-first
- small result budget
- suitable for simple focused questions

### `kb-balanced`

- lexical + associative retrieval
- moderate result budget
- diversity-aware reranking
- recommended default

### `kb-thinkingdb`

- lexical + bounded symbolic closure
- can use richer proof-bearing ranking
- intended for multi-hop or relation-sensitive tasks

## Ingest Semantics

On source upload/staging, raw text MUST be offered to
all enabled KB plugins. Each plugin may:

- build or refresh plugin-private indices
- create derived memory units
- store plugin-private artifacts

The reference built-in implementation writes
lightweight plugin-private ingest artifacts that
summarize source
hashes, unit counts, symbolic-fact counts, and role
coverage. Richer derived memories remain optional
future work.

## Dependencies

- DS008 — KB storage substrate
- DS018 — KU tree extraction
- DS024 — HDC/VSA backend used by KB plugins
- DS025 — ThinkingDB backend used by KB plugins
- DS026 — repositories/workspaces
- DS027 — plugin contracts
- DS030 — Knowledge Unit model
