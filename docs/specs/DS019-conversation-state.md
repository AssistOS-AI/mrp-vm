# DS019 — Conversation State

## Purpose
Manages in-memory session state between user and
system. Defines how current-turn messages become
prompt history and how previous user turns become a
temporary Context CNL store.

## Description

The public API remains OpenAI-shaped, but the server
is session-centric in v1. A client may send only the
new messages for the current turn together with a
`session_id`; the server stores the prior transcript
and the derived temporary context.

## Supported Client Roles in v1

- `user` — current user message.
- `system` — session-level instructions.

`assistant`, `tool`, and `function` are server-owned
or unsupported in v1 request bodies.

## Session State

Each session stores:

```javascript
{
  sessionId: "sess-abc123",
  createdAt: "...",
  lastActivityAt: "...",
  expiresAt: "...",
  preferredModel: "provider/model-name" | null,
  preferredProcessingMode: "llm-assisted" |
    "symbolic-only",
  preferredRetrievalProfile: "fast" | "balanced" |
    "wide-recall",
  messageLog: Message[],
  systemPrompt: string | null,
  sessionContextUnits: ContextUnit[],
  sessionIndex: KBIndexLike
}
```

`messageLog` is for transcript continuity and prompt
history.

`sessionContextUnits` is a temporary in-memory KB
derived only from previous user turns.

## What Enters the Session Context Store

Allowed:
- factual project details
- user preferences
- environmental constraints
- assumptions that may matter later
- stable work-in-progress facts introduced by the
  user

Rejected:
- direct requests
- questions
- commands
- task lists
- assistant responses
- copied prior assistant output

The filtering itself is produced by
`Normalizer.toSessionContextCNL()` (DS006) and then
validated structurally (DS007).

## Turn Preparation

For an incoming request:

1. Resolve or create the session.
2. Expire it first if `expiresAt < now`.
3. Append any new `system` message to the session
   system prompt.
4. Extract the last new `user` message as
   `currentMessage`.
5. Build bounded `historyForPrompt` from the stored
   message log.
6. Resolve the effective processing mode from the
   current request or session preference.
7. Resolve the effective retrieval profile from the
   current request or session preference.
8. Expose the current `sessionIndex` for retrieval.

## Turn Commit

Only after a successful response:

1. Append the current `user` message to `messageLog`.
2. Append the assistant Markdown response to `messageLog`.
3. Insert the current-turn context units into `sessionContextUnits`, performing **content-based deduplication** using unit hashes. If a unit with the same hash already exists in the session store, it is not added again.
4. Rebuild or incrementally update `sessionIndex`.
5. Persist the selected processing mode as session
   preference.
6. Persist the selected retrieval profile as session
   preference.
7. Update `lastActivityAt` and `expiresAt`.

If the turn fails, nothing from that turn is added to
the session context store.

## Session Expiration

- Sessions are in-memory only.
- Sessions expire after configurable inactivity.
- Expiration is checked lazily on access and may
  also be cleaned by a periodic sweep.
- Expired sessions return `SESSION_EXPIRED` and must
  not be revived implicitly.

## Limits

- `maxHistoryMessagesForPrompt`: 20 (configurable).
- `maxHistoryCharsForPrompt`: 16000
  (configurable).
- `sessionIdleTtlMinutes`: 30 (configurable).
- `maxSessionContextUnits`: 200 (configurable).
- `maxSessions`: 1000 (configurable).

## Configuration

`config/conversation.json`:
```json
{
  "maxHistoryMessagesForPrompt": 20,
  "maxHistoryCharsForPrompt": 16000,
  "sessionIdleTtlMinutes": 30,
  "maxSessionContextUnits": 200,
  "defaultProcessingMode": "llm-assisted",
  "defaultRetrievalProfile": "balanced",
  "maxSessions": 1000
}
```

## Main Interface

```javascript
class ConversationHandler {
  createSession(model, processingMode,
    retrievalProfile) → SessionState
  getSession(sessionId) → SessionState | null
  deleteSession(sessionId) → void
  prepareTurn(sessionId, messages, model,
    processingMode, retrievalProfile) → {
    session: SessionState,
    currentMessage: string,
    historyForPrompt: Message[],
    systemPrompt: string | null,
    requestedModel: string | null,
    requestedProcessingMode: string | null,
    requestedRetrievalProfile: string | null
  }
  commitSuccessfulTurn(session, currentUserMessage,
    assistantMarkdown, currentTurnContextUnits,
    selectedModel, selectedProcessingMode,
    selectedRetrievalProfile) → void
  expireInactiveSessions() → number
}
```

## Dependencies

- DS013 (Server) — session-aware API.
- DS002 (Core) — uses turn preparation and commit.
- DS006 (Normalizer) — session-context extraction.
- DS012 (Retrieval) — searches the temporary
  session context index.
- DS022 (Processing Strategies) — mode preference.
- DS023 (Retrieval Strategies) — retrieval profile
  preference.
