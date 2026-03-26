# DS021 — Evaluation

## Purpose
Defines product-level evaluation for MRP-VM using
natural-language inputs and expected structured
outputs. This DS is distinct from DS020:
evaluation measures behavior quality, not code
integration correctness.

## Scope

Evaluation operates on:
- NL user inputs
- optional source documents loaded into KB
- optional multi-turn session setups
- expected Markdown output properties

## Core Rules

- No mocks, stubs, or fake LLMs are allowed.
- Evaluations targeting `llm-assisted` run through
  AchillesAgentLib against real provider models
  tagged `fast`, unless a suite explicitly pins
  another model.
- Evaluations targeting `symbolic-only` run with no
  model selection and must not make LLM calls.
- Evaluation suites must declare the target
  processing strategy: `llm-assisted`,
  `symbolic-only`, or both.
- Evaluation suites must declare the target
  retrieval profile: `fast`, `balanced`,
  `wide-recall`, `symbolic-grounded`,
  `meta-rational`, or a defined subset.
- Evaluation expectations are phrased in terms of
  output intent grouping, status, context usage,
  provenance, and answer content bands.
- DS021 evaluation is not part of the mandatory
  offline/default CI gate. It belongs in dedicated
  evaluation runs, nightly jobs, or release
  validation.

## Evaluation Unit

One evaluation case contains:

```json
{
  "id": "eval-compare-001",
  "sessionSetup": {
    "messages": [
      { "role": "user", "content": "We deploy on CPU only." }
    ]
  },
  "kbSources": ["benchmarks.md"],
  "input": "Compare BM25 and dense retrieval for us.",
  "expected": {
    "intentCount": 1,
    "groupStatuses": ["answered"],
    "mustMention": ["BM25", "dense retrieval"],
    "mustUseSources": ["sess-", "src-"],
    "mustNotContain": ["I guess", "maybe without evidence"]
  }
}
```

## Evaluation Dimensions

### 1. Intent Extraction
- correct number of intent groups
- correct pragmatic act
- explicit context separated from the request

### 2. Session Context Use
- prior user facts reused when relevant
- prior assistant answers not reused as evidence
- irrelevant prior context ignored

### 3. Persistent KB Use
- correct source retrieval
- explicit provenance in output
- `no-context` when evidence is genuinely absent

### 4. Answer Quality
- grounded answer content
- no unsupported expansions
- correct plugin evidence inclusion when used

### 5. Error Behavior
- explicit structured errors when required LLM
  steps fail
- explicit session expiration behavior
- no hidden fallback answers
- explicit unsupported-input behavior for
  `symbolic-only` when the input is outside its
  declared DS022 envelope

## Expected Output Style

Evaluation does not require exact byte-for-byte
matching. It checks:
- Markdown structure
- required headings/sections
- required status labels
- required and forbidden phrases
- required provenance patterns

## Metrics

Recommended aggregate metrics:
- intent extraction pass rate
- session-context reuse pass rate
- retrieval grounding pass rate
- no-context correctness rate
- plugin integration pass rate
- profile-sensitive retrieval pass rate
- median and p95 latency

## Output Artifacts

Evaluation runs must save:
- raw Markdown outputs
- structured pass/fail summaries
- processing strategy metadata
- retrieval profile metadata
- provider/model metadata
- per-case latency

## Dependencies

- DS001 — architecture and evaluation policy
- DS013 — public response contract
- DS017 — Markdown output format
- DS019 — session behavior
- DS023 — retrieval profile semantics
