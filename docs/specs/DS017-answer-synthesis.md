# DS017 — Answer Synthesis

## Purpose
The module that transforms resolved intents (with
retrieved context and plugin results) into the final
structured Markdown response.

## Description

This is the link between retrieval/matching and
user-facing output. It receives `ResolvedIntent[]`
and produces a structured response document plus the
Markdown that is returned directly by chat/API.
The synthesis capability is fulfilled by the active
processing strategy (DS022).

## Input

```javascript
{
  sessionId: string,
  resolvedIntents: ResolvedIntent[],
  pluginOutputs: PluginOutput[],
  systemPrompt: string | null,
  strategy: LanguageProcessingStrategy
}
```

`pluginOutputs` are keyed by `intentRef` to match
them to the correct resolved intent.

`systemPrompt` (if present) is included in the
synthesis prompt to respect user-provided system
instructions.

## Output — Response Markdown

```markdown
# MRP Response
Session: sess-abc123

## Intent Group 1
Act: compare
Intent: Compare BM25 and dense retrieval.
Status: answered

### Current-Turn Context
...

### Session Context
...

### Persistent KB Context
...

### Plugin Evidence
...

### Answer
...

### Sources Used
- sess-abc123::turn-002::unit-000
- src-001::chunk-000::unit-000
```

## Internal ResponseDocument Schema

```javascript
{
  sessionId: string,
  groups: [{
    intentRef: number,
    act: string,
    intent: string,
    status: "answered" | "partial" |
      "no-context" | "plugin-error",
    currentTurnContext: ContextUnit[],
    sessionSources: [{ unitId, score }],
    kbSources: [{ sourceId, unitId, score }],
    pluginOutput: PluginOutput | null,
    answerMarkdown: string | null,
    warnings: string[]
  }]
}
```

## Synthesis Strategies

### When evidence exists
- The active strategy produces the answer block for
  each evidence-bearing intent group.
- In `llm-assisted` mode, LLMAgent is called with a
  dedicated prompt.
- The prompt receives: normalized intent, current
  turn context, session context, persistent KB
  context, plugin results (if any), and system
  prompt (if any).
- Strict instructions: the answer must be grounded
  in the provided evidence and cite only evidence
  present in the resolved intent.
- The prompt is in `config/prompts/synthesize.md`.

### When retrieval returns 0 results
- No LLM fallback is allowed.
- The group is rendered deterministically with
  `status: no-context`.
- The answer block states that the session context
  and persistent KB do not contain enough evidence.

### When a request has mixed group states
- Synthesis operates on the full list of intent
  groups in the request.
- Groups with evidence may be synthesized as
  `answered`.
- Groups without evidence are rendered as
  `no-context`.
- Groups with plugin execution failure are rendered
  as `plugin-error`.
- Mixed outcomes in one response are expected and do
  not constitute a pipeline failure.

### When a plugin fails
- The group is marked `plugin-error`.
- The plugin error is included explicitly in the
  warnings section.
- No secondary plugin fallback is attempted.

### Plugin Result Integration
- `PluginOutput` is injected as a
  `### Plugin Evidence` section in the evidence
  bundle sent to LLM for synthesis.
- Plugin output has higher priority than KB
  context; it is still cited explicitly rather than
  merged silently.
- Matching is done via `intentRef` on both
  `PluginOutput` and `ResponseDocument.groups`.

## Grounding Policy

- The answer MUST NOT go beyond the provided
  current-turn context, session context,
  persistent KB context, and plugin output.
- Every cited source in the response must map to an
  actual evidence unit present in the resolved
  intent.
- Full semantic grounding verification is out of
  scope for v1; structural provenance validation is
  mandatory.

## LLM Budget Per Request

- Synthesis: at most 1 LLM call per request.
- Total request pipeline: 3 primary LLM stages and
  5 actual LLM attempts by default
  (1 intent normalization + up to 1 corrective
  retry, 1 session-context extraction + up to
  1 corrective retry, 1 synthesis).
- Configurable in `config/engine.json`:
  `"maxPrimaryLLMStagesPerRequest": 3`,
  `"maxLLMAttemptsPerRequest": 5`.
- Total request timeout: configurable,
  default 60s.

## Main Interface

```javascript
class AnswerSynthesizer {
  constructor(strategyRegistry, config)
  async synthesize(sessionId, resolvedIntents,
    pluginOutputs, systemPrompt, strategy) → {
      responseDocument,
      responseMarkdown
    }
}
```

## Dependencies

- DS002 (Core) — invokes the synthesizer.
- DS012 (Retrieval) — provides ResolvedIntent[].
- DS022 (Processing Strategies) — active synthesis
  backend.
- DS015 (LLMAgent) — LLM calls for synthesis.
