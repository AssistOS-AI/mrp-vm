# DS013 — Server & API

## Purpose
Native Node.js HTTP server that exposes OpenAI-shaped
minimal APIs, session management APIs, and serves a
static chat page.

## Compatibility Note

The API is "OpenAI-shaped minimal" — it uses the same
request/response envelope style as OpenAI for the
subset supported in v1, but adds explicit session
extensions and is not a complete implementation of
the OpenAI specification.

## API Endpoints

### POST /v1/chat/completions
Main endpoint.

Request:
```json
{
  "session_id": "sess-abc123",
  "processing_mode": "llm-assisted",
  "retrieval_profile": "balanced",
  "model": "provider/model-name",
  "messages": [
    { "role": "system", "content": "..." },
    { "role": "user", "content": "Please compare..." }
  ],
  "stream": false
}
```

Rules:
- `session_id` is optional.
- `processing_mode` is optional.
- `retrieval_profile` is optional.
- If absent, the server creates a new session before
  processing the turn.
- If present, the server loads that session and
  appends only the new delta messages from this
  request.
- The client does NOT need to resend full history
  when `session_id` is present.
- At least one new `user` message is required.
- Client-authored `assistant` messages are not
  accepted in v1 session mode.

Supported processing modes in v1:
- `llm-assisted`
- `symbolic-only`

If `processing_mode` is absent, the session
preference is used; if none exists, the deployment
default from DS022 applies.

If `retrieval_profile` is absent, the session
preference is used; if none exists, the deployment
default from DS023 applies.

Supported client roles in v1: `user`, `system`.
Other roles return 400.

`model` field is active in v1. If provided, it is
passed to LLMBridge as the requested model and also
stored as the session preference for subsequent turns.
If absent, the session preference is used; if the
session has none, the default selection policy from
DS015 applies.

If `processing_mode` does not support model override
(for example `symbolic-only`) and `model` is
provided, return 400
`STRATEGY_DOES_NOT_ACCEPT_MODEL`.

`stream: true` is not supported in v1. If
requested, returns 400.

Response (success):
```json
{
  "id": "mrp-<requestId>",
  "object": "chat.completion",
  "created": 1711440000,
  "session_id": "sess-abc123",
  "processing_mode": "llm-assisted",
  "retrieval_profile": "balanced",
  "expires_at": "2026-03-26T10:00:00Z",
  "choices": [{
    "index": 0,
    "message": {
      "role": "assistant",
      "content": "# MRP Response\n\n## Intent Group 1\n..."
    },
    "finish_reason": "stop"
  }],
  "usage": {
    "prompt_tokens": 0,
    "completion_tokens": 0,
    "total_tokens": 0
  }
}
```

`choices[0].message.content` is Markdown generated
from DS017. It is grouped by normalized intent and
includes the intent-local context used for the answer.

`usage` is populated with 0 in v1 unless
AchillesAgentLib exposes provider token counts.

Response (error):
```json
{
  "error": {
    "code": "SESSION_EXPIRED",
    "message": "...",
    "type": "processing_error"
  }
}
```

HTTP status codes:
- 200 — success
- 400 — invalid input, invalid role, stream requested
- 404 — unknown endpoint
- 410 — session expired
- 500 — internal error
- 504 — timeout

### POST /v1/sessions
Creates an empty in-memory session explicitly.

Request:
```json
{
  "processing_mode": "llm-assisted",
  "retrieval_profile": "balanced",
  "model": "provider/model-name"
}
```

Rules:
- `processing_mode` is optional.
- If absent, the deployment default from DS022 is
  used.
- `retrieval_profile` is optional.
- If absent, the deployment default from DS023 is
  used.
- `model` is optional.
- If the selected `processing_mode` does not support
  model override, providing `model` returns 400
  `STRATEGY_DOES_NOT_ACCEPT_MODEL`.
- If `model` is absent, the session starts with no
  model preference and the DS015 default selection
  applies later when an LLM-backed turn needs one.

Response:
```json
{
  "session_id": "sess-abc123",
  "created_at": "2026-03-26T09:30:00Z",
  "expires_at": "2026-03-26T10:00:00Z",
  "processing_mode": "llm-assisted",
  "retrieval_profile": "balanced",
  "model": "provider/model-name"
}
```

### GET /v1/sessions/:sessionId
Returns session metadata only.

Response:
```json
{
  "session_id": "sess-abc123",
  "created_at": "2026-03-26T09:30:00Z",
  "last_activity_at": "2026-03-26T09:44:00Z",
  "expires_at": "2026-03-26T10:14:00Z",
  "message_count": 6,
  "session_context_unit_count": 8,
  "processing_mode": "llm-assisted",
  "retrieval_profile": "balanced",
  "model": "provider/model-name"
}
```

### DELETE /v1/sessions/:sessionId
Deletes a session immediately. Response: 204 No
Content.

### GET /v1/models
Returns available LLM providers and models
discovered by AchillesAgentLib.

Response:
```json
{
  "models": [
    {
      "id": "provider/model-name",
      "provider": "provider",
      "tags": ["fast"]
    }
  ]
}
```

### GET /v1/processing-strategies
Returns the available language processing modes.

Response:
```json
{
  "strategies": [
    {
      "id": "llm-assisted",
      "uses_llm": true,
      "supports_model_override": true,
      "capabilities": [
        "normalize-intent",
        "extract-session-context",
        "normalize-persistent-context",
        "synthesize-response"
      ]
    },
    {
      "id": "symbolic-only",
      "uses_llm": false,
      "supports_model_override": false,
      "capabilities": [
        "normalize-intent",
        "extract-session-context",
        "normalize-persistent-context",
        "synthesize-response"
      ]
    }
  ]
}
```

### GET /v1/retrieval-profiles
Returns the available retrieval-risk profiles.

Response:
```json
{
  "profiles": [
    {
      "id": "fast",
      "enabled_strategies": ["bm25-lexical"]
    },
    {
      "id": "balanced",
      "enabled_strategies": ["bm25-lexical"]
    },
    {
      "id": "wide-recall",
      "enabled_strategies": ["bm25-lexical"]
    },
    {
      "id": "symbolic-grounded",
      "enabled_strategies": ["bm25-lexical"]
    },
    {
      "id": "meta-rational",
      "enabled_strategies": ["bm25-lexical"]
    }
  ]
}
```

### POST /v1/kb/sources
Attach a new source to persistent KB.

Request:
```json
{
  "name": "document.md",
  "content": "... NL text ..."
}
```

`content` is plain text (string). Binary files
are not supported in v1. Max size: configurable
(default 1MB).

Ingest is synchronous and source-atomic — the
request blocks until the source is fully normalized,
indexed, and committed, or it fails with no partial
commit.

Response (success, 200):
```json
{
  "sourceId": "src-001",
  "name": "document.md",
  "status": "ready",
  "unitCount": 12
}
```

### PUT /v1/kb/sources/:sourceId
Update an existing source. Same format as POST.
The previous committed version remains active until
the new version is fully processed and swapped in.

### DELETE /v1/kb/sources/:sourceId
Delete a source. Response: 204 No Content.

### GET /v1/kb/sources
List KB sources.
Response: `{ "sources": [SourceMeta...] }`

### GET /v1/kb/sources/:sourceId
Source details.
Response: `SourceMeta`

### GET /health
Liveness check. Response: `{ "status": "ok" }`

### GET /ready
Readiness check. Verifies:
- Config valid
- KB loaded
- Index available
- Session manager ready
- Wrappers scanned

Response:
```json
{
  "ready": true,
  "checks": {
    "config": true,
    "kb": true,
    "index": true,
    "sessions": true,
    "wrappers": true
  }
}
```

## Implementation

- Native Node.js HTTP server (`http.createServer`),
  no Express or other frameworks.
- Simple manual routing based on path + method.
- Manual JSON body parsing.
- Configurable CORS headers.
- Request ID generated per request, propagated
  in logging.
- Limits: configurable max body size.

## Configuration

`config/server.json`:
```json
{
  "port": 3000,
  "host": "127.0.0.1",
  "cors": {
    "origin": "http://localhost:3000"
  },
  "maxBodySizeBytes": 2097152
}
```

## Dependencies

- DS002 (Core) — request processing.
- DS008 (KB) — source CRUD operations.
- DS014 (Chat UI) — static page serving.
- DS015 (LLMBridge) — model discovery for
  `/v1/models`.
- DS022 (Processing Strategies) — mode discovery and
  default mode resolution.
- DS023 (Retrieval Strategies) — retrieval-profile
  discovery and default profile resolution.
- DS019 (Conversation) — session lifecycle and
  current-turn extraction.
