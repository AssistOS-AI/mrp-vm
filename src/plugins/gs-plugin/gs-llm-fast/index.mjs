import { loadLocalPluginManifest } from '../../runtime/manifest-loader.mjs';
import { buildStrategyGoalSolverPlugin } from '../../../mrp-vm-sdk/plugins/manifest-factories.mjs';

export async function createPlugin(dependencies) {
  const manifest = loadLocalPluginManifest(import.meta.url);
  return buildStrategyGoalSolverPlugin(manifest, dependencies);
}

