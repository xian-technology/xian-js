import { describe, expect, it, vi } from "vitest";

import { ProviderDisconnectedError } from "../src/errors";
import { WalletConnectXianProvider } from "../src/walletconnect";

describe("@xian-tech/provider WalletConnect provider", () => {
  it("forwards Xian requests through a WalletConnect request client", async () => {
    const client = {
      request: vi.fn(async () => ["alice"])
    };
    const provider = new WalletConnectXianProvider({
      client,
      topic: "topic-1",
      chainId: "xian-local"
    });

    await expect(provider.request({ method: "xian_requestAccounts" })).resolves.toEqual([
      "alice"
    ]);
    await expect(provider.request({ method: "xian_accounts" })).resolves.toEqual([
      "alice"
    ]);

    expect(client.request).toHaveBeenCalledWith({
      topic: "topic-1",
      chainId: "xian:xian-local",
      request: {
        method: "xian_requestAccounts",
        params: undefined
      }
    });
  });

  it("updates local provider state from WalletConnect session events", async () => {
    const provider = new WalletConnectXianProvider({
      client: {
        request: vi.fn()
      },
      topic: "topic-1",
      chainId: "xian-local",
      accounts: ["alice"]
    });
    const onAccountsChanged = vi.fn();
    const onChainChanged = vi.fn();
    provider.on("accountsChanged", onAccountsChanged);
    provider.on("chainChanged", onChainChanged);

    provider.handleSessionEvent("accountsChanged", [["bob"]]);
    provider.handleSessionEvent("chainChanged", ["xian-mainnet"]);

    await expect(provider.request({ method: "xian_accounts" })).resolves.toEqual([
      "bob"
    ]);
    await expect(provider.request({ method: "xian_chainId" })).resolves.toBe(
      "xian-mainnet"
    );
    expect(onAccountsChanged).toHaveBeenCalledWith(["bob"]);
    expect(onChainChanged).toHaveBeenCalledWith("xian-mainnet");
  });

  it("disconnects and rejects future requests", async () => {
    const provider = new WalletConnectXianProvider({
      client: {
        request: vi.fn()
      },
      topic: "topic-1",
      chainId: "xian-local",
      accounts: ["alice"]
    });

    expect(provider.disconnect()).toBeNull();
    await expect(provider.request({ method: "xian_chainId" })).rejects.toBeInstanceOf(
      ProviderDisconnectedError
    );
  });
});
