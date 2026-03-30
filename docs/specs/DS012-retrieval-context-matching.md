# DS012 — Retrieval & Context Matching

## Purpose
Defines the assembly of `ResolvedIntent` objects from
shared decomposition metadata plus a chosen
`kb-plugin`.

## Architectural Position

The core no longer resolves a retrieval profile by
itself. A planner selects an ordered list of
`kb-plugin`s, and one plugin produces a retrieval
result bundle.

## Main Interface

```javascript
class ContextMatcher {
  async resolve(decomposedIntents, contextProfiles,
    currentTurnUnits, session,
    retrievalProfileOrConfig, kbIndex) ->
    ResolvedIntent[]
}
```

In practice the current implementation may still use
legacy profile-shaped configuration internally, but
that is an implementation detail of built-in
`kb-plugin`s.

## ResolvedIntent

```javascript
{
  intentRef,
  retrievalProfile,
  intentGroup,
  decomposed,
  currentTurnContextUnits,
  sessionUnits,
  kbUnits,
  retrievalTrace,
  resolvedMarkdown
}
```

## Dependency

- DS023 — KB plugins
- DS026 — effective workspace view
