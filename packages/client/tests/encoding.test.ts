import { describe, expect, it } from "vitest";

import {
  Ed25519Signer,
  canonicalizeRuntime,
  decodeRuntime,
  encodeRuntime,
  isValidEd25519Key,
  isValidEd25519Signature,
  verifyMessage
} from "../src/index";
import { hexToBytes } from "../src/encoding";

describe("@xian-tech/client encoding", () => {
  it("canonicalizes payloads with sorted keys", () => {
    const canonical = canonicalizeRuntime({
      chi_supplied: 50000,
      sender: "a".repeat(64),
      nonce: 7,
      kwargs: {
        to: "bob",
        amount: "5"
      },
      function: "transfer",
      contract: "currency",
      chain_id: "xian-local"
    });

    expect(canonical).toBe(
      '{"chain_id":"xian-local","chi_supplied":50000,"contract":"currency","function":"transfer","kwargs":{"amount":"5","to":"bob"},"nonce":7,"sender":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}'
    );
  });

  it("encodes and decodes bigints with Xian runtime wrappers", () => {
    const encoded = encodeRuntime({ balance: 2n ** 60n });
    expect(encoded).toBe('{"balance":{"__big_int__":"1152921504606846976"}}');

    const decoded = decodeRuntime<{ balance: bigint }>(encoded);
    expect(decoded?.balance).toBe(2n ** 60n);
  });

  it("signs canonical payload strings with Ed25519", () => {
    const signer = new Ed25519Signer("1".repeat(64));
    const message = canonicalizeRuntime({
      sender: signer.address,
      contract: "currency",
      function: "transfer",
      kwargs: { amount: "5", to: "bob" },
      nonce: 1,
      chi_supplied: 50000,
      chain_id: "xian-local"
    });

    const signature = signer.signMessage(message);
    expect(signature).toHaveLength(128);
    expect(verifyMessage(signer.address, message, signature)).toBe(true);
  });

  it("rejects non-hex key and signature material", () => {
    expect(() => hexToBytes("0xzz")).toThrow("non-hex characters");
    expect(isValidEd25519Key("z".repeat(64))).toBe(false);
    expect(isValidEd25519Signature("z".repeat(128))).toBe(false);
    expect(() => new Ed25519Signer("z".repeat(64))).toThrow(
      "private key must be a 32-byte hex string"
    );
  });

  it("canonicalizes unicode without ASCII escaping", () => {
    const canonical = canonicalizeRuntime({
      kwargs: { memo: "snowman: \u2603" }
    });

    expect(canonical).toBe('{"kwargs":{"memo":"snowman: ☃"}}');
  });

  it("canonicalizes runtime wrappers without decoding them", () => {
    const canonical = canonicalizeRuntime({
      kwargs: {
        amount: { __fixed__: "0.5" },
        units: 2n ** 80n
      }
    });

    expect(canonical).toBe(
      '{"kwargs":{"amount":{"__fixed__":"0.5"},"units":{"__big_int__":"1208925819614629174706176"}}}'
    );
  });
});
