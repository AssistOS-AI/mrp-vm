# DS020 — Integration Testing

## Purpose
Defines code-level integration testing for MRP-VM.
This DS is about verifying modules and contracts in
the implemented system, not about evaluating NL
quality at product level.

## Scope

Integration tests cover:
- server + core + session handling
- normalizer + validator
- retrieval over persistent KB and session context
- plugin invocation contract
- persistence and boot recovery

## Core Rules

- No mocks, stubs, or fake LLMs are allowed for
  LLM-dependent flows.
- LLM-dependent integration tests must run through
  AchillesAgentLib against real provider models
  tagged `fast`.
- Integration testing is split into two execution
  lanes:
  - `deterministic-integration`
  - `live-llm-integration`
- Strategy-aware integration is mandatory: suites
  must declare whether they run against
  `llm-assisted`, `symbolic-only`, or both.
- Retrieval-profile coverage is mandatory: suites
  must declare which retrieval profiles they cover.
- Plugin tests may use real local test wrappers.
- Temporary files, KB fixtures, and session stores
  must be isolated per test run.

## Execution Lanes

### `deterministic-integration`
- Required in local development and default CI.
- Must run fully offline.
- Must not require any live LLM provider.
- Covers all non-LLM contracts:
  - server/session handling
  - parser/validator
  - KB/persistence
  - retrieval
  - plugins
  - `symbolic-only` processing mode

### `live-llm-integration`
- Uses real LLM providers through AchillesAgentLib.
- Is not part of the mandatory offline/default CI
  gate.
- Runs in dedicated environments:
  - developer opt-in
  - nightly CI
  - pre-release validation
  - dedicated live-provider pipelines
- Verifies only contracts that truly require live
  LLM behavior.

No third lane with fake LLMs is allowed.

## Test Categories

### 1. Session and API Integration
- session creation
- session reuse with delta `messages[]`
- session expiration after idle TTL
- model override and session model persistence

### 2. Request Pipeline Integration
- request → Intent CNL → decomposition → retrieval
  → synthesis
- explicit `no-context` result when evidence is
  absent
- explicit error on normalization failure
- explicit error on synthesis failure
- identical API/session contract under each enabled
  processing strategy, except where DS022 declares a
  capability limit
- retrieval-profile routing and session persistence
- deterministic profile-specific behavior when only
  `bm25-lexical` is enabled

Lane mapping:
- `deterministic-integration` covers the full request
  pipeline in `symbolic-only` mode and all symbolic
  submodules.
- `live-llm-integration` covers the `llm-assisted`
  path for normalization, session-context extraction,
  and synthesis.

### 3. Session Context Integration
- current-turn user message yields filtered
  session Context CNL
- requests/questions do not enter session KB
- assistant output never enters session KB
- session context is retrievable on later turns

### 4. Persistent KB Integration
- add source
- update source
- delete source
- ingest failure preserves previous committed state
- boot-time quarantine and index rebuild

### 5. Plugin Integration
- deterministic plugin selection
- timeout handling
- invalid stdout handling
- input limit enforcement before spawn

## Fixtures

- NL request fixtures
- source document fixtures (`.md`, `.txt`)
- session transcripts
- plugin wrapper fixtures

Fixtures should live under test-owned directories and
must be deterministic except for provider-dependent
LLM output variance explicitly tolerated by the test.

For `live-llm-integration`, fixtures must assert
bands and structure, not exact byte-for-byte answer
text.

## Assertions

Required assertions include:
- output shape and schema
- response/error codes
- provenance references
- session state transitions
- committed vs non-committed state on failure

For `live-llm-integration`, allowed assertions are:
- valid CNL / valid Markdown structure
- required sections and statuses
- required provenance patterns
- bounded phrase expectations
- absence of forbidden patterns

Exact full-output equality is not allowed for
LLM-dependent suites.

## Environment

- Uses the same Achilles discovery logic as runtime.
- Default model selection for tests: first available
  `fast` model by DS015 ordering, unless a test pins
  a specific model.
- `symbolic-only` suites must run with no model
  override and must assert
  `STRATEGY_DOES_NOT_ACCEPT_MODEL` where applicable.
- `llm-assisted` suites may be skipped only if no
  `fast` model is discoverable; the skip must be
  explicit.

## CI/CD Policy

- Default CI must execute `deterministic-integration`
  and must not depend on live LLM availability.
- `live-llm-integration` must be a separate job or
  pipeline.
- If a deployment chooses to make
  `live-llm-integration` blocking, that is an
  environment policy, not the default DS020 rule.
- A missing live provider in default CI is not a
  test failure.
- A missing live provider in a dedicated live-LLM
  pipeline is a pipeline failure.

## Output

Test runs must emit:
- passed/failed/skipped counts
- failed fixture IDs
- processing strategy used
- retrieval profile used
- model/provider used
- duration per suite

## Dependencies

- DS001 — architecture and global test rules
- DS006 — LLM-dependent normalization
- DS013 — API integration surface
- DS019 — session semantics
- DS023 — retrieval profiles and strategy behavior
