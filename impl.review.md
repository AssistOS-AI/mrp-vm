# Implementation Review

Scope: review of the current implementation in `src/`
and `config/` against the active design specifications
in `docs/specs/DS001-DS023`.

## Findings

### 1. Critical — model selection and corrective retry are both broken on the LLM path

The API and session model preference are implemented,
but the selected model never reaches the actual LLM
calls for normalization or synthesis.

- `NLNormalizer` hardcodes `requestedModel: null` for
  intent normalization, session-context extraction,
  and KB context normalization:
  `src/normalizer/nl-normalizer.mjs:19`,
  `src/normalizer/nl-normalizer.mjs:33`,
  `src/normalizer/nl-normalizer.mjs:47`
- `AnswerSynthesizer` also hardcodes
  `requestedModel: null` before calling the active
  strategy:
  `src/synthesis/answer-synthesizer.mjs:20`

The corrective retry contract is also ineffective.
`_normalizeWithRetry()` builds a correction payload,
but the retry call reuses the original zero-argument
closure, so the repair prompt and validator errors are
never sent to the strategy at all.

- initial closure ignores parameters:
  `src/normalizer/nl-normalizer.mjs:20`,
  `src/normalizer/nl-normalizer.mjs:34`,
  `src/normalizer/nl-normalizer.mjs:48`
- corrective retry incorrectly calls the same closure
  with an argument it does not accept:
  `src/normalizer/nl-normalizer.mjs:88-97`

Result: DS006/DS013/DS015 model override behavior is
not honored, and DS006 corrective retry semantics are
not actually implemented.

### 2. Critical — `llm-assisted` can boot in a broken state instead of failing fast

The boot sequence is supposed to fail if
`llm-assisted` is enabled but Achilles/LLM setup
cannot initialize. Instead, boot logs a warning and
still registers the `llm-assisted` strategy.

- non-fatal boot path:
  `src/server/index.mjs:42-49`
- bridge init swallows Achilles import failure and only
  logs a warning:
  `src/llm/bridge.mjs:18-33`

This leaves the server "ready" while the default
processing mode can fail only at first request.

### 3. Major — invalid `processing_mode` and `retrieval_profile` values are not validated consistently

Session creation accepts arbitrary
`processing_mode` / `retrieval_profile` values and
stores them directly in session state.

- raw values are persisted during session creation:
  `src/server/http-server.mjs:113-126`
- session state stores whatever it receives:
  `src/conversation/handler.mjs:18-40`

`processing_mode` is at least validated later through
`StrategyRegistry.resolve()`, but `retrieval_profile`
is not. The core passes the raw string through, and
the matcher silently falls back to `bm25-lexical` if
the profile is unknown.

- profile is taken as a string without registry
  validation:
  `src/core/engine.mjs:55-56`
- unknown profile falls back implicitly:
  `src/retrieval/context-matcher.mjs:31-35`

This violates the explicit-error contract in
DS013/DS023 and makes request behavior depend on
silent fallback.

### 4. Major — the declared LLM attempt budget is never enforced

`MRPEngine` loads `maxLLMAttemptsPerRequest`, but
there is no enforcement path around real attempts.
The engine increments `llmCallCount` only once per
high-level stage, while transport retries and
validation-correction retries can add more calls.

- budget is configured but unused as a guard:
  `src/core/engine.mjs:23`
- counting is only coarse stage-level accounting:
  `src/core/engine.mjs:61`,
  `src/core/engine.mjs:74`,
  `src/core/engine.mjs:114`
- transport retries can loop independently:
  `src/llm/bridge.mjs:48-61`
- corrective retries are also independent:
  `src/normalizer/nl-normalizer.mjs:71-104`

So the implementation does not satisfy the DS002/DS015
attempt-budget contract.

### 5. Major — plugin conflict resolution ignores manifest priority and deterministic tie-break

Plugin dispatch is implemented as "first matching
plugin wins" over whatever order `scanWrappers()`
registered, then a second pass for keywords. Manifest
priority is not used at all.

- registration preserves directory scan order:
  `src/plugins/manager.mjs:18-43`
- selection returns the first capability/keyword hit:
  `src/plugins/manager.mjs:45-55`

This does not implement the DS003 conflict-resolution
rules and makes multi-plugin behavior effectively
registration-order dependent.

### 6. Major — KB add/update are not source-atomic across the full on-disk commit

The specs require source-atomic ingest/update. The
implementation only performs atomic writes per file.
`raw source`, `context units`, `meta`, and `index`
are written sequentially, and in-memory state is
updated after partial persistence has already started.

- add path:
  `src/kb/knowledge-base.mjs:74-106`
- update path:
  `src/kb/knowledge-base.mjs:118-132`
- persistence atomicity is only file-level rename:
  `src/kb/persistence.mjs:11-15`

If the process crashes or `saveIndex()` fails after
raw/CNL/meta are already written, the repo can be left
in a partially committed state, which contradicts
DS008/DS010 source-atomic behavior.

### 7. Major — the promised automated test coverage is not present

`package.json` declares deterministic and live test
suites, but there are no files under `test/` or
`tests/`. Running `npm test` succeeds with zero tests.

- declared scripts:
  `package.json:6-10`
- no discovered test files in the repository
- `npm test` result observed during review:
  `0 suites`, `0 tests`

This leaves DS020/DS021 effectively unimplemented at
the repository level.

### 8. Medium — the chat UI does not render assistant Markdown

The UI appends assistant output with `textContent`,
which escapes Markdown instead of rendering it.

- message rendering uses plain text:
  `src/ui/chat.js:34-39`
- assistant response is inserted the same way:
  `src/ui/chat.js:88-90`

This misses the DS014 requirement that assistant
responses be rendered as Markdown.

### 9. Medium — `ResponseDocument.groups[*].answerMarkdown` is populated with the wrong granularity

Both strategies store the whole response document into
each group's `answerMarkdown`, instead of the
group-local answer block.

- `llm-assisted` duplicates the full Markdown into
  every group:
  `src/strategies/llm-assisted.mjs:68-85`
- `symbolic-only` stores the cumulatively growing
  response buffer into each group:
  `src/strategies/symbolic-only.mjs:122-133`

The user-facing `responseMarkdown` still exists, but
the internal `ResponseDocument` contract from DS017 is
not faithfully implemented.

## Checks Run

- Repository structure inspection
- Source review across server/core/conversation/
  normalizer/parser/retrieval/KB/plugins/synthesis/UI
- `npm test`

Observed `npm test` result:
- 0 tests
- 0 suites
- exit code 0

## Overall Assessment

The implementation covers a large part of the module
surface from the specifications, but several of the
most important contracts are only partially enforced:

- LLM-path control flow is present, but model routing,
  corrective retry, and boot guarantees are not yet
  reliable.
- Retrieval/profile abstraction exists, but invalid
  profile handling still degrades silently.
- KB/persistence and plugin dispatch are implemented,
  but not at the determinism/atomicity level promised
  by the DS documents.
- Test coverage is the weakest area: the repository
  currently provides the script surface, not the test
  suites themselves.
