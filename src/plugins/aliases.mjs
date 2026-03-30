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
