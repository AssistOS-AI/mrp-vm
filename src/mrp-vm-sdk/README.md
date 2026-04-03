# MRP-VM SDK

## Purpose

`src/mrp-vm-sdk/**` contains reusable plugin-facing modules.

The SDK is not the VM kernel. It must not become a second copy of core runtime logic.

Use the SDK for:

- helper modules reused by multiple plugins
- plugin-facing document builders and adapters
- shared synthesis helpers
- shared plugin utility code with stable boundaries

Do not use the SDK for:

- core orchestration logic
- frame scheduling
- interpreter-owned SLC/CNL grammar or validation semantics
- generic code that belongs only to one plugin

## Boundary Rules

### Core

`src/core/**` must stay focused on orchestration, runtime state, persistence, tracing, and plugin dispatch.

Generic natural-language processing must not live in `src/core/**`.

Examples of code that must not live in core:

- stopword filtering
- stemming
- lexical tokenization
- sentence splitting
- heuristic act detection
- generic focus-term extraction
- plugin-facing document builders

### Interpreter

`src/core/interpreter/**` is the only core area allowed to understand SLCI-owned control language details.

That includes:

- SLC tokenization
- SLC parsing
- SLC validation
- SLC schema constraints
- interpreter runtime semantics for SLC objects and statements

If a module defines or validates the language contract itself, it belongs in the interpreter, not in the SDK.

### SDK NLP Utilities

Reusable natural-language helpers used by multiple plugins or strategies must live in:

- `src/mrp-vm-sdk/nlp-util/**`

Typical examples:

- stopwords
- stemming
- lexical tokenizers
- sentence splitters
- symbolic fact extraction
- query-term derivation
- shared text normalization helpers

If an NLP helper is used by only one plugin and is not a stable shared abstraction yet, keep it plugin-local.

### SDK SLC Utilities

Reusable plugin-facing SLC helpers must live in:

- `src/mrp-vm-sdk/slc/**`

Typical examples:

- statement builders
- reference helpers
- scalar and list rendering helpers
- plugin-side helpers for emitting valid SLC statements

Important:

- `sdk/slc/**` may help plugins produce SLC documents.
- `sdk/slc/**` must not become the owner of interpreter semantics.
- The interpreter must remain the authority for SLC grammar, schema, and validation rules.

## Target SDK Layout

Recommended layout:

- `platform/` shared SDK-level errors and platform helpers
- `plugins/` plugin-facing factories and adapters
- `strategies/` orchestration-level strategy entry points
- `synthesis/` answer and payload rendering helpers
- `nlp-util/` shared natural-language utilities
- `slc/` shared plugin-facing SLC helpers

Legacy folders may still exist during migration, but new shared NLP or SLC helpers should follow the target layout above.

## When To Move Code Into The SDK

Move a helper into the SDK when at least one of these is true:

- it is already used by two or more plugins
- it is clearly a stable plugin-facing abstraction
- duplication across plugins is already visible

Do not move code into the SDK just because it is convenient.

If code is specific to one plugin's private behavior, keep it inside that plugin.

## Import Rules

Preferred direction:

- plugins, strategies, and core orchestration may
  import stable SDK helpers from
  `src/mrp-vm-sdk/**` when the SDK is the declared
  owner of that reusable logic
- strategies inside the SDK may import from
  `nlp-util/**` and `slc/**`
- interpreter-owned semantics stay inside
  `src/core/interpreter/**`

Disallowed direction:

- interpreter must not depend on SDK modules for
  interpreter-owned language semantics
- core must not depend on SDK modules that define
  SLC/CNL grammar, schema, or enum validation
- new generic NLP logic must not be implemented
  directly inside `src/core/**`

If core or interpreter needs something from the SDK
in order to understand the language contract,
ownership is likely wrong and should be fixed.
If core consumes a stable SDK helper, core should
remain orchestration-only and must not become the
owner of that logic again.

## Migration Note

The repository is still in transition.

Current code still contains:

- some NLP/chunking helpers inside `src/core/**`
  (notably `src/core/ingest/source-ingestor.mjs`)
- mixed ownership inside
  `src/mrp-vm-sdk/knowledge/pragmatics.mjs`
- legacy Markdown-CNL compatibility in
  `src/core/parser/**`

Completed migration so far:

- `src/mrp-vm-sdk/nlp-util/**` exists and owns the
  shared tokenizer / stopword / stemming / symbolic
  fact helpers
- `src/mrp-vm-sdk/slc/**` exists and owns the
  shared plugin-facing SOP builders
- duplicated KB-plugin lexical helper copies were
  removed in favor of SDK ownership

This README defines the target boundary to converge toward during the next refactoring passes.
