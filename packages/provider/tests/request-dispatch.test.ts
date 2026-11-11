import { describe, expect, it, vi } from "vitest";

import {
  InMemoryXianProvider, ProviderChainMismatchError, ProviderDisconnectedError,
  ProviderUnauthorizedError, ProviderUnsupportedMethodError
} from "../src/index";
import type { XianProviderClient, XianUnsignedTransaction } from "../src/provider";

const address = "a".repeat(64);
const tx: XianUnsignedTransaction = { payload: {
  chain_id: "local", sender: address, nonce: 7, chi_supplied: 100,
  contract: "currency", function: "transfer", kwargs: {}
} };

function fixture(options?: { locked?: boolean; withoutClient?: boolean }) {
  const signer = { getAddress: vi.fn(() => address), signMessage: vi.fn(async () => "signature") };
  const client: XianProviderClient = {
    getChainId: vi.fn(async () => "local"),
    buildTx: vi.fn(async () => tx),
    signTx: vi.fn(async (unsigned) => ({ ...unsigned, metadata: { signature: "signature" } })),
    broadcastTx: vi.fn(async (signed) => ({
      submitted: true, accepted: true, finalized: false, mode: "checktx",
      nonce: signed.payload.nonce, chiSupplied: signed.payload.chi_supplied, response: {}
    }))
  };
  const provider = new InMemoryXianProvider({ signer, chainId: "local", locked: options?.locked,
    client: options?.withoutClient ? undefined : client });
  return { provider, signer, client };
}

const protectedMethods = ["xian_signMessage", "xian_signTransaction", "xian_prepareTransaction", "xian_sendTransaction", "xian_sendCall"];

describe("provider request operation boundaries", () => {
  it("preserves connection, alias, chain switch, and disconnect event order", async () => {
    const { provider } = fixture();
    const events: unknown[] = [];
    for (const event of ["connect", "accountsChanged", "chainChanged", "disconnect"]) {
      provider.on(event, (payload) => events.push([event, payload]));
    }
    expect(await provider.request({ method: "xian_connect" })).toEqual([address]);
    expect(await provider.request({ method: "xian_requestAccounts" })).toEqual([address]);
    await provider.request({ method: "xian_switchChain", params: { chainId: "other" } });
    expect(await provider.request({ method: "xian_chainId" })).toBe("other");
    await provider.request({ method: "xian_disconnect" });
    await provider.request({ method: "xian_disconnect" });
    expect(await provider.request({ method: "xian_accounts" })).toEqual([]);
    expect(events).toEqual([
      ["connect", { chainId: "local" }], ["accountsChanged", [address]], ["chainChanged", "local"],
      ["chainChanged", "other"], ["accountsChanged", []],
      ["disconnect", { code: 4900, message: "provider disconnected" }]
    ]);
  });

  it.each(protectedMethods)("checks connection before params/client access for %s", async (method) => {
    const { provider } = fixture({ withoutClient: true });
    await expect(provider.request({ method, params: [{ mode: "invalid", tx: {}, intent: {} }] }))
      .rejects.toBeInstanceOf(ProviderDisconnectedError);
  });

  it.each(protectedMethods)("does not read a params accessor before authorization for %s", async (method) => {
    const { provider } = fixture({ withoutClient: true });
    await expect(provider.request({ method, get params() { throw new Error("params read before authorization"); } }))
      .rejects.toBeInstanceOf(ProviderDisconnectedError);
    await provider.request({ method: "xian_connect" });
    if (["xian_signTransaction", "xian_sendTransaction", "xian_sendCall"].includes(method)) {
      await expect(provider.request({ method, get params() { throw new Error("params read before client check"); } }))
        .rejects.toThrow(`provider client is required for ${method}`);
    }
  });

  it.each(["xian_connect", "xian_requestAccounts", "xian_getWalletInfo", "xian_disconnect", "xian_accounts", "xian_chainId"])(
    "ignores unused params for %s", async (method) => {
      const { provider } = fixture();
      await expect(provider.request({ method, get params() { throw new Error("unused params accessed"); } })).resolves.toBeDefined();
    }
  );

  it.each([undefined, 7, ""])("rejects invalid switchChain input %s", async (chainId) => {
    const { provider } = fixture();
    await expect(provider.request({ method: "xian_switchChain", params: { chainId } }))
      .rejects.toThrow("xian_switchChain requires a chainId string");
    expect(await provider.request({ method: "xian_chainId" })).toBe("local");
  });

  it("accepts a one-character chain identifier", async () => {
    const { provider } = fixture();
    await provider.request({ method: "xian_switchChain", params: { chainId: "x" } });
    expect(await provider.request({ method: "xian_chainId" })).toBe("x");
  });

  it("requires unlock before connection or signing", async () => {
    const { provider, signer } = fixture({ locked: true });
    await expect(provider.request({ method: "xian_connect" })).rejects.toBeInstanceOf(ProviderUnauthorizedError);
    expect(signer.getAddress).not.toHaveBeenCalled();
    await expect(provider.request({ method: "xian_signMessage", params: {} }))
      .rejects.toBeInstanceOf(ProviderDisconnectedError);
  });

  it.each(["xian_signTransaction", "xian_prepareTransaction", "xian_sendTransaction", "xian_sendCall"])(
    "preserves the missing-client error for %s after authorization", async (method) => {
      const { provider } = fixture({ withoutClient: true });
      await provider.request({ method: "xian_connect" });
      await expect(provider.request({ method, params: [{ intent: {}, tx: {} }] }))
        .rejects.toThrow(`provider client is required for ${method}`);
    }
  );

  it.each(["xian_signTransaction", "xian_sendTransaction"])("checks transaction chain before signing for %s", async (method) => {
    const { provider, client } = fixture();
    await provider.request({ method: "xian_connect" });
    await expect(provider.request({ method, params: { tx: { ...tx, payload: { ...tx.payload, chain_id: "other" } } } }))
      .rejects.toBeInstanceOf(ProviderChainMismatchError);
    await expect(provider.request({ method, params: [{ tx: { payload: {} } }] }))
      .rejects.toThrow("transaction payload must include chain_id");
    expect(client.signTx).not.toHaveBeenCalled();
    expect(client.broadcastTx).not.toHaveBeenCalled();
  });

  it("keeps sendCall mode validation before chain/intent preparation", async () => {
    const { provider, client } = fixture();
    await provider.request({ method: "xian_connect" });
    await expect(provider.request({ method: "xian_sendCall", params: [{ mode: "bad", intent: { chainId: "other" } }] }))
      .rejects.toThrow("mode must be one of: async, checktx, commit");
    expect(client.buildTx).not.toHaveBeenCalled();
  });

  it("rejects sendCall chain mismatch before reading the signer account", async () => {
    const { provider, signer, client } = fixture();
    await provider.request({ method: "xian_connect" });
    signer.getAddress.mockClear();
    await expect(provider.request({ method: "xian_sendCall", params: {
      intent: { chainId: "other", contract: "currency", function: "transfer", kwargs: {} }, mode: "checktx"
    } })).rejects.toBeInstanceOf(ProviderChainMismatchError);
    expect(signer.getAddress).not.toHaveBeenCalled();
    expect(client.buildTx).not.toHaveBeenCalled();
  });

  it("accepts and stores a watched asset when there is no callback", async () => {
    const { provider } = fixture();
    expect(await provider.request({ method: "xian_watchAsset", params: { options: { contract: "currency" } } })).toBe(true);
    expect(provider.listWatchedAssets()).toEqual([{ contract: "currency", name: undefined, symbol: undefined, icon: undefined, decimals: undefined }]);
  });

  it("forwards raw sendTransaction options without adding sendCall mode validation", async () => {
    const { provider, client } = fixture();
    await provider.request({ method: "xian_connect" });
    await provider.request({ method: "xian_sendTransaction", params: { tx, mode: "custom", waitForTx: true, timeoutMs: 23, pollIntervalMs: 4 } });
    expect(client.broadcastTx).toHaveBeenCalledWith(expect.objectContaining({ payload: tx.payload }), {
      mode: "custom", waitForTx: true, timeoutMs: 23, pollIntervalMs: 4
    });
  });

  it.each(["unknown", "toString", "constructor", "__proto__"])("rejects unsupported method %s using the public error", async (method) => {
    const { provider } = fixture();
    await expect(provider.request({ method })).rejects.toBeInstanceOf(ProviderUnsupportedMethodError);
    await expect(provider.request({ method })).rejects.toMatchObject({ code: 4200, message: `unsupported provider method: ${method}` });
  });

  it("keeps watchAsset independent of connection and honors callback rejection", async () => {
    const signer = { getAddress: () => address, signMessage: () => "signature" };
    const callback = vi.fn(async () => false);
    const provider = new InMemoryXianProvider({ signer, onWatchAsset: callback });
    expect(await provider.request({ method: "xian_watchAsset", params: [{ options: { contract: "currency", decimals: 0 } }] })).toBe(false);
    expect(provider.listWatchedAssets()).toEqual([]);
    expect(callback).toHaveBeenCalledWith({ contract: "currency", decimals: 0, name: undefined, symbol: undefined, icon: undefined });
  });

  it.each([
    [{ type: "coin", options: { contract: "bad-name" } }, "xian_watchAsset currently supports only type 'token'"],
    [{ options: { contract: "bad-name", name: 1 } }, "xian_watchAsset requires a token contract identifier"],
    [{ options: { contract: "currency", name: 1, symbol: 2 } }, "asset name must be a string"],
    [{ options: { contract: "currency", symbol: 1 } }, "asset symbol must be a string"],
    [{ options: { contract: "currency", icon: 1 } }, "asset icon must be a string"],
    [{ options: { contract: "currency", decimals: -1 } }, "asset decimals must be a non-negative integer"]
  ])("preserves asset metadata validation order: %j", async (params, message) => {
    const { provider } = fixture();
    await expect(provider.request({ method: "xian_watchAsset", params })).rejects.toThrow(message);
    expect(provider.listWatchedAssets()).toEqual([]);
  });
});
