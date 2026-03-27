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
- Each browser tab maintains its own session in
  memory (no localStorage/cookie persistence for
  session ID). Refresh or new tab starts fresh.
- Calls `POST /chat/completions` with fetch API,
  sending only the new delta messages for the
  current turn, not the full history.
- Renders assistant responses as a 4-column table
  (Act, Intent, Context, Answer) when structured
  `response_document` is available. Falls back to
  Markdown rendering otherwise.
- Loading indicator.
- Visible error states (API errors, timeout,
  session expired, KB ingest failures).

### Session UX
- Session badge showing current `session_id`.
- Mounted KB badge showing the active KB
  repository.
- Draft badge showing whether the current KB draft
  is saved or unsaved.
- "New session" action clears the in-memory session
  and message history.
- Expiry awareness: if the server returns
  `SESSION_EXPIRED`, the UI automatically resets
  the session and retries the message transparently.
- Inactivity TTL is enforced server-side (DS019),
  not by the browser.

### File Attachment
- "Attach file" button.
- Only text files accepted (`.md`, `.txt`).
- File is read locally in the browser with
  `FileReader`.
- Content is staged into the session workspace via
  `POST /sessions/:sessionId/workspace/sources`.
- Before staging a file, the UI MUST make it clear
  whether the file is being added to the current
  session draft or whether the user wants to fork
  the mounted KB first.
- Visual feedback: "Uploading", "Processing",
  "Ready", or explicit error.

### KB Controls
- KB selector populated from `GET /kbs`.
- Explicit `Load KB` action for mounting a KB into
  the current session.
- Explicit `Fork KB` action for creating a new KB
  from the current session draft.
- Explicit `Save KB` action for persisting the
  current draft.
- The UI MUST never imply that chat activity or file
  upload has already overwritten the persistent KB
  unless a save action has completed successfully.

### Runtime Configuration
- Processing mode selector, populated from
  `GET /processing-strategies`.
- Retrieval profile selector, populated from
  `GET /retrieval-profiles`.
- Provider + model selector, populated from
  `GET /models`.
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
- Session ID is per-tab (in-memory), not persisted.
  UI preferences (mode, profile, model) persist
  in `localStorage` across tabs.

## Dependencies

- DS013 (Server) — serving and API backend.
- DS019 (Conversation) — session semantics.
- DS022 (Processing Strategies) — mode selection.
- DS023 (Retrieval Strategies) — retrieval-profile
  selection.
