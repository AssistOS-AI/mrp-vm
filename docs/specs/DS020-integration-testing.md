# DS020 — Integration Testing

## Purpose
Defines code-level integration testing for the
plugin-kernel architecture.

## Required Coverage

- seed detector plugins
- KB plugins
- goal solver plugins
- planner plugins
- session/workspace flow
- settings read/write flow

## Determinism Rule

Planner learning MUST be disableable or made
deterministic in test mode.

## Compatibility Rule

Legacy compatibility aliases may be tested, but the
primary matrix is now expressed in typed plugin IDs.
