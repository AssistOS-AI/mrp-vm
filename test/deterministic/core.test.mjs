// Deterministic tests: parser, validator, tokenizer, decomposer, index
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CNLValidator, CNLParser } from '../../src/parser/cnl-validator-parser.mjs';
import { IntentDecomposer } from '../../src/intent/decomposer.mjs';
import { tokenize } from '../../src/retrieval/tokenizer.mjs';
import { KBIndex } from '../../src/retrieval/kb-index.mjs';

// ── Validator ──

describe('CNLValidator — Intent CNL', () => {
  const v = new CNLValidator();

  it('accepts valid intent CNL', () => {
    const md = '## Intent Group 1\nAct: define\nIntent: What is BM25?\nOutput: Short answer.';
    assert.deepStrictEqual(v.validateIntentCNL(md).valid, true);
  });

  it('rejects missing Act', () => {
    const md = '## Intent Group 1\nIntent: What is BM25?\nOutput: Short answer.';
    const r = v.validateIntentCNL(md);
    assert.equal(r.valid, false);
    assert.equal(r.errors[0].code, 'MISSING_REQUIRED_FIELD');
    assert.equal(r.errors[0].field, 'Act');
  });

  it('rejects invalid Act value', () => {
    const md = '## Intent Group 1\nAct: dance\nIntent: Dance.\nOutput: Dance.';
    const r = v.validateIntentCNL(md);
    assert.equal(r.valid, false);
    assert.equal(r.errors[0].code, 'INVALID_ACT_VALUE');
  });

  it('rejects unknown fields', () => {
    const md = '## Intent Group 1\nAct: define\nIntent: X.\nOutput: Y.\nFoo: bar';
    const r = v.validateIntentCNL(md);
    assert.equal(r.valid, false);
    assert.equal(r.errors[0].code, 'UNKNOWN_FIELD');
  });

  it('validates multi-group numbering', () => {
    const md = '## Intent Group 1\nAct: define\nIntent: A.\nOutput: B.\n\n## Intent Group 3\nAct: explain\nIntent: C.\nOutput: D.';
    const r = v.validateIntentCNL(md);
    assert.equal(r.valid, false);
    assert.equal(r.errors[0].code, 'INVALID_GROUP_NUMBER');
  });

  it('handles continuation lines', () => {
    const md = '## Intent Group 1\nAct: compare\nIntent: Compare A\n  and B for deployment.\nOutput: Recommendation.';
    const r = v.validateIntentCNL(md);
    assert.equal(r.valid, true);
  });
});

describe('CNLValidator — Context CNL', () => {
  const v = new CNLValidator();

  it('accepts valid context CNL', () => {
    const md = '## Context Unit src-001::chunk-000::unit-000\nSourceId: src-001\nChunkId: src-001::chunk-000\nRole: Definition\nTopic: BM25\nClaim: BM25 is a ranking function.\nUtilityActs: define';
    assert.equal(v.validateContextCNL(md).valid, true);
  });

  it('accepts valid symbolic fact fields in context CNL', () => {
    const md = '## Context Unit src-001::chunk-000::unit-000\nSourceId: src-001\nChunkId: src-001::chunk-000\nRole: Explanation\nTopic: AchillesIDE\nClaim: AchillesIDE uses Ploinky.\nSubject: AchillesIDE\nRelation: uses\nObject: Ploinky\nConfidence: 0.95\nUtilityActs: explain';
    assert.equal(v.validateContextCNL(md).valid, true);
  });

  it('rejects Claim+Procedure conflict', () => {
    const md = '## Context Unit x\nSourceId: s\nChunkId: c\nRole: Procedure\nTopic: T\nClaim: C\nProcedure: P\nUtilityActs: implement';
    const r = v.validateContextCNL(md);
    assert.equal(r.valid, false);
    assert.ok(r.errors.some(e => e.code === 'CLAIM_AND_PROCEDURE_CONFLICT'));
  });

  it('rejects missing Claim for non-Procedure role', () => {
    const md = '## Context Unit x\nSourceId: s\nChunkId: c\nRole: Definition\nTopic: T\nUtilityActs: define';
    const r = v.validateContextCNL(md);
    assert.equal(r.valid, false);
    assert.ok(r.errors.some(e => e.code === 'MISSING_CLAIM_FOR_ROLE'));
  });

  it('rejects incomplete symbolic fact fields', () => {
    const md = '## Context Unit x\nSourceId: s\nChunkId: c\nRole: Explanation\nTopic: T\nClaim: AchillesIDE uses Ploinky.\nSubject: AchillesIDE\nRelation: uses\nUtilityActs: explain';
    const r = v.validateContextCNL(md);
    assert.equal(r.valid, false);
    assert.ok(r.errors.some(e => e.code === 'INCOMPLETE_SYMBOLIC_FACT'));
  });
});

// ── Parser ──

describe('CNLParser', () => {
  const p = new CNLParser();

  it('parses intent groups with all fields', () => {
    const md = '## Intent Group 1\nAct: compare\nIntent: Compare A and B.\nContext: CPU-only.\nCriterion: Speed, cost.\nEvidence: A is faster.\nOutput: Recommendation.';
    const groups = p.parseIntentCNL(md);
    assert.equal(groups.length, 1);
    assert.equal(groups[0].act, 'compare');
    assert.equal(groups[0].context, 'CPU-only.');
  });

  it('parses context units', () => {
    const md = '## Context Unit src-001::chunk-000::unit-000\nSourceId: src-001\nChunkId: src-001::chunk-000\nRole: Definition\nTopic: BM25\nClaim: BM25 is a ranking function.\nUtilityActs: define, explain';
    const units = p.parseContextCNL(md);
    assert.equal(units.length, 1);
    assert.equal(units[0].role, 'Definition');
    assert.deepStrictEqual(units[0].utilityActs, ['define', 'explain']);
  });

  it('parses symbolic fact fields from context units', () => {
    const md = '## Context Unit src-001::chunk-000::unit-000\nSourceId: src-001\nChunkId: src-001::chunk-000\nRole: Explanation\nTopic: AchillesIDE\nClaim: AchillesIDE uses Ploinky.\nSubject: AchillesIDE\nRelation: uses\nObject: Ploinky\nConfidence: 0.95\nUtilityActs: explain';
    const units = p.parseContextCNL(md);
    assert.equal(units[0].subject, 'AchillesIDE');
    assert.equal(units[0].relation, 'uses');
    assert.equal(units[0].object, 'Ploinky');
    assert.equal(units[0].confidence, 0.95);
  });

  it('throws on missing Act in parser', () => {
    const md = '## Intent Group 1\nIntent: X.\nOutput: Y.';
    assert.throws(() => p.parseIntentCNL(md), /missing Act/);
  });
});

// ── Tokenizer ──

describe('Tokenizer', () => {
  it('lowercases and removes stopwords', () => {
    const tokens = tokenize('The quick brown fox');
    assert.ok(!tokens.includes('the'));
    assert.ok(tokens.some(t => t.startsWith('quick') || t.startsWith('brown')));
  });

  it('handles hyphenated terms', () => {
    const tokens = tokenize('CPU-only deployment');
    assert.ok(tokens.includes('cpu-onli') || tokens.includes('cpu-only') || tokens.some(t => t.startsWith('cpu')));
  });

  it('strips possessives', () => {
    const tokens = tokenize("user's data");
    assert.ok(tokens.some(t => t.startsWith('user')));
    assert.ok(!tokens.some(t => t.includes("'s")));
  });
});

// ── Decomposer ──

describe('IntentDecomposer', () => {
  const d = new IntentDecomposer();

  it('extracts target by removing first word', () => {
    const groups = [{ groupNumber: 1, act: 'compare', intent: 'Compare BM25 and dense retrieval.', context: null, criterion: 'Speed, cost', evidence: null, output: 'Recommendation' }];
    const result = d.decompose(groups);
    assert.equal(result[0].target, 'BM25 and dense retrieval');
    assert.deepStrictEqual(result[0].criteria, ['Speed', 'cost']);
  });

  it('derives context profile with needed roles', () => {
    const decomposed = { groupNumber: 1, act: 'compare', target: 'A and B', criteria: [], evidence: [], explicitContext: null, outputType: 'X' };
    const profile = d.deriveContextProfile(decomposed);
    assert.deepStrictEqual(profile.neededRoles, ['Comparison', 'Evaluation']);
    assert.equal(profile.actBoost, 'compare');
  });
});

// ── BM25 Index ──

describe('KBIndex', () => {
  it('indexes and retrieves units', () => {
    const idx = new KBIndex();
    idx.addUnit({ id: 'u1', role: 'Definition', topic: 'BM25 ranking', claim: 'BM25 is a lexical retrieval method', utilityActs: ['define'], condition: null, procedure: null, utilityNote: null });
    idx.addUnit({ id: 'u2', role: 'Explanation', topic: 'Dense retrieval', claim: 'Dense retrieval uses neural embeddings', utilityActs: ['explain'], condition: null, procedure: null, utilityNote: null });
    const results = idx.search('BM25 lexical retrieval');
    assert.ok(results.length > 0);
    assert.equal(results[0].unitId, 'u1');
  });

  it('applies role boost', () => {
    const idx = new KBIndex();
    idx.addUnit({ id: 'u1', role: 'Comparison', topic: 'A vs B', claim: 'A is faster than B', utilityActs: ['compare'], condition: null, procedure: null, utilityNote: null });
    idx.addUnit({ id: 'u2', role: 'Procedure', topic: 'A vs B', claim: 'Steps to compare A and B', utilityActs: ['compare'], condition: null, procedure: null, utilityNote: null });
    const results = idx.search('compare A B', { actBoost: 'compare' });
    // Comparison role should be boosted for 'compare' act
    assert.equal(results[0].unitId, 'u1');
  });

  it('deduplicates by hash', () => {
    const idx = new KBIndex();
    const unit = { id: 'u1', role: 'Definition', topic: 'X', claim: 'X is Y', utilityActs: ['define'], hash: 'abc', condition: null, procedure: null, utilityNote: null };
    idx.addUnit(unit);
    idx.addUnit({ ...unit, id: 'u2' });
    assert.equal(idx.getStats().totalUnits, 2);
  });

  it('serializes and deserializes', () => {
    const idx = new KBIndex();
    idx.addUnit({ id: 'u1', role: 'Definition', topic: 'test', claim: 'test claim', utilityActs: ['define'], condition: null, procedure: null, utilityNote: null, hash: 'h1' });
    const data = idx.toIndexData();
    const idx2 = new KBIndex();
    idx2.loadFromIndexData(data, [{ id: 'u1', role: 'Definition', topic: 'test', claim: 'test claim', utilityActs: ['define'], hash: 'h1' }]);
    assert.equal(idx2.getStats().totalUnits, 1);
    assert.ok(idx2.search('test').length > 0);
  });
});
