# DS008 — Knowledge Base (KB)

## Purpose
Central persistent knowledge storage component.
Manages raw sources, generated Context CNL files,
and search indices.

## Scope Boundary

This DS describes the persistent KB only.
Session-mounted draft workspaces are defined in
DS026. Temporary session context remains defined in
DS019 and is not part of the committed KB
repository until explicitly saved.

## Three File Types in KB

1. **Initial files (raw NL)** — attached from chat
   or via the attachment API. Plain natural
   language, unprocessed.
2. **CNL files** — result of NL → Context CNL
   conversion (via Ingest + Normalizer). Stored
   persistently.
3. **Index files** — indexing structures generated
   by the indexing module (DS009).

## KB Directory Structure

```
data/kb/
├── sources/        # Original NL files
├── cnl/            # Generated Context CNL files
├── meta/           # Per-source metadata
└── index/          # Persistent index files
```

## Add Source Pipeline

Ingest is synchronous in v1 — the request blocks
until the source is fully indexed and committed.

1. Deterministic `sourceId` is generated:
   `"src-" + sha256(name).substring(0, 12)`.
   If a collision occurs, a numeric suffix is
   appended (`-1`, `-2`).
2. Raw source is staged to a temp path.
3. SourceIngestor (DS018) is invoked:
   a. chunking → chunks
   b. per chunk: Normalizer → Context CNL units
4. If any chunk fails, the whole operation fails:
   - new source: nothing is committed
   - update: previous committed version remains
     active
5. If all chunks succeed, source, CNL, metadata,
   and index changes are committed atomically from
   the reader's perspective.

## Update Source Pipeline

1. Existing committed source remains readable.
2. New source content is staged.
3. Chunks + CNL are regenerated fully.
4. A new index snapshot is built.
5. On success, the new source, CNL, metadata, and
   index snapshot replace the old committed state.

## Delete Source Pipeline

1. Source is removed from the next committed index
   snapshot.
2. Source, CNL, and metadata are deleted atomically
   from the committed view.

## Consistency — v1 Strategy

- Source add/update/delete is source-atomic.
- No partial CNL or partial index update may become
  visible to readers.
- If a crash occurs after temp writes but before
  commit, temp artifacts are discarded or moved to
  quarantine at boot.
- If a crash occurs after a partial filesystem swap,
  metadata may mark the source `dirty`; boot-time
  reconciliation restores a valid state.
- Persistent KB mutations are serialized by a
  single-writer lock.
- Queries run against the last committed immutable
  in-memory snapshot.

## Main Interface

```javascript
class KnowledgeBase {
  constructor(ingestor, index, persistence)
  async addSource(name, nlContent) → sourceId
  async updateSource(sourceId, nlContent) → void
  async removeSource(sourceId) → void
  getSources() → SourceMeta[]
  getSource(sourceId) → SourceMeta | null
  async getContextUnits(sourceId) → ContextUnit[]
  async reindexSource(sourceId) → void
  async rebuildIndex() → void
}
```

## Source Metadata

`data/kb/meta/<sourceId>.meta.json`:
```json
{
  "sourceId": "src-001",
  "name": "deployment-guide.md",
  "addedAt": "2026-03-26T09:00:00Z",
  "updatedAt": "2026-03-26T09:00:00Z",
  "chunkCount": 5,
  "unitCount": 12,
  "status": "ready",
  "hash": "<sha256 of source content>"
}
```

Status values: `ready`, `dirty`.

## Accepted File Types (v1)

- `.md` — Markdown
- `.txt` — plain text

Binary files are not supported in v1.
Upload is done as text in JSON body (see DS013).

## Limits

- Max source size: 1MB (configurable).
- Max sources: 500 (configurable).
- Max units per source: 500 (configurable).
- Max total persistent KB units: 10000
  (configurable).
- Max total persistent CNL bytes: 104857600
  (configurable).

## Dependencies

- DS018 (Ingest) — chunking + normalization.
- DS006 (Normalizer) — NL → Context CNL conversion.
- DS009 (Indexing) — index updates.
- DS010 (Persistence) — storage strategies.
