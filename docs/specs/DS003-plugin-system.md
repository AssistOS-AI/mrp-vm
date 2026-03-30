# DS003 — Typed Plugin System

## Purpose
Defines the common runtime, discovery, registration,
and execution rules for all MRP-VM plugin types.

## Supported Plugin Types

- `sd-plugin`
- `kb-plugin`
- `gs-plugin`
- `mrp-plan-plugin`

Type-specific interfaces are defined in DS027.

## Common Descriptor

Every plugin MUST expose a descriptor equivalent to:

```javascript
{
  id: "kb-balanced",
  type: "kb-plugin",
  name: "Balanced KB Retriever",
  version: "1.0.0",
  description: "...",
  costClass: "cheap" | "moderate" | "expensive",
  usesLLM: boolean,
  modelRoles: ["kb-ingest"],
  tags: ["builtin", "balanced"],
  timeoutMs: 30000,
  provides: ["retrieve-context"],
  accepts: ["chat-turn", "source-text"]
}
```

## Discovery Modes

### Built-in plugins

Registered programmatically at boot.

### External wrapper plugins

Loaded from wrapper directories that include a
manifest declaring:

- `id` or legacy `name`
- `type` or a legacy implicit helper-plugin default
- `command`
- `args`
- `protocolVersion`

Wrapper plugins are trusted components gated by
allowlist, timeout, input size, and manifest
validation. There is still no OS-level sandboxing.

## Runtime Context

The core passes a shared execution context to every
plugin call:

```javascript
{
  requestId,
  session,
  conversation,
  parser,
  decomposer,
  modelSettings,
  logger,
  budgets
}
```

Additional fields MAY be added later, but plugins
must treat the context as read-only except for
explicit callback surfaces.

## Execution Rules

- A planner plugin decides stage order and plugin
  order.
- The core MAY execute only plugins whose type
  matches the current stage.
- Explicit user/session selection overrides planner
  reordering for that stage.
- Plugin failures are isolated and recorded in the
  execution trace.
- A plugin may declare `usesLLM: false` and still be
  selected before an LLM-backed alternative.

## Source Text Propagation

When a source document is uploaded or staged:

1. the source text is normalized into semantic units
   by the chosen seed detector for ingest
2. the raw text plus units are offered to all
   enabled `kb-plugin`s through their ingest hook
3. each KB plugin MAY build plugin-private indices,
   derived notes, or caches

This is how old retrieval-profile-specific indexing
behavior moves out of the core.

## Security

- allowlist for external plugins
- timeout per plugin
- input size limits
- sanitized executable paths
- manifest validation

## Registry Interface

```javascript
class TypedPluginRegistry {
  register(plugin) -> void
  get(type, id) -> Plugin | null
  list(type = null) -> PluginDescriptor[]
  listByType(type) -> PluginDescriptor[]
}
```

## Dependencies

- DS002 — core executes typed plugins
- DS016 — wrapper protocol for external plugins
- DS027 — typed interfaces
- DS028 — shared LLM role settings
- DS029 — planner plugins
