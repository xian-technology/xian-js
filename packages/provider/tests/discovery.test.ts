import { describe, expect, it, vi } from "vitest";

import {
  InMemoryXianProvider,
  InjectedXianWallet,
  XIAN_INITIALIZED_EVENT,
  getInjectedXianProvider,
  listInjectedXianProviders,
  registerInjectedXianProvider,
  waitForInjectedXianProvider,
  type XianInjectionTarget,
  type XianProviderClient
} from "../src/index";

const signer = {
  getAddress: () => "f".repeat(64),
  signMessage: vi.fn(async (message: string) => `sig:${message}`)
};

function createClient(): XianProviderClient {
  return {
    getChainId: vi.fn(async () => "xian-local"),
    buildTx: vi.fn(async (request) => ({
      payload: {
        chain_id: request.chainId ?? "xian-local",
        contract: request.contract,
        function: request.function,
        kwargs: request.kwargs,
        nonce: 1,
        sender: request.sender,
        stamps_supplied: request.stampsSupplied ?? request.stamps ?? 50_000
      }
    })),
    signTx: vi.fn(async (tx) => ({
      payload: tx.payload,
      metadata: { signature: "a".repeat(128) }
    })),
    broadcastTx: vi.fn(async () => ({
      submitted: true,
      accepted: true,
      finalized: false,
      txHash: "ABC123",
      mode: "checktx",
      nonce: 1,
      stampsSupplied: 50_000,
      response: {}
    }))
  };
}

class FakeInjectionTarget extends EventTarget implements XianInjectionTarget {
  xian?: unknown;
  xianProviders?: unknown[];
}

describe("@xian/provider injected discovery", () => {
  it("registers providers on the injection target and lists them", () => {
    const target = new FakeInjectionTarget();
    const provider = new InMemoryXianProvider({
      signer,
      client: createClient()
    });

    const eventListener = vi.fn();
    target.addEventListener(XIAN_INITIALIZED_EVENT, eventListener);

    const record = registerInjectedXianProvider({
      target,
      provider,
      metadata: {
        id: "demo-wallet",
        name: "Demo Wallet"
      }
    });

    expect(record.metadata.name).toBe("Demo Wallet");
    expect(listInjectedXianProviders(target)).toHaveLength(1);
    expect(getInjectedXianProvider({ target })?.metadata.id).toBe(
      "demo-wallet"
    );
    expect((target.xian as { provider?: unknown } | undefined)?.provider).toBe(
      provider
    );
    expect(eventListener).toHaveBeenCalledTimes(1);
  });

  it("waits for a provider to be injected and resolves the matching record", async () => {
    const target = new FakeInjectionTarget();
    const provider = new InMemoryXianProvider({
      signer,
      client: createClient()
    });

    const waiting = waitForInjectedXianProvider({
      target,
      id: "async-wallet",
      timeoutMs: 100
    });

    setTimeout(() => {
      registerInjectedXianProvider({
        target,
        provider,
        metadata: {
          id: "async-wallet",
          name: "Async Wallet"
        }
      });
    }, 10);

    const record = await waiting;
    expect(record?.metadata.name).toBe("Async Wallet");
  });

  it("returns undefined when waiting for a provider times out", async () => {
    const target = new FakeInjectionTarget();

    await expect(
      waitForInjectedXianProvider({
        target,
        id: "missing-wallet",
        timeoutMs: 5
      })
    ).resolves.toBeUndefined();
  });

  it("wraps an injected provider with dapp-friendly wallet helpers", async () => {
    const target = new FakeInjectionTarget();
    const client = createClient();
    const provider = new InMemoryXianProvider({
      signer,
      client
    });

    registerInjectedXianProvider({
      target,
      provider,
      metadata: {
        id: "wrapped-wallet",
        name: "Wrapped Wallet"
      }
    });

    const wallet = InjectedXianWallet.getInjected({ target });
    expect(wallet?.metadata?.id).toBe("wrapped-wallet");

    await expect(wallet?.connect()).resolves.toEqual(["f".repeat(64)]);
    await expect(wallet?.getChainId()).resolves.toBe("xian-local");
    await expect(wallet?.getWalletInfo()).resolves.toMatchObject({
      accounts: ["f".repeat(64)],
      connected: true,
      wallet: {
        id: "wrapped-wallet",
        name: "Wrapped Wallet"
      }
    });
    await expect(wallet?.signMessage("hello")).resolves.toBe("sig:hello");
    await expect(
      wallet?.watchAsset({
        type: "token",
        options: {
          contract: "currency",
          symbol: "XIAN"
        }
      })
    ).resolves.toBe(true);
    await expect(
      wallet?.prepareTransaction({
        contract: "currency",
        function: "transfer",
        kwargs: { to: "bob", amount: "5" }
      })
    ).resolves.toEqual({
      payload: {
        chain_id: "xian-local",
        contract: "currency",
        function: "transfer",
        kwargs: { to: "bob", amount: "5" },
        nonce: 1,
        sender: "f".repeat(64),
        stamps_supplied: 50_000
      }
    });
    await expect(
      wallet?.sendCall(
        {
          contract: "currency",
          function: "transfer",
          kwargs: { to: "bob", amount: "5" }
        },
        { mode: "checktx" }
      )
    ).resolves.toMatchObject({
      txHash: "ABC123",
      accepted: true
    });

    const providerSigner = wallet?.asSigner();
    await expect(providerSigner?.getAddress()).resolves.toBe("f".repeat(64));
    await expect(providerSigner?.signMessage("world")).resolves.toBe(
      "sig:world"
    );
  });

  it("keeps the default provider aligned when a wallet is re-registered by id", () => {
    const target = new FakeInjectionTarget();
    const firstProvider = new InMemoryXianProvider({
      signer,
      client: createClient()
    });
    const replacementProvider = new InMemoryXianProvider({
      signer,
      client: createClient()
    });

    registerInjectedXianProvider({
      target,
      provider: firstProvider,
      metadata: {
        id: "demo-wallet",
        name: "Demo Wallet"
      }
    });
    registerInjectedXianProvider({
      target,
      provider: replacementProvider,
      metadata: {
        id: "demo-wallet",
        name: "Demo Wallet v2"
      }
    });

    expect(getInjectedXianProvider({ target })?.provider).toBe(replacementProvider);
    expect((target.xian as { provider?: unknown } | undefined)?.provider).toBe(
      replacementProvider
    );
  });
});
