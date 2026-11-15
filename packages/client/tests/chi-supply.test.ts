import { describe, expect, it, vi } from "vitest";

import {
  CHI_ESTIMATE_MARGIN,
  Ed25519Signer,
  MAX_TX_CHI,
  TransactionError,
  XianClient,
  chiToSupply
} from "../src/index";

function simulationFetch(chiUsed: number): typeof fetch {
  return vi.fn(async (input: string | URL) => {
    const url = String(input);
    if (!url.includes("simulate_tx")) throw new Error(`unexpected URL: ${url}`);
    const value = btoa(JSON.stringify({ status: 0, result: "ok", chi_used: chiUsed }));
    return new Response(JSON.stringify({ result: { response: { code: 0, value } } }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  }) as typeof fetch;
}

const signer = new Ed25519Signer("2".repeat(64));
const request = {
  sender: signer.address,
  contract: "currency",
  function: "transfer",
  kwargs: { to: "b".repeat(64), amount: 1 },
  nonce: 1
};

describe("chiToSupply", () => {
  it("adds the fixed margin to the simulated estimate", () => {
    expect(CHI_ESTIMATE_MARGIN).toBe(2);
    expect(chiToSupply(255)).toBe(257);
    expect(chiToSupply(0)).toBe(2);
  });

  it("never exceeds the per-transaction cap", () => {
    expect(MAX_TX_CHI).toBe(200_000);
    expect(chiToSupply(MAX_TX_CHI - 3)).toBe(MAX_TX_CHI - 1);
    expect(chiToSupply(MAX_TX_CHI - 2)).toBe(MAX_TX_CHI);
    expect(chiToSupply(MAX_TX_CHI - 1)).toBe(MAX_TX_CHI);
    expect(chiToSupply(MAX_TX_CHI)).toBe(MAX_TX_CHI);
  });

  it("refuses an estimate above the cap", () => {
    expect(() => chiToSupply(MAX_TX_CHI + 1)).toThrow(TransactionError);
    expect(() => chiToSupply(MAX_TX_CHI + 1)).toThrow(/200001 chi exceeds .* 200000 chi/);
  });
});

describe("automatic chi", () => {
  it("reports the simulated chi as the estimate", async () => {
    const client = new XianClient({ rpcUrl: "http://127.0.0.1:1", fetchFn: simulationFetch(1001) });
    const estimate = await client.estimateChi(request);
    expect(estimate).toEqual({
      estimated: 1001,
      simulation: { status: 0, result: "ok", chi_used: 1001 }
    });
  });

  it("supplies the estimate plus the margin unless the request sets chi", async () => {
    const fetchFn = simulationFetch(77);
    const client = new XianClient({ rpcUrl: "http://127.0.0.1:1", chainId: "xian-local", fetchFn });
    expect((await client.buildTx(request)).payload.chi_supplied).toBe(79);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect((await client.buildTx({ ...request, chi: 5 })).payload.chi_supplied).toBe(5);
    expect((await client.buildTx({ ...request, chiSupplied: 77 })).payload.chi_supplied).toBe(77);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("refuses to build a transaction whose estimate exceeds the cap", async () => {
    const client = new XianClient({
      rpcUrl: "http://127.0.0.1:1",
      chainId: "xian-local",
      fetchFn: simulationFetch(MAX_TX_CHI + 1)
    });
    await expect(client.buildTx(request)).rejects.toThrow(TransactionError);
  });
});
