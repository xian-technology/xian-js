import { describe, expect, it, vi } from "vitest";

import { createXianRpcStore, type RpcStorage } from "../src/index";

function createStorage(): RpcStorage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    }
  };
}

describe("@xian-tech/web-kit RPC store", () => {
  it("caches clients by cleaned RPC URL and emits epoch updates", () => {
    const created: string[] = [];
    const store = createXianRpcStore({
      defaultRpcUrl: "http://localhost:26657",
      storageKey: "rpc",
      storage: createStorage(),
      createClient: (url) => {
        created.push(url);
        return { url };
      }
    });
    const listener = vi.fn();
    store.subscribeRpcEpoch(listener);

    expect(store.getClient()).toEqual({ url: "http://localhost:26657" });
    expect(store.getClient()).toEqual({ url: "http://localhost:26657" });
    expect(created).toEqual(["http://localhost:26657"]);

    store.setRpcUrl(" http://127.0.0.1:26657/// ");

    expect(store.getRpcEpoch()).toBe(1);
    expect(listener).toHaveBeenCalledWith(1);
    expect(store.getClient()).toEqual({ url: "http://127.0.0.1:26657" });
    expect(created).toEqual([
      "http://localhost:26657",
      "http://127.0.0.1:26657"
    ]);
  });

  it.each([undefined, "rpc"])("keeps endpoint selection in memory without storage (key=%s)", (storageKey) => {
    vi.stubGlobal("localStorage", undefined);
    try {
      const listener = vi.fn();
      const store = createXianRpcStore({
        defaultRpcUrl: "http://127.0.0.1:26657",
        storageKey,
        createClient: (url) => ({ url })
      });
      const original = store.getClient();
      store.subscribeRpcEpoch(listener);
      store.setRpcUrl(" http://127.0.0.1:27657/// ");
      const selected = store.getClient();
      expect(store.getRpcUrl()).toBe("http://127.0.0.1:27657");
      expect(selected).toEqual({ url: "http://127.0.0.1:27657" });
      expect(selected).not.toBe(original);
      store.setRpcUrl("http://127.0.0.1:27657/");
      expect(store.getClient()).toBe(selected);
      expect(store.getRpcEpoch()).toBe(1);
      expect(listener).toHaveBeenCalledExactlyOnceWith(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("does not access browser storage when persistence is not configured", () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get() { throw new DOMException("Storage access denied", "SecurityError"); }
    });
    try {
      const store = createXianRpcStore({
        defaultRpcUrl: "http://127.0.0.1:26657",
        createClient: (url) => ({ url })
      });
      store.setRpcUrl("http://127.0.0.1:27657");
      expect(store.getClient()).toEqual({ url: "http://127.0.0.1:27657" });
    } finally {
      if (original) Object.defineProperty(globalThis, "localStorage", original);
      else Reflect.deleteProperty(globalThis, "localStorage");
    }
  });

  it("pings the cleaned status URL", async () => {
    const fetchFn = vi.fn(async () => new Response("ok", { status: 200 }));
    const store = createXianRpcStore({
      defaultRpcUrl: "http://localhost:26657",
      fetchFn
    });

    await expect(store.pingRpc(" http://localhost:26657/// ")).resolves.toBe(true);
    expect(fetchFn).toHaveBeenCalledWith(
      "http://localhost:26657/status",
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
  });
});
