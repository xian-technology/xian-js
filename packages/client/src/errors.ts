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

export class TxTimeoutError extends XianClientError {}
