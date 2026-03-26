# DS016 — External Interpreter Wrapper Convention

## Purpose
Defines the convention that any external interpreter
(plugin) must follow to integrate with MRP-VM.

## Principle

External interpreters are separate processes. They
can be written in any language. Communication is via
stdin/stdout in CNL Markdown format.

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
  "name": "<plugin-name>",
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

## Protocol I/O

### Input (stdin)
Encoding: UTF-8.
Max size: `maxInputSizeBytes` from manifest.

The format is `resolvedMarkdown` from DS012 — a
Markdown document with the normalized intent and all
available evidence layers:

```markdown
## Resolved Intent Group 1
Act: verify
Intent: Verify that constraint X is satisfiable.
Output: Verification result.

### Current-Turn Context
#### sess-abc123::turn-003::unit-000
Role: Constraint
Claim: Variables are integers.

### Session Context
#### sess-abc123::turn-001::unit-000 (score: 0.74)
Role: Condition
Claim: All values must be positive.

### Persistent KB Context
#### src-001::chunk-000::unit-000 (score: 0.87)
Role: Constraint
Source: rules.md
Claim: a + b must equal c.
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
cat test-input.cnl.md | node wrapper.js
```

## Dependencies

- DS003 (Plugin System) — discovery and invocation.
- DS012 (Retrieval) — input format.
