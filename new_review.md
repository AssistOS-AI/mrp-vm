# SDK / Core NLP and SLC Boundary Review

## Scope

This review checks whether natural-language-processing helpers and SLC/CNL-related helpers are placed in the correct architectural area.

Target boundary:

- `src/core/**` must not contain generic natural-language-processing logic.
- `src/core/interpreter/**` is the only core area allowed to understand SLCI-owned CNL/SLC syntax, parsing, validation, and interpreter semantics.
- Shared plugin-facing natural-language helpers must live in `src/mrp-vm-sdk/nlp-util/**`.
- Shared plugin-facing SLC document helpers must live in `src/mrp-vm-sdk/slc/**`.
- Plugin-specific code may stay in `src/plugins/**` only if it is not reused elsewhere.

This review does not change code. It records the current problems and the refactoring backlog required to reach the intended boundary.

## Findings

### P1. Generic NLP logic still lives in `src/core/**` outside the interpreter

Affected files:

- `src/core/normalizer/nl-normalizer.mjs`
- `src/core/intent/decomposer.mjs`
- `src/core/kb/tokenizer.mjs`
- `src/core/ingest/source-ingestor.mjs`
- `src/core/kb/index.mjs`

Why this is a problem:

- `src/core/normalizer/nl-normalizer.mjs` performs NL-to-control normalization orchestration and corrective retry logic instead of remaining pure orchestration.
- `src/core/intent/decomposer.mjs` derives query terms, extracts focus phrases, and uses stopword logic.
- `src/core/kb/tokenizer.mjs` performs lexical tokenization and stemming.
- `src/core/ingest/source-ingestor.mjs` performs sentence splitting and chunking heuristics.
- `src/core/kb/index.mjs` embeds query-token processing and pragmatic role boosting.

Examples:

- `src/core/normalizer/nl-normalizer.mjs:22-97`
- `src/core/intent/decomposer.mjs:35-82`
- `src/core/kb/tokenizer.mjs:17-40`
- `src/core/ingest/source-ingestor.mjs:78-137`
- `src/core/kb/index.mjs:96-133`

Required direction:

- Move reusable NLP logic out of `src/core/**`.
- Keep core focused on orchestration, runtime objects, persistence, and plugin dispatch.
- Put reusable plugin-facing NLP helpers under `src/mrp-vm-sdk/nlp-util/**`.
- If an NLP rule is only used by one plugin, keep it plugin-local instead of core-local.

### P1. SLC/CNL ownership is split between the interpreter, a legacy core facade, and SDK knowledge helpers

Affected files:

- `src/core/parser/cnl-validator-parser.mjs`
- `src/core/kb/persistence.mjs`
- `src/core/interpreter/schema.mjs`
- `src/core/interpreter/validator.mjs`
- `src/mrp-vm-sdk/knowledge/pragmatics.mjs`

Why this is a problem:

- `src/core/parser/cnl-validator-parser.mjs` is a non-interpreter compatibility facade that still owns CNL/SLC validation behavior and legacy Markdown parsing.
- `src/core/kb/persistence.mjs` depends on SDK SLC builders from `src/mrp-vm-sdk/control/sop.mjs`.
- `src/core/interpreter/schema.mjs` and `src/core/interpreter/validator.mjs` import pragmatic enums from the SDK, which means the interpreter does not fully own the language contract it validates.
- `src/mrp-vm-sdk/knowledge/pragmatics.mjs` mixes plugin-facing mappings with CNL field contracts and enum definitions that belong closer to the interpreter.

Examples:

- `src/core/parser/cnl-validator-parser.mjs:1-12`
- `src/core/parser/cnl-validator-parser.mjs:80-320`
- `src/core/kb/persistence.mjs:4-7`
- `src/core/kb/persistence.mjs:172-230`
- `src/core/interpreter/schema.mjs:1-7`
- `src/core/interpreter/validator.mjs:1-15`

Required direction:

- The interpreter must own SLC grammar, tokenizer, parser, schema, enum validation, and semantic constraints.
- Non-interpreter core code must stop owning or validating SLC/CNL semantics.
- Plugin-facing SLC document construction helpers may exist in the SDK, but they must not define interpreter-owned language semantics.

### P1. The SDK does not yet separate reusable NLP helpers from reusable SLC helpers

Affected files:

- `src/mrp-vm-sdk/control/sop.mjs`
- `src/mrp-vm-sdk/knowledge/pragmatics.mjs`
- `src/mrp-vm-sdk/knowledge/symbolic-facts.mjs`
- `src/mrp-vm-sdk/vendor/porter.mjs`
- `src/mrp-vm-sdk/vendor/stopwords.mjs`

Why this is a problem:

- `src/mrp-vm-sdk/control/sop.mjs` is clearly SLC helper code, but it sits in `control/` instead of a dedicated `slc/` area.
- `src/mrp-vm-sdk/knowledge/pragmatics.mjs` mixes several concerns: pragmatic acts, role mappings, phase-scope normalization, and CNL field sets.
- `src/mrp-vm-sdk/knowledge/symbolic-facts.mjs` is NLP utility code, not general knowledge-model code.
- `src/mrp-vm-sdk/vendor/porter.mjs` and `src/mrp-vm-sdk/vendor/stopwords.mjs` are reusable lexical NLP dependencies and should be grouped under the NLP utility area rather than left as generic top-level vendor modules.

Examples:

- `src/mrp-vm-sdk/control/sop.mjs:1-57`
- `src/mrp-vm-sdk/knowledge/pragmatics.mjs:4-96`
- `src/mrp-vm-sdk/knowledge/symbolic-facts.mjs:17-88`

Required direction:

- Create `src/mrp-vm-sdk/nlp-util/**` for shared lexical, sentence, symbolic-fact, and query-term utilities.
- Create `src/mrp-vm-sdk/slc/**` for shared plugin-facing SLC builders and helpers.
- Split mixed files so that NLP helpers, plugin-facing SLC helpers, and interpreter-owned language semantics no longer share the same module.

### P1. Shared NLP helpers are duplicated across multiple KB plugins

Affected files:

- `src/plugins/kb-plugin/kb-balanced/knowledge/pragmatics.mjs`
- `src/plugins/kb-plugin/kb-fast/knowledge/pragmatics.mjs`
- `src/plugins/kb-plugin/kb-thinkingdb/knowledge/pragmatics.mjs`
- `src/plugins/kb-plugin/kb-balanced/knowledge/symbolic-facts.mjs`
- `src/plugins/kb-plugin/kb-fast/knowledge/symbolic-facts.mjs`
- `src/plugins/kb-plugin/kb-thinkingdb/knowledge/symbolic-facts.mjs`
- `src/plugins/kb-plugin/kb-balanced/retrieval/tokenizer.mjs`
- `src/plugins/kb-plugin/kb-fast/retrieval/tokenizer.mjs`
- `src/plugins/kb-plugin/kb-thinkingdb/retrieval/tokenizer.mjs`
- `src/plugins/kb-plugin/kb-balanced/vendor/porter.mjs`
- `src/plugins/kb-plugin/kb-fast/vendor/porter.mjs`
- `src/plugins/kb-plugin/kb-thinkingdb/vendor/porter.mjs`
- `src/plugins/kb-plugin/kb-balanced/vendor/stopwords.mjs`
- `src/plugins/kb-plugin/kb-fast/vendor/stopwords.mjs`
- `src/plugins/kb-plugin/kb-thinkingdb/vendor/stopwords.mjs`

Why this is a problem:

- These files are not plugin-specific variations. They are duplicated shared utilities.
- The current duplication makes fixes risky and guarantees drift over time.

Evidence:

- `src/mrp-vm-sdk/knowledge/pragmatics.mjs` and `src/plugins/kb-plugin/kb-balanced/knowledge/pragmatics.mjs` currently have the same SHA-256 hash.
- `src/mrp-vm-sdk/knowledge/symbolic-facts.mjs` and `src/plugins/kb-plugin/kb-balanced/knowledge/symbolic-facts.mjs` currently have the same SHA-256 hash.
- All three KB plugin copies of `knowledge/pragmatics.mjs` share the same SHA-256 hash.
- All three KB plugin copies of `knowledge/symbolic-facts.mjs` share the same SHA-256 hash.
- All three KB plugin copies of `retrieval/tokenizer.mjs` share the same SHA-256 hash.
- All three KB plugin copies of `vendor/porter.mjs` share the same SHA-256 hash.
- All three KB plugin copies of `vendor/stopwords.mjs` share the same SHA-256 hash.

Required direction:

- Centralize shared plugin-facing helpers in `src/mrp-vm-sdk/nlp-util/**` and `src/mrp-vm-sdk/slc/**`.
- Make plugins import shared helpers from the SDK instead of carrying private copies.
- Keep plugin-local files only when a plugin truly needs divergent behavior.

### P2. SDK strategies still embed substantial NLP logic instead of using clearer internal sub-boundaries

Affected files:

- `src/mrp-vm-sdk/strategies/symbolic-only.mjs`
- `src/mrp-vm-sdk/strategies/llm-assisted.mjs`

Why this is a problem:

- `src/mrp-vm-sdk/strategies/symbolic-only.mjs` contains act detection, sentence splitting, context filtering, role inference, grouping, and symbolic fact extraction orchestration in one large module.
- `src/mrp-vm-sdk/strategies/llm-assisted.mjs` still contains legacy seed-bundle format assumptions and prompt-level control formatting.
- Even if strategies remain in the SDK, low-level NLP utilities should be extracted into `nlp-util/**` and low-level SLC document helpers into `slc/**`.

Examples:

- `src/mrp-vm-sdk/strategies/symbolic-only.mjs:13-35`
- `src/mrp-vm-sdk/strategies/symbolic-only.mjs:60-131`
- `src/mrp-vm-sdk/strategies/symbolic-only.mjs:241-317`
- `src/mrp-vm-sdk/strategies/llm-assisted.mjs:6-16`
- `src/mrp-vm-sdk/strategies/llm-assisted.mjs:29-39`

Required direction:

- Keep strategies as orchestration entry points.
- Move reusable lexical and sentence-processing routines to `src/mrp-vm-sdk/nlp-util/**`.
- Move reusable SLC formatting helpers to `src/mrp-vm-sdk/slc/**`.
- Remove legacy seed bundle assumptions during the migration to the new SLC/SOP flow.

### P2. Legacy seed-bundle and Markdown-CNL assumptions are still present

Affected files:

- `src/core/parser/cnl-validator-parser.mjs`
- `src/mrp-vm-sdk/strategies/llm-assisted.mjs`

Why this is a problem:

- `src/core/parser/cnl-validator-parser.mjs` still validates and parses the old Markdown block format.
- `src/mrp-vm-sdk/strategies/llm-assisted.mjs` still expects the exact legacy sections `# Intent CNL` and `# Session Context CNL`.
- This keeps old and new control-language assumptions alive at the same time.

Examples:

- `src/core/parser/cnl-validator-parser.mjs:80-320`
- `src/mrp-vm-sdk/strategies/llm-assisted.mjs:6-10`
- `src/mrp-vm-sdk/strategies/llm-assisted.mjs:29-39`

Required direction:

- Remove legacy Markdown-CNL assumptions after the interpreter-owned SLC flow is fully wired.
- Keep only one authoritative control-language contract.

### P3. The SDK root has no README documenting boundaries, ownership, and target folder layout

Affected path:

- `src/mrp-vm-sdk/README.md`

Why this is a problem:

- The intended ownership model is not documented where SDK contributors will look first.
- Without a root README, new shared helpers can continue to be added in the wrong area.

Required direction:

- Add a root SDK README that defines:
  - the purpose of the SDK
  - what belongs in `nlp-util/`
  - what belongs in `slc/`
  - what must remain in `src/core/interpreter/**`
  - when code stays plugin-local versus moves into the SDK

## Proposed Refactoring Plan

### 1. Establish the SDK target layout

- Create `src/mrp-vm-sdk/nlp-util/**` for reusable NLP helpers used by multiple plugins or strategies.
- Create `src/mrp-vm-sdk/slc/**` for reusable plugin-facing SLC document builders, statement helpers, and reference helpers.
- Keep `src/mrp-vm-sdk/strategies/**` as orchestration entry points, not as the final home of low-level NLP or SLC helper logic.

### 2. Make the interpreter the single owner of SLC/CNL semantics

- Move interpreter-owned enums, field contracts, and validation semantics out of `src/mrp-vm-sdk/knowledge/pragmatics.mjs`.
- Remove the dependency from `src/core/interpreter/schema.mjs` and `src/core/interpreter/validator.mjs` to SDK pragmatic modules.
- Retire `src/core/parser/cnl-validator-parser.mjs` after its remaining responsibilities are either migrated into `src/core/interpreter/**` or removed as legacy behavior.

### 3. Remove generic NLP from `src/core/**`

- Move NL normalization orchestration and reusable text-processing helpers out of `src/core/normalizer/nl-normalizer.mjs`.
- Move query-term derivation and lexical heuristics out of `src/core/intent/decomposer.mjs`.
- Move tokenizer, stemming, stopword, sentence-splitting, and similar lexical helpers out of `src/core/kb/tokenizer.mjs` and `src/core/ingest/source-ingestor.mjs`.
- Keep only orchestration and dataflow behavior in core.

### 4. Centralize shared plugin utilities in the SDK

- Consolidate shared stopwords, stemming, tokenization, sentence utilities, and symbolic-fact extraction in `src/mrp-vm-sdk/nlp-util/**`.
- Consolidate shared plugin-facing SLC builders currently in `src/mrp-vm-sdk/control/sop.mjs` into `src/mrp-vm-sdk/slc/**`.
- Split `src/mrp-vm-sdk/knowledge/pragmatics.mjs` into narrower modules so plugin-facing pragmatic mappings do not also act as the interpreter's language-definition source.

### 5. Remove duplication from KB plugins

- Replace duplicated KB-plugin utility copies with imports from the SDK.
- Keep only plugin-specific retrieval logic under each KB plugin.
- Delete duplicated copies after imports are switched and behavior is verified.

### 6. Clean up strategy modules

- Refactor `src/mrp-vm-sdk/strategies/symbolic-only.mjs` so it consumes helpers from `nlp-util/**` and `slc/**`.
- Refactor `src/mrp-vm-sdk/strategies/llm-assisted.mjs` so legacy seed-bundle formatting is removed and the strategy uses the current control-language contract only.

### 7. Boundary rules to enforce after refactoring

- No generic NLP in `src/core/**`.
- No non-interpreter SLC/CNL parsing or validation in `src/core/**`.
- No core imports from SDK NLP helpers.
- No interpreter dependency on SDK modules for interpreter-owned SLC/CNL semantics.
- Shared multi-plugin helpers must live in the SDK, not as copied files inside plugins.

## Implementation Order

1. Add the SDK folder policy and target layout.
2. Split interpreter-owned SLC/CNL semantics from SDK helpers.
3. Create `src/mrp-vm-sdk/nlp-util/**` and `src/mrp-vm-sdk/slc/**`.
4. Migrate strategy helpers and plugin duplicates to the new SDK folders.
5. Remove generic NLP from `src/core/**`.
6. Remove the legacy parser facade and remaining Markdown-CNL assumptions.

