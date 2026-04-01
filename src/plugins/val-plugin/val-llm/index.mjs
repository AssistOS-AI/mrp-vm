import { loadLocalPluginManifest } from '../../runtime/manifest-loader.mjs';
import { buildValidationPlugin } from '../../../mrp-vm-sdk/plugins/manifest-factories.mjs';

export async function createPlugin(dependencies) {
  const manifest = loadLocalPluginManifest(import.meta.url);
  return buildValidationPlugin(manifest, dependencies);
}

