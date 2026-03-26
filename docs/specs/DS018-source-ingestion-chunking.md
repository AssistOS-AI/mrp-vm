# DS018 — Source Ingestion & Chunking

## Purpose
The module that receives raw NL documents and
segments them into coherent fragments before
normalization into persistent Context CNL.

## Problem

A 50-page document cannot be sent directly to an
LLM for normalization. It must be segmented into
fragments small enough for LLM but large enough
for coherence.

## Accepted File Types (v1)

- `.md` — Markdown
- `.txt` — plain text

Binary files (PDF, DOCX, etc.) are not supported
in v1. Chat UI and API accept only text.

## Ingest Pipeline

```
source file (NL)
  → encoding normalization (UTF-8, LF)
  → segmentation into chunks
  → per chunk: Normalizer → Context CNL units
  → validate all chunks
  → commit source + CNL + index atomically
```

## Execution Semantics

- Ingest is synchronous in v1.
- Chunk normalization is sequential in v1 for
  deterministic ordering and simpler budgeting.
- A source ingest is all-or-nothing.
- If any chunk fails normalization or validation,
  the whole source ingest fails and no new
  committed state becomes visible.

## Chunking Strategy

### Semantic Chunking on Markdown Structure
1. Split on headings (`#`, `##`, `###`).
2. If a section exceeds `maxChunkSize`, split
   on paragraphs (blank lines).
3. If a paragraph exceeds `maxChunkSize`, split
   on sentences (`. ` as separator).
4. Each chunk retains the parent heading as a
   context prefix.

### For Plain Text
1. Split on paragraphs (double blank lines).
2. If a paragraph exceeds `maxChunkSize`, split
   on sentences.
3. If no reliable paragraph or sentence boundaries
   are found, fall back to fixed-size character
   windows.

### Parameters

```json
{
  "maxChunkSize": 1500,
  "minChunkSize": 100,
  "overlapSentences": 1,
  "plainTextWindowSize": 1500,
  "plainTextWindowOverlapChars": 150,
  "maxLLMCallsPerSource": 200,
  "ingestTimeoutMs": 300000
}
```

- `maxChunkSize` — characters, not tokens.
- `minChunkSize` — chunks below the limit are
  concatenated with the preceding chunk.
- `overlapSentences` — the last sentence from
  the previous chunk is repeated at the start
  of the next (for coherence).
- `plainTextWindowSize` — fallback window size for
  unstructured plain text with no reliable
  paragraph/sentence boundaries.
- `plainTextWindowOverlapChars` — overlap between
  adjacent fallback windows.
- `maxLLMCallsPerSource` — hard ceiling on per-
  source chunk normalization calls.
- `ingestTimeoutMs` — hard ceiling for the full
  source ingest operation.

If the predicted chunk count exceeds
`maxLLMCallsPerSource`, reject the source before the
first LLM call.

## Source → Chunks → Units Mapping

```
source "src-001"
  ├── chunk "src-001::chunk-000" (chars 0-1487)
  │   ├── Context Unit "src-001::chunk-000::unit-000"
  │   └── Context Unit "src-001::chunk-000::unit-001"
  ├── chunk "src-001::chunk-001" (chars 1400-2890)
  │   └── Context Unit "src-001::chunk-001::unit-000"
  └── ...
```

## ChunkInfo Schema

```javascript
{
  chunkId: "src-001::chunk-000",
  sourceId: "src-001",
  chunkIndex: 0,
  charStart: 0,
  charEnd: 1487,
  headingContext: "## Deployment Guide",
  text: "..."
}
```

## Failure Reporting

On ingest failure, return structured details:

```javascript
{
  code: "KB_INGEST_FAILED",
  sourceId: "src-001",
  failedChunkId: "src-001::chunk-057",
  failedChunkIndex: 57,
  stage: "normalize-context"
}
```

## Idempotency on Reimport

On source update:
1. All chunks are regenerated.
2. All Context Units are regenerated.
3. Old units remain active until the new ingest
   commits successfully.
4. New units replace the old committed version in
   one swap.
5. IDs are regenerated (old ones are not
   preserved).

## Main Interface

```javascript
class SourceIngestor {
  constructor(normalizer, config)
  async ingest(sourceId, rawText, filename) →
    { chunks: ChunkInfo[], units: ContextUnit[] }
  chunk(rawText, filename) → ChunkInfo[]
}
```

## Dependencies

- DS008 (KB) — invokes the ingestor on add/update.
- DS006 (Normalizer) — chunk → CNL normalization.
- DS010 (Persistence) — result storage.
