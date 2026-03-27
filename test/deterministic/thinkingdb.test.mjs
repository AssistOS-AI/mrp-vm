import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ThinkingDB } from '../../src/retrieval/thinkingdb.mjs';
import { ThinkingDBSymbolicStrategy } from '../../src/retrieval/strategies/thinkingdb.mjs';
import { SymbolicOnlyStrategy } from '../../src/strategies/symbolic-only.mjs';
import { CNLParser } from '../../src/parser/cnl-validator-parser.mjs';

const RULES = [
  {
    id: 'tool_to_capability',
    when: [
      { s: '?x', r: 'uses', o: '?y' },
      { s: '?y', r: 'provides', o: '?z' }
    ],
    then: { s: '?x', r: 'has_capability', o: '?z' },
    weight: 0.95
  },
  {
    id: 'capability_to_relevance',
    when: [
      { s: '?x', r: 'has_capability', o: '?c' },
      { s: '?c', r: 'relevant_for', o: '?goal' }
    ],
    then: { s: '?x', r: 'relevant_for', o: '?goal' },
    weight: 0.9
  },
  {
    id: 'provider_to_relevance',
    when: [
      { s: '?x', r: 'provides', o: '?c' },
      { s: '?c', r: 'relevant_for', o: '?goal' }
    ],
    then: { s: '?x', r: 'relevant_for', o: '?goal' },
    weight: 0.88
  }
];

const UNITS = [
  {
    id: 'u1',
    sourceId: 'src',
    chunkId: 'src::chunk-000',
    role: 'Explanation',
    topic: 'AchillesIDE',
    claim: 'AchillesIDE uses Ploinky.',
    utilityActs: ['explain'],
    subject: 'AchillesIDE',
    relation: 'uses',
    object: 'Ploinky',
    confidence: 1
  },
  {
    id: 'u2',
    sourceId: 'src',
    chunkId: 'src::chunk-000',
    role: 'Explanation',
    topic: 'Ploinky',
    claim: 'Ploinky provides sandboxing.',
    utilityActs: ['explain'],
    subject: 'Ploinky',
    relation: 'provides',
    object: 'sandboxing',
    confidence: 0.95
  },
  {
    id: 'u3',
    sourceId: 'src',
    chunkId: 'src::chunk-000',
    role: 'Explanation',
    topic: 'sandboxing',
    claim: 'sandboxing is relevant for secure execution.',
    utilityActs: ['explain'],
    subject: 'sandboxing',
    relation: 'relevant_for',
    object: 'secure execution',
    confidence: 0.9
  }
];

const NOISY_UNITS = [
  ...UNITS,
  {
    id: 'u4',
    sourceId: 'src',
    chunkId: 'src::chunk-001',
    role: 'Explanation',
    topic: 'meeting notes',
    claim: 'meeting notes are relevant for secure execution.',
    utilityActs: ['explain'],
    subject: 'meeting notes',
    relation: 'relevant_for',
    object: 'secure execution',
    confidence: 0.9
  }
];

describe('ThinkingDB', () => {
  it('derives multi-hop relevance and returns proof-bearing candidates', () => {
    const db = new ThinkingDB({ maxDepth: 3, maxDerivedFactsPerQuery: 16, maxProofs: 16, minConfidence: 0.01 });
    db.registerRules(RULES);
    for (const unit of UNITS) db.addUnit(unit, 'kb');

    const result = db.query({ queryTerms: ['achilleside', 'secure', 'execution'] }, { maxCandidates: 10 });
    assert.ok(result.derivedFacts.some(f => f.r === 'relevant_for' && f.s === 'AchillesIDE' && f.o === 'secure execution'));
    assert.ok(result.candidates.some(c => c.unitId === 'u2'));
    assert.ok(result.proofs.some(p => p.r === 'relevant_for' && p.s === 'AchillesIDE' && p.o === 'secure execution'));
  });

  it('focuses on proof chains instead of returning unrelated lexical goal matches', () => {
    const db = new ThinkingDB({
      maxDepth: 3,
      maxDerivedFactsPerQuery: 16,
      maxProofs: 16,
      maxSeedFacts: 6,
      maxFocusedProofs: 6,
      minConfidence: 0.01
    });
    db.registerRules(RULES);
    for (const unit of NOISY_UNITS) db.addUnit(unit, 'kb');

    const result = db.query(
      { queryText: 'Explain why AchillesIDE is relevant for secure execution', queryTerms: ['achilleside', 'secure', 'execution'] },
      { maxCandidates: 10 }
    );

    assert.ok(result.proofs.some(p => p.r === 'relevant_for' && p.s === 'AchillesIDE' && p.o === 'secure execution'));
    assert.equal(result.candidates.some(c => c.unitId === 'u4'), false);
  });
});

describe('ThinkingDBSymbolicStrategy', () => {
  it('returns DS023-style candidates from symbolic closure', async () => {
    const strategy = new ThinkingDBSymbolicStrategy({
      maxDepth: 3,
      maxDerivedFactsPerQuery: 16,
      maxProofs: 16,
      minConfidence: 0.01,
      rules: RULES
    });
    const kbIndex = { units: new Map(UNITS.map(u => [u.id, u])) };
    const result = await strategy.retrieve({
      contextProfile: { queryTerms: ['achilleside', 'secure', 'execution'], maxResults: 10 },
      currentTurnUnits: [],
      sessionIndex: null,
      kbIndex,
      budget: { maxCandidates: 10 }
    });
    assert.ok(result.candidates.some(c => c.unitId === 'u2'));
    assert.ok(result.candidates.every(c => typeof c.normalizedScore === 'number'));
  });
});

describe('SymbolicOnlyStrategy symbolic fields', () => {
  it('emits Subject/Relation/Object for simple persistent facts', async () => {
    const strategy = new SymbolicOnlyStrategy();
    const { contextCNL } = await strategy.normalizePersistentContext({
      chunkText: 'AchillesIDE uses Ploinky. Ploinky provides sandboxing.',
      provenance: { sourceId: 'src-1', chunkId: 'src-1::chunk-000', chunkIndex: 0 }
    });
    const parser = new CNLParser();
    const units = parser.parseContextCNL(contextCNL);
    assert.equal(units[0].subject, 'AchillesIDE');
    assert.equal(units[0].relation, 'uses');
    assert.equal(units[0].object, 'Ploinky');
    assert.equal(units[1].relation, 'provides');
  });

  it('keeps all symbolic fact sentences in a chunk instead of truncating after five units', async () => {
    const strategy = new SymbolicOnlyStrategy();
    const { contextCNL } = await strategy.normalizePersistentContext({
      chunkText: [
        'AchillesIDE uses Ploinky.',
        'Ploinky provides sandboxing.',
        'Sandboxing is relevant for secure execution.',
        'AchillesIDE depends on Ploinky.',
        'Ploinky depends on KernelX.',
        'KernelX provides isolation.',
        'Isolation is relevant for secure execution.'
      ].join(' '),
      provenance: { sourceId: 'src-2', chunkId: 'src-2::chunk-000', chunkIndex: 0 }
    });
    const parser = new CNLParser();
    const units = parser.parseContextCNL(contextCNL);
    assert.equal(units.length, 7);
    assert.equal(units[5].subject, 'KernelX');
    assert.equal(units[5].relation, 'provides');
    assert.equal(units[6].object, 'secure execution');
  });
});
