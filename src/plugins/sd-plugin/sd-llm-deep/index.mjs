import { loadLocalPluginManifest } from '../../runtime/manifest-loader.mjs';
import { buildSeedDetectorHelperPlugin } from '../../../mrp-vm-sdk/plugins/manifest-factories.mjs';

export async function createPlugin(dependencies) {
  const manifest = loadLocalPluginManifest(import.meta.url);
  return buildSeedDetectorHelperPlugin(manifest, dependencies);
}
