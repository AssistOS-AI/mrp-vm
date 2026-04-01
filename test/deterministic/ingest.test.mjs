import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { SourceIngestor } from '../../src/core/ingest/source-ingestor.mjs';
import { MAX_NORMALIZER_INPUT_CHARS } from '../../src/core/normalizer/nl-normalizer.mjs';

describe('SourceIngestor chunk safety', () => {
  it('keeps short sources as one whole-source chunk under the normalizer ceiling', () => {
    const ingestor = new SourceIngestor(null, {
      singleChunkLimit: 7000,
      maxChunkSize: 6000,
      minChunkSize: 800,
      plainTextWindowSize: 6000,
      plainTextWindowOverlapChars: 600
    });

    const text = 'Alpha '.repeat(1100);
    const chunks = ingestor.chunk(text, 'story.txt');

    assert.equal(chunks.length, 1);
    assert.equal(chunks[0].chunkType, 'whole-source');
    assert.ok(chunks[0].text.length < MAX_NORMALIZER_INPUT_CHARS);
  });

  it('chunks medium sources before they exceed the normalizer ceiling', async () => {
    const chunkLengths = [];
    const ingestor = new SourceIngestor({
      async toContextCNL(chunkText, provenance) {
        chunkLengths.push(chunkText.length);
        return `## Context Unit ${provenance.chunkId}::unit-000
SourceId: ${provenance.sourceId}
ChunkId: ${provenance.chunkId}
Role: Statement
Topic: Chunk ${provenance.chunkIndex}
Claim: Chunk ${provenance.chunkIndex} is retained.
UtilityActs: explain
Hash: ${provenance.chunkId}-hash`;
      }
    }, {
      singleChunkLimit: 7000,
      maxChunkSize: 6000,
      minChunkSize: 800,
      plainTextWindowSize: 6000,
      plainTextWindowOverlapChars: 600
    });

    const longParagraph = `Sentence one explains alpha in detail. Sentence two extends the detail. Sentence three preserves context. `;
    const text = longParagraph.repeat(95);
    const chunks = ingestor.chunk(text, 'story.txt');
    assert.ok(chunks.length > 1, `Expected chunking for medium source, got ${chunks.length} chunk(s)`);
    assert.ok(chunks.every(chunk => chunk.text.length <= MAX_NORMALIZER_INPUT_CHARS));

    const result = await ingestor.ingest('src-medium', text, 'story.txt', {});
    assert.ok(result.units.length >= chunks.length);
    assert.ok(chunkLengths.length >= chunks.length);
    assert.ok(chunkLengths.every(length => length <= MAX_NORMALIZER_INPUT_CHARS));
  });
});
