# DS016 — External Interpreter Wrapper Convention

## Purpose
Defines the convention that any external interpreter
(plugin) must follow to integrate with MRP-VM.

## Principle

External interpreters are separate processes. They
can be written in any language. Communication is via
stdin/stdout using structured JSON input and CNL
Markdown output.

Wrappers are external helper subprocesses managed by
the wrapper manager path. They are not first-class
typed stage plugins in the planner-visible registry.

## Protocol Version

v1 — defined in this document.
Field `protocolVersion: 1` in manifest.

## Wrapper Structure

```
wrappers/<plugin-name>/
├── manifest.json
├── wrapper.js       # or wrapper.py, etc.
└── README.md        # plugin documentation
```

## manifest.json

```json
{
  "id": "<plugin-id>",
  "name": "<plugin-name>",
  "type": "gs-plugin",
  "version": "<semver>",
  "protocolVersion": 1,
  "capabilities": ["<capability-1>"],
  "keywords": ["<keyword-1>"],
  "command": "<executable>",
  "args": ["<arg1>"],
  "timeout": 30000,
  "priority": 10,
  "exclusive": false,
  "maxInputSizeBytes": 65536,
  "description": "<short description>"
}
```

Rules:

- `id` is preferred; legacy wrappers may provide only
  `name`
- `type` is optional in legacy wrappers
- when `type` is absent, the current baseline treats
  the wrapper as a helper-oriented `gs-plugin`
  manifest for compatibility
- wrappers are currently discovered by the external
  `PluginManager` helper path, not inserted into the
  planner-visible typed plugin registry

## Protocol I/O

### Input (stdin)
Encoding: UTF-8.
Max size: `maxInputSizeBytes` from manifest.

The input format MUST NOT be compacted Markdown. Instead, it is passed as a structured JSON object containing the explicit intent and the associated Knowledge Units:

```json
{
  "prompt": "Verify that constraint X is satisfiable.",
  "context": [
    {
      "title": "sess-abc123::turn-003::unit-000",
      "sourceLink": "Current-Turn Context",
      "text": "Role: Constraint\nClaim: Variables are integers."
    },
    {
      "title": "src-001::chunk-000::unit-000",
      "sourceLink": "rules.md",
      "text": "Role: Constraint\nClaim: a + b must equal c."
    }
  ]
}
```

Terminated with EOF (close stdin).

### Output (stdout)
CNL Markdown with the processing result:

```markdown
## Plugin Result
Status: success
Plugin: z3-solver
Confidence: high
Result: Constraint is satisfiable.
Evidence: Z3 returned SAT in 12ms.
```

Output fields:
- `Status` — required: success | error
- `Plugin` — required: plugin name
- `Confidence` — required on success
- `Result` — required on success
- `Evidence` — optional

### Errors (stderr)
Structured JSON, one line:
```json
{"code":"PARSE_ERROR","message":"...","details":{}}
```

### Exit Codes
- 0 — success
- 1 — processing error
- 2 — invalid input
- 3 — internal timeout

## Testing

Each wrapper must be independently testable:
```bash
cat test-input.json | node wrapper.js
```

## Dependencies

- DS003 (Plugin System) — discovery and invocation.
- DS012 (Retrieval) — input format.
