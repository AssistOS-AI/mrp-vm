# DS017 — Answer Synthesis

## Purpose
Defines the final response semantics used by
`gs-plugin`s and the shared `AnswerSynthesizer`.

## Architectural Position

- synthesis is executed by a selected `gs-plugin`
- the shared synthesizer decides whether a
  deterministic `no-context` fallback is required
- strategy-specific language generation happens
  inside the goal solver's backend

## Inputs

Goal solvers consume:

- `sessionId`
- `resolvedIntents`
- optional helper-plugin outputs
- `systemPrompt`
- resolved model settings, when applicable

## Response Contract

Every goal solver returns a stage-level result:

```javascript
{
  status: "success" | "no-context" | "error",
  responseMarkdown: string,
  responseDocument: {
    sessionId: string,
    groups: ResponseGroup[]
  }
}
```

`status: "no-context"` is a real stage outcome. The
core may accept it, try a heavier goal solver, or
escalate to another planner depending on retrieval
sufficiency and planner policy.

## ResponseGroup

```javascript
{
  intentRef: number,
  act: string,
  intent: string,
  status: "answered" | "no-context" | "plugin-error",
  currentTurnContext: ContextUnit[],
  sessionSources: [{
    unitId,
    score,
    unit
  }],
  kbSources: [{
    sourceId,
    unitId,
    score,
    unit
  }],
  pluginOutput: object | null,
  answerMarkdown: string,
  warnings: string[]
}
```

`responseDocument` is the structured API surface.
`responseMarkdown` is the human-readable rendering of
the same result.

The baseline now uses a shared response-document
builder so that symbolic and LLM-backed strategies
produce the same structural envelope.

## Markdown Rendering Shape

The baseline renderer uses this outline:

```markdown
# MRP Response
Session: <sessionId>

## Intent Group <N>
Act: <act>
Intent: <intent>
Status: answered|no-context|plugin-error

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
...
```

Sections MAY be omitted when empty, except that every
group MUST include:

- `Act`
- `Intent`
- `Status`
- `### Answer`
- `### Sources Used`

## No-Context Path

If no resolved intent has evidence and no helper
plugin produced a successful result, the shared
synthesizer MUST return a deterministic no-context
response instead of calling a language model blindly.

The baseline no-context message is:

```text
The session context and persistent KB do not contain
enough evidence to answer this intent.
```

## Helper Plugin Integration

When an external helper plugin succeeds, the answer
should surface:

- plugin name
- confidence, when provided
- result summary or produced CNL

When the helper plugin fails, the group status
becomes `plugin-error` and the warning is preserved in
`warnings`.

## Grounding Rules

- the answer must stay tied to retrieved evidence or
  helper-plugin output
- retrieved sources must be listed explicitly
- `no-context` is preferred over unsupported free
  invention

## Dependencies

- DS012 — resolved intents
- DS022 — goal solver family
- DS027 — goal solver contract
