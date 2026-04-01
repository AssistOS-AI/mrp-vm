import { loadLocalPluginManifest } from '../../runtime/manifest-loader.mjs';
import { buildPlannerPlugin } from '../../../mrp-vm-sdk/plugins/manifest-factories.mjs';

export async function createPlugin(dependencies) {
  const manifest = loadLocalPluginManifest(import.meta.url);
  return buildPlannerPlugin(manifest, dependencies);
}

