import { describe, expect, it } from "vitest";
import { publicKeyFromPrivateKey, signMessage, verifyMessage } from "../src/ed25519.js";

describe("Ed25519 rejection policy", () => {
  it.each([
    "01" + "00".repeat(31),
    "00".repeat(32),
    "ec" + "ff".repeat(30) + "7f",
    "ee" + "ff".repeat(30) + "7f"
  ])("rejects low-order and noncanonical keys %s", (key) => {
    expect(verifyMessage(key, "xian parity test", "01" + "00".repeat(63))).toBe(false);
  });
  it("rejects noncanonical S even when NaCl's equation would accept it", () => {
    const seed = "11".repeat(32);
    const key = publicKeyFromPrivateKey(seed);
    const sig = signMessage(seed, "xian parity test");
    expect(verifyMessage(key, "xian parity test", sig)).toBe(true);
    const scalar = BigInt("0x" + sig.slice(64).match(/../g)!.reverse().join(""));
    const order = 2n ** 252n + 27742317777372353535851937790883648493n;
    const noncanonical = (scalar + order).toString(16).padStart(64, "0").match(/../g)!.reverse().join("");
    expect(verifyMessage(key, "xian parity test", sig.slice(0, 64) + noncanonical)).toBe(false);
  });
  it("accepts RFC8032 test vector 1", () => {
    expect(verifyMessage(
      "d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a", "",
      "e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901555fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b"
    )).toBe(true);
  });
  it.each([
    ["small-order R", "0100000000000000000000000000000000000000000000000000000000000000edaf87719b1f81c47646a414a04a0710b9c7ff5918a34e01e53c30bb2e2f5f00"],
    ["mixed-order R", "5252cc0a7f208133b620acbd4537eba2a4123bf0a8c2e4f980c3b31bb69765ea7e38ee9f538979938c47d1e0f5577a489466ef86883378ba092d0b1de2f59307"]
  ])("rejects %s with a prime-order public key", (_label, signature) => {
    // Constructed with known scalar a: S = r + H(R, A, message) * a mod L.
    // R is the identity (r=0), or B plus an order-four point (r=1).
    expect(verifyMessage(
      "d04ab232742bb4ab3a1368bd4615e4e6d0224ab71a016baf8520a332c9778737",
      "xian parity test",
      signature
    )).toBe(false);
  });
  it("rejects a small-order public key with a non-small-order signature point", () => {
    // A is the identity, R is B and S is 1: the uncofactored equation holds.
    expect(verifyMessage(
      "01" + "00".repeat(31),
      "xian parity test",
      "58" + "66".repeat(31) + "01" + "00".repeat(31)
    )).toBe(false);
  });
  it.each([
    ["short key", "11", "00".repeat(64)],
    ["short signature", "11".repeat(32), "00"],
    ["invalid point", "11".repeat(32), "ff".repeat(32) + "00".repeat(32)]
  ])("rejects malformed input: %s", (_label, key, signature) => {
    expect(verifyMessage(key, "xian parity test", signature)).toBe(false);
  });
});
