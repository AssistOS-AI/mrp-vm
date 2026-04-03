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
- deliberation level
- mounted KB

The UI SHOULD label the seed-detector selector
clearly enough that it is not confused with the KB
plugin selector or the mounted KB repository. The
seed detector extracts both problem seeds and session
knowledge units from each user turn.

The chat UI SHOULD prefer streamed completions when
the server offers SSE support.

The deliberation control MUST expose the request-level
`deliberation_level` from DS033 with at least the
levels `0`, `1`, `2`, and `3`.

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

## Explainability Surface

The chat UI MUST expose a session-level
**Explainability** entry point that opens a registry
of user turns for the active session.

Minimum behavior:

- list executed turns for the current session
- allow selecting a turn to inspect execution details
- show request metadata and selected plugin IDs
- show the effective deliberation level for the turn
- open a graph-first explainability view for the
  selected turn
- render the execution as a true graph of frames and
  plugin executions, not as a linear execution list
- provide per-response deep navigation so each
  assistant answer can jump directly to its matching
  explainability turn

The per-response execution button MAY still open a
focused execution-graph view; however, the
session-level explainability registry is the primary
navigation surface for multi-turn debugging.

The detailed graph and interaction contract is
defined by DS034.

### Graph-First Redesign Requirements

The explainability surface MUST be redesigned around
an execution graph canvas.

The graph view MUST:

- start with the graph, not with a large user-input
  text block
- render every plugin execution as a compact box
- render every frame as a large visual container
- render policy/candidate/comparison/challenge nodes
  when the trace exposes them
- show nested frames inside or clearly attached to
  their parent frame
- connect executions using small directed arrows
- avoid large text inside graph nodes

### Node Content Rules

Each plugin box MUST show:

- plugin name

Each plugin box MAY also show:

- compact duration
- compact stage badge

Each plugin box MUST NOT show:

- raw input text
- raw output text
- current user message
- large JSON/text payloads

### Detail Inspection

Clicking a plugin box MUST open a clean detail panel
showing:

- plugin name and id
- execution status
- execution duration
- formatted input
- formatted output
- error/meta details when relevant

The graph canvas is for structural understanding.
Payload inspection belongs in the detail panel.

### Frame Visualization

The user must be able to see which plugin
executions belong to the same frame.

Therefore:

- frame containers MUST visually group all plugin
  executions belonging to one frame
- frame containers SHOULD show compact frame status
  and duration in their header
- frame containers MAY show compact input/output
  markers in the header or border
- frame input/output SHOULD be inspectable in a
  detail panel rather than rendered as large text in
  the frame body

### Status Colors and Legend

The graph SHOULD color plugin boxes by status such
as:

- success
- refused / unsupported
- insufficient / no-context
- error / failed
- skipped / inactive

A compact horizontal legend MUST be present and
should not consume significant vertical space.

## Dependencies

- DS013 — API
- DS034 — execution graph explainability
- DS019 — session preferences
- DS026 — KB repositories/workspaces
- DS028 — role-based model settings
