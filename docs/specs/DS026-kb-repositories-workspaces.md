# DS026 — KB Repositories and Session Workspaces

## Purpose
Defines the distinction between persistent KB
repositories and mutable session workspaces.

## Core Model

MRP-VM MUST separate:

1. `KB repository`
Persistent, named, forkable knowledge base stored on
disk.

2. `Session workspace`
Mutable draft view attached to one mounted KB
repository for the lifetime of a session.
Its persisted filesystem location is separate from
the KB repository tree, typically
`data/workspaces/<sessionId>/`.

3. `Conversation journal`
Facts extracted from the conversation. These are
visible to retrieval during the session, but they
are not committed into a KB repository until an
explicit save/fork action.

## Invariants

- A session always works against exactly one mounted
  KB repository at a time.
- File uploads and source edits during a session go
  into the session workspace draft, not directly
  into the mounted KB repository.
- The mounted KB repository is never overwritten by
  chat activity alone.
- Persisting the draft into a KB is explicit:
  `save` or `fork`.
- Forking MAY use the current effective session
  draft, not only the pristine mounted KB.

## Effective Retrieval View

Retrieval strategies, including DS025 `ThinkingDB`,
MUST operate over the effective knowledge view:

1. current-turn context
2. session conversation context
3. session workspace draft
4. mounted KB repository

The workspace draft shadows the mounted KB for
edited or newly added sources.

## Repository Lifecycle

Each repository has:

```json
{
  "kbId": "default",
  "name": "Default KB",
  "createdAt": "2026-03-27T00:00:00Z",
  "updatedAt": "2026-03-27T00:00:00Z",
  "parentKbId": null,
  "isDefault": true
}
```

Repositories MAY be:
- listed
- mounted in a session
- overwritten by explicit save
- forked into a new repository

## Session Workspace State

A session workspace stores:

```javascript
{
  mountedKbId: "default",
  mountedKbName: "Default KB",
  dirty: true,
  lastSavedAt: "2026-03-27T12:00:00Z" | null,
  sources: [{
    meta: SourceMeta,
    content: "...",
    units: ContextUnit[]
  }],
  index: KBIndexLike
}
```

## Save Semantics

`save` means:
- materialize the current workspace draft into the
  mounted KB repository or another target KB
- include conversation-derived facts if requested
- reset the session workspace to a clean state
  mounted on the saved repository

`fork` means:
- create a new KB repository from the current
  workspace draft
- mount the new repository in the same session
- leave the original repository unchanged

## API Surface

DS013 exposes:
- `GET /kbs`
- `POST /sessions`
  with optional `kb_id`
- `POST /sessions/:sessionId/kb/mount`
- `POST /sessions/:sessionId/kb/fork`
- `POST /sessions/:sessionId/kb/save`
- `GET /sessions/:sessionId/workspace`
- `POST /sessions/:sessionId/workspace/sources`

## UI Requirements

DS014 MUST make the KB state explicit:
- current mounted KB
- whether the draft is saved or unsaved
- a clear `Load KB` action
- a clear `Fork KB` action
- a clear `Save KB` action
- upload flow that makes it explicit the file is
  staged in draft unless the user saves

## Dependencies

- DS008 — persistent KB storage
- DS013 — API
- DS014 — chat UI
- DS019 — session state
- DS025 — ThinkingDB over the effective view
