export const LEGACY_PROCESSING_MODE_ALIASES = {
  'symbolic-only': {
    seedDetectorPlugin: 'sd-symbolic',
    goalSolverPlugin: 'gs-symbolic'
  },
  'llm-assisted': {
    seedDetectorPlugin: 'sd-llm-fast',
    goalSolverPlugin: 'gs-llm-fast'
  }
};

export const LEGACY_RETRIEVAL_PROFILE_ALIASES = {
  fast: 'kb-fast',
  balanced: 'kb-balanced',
  thinkingdb: 'kb-thinkingdb'
};

export function mapLegacyProcessingMode(mode) {
  return LEGACY_PROCESSING_MODE_ALIASES[mode] || {};
}

export function mapLegacyRetrievalProfile(profile) {
  return LEGACY_RETRIEVAL_PROFILE_ALIASES[profile] || null;
}

export function deriveLegacyProcessingMode(seedDetectorPlugin, goalSolverPlugin) {
  for (const [mode, mapping] of Object.entries(LEGACY_PROCESSING_MODE_ALIASES)) {
    if (mapping.seedDetectorPlugin === seedDetectorPlugin &&
        mapping.goalSolverPlugin === goalSolverPlugin) {
      return mode;
    }
  }
  return null;
}

export function deriveLegacyRetrievalProfile(kbPlugin) {
  for (const [profile, pluginId] of Object.entries(LEGACY_RETRIEVAL_PROFILE_ALIASES)) {
    if (pluginId === kbPlugin) return profile;
  }
  return null;
}
