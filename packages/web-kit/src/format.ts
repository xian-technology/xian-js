export function toNumber(value: unknown): number {
  if (value == null) {
    return 0;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }
  if (typeof value === "bigint") {
    return Number(value);
  }
  if (typeof value === "boolean") {
    return value ? 1 : 0;
  }
  const text = String(value).trim();
  if (!text || text === "null" || text === "undefined") {
    return 0;
  }
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function shortAddress(
  value: string | null | undefined,
  head = 6,
  tail = 4
): string {
  if (!value) {
    return "—";
  }
  if (value.length <= head + tail + 1) {
    return value;
  }
  return `${value.slice(0, head)}…${value.slice(-tail)}`;
}

export async function copyToClipboard(text: string): Promise<boolean> {
  if (typeof navigator === "undefined" || !navigator.clipboard) {
    return false;
  }
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function maybeDate(value: unknown): Date | null {
  if (value == null) {
    return null;
  }
  if (typeof value === "object" && "__time__" in value) {
    const rawParts = (value as { __time__: unknown }).__time__;
    if (Array.isArray(rawParts) && rawParts.length >= 6) {
      const parts = rawParts.map(toNumber);
      return new Date(
        Date.UTC(
          parts[0] ?? 0,
          (parts[1] ?? 1) - 1,
          parts[2] ?? 1,
          parts[3] ?? 0,
          parts[4] ?? 0,
          parts[5] ?? 0,
          Math.floor((parts[6] ?? 0) / 1000)
        )
      );
    }
  }
  if (typeof value === "string" || typeof value === "number") {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) {
      return date;
    }
  }
  return null;
}
