export class XianClientError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = new.target.name;
  }
}

export class TransportError extends XianClientError {}

export class RpcError extends XianClientError {
  readonly details?: unknown;

  constructor(message: string, details?: unknown, options?: { cause?: unknown }) {
    super(message, options);
    this.details = details;
  }
}

export class AbciError extends XianClientError {
  readonly details?: unknown;

  constructor(message: string, details?: unknown, options?: { cause?: unknown }) {
    super(message, options);
    this.details = details;
  }
}

export class SimulationError extends XianClientError {
  readonly details?: unknown;

  constructor(message: string, details?: unknown, options?: { cause?: unknown }) {
    super(message, options);
    this.details = details;
  }
}

export class TransactionError extends XianClientError {}

export class NonceReservationError extends TransactionError {
  readonly sender: string;
  readonly chainId: string;
  readonly nonce: number | bigint;

  constructor(options: {
    sender: string;
    chainId: string;
    nonce: number | bigint;
  }) {
    super(
      `automatic nonce ${String(options.nonce)} for ${options.sender} on ` +
        `${options.chainId} has an ambiguous broadcast outcome; wait for the ` +
        "network nonce to advance or explicitly reset the nonce reservation"
    );
    this.sender = options.sender;
    this.chainId = options.chainId;
    this.nonce = options.nonce;
  }
}

export class TxTimeoutError extends XianClientError {}
