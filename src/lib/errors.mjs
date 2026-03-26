// Structured error for MRP-VM (DS001 error model)
export class MRPError extends Error {
  constructor(code, module, message, details = {}) {
    super(message);
    this.code = code;
    this.module = module;
    this.details = details;
    this.requestId = null;
    this.sessionId = null;
    this.timestamp = new Date().toISOString();
  }

  toJSON() {
    return {
      code: this.code,
      module: this.module,
      message: this.message,
      details: this.details,
      requestId: this.requestId,
      sessionId: this.sessionId,
      timestamp: this.timestamp
    };
  }
}

// HTTP status mapping per DS001
const STATUS_MAP = [
  [/_VALIDATION_/, 400],
  [/_NOT_FOUND$/, 404],
  [/_TIMEOUT$/, 504],
  [/_EXPIRED$/, 410],
  [/_INTERNAL_/, 500]
];

export function httpStatusForCode(code) {
  for (const [re, status] of STATUS_MAP) {
    if (re.test(code)) return status;
  }
  return 500;
}
