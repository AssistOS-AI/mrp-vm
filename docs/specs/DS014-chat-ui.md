# DS014 — Chat UI

## Purpose
Defines the static chat UI after the plugin-kernel
refactor.

## Runtime Controls

The main chat view MUST expose selectors for:

- planner plugin
- seed detector plugin
- KB plugin
- goal solver plugin
- mounted KB

The UI SHOULD label the seed-detector selector
clearly enough that it is not confused with the KB
plugin selector or the mounted KB repository. The
seed detector extracts both problem seeds and session
knowledge units from each user turn.

The chat UI SHOULD prefer streamed completions when
the server offers SSE support.

The chat UI MUST treat KB selection as session-scoped
state, not as a loose local preference. When the user
chooses a KB, the UI SHOULD call the dedicated
session-scoped KB endpoints from DS013 to load, save,
or fork the active KB for that session.

Minimum KB actions exposed in the chat surface:

- list available KBs by name and stable ID
- create a new named KB
- load a KB into the current session
- save the current session draft into a KB
- fork the current session draft into a new KB

## Settings Page/Panel

The UI MUST provide a settings page or settings panel
inside the chat surface where the user can choose the
LLM model for named roles from DS028.

Minimum roles shown:

- `seed-fast`
- `seed-deep`
- `goal-fast`
- `goal-deep`
- `kb-ingest`
- `kb-derive`
- `planner`

## Persistence

- session ID remains per-tab
- UI preferences MAY use `localStorage`
- server-backed LLM role settings MUST persist via
  DS013 settings endpoints
- the mounted KB MUST be synchronized through the
  dedicated session-scoped KB endpoints rather than
  inferred only from local UI state

## Input Behavior

The main chat textarea MUST use:

- `Enter` to submit the current message
- `Ctrl+Enter` to insert a newline for multi-line
  input

## Streaming Surface

When the server streams a completion, the UI MUST
show:

- an overwrite-friendly execution/progress area for
  intermediate stage updates
- a separate assistant answer area for the final
  streamed response text

Intermediate progress text is not the final answer
and SHOULD be replaced as new stage updates arrive.

## Dependencies

- DS013 — API
- DS019 — session preferences
- DS026 — KB repositories/workspaces
- DS028 — role-based model settings
