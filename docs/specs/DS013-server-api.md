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
- if omitted, session preference is used
- if no session preference exists, the default
  planner decides
- `model` is a generic override only; plugins SHOULD
  prefer DS028 role-based settings
- legacy `processing_mode` and `retrieval_profile`
  MAY be accepted temporarily as compatibility aliases
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
`retrieval_profile` during migration.

## Discovery Endpoints

- `GET /plugins`
- `GET /plugins?type=sd-plugin`
- `GET /plugins?type=kb-plugin`
- `GET /plugins?type=gs-plugin`
- `GET /plugins?type=mrp-plan-plugin`

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
