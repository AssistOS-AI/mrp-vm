# DS028 — Shared LLM Role Settings

## Purpose
Defines the shared model-selection configuration that
all plugins may consult.

## Design Rule

Plugins do not select arbitrary models ad hoc. They
resolve models through shared named roles.

## Canonical Roles

- `seed-fast`
- `seed-deep`
- `goal-fast`
- `goal-deep`
- `kb-ingest`
- `kb-derive`
- `planner`

Projects MAY add more roles, but the core roles above
must exist.

Some roles may be reserved by the current baseline
for future richer plugins. They still belong in the
shared settings surface so plugins can adopt them
without changing the API/UI contract.

The current built-in baseline already uses:

- `seed-fast` / `seed-deep` for LLM seed detectors
- `goal-fast` / `goal-deep` for LLM goal solvers
- `kb-ingest` for LLM-backed ingest normalization
- `kb-derive` for KB ingest-side derived artifact
  planning/metadata resolution

## Data Model

```javascript
{
  roles: {
    "seed-fast": { model: "provider/model-a" },
    "seed-deep": { model: "provider/model-b" }
  },
  pluginOverrides: {
    "sd-llm-fast": { role: "seed-fast" },
    "gs-llm-deep": { role: "goal-deep" }
  },
  updatedAt: "2026-03-30T00:00:00Z"
}
```

## Resolution Order

1. explicit plugin-specific override
2. shared role assignment
3. request/session generic model override, if the
   plugin chooses to honor it
4. DS015 default model resolution

## API/UI Requirements

- DS013 MUST expose read/write settings endpoints.
- DS014 MUST provide a settings page/panel for role-
  based model selection.
- All plugins MUST be able to read the effective
  settings snapshot from the execution context.

## Persistence

Settings SHOULD be persisted separately from static
defaults so they can be changed at runtime without
editing committed configuration.

## Dependencies

- DS013 — API
- DS014 — UI
- DS015 — actual model discovery/calls
- DS027 — plugin contracts
