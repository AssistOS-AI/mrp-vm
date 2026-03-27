// DS010 — File-Memory Persistence Strategy
import { writeFileSync, readFileSync, readdirSync, existsSync, mkdirSync, renameSync, unlinkSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { CNLValidator, CNLParser } from '../parser/cnl-validator-parser.mjs';
import { logger } from '../lib/logger.mjs';

const MOD = 'persistence';

function ensureDir(dir) { if (!existsSync(dir)) mkdirSync(dir, { recursive: true }); }

function atomicWrite(filePath, content) {
  const tmp = filePath + '.tmp';
  writeFileSync(tmp, content, 'utf-8');
  renameSync(tmp, filePath);
}

function clearDir(dir) {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir)) {
    const filePath = join(dir, entry);
    if (statSync(filePath).isFile()) unlinkSync(filePath);
  }
}

export class FileMemoryPersistence {
  constructor(config) {
    this.paths = {};
    const base = config.paths || {};
    for (const [k, v] of Object.entries(base)) this.paths[k] = resolve(v);
    for (const dir of Object.values(this.paths)) ensureDir(dir);
  }

  async saveContextUnits(sourceId, units) {
    const lines = units.map(u => this._unitToMarkdown(u)).join('\n\n');
    atomicWrite(join(this.paths.cnl, `${sourceId}.cnl.md`), lines);
  }

  async loadContextUnits(sourceId) {
    const fp = join(this.paths.cnl, `${sourceId}.cnl.md`);
    if (!existsSync(fp)) return [];
    const parser = new CNLParser();
    return parser.parseContextCNL(readFileSync(fp, 'utf-8'));
  }

  async removeContextUnits(sourceId) {
    const fp = join(this.paths.cnl, `${sourceId}.cnl.md`);
    if (existsSync(fp)) unlinkSync(fp);
  }

  async loadAllContextUnits() {
    const dir = this.paths.cnl;
    if (!existsSync(dir)) return [];
    const validator = new CNLValidator();
    const parser = new CNLParser();
    const all = [];
    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.cnl.md')) continue;
      const fp = join(dir, f);
      const content = readFileSync(fp, 'utf-8');
      const vr = validator.validateContextCNL(content);
      if (!vr.valid) {
        logger.warn(MOD, `Invalid CNL file ${f}, quarantining`, { errors: vr.errors });
        ensureDir(this.paths.quarantine);
        renameSync(fp, join(this.paths.quarantine, f));
        continue;
      }
      all.push(...parser.parseContextCNL(content));
    }
    return all;
  }

  async saveSourceMeta(sourceId, meta) {
    atomicWrite(join(this.paths.meta, `${sourceId}.meta.json`), JSON.stringify(meta, null, 2));
  }

  async loadSourceMeta(sourceId) {
    const fp = join(this.paths.meta, `${sourceId}.meta.json`);
    if (!existsSync(fp)) return null;
    return JSON.parse(readFileSync(fp, 'utf-8'));
  }

  async loadAllSourceMeta() {
    const dir = this.paths.meta;
    if (!existsSync(dir)) return [];
    const metas = [];
    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.meta.json')) continue;
      metas.push(JSON.parse(readFileSync(join(dir, f), 'utf-8')));
    }
    return metas;
  }

  async removeSourceMeta(sourceId) {
    const fp = join(this.paths.meta, `${sourceId}.meta.json`);
    if (existsSync(fp)) unlinkSync(fp);
  }

  async saveRawSource(sourceId, name, content) {
    atomicWrite(join(this.paths.sources, `${sourceId}.src`), content);
  }

  async loadRawSource(sourceId) {
    const fp = join(this.paths.sources, `${sourceId}.src`);
    if (!existsSync(fp)) return null;
    return readFileSync(fp, 'utf-8');
  }

  async removeRawSource(sourceId) {
    const fp = join(this.paths.sources, `${sourceId}.src`);
    if (existsSync(fp)) unlinkSync(fp);
  }

  async saveIndex(indexData) {
    atomicWrite(join(this.paths.index, 'bm25-index.json'), JSON.stringify(indexData));
  }

  async loadIndex() {
    const fp = join(this.paths.index, 'bm25-index.json');
    if (!existsSync(fp)) return null;
    return JSON.parse(readFileSync(fp, 'utf-8'));
  }

  async isIndexValid(allUnits) {
    const data = await this.loadIndex();
    if (!data) return false;
    if (data.schemaVersion !== 1) return false;
    if (data.unitCount !== allUnits.length) return false;
    for (const u of allUnits) {
      if (data.unitHashes[u.id] !== (u.hash || '')) return false;
    }
    return true;
  }

  async cleanTempFiles() {
    for (const dir of Object.values(this.paths)) {
      if (!existsSync(dir)) continue;
      for (const f of readdirSync(dir)) {
        if (f.endsWith('.tmp')) {
          unlinkSync(join(dir, f));
          logger.info(MOD, `Removed stale temp file: ${f}`);
        }
      }
    }
  }

  async resetRepository() {
    clearDir(this.paths.sources);
    clearDir(this.paths.cnl);
    clearDir(this.paths.meta);
    clearDir(this.paths.index);
  }

  _unitToMarkdown(u) {
    let md = `## Context Unit ${u.id}\n`;
    md += `SourceId: ${u.sourceId}\n`;
    md += `ChunkId: ${u.chunkId}\n`;
    md += `Role: ${u.role}\n`;
    md += `Topic: ${u.topic}\n`;
    if (u.claim) md += `Claim: ${u.claim}\n`;
    if (u.condition) md += `Condition: ${u.condition}\n`;
    if (u.procedure) md += `Procedure: ${u.procedure}\n`;
    if (u.subject) md += `Subject: ${u.subject}\n`;
    if (u.relation) md += `Relation: ${u.relation}\n`;
    if (u.object) md += `Object: ${u.object}\n`;
    if (u.confidence !== null && u.confidence !== undefined) md += `Confidence: ${u.confidence}\n`;
    md += `UtilityActs: ${(u.utilityActs || []).join(', ')}\n`;
    if (u.utilityNote) md += `UtilityNote: ${u.utilityNote}\n`;
    if (u.hash) md += `Hash: ${u.hash}\n`;
    return md;
  }
}
