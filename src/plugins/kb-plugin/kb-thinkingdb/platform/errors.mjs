// SDK-local structured error to keep mrp-vm-sdk decoupled from core/platform.
export class SDKError extends Error {
  constructor(code, module, message, details = {}) {
    super(message);
    this.code = code;
    this.module = module;
    this.details = details;
  }
}
