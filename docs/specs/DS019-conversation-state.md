# DS019 — Conversation State

## Purpose
Defines session state after replacing processing
modes and retrieval profiles with typed plugin
preferences.

## Session Preferences

Each session stores:

```javascript
{
  preferredPlannerPlugin,
  preferredSeedDetectorPlugin,
  preferredKBPlugin,
  preferredGoalSolverPlugin,
  preferredModel,
  mountedKbId,
  workspace,
  sessionContextUnits,
  pendingTurnContextUnits
}
```

`preferredModel` remains only as a generic override;
role-based settings are defined by DS028.

Deprecated compatibility fields such as
`preferredProcessingMode` and
`preferredRetrievalProfile` are no longer canonical
session fields. Selection authority belongs to the
typed plugin preferences, and compatibility values
are not part of active runtime session metadata.

## Turn Preparation

The conversation layer resolves:

- explicit request plugin selections
- session plugin preferences
- current mounted KB/workspace
- current system prompt and history

The current implementation uses one shared
plugin-selection resolver for both session creation
and turn preparation so that explicit plugin IDs,
session preferences, and defaults are applied in the
same order.

Request-level explicit plugin selections are exposed
separately from resolved session/default preferences
so the planner can distinguish:

- hard pins from the current request
- soft priors from session state

## Session Context Reuse

Sessions are the canonical mechanism for reusing
conversation-local context across multiple chat turns.

This includes:

- message history
- selected plugin preferences
- accumulated `sessionContextUnits`
- session-local retrieval index built from those units
- the currently loaded KB repository identity
- the session workspace draft derived from that KB

For long conversational source context that should be
reused across later questions, the preferred path is:

1. create or reuse a session
2. load the reusable source through
   `POST /sessions/:id/context`
3. let the selected `sd-plugin` derive KUs for that
   source load
4. commit those KUs directly into
   `sessionContextUnits`
5. ask later questions through `/chat/completions`
   with the same stable `session_id`

This is the default session-level context reuse path.
Explicit workspace or KB source staging is a separate
capability and SHOULD be used only when the user
actually wants source authoring, repository
persistence, or plugin-private artifact generation.

## Session-Scoped KB Lifecycle

KB operations are part of session state, not a
separate global toggle.

The session layer MUST support:

- creating a session with an initial loaded KB
- loading a named KB into an existing session
- saving the current session draft back into a KB
- forking the current session draft into a new KB

When one of those operations occurs, the conversation
layer MUST notify all enabled `kb-plugin`s so each
plugin can update any session-local caches or
repository-local derived state it owns.

Loading a KB into a session does not require the core
to perform extra shared caching work beyond mounting
the repository/workspace view. The main contract is
that all `kb-plugin`s are informed of the session
transition and can choose how to react.

Likewise, loading reusable session context does not
require the shared server layer to build a second
cache structure of its own. The contract is that the
conversation layer commits the derived KUs into the
session and all `kb-plugin`s are notified, after
which each plugin MAY cache or ignore that signal as
it sees fit.

## Turn-Local KU Staging

Before retrieval for a chat turn, the current
`sd-plugin` output MAY include current-turn KUs.
Those KUs MUST be staged into transient session
state as `pendingTurnContextUnits`.

Rules:

- staged turn KUs are visible to the current turn
- staged turn KUs are not yet durable session memory
- on successful turn commit, deduplicated staged KUs
  are promoted into `sessionContextUnits`
- on failed turn completion, staged turn KUs MUST be
  discarded
- `kb-plugin`s MUST be notified when turn KUs are
  staged and when they are committed

## Turn Commit

After success, the session persists:

- selected planner plugin
- selected seed detector plugin
- selected KB plugin
- selected goal solver plugin
- explainability turn entry (request id, user message,
  assistant preview, selected plugin IDs,
  `responseDocument`, and `executionTrace`)

## Explainability Log

Each session owns an in-memory explainability log used
for session debugging and UI drill-down.

The log stores one entry per committed turn and is
exposed through DS013:

- `GET /sessions/:id/explainability`

This log is session-scoped and not a separate global
artifact.

## Dependencies

- DS013 — API
- DS028 — settings interaction
