// Deterministic tests: parser, validator, tokenizer, decomposer, index
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CNLValidator, CNLParser } from '../../src/core/parser/cnl-validator-parser.mjs';
import { IntentDecomposer } from '../../src/core/intent/decomposer.mjs';
import { tokenize } from '../../src/mrp-vm-sdk/retrieval/tokenizer.mjs';
import { KBIndex } from '../../src/mrp-vm-sdk/retrieval/kb-index.mjs';
import { TypedPluginRegistry } from '../../src/plugins/runtime/typed-registry.mjs';
import { DefaultPlannerPlugin } from '../../src/plugins/runtime/default-planner-plugin.mjs';
import { MRPEngine } from '../../src/core/engine/engine.mjs';

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

  it('filters generic identify wrapper terms from query terms', () => {
    const decomposed = {
      groupNumber: 1,
      act: 'identify',
      intent: 'Name the single character whose Quartz Desert operations matter. One word.',
      target: 'the single character whose Quartz Desert operations matter. One word',
      criteria: [],
      evidence: [],
      explicitContext: null,
      outputType: 'One word.'
    };
    const profile = d.deriveContextProfile(decomposed);
    assert.ok(profile.queryTerms.includes('quartz'));
    assert.ok(!profile.queryTerms.includes('single'));
    assert.ok(!profile.queryTerms.includes('word'));
    assert.equal(profile.maxResults, 4);
  });

  it('adds capability and dependency expansion terms for explanatory retrieval', () => {
    const decomposed = {
      groupNumber: 1,
      act: 'explain',
      intent: 'Explain why Kaelen was uniquely qualified and how the system benefits from isolation.',
      target: 'why Kaelen was uniquely qualified and how the system benefits from isolation',
      criteria: [],
      evidence: [],
      explicitContext: null,
      outputType: 'Structured response.'
    };
    const profile = d.deriveContextProfile(decomposed);
    assert.ok(profile.queryTerms.includes('interface'));
    assert.ok(profile.queryTerms.includes('depends'));
    assert.ok(profile.focusTerms.includes('kaelen'));
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

describe('TypedPluginRegistry', () => {
  it('rejects unsupported plugin types', () => {
    const registry = new TypedPluginRegistry();
    assert.throws(
      () => registry.register({
        getDescriptor() {
          return { id: 'banana-1', type: 'banana' };
        }
      }),
      error => error.code === 'PLUGIN_REGISTRY_UNSUPPORTED_TYPE'
    );
  });
});

describe('DefaultPlannerPlugin', () => {
  it('uses depth cues to prefer heavier plugins first', async () => {
    const planner = new DefaultPlannerPlugin(null, { rank: ids => ids }, {});
    const plan = await planner.buildPlan({
      currentMessage: 'Provide a deep multi-hop step-by-step analysis of the trade-offs.',
      explicitSelections: {},
      sessionPreferences: {},
      historyForPrompt: []
    });
    assert.equal(plan.kbPluginOrder[0], 'kb-thinkingdb');
    assert.equal(plan.goalSolverOrder[0], 'gs-llm-deep');
    assert.ok(plan.notes.includes('depth-signals'));
  });

  it('discovers dynamically registered plugins and can route to them via planner hints', async () => {
    const registry = {
      listByType(type) {
        if (type !== 'kb-plugin') return [];
        return [
          { id: 'kb-fast' },
          { id: 'kb-balanced' },
          { id: 'kb-thinkingdb' },
          { id: 'kb-legal' }
        ];
      },
      get(type, id) {
        if (type !== 'kb-plugin') return null;
        const descriptors = {
          'kb-fast': {
            id: 'kb-fast',
            type: 'kb-plugin',
            costClass: 'cheap',
            plannerHints: {
              supportedActs: ['define', 'identify'],
              topicTags: ['technical'],
              preferredDepth: 'shallow',
              evidenceStyle: ['lexical'],
              fallbackRole: 'cheap-probe',
              relativeCost: 0.05,
              expectedLatencyMs: 40,
              expectedLLMCalls: 0,
              confidenceWhenMatched: 0.6
            }
          },
          'kb-balanced': { id: 'kb-balanced', type: 'kb-plugin', costClass: 'moderate', plannerHints: {} },
          'kb-thinkingdb': { id: 'kb-thinkingdb', type: 'kb-plugin', costClass: 'expensive', plannerHints: {} },
          'kb-legal': {
            id: 'kb-legal',
            type: 'kb-plugin',
            costClass: 'moderate',
            plannerHints: {
              supportedActs: ['verify', 'compare', 'explain'],
              topicTags: ['legal'],
              preferredDepth: 'deep',
              evidenceStyle: ['hybrid', 'symbolic-facts'],
              fallbackRole: 'default',
              relativeCost: 0.22,
              expectedLatencyMs: 110,
              expectedLLMCalls: 0,
              confidenceWhenMatched: 0.88
            }
          }
        };
        return {
          getDescriptor() {
            return descriptors[id];
          }
        };
      }
    };
    const planner = new DefaultPlannerPlugin(registry, { getUtility: () => 0.6 }, {});
    const plan = await planner.buildPlan({
      currentMessage: 'Verify the compliance obligations in this contract with a careful analysis.',
      explicitSelections: {},
      sessionPreferences: {},
      historyForPrompt: []
    });
    assert.equal(plan.kbPluginOrder[0], 'kb-legal');
    assert.ok(plan.kbPluginOrder.includes('kb-legal'));
  });
});

describe('MRPEngine', () => {
  it('skips an LLM plugin when its reserved budget exceeds the remaining budget', async () => {
    let detectCalls = 0;
    const planner = {
      getDescriptor() {
        return { id: 'planner-default', type: 'mrp-plan-plugin', modelRoles: [], maxLLMCalls: 0 };
      },
      async buildPlan() {
        return {
          plannerPluginId: 'planner-default',
          seedDetectorOrder: ['sd-llm-deep'],
          kbPluginOrder: [],
          goalSolverOrder: [],
          notes: []
        };
      },
      async recordOutcome() {}
    };
    const registry = {
      listByType(type) {
        return type === 'mrp-plan-plugin' ? [{ id: 'planner-default' }] : [];
      },
      get(type, id) {
        if (type === 'mrp-plan-plugin' && id === 'planner-default') return planner;
        if (type === 'sd-plugin' && id === 'sd-llm-deep') {
          return {
            getDescriptor() {
              return {
                id: 'sd-llm-deep',
                type: 'sd-plugin',
                maxLLMCalls: 2,
                modelRoles: ['seed-deep']
              };
            },
            async detectSeeds() {
              detectCalls += 1;
              return {
                status: 'success',
                intentCNL: '## Intent Group 1\nAct: explain\nIntent: X\nOutput: Y',
                currentTurnContextCNL: '',
                metadata: { llmCalls: 2, model: 'test-deep' },
                error: null
              };
            }
          };
        }
        return null;
      }
    };
    const conversationHandler = {
      async prepareTurn() {
        return {
          session: { sessionId: 'sess-test', preferredModel: null },
          currentMessage: 'Explain this.',
          historyForPrompt: [],
          systemPrompt: null,
          requestedModel: null,
          requestedPlannerPlugin: null,
          requestedSeedDetectorPlugin: null,
          requestedKBPlugin: null,
          requestedGoalSolverPlugin: null
        };
      },
      commitSuccessfulTurn() {}
    };
    const engine = new MRPEngine(
      {
        maxLLMAttemptsPerRequest: 1,
        requestTimeoutMs: 1000,
        maxPluginsPerStage: 4,
        defaultPlannerPlugin: 'planner-default'
      },
      registry,
      conversationHandler,
      {},
      {},
      { selectPlugin() { return null; } },
      {},
      null
    );

    await assert.rejects(
      () => engine.processChatTurn({ messages: [{ role: 'user', content: 'Explain this.' }] }),
      error => error.code === 'PLUGIN_STAGE_EXHAUSTED'
    );

    assert.equal(detectCalls, 0);
  });

  it('falls back to a second planner when the first planner exhausts its plan', async () => {
    const planners = {
      'planner-default': {
        getDescriptor() {
          return { id: 'planner-default', type: 'mrp-plan-plugin', modelRoles: [], maxLLMCalls: 0 };
        },
        async buildPlan() {
          return {
            plannerPluginId: 'planner-default',
            kbPluginOrder: ['kb-missing'],
            goalSolverOrder: ['gs-symbolic'],
            notes: []
          };
        },
        async recordOutcome() {}
      },
      'planner-depth': {
        getDescriptor() {
          return { id: 'planner-depth', type: 'mrp-plan-plugin', modelRoles: [], maxLLMCalls: 0 };
        },
        async buildPlan() {
          return {
            plannerPluginId: 'planner-depth',
            kbPluginOrder: ['kb-fast'],
            goalSolverOrder: ['gs-symbolic'],
            notes: []
          };
        },
        async recordOutcome() {}
      }
    };
    const registry = {
      listByType(type) {
        return type === 'mrp-plan-plugin'
          ? [{ id: 'planner-default' }, { id: 'planner-depth' }]
          : [];
      },
      get(type, id) {
        if (type === 'mrp-plan-plugin') return planners[id] || null;
        if (type === 'sd-plugin' && id === 'sd-symbolic') {
          return {
            getDescriptor() {
              return { id: 'sd-symbolic', type: 'sd-plugin', maxLLMCalls: 0, modelRoles: [] };
            },
            async detectSeeds() {
              return {
                status: 'success',
                intentCNL: '## Intent Group 1\nAct: explain\nIntent: Explain X.\nOutput: Y.',
                currentTurnContextCNL: '',
                metadata: { llmCalls: 0, model: null },
                error: null
              };
            }
          };
        }
        if (type === 'kb-plugin' && id === 'kb-fast') {
          return {
            getDescriptor() {
              return { id: 'kb-fast', type: 'kb-plugin', maxLLMCalls: 0, modelRoles: [] };
            },
            async retrieve() {
              return {
                status: 'success',
                sufficient: true,
                resolvedIntents: [{
                  intentRef: 1,
                  intentGroup: { groupNumber: 1, act: 'explain', intent: 'Explain X.', output: 'Y.' },
                  decomposed: { groupNumber: 1, act: 'explain', intent: 'Explain X.', outputType: 'Y.' },
                  currentTurnContextUnits: [],
                  sessionUnits: [],
                  kbUnits: [{
                    unitId: 'u1',
                    score: 1,
                    unit: { sourceId: 'src-1', role: 'Explanation', claim: 'X is caused by Y.' }
                  }],
                  retrievalTrace: {},
                  resolvedMarkdown: '## Resolved Intent Group 1'
                }],
                retrievalTrace: {},
                error: null
              };
            }
          };
        }
        if (type === 'gs-plugin' && id === 'gs-symbolic') {
          return {
            getDescriptor() {
              return { id: 'gs-symbolic', type: 'gs-plugin', maxLLMCalls: 0, modelRoles: [] };
            },
            async solve() {
              return {
                status: 'success',
                responseMarkdown: '# Answer',
                responseDocument: { sessionId: 'sess-test', groups: [] },
                metadata: { llmCalls: 0, model: null },
                error: null
              };
            }
          };
        }
        return null;
      }
    };
    let committedPlannerId = null;
    const conversationHandler = {
      async prepareTurn() {
        return {
          session: {
            sessionId: 'sess-test',
            preferredModel: null,
            preferredPlannerPlugin: 'planner-default',
            preferredSeedDetectorPlugin: 'sd-symbolic',
            preferredKBPlugin: 'kb-fast',
            preferredGoalSolverPlugin: 'gs-symbolic'
          },
          currentMessage: 'Explain X.',
          historyForPrompt: [],
          systemPrompt: null,
          requestedModel: null,
          requestedPlannerPlugin: null,
          requestedSeedDetectorPlugin: null,
          requestedKBPlugin: null,
          requestedGoalSolverPlugin: null
        };
      },
      commitSuccessfulTurn(_session, _message, _markdown, _units, _model, plannerId) {
        committedPlannerId = plannerId;
      }
    };
    const engine = new MRPEngine(
      {
        requestTimeoutMs: 1000,
        maxPluginsPerStage: 4,
        defaultPlannerPlugin: 'planner-default',
        plannerFallbackOrder: ['planner-default', 'planner-depth']
      },
      registry,
      conversationHandler,
      {
        parseIntentCNL() {
          return [{ groupNumber: 1, act: 'explain', intent: 'Explain X.', output: 'Y.' }];
        },
        parseContextCNL() {
          return [];
        }
      },
      {
        decompose(groups) {
          return groups.map(group => ({
            groupNumber: group.groupNumber,
            act: group.act,
            intent: group.intent,
            outputType: group.output
          }));
        },
        deriveContextProfile() {
          return { neededRoles: ['Explanation'], queryTerms: ['x'], actBoost: 'explain', maxResults: 10 };
        }
      },
      { collectOutputs() { return []; } },
      {},
      null
    );

    const result = await engine.processChatTurn({ messages: [{ role: 'user', content: 'Explain X.' }] });
    assert.equal(committedPlannerId, 'planner-depth');
    assert.deepStrictEqual(result.executionTrace.plannerAttempts, ['planner-default', 'planner-depth']);
    assert.equal(result.executionTrace.plannerPluginId, 'planner-depth');
    assert.equal(result.executionTrace.stages.every(stage => !!stage.plannerPluginId), true);
    assert.equal(result.executionTrace.stages[0].plannerPluginId, 'planner-depth');
  });

  it('passes parsed seeds to the planner and replans after KB guidance becomes available', async () => {
    const plannerCalls = [];
    const registry = {
      listByType(type) {
        return type === 'mrp-plan-plugin' ? [{ id: 'planner-default' }] : [];
      },
      get(type, id) {
        if (type === 'mrp-plan-plugin' && id === 'planner-default') {
          return {
            getDescriptor() {
              return { id: 'planner-default', type: 'mrp-plan-plugin', modelRoles: [], maxLLMCalls: 0 };
            },
            async buildPlan(input) {
              plannerCalls.push({
                phase: input.phase,
                intentCount: input.intentGroups?.length || 0,
                currentTurnUnitCount: input.currentTurnUnits?.length || 0,
                strategyGuidanceCount: input.strategyGuidanceUnits?.length || 0
              });
              return {
                plannerPluginId: 'planner-default',
                kbPluginOrder: ['kb-fast'],
                goalSolverOrder: ['gs-symbolic'],
                decompose: false,
                framePurpose: null,
                notes: []
              };
            },
            async recordOutcome() {}
          };
        }
        if (type === 'sd-plugin' && id === 'sd-symbolic') {
          return {
            getDescriptor() {
              return { id: 'sd-symbolic', type: 'sd-plugin', maxLLMCalls: 0, modelRoles: [] };
            },
            async detectSeeds() {
              return {
                status: 'success',
                intentCNL: '## Intent Group 1\nAct: explain\nIntent: Explain X.\nOutput: Y.',
                currentTurnContextCNL: '## Context Unit session::turn::unit-000\nSourceId: session\nChunkId: session::turn\nRole: Explanation\nTopic: X\nClaim: X is a running topic.\nUtilityActs: explain',
                metadata: { llmCalls: 0, model: null },
                error: null
              };
            }
          };
        }
        if (type === 'kb-plugin' && id === 'kb-fast') {
          return {
            getDescriptor() {
              return { id: 'kb-fast', type: 'kb-plugin', maxLLMCalls: 0, modelRoles: [] };
            },
            async retrieve() {
              return {
                status: 'success',
                sufficient: true,
                resolvedIntents: [{
                  intentRef: 1,
                  intentGroup: { groupNumber: 1, act: 'explain', intent: 'Explain X.', output: 'Y.' },
                  decomposed: { groupNumber: 1, act: 'explain', intent: 'Explain X.', outputType: 'Y.' },
                  strategyUnits: [{
                    unitId: 'guide-1',
                    score: 1,
                    store: 'kb',
                    unit: { sourceId: 'kb', role: 'Procedure', procedure: 'Use symbolic resolution first.', utilityActs: ['implement'] }
                  }],
                  currentTurnContextUnits: [],
                  sessionUnits: [],
                  kbUnits: [{
                    unitId: 'u1',
                    score: 1,
                    unit: { sourceId: 'src-1', role: 'Explanation', claim: 'X is caused by Y.' }
                  }],
                  retrievalTrace: { purpose: 'mixed' },
                  resolvedMarkdown: '## Resolved Intent Group 1'
                }],
                retrievalTrace: { purpose: 'mixed' },
                error: null
              };
            }
          };
        }
        if (type === 'gs-plugin' && id === 'gs-symbolic') {
          return {
            getDescriptor() {
              return { id: 'gs-symbolic', type: 'gs-plugin', maxLLMCalls: 0, modelRoles: [] };
            },
            async solve() {
              return {
                status: 'success',
                responseMarkdown: '# Answer',
                responseDocument: { sessionId: 'sess-test', groups: [] },
                metadata: { llmCalls: 0, model: null },
                error: null
              };
            }
          };
        }
        return null;
      }
    };
    const conversationHandler = {
      async prepareTurn() {
        return {
          session: {
            sessionId: 'sess-test',
            preferredModel: null,
            preferredPlannerPlugin: 'planner-default',
            preferredSeedDetectorPlugin: 'sd-symbolic',
            preferredKBPlugin: 'kb-fast',
            preferredGoalSolverPlugin: 'gs-symbolic',
            sessionContextUnits: [],
            pendingTurnContextUnits: [],
            mountedKbId: 'default',
            mountedKbName: 'Default KB',
            workspace: { getIndex() { return null; } },
            messageLog: []
          },
          currentMessage: 'Explain X.',
          historyForPrompt: [],
          systemPrompt: null,
          requestedModel: null,
          requestedPlannerPlugin: null,
          requestedSeedDetectorPlugin: 'sd-symbolic',
          requestedKBPlugin: 'kb-fast',
          requestedGoalSolverPlugin: 'gs-symbolic'
        };
      },
      async stageDetectedContextUnits() {},
      async commitSuccessfulTurn() {}
    };
    const engine = new MRPEngine(
      {
        requestTimeoutMs: 1000,
        maxPluginsPerStage: 4,
        defaultPlannerPlugin: 'planner-default'
      },
      registry,
      conversationHandler,
      {
        parseIntentCNL() {
          return [{ groupNumber: 1, act: 'explain', intent: 'Explain X.', output: 'Y.' }];
        },
        parseContextCNL() {
          return [{ id: 'ct-1', role: 'Explanation', topic: 'X', claim: 'X is a running topic.', utilityActs: ['explain'] }];
        }
      },
      {
        decompose(groups) {
          return groups.map(group => ({
            groupNumber: group.groupNumber,
            act: group.act,
            intent: group.intent,
            outputType: group.output
          }));
        },
        deriveContextProfile() {
          return { neededRoles: ['Explanation'], queryTerms: ['x'], actBoost: 'explain', maxResults: 10 };
        }
      },
      { collectOutputs() { return []; } },
      {},
      null
    );

    await engine.processChatTurn({ messages: [{ role: 'user', content: 'Explain X.' }] });
    assert.deepStrictEqual(plannerCalls, [
      { phase: 'post-seed', intentCount: 1, currentTurnUnitCount: 1, strategyGuidanceCount: 0 },
      { phase: 'post-kb', intentCount: 1, currentTurnUnitCount: 1, strategyGuidanceCount: 1 }
    ]);
  });

  it('opens a child frame when the planner requests decomposition after retrieval', async () => {
    let plannerCallCount = 0;
    const registry = {
      listByType(type) {
        return type === 'mrp-plan-plugin' ? [{ id: 'planner-default' }] : [];
      },
      get(type, id) {
        if (type === 'mrp-plan-plugin' && id === 'planner-default') {
          return {
            getDescriptor() {
              return { id: 'planner-default', type: 'mrp-plan-plugin', modelRoles: [], maxLLMCalls: 0 };
            },
            async buildPlan(input) {
              plannerCallCount += 1;
              if (input.phase === 'post-kb') {
                return {
                  plannerPluginId: 'planner-default',
                  kbPluginOrder: ['kb-fast'],
                  goalSolverOrder: ['gs-symbolic'],
                  decompose: true,
                  framePurpose: 'strategy-guidance',
                  notes: ['child-frame']
                };
              }
              return {
                plannerPluginId: 'planner-default',
                kbPluginOrder: ['kb-fast'],
                goalSolverOrder: ['gs-symbolic'],
                decompose: false,
                framePurpose: null,
                notes: []
              };
            },
            async recordOutcome() {}
          };
        }
        if (type === 'sd-plugin' && id === 'sd-symbolic') {
          return {
            getDescriptor() {
              return { id: 'sd-symbolic', type: 'sd-plugin', maxLLMCalls: 0, modelRoles: [] };
            },
            async detectSeeds() {
              return {
                status: 'success',
                intentCNL: '## Intent Group 1\nAct: explain\nIntent: Explain X.\nOutput: Y.',
                currentTurnContextCNL: '',
                metadata: { llmCalls: 0, model: null },
                error: null
              };
            }
          };
        }
        if (type === 'kb-plugin' && id === 'kb-fast') {
          return {
            getDescriptor() {
              return { id: 'kb-fast', type: 'kb-plugin', maxLLMCalls: 0, modelRoles: [] };
            },
            async retrieve() {
              return {
                status: 'success',
                sufficient: true,
                resolvedIntents: [{
                  intentRef: 1,
                  intentGroup: { groupNumber: 1, act: 'explain', intent: 'Explain X.', output: 'Y.' },
                  decomposed: { groupNumber: 1, act: 'explain', intent: 'Explain X.', outputType: 'Y.' },
                  strategyUnits: [],
                  currentTurnContextUnits: [],
                  sessionUnits: [],
                  kbUnits: [{
                    unitId: 'u1',
                    score: 1,
                    unit: { sourceId: 'src-1', role: 'Explanation', claim: 'X is caused by Y.' }
                  }],
                  retrievalTrace: { purpose: 'task-evidence' },
                  resolvedMarkdown: '## Resolved Intent Group 1'
                }],
                retrievalTrace: { purpose: 'task-evidence' },
                error: null
              };
            }
          };
        }
        if (type === 'gs-plugin' && id === 'gs-symbolic') {
          return {
            getDescriptor() {
              return { id: 'gs-symbolic', type: 'gs-plugin', maxLLMCalls: 0, modelRoles: [] };
            },
            async solve() {
              return {
                status: 'success',
                responseMarkdown: '# Child Answer',
                responseDocument: { sessionId: 'sess-test', groups: [] },
                metadata: { llmCalls: 0, model: null },
                error: null
              };
            }
          };
        }
        return null;
      }
    };
    const conversationHandler = {
      async prepareTurn() {
        return {
          session: {
            sessionId: 'sess-test',
            preferredModel: null,
            preferredPlannerPlugin: 'planner-default',
            preferredSeedDetectorPlugin: 'sd-symbolic',
            preferredKBPlugin: 'kb-fast',
            preferredGoalSolverPlugin: 'gs-symbolic',
            pendingTurnContextUnits: [],
            sessionContextUnits: [],
            workspace: { getIndex() { return null; } },
            messageLog: []
          },
          currentMessage: 'Explain X carefully.',
          historyForPrompt: [],
          systemPrompt: null,
          requestedModel: null,
          requestedPlannerPlugin: null,
          requestedSeedDetectorPlugin: 'sd-symbolic',
          requestedKBPlugin: 'kb-fast',
          requestedGoalSolverPlugin: 'gs-symbolic'
        };
      },
      async commitSuccessfulTurn() {}
    };
    const engine = new MRPEngine(
      {
        requestTimeoutMs: 1000,
        maxPluginsPerStage: 4,
        maxFrameDepth: 3,
        defaultPlannerPlugin: 'planner-default'
      },
      registry,
      conversationHandler,
      {
        parseIntentCNL() {
          return [{ groupNumber: 1, act: 'explain', intent: 'Explain X.', output: 'Y.' }];
        },
        parseContextCNL() {
          return [];
        }
      },
      {
        decompose(groups) {
          return groups.map(group => ({
            groupNumber: group.groupNumber,
            act: group.act,
            intent: group.intent,
            outputType: group.output
          }));
        },
        deriveContextProfile() {
          return { neededRoles: ['Explanation'], queryTerms: ['x'], actBoost: 'explain', maxResults: 10 };
        }
      },
      { collectOutputs() { return []; } },
      {},
      null
    );

    const result = await engine.processChatTurn({ messages: [{ role: 'user', content: 'Explain X carefully.' }] });
    assert.equal(result.responseMarkdown, '# Child Answer');
    assert.equal(result.executionTrace.frameTransitions, 1);
    assert.equal(result.executionTrace.framePurpose, 'strategy-guidance');
    assert.equal(plannerCallCount >= 2, true);
  });

  it('does not let child frames bypass the request-level LLM budget', async () => {
    let detectCalls = 0;
    const registry = {
      listByType(type) {
        return type === 'mrp-plan-plugin' ? [{ id: 'planner-default' }] : [];
      },
      get(type, id) {
        if (type === 'mrp-plan-plugin' && id === 'planner-default') {
          return {
            getDescriptor() {
              return { id: 'planner-default', type: 'mrp-plan-plugin', modelRoles: [], maxLLMCalls: 0 };
            },
            async buildPlan(input) {
              return {
                plannerPluginId: 'planner-default',
                kbPluginOrder: ['kb-fast'],
                goalSolverOrder: ['gs-symbolic'],
                decompose: input.phase === 'post-kb',
                framePurpose: input.phase === 'post-kb' ? 'strategy-guidance' : null,
                notes: []
              };
            },
            async recordOutcome() {}
          };
        }
        if (type === 'sd-plugin' && id === 'sd-symbolic') {
          return {
            getDescriptor() {
              return { id: 'sd-symbolic', type: 'sd-plugin', maxLLMCalls: 1, modelRoles: ['seed-fast'] };
            },
            async detectSeeds() {
              detectCalls += 1;
              return {
                status: 'success',
                intentCNL: '## Intent Group 1\nAct: explain\nIntent: Explain X.\nOutput: Y.',
                currentTurnContextCNL: '',
                metadata: { llmCalls: 1, model: 'seed-fast-model' },
                error: null
              };
            }
          };
        }
        if (type === 'kb-plugin' && id === 'kb-fast') {
          return {
            getDescriptor() {
              return { id: 'kb-fast', type: 'kb-plugin', maxLLMCalls: 0, modelRoles: [] };
            },
            async retrieve() {
              return {
                status: 'success',
                sufficient: true,
                resolvedIntents: [{
                  intentRef: 1,
                  intentGroup: { groupNumber: 1, act: 'explain', intent: 'Explain X.', output: 'Y.' },
                  decomposed: { groupNumber: 1, act: 'explain', intent: 'Explain X.', outputType: 'Y.' },
                  strategyUnits: [],
                  currentTurnContextUnits: [],
                  sessionUnits: [],
                  kbUnits: [{
                    unitId: 'u1',
                    score: 1,
                    unit: { sourceId: 'src-1', role: 'Explanation', claim: 'X is caused by Y.' }
                  }],
                  retrievalTrace: { purpose: 'task-evidence' },
                  resolvedMarkdown: '## Resolved Intent Group 1'
                }],
                retrievalTrace: { purpose: 'task-evidence' },
                error: null
              };
            }
          };
        }
        if (type === 'gs-plugin' && id === 'gs-symbolic') {
          return {
            getDescriptor() {
              return { id: 'gs-symbolic', type: 'gs-plugin', maxLLMCalls: 0, modelRoles: [] };
            },
            async solve() {
              return {
                status: 'success',
                responseMarkdown: '# Root Answer',
                responseDocument: { sessionId: 'sess-test', groups: [] },
                metadata: { llmCalls: 0, model: null },
                error: null
              };
            }
          };
        }
        return null;
      }
    };
    const conversationHandler = {
      async prepareTurn() {
        return {
          session: {
            sessionId: 'sess-test',
            preferredModel: null,
            preferredPlannerPlugin: 'planner-default',
            preferredSeedDetectorPlugin: 'sd-symbolic',
            preferredKBPlugin: 'kb-fast',
            preferredGoalSolverPlugin: 'gs-symbolic',
            pendingTurnContextUnits: [],
            sessionContextUnits: [],
            workspace: { getIndex() { return null; } },
            messageLog: []
          },
          currentMessage: 'Explain X carefully.',
          historyForPrompt: [],
          systemPrompt: null,
          requestedModel: null,
          requestedPlannerPlugin: null,
          requestedSeedDetectorPlugin: 'sd-symbolic',
          requestedKBPlugin: 'kb-fast',
          requestedGoalSolverPlugin: 'gs-symbolic'
        };
      },
      async commitSuccessfulTurn() {}
    };
    const engine = new MRPEngine(
      {
        requestTimeoutMs: 1000,
        maxLLMAttemptsPerRequest: 1,
        maxPluginsPerStage: 4,
        maxFrameDepth: 3,
        defaultPlannerPlugin: 'planner-default'
      },
      registry,
      conversationHandler,
      {
        parseIntentCNL() {
          return [{ groupNumber: 1, act: 'explain', intent: 'Explain X.', output: 'Y.' }];
        },
        parseContextCNL() {
          return [];
        }
      },
      {
        decompose(groups) {
          return groups.map(group => ({
            groupNumber: group.groupNumber,
            act: group.act,
            intent: group.intent,
            outputType: group.output
          }));
        },
        deriveContextProfile() {
          return { neededRoles: ['Explanation'], queryTerms: ['x'], actBoost: 'explain', maxResults: 10 };
        }
      },
      { collectOutputs() { return []; } },
      {},
      null
    );

    const result = await engine.processChatTurn({ messages: [{ role: 'user', content: 'Explain X carefully.' }] });
    assert.equal(result.responseMarkdown, '# Root Answer');
    assert.equal(result.llmCallCount, 1);
    assert.equal(detectCalls, 1);
  });

  it('ranks planner candidates through the planner stats store when no planner is explicitly pinned', async () => {
    const plannerCalls = [];
    const registry = {
      listByType(type) {
        return type === 'mrp-plan-plugin'
          ? [{ id: 'planner-default' }, { id: 'planner-depth' }]
          : [];
      },
      get(type, id) {
        if (type === 'mrp-plan-plugin') {
          return {
            getDescriptor() {
              return { id, type: 'mrp-plan-plugin', modelRoles: [], maxLLMCalls: 0 };
            },
            async buildPlan() {
              plannerCalls.push(id);
              return {
                plannerPluginId: id,
                seedDetectorOrder: ['sd-symbolic'],
                kbPluginOrder: ['kb-fast'],
                goalSolverOrder: ['gs-symbolic'],
                notes: []
              };
            },
            async recordOutcome() {}
          };
        }
        if (type === 'sd-plugin' && id === 'sd-symbolic') {
          return {
            getDescriptor() {
              return { id: 'sd-symbolic', type: 'sd-plugin', maxLLMCalls: 0, modelRoles: [] };
            },
            async detectSeeds() {
              return {
                status: 'success',
                intentCNL: '## Intent Group 1\nAct: explain\nIntent: Explain X.\nOutput: Y.',
                currentTurnContextCNL: '',
                metadata: { llmCalls: 0, model: null },
                error: null
              };
            }
          };
        }
        if (type === 'kb-plugin' && id === 'kb-fast') {
          return {
            getDescriptor() {
              return { id: 'kb-fast', type: 'kb-plugin', maxLLMCalls: 0, modelRoles: [] };
            },
            async retrieve() {
              return {
                status: 'success',
                sufficient: true,
                resolvedIntents: [{
                  intentRef: 1,
                  intentGroup: { groupNumber: 1, act: 'explain', intent: 'Explain X.', output: 'Y.' },
                  decomposed: { groupNumber: 1, act: 'explain', intent: 'Explain X.', outputType: 'Y.' },
                  currentTurnContextUnits: [],
                  sessionUnits: [],
                  kbUnits: [{
                    unitId: 'u1',
                    score: 1,
                    unit: { sourceId: 'src-1', role: 'Explanation', claim: 'X is caused by Y.' }
                  }],
                  retrievalTrace: {},
                  resolvedMarkdown: '## Resolved Intent Group 1'
                }],
                retrievalTrace: {},
                error: null
              };
            }
          };
        }
        if (type === 'gs-plugin' && id === 'gs-symbolic') {
          return {
            getDescriptor() {
              return { id: 'gs-symbolic', type: 'gs-plugin', maxLLMCalls: 0, modelRoles: [] };
            },
            async solve() {
              return {
                status: 'success',
                responseMarkdown: '# Answer',
                responseDocument: { sessionId: 'sess-test', groups: [] },
                metadata: { llmCalls: 0, model: null },
                error: null
              };
            }
          };
        }
        return null;
      }
    };
    const conversationHandler = {
      async prepareTurn() {
        return {
          session: {
            sessionId: 'sess-test',
            preferredModel: null,
            preferredPlannerPlugin: null,
            preferredSeedDetectorPlugin: 'sd-symbolic',
            preferredKBPlugin: 'kb-fast',
            preferredGoalSolverPlugin: 'gs-symbolic'
          },
          currentMessage: 'Explain X.',
          historyForPrompt: [],
          systemPrompt: null,
          requestedModel: null,
          requestedPlannerPlugin: null,
          requestedSeedDetectorPlugin: null,
          requestedKBPlugin: null,
          requestedGoalSolverPlugin: null
        };
      },
      commitSuccessfulTurn() {}
    };
    const plannerStatsStore = {
      rankPlanners(ids) {
        return ['planner-depth', ...ids.filter(id => id !== 'planner-depth')];
      }
    };
    const engine = new MRPEngine(
      {
        requestTimeoutMs: 1000,
        maxPluginsPerStage: 4,
        defaultPlannerPlugin: 'planner-default',
        plannerFallbackOrder: ['planner-default', 'planner-depth']
      },
      registry,
      conversationHandler,
      {
        parseIntentCNL() {
          return [{ groupNumber: 1, act: 'explain', intent: 'Explain X.', output: 'Y.' }];
        },
        parseContextCNL() {
          return [];
        }
      },
      {
        decompose(groups) {
          return groups.map(group => ({
            groupNumber: group.groupNumber,
            act: group.act,
            intent: group.intent,
            outputType: group.output
          }));
        },
        deriveContextProfile() {
          return { neededRoles: ['Explanation'], queryTerms: ['x'], actBoost: 'explain', maxResults: 10 };
        }
      },
      { collectOutputs() { return []; } },
      {},
      null,
      plannerStatsStore
    );

    const result = await engine.processChatTurn({ messages: [{ role: 'user', content: 'Explain X.' }] });
    assert.equal(plannerCalls[0], 'planner-depth');
    assert.equal(result.executionTrace.plannerPluginId, 'planner-depth');
    assert.equal(result.executionTrace.stages[0].plannerPluginId, 'planner-depth');
  });

  it('continues to the next goal solver when the first one returns no-context', async () => {
    const goalCalls = [];
    const registry = {
      listByType(type) {
        return type === 'mrp-plan-plugin' ? [{ id: 'planner-default' }] : [];
      },
      get(type, id) {
        if (type === 'mrp-plan-plugin' && id === 'planner-default') {
          return {
            getDescriptor() {
              return { id: 'planner-default', type: 'mrp-plan-plugin', modelRoles: [], maxLLMCalls: 0 };
            },
            async buildPlan() {
              return {
                plannerPluginId: 'planner-default',
                seedDetectorOrder: ['sd-symbolic'],
                kbPluginOrder: ['kb-fast'],
                goalSolverOrder: ['gs-symbolic', 'gs-llm-fast'],
                notes: []
              };
            },
            async recordOutcome() {}
          };
        }
        if (type === 'sd-plugin' && id === 'sd-symbolic') {
          return {
            getDescriptor() {
              return { id: 'sd-symbolic', type: 'sd-plugin', maxLLMCalls: 0, modelRoles: [] };
            },
            async detectSeeds() {
              return {
                status: 'success',
                intentCNL: '## Intent Group 1\nAct: explain\nIntent: Explain X.\nOutput: Y.',
                currentTurnContextCNL: '',
                metadata: { llmCalls: 0, model: null },
                error: null
              };
            }
          };
        }
        if (type === 'kb-plugin' && id === 'kb-fast') {
          return {
            getDescriptor() {
              return { id: 'kb-fast', type: 'kb-plugin', maxLLMCalls: 0, modelRoles: [] };
            },
            async retrieve() {
              return {
                status: 'success',
                sufficient: true,
                resolvedIntents: [{
                  intentRef: 1,
                  intentGroup: { groupNumber: 1, act: 'explain', intent: 'Explain X.', output: 'Y.' },
                  decomposed: { groupNumber: 1, act: 'explain', intent: 'Explain X.', outputType: 'Y.' },
                  currentTurnContextUnits: [],
                  sessionUnits: [],
                  kbUnits: [],
                  retrievalTrace: {},
                  resolvedMarkdown: '## Resolved Intent Group 1'
                }],
                retrievalTrace: {},
                error: null
              };
            }
          };
        }
        if (type === 'gs-plugin' && id === 'gs-symbolic') {
          return {
            getDescriptor() {
              return { id: 'gs-symbolic', type: 'gs-plugin', maxLLMCalls: 0, modelRoles: [] };
            },
            async solve() {
              goalCalls.push('gs-symbolic');
              return {
                status: 'no-context',
                responseMarkdown: '# No Context',
                responseDocument: { sessionId: 'sess-test', groups: [] },
                metadata: { llmCalls: 0, model: null },
                error: null
              };
            }
          };
        }
        if (type === 'gs-plugin' && id === 'gs-llm-fast') {
          return {
            getDescriptor() {
              return { id: 'gs-llm-fast', type: 'gs-plugin', maxLLMCalls: 0, modelRoles: ['goal-fast'] };
            },
            async solve() {
              goalCalls.push('gs-llm-fast');
              return {
                status: 'success',
                responseMarkdown: '# Final Answer',
                responseDocument: { sessionId: 'sess-test', groups: [] },
                metadata: { llmCalls: 0, model: 'goal-fast-model' },
                error: null
              };
            }
          };
        }
        return null;
      }
    };
    const conversationHandler = {
      async prepareTurn() {
        return {
          session: {
            sessionId: 'sess-test',
            preferredModel: null,
            preferredPlannerPlugin: 'planner-default',
            preferredSeedDetectorPlugin: 'sd-symbolic',
            preferredKBPlugin: 'kb-fast',
            preferredGoalSolverPlugin: 'gs-symbolic'
          },
          currentMessage: 'Explain X.',
          historyForPrompt: [],
          systemPrompt: null,
          requestedModel: null,
          requestedPlannerPlugin: null,
          requestedSeedDetectorPlugin: null,
          requestedKBPlugin: null,
          requestedGoalSolverPlugin: null
        };
      },
      commitSuccessfulTurn() {}
    };
    const engine = new MRPEngine(
      {
        requestTimeoutMs: 1000,
        maxPluginsPerStage: 4,
        defaultPlannerPlugin: 'planner-default'
      },
      registry,
      conversationHandler,
      {
        parseIntentCNL() {
          return [{ groupNumber: 1, act: 'explain', intent: 'Explain X.', output: 'Y.' }];
        },
        parseContextCNL() {
          return [];
        }
      },
      {
        decompose(groups) {
          return groups.map(group => ({
            groupNumber: group.groupNumber,
            act: group.act,
            intent: group.intent,
            outputType: group.output
          }));
        },
        deriveContextProfile() {
          return { neededRoles: [], queryTerms: ['x'], actBoost: 'explain', maxResults: 10 };
        }
      },
      { collectOutputs() { return []; } },
      {},
      null
    );

    const result = await engine.processChatTurn({ messages: [{ role: 'user', content: 'Explain X.' }] });
    assert.deepStrictEqual(goalCalls, ['gs-symbolic', 'gs-llm-fast']);
    assert.equal(result.responseMarkdown, '# Final Answer');
    assert.equal(result.executionTrace.finalAnswerStatus, 'answered');
  });

  it('falls back to a heavier planner when the first planner yields only no-context after insufficient retrieval', async () => {
    let committedPlannerId = null;
    const registry = {
      listByType(type) {
        return type === 'mrp-plan-plugin'
          ? [{ id: 'planner-default' }, { id: 'planner-depth' }]
          : [];
      },
      get(type, id) {
        if (type === 'mrp-plan-plugin' && id === 'planner-default') {
          return {
            getDescriptor() {
              return { id: 'planner-default', type: 'mrp-plan-plugin', modelRoles: [], maxLLMCalls: 0 };
            },
            async buildPlan() {
              return {
                plannerPluginId: 'planner-default',
                seedDetectorOrder: ['sd-symbolic'],
                kbPluginOrder: ['kb-fast'],
                goalSolverOrder: ['gs-symbolic'],
                notes: []
              };
            },
            async recordOutcome() {}
          };
        }
        if (type === 'mrp-plan-plugin' && id === 'planner-depth') {
          return {
            getDescriptor() {
              return { id: 'planner-depth', type: 'mrp-plan-plugin', modelRoles: [], maxLLMCalls: 0 };
            },
            async buildPlan() {
              return {
                plannerPluginId: 'planner-depth',
                seedDetectorOrder: ['sd-symbolic'],
                kbPluginOrder: ['kb-thinkingdb'],
                goalSolverOrder: ['gs-llm-fast'],
                notes: []
              };
            },
            async recordOutcome() {}
          };
        }
        if (type === 'sd-plugin' && id === 'sd-symbolic') {
          return {
            getDescriptor() {
              return { id: 'sd-symbolic', type: 'sd-plugin', maxLLMCalls: 0, modelRoles: [] };
            },
            async detectSeeds() {
              return {
                status: 'success',
                intentCNL: '## Intent Group 1\nAct: explain\nIntent: Explain X.\nOutput: Y.',
                currentTurnContextCNL: '',
                metadata: { llmCalls: 0, model: null },
                error: null
              };
            }
          };
        }
        if (type === 'kb-plugin' && id === 'kb-fast') {
          return {
            getDescriptor() {
              return { id: 'kb-fast', type: 'kb-plugin', maxLLMCalls: 0, modelRoles: [] };
            },
            async retrieve() {
              return {
                status: 'insufficient',
                sufficient: false,
                resolvedIntents: [{
                  intentRef: 1,
                  intentGroup: { groupNumber: 1, act: 'explain', intent: 'Explain X.', output: 'Y.' },
                  decomposed: { groupNumber: 1, act: 'explain', intent: 'Explain X.', outputType: 'Y.' },
                  currentTurnContextUnits: [],
                  sessionUnits: [],
                  kbUnits: [],
                  retrievalTrace: {},
                  resolvedMarkdown: '## Resolved Intent Group 1'
                }],
                retrievalTrace: {},
                error: null
              };
            }
          };
        }
        if (type === 'kb-plugin' && id === 'kb-thinkingdb') {
          return {
            getDescriptor() {
              return { id: 'kb-thinkingdb', type: 'kb-plugin', maxLLMCalls: 0, modelRoles: [] };
            },
            async retrieve() {
              return {
                status: 'success',
                sufficient: true,
                resolvedIntents: [{
                  intentRef: 1,
                  intentGroup: { groupNumber: 1, act: 'explain', intent: 'Explain X.', output: 'Y.' },
                  decomposed: { groupNumber: 1, act: 'explain', intent: 'Explain X.', outputType: 'Y.' },
                  currentTurnContextUnits: [],
                  sessionUnits: [],
                  kbUnits: [{
                    unitId: 'u1',
                    score: 1,
                    unit: { sourceId: 'src-1', role: 'Explanation', claim: 'X is caused by Y.' }
                  }],
                  retrievalTrace: {},
                  resolvedMarkdown: '## Resolved Intent Group 1'
                }],
                retrievalTrace: {},
                error: null
              };
            }
          };
        }
        if (type === 'gs-plugin' && id === 'gs-symbolic') {
          return {
            getDescriptor() {
              return { id: 'gs-symbolic', type: 'gs-plugin', maxLLMCalls: 0, modelRoles: [] };
            },
            async solve() {
              return {
                status: 'no-context',
                responseMarkdown: '# No Context',
                responseDocument: { sessionId: 'sess-test', groups: [] },
                metadata: { llmCalls: 0, model: null },
                error: null
              };
            }
          };
        }
        if (type === 'gs-plugin' && id === 'gs-llm-fast') {
          return {
            getDescriptor() {
              return { id: 'gs-llm-fast', type: 'gs-plugin', maxLLMCalls: 0, modelRoles: ['goal-fast'] };
            },
            async solve() {
              return {
                status: 'success',
                responseMarkdown: '# Deep Answer',
                responseDocument: { sessionId: 'sess-test', groups: [] },
                metadata: { llmCalls: 0, model: 'goal-fast-model' },
                error: null
              };
            }
          };
        }
        return null;
      }
    };

    const conversationHandler = {
      async prepareTurn() {
        return {
          session: {
            sessionId: 'sess-test',
            preferredModel: null,
            preferredPlannerPlugin: 'planner-default',
            preferredSeedDetectorPlugin: 'sd-symbolic',
            preferredKBPlugin: 'kb-fast',
            preferredGoalSolverPlugin: 'gs-symbolic'
          },
          currentMessage: 'Explain X carefully.',
          historyForPrompt: [],
          systemPrompt: null,
          requestedModel: null,
          requestedPlannerPlugin: null,
          requestedSeedDetectorPlugin: null,
          requestedKBPlugin: null,
          requestedGoalSolverPlugin: null
        };
      },
      commitSuccessfulTurn(_session, _message, _markdown, _units, _model, plannerId) {
        committedPlannerId = plannerId;
      }
    };

    const engine = new MRPEngine(
      {
        requestTimeoutMs: 1000,
        maxPluginsPerStage: 4,
        defaultPlannerPlugin: 'planner-default',
        plannerFallbackOrder: ['planner-default', 'planner-depth']
      },
      registry,
      conversationHandler,
      {
        parseIntentCNL() {
          return [{ groupNumber: 1, act: 'explain', intent: 'Explain X.', output: 'Y.' }];
        },
        parseContextCNL() {
          return [];
        }
      },
      {
        decompose(groups) {
          return groups.map(group => ({
            groupNumber: group.groupNumber,
            act: group.act,
            intent: group.intent,
            outputType: group.output
          }));
        },
        deriveContextProfile() {
          return { neededRoles: ['Explanation'], queryTerms: ['x'], actBoost: 'explain', maxResults: 10 };
        }
      },
      { collectOutputs() { return []; } },
      {},
      null
    );

    const result = await engine.processChatTurn({ messages: [{ role: 'user', content: 'Explain X carefully.' }] });
    assert.equal(committedPlannerId, 'planner-depth');
    assert.deepStrictEqual(result.executionTrace.plannerAttempts, ['planner-default', 'planner-depth']);
    assert.equal(result.executionTrace.plannerPluginId, 'planner-depth');
    assert.equal(result.executionTrace.finalAnswerStatus, 'answered');
  });
});
