import {
  SeedDetectorHelperPlugin,
  RetrievalKBPlugin,
  GoalSolverRendererPlugin,
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

export function buildSeedDetectorHelperPlugin(manifest, {
  seedBundleGenerators,
  contextNormalizers,
  modeRegistry,
  strategyRegistry,
  normalizer
}) {
  const seedBundleGeneratorId = manifest.seedBundleGeneratorId || manifest.modeId || manifest.strategyId;
  const contextNormalizerId = manifest.contextNormalizerId || manifest.modeId || manifest.strategyId;
  const seedBundleGenerator =
    seedBundleGenerators?.get?.(seedBundleGeneratorId) ||
    modeRegistry?.get?.(seedBundleGeneratorId) ||
    strategyRegistry?.get?.(seedBundleGeneratorId);
  const contextNormalizer =
    contextNormalizers?.get?.(contextNormalizerId) ||
    modeRegistry?.get?.(contextNormalizerId) ||
    strategyRegistry?.get?.(contextNormalizerId);
  if (!seedBundleGenerator || !contextNormalizer) return null;
  return new SeedDetectorHelperPlugin(
    manifest.id,
    seedBundleGenerator,
    contextNormalizer,
    normalizer,
    adapterOptions(manifest)
  );
}

export function buildRetrievalKBPlugin(manifest, { retrieval }) {
  return new RetrievalKBPlugin(manifest.id, retrieval, manifest.profileId, adapterOptions(manifest));
}

export function buildGoalSolverRendererPlugin(manifest, {
  responseRenderers,
  modeRegistry,
  strategyRegistry,
  synthesizer
}) {
  const responseRendererId = manifest.responseRendererId || manifest.modeId || manifest.strategyId;
  const responseRenderer =
    responseRenderers?.get?.(responseRendererId) ||
    modeRegistry?.get?.(responseRendererId) ||
    strategyRegistry?.get?.(responseRendererId);
  if (!responseRenderer) return null;
  return new GoalSolverRendererPlugin(manifest.id, responseRenderer, synthesizer, adapterOptions(manifest));
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

export { buildSeedDetectorHelperPlugin as buildModeSeedDetector };
export { buildGoalSolverRendererPlugin as buildModeGoalSolverPlugin };
export { buildSeedDetectorHelperPlugin as buildStrategySeedDetector };
export { buildGoalSolverRendererPlugin as buildStrategyGoalSolverPlugin };
