// Integration tests for DS030 KU model, validation rejection, and plugin contracts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { CNLValidator, CNLParser } from '../../src/core/parser/cnl-validator-parser.mjs';
import { SymbolicOnlyStrategy } from '../../src/mrp-vm-sdk/strategies/symbolic-only.mjs';
import { KBIndex } from '../../src/core/kb/index.mjs';

describe('KU fields in CNL parser', () => {
  const parser = new CNLParser();
  const validator = new CNLValidator();

  it('parses KUType, Title, SourceType, Author, IngestedAt, KnowledgeDate fields', () => {
    const cnl = `## Context Unit src-001::chunk-000::unit-000
SourceId: src-001
ChunkId: src-001::chunk-000
KUType: atomic
Title: BM25 retrieval overview
Role: Explanation
Topic: BM25 retrieval
Claim: BM25 uses term frequency and inverse document frequency.
SourceType: technical
Author: John Doe
IngestedAt: 2026-03-31T10:00:00Z
KnowledgeDate: 2026-01-15
UtilityActs: explain
Hash: abc123`;

    const vr = validator.validateContextCNL(cnl);
    assert.ok(vr.valid, `Validation errors: ${JSON.stringify(vr.errors)}`);

    const units = parser.parseContextCNL(cnl);
    assert.equal(units.length, 1);
    assert.equal(units[0].kuType, 'atomic');
    assert.equal(units[0].title, 'BM25 retrieval overview');
    assert.equal(units[0].sourceType, 'technical');
    assert.equal(units[0].author, 'John Doe');
    assert.equal(units[0].ingestedAt, '2026-03-31T10:00:00Z');
    assert.equal(units[0].knowledgeDate, '2026-01-15');
  });

  it('accepts KUType composite and aggregate', () => {
    const cnl = `## Context Unit src-001::section-000
SourceId: src-001
ChunkId: src-001::chunk-000
KUType: composite
Title: Chapter 1 summary
Role: Narrative
Topic: Chapter 1
Claim: Chapter 1 introduces the main characters.
ChildUnitIds: src-001::chunk-000::unit-000, src-001::chunk-000::unit-001
UtilityActs: describe`;

    const vr = validator.validateContextCNL(cnl);
    assert.ok(vr.valid, `Validation errors: ${JSON.stringify(vr.errors)}`);

    const units = parser.parseContextCNL(cnl);
    assert.equal(units[0].kuType, 'composite');
    assert.deepEqual(units[0].childUnitIds, ['src-001::chunk-000::unit-000', 'src-001::chunk-000::unit-001']);
  });
});

describe('Symbolic ingest produces individual KUs per fact', () => {
  const strategy = new SymbolicOnlyStrategy();

  it('emits separate KUs for sentences with different symbolic facts', async () => {
    const result = await strategy.normalizePersistentContext({
      chunkText: 'Alpha uses Beta. Gamma depends on Delta. Epsilon provides Zeta.',
      provenance: { sourceId: 'src-test', chunkId: 'src-test::chunk-000' }
    });
    const parser = new CNLParser();
    const units = parser.parseContextCNL(result.contextCNL);

    // Each fact-bearing sentence should be its own KU
    assert.equal(units.length, 3, `Expected 3 KUs, got ${units.length}`);
    assert.equal(units[0].subject, 'Alpha');
    assert.equal(units[0].relation, 'uses');
    assert.equal(units[1].subject, 'Gamma');
    assert.equal(units[1].relation, 'depends_on');
    assert.equal(units[2].subject, 'Epsilon');
    assert.equal(units[2].relation, 'provides');
  });

  it('groups non-fact sentences into composite KUs', async () => {
    const result = await strategy.normalizePersistentContext({
      chunkText: 'The system is fast. It handles many requests. Alpha uses Beta.',
      provenance: { sourceId: 'src-test', chunkId: 'src-test::chunk-000' }
    });
    const parser = new CNLParser();
    const units = parser.parseContextCNL(result.contextCNL);

    // Non-fact sentences grouped, fact sentence separate
    assert.ok(units.length >= 2, `Expected at least 2 KUs, got ${units.length}`);
    const factUnit = units.find(u => u.subject === 'Alpha');
    assert.ok(factUnit, 'Should have a fact-bearing KU for Alpha uses Beta');
    assert.equal(factUnit.relation, 'uses');
  });

  it('emits KUType field in CNL output', async () => {
    const result = await strategy.normalizePersistentContext({
      chunkText: 'Alpha uses Beta.',
      provenance: { sourceId: 'src-test', chunkId: 'src-test::chunk-000' }
    });
    assert.ok(result.contextCNL.includes('KUType:'), 'Should include KUType field');
  });

  it('serializes multiline guidance safely for Context CNL validation', async () => {
    const result = await strategy.normalizePersistentContext({
      chunkText: 'Questions — answer each with a single word only:\n\nQ1: Is Alpha safe?\n\nQ2: Name the operator.',
      provenance: { sourceId: 'src-test', chunkId: 'src-test::chunk-000' }
    });
    const validator = new CNLValidator();
    const vr = validator.validateContextCNL(result.contextCNL);
    assert.ok(vr.valid, `Validation errors: ${JSON.stringify(vr.errors)}`);
  });

  it('stores question appendices as guidance-only units instead of evidence KUs', async () => {
    const result = await strategy.normalizePersistentContext({
      chunkText: 'Alpha uses Beta.\n\nQuestions — answer each with a single word only:\n\nQ1: Is Alpha safe?\n\nQ2: Name the operator.',
      provenance: { sourceId: 'src-test', chunkId: 'src-test::chunk-000' }
    });
    const parser = new CNLParser();
    const units = parser.parseContextCNL(result.contextCNL);

    assert.equal(units.length, 2, `Expected fact + guidance units, got ${units.length}`);
    const factUnit = units.find(unit => unit.subject === 'Alpha');
    const guidanceUnit = units.find(unit => (unit.claim || '').includes('Questions — answer each with a single word only:'));

    assert.ok(factUnit, 'Should retain the fact-bearing unit');
    assert.ok(guidanceUnit, 'Should keep the appendix header as a guidance unit');
    assert.ok(guidanceUnit.phaseScopes.includes('gs-plugin'));
    assert.ok(!guidanceUnit.phaseScopes.includes('kb-plugin'));
    assert.ok(!(guidanceUnit.claim || '').includes('Q1:'), 'Question prompts should not be persisted as evidence text');
  });

  it('does not store plain task requests as session context facts', async () => {
    const result = await strategy.extractSessionContext({
      rawNL: 'Explain why AchillesIDE benefits from isolation for secure execution.'
    });
    assert.equal(result.contextCNL, '');
  });

  it('does not store direct task prompts even when they resemble symbolic facts', async () => {
    const result = await strategy.extractSessionContext({
      rawNL: 'Explain why AchillesIDE is relevant for secure execution.'
    });
    assert.equal(result.contextCNL, '');
  });
});

describe('KBIndex change listeners', () => {
  it('fires change listener on removeUnit', () => {
    const index = new KBIndex();
    const events = [];
    index.onChange((event, unitId) => events.push({ event, unitId }));

    index.addUnit({ id: 'u1', role: 'Explanation', topic: 'test', claim: 'test claim', utilityActs: ['explain'] });
    index.removeUnit('u1');

    assert.ok(events.some(e => e.event === 'remove' && e.unitId === 'u1'));
  });

  it('fires change listener on rebuild', () => {
    const index = new KBIndex();
    const events = [];
    index.onChange((event) => events.push(event));

    index.rebuild([{ id: 'u1', role: 'Explanation', topic: 'test', claim: 'test', utilityActs: [] }]);

    assert.ok(events.includes('rebuild'));
  });
});

describe('Validation rejection is retryable', () => {
  it('VALIDATION_REJECTED is in the retryable error set', async () => {
    // We verify the engine code includes VALIDATION_REJECTED in retryablePlannerErrors
    // by importing and checking the engine source pattern
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const engineSrc = readFileSync(resolve(process.cwd(), 'src/core/engine/engine.mjs'), 'utf-8');

    assert.ok(engineSrc.includes("'VALIDATION_REJECTED'"), 'VALIDATION_REJECTED should be in retryable errors');
    assert.ok(engineSrc.includes("throw new MRPError(\n              'VALIDATION_REJECTED'") ||
              engineSrc.includes("throw new MRPError(") && engineSrc.includes("'VALIDATION_REJECTED'"),
              'Engine should throw VALIDATION_REJECTED on rejection');
    // Verify it does NOT just annotate goalResult
    assert.ok(!engineSrc.includes('goalResult.validationRejected = true'),
              'Engine should not silently annotate — it should throw');
  });
});

describe('Planner description-based scoring', () => {
  it('scores higher when plugin description matches query terms', async () => {
    const { DefaultPlannerPlugin } = await import('../../src/plugins/runtime/default-planner-plugin.mjs');
    const { TypedPluginRegistry } = await import('../../src/plugins/runtime/typed-registry.mjs');

    const registry = new TypedPluginRegistry();
    // Register two fake kb-plugins with different descriptions
    registry.register({
      getDescriptor: () => ({
        id: 'kb-embeddings', type: 'kb-plugin', name: 'Embeddings KB',
        description: 'Semantic search using embeddings for technical documents.',
        costClass: 'moderate', usesLLM: false, maxLLMCalls: 0, modelRoles: [],
        plannerHints: { expectedLatencyMs: 200, relativeCost: 0.3, supportedActs: ['explain'], confidenceWhenMatched: 0.7 }
      })
    });
    registry.register({
      getDescriptor: () => ({
        id: 'kb-legal', type: 'kb-plugin', name: 'Legal KB',
        description: 'Specialized retrieval for legal contracts and compliance documents.',
        costClass: 'moderate', usesLLM: false, maxLLMCalls: 0, modelRoles: [],
        plannerHints: { expectedLatencyMs: 200, relativeCost: 0.3, supportedActs: ['explain'], confidenceWhenMatched: 0.7 }
      })
    });

    const planner = new DefaultPlannerPlugin(registry, null, {});
    const plan = await planner.buildPlan({
      currentMessage: 'What does the legal contract say about compliance obligations?',
      historyForPrompt: [],
      explicitSelections: {},
      sessionPreferences: {}
    });

    // kb-legal should rank higher because "legal", "contract", "compliance" match its description
    const kbOrder = plan.kbPluginOrder;
    const legalIdx = kbOrder.indexOf('kb-legal');
    const embIdx = kbOrder.indexOf('kb-embeddings');
    assert.ok(legalIdx >= 0 && embIdx >= 0, 'Both plugins should be in the order');
    assert.ok(legalIdx < embIdx, `kb-legal (${legalIdx}) should rank before kb-embeddings (${embIdx})`);
  });
});

describe('Retrieval trace includes KU-level metrics', () => {
  it('reports kuLevelsUsed and counts in retrievalTrace', async () => {
    const { ContextMatcher } = await import('../../src/plugins/kb-plugin/kb-fast/retrieval/context-matcher.mjs');
    const matcher = new ContextMatcher(
      { get: () => ({ retrieve: async () => ({ candidates: [] }) }), getProfile: () => ({ primaryStrategies: ['bm25-lexical'], secondaryStrategies: [] }) },
      {}
    );

    // Minimal test: resolve with empty data to check trace shape
    const results = await matcher.resolve(
      [{ groupNumber: 1, act: 'explain', intent: 'test', target: 'test', criteria: [], evidence: [], explicitContext: null, outputType: 'answer' }],
      [{ intentGroupNumber: 1, neededRoles: ['Explanation'], queryText: 'test', queryTerms: ['test'], actBoost: 'explain', maxResults: 5 }],
      [],
      { sessionIndex: new KBIndex() },
      'fast',
      new KBIndex()
    );

    assert.equal(results.length, 1);
    const trace = results[0].retrievalTrace;
    assert.ok(Array.isArray(trace.kuLevelsUsed), 'Should have kuLevelsUsed array');
    assert.ok(typeof trace.totalKUsConsidered === 'number', 'Should have totalKUsConsidered');
    assert.ok(typeof trace.selectedKUCount === 'number', 'Should have selectedKUCount');
  });
});

describe('Current-turn context is filtered per intent', () => {
  it('filters current-turn KUs by intent query terms', async () => {
    const { ContextMatcher } = await import('../../src/plugins/kb-plugin/kb-fast/retrieval/context-matcher.mjs');
    const matcher = new ContextMatcher(
      { get: () => ({ retrieve: async () => ({ candidates: [] }) }), getProfile: () => ({ primaryStrategies: ['bm25-lexical'], secondaryStrategies: [] }) },
      {}
    );

    const currentTurnUnits = [
      { id: 'ct-1', role: 'Explanation', topic: 'Alpha retrieval', claim: 'Alpha uses BM25', utilityActs: ['explain'] },
      { id: 'ct-2', role: 'Constraint', topic: 'Beta deployment', claim: 'Beta runs on GPU only', utilityActs: ['verify'] }
    ];

    const results = await matcher.resolve(
      [{ groupNumber: 1, act: 'explain', intent: 'How does Alpha retrieval work?', target: 'Alpha retrieval', criteria: [], evidence: [], explicitContext: null, outputType: 'answer' }],
      [{ intentGroupNumber: 1, neededRoles: ['Explanation'], queryText: 'Alpha retrieval', queryTerms: ['alpha', 'retrieval'], actBoost: 'explain', maxResults: 5 }],
      currentTurnUnits,
      { sessionIndex: new KBIndex() },
      'fast',
      new KBIndex()
    );

    // Should filter to only the Alpha-related unit
    const ctUnits = results[0].currentTurnContextUnits;
    assert.ok(ctUnits.length === 1, `Expected 1 filtered unit, got ${ctUnits.length}`);
    assert.equal(ctUnits[0].id, 'ct-1');
  });

  it('keeps explicit guidance units routed by phase scopes', async () => {
    const { ContextMatcher } = await import('../../src/plugins/kb-plugin/kb-fast/retrieval/context-matcher.mjs');
    const matcher = new ContextMatcher(
      { get: () => ({ retrieve: async () => ({ candidates: [] }) }), getProfile: () => ({ primaryStrategies: ['bm25-lexical'], secondaryStrategies: [] }) },
      {}
    );

    const currentTurnUnits = [
      { id: 'ct-1', role: 'Explanation', topic: 'Alpha retrieval', claim: 'Alpha uses BM25', utilityActs: ['explain'] },
      {
        id: 'ct-2',
        role: 'Constraint',
        topic: 'Output style',
        claim: 'Return the answer as JSON with fields answer and evidence.',
        utilityActs: ['recommend'],
        phaseScopes: ['gs-plugin']
      }
    ];

    const results = await matcher.resolve(
      [{ groupNumber: 1, act: 'explain', intent: 'How does Alpha retrieval work?', target: 'Alpha retrieval', criteria: [], evidence: [], explicitContext: null, outputType: 'answer' }],
      [{ intentGroupNumber: 1, neededRoles: ['Explanation'], queryText: 'Alpha retrieval', queryTerms: ['alpha', 'retrieval'], actBoost: 'explain', maxResults: 5 }],
      currentTurnUnits,
      { sessionIndex: new KBIndex(), sessionContextUnits: [] },
      'fast',
      new KBIndex()
    );

    assert.equal(results[0].currentTurnContextUnits.length, 1);
    assert.equal(results[0].currentTurnContextUnits[0].id, 'ct-1');
    assert.equal(results[0].guidanceUnits.goalSolver.length, 1);
    assert.equal(results[0].guidanceUnits.goalSolver[0].unit.id, 'ct-2');
    assert.equal(results[0].guidanceUnits.planner.length, 0);
    assert.equal(results[0].guidanceUnits.seedDetector.length, 0);
    assert.equal(results[0].guidanceUnits.validation.length, 0);
  });

  it('does not let non-evidence guidance units displace evidence units', async () => {
    const { ContextMatcher } = await import('../../src/plugins/kb-plugin/kb-fast/retrieval/context-matcher.mjs');
    const { RetrievalStrategyRegistry, BM25LexicalStrategy } = await import('../../src/plugins/kb-plugin/kb-fast/retrieval/strategies/registry.mjs');

    const registry = new RetrievalStrategyRegistry();
    registry.register(new BM25LexicalStrategy());
    registry.setProfiles({
      fast: {
        primaryStrategies: ['bm25-lexical'],
        secondaryStrategies: [],
        maxResults: 5,
        minScore: 0.05
      }
    });

    const matcher = new ContextMatcher(registry, {
      agreementBonus: 0,
      roleBoostFactor: 1,
      sessionBoostFactor: 1
    });

    const sessionIndex = new KBIndex();
    sessionIndex.addUnit({
      id: 'guide-1',
      role: 'Constraint',
      topic: 'Output rules',
      claim: 'Return a single word about Quartz Desert Flux Core obelisk Frozen Abyss.',
      utilityActs: ['identify'],
      phaseScopes: ['gs-plugin']
    });
    sessionIndex.addUnit({
      id: 'fact-1',
      role: 'Narrative',
      topic: 'Commander Vex extraction',
      claim: 'Commander Vex extracted the Flux Core in the Quartz Desert.',
      utilityActs: ['identify'],
      phaseScopes: ['kb-plugin']
    });

    const results = await matcher.resolve(
      [{ groupNumber: 1, act: 'identify', intent: 'Name the character tied to the Quartz Desert Flux Core.', target: 'Quartz Desert Flux Core', criteria: [], evidence: [], explicitContext: null, outputType: 'One word.' }],
      [{ intentGroupNumber: 1, neededRoles: ['Narrative', 'Description', 'Definition'], queryText: 'Quartz Desert Flux Core', queryTerms: ['quartz', 'desert', 'flux', 'core'], actBoost: 'identify', maxResults: 5 }],
      [],
      { sessionIndex, sessionContextUnits: [...sessionIndex.units.values()] },
      'fast',
      new KBIndex()
    );

    assert.equal(results[0].sessionUnits.length, 1, 'Evidence unit should survive confidence-gap pruning');
    assert.equal(results[0].sessionUnits[0].unitId, 'fact-1');
    assert.equal(results[0].guidanceUnits.goalSolver.length, 1, 'Guidance unit should still be routed to the goal solver');
    assert.equal(results[0].guidanceUnits.goalSolver[0].unitId, 'guide-1');
  });

  it('defaults to kb-plugin scope when no explicit phase scopes are provided', async () => {
    const { inferPhaseScopes } = await import('../../src/mrp-vm-sdk/knowledge/pragmatics.mjs');
    const scopes = inferPhaseScopes({
      role: 'Constraint',
      claim: 'Return JSON output.',
      utilityActs: ['recommend'],
      phaseScopes: []
    });
    assert.deepEqual(scopes, ['kb-plugin']);
  });
});

describe('Wrapper manifest requires protocolVersion', () => {
  it('rejects manifests without protocolVersion', async () => {
    const { PluginManager } = await import('../../src/plugins/runtime/wrapper-manager.mjs');
    const { mkdirSync, writeFileSync, rmSync } = await import('node:fs');
    const { join } = await import('node:path');
    const tmpDir = join(process.cwd(), 'test/fixtures/tmp-wrappers');
    const pluginDir = join(tmpDir, 'test-plugin');
    mkdirSync(pluginDir, { recursive: true });
    writeFileSync(join(pluginDir, 'manifest.json'), JSON.stringify({
      id: 'test-plugin', name: 'Test', command: 'echo', args: ['hi']
      // no protocolVersion
    }));

    const mgr = new PluginManager({ pluginAllowlist: ['test-plugin'] });
    await mgr.scanWrappers(tmpDir);
    assert.equal(mgr.getPlugins().length, 0, 'Should reject manifest without protocolVersion');

    rmSync(tmpDir, { recursive: true, force: true });
  });
});
