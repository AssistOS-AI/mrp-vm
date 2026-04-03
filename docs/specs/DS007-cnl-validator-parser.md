# DS007 — SOP Validator and Parser

## Purpose
Defines the deterministic tokenizer, parser, and
validator for SOP Lang Control documents.

This module is fully symbolic. It MUST NOT use an
LLM.

DS007 covers:

- tokenization
- statement parsing
- command signature validation
- field validation for `set`
- document-kind validation for intent/context/mixed
  control documents

DS032 covers semantic interpretation after parsing.

## Separate Responsibilities

The implementation MUST keep these functions
distinct:

1. lexical tokenization
2. structural parsing into statements
3. command and field validation
4. document-kind validation

Semantic admission into typed runtime objects is not
part of DS007. That belongs to DS032.

## Main Interfaces

```javascript
class SOPTokenizer {
  tokenize(sourceText) -> Token[]
}

class SOPParser {
  parseDocument(sourceText) -> ParsedStatement[]
}

class SOPValidator {
  validate(parsedStatements, options) -> ValidationResult
}
```

`options.documentKind` MUST support:

- `intent`
- `context`
- `mixed`

## ParsedStatement

```javascript
{
  id: "@i1",
  command: "intent",
  args: unknown[],
  line: 1,
  column: 1
}
```

## ValidationResult

```javascript
{
  valid: boolean,
  errors: [{
    code: "UNKNOWN_COMMAND",
    line: 1,
    column: 5,
    message: "Unsupported command 'intnt'"
  }]
}
```

## Minimum Error Codes

- `INVALID_STATEMENT_ID`
- `MALFORMED_LINE`
- `UNKNOWN_COMMAND`
- `INVALID_ARGUMENT_KIND`
- `INVALID_ARGUMENT_COUNT`
- `DUPLICATE_STATEMENT_ID`
- `CONSTRUCTOR_REQUIRED_FIRST`
- `UNKNOWN_FIELD`
- `INVALID_FIELD_FOR_OBJECT`
- `UNRESOLVED_REFERENCE`
- `MISSING_REQUIRED_FIELD`
- `INVALID_ACT_VALUE`
- `INVALID_ROLE_VALUE`
- `INVALID_RELATION_VALUE`
- `INCOMPLETE_SYMBOLIC_FACT`
- `CLAIM_AND_PROCEDURE_CONFLICT`
- `INVALID_CONFIDENCE_VALUE`
- `INVALID_STATUS_TRANSITION`

## Common Parsing Rules

- one statement per logical line
- first token is the statement id
- second token is the command
- remaining tokens are arguments
- free text must be quoted
- lists use square brackets
- references start with `$`
- blank lines are ignored
- constructors must appear before statements that
  reference them

## Command Validation Rules

The validator MUST:

- reject unknown commands
- reject wrong arity for any constructor or relation
- validate that `set` uses a legal field for the
  referenced object kind
- validate that list-valued fields actually receive
  lists
- validate enum atoms against DS004 and DS005 when
  they are present

## Intent Document Rules

For `documentKind: "intent"`:

- at least one `intent` constructor must exist
- every intent must have an `output`
- `act` must be from DS004
- only intent/seed/subproblem/validation-related
  commands are allowed unless the document is
  explicitly mixed

## Context Document Rules

For `documentKind: "context"`:

- at least one `ku` constructor must exist
- every KU must have `sourceId`, `chunkId`, `role`,
  and `topic`
- every KU must have exactly one of `claim` or
  `procedure`
- `role` must be from DS005
- `confidence` is valid only with a complete
  symbolic triple

## Mixed Document Rules

For `documentKind: "mixed"`:

- any constructor family may appear
- all object-specific invariants still apply

## Output of Validation

After successful validation:

- the parser output is safe to hand to the
  interpreter
- the interpreter may still reject semantic
  conflicts, but it should not need to re-check
  lexical syntax or command arity

## Dependencies

- DS004 — pragmatic act enum
- DS005 — KU role enum and KU field semantics
- DS031 — language surface
- DS032 — semantic interpreter
