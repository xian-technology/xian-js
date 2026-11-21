import { fixed, parseInteger } from "./numeric.js";

export function assertUnicode(text: string): void {
  if (/[\uD800-\uDFFF]/u.test(text)) {
    throw new TypeError("runtime text contains an unpaired surrogate");
  }
}

export function compareUnicodeCodePoints(left: string, right: string): number {
  const points = Array.from(right, (character) => character.codePointAt(0)!);
  let index = 0;
  for (const character of left) {
    const point = points[index++];
    if (point === undefined) return 1;
    const difference = character.codePointAt(0)! - point;
    if (difference !== 0) return difference;
  }
  return index - points.length;
}

function wireHex(value: unknown): string {
  if (typeof value !== "string" || !/^(?:[ \t\n\r\v\f]*[0-9a-fA-F]{2})*[ \t\n\r\v\f]*$/.test(value)) {
    throw new TypeError("invalid hex payload");
  }
  return value.replace(/[ \t\n\r\v\f]/g, "").toLowerCase();
}

export function decodeWireHex(value: string): Uint8Array {
  const hex = wireHex(value);
  return Uint8Array.from(hex.match(/../g) ?? [], (pair) => Number.parseInt(pair, 16));
}

function integerParts(value: unknown, min: number, max = min): number[] {
  if (!Array.isArray(value) || value.length < min || value.length > max ||
      !Array.from(value).every(Number.isSafeInteger)) {
    throw new TypeError("invalid runtime time components");
  }
  return value;
}

function checkDatetime(value: unknown, min: number): number[] {
  const parts = integerParts(value, min, 7);
  const [year, month, day, hour = 0, minute = 0, second = 0, micros = 0] = parts as [
    number, number, number, number?, number?, number?, number?
  ];
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const monthDays = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const fields = [year, month, day, hour, minute, second, micros];
  const minima = [1, 1, 1, 0, 0, 0, 0];
  const maxima = [9999, 12, monthDays[month - 1] ?? 0, 23, 59, 59, 999_999];
  if (fields.some((part, index) => part < minima[index]! || part > maxima[index]!)) {
    throw new RangeError("invalid datetime");
  }
  return parts;
}

function checkDelta(seconds: bigint): bigint {
  if (seconds < -86_399_999_913_600n || seconds > 86_399_999_999_999n) {
    throw new RangeError("timedelta overflow");
  }
  return seconds;
}

const TAGS = new Set([
  "__fixed__", "__big_int__", "__bytes__", "__bytearray__", "__time__", "__delta__", "__set__", "__frozenset__"
]);
const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);
const SCALE = 10n ** 30n;

function checkFixed(value: unknown): void {
  if (typeof value !== "string" || value.length > 93 || fixed(value).__fixed__ !== value) {
    throw new TypeError("noncanonical __fixed__ decimal");
  }
}

function checkWideInteger(value: unknown): void {
  const integer = parseInteger(value);
  if (integer >= -MAX_SAFE && integer <= MAX_SAFE) throw new TypeError("noncanonical __big_int__");
}

type SortKey = number | bigint | string | readonly SortKey[];
interface Member {
  order: SortKey;
  identity: SortKey;
}

function compareKeys(left: SortKey, right: SortKey): number {
  if (Array.isArray(left) && Array.isArray(right)) {
    for (let index = 0; index < Math.min(left.length, right.length); index += 1) {
      const difference = compareKeys(left[index], right[index]);
      if (difference !== 0) return difference;
    }
    return left.length - right.length;
  }
  if (typeof left === "string" && typeof right === "string") {
    return compareUnicodeCodePoints(left, right);
  }
  return left === right ? 0 : left < right ? -1 : 1;
}

function scalar(rank: number, value: SortKey): Member {
  const key = [rank, value];
  return { order: key, identity: key };
}

function integerMember(rank: number, value: unknown): Member {
  const integer = parseInteger(value);
  if (rank === 3 && (integer <= -(10n ** 91n) || integer >= 10n ** 91n)) {
    throw new RangeError("fixed set member exceeds decimal range");
  }
  return { order: [rank, integer], identity: [2, rank === 2 ? integer * SCALE : integer] };
}

function stringMember(value: unknown): Member {
  if (typeof value !== "string") throw new TypeError("invalid string set member");
  assertUnicode(value);
  return scalar(7, value);
}

function bytesMember(value: unknown): Member {
  const normalized = wireHex(value);
  if (normalized !== value) throw new TypeError("noncanonical bytes set member");
  return scalar(8, normalized);
}

function memberIdentity(member: Member): string {
  return JSON.stringify(member.identity, (_, value: unknown) =>
    typeof value === "bigint" ? value.toString() : value);
}

class SetReader {
  private work = 0;
  private nodes = 0;

  collection(items: unknown, depth = 1): Member[] {
    if (!Array.isArray(items)) throw new TypeError("set requires typed members");
    this.work += items.length ** 2;
    if (this.work > 8_388_608) throw new RangeError("set normalization work limit exceeded");
    const members = this.members(items, depth);
    const identities = new Set<string>();
    for (const [index, member] of members.entries()) {
      const previous = members[index - 1];
      const identity = memberIdentity(member);
      if (identities.has(identity) || (previous && compareKeys(previous.order, member.order) >= 0)) {
        throw new TypeError("noncanonical set codec members");
      }
      identities.add(identity);
    }
    return members;
  }

  private members(items: unknown[], depth: number): Member[] {
    if (depth > 64 || (this.nodes += items.length) > 131_072) {
      throw new RangeError("set depth or node limit exceeded");
    }
    return Array.from(items, (item) => this.member(item, depth));
  }

  private member(item: unknown, depth: number): Member {
    if (!Array.isArray(item)) throw new TypeError("invalid typed set member");
    const [tag, value] = item;
    if (tag === "none" && item.length === 1) return scalar(0, 0);
    if (item.length !== 2) throw new TypeError("invalid typed set member arity");
    if (tag === "tuple" && Array.isArray(value)) {
      return this.container(9, this.members(value, depth + 1));
    }
    if (tag === "frozenset") return this.container(10, this.collection(value, depth + 1));
    return this.scalarMember(tag, value);
  }

  private scalarMember(tag: unknown, value: unknown): Member {
    switch (tag) {
      case "bool":
        if (typeof value === "boolean") return scalar(1, Number(value));
        break;
      case "int": return integerMember(2, value);
      case "fixed": return integerMember(3, value);
      case "datetime": return scalar(5, checkDatetime(value, 7));
      case "timedelta": return scalar(6, checkDelta(parseInteger(value)));
      case "str": return stringMember(value);
      case "bytes": return bytesMember(value);
    }
    throw new TypeError("invalid typed set member payload");
  }

  private container(rank: number, members: Member[]): Member {
    const identity = rank === 10
      ? members.map(memberIdentity).sort()
      : members.map((member) => member.identity);
    return { order: [rank, members.map((member) => member.order)], identity: [rank, identity] };
  }
}

function checkSet(value: unknown): void {
  if (value == null || typeof value !== "object") throw new TypeError("invalid set codec envelope");
  const { codec, items } = value as { codec?: unknown; items?: unknown };
  if (codec !== "xian-set-1" || Object.keys(value).length !== 2) {
    throw new TypeError("invalid set codec envelope");
  }
  new SetReader().collection(items);
}

export function checkRuntimeWrapper(value: Record<string, unknown>): void {
  const keys = Object.keys(value);
  const tag = keys.find((key) => TAGS.has(key));
  if (tag === undefined) return;
  if (keys.length !== 1) throw new TypeError("runtime wrapper must contain a single key");
  const payload = value[tag];
  switch (tag) {
    case "__fixed__": checkFixed(payload); break;
    case "__big_int__": checkWideInteger(payload); break;
    case "__bytes__":
    case "__bytearray__": wireHex(payload); break;
    case "__time__": checkDatetime(payload, 3); break;
    case "__delta__": {
      const [days, seconds] = integerParts(payload, 2) as [number, number];
      checkDelta(BigInt(days) * 86_400n + BigInt(seconds));
      break;
    }
    default: checkSet(payload);
  }
}
