import { describe, expect, it, vi } from "vitest";

import {
  ProviderNonceReservationError,
  InMemoryXianProvider
} from "../src/index";
import type {
  TransactionSubmission,
  XianProviderClient,
  XianSigner,
  XianUnsignedTransaction
} from "../src/provider";

function signer(address: string): XianSigner {
  return {
    getAddress: () => address,
    signMessage: () => "b".repeat(128)
  };
}

function transaction(
  sender: string,
  chainId: string,
  nonce: number,
  to = "bob"
): XianUnsignedTransaction {
  return {
    payload: {
      chain_id: chainId,
      contract: "currency",
      function: "transfer",
      kwargs: { to, amount: 1 },
      nonce,
      sender,
      chi_supplied: 100
    }
  };
}

function submission(
  nonce: number | bigint,
  accepted: boolean | null = true
): TransactionSubmission {
  return {
    submitted: true,
    accepted,
    finalized: false,
    txHash: `hash-${String(nonce)}`,
    mode: "checktx",
    nonce,
    chiSupplied: 100,
    response: {}
  };
}

function sendCall(provider: InMemoryXianProvider, to = "bob") {
  return provider.request({
    method: "xian_sendCall",
    params: [
      {
        intent: {
          contract: "currency",
          function: "transfer",
          kwargs: { to, amount: 1 },
          chi: 100
        },
        mode: "checktx"
      }
    ]
  });
}

function clientFor(options: {
  networkNonce: () => number;
  observed: Array<number | bigint>;
  onSign?: XianProviderClient["signTx"];
  onBroadcast?: XianProviderClient["broadcastTx"];
  onNetworkRead?: () => void;
}): XianProviderClient {
  return {
    getChainId: vi.fn(async () => "chain-a"),
    buildTx: vi.fn(async (request) => {
      if (request.nonce == null) {
        options.onNetworkRead?.();
        await Promise.resolve();
      }
      return {
        payload: {
          chain_id: request.chainId ?? "chain-a",
          contract: request.contract,
          function: request.function,
          kwargs: request.kwargs,
          nonce: request.nonce ?? options.networkNonce(),
          sender: request.sender,
          chi_supplied: request.chiSupplied ?? request.chi ?? 100
        }
      };
    }),
    signTx:
      options.onSign ??
      vi.fn(async (tx) => ({
        payload: tx.payload,
        metadata: { signature: "c".repeat(128) }
      })),
    broadcastTx:
      options.onBroadcast ??
      vi.fn(async (tx) => {
        options.observed.push(tx.payload.nonce);
        return submission(tx.payload.nonce);
      })
  };
}

describe("InMemoryXianProvider automatic nonce reservations", () => {
  it("reserves distinct nonces for concurrent intent sends", async () => {
    const address = "a".repeat(64);
    const observed: Array<number | bigint> = [];
    let networkReads = 0;
    let signAttempts = 0;
    let releaseFirstSignature!: () => void;
    let markFirstSigning!: () => void;
    const firstSignatureGate = new Promise<void>((resolve) => {
      releaseFirstSignature = resolve;
    });
    const firstSigningStarted = new Promise<void>((resolve) => {
      markFirstSigning = resolve;
    });
    const onSign = vi.fn(async (tx) => {
      signAttempts += 1;
      if (signAttempts === 1) {
        markFirstSigning();
        await firstSignatureGate;
      }
      return { payload: tx.payload, metadata: { signature: "c".repeat(128) } };
    });
    const client = clientFor({
      networkNonce: () => 7,
      observed,
      onSign,
      onNetworkRead: () => {
        networkReads += 1;
      }
    });
    const provider = new InMemoryXianProvider({ signer: signer(address), client });
    await provider.request({ method: "xian_connect" });

    const sends = Promise.all([sendCall(provider, "bob"), sendCall(provider, "carol")]);
    await firstSigningStarted;
    await Promise.resolve();

    expect(signAttempts).toBe(1);
    expect(observed).toEqual([]);
    releaseFirstSignature();
    await sends;

    expect(observed).toEqual([7, 8]);
    expect(networkReads).toBe(1);
  });

  it("reuses a nonce after explicit CheckTx rejection", async () => {
    const address = "a".repeat(64);
    const observed: Array<number | bigint> = [];
    let networkReads = 0;
    const onBroadcast = vi.fn(async (tx) => {
      observed.push(tx.payload.nonce);
      return submission(tx.payload.nonce, observed.length === 1 ? false : true);
    });
    const client = clientFor({
      networkNonce: () => 7,
      observed,
      onBroadcast,
      onNetworkRead: () => {
        networkReads += 1;
      }
    });
    const provider = new InMemoryXianProvider({ signer: signer(address), client });
    await provider.request({ method: "xian_connect" });

    await expect(sendCall(provider)).resolves.toMatchObject({ accepted: false, nonce: 7 });
    await expect(sendCall(provider)).resolves.toMatchObject({ accepted: true, nonce: 7 });

    expect(observed).toEqual([7, 7]);
    expect(networkReads).toBe(2);
  });

  it("releases a nonce after signing fails before broadcast", async () => {
    const address = "a".repeat(64);
    const observed: Array<number | bigint> = [];
    let networkReads = 0;
    let signAttempts = 0;
    const onSign = vi.fn(async (tx) => {
      signAttempts += 1;
      if (signAttempts === 1) {
        throw new Error("wallet locked during signing");
      }
      return { payload: tx.payload, metadata: { signature: "c".repeat(128) } };
    });
    const client = clientFor({
      networkNonce: () => 9,
      observed,
      onSign,
      onNetworkRead: () => {
        networkReads += 1;
      }
    });
    const provider = new InMemoryXianProvider({ signer: signer(address), client });
    await provider.request({ method: "xian_connect" });

    const results = await Promise.allSettled([
      sendCall(provider, "bob"),
      sendCall(provider, "carol")
    ]);

    expect(results[0]).toMatchObject({
      status: "rejected",
      reason: { message: "wallet locked during signing" }
    });
    expect(results[1]).toMatchObject({ status: "fulfilled", value: { nonce: 9 } });
    expect(observed).toEqual([9]);
    expect(networkReads).toBe(1);
  });

  it("quarantines ambiguous broadcasts until the network nonce advances", async () => {
    const address = "a".repeat(64);
    const observed: Array<number | bigint> = [];
    let networkNonce = 12;
    let broadcasts = 0;
    const onBroadcast = vi.fn(async (tx) => {
      broadcasts += 1;
      observed.push(tx.payload.nonce);
      if (broadcasts === 1) {
        throw new Error("connection reset");
      }
      return submission(tx.payload.nonce);
    });
    const client = clientFor({ networkNonce: () => networkNonce, observed, onBroadcast });
    const provider = new InMemoryXianProvider({ signer: signer(address), client });
    await provider.request({ method: "xian_connect" });

    await expect(sendCall(provider)).rejects.toThrow("connection reset");
    await expect(sendCall(provider)).rejects.toBeInstanceOf(ProviderNonceReservationError);
    expect(broadcasts).toBe(1);

    networkNonce = 13;
    await expect(sendCall(provider)).resolves.toMatchObject({ nonce: 13 });
    expect(observed).toEqual([12, 13]);
  });

  it("lets prebuilt transactions bypass quarantine and supports deliberate reset", async () => {
    const address = "a".repeat(64);
    const observed: Array<number | bigint> = [];
    let failBroadcast = true;
    const onBroadcast = vi.fn(async (tx) => {
      observed.push(tx.payload.nonce);
      if (failBroadcast) {
        failBroadcast = false;
        throw new Error("timed out");
      }
      return submission(tx.payload.nonce);
    });
    const client = clientFor({ networkNonce: () => 21, observed, onBroadcast });
    const provider = new InMemoryXianProvider({ signer: signer(address), client });
    await provider.request({ method: "xian_connect" });

    await expect(sendCall(provider)).rejects.toThrow("timed out");
    await expect(
      provider.request({
        method: "xian_sendTransaction",
        params: [{ tx: transaction(address, "chain-a", 44), mode: "checktx" }]
      })
    ).resolves.toMatchObject({ nonce: 44 });
    await expect(sendCall(provider)).rejects.toBeInstanceOf(ProviderNonceReservationError);

    await provider.resetNonceReservation();
    await expect(sendCall(provider)).resolves.toMatchObject({ nonce: 21 });
    expect(observed).toEqual([21, 44, 21]);
  });

  it("isolates reservations by sender, chain, and provider instance", async () => {
    const senderA = "a".repeat(64);
    const senderB = "b".repeat(64);
    const firstObserved: Array<number | bigint> = [];
    const secondObserved: Array<number | bigint> = [];
    const thirdObserved: Array<number | bigint> = [];
    let firstReads = 0;
    const firstClient = clientFor({
      networkNonce: () => 5,
      observed: firstObserved,
      onNetworkRead: () => {
        firstReads += 1;
      }
    });
    const secondClient = clientFor({ networkNonce: () => 30, observed: secondObserved });
    const thirdClient = clientFor({ networkNonce: () => 5, observed: thirdObserved });
    const first = new InMemoryXianProvider({ signer: signer(senderA), client: firstClient });
    const second = new InMemoryXianProvider({ signer: signer(senderB), client: secondClient });
    const third = new InMemoryXianProvider({ signer: signer(senderA), client: thirdClient });
    await Promise.all([
      first.request({ method: "xian_connect" }),
      second.request({ method: "xian_connect" }),
      third.request({ method: "xian_connect" })
    ]);

    await sendCall(first);
    await first.request({ method: "xian_switchChain", params: [{ chainId: "chain-b" }] });
    await sendCall(first);
    await sendCall(second);
    await sendCall(third);

    expect(firstObserved).toEqual([5, 5]);
    expect(secondObserved).toEqual([30]);
    expect(thirdObserved).toEqual([5]);
    expect(firstReads).toBe(2);
  });
});
