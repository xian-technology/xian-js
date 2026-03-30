const MIN_INT64 = -(2n ** 63n);
const MAX_INT64 = 2n ** 63n - 1n;
const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);

export function utf8ToBytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

export function bytesToUtf8(value: Uint8Array): string {
  return new TextDecoder().decode(value);
}

export function bytesToHex(value: Uint8Array): string {
  return Array.from(value, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function hexToBytes(value: string): Uint8Array {
  const normalized = value.startsWith("0x") ? value.slice(2) : value;
  if (normalized.length % 2 !== 0) {
    throw new TypeError("hex string must contain an even number of characters");
  }
  const out = new Uint8Array(normalized.length / 2);
  for (let index = 0; index < normalized.length; index += 2) {
    out[index / 2] = Number.parseInt(normalized.slice(index, index + 2), 16);
  }
  return out;
}

export function base64ToUtf8(value: string): string {
  if (typeof atob === "function") {
    return bytesToUtf8(
      Uint8Array.from(atob(value), (character) => character.charCodeAt(0))
    );
  }

  throw new TypeError("global atob() is required to decode base64 payloads");
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Object.prototype.toString.call(value) === "[object Object]";
}

export function sortKeysDeep<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => sortKeysDeep(item)) as T;
  }
  if (value instanceof Uint8Array || !isPlainObject(value)) {
    return value;
  }

  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) {
    sorted[key] = sortKeysDeep(value[key]);
  }
  return sorted as T;
}

function encodeInt(value: bigint | number): bigint | number | { __big_int__: string } {
  const normalized = typeof value === "bigint" ? value : BigInt(value);
  const inPythonIntRange = normalized > MIN_INT64 && normalized < MAX_INT64;
  const inSafeJsRange = normalized >= -MAX_SAFE && normalized <= MAX_SAFE;

  if (inPythonIntRange && inSafeJsRange) {
    return Number(normalized);
  }

  return { __big_int__: normalized.toString() };
}

function encodeValue(value: unknown): unknown {
  if (typeof value === "bigint") {
    return encodeInt(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError("finite numbers only");
    }
    if (Number.isInteger(value)) {
      return encodeInt(value);
    }
    return value;
  }
  if (value instanceof Uint8Array) {
    return { __bytes__: bytesToHex(value) };
  }
  if (Array.isArray(value)) {
    return value.map((item) => encodeValue(item));
  }
  if (isPlainObject(value)) {
    const sorted = sortKeysDeep(value);
    const encoded: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(sorted)) {
      encoded[key] = encodeValue(entry);
    }
    return encoded;
  }
  return value;
}

export function encodeRuntime(value: unknown): string {
  return JSON.stringify(encodeValue(value));
}

function decodeValue(value: unknown): unknown {
  if (!isPlainObject(value)) {
    if (Array.isArray(value)) {
      return value.map((item) => decodeValue(item));
    }
    return value;
  }

  if ("__big_int__" in value && typeof value.__big_int__ === "string") {
    return BigInt(value.__big_int__);
  }
  if ("__bytes__" in value && typeof value.__bytes__ === "string") {
    return hexToBytes(value.__bytes__);
  }
  if ("__fixed__" in value && typeof value.__fixed__ === "string") {
    return value.__fixed__;
  }

  const decoded: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    decoded[key] = decodeValue(entry);
  }
  return decoded;
}

export function decodeRuntime<T = unknown>(value: string | Uint8Array | null | undefined): T | null {
  if (value == null) {
    return null;
  }
  const text = value instanceof Uint8Array ? bytesToUtf8(value) : value;
  try {
    return decodeValue(JSON.parse(text)) as T;
  } catch {
    return null;
  }
}

export function canonicalizeRuntime(value: unknown): string {
  const sorted = sortKeysDeep(value);
  const roundTripped = decodeRuntime(encodeRuntime(sorted));
  return encodeRuntime(roundTripped);
}

export function parseXianNumber(value: string): number | bigint {
  const normalized = BigInt(value);
  return normalized <= MAX_SAFE ? Number(normalized) : normalized;
}
