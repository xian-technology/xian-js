import { describe, expect, it, vi } from "vitest";

import { Ed25519Signer, XianClient } from "../src/index";

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

describe("automatic chi", () => {
  it("reports the simulated chi as the chi to supply", async () => {
    const client = new XianClient({ rpcUrl: "http://127.0.0.1:1", fetchFn: simulationFetch(1001) });
    const estimate = await client.estimateChi(request);
    expect(estimate).toEqual({
      estimated: 1001,
      simulation: { status: 0, result: "ok", chi_used: 1001 }
    });
  });

  it("supplies exactly the simulated chi unless the request sets chi", async () => {
    const client = new XianClient({
      rpcUrl: "http://127.0.0.1:1",
      chainId: "xian-local",
      fetchFn: simulationFetch(77)
    });
    expect((await client.buildTx(request)).payload.chi_supplied).toBe(77);
    expect((await client.buildTx({ ...request, chi: 5 })).payload.chi_supplied).toBe(5);
  });
});
