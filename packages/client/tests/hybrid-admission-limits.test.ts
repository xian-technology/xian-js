import { beforeEach, describe, expect, it, vi } from "vitest";
import { pbkdf2Async } from "@noble/hashes/pbkdf2.js";
import { canonicalAccountJson, decryptAccountBackup } from "../src/hybrid.js";

vi.mock("@noble/hashes/pbkdf2.js", () => ({
  pbkdf2Async: vi.fn(() => { throw new Error("unexpected password derivation"); }),
}));

describe("account input resource bounds", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects cyclic and excessively deep objects at the protocol depth bound", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.next = cyclic;
    let deep: unknown = null;
    for (let i = 0; i < 10000; i++) deep = { next: deep };
    for (const value of [cyclic, deep])
      expect(() => canonicalAccountJson(value)).toThrow("account JSON too deep");
  });

  it("visits nested values once and preserves code-point and integer-key ordering", () => {
    let reads = 0;
    let value: unknown = 0;
    for (let i = 0; i < 100; i++) {
      const child = value;
      value = Object.defineProperty({}, "next", {
        enumerable: true,
        get() { reads++; return child; },
      });
    }
    expect(canonicalAccountJson(value)).toBe('{"next":'.repeat(100) + "0" + "}".repeat(100));
    expect(reads).toBe(100);
    expect(canonicalAccountJson(JSON.parse('{"😀":1,"\ue000":2,"2":3,"10":4,"__proto__":5}')))
      .toBe('{"10":4,"2":3,"__proto__":5,"\ue000":2,"😀":1}');
  });

  it.each([
    { iterations: 600001 }, { iterations: "600000" }, { salt: "00".repeat(17) },
    { iv: "zz".repeat(12) }, { ciphertext: "00".repeat(50001) },
    { ciphertext: "a".repeat(33) }, { ciphertext: "zz".repeat(16) },
    { ciphertext: "00".repeat(15) }, { extra: true },
  ])("rejects malformed backup envelopes before password derivation: %j", async mutation => {
    const envelope = { version: 1, kind: "xian-account-backup-encrypted", iterations: 600000,
      salt: "00".repeat(16), iv: "00".repeat(12), ciphertext: "00".repeat(16), ...mutation };
    await expect(decryptAccountBackup(JSON.stringify(envelope), "password")).rejects.toThrow();
    expect(pbkdf2Async).not.toHaveBeenCalled();
  });
});
