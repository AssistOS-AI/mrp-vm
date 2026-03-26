# DS010 — KB Persistence

## Purpose
Configurable persistence strategies for KB. Separates
storage logic from indexing and retrieval logic.

## Principle

Persistence is abstracted through an interface. The
concrete strategy is configurable and can be changed
without affecting the rest of the system.

## Persistence Interface

```javascript
class PersistenceStrategy {
  async saveContextUnits(sourceId, units) → void
  async loadContextUnits(sourceId) → ContextUnit[]
  async removeContextUnits(sourceId) → void
  async loadAllContextUnits() → ContextUnit[]
  async saveSourceMeta(sourceId, meta) → void
  async loadSourceMeta(sourceId) → SourceMeta
  async saveIndex(indexData) → void
  async loadIndex() → indexData | null
  async isIndexValid(allUnits) → boolean
}
```

## v1 Strategy: File-based + Memory

### Scope of Validity
This strategy is suitable for small/medium KB
(under 10000 units, under 100MB CNL, under
500 sources). For larger volumes, migrate to a
persistent backend (SQLite or similar). See DS001
non-functional requirements for migration triggers.

### Storage
- All runtime/generated KB data lives under
  `data/kb/` (gitignored). The `data/` directory
  is created automatically at boot.
- CNL files are saved as Markdown in
  `data/kb/cnl/`, one file per source.
- Metadata is saved as JSON in `data/kb/meta/`,
  one file per source.
- BM25 index is saved as JSON in
  `data/kb/index/bm25-index.json`.
- All writes are atomic within the same directory:
  write `.tmp` → fsync → rename.
- Temp files MUST live on the same filesystem as
  the target to preserve rename semantics.

### indexData Format

```javascript
{
  schemaVersion: 1,
  createdAt: "2026-03-26T09:00:00Z",
  unitCount: number,
  unitHashes: { unitId: hash },
  invertedIndex: { term: [posting...] },
  docLengths: { unitId: { field: length } },
  avgDocLengths: { field: avgLength },
  idfCache: { term: idfScore }
}
```

### Index Validity Criteria
The index is valid if:
- `schemaVersion` matches the current version
- `unitCount` matches the number of loaded
  CNL units
- `unitHashes` match the unit hashes

If any condition fails → rebuild.

### Boot Loading
1. Read all CNL files from `data/kb/cnl/`.
2. Validate each with Validator (DS007).
3. Invalid files: skip + warning + quarantine
   (moved to `data/kb/quarantine/`).
4. Parse into ContextUnit[].
5. Load everything into memory.
6. Check index:
   - If valid → load from JSON.
   - If invalid → rebuild from CNL.
7. Sources with `dirty` status are re-processed.
8. Remove stale temp files left by interrupted
   writes.

### Runtime Operations
- Add/update/delete are protected by a
  single-writer lock.
- Queries always read the last committed immutable
  in-memory snapshot.
- Successful writes build a new in-memory snapshot
  first and then swap it into the live state.
- Index is re-saved on each committed modification.

## Configuration

`config/kb.json`:
```json
{
  "strategy": "file-memory",
  "paths": {
    "sources": "data/kb/sources",
    "cnl": "data/kb/cnl",
    "meta": "data/kb/meta",
    "index": "data/kb/index",
    "quarantine": "data/kb/quarantine"
  },
  "indexSavePolicy": "on-change",
  "maxSourceSizeBytes": 1048576,
  "maxSources": 500,
  "maxUnitsPerSource": 500,
  "maxTotalUnits": 10000,
  "maxTotalCnlBytes": 104857600
}
```

## Dependencies

- DS008 (KB) — consumes the strategy.
- DS009 (Indexing) — saves/loads the index.
- DS007 (Validator) — CNL validation at boot.
