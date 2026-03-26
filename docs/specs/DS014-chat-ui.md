# DS014 — Chat UI

## Purpose
Minimal static page served by the server, providing
a simple session-based text chat interface.

## Description

A single HTML page with CSS and JS inline (or
minimal static files). No frontend frameworks.

## Features

- Text input field + Send button.
- Display user/assistant messages in chronological
  order.
- Creates or resumes a server session and stores
  `session_id` in `localStorage`.
- Calls `POST /v1/chat/completions` with fetch API,
  sending only the new delta messages for the
  current turn, not the full history.
- Renders assistant output as Markdown.
- Loading indicator.
- Visible error states (API errors, timeout,
  session expired, KB ingest failures).

### Session UX
- Session badge showing current `session_id`.
- "New session" action that calls
  `POST /v1/sessions` or clears the local session
  and starts a fresh one.
- Expiry awareness: if the server returns
  `SESSION_EXPIRED`, the UI clears the stale
  `session_id` and prompts the user to start a new
  session.
- Inactivity TTL is enforced server-side (DS019),
  not by the browser.

### File Attachment
- "Attach file" button.
- Only text files accepted (`.md`, `.txt`).
- File is read locally in the browser with
  `FileReader`.
- Content is sent as a JSON string to
  `POST /v1/kb/sources`.
- Visual feedback: "Uploading", "Processing",
  "Ready", or explicit error.

### Runtime Configuration
- Processing mode selector, populated from
  `GET /v1/processing-strategies`.
- Retrieval profile selector, populated from
  `GET /v1/retrieval-profiles`.
- Provider + model selector, populated from
  `GET /v1/models`.
- Local persistence (`localStorage`).
- Reset to default.
- Selected processing mode is sent in the
  `processing_mode` field of chat requests and
  becomes the session preference on the server.
- Selected retrieval profile is sent in the
  `retrieval_profile` field of chat requests and
  becomes the session preference on the server.
- Selected model is sent in the `model` field only
  when the chosen processing mode supports model
  override.
- When `symbolic-only` is selected, the model
  selector is disabled in the UI.

## File Structure

```
src/ui/
├── index.html
├── style.css
└── chat.js
```

## Serving

The Server (DS013) serves static files from
`src/ui/` on the `/` route (GET).

## Non-Functional Requirements

- Works without a build step.
- Accessible (labels, focus management, ARIA).
- Minimal responsive (works on mobile).
- English-only UI (consistent with DS001).
- Session state survives page reload through
  `localStorage`, until the server expires it.

## Dependencies

- DS013 (Server) — serving and API backend.
- DS019 (Conversation) — session semantics.
- DS022 (Processing Strategies) — mode selection.
- DS023 (Retrieval Strategies) — retrieval-profile
  selection.
