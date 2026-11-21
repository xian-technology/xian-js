import { DEFAULT_VM_PROFILE, checkInteger, fixed, type XianVmProfile } from "./numeric.js";
import { assertUnicode, checkRuntimeWrapper, compareUnicodeCodePoints, decodeWireHex } from "./runtime-wire.js";

const MIN_INT64 = -(2n ** 63n);
const MAX_INT64 = 2n ** 63n - 1n;
const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);

export function utf8ToBytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

export function bytesToUtf8(value: Uint8Array): string {
  return new TextDecoder("utf-8", { ignoreBOM: true, fatal: true }).decode(value);
}

export function bytesToHex(value: Uint8Array): string {
  return Array.from(value, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function hexToBytes(value: string): Uint8Array {
  const normalized = value.startsWith("0x") ? value.slice(2) : value;
  if (normalized.length % 2 !== 0) {
    throw new TypeError("hex string must contain an even number of characters");
  }
  if (!/^[0-9a-fA-F]*$/.test(normalized)) {
    throw new TypeError("hex string contains non-hex characters");
  }
  const out = new Uint8Array(normalized.length / 2);
  for (let index = 0; index < normalized.length; index += 2) {
    out[index / 2] = Number.parseInt(normalized.slice(index, index + 2), 16);
  }
  return out;
}

export function base64ToBytes(value: string): Uint8Array {
  if (typeof atob === "function") {
    return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
  }

  // Node.js runtimes that pre-date the global atob (added in Node 16) still
  // have Buffer available. Check for it before falling over so the SDK keeps
  // working in older server-side consumers.
  const maybeBuffer = (globalThis as { Buffer?: { from(input: string, encoding: string): Uint8Array } }).Buffer;
  if (maybeBuffer && typeof maybeBuffer.from === "function") {
    return maybeBuffer.from(value, "base64");
  }

  throw new TypeError("global atob() or Buffer is required to decode base64 payloads");
}

export function base64ToUtf8(value: string): string {
  return bytesToUtf8(base64ToBytes(value));
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

  // Define own properties, including __proto__, without invoking setters.
  return Object.fromEntries(
    Object.keys(value).sort(compareUnicodeCodePoints).map(
      (key) => [key, sortKeysDeep(value[key])]
    )
  ) as T;
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

function encodeNumber(value: number | bigint, profile: XianVmProfile): unknown {
  if (typeof value === "bigint") {
    if (profile === "xian_vm_v2") checkInteger(value);
    return encodeInt(value);
  }
  if (profile === "xian_vm_v2" && !Number.isSafeInteger(value)) {
    throw new TypeError("use bigint for large integers and fixed(text) for decimals");
  }
  if (!Number.isFinite(value)) throw new TypeError("finite numbers only");
  return Number.isInteger(value) ? encodeInt(value) : value;
}

function encodeRecord(value: Record<string, unknown>, profile: XianVmProfile, depth: number): unknown {
  if (profile === "xian_vm_v2") checkRuntimeWrapper(value);
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => {
      if (profile === "xian_vm_v2") assertUnicode(key);
      return [key, encodeValue(entry, profile, depth + 1)];
    })
  );
}

function encodeValue(value: unknown, profile: XianVmProfile, depth = 0): unknown {
  if (depth > 128) throw new RangeError("runtime value traversal limit exceeded");
  if (typeof value === "string") {
    if (profile === "xian_vm_v2") assertUnicode(value);
    return value;
  }
  if (typeof value === "number" || typeof value === "bigint") {
    return encodeNumber(value, profile);
  }
  if (value instanceof Uint8Array) {
    return { __bytes__: bytesToHex(value) };
  }
  if (Array.isArray(value)) {
    return Array.from(value, (item) => encodeValue(item, profile, depth + 1));
  }
  if (isPlainObject(value)) return encodeRecord(value, profile, depth);
  if (profile === "xian_vm_v2" && value !== null && typeof value !== "boolean") {
    throw new TypeError("unsupported runtime value");
  }
  return value;
}

function stringifyCanonical(value: unknown): string | undefined {
  if (Array.isArray(value)) {
    return `[${Array.from(value, (item) => stringifyCanonical(item) ?? "null").join(",")}]`;
  }
  if (isPlainObject(value)) {
    const fields: string[] = [];
    for (const key of Object.keys(value).sort(compareUnicodeCodePoints)) {
      const encoded = stringifyCanonical(value[key]);
      if (encoded !== undefined) {
        fields.push(`${JSON.stringify(key)}:${encoded}`);
      }
    }
    return `{${fields.join(",")}}`;
  }
  return JSON.stringify(value);
}

export function encodeRuntime(value: unknown, profile: XianVmProfile = DEFAULT_VM_PROFILE): string {
  // Object enumeration reorders integer-index keys, so emit pairs directly.
  const encoded = stringifyCanonical(encodeValue(value, profile));
  if (encoded === undefined) {
    throw new TypeError("value must be JSON-serializable");
  }
  return encoded;
}

// A full quoted string is one token, so digits inside keys and strings stay untouched.
const JSON_STRING_OR_NUMBER = /"(?:\\[\s\S]|[^"\\])*"|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/g;

function numericToken(token: string, mode: XianVmProfile | "source"): string {
  if (token.startsWith('"')) return token;
  if (/[.eE]/.test(token)) {
    if (mode === "source") return JSON.stringify(fixed(token));
    if (mode === "xian_vm_v2") throw new TypeError("bare decimal in contract data");
    return token;
  }
  if (mode === "xian_vm_v2" && token === "-0") throw new TypeError("noncanonical integer");
  if (mode !== "xian_vm_v1" && token.length > 156) throw new RangeError("integer exceeds 512 bits");
  const integer = BigInt(token);
  if (integer >= -MAX_SAFE && integer <= MAX_SAFE) return token;
  if (mode === "xian_vm_v2") throw new RangeError("large bare integer requires __big_int__");
  return JSON.stringify({ __big_int__: token });
}

function parseRuntimeJson(text: string, mode: XianVmProfile | "source"): unknown {
  // Validate the original source first. The parsed Numbers are discarded.
  // The replacement keeps exact digits on engines without reviver context.source.
  JSON.parse(text);
  return JSON.parse(text.replace(JSON_STRING_OR_NUMBER, (token) => numericToken(token, mode)));
}

/** Keep the exact JSON values and tags in an already-signed V2 document. */
export function parseTransactionWire(text: string, profile: XianVmProfile): unknown {
  const value = profile === "xian_vm_v2" ? parseRuntimeJson(text, profile) : JSON.parse(text);
  if (profile === "xian_vm_v2") encodeValue(value, profile);
  return value;
}

/** Parse contract input JSON from text before JavaScript can round numeric tokens. */
export function parseContractJson(text: string): unknown {
  return encodeValue(parseRuntimeJson(text, "source"), "xian_vm_v2");
}

function decodeValue(value: unknown, profile: XianVmProfile): unknown {
  if (profile === "xian_vm_v2" && typeof value === "number" && !Number.isSafeInteger(value)) {
    throw new TypeError("invalid numeric wire value");
  }
  if (!isPlainObject(value)) {
    if (Array.isArray(value)) {
      return value.map((item) => decodeValue(item, profile));
    }
    return value;
  }

  if (profile === "xian_vm_v2") checkRuntimeWrapper(value);
  if ("__big_int__" in value && typeof value.__big_int__ === "string") {
    return BigInt(value.__big_int__);
  }
  if ("__bytes__" in value && typeof value.__bytes__ === "string") {
    return profile === "xian_vm_v2" ? decodeWireHex(value.__bytes__) : hexToBytes(value.__bytes__);
  }
  if ("__fixed__" in value && typeof value.__fixed__ === "string") {
    return profile === "xian_vm_v2" ? value : value.__fixed__;
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [key, decodeValue(entry, profile)])
  );
}

export function decodeRuntime<T = unknown>(value: string | Uint8Array | null | undefined, profile: XianVmProfile = DEFAULT_VM_PROFILE): T | null {
  if (value == null) {
    return null;
  }
  const text = value instanceof Uint8Array ? bytesToUtf8(value) : value;
  try {
    return decodeValue(parseRuntimeJson(text, profile), profile) as T;
  } catch {
    return null;
  }
}

export function canonicalizeRuntime(value: unknown, profile: XianVmProfile = DEFAULT_VM_PROFILE): string {
  return encodeRuntime(value, profile);
}

export function parseXianNumber(value: string): number | bigint {
  const normalized = BigInt(value);
  return normalized >= -MAX_SAFE && normalized <= MAX_SAFE ? Number(normalized) : normalized;
}

/**
 * Normalize an unknown value to a JS number or bigint if it looks like an
 * integer, preserving precision for values that don't fit in Number. Returns
 * null for anything that isn't a plain integer representation.
 */
export function normalizeMaybeXianNumber(value: unknown): number | bigint | null {
  if (value == null) {
    return null;
  }
  if (typeof value === "number" || typeof value === "bigint") {
    return value;
  }
  if (typeof value === "string" && /^-?\d+$/.test(value)) {
    return parseXianNumber(value);
  }
  return null;
}

/**
 * Normalize an unknown value to a safe JS integer. Returns null when the
 * input isn't a plain integer. Callers that need big-integer precision
 * should use {@link normalizeMaybeXianNumber} instead.
 */
export function normalizeMaybeInteger(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value)) {
    return Number.isSafeInteger(value) ? value : null;
  }
  if (typeof value === "string" && /^-?\d+$/.test(value)) {
    const parsed = BigInt(value);
    return parsed >= -MAX_SAFE && parsed <= MAX_SAFE ? Number(parsed) : null;
  }
  return null;
}

/** Normalize an unknown value to a string (or null if missing). */
export function normalizeMaybeString(value: unknown): string | null {
  if (value == null) {
    return null;
  }
  return typeof value === "string" ? value : String(value);
}
