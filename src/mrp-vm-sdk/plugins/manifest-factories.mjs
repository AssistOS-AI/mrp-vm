import {
  ModeSeedDetectorPlugin,
  RetrievalKBPlugin,
  ModeGoalSolverPlugin,
  LLMValidationPlugin
} from './builtin-adapters.mjs';
import { ToolBackedGoalSolverPlugin } from './tool-backed-goal-solver.mjs';
import { DefaultPlannerPlugin } from '../../plugins/runtime/default-planner-plugin.mjs';
import { loadLocalPluginPrompts } from '../../plugins/runtime/manifest-loader.mjs';

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
    plannerHints: manifest.plannerHints || null,
    prompts: loadLocalPluginPrompts(manifest)
  };
}

export function buildModeSeedDetector(manifest, { modeRegistry, strategyRegistry, normalizer }) {
  const modeId = manifest.modeId || manifest.strategyId;
  const mode = modeRegistry?.get?.(modeId) || strategyRegistry?.get?.(modeId);
  if (!mode) return null;
  return new ModeSeedDetectorPlugin(manifest.id, mode, normalizer, adapterOptions(manifest));
}

export function buildRetrievalKBPlugin(manifest, { retrieval }) {
  return new RetrievalKBPlugin(manifest.id, retrieval, manifest.profileId, adapterOptions(manifest));
}

export function buildModeGoalSolverPlugin(manifest, { modeRegistry, strategyRegistry, synthesizer }) {
  const modeId = manifest.modeId || manifest.strategyId;
  const mode = modeRegistry?.get?.(modeId) || strategyRegistry?.get?.(modeId);
  if (!mode) return null;
  return new ModeGoalSolverPlugin(manifest.id, mode, synthesizer, adapterOptions(manifest));
}

export function buildToolBackedGoalSolverPlugin(manifest, { llmBridge }) {
  if (!llmBridge) return null;
  return new ToolBackedGoalSolverPlugin(manifest, llmBridge, adapterOptions(manifest));
}

export function buildPlannerPlugin(manifest, { typedPluginRegistry, plannerStats }) {
  return new DefaultPlannerPlugin(typedPluginRegistry, plannerStats, plannerOptions(manifest));
}

export function buildValidationPlugin(manifest, { llmBridge }) {
  if (!llmBridge) return null;
  return new LLMValidationPlugin(manifest.id, llmBridge, adapterOptions(manifest));
}

export { buildModeSeedDetector as buildStrategySeedDetector };
export { buildModeGoalSolverPlugin as buildStrategyGoalSolverPlugin };
