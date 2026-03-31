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
data/workspaces/<sessionId>/plugins/<pluginId>/
data/kb/plugins/<pluginId>/
```

Shared KB persistence MUST keep plugin-private
artifacts isolated by plugin ID.

Current baseline status:

- workspace-scoped plugin artifact paths are actively
  used during source staging and draft work
- if no workspace artifact store is available during a
  source-text hook, the plugin may return `skipped`
  rather than fabricating an ad-hoc path
- on save/fork, workspace plugin artifacts are
  promoted into the target repository plugin subtree
- on mount, repository plugin artifacts are hydrated
  back into the session workspace
- session-scoped KB lifecycle events are the trigger
  by which each `kb-plugin` may refresh its own
  in-memory caches or persisted derived state

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
