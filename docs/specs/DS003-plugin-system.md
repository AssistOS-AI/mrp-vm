# DS003 — Plugin System (External Interpreters)

## Purpose
Manages interpretation plugins — external modules
that process resolved intent bundles and return
results also in CNL. Examples: Z3 solver, custom
code, other interpreters.

## Principles

- Each plugin is a separate process.
- Communication via stdin/stdout in CNL format.
- Plugins can be written in any language
  (Node.js, Python, Rust, etc.) as long as they
  respect the wrapper convention (see DS016).
- Plugins are auto-discovered from `wrappers/`.
- v1 provides no OS-level sandboxing. Plugins are
  trusted components guarded only by allowlists,
  input limits, timeouts, and memory limits.

## Plugin Lifecycle

1. At boot, the engine scans `wrappers/`.
2. Each wrapper declares a `manifest.json`
   with: name, version, capabilities, command.
3. Engine validates the manifest and checks
   the allowlist (`config/engine.json`).
4. Engine registers the plugin.
5. At runtime, when an intent requires a specific
   type of processing, the engine selects exactly
   one plugin based on dispatch rules.
6. The process is spawned, CNL is sent on stdin,
   CNL is read from stdout.

## When a Plugin Is Invoked

Dispatch criteria (in priority order):

1. **Explicit field in Intent CNL**: if the
   Normalizer emits an `Interpreter: z3` field
   (optional extension, not mandatory).
2. **Act → capability mapping**: the pragmatic act
   matches `eligibleCapabilities` from the
   canonical taxonomy.
3. **Keyword matching**: keywords from the intent
   match `keywords` in the manifest.

Invocation timing in pipeline (v1):
- **Post-retrieval**: the plugin receives the
  `ResolvedIntent` (intent + current-turn context +
  session context + persistent KB context).
- The plugin does NOT replace retrieval but
  complements it with specialized processing.
- Dispatch unit: one plugin decision per
  `ResolvedIntent`, therefore per normalized
  Intent Group / `intentRef`.
- If a request contains multiple intent groups,
  plugin dispatch is evaluated independently for
  each one.

## manifest.json

```json
{
  "name": "z3-solver",
  "version": "0.1.0",
  "protocolVersion": 1,
  "capabilities": ["logical-constraint", "sat-check"],
  "keywords": ["constraint", "satisfiable", "prove"],
  "command": "node",
  "args": ["wrapper.js"],
  "timeout": 30000,
  "priority": 10,
  "exclusive": false,
  "maxInputSizeBytes": 65536,
  "description": "Z3 SMT solver wrapper"
}
```

### Fields
- `protocolVersion` — I/O protocol version.
- `keywords` — keywords for matching.
- `priority` — numeric priority (higher = more
  preferred). For conflict resolution.
- `exclusive` — reserved for future multi-plugin
  orchestration; in v1 a single plugin is selected.

## Conflict Resolution

When two plugins declare the same capability:
1. Select the one with higher `priority`.
2. On tie: alphabetical order by `name`
   (deterministic tie-break).
3. The chosen plugin is final for that intent.
   No automatic fallback chain is allowed.

## PluginOutput (Canonical Structure)

The plugin result integrates into the pipeline
as a standard structure:

```javascript
{
  intentRef: 1,
  pluginName: "z3-solver",
  capabilityUsed: "logical-constraint",
  status: "success" | "error" | "timeout",
  resultCNL: string | null,
  confidence: "high" | "medium" | "low" | null,
  artifacts: [],
  error: null | { code, message }
}
```

- `intentRef` links the output to the specific
  Intent Group it was invoked for.
- Plugin output is treated as explicit evidence
  in answer synthesis (DS017), never merged
  anonymously.
- Multiple plugin outputs from one user request are
  aggregated only by `intentRef`; there is no
  cross-group merging.

## Security

- Only plugins in the allowlist
  (`config/engine.json`) can be executed.
- Timeout per plugin (from manifest or config).
- Memory limit per plugin (configurable).
- Sanitized paths — `command` cannot contain
  `..` or absolute paths.
- Input size enforcement: before spawning the
  plugin process, the engine checks that the
  serialized `resolvedMarkdown` does not exceed
  `maxInputSizeBytes` from the manifest. If it
  does, return `PLUGIN_INPUT_TOO_LARGE`.
- Plugin stdout must parse under the DS016
  contract; invalid stdout becomes
  `PLUGIN_INVALID_OUTPUT`.

## Dependencies

- DS016 (Wrapper Convention) — defines the contract.
- DS002 (MRP-VM Core) — invokes plugins.
- DS004 (Intent CNL) — pragmatic acts.
- DS017 (Synthesis) — consumes PluginOutput.
