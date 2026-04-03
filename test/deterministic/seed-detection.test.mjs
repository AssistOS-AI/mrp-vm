import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { NLNormalizer } from '../../src/core/normalizer/nl-normalizer.mjs';
import { CNLParser } from '../../src/core/parser/cnl-validator-parser.mjs';
import { StrategyRegistry } from '../../src/mrp-vm-sdk/strategies/registry.mjs';
import { StrategySeedDetectorPlugin } from '../../src/mrp-vm-sdk/plugins/builtin-adapters.mjs';
import { LLMAssistedStrategy } from '../../src/mrp-vm-sdk/strategies/llm-assisted.mjs';
import { SymbolicOnlyStrategy } from '../../src/mrp-vm-sdk/strategies/symbolic-only.mjs';

describe('seed detection bundle flow', () => {
  it('uses a single detectSeedBundle call for sd-plugin.detectSeeds', async () => {
    let detectCalls = 0;
    const strategy = {
      usesLLM() { return true; },
      async detectSeedBundle() {
        detectCalls += 1;
        return {
          intentCNL: '## Intent Group 1\nAct: explain\nIntent: Explain Aurora Station.\nOutput: Structured response.',
          currentTurnContextCNL: '## Context Unit session::turn::unit-000\nSourceId: session\nChunkId: session::turn\nRole: Explanation\nTopic: Aurora Station\nClaim: Aurora Station provides thermal shielding.\nSubject: Aurora Station\nRelation: provides\nObject: thermal shielding\nConfidence: 0.9\nUtilityActs: explain'
        };
      }
    };
    const registry = new StrategyRegistry();
    const normalizer = new NLNormalizer(registry);
    const plugin = new StrategySeedDetectorPlugin('sd-test', strategy, normalizer, {
      modelRole: 'seed-fast'
    });

    const result = await plugin.detectSeeds({
      currentMessage: 'Explain Aurora Station. Aurora Station provides thermal shielding.',
      historyForPrompt: [],
      systemPrompt: null,
      requestedModel: null,
      sessionModel: null
    }, {
      modelSettings: {
        resolveModel() {
          return 'test-fast';
        }
      }
    });

    assert.equal(result.status, 'success');
    assert.equal(detectCalls, 1);
    assert.equal(result.metadata.llmCalls, 1);
    assert.match(result.intentCNL, /## Intent Group 1/);
    assert.match(result.currentTurnContextCNL, /## Context Unit session::turn::unit-000/);
  });

  it('llm-assisted strategy parses a combined seed bundle from one bridge call', async () => {
    let bridgeCalls = 0;
    const strategy = new LLMAssistedStrategy({
      async callWithRetry(_systemPrompt, _userMessage, opts = {}) {
        bridgeCalls += 1;
        assert.equal(opts.operation, 'detect-seeds');
        return [
          '# Intent CNL',
          '## Intent Group 1',
          'Act: verify',
          'Intent: Verify the thermal shielding claim.',
          'Output: Structured response.',
          '',
          '# Session Context CNL',
          '## Context Unit session::turn::unit-000',
          'SourceId: session',
          'ChunkId: session::turn',
          'Role: Explanation',
          'Topic: Aurora Station',
          'Claim: Aurora Station provides thermal shielding.',
          'Subject: Aurora Station',
          'Relation: provides',
          'Object: thermal shielding',
          'Confidence: 0.9',
          'UtilityActs: verify, explain'
        ].join('\n');
      }
    });

    const bundle = await strategy.detectSeedBundle({
      rawNL: 'Verify Aurora Station. Aurora Station provides thermal shielding.',
      history: [],
      systemPrompt: null,
      requestedModel: 'test-fast'
    });

    assert.equal(bridgeCalls, 1);
    assert.match(bundle.intentCNL, /Act: verify/);
    assert.match(bundle.currentTurnContextCNL, /Relation: provides/);
  });

  it('symbolic-only strategy splits short multi-question prompts into separate intent groups', async () => {
    const strategy = new SymbolicOnlyStrategy();
    const parser = new CNLParser();
    const bundle = await strategy.detectSeedBundle({
      rawNL: [
        'Q1: Is Kaelen safe? Answer Yes or No.',
        'Q2: Explain why Vex failed.',
        'Q3: Name the operator. One word only.'
      ].join('\n')
    });

    const groups = parser.parseIntentCNL(bundle.intentCNL);
    assert.equal(groups.length, 3);
    assert.match(groups[0].intent, /Is Kaelen safe/i);
    assert.match(groups[0].output, /yes or no/i);
    assert.match(groups[1].intent, /Explain why Vex failed\./);
    assert.equal(groups[1].output, 'structured response');
    assert.match(groups[2].intent, /Name the operator\./);
    assert.match(groups[2].output, /one word/i);
  });
});
