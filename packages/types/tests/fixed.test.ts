import { expect, it } from "vitest";
import { fixed } from "../src/fixed";

it("accepts each fixed-point boundary and rejects the adjacent value", () => {
  const max = "9".repeat(61) + "." + "9".repeat(30);
  const minUnit = "0." + "0".repeat(29) + "1";
  for (const sign of ["", "-"]) {
    expect(fixed(sign + max).__fixed__).toBe(sign + max);
    expect(fixed(sign + minUnit).__fixed__).toBe(sign + minUnit);
    expect(() => fixed(sign + "1e61")).toThrow(RangeError);
    expect(() => fixed(sign + "1e-31")).toThrow(RangeError);
  }
});
