import { MRPError } from '../lib/errors.mjs';

const SUPPORTED_PLUGIN_TYPES = new Set([
  'sd-plugin',
  'kb-plugin',
  'gs-plugin',
  'mrp-plan-plugin'
]);

export class TypedPluginRegistry {
  constructor() {
    this._plugins = new Map();
  }

  _key(type, id) {
    return `${type}:${id}`;
  }

  register(plugin) {
    const descriptor = plugin.getDescriptor();
    if (!descriptor?.type || !descriptor?.id) {
      throw new MRPError(
        'PLUGIN_REGISTRY_INVALID_DESCRIPTOR',
        'plugins',
        'Plugin descriptor must include type and id'
      );
    }
    if (!SUPPORTED_PLUGIN_TYPES.has(descriptor.type)) {
      throw new MRPError(
        'PLUGIN_REGISTRY_UNSUPPORTED_TYPE',
        'plugins',
        `Unsupported plugin type '${descriptor.type}'`
      );
    }
    this._plugins.set(this._key(descriptor.type, descriptor.id), plugin);
  }

  get(type, id) {
    return this._plugins.get(this._key(type, id)) || null;
  }

  list(type = null) {
    const plugins = [...this._plugins.values()];
    return plugins
      .filter(plugin => !type || plugin.getDescriptor().type === type)
      .map(plugin => ({ ...plugin.getDescriptor() }))
      .sort((a, b) => a.type.localeCompare(b.type) || a.id.localeCompare(b.id));
  }

  listByType(type) {
    return this.list(type);
  }

  resolve(type, requestedId, sessionId, defaultId) {
    const id = requestedId || sessionId || defaultId;
    const plugin = this.get(type, id);
    if (!plugin) {
      throw new MRPError(
        'PLUGIN_REGISTRY_NOT_FOUND',
        'plugins',
        `Plugin '${id}' of type '${type}' not available`
      );
    }
    return plugin;
  }
}
