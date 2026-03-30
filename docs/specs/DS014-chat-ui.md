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

## Input Behavior

The main chat textarea MUST use:

- `Enter` to submit the current message
- `Ctrl+Enter` to insert a newline for multi-line
  input

## Dependencies

- DS013 — API
- DS019 — session preferences
- DS028 — role-based model settings
