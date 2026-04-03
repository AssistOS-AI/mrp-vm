import { LLMAssistedMode } from '../modes/llm-assisted-mode.mjs';
import { RuleBasedSOPMode } from '../modes/rule-based-sop-mode.mjs';

class ContextNormalizerAdapter {
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

  async normalizePersistentContext(input) {
    return this.implementation.normalizePersistentContext(input);
  }
}

export class RuleBasedSOPContextNormalizer extends ContextNormalizerAdapter {
  constructor(implementation = new RuleBasedSOPMode()) {
    super(implementation);
  }
}

export class LLMAssistedContextNormalizer extends ContextNormalizerAdapter {
  constructor(llmBridge, implementation = new LLMAssistedMode(llmBridge)) {
    super(implementation);
  }
}
