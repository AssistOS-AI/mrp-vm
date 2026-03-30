# DS015 — LLMAgent Integration (AchillesAgentLib)

## Purpose
Defines the single bridge through which all plugins
perform LLM calls.

## Design Rule

All plugins that use LLMs MUST resolve their model
through DS028 role settings and then call the shared
LLM bridge.

## Resolution Order

1. plugin-specific override from DS028
2. shared role assignment from DS028
3. optional request/session generic override
4. default bridge discovery

## Exposed Bridge Surface

```javascript
class LLMBridge {
  async call(systemPrompt, userMessage, opts) -> string
  async callWithRetry(systemPrompt, userMessage,
    opts, maxRetries) -> string
  getAvailableModels() -> ModelInfo[]
  resolveModel(requestModel, sessionModel) -> string
}
```

## Dependencies

- DS022 — LLM-backed seed detectors / goal solvers
- DS028 — role-based selection
