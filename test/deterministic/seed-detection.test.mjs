import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { NLNormalizer } from '../../src/normalizer/nl-normalizer.mjs';
import { StrategyRegistry } from '../../src/strategies/registry.mjs';
import { StrategySeedDetectorPlugin } from '../../src/plugins/builtin-plugins.mjs';
import { LLMAssistedStrategy } from '../../src/strategies/llm-assisted.mjs';

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
});
