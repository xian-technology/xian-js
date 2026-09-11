import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { canonicalizeRuntime, decodeRuntime, sortKeysDeep } from "../src/encoding";
import { Ed25519Signer, XianClient } from "../src/index";

const vectors = JSON.parse(readFileSync(new URL(
  "../../../../xian-contracting/tests/fixtures/transaction_wire.json", import.meta.url
), "utf8"));

describe("shared canonical transaction vectors", () => {
  for (const vector of vectors.cases) {
    it(`builds, signs and broadcasts exact bytes: ${vector.name}`, async () => {
      const signer = new Ed25519Signer(vectors.private_key);
      let submitted = "";
      const client = new XianClient({
        rpcUrl: "http://127.0.0.1:26657",
        fetchFn: (async (input: string | URL) => {
          submitted = JSON.parse(new URL(String(input)).searchParams.get("tx")!);
          return new Response(JSON.stringify({ result: { code: 0, hash: "test" } }));
        }) as typeof fetch
      });
      const payload = vector.payload;
      const tx = await client.buildTx({
        sender: payload.sender, chainId: payload.chain_id, nonce: payload.nonce,
        chi: payload.chi_supplied, contract: payload.contract,
        function: payload.function, kwargs: payload.kwargs
      });
      expect(canonicalizeRuntime(tx.payload)).toBe(vector.canonical_payload);
      const signed = await client.signTx(tx, signer);
      expect(signed.metadata.signature).toBe(vector.signature);
      await client.broadcastTx(signed);
      expect(Buffer.from(submitted, "hex").toString("utf8")).toBe(vector.transaction_json);
    });
  }

  it("preserves own prototype keys while copying and decoding", () => {
    const input = JSON.parse('{"__proto__":{"polluted":true},"constructor":"data"}');
    for (const result of [sortKeysDeep(input), decodeRuntime(JSON.stringify(input))]) {
      expect(Object.hasOwn(result, "__proto__")).toBe(true);
      expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
      expect(result.polluted).toBeUndefined();
      expect(result.__proto__).toEqual({ polluted: true });
    }
  });

  it("normalizes native bigints at arbitrary list depth", () => {
    expect(canonicalizeRuntime({ data: [[2n ** 80n, true, null]] })).toBe(
      '{"data":[[{"__big_int__":"1208925819614629174706176"},true,null]]}'
    );
  });
});
