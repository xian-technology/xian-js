import { describe, expect, it, vi } from "vitest";

import { NonceReservationManager } from "../src/internal/nonce-reservation";
import type { NonceScope, NonceSubmission } from "../src/internal/nonce-reservation";
import type { XianNumber } from "../src/index";

const scope = { chainId: "local", sender: "alice" };
const admitted = { submitted: true, accepted: true, finalized: false };

class UnresolvedNonce extends Error {
  constructor(readonly details: NonceScope & { nonce: XianNumber }) {
    super("unresolved nonce");
  }
}

function manager() {
  return new NonceReservationManager({
    invalidNonce: (message) => new RangeError(message),
    unresolved: (details) => new UnresolvedNonce(details)
  });
}

function send(
  reservations: NonceReservationManager,
  readNetworkNonce = async (): Promise<XianNumber> => 7,
  submission: NonceSubmission = admitted,
  nonceScope = scope
) {
  return reservations.send(nonceScope, {
    readNetworkNonce,
    prepare: async ({ nonce }) => nonce,
    broadcast: async (nonce) => ({ ...submission, nonce })
  });
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

describe("shared automatic nonce lifecycle", () => {
  it("advances a nonce after admission without fetching the network again", async () => {
    const reservations = manager();
    const network = vi.fn(async () => 7);
    expect((await send(reservations, network)).nonce).toBe(7);
    expect((await send(reservations, network)).nonce).toBe(8);
    expect(network).toHaveBeenCalledTimes(1);
  });

  it.each([
    { submitted: false, accepted: null, finalized: false },
    { submitted: true, accepted: false, finalized: false },
    { submitted: true, accepted: false, finalized: true }
  ])("re-reads the network after definite rejection: %j", async (submission) => {
    const reservations = manager();
    await send(reservations, async () => 7, submission);
    expect((await send(reservations, async () => 12)).nonce).toBe(12);
  });

  it("consumes a finalized nonce even without separate admission evidence", async () => {
    const reservations = manager();
    await send(reservations, async () => 7, { submitted: true, accepted: null, finalized: true });
    expect((await send(reservations)).nonce).toBe(8);
  });

  it("quarantines an acknowledgement until network evidence advances past its nonce", async () => {
    const reservations = manager();
    const submission = { submitted: true, accepted: null, finalized: false };
    expect((await send(reservations, async () => 7, submission)).nonce).toBe(7);
    for (const nonce of [6, 7]) {
      await expect(send(reservations, async () => nonce)).rejects.toMatchObject({
        details: { ...scope, nonce: 7 }
      });
    }
    expect((await send(reservations, async () => 8)).nonce).toBe(8);
    expect((await send(reservations)).nonce).toBe(9);
  });

  it("preserves broadcast error identity and quarantines the uncertain nonce", async () => {
    const reservations = manager();
    const failure = new Error("connection reset");
    await expect(reservations.send(scope, {
      readNetworkNonce: async () => 7,
      prepare: async ({ nonce }) => nonce,
      broadcast: async () => { throw failure; }
    })).rejects.toBe(failure);
    await expect(send(reservations)).rejects.toBeInstanceOf(UnresolvedNonce);
  });

  it("reuses a nonce after a preparation error and preserves that error", async () => {
    const reservations = manager();
    const failure = new Error("signature declined");
    const broadcast = vi.fn();
    await expect(reservations.send(scope, {
      readNetworkNonce: async () => 7,
      prepare: async () => { throw failure; },
      broadcast
    })).rejects.toBe(failure);
    expect(broadcast).not.toHaveBeenCalled();
    expect((await send(reservations, async () => 99)).nonce).toBe(7);
  });

  it("releases the scope lock after a failed network lookup", async () => {
    const reservations = manager();
    const failure = new Error("RPC unavailable");
    await expect(send(reservations, async () => { throw failure; })).rejects.toBe(failure);
    expect((await send(reservations)).nonce).toBe(7);
  });

  it("serializes the entire send for one scope, while other scopes proceed", async () => {
    const reservations = manager();
    const entered = deferred();
    const release = deferred();
    const events: string[] = [];
    const first = reservations.send(scope, {
      readNetworkNonce: async () => 7,
      prepare: async ({ nonce }) => { events.push("first prepare"); entered.resolve(); await release.promise; return nonce; },
      broadcast: async (nonce) => { events.push("first broadcast"); return { ...admitted, nonce }; }
    });
    await entered.promise;
    const prepareSecond = vi.fn(async ({ nonce }: { nonce: XianNumber }) => nonce);
    const second = reservations.send(scope, {
      readNetworkNonce: async () => 7,
      prepare: prepareSecond,
      broadcast: async (nonce) => ({ ...admitted, nonce })
    });
    expect((await send(reservations, async () => 20, admitted, { ...scope, sender: "bob" })).nonce).toBe(20);
    expect(prepareSecond).not.toHaveBeenCalled();
    release.resolve();
    expect((await first).nonce).toBe(7);
    expect((await second).nonce).toBe(8);
    expect(events).toEqual(["first prepare", "first broadcast"]);
  });

  it("keeps nonce scopes and manager owners independent, including delimiter collisions", async () => {
    const reservations = manager();
    expect((await send(reservations, async () => 3, admitted, { chainId: "a:b", sender: "c" })).nonce).toBe(3);
    expect((await send(reservations, async () => 4, admitted, { chainId: "a", sender: "b:c" })).nonce).toBe(4);
    expect((await send(manager(), async () => 5)).nonce).toBe(5);
  });

  it("resets a reconciled quarantine and re-reads the network", async () => {
    const reservations = manager();
    await send(reservations, async () => 7, { submitted: true, accepted: null, finalized: false });
    await reservations.reset(scope);
    expect((await send(reservations, async () => 7)).nonce).toBe(7);
  });

  it("does not invalidate an active reservation when resetting local state", async () => {
    const reservations = manager();
    const entered = deferred();
    const release = deferred();
    const first = reservations.send(scope, {
      readNetworkNonce: async () => 7,
      prepare: async ({ nonce }) => { entered.resolve(); await release.promise; return nonce; },
      broadcast: async (nonce) => ({ ...admitted, nonce })
    });
    await entered.promise;
    await reservations.reset(scope);
    release.resolve();
    expect((await first).nonce).toBe(7);
    expect((await send(reservations, async () => 8)).nonce).toBe(8);
  });

  it.each([0, 0n, 1, 1n])("accepts small valid network nonce %s", async (nonce) => {
    expect((await send(manager(), async () => nonce)).nonce).toBe(Number(nonce));
  });

  it("applies a reset queued during a network lookup after that lookup", async () => {
    const reservations = manager();
    const entered = deferred();
    const release = deferred();
    const first = send(reservations, async () => {
      entered.resolve();
      await release.promise;
      return 7;
    });
    await entered.promise;
    const reset = reservations.reset(scope);
    release.resolve();
    await reset;
    expect((await first).nonce).toBe(7);
    expect((await send(reservations, async () => 20)).nonce).toBe(20);
  });

  it("preserves a reset when preparation subsequently fails", async () => {
    const reservations = manager();
    const failure = new Error("observer failed");
    await expect(reservations.send(scope, {
      readNetworkNonce: async () => 7,
      prepare: async () => { await reservations.reset(scope); throw failure; },
      broadcast: async () => admitted
    })).rejects.toBe(failure);
    expect((await send(reservations, async () => 20)).nonce).toBe(20);
  });

  it.each([-1, -1n, 0.5, Number.MAX_SAFE_INTEGER + 1, NaN])("rejects invalid network nonce %s with the supplied error type", async (nonce) => {
    await expect(send(manager(), async () => nonce)).rejects.toBeInstanceOf(RangeError);
  });

  it("keeps large nonces exact and uses numbers while safely representable", async () => {
    const reservations = manager();
    const limit = BigInt(Number.MAX_SAFE_INTEGER);
    expect((await send(reservations, async () => limit)).nonce).toBe(Number(limit));
    expect((await send(reservations)).nonce).toBe(limit + 1n);
  });
});
