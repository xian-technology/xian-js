import { TransportError } from "./errors.js";

export function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null) {
    throw new TransportError("expected object response");
  }
  return value as Record<string, unknown>;
}

export function readErrorMessage(value: Record<string, unknown>): string {
  const data = value.data;
  if (typeof data === "string" && data.length > 0) {
    return data;
  }
  const message = value.message;
  if (typeof message === "string" && message.length > 0) {
    return message;
  }
  return "RPC error";
}
