# DS013 — Server & API

## Purpose
Defines the HTTP API for session-scoped chat,
typed plugin selection, KB lifecycle, and execution
explainability.

## Chat Request

`POST /chat/completions`

```json
{
  "session_id": "sess-abc123",
  "planner_plugin": "planner-default",
  "seed_detector_plugin": "sd-llm-fast",
  "kb_plugin": "kb-balanced",
  "goal_solver_plugin": "gs-llm-fast",
  "deliberation_level": 2,
  "model": "provider/model-name",
  "messages": [
    { "role": "user", "content": "..." }
  ],
  "stream": true
}
```

Rules:

- explicit plugin IDs are optional
- if omitted, session plugin preference is used
- if no preference exists, engine defaults/planner
  fallback order apply
- `model` is a generic override only; plugins SHOULD
  prefer DS028 role-based settings
- `deliberation_level` is optional and initializes the
  root frame deliberation policy defined by DS033
- legacy request aliases (`processing_mode`,
  `retrieval_profile`) are not part of active runtime
  contract and must not be required by clients

If `stream: true`, the server returns an SSE stream.

## SSE Events

Minimum events:

- `progress` — overwrite-friendly execution updates
- `response.meta` — session/plugin metadata
- `response.delta` — incremental answer text
- `response.completed` — final completion payload
- `error` — terminal structured error

## Response

Success payload includes:

```json
{
  "request_id": "req-abc123",
  "session_id": "sess-abc123",
  "planner_plugin": "planner-default",
  "seed_detector_plugin": "sd-symbolic",
  "kb_plugin": "kb-fast",
  "goal_solver_plugin": "gs-symbolic",
  "deliberation_level": 2,
  "response_document": {},
  "execution_trace": {}
}
```

For explicit multi-question prompts that decompose into
independent child frames, `response_document.groups`
MUST preserve one answer group per admitted question
intent, and `execution_trace` MUST expose the
corresponding root child frames plus the aggregate root
closure reason (for example
`parallel_intent_aggregation`).

Structured errors expose `MRPError.toJSON()` fields
when available (including `requestId`, `sessionId`,
and `timestamp`).

If a stale/missing `session_id` is supplied, the API
returns structured `SESSION_NOT_FOUND` or
`SESSION_EXPIRED`.

## Discovery Endpoints

- `GET /plugins`
- `GET /plugins?type=sd-plugin`
- `GET /plugins?type=kb-plugin`
- `GET /plugins?type=gs-plugin`
- `GET /plugins?type=mrp-plan-plugin`

Legacy discovery endpoints for processing/retrieval
aliases are removed from active runtime API.

## Settings Endpoints

- `GET /settings/llm-roles`
- `PUT /settings/llm-roles`

## Session Endpoints

- `POST /sessions`
- `GET /sessions/:id`
- `DELETE /sessions/:id`
- `GET /sessions/:id/explainability`

`POST /sessions` may accept typed plugin selections,
`kb_id`, and `deliberation_level`.

Session metadata includes selected plugin IDs and
workspace metadata (dirty state, source/unit counts,
save timestamp), `deliberation_level`, and
`explainability_turn_count`.

## Explainability Endpoint

`GET /sessions/:id/explainability` returns a
session-level execution registry for completed chat
turns.

Each entry includes:

- `requestId`
- `turnIndex`
- `createdAt`
- `userMessage`
- `assistantPreview`
- selected planner/sd/kb/gs plugin IDs
- selected `deliberationLevel`
- `responseDocument`
- `executionTrace`

This is the canonical API used by the UI
Explainability panel and per-response deep links to
render non-linear execution frames.

`executionTrace.graph` is the graph-first explainability
payload defined by DS034.

The API MUST expose enough data to render:

- frame containers
- frame policy/candidate/comparison/challenge nodes
- plugin execution boxes
- directed edges between executions
- node status and duration badges
- click-to-inspect input/output details per plugin
  execution

The API MUST NOT assume that the UI will render the
raw user message as a large text block before the
graph. In the graph view, the root user message is
treated as the input of the first plugin execution.

## Session Context Endpoint

`POST /sessions/:id/context`

Canonical API for loading reusable context into an
existing session without appending synthetic user/
assistant messages.

Rules:

- resolves effective `seed_detector_plugin` by normal
  session precedence
- uses selected seed detector ingest strategy
- converts content to KUs through standard ingest
  helpers
- commits resulting KUs into `sessionContextUnits`
- does not dirty mounted workspace for context load
- notifies all enabled `kb-plugin`s

## KB Catalog Endpoints

- `GET /kbs`
- `POST /kbs`

Rules:

- each KB has human-readable `name`
- each KB has cryptographically random stable ID
- list payload includes both name and ID

## Session-Scoped KB Endpoints

- `POST /sessions/:id/kb/load`
- `POST /sessions/:id/kb/mount` (compatibility alias
  of `.../kb/load`)
- `POST /sessions/:id/kb/save`
- `POST /sessions/:id/kb/fork`

## Workspace Source Staging

`POST /sessions/:id/workspace/sources` stages source
text into the mounted workspace draft and triggers
plugin source-text hooks.

This is a draft operation until explicit save/fork.

## Other Endpoints

- `GET /eval-sources`
- `GET /health`
- `GET /ready`

## Dependencies

- DS014 — UI
- DS034 — execution graph explainability
- DS019 — session state
- DS026 — repositories/workspaces
- DS028 — role settings
