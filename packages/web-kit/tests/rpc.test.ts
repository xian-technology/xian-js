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
