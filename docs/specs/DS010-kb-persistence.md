# DS010 — KB Persistence

## Purpose
Defines persistent storage for KB repositories,
session workspaces, and plugin-private KB artifacts.

## Persistence Scope

Persistence MUST support:

- shared semantic units
- raw source text
- source metadata
- shared indices
- plugin-private artifact directories

## Plugin-Private Artifact Rule

Each KB plugin MAY persist artifacts under a
plugin-scoped subtree, for example:

```text
data/kb/plugins/<pluginId>/
data/workspaces/<sessionId>/plugins/<pluginId>/
```

Shared KB persistence MUST keep plugin-private
artifacts isolated by plugin ID.

## Atomicity

Source add/update/delete remains source-atomic from
the reader point of view.

If a source changes, plugin-private artifacts derived
from that source MUST either:

- be atomically refreshed, or
- be marked stale and excluded from ranking

## Dependencies

- DS008 — KB substrate
- DS023 — KB plugin responsibilities
- DS026 — repositories/workspaces
