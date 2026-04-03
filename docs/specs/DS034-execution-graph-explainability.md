# DS034 — Execution Graph Explainability

## Purpose
Defines the canonical explainability and
observability surface for MRP-VM execution.

The primary artifact is a true execution graph for
each completed user turn in the current session.
This graph is meant for debugging and observability,
not for narrative replay.

## Design Goals

- show the real execution structure, not a fake
  linearized stage list
- render plugin executions as compact visual boxes
- make frame structure visible through nested frame
  containers
- keep the graph readable by hiding large text from
  node labels
- make step-by-step debugging possible through
  click-to-inspect details
- support per-turn inspection across the current
  session

## Non-Goals

- the graph is not a transcript view
- the graph is not a prose explanation of the run
- the graph must not render large request/response
  payloads inline inside the canvas
- the graph must not start with a separate user
  input block before the first plugin

## Primary UX Contract

For each completed user turn in the current session,
the UI MUST expose one execution graph.

When the user opens explainability for a turn:

- the first visible artifact MUST be the execution
  graph canvas
- the UI MUST NOT render the raw user message as a
  big text block before the graph
- the root input is treated as the input of the
  first plugin execution in the root frame

The turn registry may still show short metadata such
as turn index, time, and assistant preview, but the
graph view itself starts with the graph.

## Visual Model

### Node Types

The graph uses these primary visual elements:

- **frame containers** — large bordered containers
  for one execution frame
- **plugin execution boxes** — compact boxes for
  individual plugin executions
- **directed arrows** — small arrows connecting
  execution order and parent/child execution flow

Secondary runtime artifacts such as results or
failures MAY exist in the underlying data model, but
the primary visible graph should focus on frames and
plugin executions. Secondary artifacts SHOULD be
rendered as badges, icons, or compact annotations
rather than as large standalone text blocks.

### Frame Containers

Each frame MUST be rendered as a visually distinct
container.

A frame container MAY show in its header:

- frame label or frame id
- frame purpose when available
- frame status
- total frame duration
- compact input/output badges or ports

A frame container MUST NOT render full input/output
texts directly in the graph body.

The frame's input and output are still part of the
model, but they belong in the detail panel for the
selected frame or selected plugin.

Nested child frames MUST appear visually inside the
owning parent frame region or as clearly linked
sub-containers, so the user can see frame nesting at
a glance.

The intended mental model is:

- one large frame container
- compact execution boxes inside it
- nested frame containers when recursion occurs
- compact input/output markers on the frame, but not
  full payload text inline

### Plugin Execution Boxes

Each plugin execution MUST be rendered as one compact
box.

The box label MUST show:

- plugin name

The box MAY also show:

- plugin id, if needed for disambiguation
- stage badge
- duration badge

The box MUST NOT show:

- the effective input payload
- the effective output payload
- raw user text
- large result text
- long error text

The graph canvas is for structure. Payloads belong in
the detail panel.

### Directed Arrows

Edges between plugin boxes and frame containers MUST
use clear small arrows.

The graph must make it easy to understand:

- which plugin executed before which plugin
- which plugin opened a child frame
- which plugin execution belonged to which frame

## Labeling Rules

The main node label for a plugin execution MUST be
the plugin name, not the current input text, not the
current output text, and not dynamic payload values.

If a human-readable plugin name is available from the
descriptor, that name is the primary label.
If not, the UI may fall back to the plugin id.

Duration MAY be shown as a compact secondary label:

- milliseconds if `< 1000 ms`
- seconds with compact formatting if `>= 1000 ms`

Examples:

- `Balanced KB Retriever · 184 ms`
- `Deep Goal Solver · 2.4 s`

## Status Colors

Plugin boxes and frame containers SHOULD use color to
communicate status.

Minimum status-color mapping:

- `success` -> green
- `unsupported` / `refused` -> amber
- `insufficient` / `no-context` -> yellow
- `error` / `failed` -> red
- `skipped` / `inactive` -> gray
- `running` / `active` -> blue

The exact palette is implementation-defined, but the
semantic mapping must stay stable.

## Compact Legend

The explainability graph MUST include a compact
legend for status colors.

The legend:

- should be horizontally compact
- should not consume large vertical space
- should stay visible near the graph toolbar or
  header

## Interaction Model

### Click on Plugin Box

When the user clicks a plugin execution box, the UI
MUST open a clear detail panel.

The detail panel MUST show:

- plugin name
- plugin id
- plugin type / stage
- execution status
- execution duration
- formatted input
- formatted output
- structured error details when relevant

The input and output should be presented in a clean
inspection layout such as:

- `Input`
- `Output`
- `Meta`

Tabs, split panels, or stacked cards are all
acceptable as long as the result is clearly readable.

### Click on Frame Container

When the user clicks a frame container, the detail
panel SHOULD show:

- frame id
- frame purpose
- frame status
- frame duration
- frame input summary
- frame output summary
- child frames and contained plugin executions

### Graph Navigation

The graph SHOULD support:

- pan and zoom
- centering on the selected node
- easy switching between turns in the current
  session

## API/Data Contract

The graph UI depends on a canonical structured graph
payload from the server.

The explainability payload for one turn MUST expose
enough data to render:

- frame containers
- plugin execution boxes
- directed edges
- node durations
- node statuses
- node detail payloads for click inspection

A suitable shape is:

```javascript
{
  rootFrameId: string,
  frames: [{
    id: string,
    parentFrameId: string | null,
    label: string | null,
    purpose: string | null,
    status: string,
    durationMs: number | null,
    detailRef: string | null
  }],
  pluginExecutions: [{
    id: string,
    frameId: string,
    pluginId: string,
    pluginName: string,
    pluginType: string,
    stage: string | null,
    status: string,
    durationMs: number | null,
    detailRef: string
  }],
  edges: [{
    from: string,
    to: string,
    kind: "flow" | "child-frame" | "retry" | "contains"
  }],
  details: {
    [detailRef: string]: {
      input: unknown,
      output: unknown,
      error: object | null,
      meta: object
    }
  }
}
```

The graph data may live inside `executionTrace`, but
the structured graph model is the canonical contract.

## Observability Rules

- every completed turn in the current session must
  be inspectable separately
- the user must be able to debug the run step by
  step by clicking plugin executions
- the graph must show all plugin executions that
  participated in the selected turn
- frame grouping must make nested execution easy to
  understand
- the graph must prefer structural clarity over
  inline payload visibility

## Required DS Follow-Through

This DS requires corresponding updates in:

- DS002 — execution-trace fields needed for the UI
- DS013 — explainability endpoint payload contract
- DS014 — explainability UI behavior and redesign

## Dependencies

- DS002 — core execution trace
- DS013 — explainability API
- DS014 — explainability UI
