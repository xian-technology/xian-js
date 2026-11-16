import { describe, expect, it } from "vitest";
import { normalizeXianRecipient } from "../src/index.js";

describe("normalizeXianRecipient", () => {
  it("uses the canonical spendable spelling of hex public keys", () => {
    expect(normalizeXianRecipient(`  ${"aB".repeat(32)}  `)).toBe("ab".repeat(32));
    expect(normalizeXianRecipient("AB".repeat(32))).toBe("ab".repeat(32));
    expect(normalizeXianRecipient("ab".repeat(32))).toBe("ab".repeat(32));
  });

  it("preserves named and nonstandard recipients instead of changing their identity", () => {
    for (const value of ["currency", "con_MixedCase", "AB", "g".repeat(64), "external:AbC"]) {
      expect(normalizeXianRecipient(` ${value} `)).toBe(value);
    }
  });
});
