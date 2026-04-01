import { loadLocalPluginManifest } from '../../runtime/manifest-loader.mjs';
import { buildRetrievalKBPlugin } from '../../../mrp-vm-sdk/plugins/manifest-factories.mjs';

export async function createPlugin(dependencies) {
  const manifest = loadLocalPluginManifest(import.meta.url);
  return buildRetrievalKBPlugin(manifest, dependencies);
}

