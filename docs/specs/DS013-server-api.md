# DS013 — Server & API

## Purpose
Defines the API after replacing modes/profiles with
typed plugin selections and shared settings.

## Chat Request

`POST /chat/completions`

```json
{
  "session_id": "sess-abc123",
  "planner_plugin": "planner-default",
  "seed_detector_plugin": "sd-llm-fast",
  "kb_plugin": "kb-balanced",
  "goal_solver_plugin": "gs-llm-fast",
  "model": "provider/model-name",
  "messages": [
    { "role": "user", "content": "..." }
  ]
}
```

Rules:

- explicit plugin IDs are optional
- if omitted, session plugin preference is used
- only if no explicit or session plugin preference
  exists may the server/conversation layer fall back
  to a legacy alias such as `processing_mode` or
  `retrieval_profile`
- if no session preference exists, the default
  planner decides
- `model` is a generic override only; plugins SHOULD
  prefer DS028 role-based settings
- legacy `processing_mode` and `retrieval_profile`
  MAY be accepted temporarily as compatibility aliases
- the current server still validates those legacy
  aliases through explicit compatibility mappings
  from typed plugin IDs while migration endpoints
  remain available
- legacy discovery endpoints MAY remain temporarily:
  `GET /processing-strategies` and
  `GET /retrieval-profiles`

## Response

Success response additionally returns:

```json
{
  "planner_plugin": "planner-default",
  "seed_detector_plugin": "sd-symbolic",
  "kb_plugin": "kb-fast",
  "goal_solver_plugin": "gs-llm-fast",
  "execution_trace": {}
}
```

The response MAY still echo deprecated compatibility
fields such as `processing_mode` and
`retrieval_profile` during migration. When echoed,
they may be derived from the selected plugin IDs
rather than stored as first-class session state.

Structured error payloads SHOULD expose the full
`MRPError.toJSON()` surface when available, including
`requestId`, `sessionId`, and `timestamp`.

## Discovery Endpoints

- `GET /plugins`
- `GET /plugins?type=sd-plugin`
- `GET /plugins?type=kb-plugin`
- `GET /plugins?type=gs-plugin`
- `GET /plugins?type=mrp-plan-plugin`

Legacy discovery endpoints remain compatibility-only
surfaces derived from alias mappings plus the typed
plugin registry:

- `GET /processing-strategies`
- `GET /retrieval-profiles`

## Settings Endpoints

- `GET /settings/llm-roles`
- `PUT /settings/llm-roles`

## Session Endpoints

`POST /sessions` MAY accept:

```json
{
  "planner_plugin": "planner-default",
  "seed_detector_plugin": "sd-symbolic",
  "kb_plugin": "kb-fast",
  "goal_solver_plugin": "gs-symbolic",
  "kb_id": "default"
}
```

The session metadata response SHOULD also include the
selected plugin IDs alongside any deprecated
compatibility fields still carried for migration.

## Dependencies

- DS014 — UI
- DS019 — session preferences
- DS028 — settings payloads
