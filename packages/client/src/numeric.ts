export { fixed } from "@xian-tech/types";

/** Get decimal text for display from a V2 decimal result. */
export function fixedValueText(value: unknown): string | undefined {
  if (value != null && typeof value === "object" && Object.hasOwn(value, "__fixed__")) {
    const text = (value as { __fixed__: unknown }).__fixed__;
    if (typeof text === "string") return text;
  }
}

/** Wire rules pinned by the chain at genesis. */
export type XianVmProfile = "xian_vm_v1" | "xian_vm_v2";

export const DEFAULT_VM_PROFILE: XianVmProfile = "xian_vm_v2";

const MAX_INTEGER = (1n << 512n) - 1n;
export function checkInteger(value: bigint): void {
  if (value < -MAX_INTEGER || value > MAX_INTEGER)
    throw new RangeError("integer exceeds 512 bits");
}

export function parseInteger(text: unknown): bigint {
  if (
    typeof text !== "string" ||
    text.length > 156 ||
    !/^-?(?:0|[1-9]\d*)$/.test(text)
  ) {
    throw new TypeError("invalid integer spelling");
  }
  const value = BigInt(text);
  if (String(value) !== text)
    throw new TypeError("noncanonical integer spelling");
  checkInteger(value);
  return value;
}
