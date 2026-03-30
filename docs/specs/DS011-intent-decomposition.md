# DS011 — Intent Decomposition

## Purpose
Defines shared symbolic decomposition helpers applied
after seed detection.

## Architectural Position

The core or plugins may use this DS to derive
comparison targets, criteria, and context needs from
Intent CNL produced by an `sd-plugin`.

## Dependencies

- DS006 — normalized intent input
- DS012 — resolved-intent assembly
