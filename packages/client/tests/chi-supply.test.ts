import { describe, expect, it, vi } from "vitest";

import {
  CHI_ESTIMATE_MARGIN,
  Ed25519Signer,
  MAX_TX_CHI,
  SimulationError,
  TransactionError,
  XianClient,
  chiToSupply
} from "../src/index";

function simulationFetch(chiUsed: number, status = 0, result = "ok"): typeof fetch {
  return vi.fn(async (input: string | URL) => {
    const url = String(input);
    if (!url.includes("simulate_tx")) throw new Error(`unexpected URL: ${url}`);
    const value = btoa(JSON.stringify({ status, result, chi_used: chiUsed }));
    return new Response(JSON.stringify({ result: { response: { code: 0, value } } }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  }) as typeof fetch;
}

/** The JSON payload a simulate_tx query carried. */
function simulatedPayload(fetchFn: typeof fetch): Record<string, unknown> {
  const url = String(vi.mocked(fetchFn).mock.calls[0]![0]);
  const hex = decodeURIComponent(url).match(/simulate_tx\/([0-9a-f]+)/)![1]!;
  return JSON.parse(Buffer.from(hex, "hex").toString("utf8"));
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

  it("simulates with the nonce the transaction is signed with", async () => {
    // The node sizes the estimated envelope with the payload's nonce, else
    // its committed next nonce, which ignores this sender's pending
    // transactions: 9 committed and 10 pending makes the envelope a byte longer.
    const fetchFn = simulationFetch(77);
    const client = new XianClient({ rpcUrl: "http://127.0.0.1:1", chainId: "xian-local", fetchFn });
    await client.buildTx({ ...request, nonce: 10 });
    expect(simulatedPayload(fetchFn).nonce).toBe(10);
  });

  it.each([
    [23, "AssertionError: Not enough coins to send!"],
    [200_000, "Out of chi."],
    [0, "Simulation capacity exceeded on this node; retry later"]
  ])("refuses a call whose simulation failed (chi_used %i)", async (chiUsed, result) => {
    // A failed dry run describes a transaction that fails on chain and pays
    // its fee (or one CheckTx rejects for supplying 0 chi).
    const client = new XianClient({
      rpcUrl: "http://127.0.0.1:1",
      chainId: "xian-local",
      fetchFn: simulationFetch(chiUsed, 1, result)
    });
    const attempt = client.buildTx(request);
    await expect(attempt).rejects.toBeInstanceOf(SimulationError);
    await expect(attempt).rejects.toThrow(result);
  });

  it("refuses a simulation answer that is not a JSON object", async () => {
    const fetchFn = vi.fn(async () =>
      new Response(JSON.stringify({ result: { response: { code: 0, value: btoa("not json") } } }), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    ) as typeof fetch;
    const client = new XianClient({ rpcUrl: "http://127.0.0.1:1", fetchFn });
    await expect(client.simulate(request)).rejects.toThrow("did not decode");
  });
});
