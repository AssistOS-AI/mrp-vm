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

During a normal chat turn, the selected `sd-plugin`
SHOULD emit both problem seeds and current-turn KUs
in one detection pass. The server/core layer MUST
stage those KUs into the current session before KB
retrieval and MUST notify enabled `kb-plugin`s.

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

Creating a session MUST also create the session-local
workspace state and notify all enabled `kb-plugin`s
that a new session exists. If the session is created
with an initial `kb_id`, or if the default KB is
mounted, the server MUST then issue the normal
session-scoped KB load notification for that mounted
repository.

## Session Context Endpoint

`POST /sessions/:id/context`

This is the canonical API for loading reusable source
content into an existing session without pretending
that the source load is an ordinary user question.

Example:

```json
{
  "name": "story.nl",
  "content": "Long reusable source text...",
  "seed_detector_plugin": "sd-llm-fast"
}
```

Rules:

- the server MUST resolve the effective
  `seed_detector_plugin` using the same precedence as
  other session-scoped operations
- the selected `sd-plugin` MUST provide an ingest
  strategy for persistent/context normalization
- the server MUST turn the uploaded content into
  KUs through the normal ingest helpers
- the resulting KUs MUST be committed directly into
  `sessionContextUnits`
- the operation MUST NOT append synthetic user or
  assistant messages to the conversation log
- the operation MUST NOT dirty the mounted workspace
  merely because reusable session context was loaded
- all enabled `kb-plugin`s MUST be notified that
  session KUs were added so they can update any
  session-local caches they own

For multi-turn evaluation or conversational source
reuse, the canonical path is therefore:

1. `POST /sessions`
2. `POST /sessions/:id/context`
3. repeated `POST /chat/completions` with the same
   `session_id`

## KB Catalog Endpoints

- `GET /kbs`
- `POST /kbs`

KB repositories are first-class named objects.

Rules:

- each KB MUST have a human-readable `name`
- each KB MUST have a unique, cryptographically
  random stable ID
- `GET /kbs` MUST list both the display `name` and
  the stable ID
- `POST /kbs` creates a new empty KB repository; it
  does not automatically change any existing session
  unless a session-scoped load endpoint is called

The canonical list payload SHOULD include:

```json
{
  "kbs": [
    {
      "id": "kb-a1b2c3d4e5f60708",
      "kbId": "kb-a1b2c3d4e5f60708",
      "name": "Research Notes"
    }
  ]
}
```

## Workspace Source Staging

`POST /sessions/:id/workspace/sources` is a secondary
API for explicit source staging into the mounted
workspace / KB draft.

It SHOULD be used when the caller needs:

- workspace-backed source persistence
- KB-style source ingestion
- save / fork flows
- plugin source-text hooks and derived artifacts

It is not the default conversational path for
multi-turn question answering when a normal
session-backed chat flow is sufficient.

## Session-Scoped KB Endpoints

The canonical KB operations for an interactive chat
client are session-scoped:

- `POST /sessions/:id/kb/load`
- `POST /sessions/:id/kb/save`
- `POST /sessions/:id/kb/fork`

`POST /sessions/:id/kb/mount` MAY remain as a
compatibility alias for `.../kb/load`, but the
session-scoped load terminology is preferred because
the operation means "make this KB active inside this
session".

Rules:

- chat clients SHOULD use these endpoints instead of
  trying to switch KBs implicitly through ordinary
  `/chat/completions` traffic
- loading a KB into a session means the server may
  hydrate workspace/plugin-private state for that
  session and MUST notify all enabled `kb-plugin`s
- saving or forking a KB from a session MUST preserve
  the session/workspace semantics from DS019 and
  MUST notify all enabled `kb-plugin`s after the
  repository target is materialized
- source staging through `/workspace/sources` remains
  a draft operation until an explicit session-scoped
  save or fork occurs

## Dependencies

- DS014 — UI
- DS019 — session preferences
- DS026 — repositories/workspaces
- DS028 — settings payloads
