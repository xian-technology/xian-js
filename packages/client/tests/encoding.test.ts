import { describe, expect, it } from "vitest";

import {
  Ed25519Signer,
  canonicalizeRuntime,
  createXianMessageSigningPayload,
  decodeRuntime,
  encodeRuntime,
  fixed,
  isValidEd25519Key,
  isValidEd25519Signature,
  parseXianNumber,
  parseContractJson,
  signXianMessage,
  verifyMessage,
  verifyXianMessage
} from "../src/index";
import { hexToBytes, normalizeMaybeInteger } from "../src/encoding";

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

  it("preserves unsafe integer literals while decoding runtime JSON", () => {
    expect(decodeRuntime("-9007199254740992")).toBe(-9007199254740992n);
    expect(
      decodeRuntime(
        '{"safe":42,"unsafe":-9007199254740992,"text":"-9007199254740992"}'
      )
    ).toEqual({
      safe: 42,
      unsafe: -9007199254740992n,
      text: "-9007199254740992"
    });
  });

  it("preserves unsafe negative Xian integers as bigint", () => {
    const unsafeNegative = "-9007199254740992";

    expect(parseXianNumber(unsafeNegative)).toBe(-9007199254740992n);
    expect(normalizeMaybeInteger(unsafeNegative)).toBeNull();
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

  it("domain-separates external messages by version, chain, and account", () => {
    const privateKey = "1".repeat(64);
    const signer = new Ed25519Signer(privateKey);
    const input = {
      account: signer.address,
      chainId: "xian-local",
      message: "approve snowman ☃"
    };
    const payload = createXianMessageSigningPayload(input);
    expect(payload).toBe(
      `\u0019Xian Signed Message:\n1\nchain-id:10:xian-local\naccount:64:${signer.address}\nmessage:19:approve snowman ☃`
    );

    const signature = signXianMessage(privateKey, input);
    expect(verifyXianMessage(signer.address, input, signature)).toBe(true);
    expect(verifyMessage(signer.address, input.message, signature)).toBe(false);
    expect(
      verifyXianMessage(
        signer.address,
        { ...input, chainId: "xian-other" },
        signature
      )
    ).toBe(false);
    const otherAccount = new Ed25519Signer("2".repeat(64)).address;
    expect(
      verifyXianMessage(
        signer.address,
        { ...input, account: otherAccount },
        signature
      )
    ).toBe(false);
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

  it("sorts nested unicode object keys by code point", () => {
    const canonical = canonicalizeRuntime({
      kwargs: {
        nested: {
          "😀": "grinning",
          "\uE000": "private-use"
        }
      }
    });

    expect(canonical).toBe(
      '{"kwargs":{"nested":{"\uE000":"private-use","😀":"grinning"}}}'
    );
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

describe("exact contract decimal input", () => {
  it("parses coefficients directly and preserves all 30 fractional places", () => {
    const amount = "9007199254740993.123456789012345678901234567891";
    expect(fixed(amount)).toEqual({ __fixed__: amount });
    for (const bad of ["1.0000000000000001", "1.0", "-0", "9e-400", "9007199254740992"]) {
      expect(decodeRuntime(`{"nested":[${bad}]}`, "xian_vm_v2")).toBeNull();
    }
    expect(fixed("-0e60")).toEqual({ __fixed__: "0" });
    expect(fixed("+.01000E+2")).toEqual({ __fixed__: "1" });
    expect(fixed("10e-31")).toEqual({ __fixed__: "0." + "0".repeat(29) + "1" });
    for (const invalid of ["1e61", "1e-31", "1e10000000", "Inf", " 1", "1_2", "."]) {
      expect(() => fixed(invalid)).toThrow();
    }
  });
});

it("reads user JSON amounts before host-number coercion", () => {
  expect(parseContractJson('{"x":[1.00000000000000001,9007199254740993,"1e-3", 2e-30]}')).toEqual({
    x: [{__fixed__: "1.00000000000000001"}, {__big_int__: "9007199254740993"}, "1e-3", fixed("2e-30")]
  });
  for (const input of ["1.", "1e+", "[.5]", "01", "{bad}"]) expect(() => parseContractJson(input)).toThrow(SyntaxError);
  for (const input of ["1e-31", '{"__fixed__":"01"}', String(1n << 512n)]) expect(() => parseContractJson(input)).toThrow();
});
