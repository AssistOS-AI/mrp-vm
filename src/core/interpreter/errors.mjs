import { MRPError } from '../platform/errors.mjs';

const MOD = 'interpreter';

export class SOPError extends MRPError {
  constructor(code, message, location = null, details = {}) {
    super(code, MOD, message, {
      ...details,
      line: location?.line ?? null,
      column: location?.column ?? null
    });
    this.line = location?.line ?? null;
    this.column = location?.column ?? null;
  }
}

export class SOPLexicalError extends SOPError {
  constructor(message, location = null, details = {}) {
    super('MALFORMED_LINE', message, location, details);
  }
}

export class SOPParseError extends SOPError {
  constructor(code, message, location = null, details = {}) {
    super(code, message, location, details);
  }
}

export class SOPValidationError extends SOPError {
  constructor(message, errors = [], details = {}) {
    super(
      'SOP_VALIDATION_FAILED',
      message,
      errors[0]
        ? {
            line: errors[0].line ?? null,
            column: errors[0].column ?? null
          }
        : null,
      {
        ...details,
        errors
      }
    );
    this.errors = errors;
  }
}

export class SOPInterpretationError extends SOPError {
  constructor(code, message, location = null, details = {}) {
    super(code, message, location, details);
  }
}

