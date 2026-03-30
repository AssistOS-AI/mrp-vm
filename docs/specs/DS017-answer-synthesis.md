# DS017 — Answer Synthesis

## Purpose
Defines the final response semantics that goal solver
plugins must respect.

## Architectural Position

Answer synthesis is no longer a core-selected
"processing strategy". It is typically implemented by
a `gs-plugin`.

## Requirements for `gs-plugin`s

- respect evidence grounding
- preserve per-intent grouping
- surface helper-plugin output explicitly
- support deterministic `no-context` rendering or
  return a structured failure

## Output

Goal solver plugins return:

```javascript
{
  responseDocument,
  responseMarkdown
}
```

## Dependencies

- DS012 — resolved intents
- DS022 — goal solver family
- DS027 — goal solver contract
