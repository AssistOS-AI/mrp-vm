const fs = require('fs');

let content = fs.readFileSync('consolidated-review.md', 'utf-8');

const oldSectionM = `## M. New Requirement: Structured Plugin Communication (Context vs. Intent)

**Issue / Motivation:** Currently, plugins often receive compacted/concatenated text, making it difficult to distinguish the core request from the provided background context. 
**Requirement:** 
Plugins MUST NOT communicate via compacted text. Instead, communication to plugins must explicitly provide:
1. **The current intent/request** (what needs to be solved).
2. **A structured list of Knowledge Units (KUs)** in Markdown format, where each KU has a clear title linking it to its source.

This ensures the plugin knows exactly what the core requirement is versus what is useful background context, and where that context originated from. This requirement needs to be consolidated into the architecture and implemented across the core VM to plugin boundary.`;

const newSectionM = `## M. New Requirement: Structured Plugin Communication (Object-based)

**Issue / Motivation:** Currently, plugins often receive compacted/concatenated text, making it difficult to distinguish the core request from the provided background context. Communication via Markdown strings is fragile.
**Requirement:**
Plugins MUST NOT communicate via compacted Markdown/text. Instead, communication payloads to plugins must be passed as an explicit **object structure**:

\`\`\`javascript
{
  prompt: "The current intent or request to be solved...",
  context: [
    {
      title: "Short title of the KU",
      sourceLink: "Link or reference to bibliographic source",
      text: "The actual content of the KU"
    }
  ]
}
\`\`\`

This ensures the plugin can programmatically distinguish the core requirement from background context.

**Tasks:**
- [ ] Refactor VM-to-Plugin calls (in \`engine.mjs\` and plugins) to pass this explicit object structure instead of concatenated strings.
- [ ] Ensure all \`kb-plugin\` implementations return KUs in a format that maps cleanly to this array structure.
- [ ] Audit the codebase to ensure no plugin receives raw concatenated Markdown for processing.

---

## N. Code Cleanup: Unused, Redundant, and Legacy Code

During a codebase audit, several pieces of redundant or unused code were identified. These should be cleaned up to avoid confusion and maintain a lean runtime.

**Tasks:**
- [ ] **Legacy Aliases:** Remove \`LEGACY_PROCESSING_MODE_ALIASES\` and \`LEGACY_RETRIEVAL_PROFILE_ALIASES\` from \`src/plugins/runtime/aliases.mjs\`. They are heavily used in \`server/http-server.mjs\` and \`core/conversation/handler.mjs\` for backward compatibility, but they clutter the new architecture. Update the API and chat UI to use the new plugin ID resolution natively.
- [ ] **Unused Imports:** Remove unused imports across the codebase:
  - \`loadConfig\` in \`src/core/llm/bridge.mjs\`
  - \`bind\` in \`src/mrp-vm-sdk/retrieval/strategies/hdc-vsa.mjs\`
  - \`MRPError\` in \`src/plugins/runtime/wrapper-manager.mjs\`
- [ ] **Unused Exports:** Remove or utilize isolated exports:
  - \`clearConfigCache\` in \`src/core/platform/config.mjs\`
  - \`hasPhaseScope\` in \`src/mrp-vm-sdk/knowledge/pragmatics.mjs\`
  - \`isValidRelation\` in \`src/mrp-vm-sdk/knowledge/symbolic-facts.mjs\`
  - \`resetTokenizerCache\` in \`src/mrp-vm-sdk/retrieval/tokenizer.mjs\`
- [ ] **Redundant Aggregate Extrapolation:** Remove \`_buildAggregateUnits\` (\`source-ingestor.mjs\`) and \`_expandAggregateKUs\` (\`context-matcher.mjs\`). These are "cheap" heuristics that bypass the formal RAG/chunking spec.

---

## O. SDK vs. Plugin Boundary Violations

**Issue:** The \`mrp-vm-sdk\` contains highly specific, implementation-heavy logic (like HDC/VSA retrieval algorithms and specific KB indexing) that should belong inside individual plugins. The SDK should strictly contain generic glue code, common LLM adapters, and highly reusable utilities, not domain-specific or experimental logic.

**Tasks:**
- [ ] **Relocate HDC/VSA Logic:** Move \`src/mrp-vm-sdk/retrieval/hdc.mjs\` and \`src/mrp-vm-sdk/retrieval/strategies/hdc-vsa.mjs\` into a dedicated \`kb-plugin\` or \`retrieval-plugin\` implementation. This is far too specific for the core SDK.
- [ ] **Relocate KB Indexing Logic:** Move \`src/mrp-vm-sdk/retrieval/kb-index.mjs\` and \`thinkingdb.mjs\` out of the SDK. KB management and indexing are specific to the chosen Knowledge Base plugin, not a universal SDK feature.
- [ ] **Update DS Specifications:** Update the architectural DS files (e.g., DS003, DS016, DS027) to clarify the boundaries between the SDK and Plugins:
  - The SDK provides generic HTTP/LLM bridges, standard error classes, and base classes.
  - Plugins encapsulate ALL specific routing, reasoning algorithms (like VSA), and state/index management.
  - Establish strict rules to prevent adding specific algorithmic implementations into the SDK in the future.
`;

content = content.replace(oldSectionM, newSectionM);
fs.writeFileSync('consolidated-review.md', content);
