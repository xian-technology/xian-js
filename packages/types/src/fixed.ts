const DECIMAL = /^([+-]?)(?:(\d+)(?:\.(\d*))?|\.(\d+))(?:[eE]([+-]?\d+))?$/;

export function fixed(value: string): { __fixed__: string } {
  if (typeof value !== "string")
    throw new TypeError("fixed requires decimal text");
  const match = DECIMAL.exec(value);
  if (!match || match[0] !== value)
    throw new TypeError("invalid decimal spelling");
  const whole = match[2] ?? "";
  const digits = whole + (match[3] ?? match[4] ?? "");
  const significant = digits.replace(/^0+/, "");
  if (!significant.length) return { __fixed__: "0" };
  const point =
    whole.length - (digits.length - significant.length) + Number(match[5] ?? 0);
  const coefficient = significant.replace(/0+$/, "");
  if (point > 61 || coefficient.length - point > 30) {
    throw new RangeError("decimal exceeds scale 30 or the supported range");
  }
  let text: string;
  if (point <= 0) text = "0." + "0".repeat(-point) + coefficient;
  else if (point >= coefficient.length) text = coefficient.padEnd(point, "0");
  else text = coefficient.slice(0, point) + "." + coefficient.slice(point);
  return { __fixed__: (match[1] === "-" ? "-" : "") + text };
}
