export class XianProviderError extends Error {
  readonly code: number;
  readonly data?: unknown;

  constructor(code: number, message: string, data?: unknown) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.data = data;
  }
}

export class ProviderDisconnectedError extends XianProviderError {
  constructor(message = "provider is disconnected") {
    super(4900, message);
  }
}

export class ProviderChainMismatchError extends XianProviderError {
  constructor(message = "provider is connected to a different chain") {
    super(4901, message);
  }
}

export class ProviderUnauthorizedError extends XianProviderError {
  constructor(message = "provider is not authorized") {
    super(4100, message);
  }
}

export class ProviderUnsupportedMethodError extends XianProviderError {
  constructor(method: string) {
    super(4200, `unsupported provider method: ${method}`);
  }
}
