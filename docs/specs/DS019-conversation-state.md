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
  sessionContextUnits
}
```

`preferredModel` remains only as a generic override;
role-based settings are defined by DS028.

Deprecated compatibility fields such as
`preferredProcessingMode` and
`preferredRetrievalProfile` are no longer canonical
session fields. Selection authority belongs to the
typed plugin preferences, and compatibility values
are derived from those plugin IDs when needed.

## Turn Preparation

The conversation layer resolves:

- explicit request plugin selections
- session plugin preferences
- deprecated legacy aliases only as a fallback after
  explicit and session plugin preferences
- current mounted KB/workspace
- current system prompt and history

The current implementation uses one shared
plugin-selection resolver for both session creation
and turn preparation so that explicit plugin IDs,
session preferences, legacy aliases, and defaults are
applied in the same order.

Request-level explicit plugin selections are exposed
separately from resolved session/default preferences
so the planner can distinguish:

- hard pins from the current request
- soft priors from session state

## Turn Commit

After success, the session persists:

- selected planner plugin
- selected seed detector plugin
- selected KB plugin
- selected goal solver plugin

Legacy `processing_mode` and `retrieval_profile`
values returned by the API are derived from those
selected plugin IDs instead of being persisted as a
separate source of truth.

## Dependencies

- DS013 — API
- DS028 — settings interaction
