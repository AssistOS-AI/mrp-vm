import { LLMAssistedMode } from '../modes/llm-assisted-mode.mjs';
import { RuleBasedSOPMode } from '../modes/rule-based-sop-mode.mjs';

class ResponseRendererAdapter {
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

  async synthesizeResponse(input) {
    return this.implementation.synthesizeResponse(input);
  }
}

export class RuleBasedSOPResponseRenderer extends ResponseRendererAdapter {
  constructor(implementation = new RuleBasedSOPMode()) {
    super(implementation);
  }
}

export class LLMAssistedResponseRenderer extends ResponseRendererAdapter {
  constructor(llmBridge, implementation = new LLMAssistedMode(llmBridge)) {
    super(implementation);
  }
}
