import { describe, expect, it, vi } from "vitest";

import {
  bytesToUtf8,
  decodeRuntime,
  hexToBytes
} from "../src/encoding";
import {
  NonceReservationError,
  TransportError,
  TxTimeoutError,
  XianClient
} from "../src/index";
import type {
  XianSignedTransaction,
  XianSigner
} from "../src/types";

function jsonResponse(value: Record<string, unknown>): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
}

function nonceResponse(nonce: number): Response {
  return jsonResponse({
    result: {
      response: {
        code: 0,
        value: btoa(String(nonce))
      }
    }
  });
}

function acceptedResponse(hash: string): Response {
  return jsonResponse({ result: { hash, code: 0 } });
}

function decodeBroadcast(input: string | URL): XianSignedTransaction {
  const url = new URL(String(input));
  const encoded = JSON.parse(url.searchParams.get("tx") ?? '""') as string;
  const transaction = decodeRuntime<XianSignedTransaction>(
    bytesToUtf8(hexToBytes(encoded))
  );
  if (!transaction) {
    throw new Error("broadcast transaction did not decode");
  }
  return transaction;
}

function signer(address: string, signMessage?: XianSigner["signMessage"]): XianSigner {
  return {
    getAddress: () => address,
    signMessage: signMessage ?? (() => "b".repeat(128))
  };
}

function send(
  client: XianClient,
  sender: string,
  transactionSigner: XianSigner,
  options?: { chainId?: string; nonce?: number; to?: string }
) {
  return client.sendTx({
    sender,
    signer: transactionSigner,
    chainId: options?.chainId ?? "chain-a",
    nonce: options?.nonce,
    contract: "currency",
    function: "transfer",
    kwargs: { to: options?.to ?? "bob", amount: 1 },
    chi: 100,
    mode: "checktx"
  });
}

describe("XianClient automatic nonce reservations", () => {
  it("reserves distinct nonces for concurrent sends", async () => {
    const sender = "a".repeat(64);
    const observed: Array<number | bigint> = [];
    let nonceReads = 0;
    let signAttempts = 0;
    let releaseFirstSignature!: () => void;
    let markFirstSigning!: () => void;
    const firstSignatureGate = new Promise<void>((resolve) => {
      releaseFirstSignature = resolve;
    });
    const firstSigningStarted = new Promise<void>((resolve) => {
      markFirstSigning = resolve;
    });
    const transactionSigner = signer(sender, async () => {
      signAttempts += 1;
      if (signAttempts === 1) {
        markFirstSigning();
        await firstSignatureGate;
      }
      return "b".repeat(128);
    });
    const fetchFn = vi.fn(async (input: string | URL) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/abci_query")) {
        nonceReads += 1;
        await Promise.resolve();
        return nonceResponse(7);
      }
      if (url.pathname.endsWith("/broadcast_tx_sync")) {
        observed.push(decodeBroadcast(input).payload.nonce);
        return acceptedResponse(`hash-${observed.length}`);
      }
      throw new Error(`unexpected URL: ${url}`);
    }) as typeof fetch;
    const client = new XianClient({ rpcUrl: "http://node", fetchFn });

    const sends = Promise.all([
      send(client, sender, transactionSigner, { to: "bob" }),
      send(client, sender, transactionSigner, { to: "carol" })
    ]);
    await firstSigningStarted;
    await Promise.resolve();

    expect(signAttempts).toBe(1);
    expect(observed).toEqual([]);
    releaseFirstSignature();
    await sends;

    expect(observed).toEqual([7, 8]);
    expect(nonceReads).toBe(1);
  });

  it("reuses a nonce after explicit CheckTx rejection", async () => {
    const sender = "a".repeat(64);
    const observed: Array<number | bigint> = [];
    let nonceReads = 0;
    const fetchFn = vi.fn(async (input: string | URL) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/abci_query")) {
        nonceReads += 1;
        return nonceResponse(7);
      }
      if (url.pathname.endsWith("/broadcast_tx_sync")) {
        observed.push(decodeBroadcast(input).payload.nonce);
        return observed.length === 1
          ? jsonResponse({ result: { hash: "rejected", code: 7, log: "bad nonce" } })
          : acceptedResponse("accepted");
      }
      throw new Error(`unexpected URL: ${url}`);
    }) as typeof fetch;
    const client = new XianClient({ rpcUrl: "http://node", fetchFn });

    await expect(send(client, sender, signer(sender))).resolves.toMatchObject({
      submitted: true,
      accepted: false,
      nonce: 7
    });
    await expect(send(client, sender, signer(sender))).resolves.toMatchObject({
      accepted: true,
      nonce: 7
    });

    expect(observed).toEqual([7, 7]);
    expect(nonceReads).toBe(2);
  });

  it("refreshes and reuses a nonce after a structured RPC rejection", async () => {
    const sender = "a".repeat(64);
    const observed: Array<number | bigint> = [];
    let nonceReads = 0;
    const fetchFn = vi.fn(async (input: string | URL) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/abci_query")) {
        nonceReads += 1;
        return nonceResponse(8);
      }
      if (url.pathname.endsWith("/broadcast_tx_sync")) {
        observed.push(decodeBroadcast(input).payload.nonce);
        return observed.length === 1
          ? jsonResponse({ error: { code: -32603, message: "not submitted" } })
          : acceptedResponse("accepted");
      }
      throw new Error(`unexpected URL: ${url}`);
    }) as typeof fetch;
    const client = new XianClient({ rpcUrl: "http://node", fetchFn });

    await expect(send(client, sender, signer(sender))).resolves.toMatchObject({
      submitted: false,
      nonce: 8
    });
    await expect(send(client, sender, signer(sender))).resolves.toMatchObject({
      accepted: true,
      nonce: 8
    });

    expect(observed).toEqual([8, 8]);
    expect(nonceReads).toBe(2);
  });

  it("releases a nonce when transaction building fails", async () => {
    const sender = "a".repeat(64);
    const observed: Array<number | bigint> = [];
    let nonceReads = 0;
    const fetchFn = vi.fn(async (input: string | URL) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/abci_query")) {
        nonceReads += 1;
        return nonceResponse(9);
      }
      if (url.pathname.endsWith("/broadcast_tx_sync")) {
        observed.push(decodeBroadcast(input).payload.nonce);
        return acceptedResponse("accepted");
      }
      throw new Error(`unexpected URL: ${url}`);
    }) as typeof fetch;
    const client = new XianClient({ rpcUrl: "http://node", fetchFn });

    const results = await Promise.allSettled([
      client.sendTx({
        sender,
        signer: signer(sender),
        chainId: "chain-a",
        contract: "not-valid",
        function: "transfer",
        kwargs: { to: "bob", amount: 1 },
        chi: 100
      }),
      send(client, sender, signer(sender))
    ]);

    expect(results[0]).toMatchObject({
      status: "rejected",
      reason: { message: "contract must be a valid identifier" }
    });
    expect(results[1]).toMatchObject({ status: "fulfilled", value: { nonce: 9 } });
    expect(observed).toEqual([9]);
    expect(nonceReads).toBe(1);
  });

  it("releases a nonce after signing fails before broadcast", async () => {
    const sender = "a".repeat(64);
    const observed: Array<number | bigint> = [];
    let nonceReads = 0;
    let signAttempts = 0;
    const transactionSigner = signer(sender, () => {
      signAttempts += 1;
      if (signAttempts === 1) {
        throw new Error("signing denied");
      }
      return "b".repeat(128);
    });
    const fetchFn = vi.fn(async (input: string | URL) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/abci_query")) {
        nonceReads += 1;
        return nonceResponse(9);
      }
      if (url.pathname.endsWith("/broadcast_tx_sync")) {
        observed.push(decodeBroadcast(input).payload.nonce);
        return acceptedResponse("accepted");
      }
      throw new Error(`unexpected URL: ${url}`);
    }) as typeof fetch;
    const client = new XianClient({ rpcUrl: "http://node", fetchFn });

    const results = await Promise.allSettled([
      send(client, sender, transactionSigner, { to: "bob" }),
      send(client, sender, transactionSigner, { to: "carol" })
    ]);

    expect(results[0]).toMatchObject({
      status: "rejected",
      reason: { message: "signing denied" }
    });
    expect(results[1]).toMatchObject({ status: "fulfilled", value: { nonce: 9 } });
    expect(observed).toEqual([9]);
    expect(nonceReads).toBe(1);
  });

  it("quarantines ambiguous broadcasts until the network nonce advances", async () => {
    const sender = "a".repeat(64);
    const observed: Array<number | bigint> = [];
    let networkNonce = 12;
    let broadcasts = 0;
    const fetchFn = vi.fn(async (input: string | URL) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/abci_query")) {
        return nonceResponse(networkNonce);
      }
      if (url.pathname.endsWith("/broadcast_tx_sync")) {
        broadcasts += 1;
        observed.push(decodeBroadcast(input).payload.nonce);
        if (broadcasts === 1) {
          throw new Error("connection reset");
        }
        return acceptedResponse("recovered");
      }
      throw new Error(`unexpected URL: ${url}`);
    }) as typeof fetch;
    const client = new XianClient({ rpcUrl: "http://node", fetchFn });

    await expect(send(client, sender, signer(sender))).rejects.toBeInstanceOf(TransportError);
    await expect(send(client, sender, signer(sender))).rejects.toMatchObject({
      name: "NonceReservationError",
      nonce: 12
    });
    expect(broadcasts).toBe(1);

    networkNonce = 13;
    await expect(send(client, sender, signer(sender))).resolves.toMatchObject({ nonce: 13 });
    expect(observed).toEqual([12, 13]);
  });

  it("quarantines a nonce when finalization waiting times out", async () => {
    const sender = "a".repeat(64);
    const fetchFn = vi.fn(async (input: string | URL) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/abci_query")) {
        return nonceResponse(16);
      }
      throw new Error(`unexpected URL: ${url}`);
    }) as typeof fetch;
    const client = new XianClient({ rpcUrl: "http://node", fetchFn });
    vi.spyOn(client, "broadcastTx").mockRejectedValue(
      new TxTimeoutError("timed out waiting for transaction")
    );

    await expect(send(client, sender, signer(sender))).rejects.toBeInstanceOf(TxTimeoutError);
    await expect(send(client, sender, signer(sender))).rejects.toMatchObject({
      name: "NonceReservationError",
      nonce: 16
    });
  });

  it("allows explicit nonces to bypass quarantine and supports deliberate reset", async () => {
    const sender = "a".repeat(64);
    const observed: Array<number | bigint> = [];
    let failBroadcast = true;
    const fetchFn = vi.fn(async (input: string | URL) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/abci_query")) {
        return nonceResponse(21);
      }
      if (url.pathname.endsWith("/broadcast_tx_sync")) {
        observed.push(decodeBroadcast(input).payload.nonce);
        if (failBroadcast) {
          failBroadcast = false;
          throw new Error("timed out");
        }
        return acceptedResponse("accepted");
      }
      throw new Error(`unexpected URL: ${url}`);
    }) as typeof fetch;
    const client = new XianClient({ rpcUrl: "http://node", fetchFn });

    await expect(send(client, sender, signer(sender))).rejects.toBeInstanceOf(TransportError);
    await expect(
      send(client, sender, signer(sender), { nonce: 44 })
    ).resolves.toMatchObject({ nonce: 44 });
    await expect(send(client, sender, signer(sender))).rejects.toBeInstanceOf(
      NonceReservationError
    );

    await client.resetNonceReservation(sender, "chain-a");
    await expect(send(client, sender, signer(sender))).resolves.toMatchObject({ nonce: 21 });
    expect(observed).toEqual([21, 44, 21]);
  });

  it("isolates reservations by sender, chain, and client instance", async () => {
    const senderA = "a".repeat(64);
    const senderB = "b".repeat(64);
    const firstObserved: Array<[string, string, number | bigint]> = [];
    const secondObserved: Array<number | bigint> = [];
    let firstReads = 0;
    let secondReads = 0;
    const firstFetch = vi.fn(async (input: string | URL) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/abci_query")) {
        firstReads += 1;
        return nonceResponse(String(input).includes(senderB) ? 30 : 5);
      }
      const tx = decodeBroadcast(input);
      firstObserved.push([tx.payload.sender, tx.payload.chain_id, tx.payload.nonce]);
      return acceptedResponse(`first-${firstObserved.length}`);
    }) as typeof fetch;
    const secondFetch = vi.fn(async (input: string | URL) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/abci_query")) {
        secondReads += 1;
        return nonceResponse(5);
      }
      secondObserved.push(decodeBroadcast(input).payload.nonce);
      return acceptedResponse("second");
    }) as typeof fetch;
    const first = new XianClient({ rpcUrl: "http://node", fetchFn: firstFetch });
    const second = new XianClient({ rpcUrl: "http://node", fetchFn: secondFetch });

    await send(first, senderA, signer(senderA), { chainId: "chain-a" });
    await send(first, senderA, signer(senderA), { chainId: "chain-b" });
    await send(first, senderB, signer(senderB), { chainId: "chain-a" });
    await send(second, senderA, signer(senderA), { chainId: "chain-a" });

    expect(firstObserved).toEqual([
      [senderA, "chain-a", 5],
      [senderA, "chain-b", 5],
      [senderB, "chain-a", 30]
    ]);
    expect(secondObserved).toEqual([5]);
    expect(firstReads).toBe(3);
    expect(secondReads).toBe(1);
  });

  it("keeps different sender and chain lifecycles concurrent", async () => {
    const senderA = "a".repeat(64);
    const senderB = "b".repeat(64);
    const observed: string[] = [];
    let senderASignAttempts = 0;
    let releaseFirstSignature!: () => void;
    let markFirstSigning!: () => void;
    const firstSignatureGate = new Promise<void>((resolve) => {
      releaseFirstSignature = resolve;
    });
    const firstSigningStarted = new Promise<void>((resolve) => {
      markFirstSigning = resolve;
    });
    const signerA = signer(senderA, async () => {
      senderASignAttempts += 1;
      if (senderASignAttempts === 1) {
        markFirstSigning();
        await firstSignatureGate;
      }
      return "c".repeat(128);
    });
    const fetchFn = vi.fn(async (input: string | URL) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/abci_query")) {
        return nonceResponse(String(input).includes(senderB) ? 30 : 5);
      }
      const tx = decodeBroadcast(input);
      observed.push(`${tx.payload.sender}:${tx.payload.chain_id}`);
      return acceptedResponse(`hash-${observed.length}`);
    }) as typeof fetch;
    const client = new XianClient({ rpcUrl: "http://node", fetchFn });

    const blocked = send(client, senderA, signerA, { chainId: "chain-a" });
    await firstSigningStarted;
    await Promise.all([
      send(client, senderB, signer(senderB), { chainId: "chain-a" }),
      send(client, senderA, signerA, { chainId: "chain-b" })
    ]);

    expect(observed.sort()).toEqual([
      `${senderA}:chain-b`,
      `${senderB}:chain-a`
    ].sort());
    releaseFirstSignature();
    await blocked;
    expect(observed).toContain(`${senderA}:chain-a`);
  });
});
