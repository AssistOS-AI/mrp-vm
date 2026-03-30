# DS021 — Evaluation

## Purpose
Defines behavioral evaluation for the plugin-kernel
system.

## Evaluation Matrix

Suites SHOULD record:

- planner plugin used
- seed detector plugin used
- KB plugin used
- goal solver plugin used
- LLM role assignments used

The evaluation runner MAY still accept legacy
compatibility aliases such as `processing_mode` and
`retrieval_profile` during migration, but plugin IDs
are the preferred reporting surface.

## Key Metrics

- grounded answer rate
- sufficient-context rate
- planner fallback rate
- expensive-plugin avoidance rate
- plugin-specific success rate
