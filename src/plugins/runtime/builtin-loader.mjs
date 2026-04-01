import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { logger } from '../../core/platform/logger.mjs';

const MOD = 'plugin-loader';

export async function loadBuiltInPlugins(typedPluginRegistry, pluginsConfig, dependencies = {}) {
  const builtins = pluginsConfig?.builtins || [];
  const loaded = [];

  for (const entry of builtins) {
    if (!entry?.module || entry.enabled === false) continue;
    const moduleHref = pathToFileURL(resolve(process.cwd(), entry.module)).href;
    const mod = await import(moduleHref);
    const factory = mod.createPlugin || mod.default;
    if (typeof factory !== 'function') {
      throw new Error(`Built-in plugin module '${entry.module}' does not export createPlugin(...)`);
    }
    const plugin = await factory({
      ...dependencies,
      entry,
      typedPluginRegistry,
      pluginsConfig
    });
    if (!plugin) {
      logger.warn(MOD, `Skipping built-in plugin '${entry.module}' because its factory returned null`);
      continue;
    }
    typedPluginRegistry.register(plugin);
    loaded.push(plugin.getDescriptor?.().id || entry.module);
  }

  logger.info(MOD, 'Built-in plugins loaded', { loadedCount: loaded.length, loaded });
  return loaded;
}
