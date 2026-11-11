import { describe, expect, it, vi } from "vitest";

import {
  DEFAULT_CHI_MARGIN,
  DEFAULT_MIN_CHI_HEADROOM,
  Ed25519Signer,
  suggestChiSupplied,
  XianClient
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

describe("chi headroom", () => {
  it("shares the Python SDK rule: estimate + max(ceil(estimate * margin), headroom)", () => {
    expect([DEFAULT_CHI_MARGIN, DEFAULT_MIN_CHI_HEADROOM]).toEqual([0.05, 10]);
    const cases: [number, number, number, number][] = [
      [0, 0.05, 10, 10],
      [77, 0.05, 10, 87],
      [1000, 0.05, 10, 1050],
      [1001, 0.05, 10, 1052],
      [77, 0, 0, 77],
      [77, 0.5, 100, 177]
    ];
    for (const [estimated, chiMargin, minChiHeadroom, suggested] of cases) {
      expect(suggestChiSupplied(estimated, { chiMargin, minChiHeadroom })).toBe(suggested);
    }
    expect(suggestChiSupplied(77)).toBe(87);
  });

  it("rejects invalid headroom settings", () => {
    for (const options of [
      { chiMargin: -0.01 },
      { chiMargin: Number.NaN },
      { chiMargin: Number.POSITIVE_INFINITY },
      { minChiHeadroom: -1 },
      { minChiHeadroom: 1.5 }
    ]) {
      expect(() => suggestChiSupplied(10, options)).toThrow(RangeError);
      expect(
        () => new XianClient({ rpcUrl: "http://127.0.0.1:1", fetchFn: simulationFetch(1), ...options })
      ).toThrow(RangeError);
    }
    expect(() => suggestChiSupplied(-1)).toThrow(RangeError);
    expect(() => suggestChiSupplied(1.5)).toThrow(RangeError);
  });

  it("reports the exact estimate and the suggested supply", async () => {
    const client = new XianClient({ rpcUrl: "http://127.0.0.1:1", fetchFn: simulationFetch(1001) });
    const estimate = await client.estimateChi(request);
    expect([estimate.estimated, estimate.suggested]).toEqual([1001, 1052]);
    const custom = await client.estimateChi(request, { chiMargin: 0.5, minChiHeadroom: 100 });
    expect(custom.suggested).toBe(1502);
  });

  it("lets client defaults, then per-request options, then explicit chi win", async () => {
    const client = new XianClient({
      rpcUrl: "http://127.0.0.1:1",
      chainId: "xian-local",
      fetchFn: simulationFetch(77),
      chiMargin: 0.5,
      minChiHeadroom: 100
    });
    expect((await client.buildTx(request)).payload.chi_supplied).toBe(177);
    expect(
      (await client.buildTx({ ...request, chiMargin: 0, minChiHeadroom: 0 })).payload.chi_supplied
    ).toBe(77);
    expect((await client.buildTx({ ...request, chi: 5 })).payload.chi_supplied).toBe(5);
  });
});
