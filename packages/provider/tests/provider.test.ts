import { describe, expect, it, vi } from "vitest";

import type {
  XianProviderClient,
  XianTransactionIntent,
  XianUnsignedTransaction
} from "../src/provider";
import { InMemoryXianProvider } from "../src/provider";
import {
  ProviderChainMismatchError,
  ProviderDisconnectedError
} from "../src/errors";

const signer = {
  getAddress: () => "a".repeat(64),
  signMessage: vi.fn((message: string) => `sig:${message}`)
};

describe("@xian/provider", () => {
  it("connects, emits events, and returns accounts", async () => {
    const client: XianProviderClient = {
      getChainId: vi.fn(async () => "xian-local"),
      buildTx: vi.fn(),
      signTx: vi.fn(),
      broadcastTx: vi.fn()
    };

    const provider = new InMemoryXianProvider({
      signer,
      client
    });

    const onConnect = vi.fn();
    const onAccounts = vi.fn();
    provider.on("connect", onConnect);
    provider.on("accountsChanged", onAccounts);

    await expect(provider.request({ method: "xian_requestAccounts" })).resolves.toEqual([
      "a".repeat(64)
    ]);
    await expect(provider.request({ method: "xian_accounts" })).resolves.toEqual([
      "a".repeat(64)
    ]);

    expect(onConnect).toHaveBeenCalledWith({ chainId: "xian-local" });
    expect(onAccounts).toHaveBeenCalledWith(["a".repeat(64)]);
  });

  it("signs and sends transactions through the backing client", async () => {
    const tx: XianUnsignedTransaction = {
      payload: {
        chain_id: "xian-local",
        contract: "currency",
        function: "transfer",
        kwargs: { to: "bob", amount: "5" },
        nonce: 1,
        sender: "a".repeat(64),
        stamps_supplied: 50_000
      }
    };

    const signedTx = {
      metadata: { signature: "b".repeat(128) },
      payload: tx.payload
    };

    const submission = {
      submitted: true,
      accepted: true,
      finalized: false,
      txHash: "ABC123",
      mode: "checktx" as const,
      nonce: 1,
      stampsSupplied: 50_000,
      response: {}
    };

    const client: XianProviderClient = {
      getChainId: vi.fn(async () => "xian-local"),
      buildTx: vi.fn(),
      signTx: vi.fn(async () => signedTx),
      broadcastTx: vi.fn(async () => submission)
    };

    const provider = new InMemoryXianProvider({
      signer,
      client
    });

    await provider.request({ method: "xian_connect" });

    await expect(
      provider.request({
        method: "xian_signTransaction",
        params: [{ tx }]
      })
    ).resolves.toEqual(signedTx);

    await expect(
      provider.request({
        method: "xian_sendTransaction",
        params: [{ tx, mode: "checktx" }]
      })
    ).resolves.toEqual(submission);

    expect(client.signTx).toHaveBeenCalledTimes(2);
    expect(client.broadcastTx).toHaveBeenCalledWith(signedTx, {
      mode: "checktx",
      pollIntervalMs: undefined,
      timeoutMs: undefined,
      waitForTx: undefined
    });
  });

  it("switches chains, emits chainChanged, and rejects signing while disconnected", async () => {
    const client: XianProviderClient = {
      getChainId: vi.fn(async () => "xian-local"),
      buildTx: vi.fn(),
      signTx: vi.fn(),
      broadcastTx: vi.fn()
    };

    const provider = new InMemoryXianProvider({
      signer,
      client
    });

    const onChainChanged = vi.fn();
    provider.on("chainChanged", onChainChanged);

    await provider.request({ method: "xian_connect" });
    await provider.request({
      method: "xian_switchChain",
      params: [{ chainId: "xian-testnet" }]
    });
    await expect(provider.request({ method: "xian_chainId" })).resolves.toBe(
      "xian-testnet"
    );

    await provider.request({ method: "xian_disconnect" });
    await expect(
      provider.request({
        method: "xian_signMessage",
        params: [{ message: "hello" }]
      })
    ).rejects.toBeInstanceOf(ProviderDisconnectedError);

    expect(onChainChanged).toHaveBeenCalledWith("xian-local");
    expect(onChainChanged).toHaveBeenCalledWith("xian-testnet");
  });

  it("returns wallet info, prepares intent-based transactions, sends calls, and watches assets", async () => {
    const intent: XianTransactionIntent = {
      contract: "currency",
      function: "transfer",
      kwargs: { to: "bob", amount: "5" }
    };
    const preparedTx: XianUnsignedTransaction = {
      payload: {
        chain_id: "xian-local",
        contract: "currency",
        function: "transfer",
        kwargs: { to: "bob", amount: "5" },
        nonce: 7,
        sender: "a".repeat(64),
        stamps_supplied: 55_000
      }
    };
    const submission = {
      submitted: true,
      accepted: true,
      finalized: false,
      txHash: "PREPARED123",
      mode: "checktx" as const,
      nonce: 7,
      stampsSupplied: 55_000,
      response: {}
    };
    const onWatchAsset = vi.fn(async () => true);

    const client: XianProviderClient = {
      getChainId: vi.fn(async () => "xian-local"),
      buildTx: vi.fn(async () => preparedTx),
      signTx: vi.fn(async (tx) => ({
        payload: tx.payload,
        metadata: { signature: "c".repeat(128) }
      })),
      broadcastTx: vi.fn(async () => submission)
    };

    const provider = new InMemoryXianProvider({
      signer,
      client,
      onWatchAsset
    });

    await expect(provider.request({ method: "xian_getWalletInfo" })).resolves.toMatchObject({
      accounts: [],
      chainId: "xian-local",
      connected: false,
      locked: false,
      capabilities: {
        getWalletInfo: true,
        prepareTransaction: true,
        watchAsset: true
      }
    });

    await provider.request({ method: "xian_connect" });

    await expect(
      provider.request({
        method: "xian_prepareTransaction",
        params: [{ intent }]
      })
    ).resolves.toEqual(preparedTx);

    await expect(
      provider.request({
        method: "xian_sendCall",
        params: [{ intent, mode: "checktx" }]
      })
    ).resolves.toEqual(submission);

    await expect(
      provider.request({
        method: "xian_watchAsset",
        params: [{ type: "token", options: { contract: "currency", symbol: "XIAN" } }]
      })
    ).resolves.toBe(true);

    expect(client.buildTx).toHaveBeenCalledWith({
      sender: "a".repeat(64),
      contract: "currency",
      function: "transfer",
      kwargs: { to: "bob", amount: "5" },
      chainId: "xian-local",
      stamps: undefined,
      stampsSupplied: undefined
    });
    expect(client.broadcastTx).toHaveBeenCalled();
    expect(onWatchAsset).toHaveBeenCalledWith({
      contract: "currency",
      symbol: "XIAN",
      name: undefined,
      icon: undefined,
      decimals: undefined
    });
    expect(provider.listWatchedAssets()).toEqual([
      {
        contract: "currency",
        symbol: "XIAN",
        name: undefined,
        icon: undefined,
        decimals: undefined
      }
    ]);
  });

  it("rejects intent preparation when the requested chain does not match the active wallet chain", async () => {
    const client: XianProviderClient = {
      getChainId: vi.fn(async () => "xian-local"),
      buildTx: vi.fn(),
      signTx: vi.fn(),
      broadcastTx: vi.fn()
    };
    const provider = new InMemoryXianProvider({
      signer,
      client
    });

    await provider.request({ method: "xian_connect" });

    await expect(
      provider.request({
        method: "xian_prepareTransaction",
        params: [
          {
            intent: {
              contract: "currency",
              function: "transfer",
              kwargs: { to: "bob", amount: "5" },
              chainId: "xian-testnet"
            }
          }
        ]
      })
    ).rejects.toBeInstanceOf(ProviderChainMismatchError);
  });
});
