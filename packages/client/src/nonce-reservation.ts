import { NonceReservationError, TransactionError } from "./errors.js";
import type { XianNumber } from "./types.js";

export interface NonceScope {
  chainId: string;
  sender: string;
}

export interface NonceReservation {
  nonce: XianNumber;
  scope: NonceScope;
}

interface NonceState {
  tail: Promise<void>;
  next?: bigint;
  quarantined?: bigint;
  readonly reserved: Set<bigint>;
  readonly reusable: Set<bigint>;
}

function scopeKey(scope: NonceScope): string {
  return `${scope.chainId.length}:${scope.chainId}:${scope.sender}`;
}

function toBigInt(value: XianNumber): bigint {
  if (typeof value === "bigint") {
    if (value < 0n) {
      throw new TransactionError("network nonce must be a non-negative integer");
    }
    return value;
  }
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TransactionError("network nonce must be a non-negative safe integer");
  }
  return BigInt(value);
}

function toXianNumber(value: bigint): XianNumber {
  return value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : value;
}

function lowest(values: Set<bigint>): bigint | undefined {
  let result: bigint | undefined;
  for (const value of values) {
    if (result === undefined || value < result) {
      result = value;
    }
  }
  return result;
}

/** Per-client automatic nonce coordination. Explicit nonces never enter here. */
export class NonceReservationManager {
  private readonly states = new Map<string, NonceState>();
  private readonly sendTails = new Map<string, Promise<void>>();

  async runExclusive<T>(scope: NonceScope, operation: () => Promise<T>): Promise<T> {
    const key = scopeKey(scope);
    const previous = this.sendTails.get(key) ?? Promise.resolve();
    let unlock!: () => void;
    const current = new Promise<void>((resolve) => {
      unlock = resolve;
    });
    this.sendTails.set(key, current);
    await previous;
    try {
      return await operation();
    } finally {
      unlock();
      if (this.sendTails.get(key) === current) {
        this.sendTails.delete(key);
      }
    }
  }

  async reserve(
    scope: NonceScope,
    readNetworkNonce: () => Promise<XianNumber>
  ): Promise<NonceReservation> {
    return this.withState(scope, async (state) => {
      if (state.quarantined !== undefined) {
        const networkNonce = toBigInt(await readNetworkNonce());
        if (networkNonce <= state.quarantined) {
          throw new NonceReservationError({
            ...scope,
            nonce: toXianNumber(state.quarantined)
          });
        }
        state.quarantined = undefined;
        state.next = networkNonce;
        state.reusable.clear();
      } else if (state.next === undefined) {
        state.next = toBigInt(await readNetworkNonce());
        state.reusable.clear();
      }

      let nonce = lowest(state.reusable) ?? state.next;
      state.reusable.delete(nonce);
      while (state.reserved.has(nonce)) {
        nonce += 1n;
      }
      if (nonce >= state.next) {
        state.next = nonce + 1n;
      }
      state.reserved.add(nonce);
      return { nonce: toXianNumber(nonce), scope };
    });
  }

  async assertCanBroadcast(reservation: NonceReservation): Promise<void> {
    await this.withState(reservation.scope, (state) => {
      if (state.quarantined !== undefined) {
        throw new NonceReservationError({
          ...reservation.scope,
          nonce: toXianNumber(state.quarantined)
        });
      }
    });
  }

  async release(reservation: NonceReservation): Promise<void> {
    await this.withState(reservation.scope, (state) => {
      const nonce = toBigInt(reservation.nonce);
      if (!state.reserved.delete(nonce) || state.quarantined !== undefined) {
        return;
      }
      state.reusable.add(nonce);
      while (state.next !== undefined && state.next > 0n) {
        const previous = state.next - 1n;
        if (state.reserved.has(previous) || !state.reusable.delete(previous)) {
          break;
        }
        state.next = previous;
      }
    });
  }

  async confirm(reservation: NonceReservation): Promise<void> {
    await this.withState(reservation.scope, (state) => {
      state.reserved.delete(toBigInt(reservation.nonce));
    });
  }

  async reject(reservation: NonceReservation): Promise<void> {
    await this.withState(reservation.scope, (state) => {
      state.reserved.delete(toBigInt(reservation.nonce));
      state.next = undefined;
      state.reusable.clear();
    });
  }

  async quarantine(reservation: NonceReservation): Promise<void> {
    await this.withState(reservation.scope, (state) => {
      const nonce = toBigInt(reservation.nonce);
      state.reserved.delete(nonce);
      if (state.quarantined === undefined || nonce > state.quarantined) {
        state.quarantined = nonce;
      }
      state.next = undefined;
      state.reusable.clear();
    });
  }

  async reset(scope: NonceScope): Promise<void> {
    await this.withState(scope, (state) => {
      state.next = undefined;
      state.quarantined = undefined;
      state.reusable.clear();
    });
  }

  private state(scope: NonceScope): NonceState {
    const key = scopeKey(scope);
    let state = this.states.get(key);
    if (!state) {
      state = {
        tail: Promise.resolve(),
        reserved: new Set<bigint>(),
        reusable: new Set<bigint>()
      };
      this.states.set(key, state);
    }
    return state;
  }

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
