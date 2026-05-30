import { describe, expect, it } from "vitest";

import { maybeDate, shortAddress, toNumber } from "../src/index";

describe("@xian-tech/web-kit format helpers", () => {
  it("normalizes numeric values from runtime shapes", () => {
    expect(toNumber(null)).toBe(0);
    expect(toNumber(true)).toBe(1);
    expect(toNumber("12.5")).toBe(12.5);
    expect(toNumber("not-a-number")).toBe(0);
  });

  it("shortens addresses with configurable head and tail lengths", () => {
    expect(shortAddress("abcdef1234567890", 4, 3)).toBe("abcd…890");
    expect(shortAddress(null)).toBe("—");
  });

  it("decodes Xian runtime datetime objects", () => {
    expect(
      maybeDate({ __time__: [2026, 5, 29, 12, 30, 15, 123000] })?.toISOString()
    ).toBe("2026-05-29T12:30:15.123Z");
  });
});
