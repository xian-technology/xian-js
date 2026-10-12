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
});
