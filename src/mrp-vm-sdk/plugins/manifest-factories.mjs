import {
  StrategySeedDetectorPlugin,
  RetrievalKBPlugin,
  StrategyGoalSolverPlugin,
  LLMValidationPlugin
} from './builtin-adapters.mjs';
import { DefaultPlannerPlugin } from '../../plugins/runtime/default-planner-plugin.mjs';

function plannerOptions(manifest = {}) {
  return {
    id: manifest.id,
    name: manifest.name,
    description: manifest.description,
    plannerStyle: manifest.plannerStyle,
    timeoutMs: manifest.timeoutMs
  };
}

function adapterOptions(manifest = {}) {
  return {
    description: manifest.description,
    costClass: manifest.costClass,
    modelRole: manifest.modelRole,
    ingestModelRole: manifest.ingestModelRole,
    plannerHints: manifest.plannerHints || null
  };
}

export function buildStrategySeedDetector(manifest, { strategyRegistry, normalizer }) {
  const strategy = strategyRegistry?.get?.(manifest.strategyId);
  if (!strategy) return null;
  return new StrategySeedDetectorPlugin(manifest.id, strategy, normalizer, adapterOptions(manifest));
}

export function buildRetrievalKBPlugin(manifest, { retrieval }) {
  return new RetrievalKBPlugin(manifest.id, retrieval, manifest.profileId, adapterOptions(manifest));
}

export function buildStrategyGoalSolverPlugin(manifest, { strategyRegistry, synthesizer }) {
  const strategy = strategyRegistry?.get?.(manifest.strategyId);
  if (!strategy) return null;
  return new StrategyGoalSolverPlugin(manifest.id, strategy, synthesizer, adapterOptions(manifest));
}

export function buildPlannerPlugin(manifest, { typedPluginRegistry, plannerStats }) {
  return new DefaultPlannerPlugin(typedPluginRegistry, plannerStats, plannerOptions(manifest));
}

export function buildValidationPlugin(manifest, { llmBridge }) {
  if (!llmBridge) return null;
  return new LLMValidationPlugin(manifest.id, llmBridge, adapterOptions(manifest));
}
