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
- able to perform sufficiency checks

The current built-in plugins implement a lightweight
baseline of that rule:

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

Every KB plugin SHOULD implement this generic shape:

1. receive normalized goal seeds and context profile
2. generate candidates from multiple memory views
3. score candidates by expected marginal utility
4. penalize redundancy
5. expand to parent units when broader context is
   required
6. check sufficiency before handing evidence to the
   goal solver

The planner chooses among `kb-plugin`s at stage
granularity. A built-in KB plugin MAY still compose
multiple retrieval backends internally and MAY
perform local cheap-to-heavy escalation between its
primary and secondary retrieval strategies.

## Candidate Sources

KB plugins MAY retrieve from:

- current-turn context
- conversation journal
- session workspace draft
- mounted KB repository
- derived memory units
- plugin-private indices

## Semantic Units

The storage/retrieval target is the semantic unit,
not the file and not an arbitrary fixed chunk.

A unit SHOULD be:

- the smallest stable meaningful retrievable piece
- large enough to preserve local semantics
- linked to parent/child units
- auditable through provenance

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

The current built-in baseline writes lightweight
plugin-private ingest artifacts that summarize source
hashes, unit counts, symbolic-fact counts, and role
coverage. Richer derived memories remain optional
future work.

## Dependencies

- DS008 — KB storage substrate
- DS018 — semantic unit extraction
- DS024 — HDC/VSA backend used by KB plugins
- DS025 — ThinkingDB backend used by KB plugins
- DS026 — repositories/workspaces
- DS027 — plugin contracts
