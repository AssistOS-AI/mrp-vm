# DS026 — KB Repositories and Session Workspaces

## Purpose
Defines the repository/workspace substrate visible to
KB plugins and the core.

## Repository Identity

Each KB repository is a first-class object with:

- a human-readable `name`
- a stable unique ID generated from a
  cryptographically strong random source

The name is for users. The ID is for APIs,
persistence, and session mounting.

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

## Session Lifecycle Notifications

The conversation/server layer MUST notify every
enabled `kb-plugin` when:

- a new session is created
- a KB repository is loaded into a session
- a session draft is saved into a KB
- a session draft is forked into a new KB
- current-turn KUs are staged into a session
- staged KUs are committed into durable session
  memory

These notifications are the contract by which
`kb-plugin`s may maintain session-local caches,
plugin-private derived data, or repository-specific
state. The core does not prescribe what each plugin
must cache; it only guarantees the notification and
the mounted repository/workspace context.

## Dependencies

- DS008 — KB substrate
- DS010 — persistence
- DS019 — session state
- DS023 — KB plugins
