import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { canonicalizeRuntime, decodeRuntime, sortKeysDeep } from "../src/encoding";
import { Ed25519Signer, XianClient, prepareTransaction } from "../src/index";

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
        vmProfile: "xian_vm_v1",
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
      expect(canonicalizeRuntime(tx.payload, "xian_vm_v1")).toBe(vector.canonical_payload);
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


for (const receipt of vectors.node_receipts) {
  it(`matches a real CometBFT receipt: ${receipt.name}`, () => {
    const rpcHex = Buffer.from(receipt.block_tx_base64, "base64").toString("ascii");
    const signed = JSON.parse(Buffer.from(rpcHex, "hex").toString("utf8"));
    const prepared = prepareTransaction(signed, "xian_vm_v1");
    expect(prepared.rpcHex).toBe(rpcHex);
    expect(prepared.txHash).toBe(receipt.tx_hash);
  });
}

const v2 = JSON.parse(readFileSync(new URL(
  "../../../../xian-contracting/tests/fixtures/transaction_numeric_v2.json", import.meta.url
), "utf8"));

describe("fresh-chain contract numbers", () => {
  it("selects V2 by default and decodes V1 wires only when requested", () => {
    expect(new XianClient({ rpcUrl: "http://localhost" }).vmProfile).toBe("xian_vm_v2");
    expect(decodeRuntime('{"value":1.5}')).toBeNull();
    expect(decodeRuntime('{"value":1.5}', "xian_vm_v1")).toEqual({ value: 1.5 });
    expect(() => canonicalizeRuntime({ __fixed__: "1.0" })).toThrow();
    expect(canonicalizeRuntime({ __fixed__: "1.0" }, "xian_vm_v1")).toBe('{"__fixed__":"1.0"}');
  });
  for (const vector of v2.cases) {
    it(`signs exact numeric values: ${vector.name}`, async () => {
      const signer = new Ed25519Signer(v2.private_key);
      const client = new XianClient({ rpcUrl: "http://localhost" });
      const signed = await client.signTx({payload: vector.payload}, signer);
      expect(prepareTransaction(signed).json).toBe(vector.transaction_json);
    });
  }

  it("rejects unsafe numbers and invalid numeric wrappers before signing", async () => {
    const client = new XianClient({ rpcUrl: "http://localhost" });
    for (const value of [
      0.1, Number.MAX_SAFE_INTEGER + 1, 1n << 512n,
      { __fixed__: "1.230" }, { __fixed__: 1 }, { __fixed__: "-0" },
      { __fixed__: "1", extra: "field" }, { __big_int__: "42" }
    ]) {
      const payload = { ...v2.cases[0].payload, kwargs: { value: [value] } };
      await expect(client.signTx({payload}, new Ed25519Signer(v2.private_key))).rejects.toThrow();
    }
  });
});
