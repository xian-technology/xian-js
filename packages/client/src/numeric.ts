import { fixed } from "@xian-tech/types";
export { fixed } from "@xian-tech/types";

/** Wire rules pinned by the chain at genesis. */
export type XianVmProfile = "xian_vm_v1" | "xian_vm_v2";

export const DEFAULT_VM_PROFILE: XianVmProfile = "xian_vm_v2";

const MAX_INTEGER = (1n << 512n) - 1n;
const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);
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

function checkSetMember(node: unknown): void {
  if (!Array.isArray(node)) throw new TypeError("invalid typed set member");
  const [kind, value] = node;
  if (kind === "float" || kind === "raw_decimal")
    throw new TypeError("unsupported numeric set member");
  if (kind === "int") parseInteger(value);
  if (
    kind === "fixed" &&
    (typeof value !== "string" || value.replace(/^-/, "").length > 91)
  ) {
    throw new RangeError("fixed set member exceeds decimal range");
  }
  if (kind === "fixed") parseInteger(value);
  if (kind === "tuple" || kind === "frozenset") {
    if (!Array.isArray(value)) throw new TypeError("invalid nested set member");
    value.forEach(checkSetMember);
  }
}

export function checkNumericWrapper(value: Record<string, unknown>): void {
  const keys = Object.keys(value);
  for (const key of keys) {
    if (!["__fixed__", "__big_int__", "__set__", "__frozenset__"].includes(key))
      continue;
    if (keys.length !== 1)
      throw new TypeError("runtime wrapper must contain a single key");
    const payload = value[key];
    if (key === "__fixed__") {
      if (
        typeof payload !== "string" ||
        payload.length > 93 ||
        fixed(payload).__fixed__ !== payload
      ) {
        throw new TypeError("noncanonical __fixed__ decimal");
      }
    } else if (key === "__big_int__") {
      const integer = parseInteger(payload);
      if (integer >= -MAX_SAFE && integer <= MAX_SAFE)
        throw new TypeError("noncanonical __big_int__");
    } else {
      const set = payload as { codec?: string; items?: unknown } | null;
      if (set?.codec !== "xian-set-1" || !Array.isArray(set.items)) {
        throw new TypeError("set requires a typed member envelope");
      }
      set.items.forEach(checkSetMember);
    }
  }
}
