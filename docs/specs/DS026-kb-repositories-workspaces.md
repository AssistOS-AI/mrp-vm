# DS026 — KB Repositories and Session Workspaces

## Purpose
Defines the repository/workspace substrate visible to
KB plugins and the core.

## Effective Retrieval View

KB plugins MUST reason over the effective view:

1. current-turn context
2. conversation journal
3. session workspace draft
4. mounted repository
5. plugin-private derived memory/artifacts

## Save/Fork Semantics

Save/fork operations apply to the shared substrate.
Plugin-private artifacts MUST be persisted or marked
stale consistently with the saved workspace state.

## Dependencies

- DS008 — KB substrate
- DS010 — persistence
- DS023 — KB plugins
