import { LLMAssistedMode } from '../modes/llm-assisted-mode.mjs';
import { RuleBasedSOPMode } from '../modes/rule-based-sop-mode.mjs';

class SeedBundleGeneratorAdapter {
  constructor(implementation) {
    this.implementation = implementation;
  }

  getId() {
    return this.implementation.getId();
  }

  usesLLM() {
    return this.implementation.usesLLM();
  }

  supportsModelOverride() {
    return this.implementation.supportsModelOverride();
  }

  async detectSeedBundle(input) {
    return this.implementation.detectSeedBundle(input);
  }

  async normalizeIntent(input) {
    return this.implementation.normalizeIntent(input);
  }

  async extractSessionContext(input) {
    return this.implementation.extractSessionContext(input);
  }
}

export class RuleBasedSOPSeedBundleGenerator extends SeedBundleGeneratorAdapter {
  constructor(implementation = new RuleBasedSOPMode()) {
    super(implementation);
  }
}

export class LLMAssistedSeedBundleGenerator extends SeedBundleGeneratorAdapter {
  constructor(llmBridge, implementation = new LLMAssistedMode(llmBridge)) {
    super(implementation);
  }
}
