# DS025 — ThinkingDB Symbolic Backend (kb-thinkingdb)

## Purpose
Defines the symbolic retrieval backend used
internally by the built-in `kb-thinkingdb` plugin.

This is a plugin-private backend, not a VM-level
shared service. The VM core does not depend on or
reference ThinkingDB directly. Other KB plugins are
free to use entirely different symbolic strategies.

## Architectural Position

- ThinkingDB is a backend owned by `kb-thinkingdb`
- the VM core provides only the LLM bridge and
  execution frame machinery; all retrieval logic
  belongs to plugins
- it complements lexical retrieval with relation- and
  closure-aware evidence selection

## Main Interface

```javascript
class ThinkingDBSymbolicStrategy extends RetrievalStrategy {
  getId() -> "thinkingdb-symbolic"
  retrieve({
    contextProfile,
    currentTurnUnits,
    sessionIndex,
    kbIndex,
    budget
  }) -> RetrievalResult
}
```

## Input Knowledge

The backend loads units from:

- current turn
- session index
- persistent KB index

Only units carrying symbolic fields such as
`subject`, `relation`, and `object` participate in
symbolic closure, but non-symbolic metadata can still
be preserved in the returned candidate records.

## Runtime Steps

1. create a transient `ThinkingDB` instance
2. register configured symbolic rules
3. load current-turn, session, and KB units
4. query the transient DB using the current
   `contextProfile`
5. return ranked candidates, excluding current-turn
   items from the final backend candidate list

## Bounded Closure

The current baseline uses bounded closure rather than
global theorem proving.

The main runtime limits are:

- `maxDepth`
- `maxCandidates`

The goal is tractable retrieval, not complete
inference.

## Result Shape

```javascript
{
  strategyId: "thinkingdb-symbolic",
  candidates: [{
    unitId,
    store: "session" | "kb",
    rawScore,
    normalizedScore,
    unit,
    notes
  }],
  durationMs,
  exhaustedBudget
}
```

## Intended Use

This backend is most useful when the task depends on:

- relation-sensitive lookup
- short multi-hop reasoning
- proof-like retrieval traces
- symbolic disambiguation

It is not the default cheapest path.

## Dependencies

- DS005 — symbolic fact fields on Context CNL units
- DS023 — KB plugin fusion and sufficiency
- DS026 — effective retrieval view
