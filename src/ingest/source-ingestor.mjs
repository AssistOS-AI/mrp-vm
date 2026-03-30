// DS018 — Source Ingestion & Chunking
import { MRPError } from '../lib/errors.mjs';

export class SourceIngestor {
  constructor(normalizer, config) {
    this.normalizer = normalizer;
    this.maxChunkSize = config.maxChunkSize || 1500;
    this.minChunkSize = config.minChunkSize || 100;
    this.overlapSentences = config.overlapSentences ?? 1;
    this.plainTextWindowSize = config.plainTextWindowSize || 1500;
    this.plainTextWindowOverlapChars = config.plainTextWindowOverlapChars || 150;
    this.maxLLMCallsPerSource = config.maxLLMCallsPerSource || 200;
    this.ingestTimeoutMs = config.ingestTimeoutMs || 300000;
  }

  chunk(rawText, filename) {
    const isMarkdown = filename?.endsWith('.md');
    const chunks = isMarkdown ? this._chunkMarkdown(rawText) : this._chunkPlainText(rawText);
    return this._annotateOffsets(rawText, chunks);
  }

  _chunkMarkdown(text) {
    // Split on headings
    const sections = [];
    const lines = text.split('\n');
    let currentHeading = '';
    let currentText = '';
    for (const line of lines) {
      if (/^#{1,3}\s/.test(line)) {
        if (currentText.trim()) sections.push({ heading: currentHeading, text: currentText.trim() });
        currentHeading = line;
        currentText = '';
      } else {
        currentText += line + '\n';
      }
    }
    if (currentText.trim()) sections.push({ heading: currentHeading, text: currentText.trim() });

    const chunks = [];
    for (const sec of sections) {
      const prefix = sec.heading ? sec.heading + '\n' : '';
      if (sec.text.length <= this.maxChunkSize) {
        chunks.push({
          text: prefix + sec.text,
          chunkType: sec.heading ? 'markdown-section' : 'markdown-body',
          sectionTitle: sec.heading.replace(/^#+\s*/, '') || null
        });
      } else {
        // Split on paragraphs
        for (const para of this._splitParagraphs(sec.text, prefix)) {
          chunks.push({
            text: para,
            chunkType: 'markdown-paragraph',
            sectionTitle: sec.heading.replace(/^#+\s*/, '') || null
          });
        }
      }
    }
    return this._mergeSmall(chunks).map((chunk, i) => ({ chunkIndex: i, ...chunk }));
  }

  _chunkPlainText(text) {
    // Split on double blank lines (paragraphs)
    const paras = text.split(/\n\s*\n/).filter(p => p.trim());
    const chunks = [];
    for (const p of paras) {
      if (p.length <= this.maxChunkSize) {
        chunks.push({ text: p.trim(), chunkType: 'paragraph-block', sectionTitle: null });
      } else {
        // Split on sentences
        for (const s of this._splitSentences(p)) chunks.push({ text: s, chunkType: 'sentence-window', sectionTitle: null });
      }
    }
    if (chunks.length === 0 && text.trim()) {
      // Fallback: fixed-size windows
      return this._fixedWindows(text).map((t, i) => ({
        chunkIndex: i,
        text: t,
        chunkType: 'fixed-window',
        sectionTitle: null
      }));
    }
    return this._mergeSmall(chunks).map((chunk, i) => ({ chunkIndex: i, ...chunk }));
  }

  _splitParagraphs(text, prefix) {
    const paras = text.split(/\n\s*\n/).filter(p => p.trim());
    const result = [];
    for (const p of paras) {
      const full = prefix + p.trim();
      if (full.length <= this.maxChunkSize) {
        result.push({ text: full, chunkType: 'markdown-paragraph', sectionTitle: prefix.trim().replace(/^#+\s*/, '') || null });
      } else {
        for (const s of this._splitSentences(p)) {
          result.push({
            text: prefix + s,
            chunkType: 'markdown-sentence-window',
            sectionTitle: prefix.trim().replace(/^#+\s*/, '') || null
          });
        }
      }
    }
    return result;
  }

  _splitSentences(text) {
    const sentences = text.split(/(?<=\.)\s+/).filter(Boolean);
    const chunks = [];
    let current = '';
    let lastSentence = '';
    for (const s of sentences) {
      if (current.length + s.length > this.maxChunkSize && current) {
        chunks.push(current.trim());
        current = this.overlapSentences > 0 && lastSentence ? lastSentence + ' ' : '';
      }
      current += s + ' ';
      lastSentence = s;
    }
    if (current.trim()) chunks.push(current.trim());
    return chunks;
  }

  _fixedWindows(text) {
    const chunks = [];
    let i = 0;
    while (i < text.length) {
      chunks.push(text.substring(i, i + this.plainTextWindowSize));
      i += this.plainTextWindowSize - this.plainTextWindowOverlapChars;
    }
    return chunks;
  }

  _mergeSmall(chunks) {
    if (chunks.length <= 1) return chunks;
    const merged = [{ ...chunks[0] }];
    for (let i = 1; i < chunks.length; i++) {
      if ((merged[merged.length - 1].text || '').length < this.minChunkSize) {
        merged[merged.length - 1].text += '\n\n' + chunks[i].text;
      } else {
        merged.push({ ...chunks[i] });
      }
    }
    return merged;
  }

  _annotateOffsets(rawText, chunks) {
    let cursor = 0;
    return chunks.map((chunk, index) => {
      const text = chunk.text || '';
      const charStart = text ? rawText.indexOf(text, cursor) : -1;
      const resolvedStart = charStart >= 0 ? charStart : cursor;
      const charEnd = resolvedStart + text.length;
      cursor = Math.max(cursor, charEnd);
      return {
        chunkIndex: index,
        text,
        chunkType: chunk.chunkType || 'semantic-chunk',
        sectionTitle: chunk.sectionTitle || null,
        charStart: resolvedStart,
        charEnd
      };
    });
  }

  _inferUnitType(unit, chunk) {
    if (unit.role === 'Procedure') return 'procedure-step';
    if (unit.role === 'Definition') return 'definition';
    if (unit.role === 'Comparison') return 'comparison';
    if (chunk?.chunkType?.startsWith('markdown')) return 'section-unit';
    return 'semantic-unit';
  }

  async ingest(sourceId, rawText, filename, strategy) {
    const startTime = Date.now();
    const rawChunks = this.chunk(rawText, filename);
    if (rawChunks.length > this.maxLLMCallsPerSource) {
      throw new MRPError('KB_INGEST_TOO_MANY_CHUNKS', 'ingest',
        `Source would produce ${rawChunks.length} chunks, exceeding limit of ${this.maxLLMCallsPerSource}`);
    }
    const allUnits = [];
    const createdAt = new Date().toISOString();
    for (const chunk of rawChunks) {
      if (Date.now() - startTime > this.ingestTimeoutMs) {
        throw new MRPError('KB_INGEST_TIMEOUT', 'ingest', 'Ingest timeout exceeded');
      }
      const provenance = {
        sourceId,
        chunkId: `${sourceId}::chunk-${String(chunk.chunkIndex).padStart(3, '0')}`,
        sourceName: filename || null,
        chunkIndex: chunk.chunkIndex,
        charStart: chunk.charStart,
        charEnd: chunk.charEnd,
        chunkType: chunk.chunkType,
        sectionTitle: chunk.sectionTitle,
        createdAt
      };
      const contextCNL = await this.normalizer.toContextCNL(chunk.text, provenance, strategy);
      // Parse the CNL to get units
      const { CNLParser } = await import('../parser/cnl-validator-parser.mjs');
      const parser = new CNLParser();
      const units = parser.parseContextCNL(contextCNL).map((unit, unitIndex) => ({
        ...unit,
        sourceName: unit.sourceName || filename || null,
        chunkIndex: unit.chunkIndex ?? chunk.chunkIndex,
        unitIndex: unit.unitIndex ?? unitIndex,
        unitType: unit.unitType || this._inferUnitType(unit, chunk),
        textBody: unit.textBody || unit.claim || unit.procedure || unit.topic || '',
        parentUnitIds: unit.parentUnitIds || [],
        childUnitIds: unit.childUnitIds || [],
        derivedFromUnitIds: unit.derivedFromUnitIds || [],
        charStart: unit.charStart ?? chunk.charStart,
        charEnd: unit.charEnd ?? chunk.charEnd,
        createdAt: unit.createdAt || createdAt,
        chunkType: unit.chunkType || chunk.chunkType,
        sectionTitle: unit.sectionTitle || chunk.sectionTitle || null
      }));
      allUnits.push(...units);
    }
    return {
      chunks: rawChunks.map((c, i) => ({
        chunkId: `${sourceId}::chunk-${String(i).padStart(3, '0')}`,
        sourceId,
        chunkIndex: i,
        text: c.text
      })),
      units: allUnits
    };
  }
}
