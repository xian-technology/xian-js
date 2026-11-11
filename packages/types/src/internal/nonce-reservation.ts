import type { XianNumber } from "../index.js";

export interface NonceScope {
  chainId: string;
  sender: string;
}

export interface NonceReservation {
  nonce: XianNumber;
  scope: NonceScope;
}

export interface NonceSubmission {
  submitted: boolean;
  accepted: boolean | null;
  finalized: boolean;
}

export interface NonceReservationErrors {
  invalidNonce(message: string): Error;
  unresolved(options: NonceScope & { nonce: XianNumber }): Error;
}

interface SendOperations<Prepared, Submission extends NonceSubmission> {
  readNetworkNonce(): Promise<XianNumber>;
  prepare(reservation: NonceReservation): Promise<Prepared>;
  broadcast(prepared: Prepared): Promise<Submission>;
}

interface NonceState {
  tail: Promise<void>;
  sendTail: Promise<void>;
  next?: bigint;
  quarantined?: bigint;
}

function scopeKey(scope: NonceScope): string {
  return `${scope.chainId.length}:${scope.chainId}:${scope.sender}`;
}

function toBigInt(value: XianNumber, errors: NonceReservationErrors): bigint {
  if (typeof value === "bigint") {
    if (value < 0n) {
      throw errors.invalidNonce("network nonce must be a non-negative integer");
    }
    return value;
  }
  if (!Number.isSafeInteger(value) || value < 0) {
    throw errors.invalidNonce("network nonce must be a non-negative safe integer");
  }
  return BigInt(value);
}

function toXianNumber(value: bigint): XianNumber {
  return value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : value;
}

/** Per-owner nonce coordination. Explicit nonces never enter this lifecycle. */
export class NonceReservationManager {
  private readonly states = new Map<string, NonceState>();

  constructor(private readonly errors: NonceReservationErrors) {}

  async send<Prepared, Submission extends NonceSubmission>(
    scope: NonceScope,
    operations: SendOperations<Prepared, Submission>
  ): Promise<Submission> {
    return this.runExclusive(scope, async () => {
      const reservation = await this.reserve(scope, operations.readNetworkNonce);
      const prepared = await this.prepareReservation(reservation, operations.prepare);
      let submission: Submission;
      try {
        submission = await operations.broadcast(prepared);
      } catch (error) {
        await this.quarantine(reservation);
        throw error;
      }
      await this.settle(reservation, submission);
      return submission;
    });
  }

  /** Reset can interleave with preparation, but waits for an active nonce read. */
  async reset(scope: NonceScope): Promise<void> {
    await this.withState(scope, (state) => {
      state.next = undefined;
      state.quarantined = undefined;
    });
  }

  private async prepareReservation<Prepared>(
    reservation: NonceReservation,
    prepare: (reservation: NonceReservation) => Promise<Prepared>
  ): Promise<Prepared> {
    try {
      return await prepare(reservation);
    } catch (error) {
      await this.withState(reservation.scope, (state) => {
        // A concurrent explicit reset must keep its request to re-read the network.
        if (state.next !== undefined) {
          state.next = toBigInt(reservation.nonce, this.errors);
        }
      });
      throw error;
    }
  }

  private async settle(
    reservation: NonceReservation,
    submission: NonceSubmission
  ): Promise<void> {
    if (!submission.submitted || submission.accepted === false) {
      await this.withState(reservation.scope, (state) => {
        state.next = undefined;
      });
    } else if (submission.accepted == null && !submission.finalized) {
      await this.quarantine(reservation);
    }
  }

  private async runExclusive<T>(scope: NonceScope, operation: () => Promise<T>): Promise<T> {
    const state = this.state(scope);
    const previous = state.sendTail;
    let unlock!: () => void;
    const current = new Promise<void>((resolve) => {
      unlock = resolve;
    });
    state.sendTail = current;
    await previous;
    try {
      return await operation();
    } finally {
      unlock();
    }
  }

  private async reserve(
    scope: NonceScope,
    readNetworkNonce: () => Promise<XianNumber>
  ): Promise<NonceReservation> {
    return this.withState(scope, async (state) => {
      if (state.quarantined !== undefined) {
        const networkNonce = toBigInt(await readNetworkNonce(), this.errors);
        if (networkNonce <= state.quarantined) {
          throw this.errors.unresolved({
            ...scope,
            nonce: toXianNumber(state.quarantined)
          });
        }
        state.quarantined = undefined;
        state.next = networkNonce;
      } else if (state.next === undefined) {
        state.next = toBigInt(await readNetworkNonce(), this.errors);
      }

      const nonce = state.next;
      state.next = nonce + 1n;
      return { nonce: toXianNumber(nonce), scope };
    });
  }

  private async quarantine(reservation: NonceReservation): Promise<void> {
    await this.withState(reservation.scope, (state) => {
      state.quarantined = toBigInt(reservation.nonce, this.errors);
      state.next = undefined;
    });
  }

  private state(scope: NonceScope): NonceState {
    const key = scopeKey(scope);
    let state = this.states.get(key);
    if (!state) {
      state = { tail: Promise.resolve(), sendTail: Promise.resolve() };
      this.states.set(key, state);
    }
    return state;
  }

  // State reads and explicit resets serialize separately from the full send so a
  // reset during a slow network read is applied after that read, before broadcast.
  private async withState<T>(
    scope: NonceScope,
    operation: (state: NonceState) => T | Promise<T>
  ): Promise<T> {
    const state = this.state(scope);
    const previous = state.tail;
    let unlock!: () => void;
    state.tail = new Promise<void>((resolve) => {
      unlock = resolve;
    });
    await previous;
    try {
      return await operation(state);
    } finally {
      unlock();
    }
  }
}
