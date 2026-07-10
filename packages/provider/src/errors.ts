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

export class ProviderNonceReservationError extends XianProviderError {
  readonly sender: string;
  readonly chainId: string;
  readonly nonce: number | bigint;

  constructor(options: {
    sender: string;
    chainId: string;
    nonce: number | bigint;
  }) {
    super(
      -32000,
      `automatic nonce ${String(options.nonce)} for ${options.sender} on ` +
        `${options.chainId} has an ambiguous broadcast outcome; wait for the ` +
        "network nonce to advance or explicitly reset the nonce reservation",
      options
    );
    this.sender = options.sender;
    this.chainId = options.chainId;
    this.nonce = options.nonce;
  }
}
