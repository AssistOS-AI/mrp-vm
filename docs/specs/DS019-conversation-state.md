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

The implementation MAY still carry deprecated
compatibility fields such as
`preferredProcessingMode` and
`preferredRetrievalProfile` while migration is in
progress. These are aliases, not first-class
architecture concepts.

## Turn Preparation

The conversation layer resolves:

- explicit request plugin selections
- session plugin preferences
- current mounted KB/workspace
- current system prompt and history

## Turn Commit

After success, the session persists:

- selected planner plugin
- selected seed detector plugin
- selected KB plugin
- selected goal solver plugin

## Dependencies

- DS013 — API
- DS028 — settings interaction
