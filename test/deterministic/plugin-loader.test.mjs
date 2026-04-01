import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { loadConfig } from '../../src/core/platform/config.mjs';
import { StrategyRegistry } from '../../src/mrp-vm-sdk/strategies/registry.mjs';
import { SymbolicOnlyStrategy } from '../../src/mrp-vm-sdk/strategies/symbolic-only.mjs';
import { TypedPluginRegistry } from '../../src/plugins/runtime/typed-registry.mjs';
import { PlannerStatsStore } from '../../src/plugins/runtime/planner-stats.mjs';
import { NLNormalizer } from '../../src/core/normalizer/nl-normalizer.mjs';
import { AnswerSynthesizer } from '../../src/mrp-vm-sdk/synthesis/answer-synthesizer.mjs';
import { ContextMatcher } from '../../src/mrp-vm-sdk/retrieval/context-matcher.mjs';
import { RetrievalStrategyRegistry, BM25LexicalStrategy } from '../../src/mrp-vm-sdk/retrieval/strategies/registry.mjs';
import { HDCVSAStrategy } from '../../src/mrp-vm-sdk/retrieval/strategies/hdc-vsa.mjs';
import { ThinkingDBSymbolicStrategy } from '../../src/mrp-vm-sdk/retrieval/strategies/thinkingdb.mjs';
import { loadBuiltInPlugins } from '../../src/plugins/runtime/builtin-loader.mjs';

describe('Built-in plugin packaging', () => {
  const pluginsConfig = loadConfig('plugins');

  it('declares built-in plugin modules in config', () => {
    assert.ok(Array.isArray(pluginsConfig.builtins));
    assert.ok(pluginsConfig.builtins.length >= 10);
  });

  it('ships plugin.json and plugin.kus.md for every declared built-in plugin', () => {
    for (const entry of pluginsConfig.builtins) {
      const pluginDir = resolve(process.cwd(), entry.module, '..');
      const manifestPath = resolve(pluginDir, 'plugin.json');
      const kuPath = resolve(pluginDir, 'plugin.kus.md');
      assert.ok(existsSync(manifestPath), `Missing ${manifestPath}`);
      assert.ok(existsSync(kuPath), `Missing ${kuPath}`);

      const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
      assert.ok(manifest.id, `Manifest ${manifestPath} must include id`);
      assert.ok(manifest.type, `Manifest ${manifestPath} must include type`);
      assert.equal(manifest.knowledgeUnitsFile, 'plugin.kus.md');
      assert.match(readFileSync(kuPath, 'utf-8'), /## Context Unit /);
    }
  });
});

describe('Built-in plugin loader', () => {
  it('loads plugin instances from config-driven module declarations', async () => {
    const strategiesConfig = loadConfig('strategies');
    const pluginsConfig = loadConfig('plugins');
    const retrievalConfig = loadConfig('retrieval');
    const retrievalStrategiesConfig = loadConfig('retrieval-strategies');
    const thinkingdbConfig = loadConfig('thinkingdb');
    const engineConfig = loadConfig('engine');

    const strategyRegistry = new StrategyRegistry();
    if (strategiesConfig.enabledModes.includes('symbolic-only')) {
      strategyRegistry.register(new SymbolicOnlyStrategy());
    }

    const normalizer = new NLNormalizer(strategyRegistry);
    const retrievalStrategyRegistry = new RetrievalStrategyRegistry();
    retrievalStrategyRegistry.register(new BM25LexicalStrategy(retrievalConfig));
    retrievalStrategyRegistry.register(new HDCVSAStrategy());
    retrievalStrategyRegistry.register(new ThinkingDBSymbolicStrategy(thinkingdbConfig));
    retrievalStrategyRegistry.setProfiles(retrievalStrategiesConfig.profiles);

    const typedPluginRegistry = new TypedPluginRegistry();
    const plannerStats = new PlannerStatsStore(pluginsConfig);
    const retrieval = new ContextMatcher(retrievalStrategyRegistry, retrievalConfig);
    const synthesizer = new AnswerSynthesizer(strategyRegistry, engineConfig);

    await loadBuiltInPlugins(typedPluginRegistry, pluginsConfig, {
      strategyRegistry,
      normalizer,
      retrieval,
      synthesizer,
      plannerStats
    });

    assert.ok(typedPluginRegistry.get('sd-plugin', 'sd-symbolic'));
    assert.ok(typedPluginRegistry.get('kb-plugin', 'kb-fast'));
    assert.ok(typedPluginRegistry.get('kb-plugin', 'kb-balanced'));
    assert.ok(typedPluginRegistry.get('kb-plugin', 'kb-thinkingdb'));
    assert.ok(typedPluginRegistry.get('gs-plugin', 'gs-symbolic'));
    assert.ok(typedPluginRegistry.get('mrp-plan-plugin', 'planner-default'));
    assert.ok(typedPluginRegistry.get('mrp-plan-plugin', 'planner-depth'));
  });
});
