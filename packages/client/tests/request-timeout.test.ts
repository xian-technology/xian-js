import { afterEach, describe, expect, it, vi } from "vitest";
import { getEventListeners } from "node:events";
import { mergeAbortSignals } from "../src/client";

import { XianClient, XianShieldedRelayerClient } from "../src/index";

const factories = [
  {
    name: "RPC",
    request: (fetchFn: typeof fetch) => new XianClient({
      rpcUrl: "http://127.0.0.1:26657", fetchFn, requestTimeoutMs: 50
    }).getStatus()
  },
  {
    name: "relayer",
    request: (fetchFn: typeof fetch) => new XianShieldedRelayerClient({
      relayerUrl: "http://127.0.0.1:38180", fetchFn, requestTimeoutMs: 50
    }).getInfo()
  }
];

afterEach(() => vi.useRealTimers());

describe.each(factories)("$name HTTP deadline", ({ request }) => {
  it("aborts a stalled response body after headers have arrived", async () => {
    vi.useFakeTimers();
    let body!: ReadableStreamDefaultController<Uint8Array>;
    let signal: AbortSignal | null | undefined;
    const fetchFn = vi.fn(async (_input, init) => {
      signal = init?.signal;
      return new Response(new ReadableStream<Uint8Array>({
        start(controller) {
          body = controller;
          controller.enqueue(new TextEncoder().encode('{"result":'));
          signal?.addEventListener("abort", () => controller.error(signal?.reason), { once: true });
        }
      }));
    }) as typeof fetch;
    let outcome: unknown;
    const pending = request(fetchFn).catch((error: unknown) => { outcome = error; });
    try {
      await vi.advanceTimersByTimeAsync(100);
      expect(signal?.aborted).toBe(true);
      expect(outcome).toBeInstanceOf(Error);
      expect((outcome as Error).message).toContain("timed out after 50ms");
    } finally {
      body.error(new Error("test cleanup"));
      await pending;
    }
  });
});

describe.each(factories)("$name HTTP response handling", ({ request }) => {
  it("cleans up the deadline after a complete response", async () => {
    vi.useFakeTimers();
    const fetchFn = vi.fn(async () => new Response('{}')) as typeof fetch;
    await request(fetchFn);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("retains JSON errors and clears their deadline", async () => {
    vi.useFakeTimers();
    const fetchFn = vi.fn(async () => new Response('invalid-json')) as typeof fetch;
    await expect(request(fetchFn)).rejects.toThrow("invalid JSON response");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("retains transport failures and clears their deadline", async () => {
    vi.useFakeTimers();
    const fetchFn = vi.fn(async () => { throw new Error("offline"); }) as typeof fetch;
    await expect(request(fetchFn)).rejects.toThrow("request failed");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps a deadline while awaiting response headers", async () => {
    vi.useFakeTimers();
    const fetchFn = vi.fn(async (_input, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
    })) as typeof fetch;
    let outcome: unknown;
    const pending = request(fetchFn).catch((error: unknown) => { outcome = error; });
    await vi.advanceTimersByTimeAsync(50);
    await pending;
    expect((outcome as Error).message).toContain("timed out after 50ms");
    expect(vi.getTimerCount()).toBe(0);
  });
});

it("preserves caller cancellation while consuming an RPC body", async () => {
  vi.useFakeTimers();
  const caller = new AbortController();
  const reason = new Error("caller cancelled");
  let headersArrived!: () => void;
  const headers = new Promise<void>((resolve) => { headersArrived = resolve; });
  const fetchFn = vi.fn(async (_input, init) => {
    const response = new Response(new ReadableStream({
      start(controller) {
        init?.signal?.addEventListener("abort", () => controller.error(init.signal?.reason), { once: true });
      }
    }));
    headersArrived();
    return response;
  }) as typeof fetch;
  const client = new XianClient({ rpcUrl: "http://127.0.0.1:26657", fetchFn, requestTimeoutMs: 50 });
  const pending = client.abciQuery("/state/key", { signal: caller.signal }).catch((error: unknown) => error);
  await headers;
  caller.abort(reason);
  expect(await pending).toBe(reason);
  expect(vi.getTimerCount()).toBe(0);
});

it.each([0, -1])("keeps disabled HTTP deadlines disabled (%s)", async (timeoutMs) => {
  vi.useFakeTimers();
  let body!: ReadableStreamDefaultController<Uint8Array>;
  const fetchFn = vi.fn(async (_input, init) => {
    expect(init?.signal).toBeUndefined();
    return new Response(new ReadableStream<Uint8Array>({ start(controller) { body = controller; } }));
  }) as typeof fetch;
  const client = new XianClient({ rpcUrl: "http://127.0.0.1:26657", fetchFn, requestTimeoutMs: timeoutMs });
  const pending = client.getStatus();
  await vi.advanceTimersByTimeAsync(100);
  expect(vi.getTimerCount()).toBe(0);
  body.enqueue(new TextEncoder().encode('{"ready":true}'));
  body.close();
  await expect(pending).resolves.toEqual({ ready: true });
});

it("allows a per-call deadline to override the client default", async () => {
  vi.useFakeTimers();
  const fetchFn = vi.fn(async (_input, init) => new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
  })) as typeof fetch;
  const client = new XianClient({ rpcUrl: "http://127.0.0.1:26657", fetchFn, requestTimeoutMs: 50 });
  const pending = client.abciQuery("/state/key", { timeoutMs: 1 }).catch((error: unknown) => error);
  await vi.advanceTimersByTimeAsync(1);
  expect((await pending as Error).message).toContain("timed out after 1ms");
});

it.each(["invalid-json", "offline"])("retains %s errors with the deadline disabled", async (failure) => {
  const fetchFn = vi.fn(async () => {
    if (failure === "offline") throw new Error("offline");
    return new Response("invalid-json");
  }) as typeof fetch;
  const client = new XianClient({ rpcUrl: "http://127.0.0.1:26657", fetchFn, requestTimeoutMs: 0 });
  await expect(client.getStatus()).rejects.toThrow(
    failure === "offline" ? "request failed" : "invalid JSON response"
  );
});

it("releases fallback abort listeners after a successful request", async () => {
  const original = Object.getOwnPropertyDescriptor(AbortSignal, "any")!;
  Object.defineProperty(AbortSignal, "any", { ...original, value: undefined });
  try {
    const caller = new AbortController();
    const fetchFn = vi.fn(async () => new Response('{"result":{"response":{"code":0}}}')) as typeof fetch;
    const client = new XianClient({ rpcUrl: "http://127.0.0.1:26657", fetchFn });
    for (let index = 0; index < 5; index += 1) {
      await client.abciQuery("/state/key", { signal: caller.signal });
    }
    expect(getEventListeners(caller.signal, "abort")).toHaveLength(0);
  } finally {
    Object.defineProperty(AbortSignal, "any", original);
  }
});

it.each([false, true])("preserves composed abort reasons and releases listeners (fallback=%s)", (fallback) => {
  const original = Object.getOwnPropertyDescriptor(AbortSignal, "any")!;
  if (fallback) Object.defineProperty(AbortSignal, "any", { ...original, value: undefined });
  try {
    for (const source of [0, 1]) {
      const callers = [new AbortController(), new AbortController()];
      const reason = new Error(`cancel ${source}`);
      const merged = mergeAbortSignals(callers[0].signal, callers[1].signal)!;
      expect(merged.aborted).toBe(false);
      callers[source].abort(reason);
      expect(merged.aborted).toBe(true);
      expect(merged.reason).toBe(reason);
      if (fallback) {
        expect(getEventListeners(callers[0].signal, "abort")).toHaveLength(0);
        expect(getEventListeners(callers[1].signal, "abort")).toHaveLength(0);
      }
    }
    for (const source of [0, 1]) {
      const callers = [new AbortController(), new AbortController()];
      const reason = new Error(`already cancelled ${source}`);
      callers[source].abort(reason);
      const merged = mergeAbortSignals(callers[0].signal, callers[1].signal)!;
      expect(merged.aborted).toBe(true);
      expect(merged.reason).toBe(reason);
    }
    const caller = new AbortController();
    expect(mergeAbortSignals(caller.signal, undefined)).toBe(caller.signal);
    expect(mergeAbortSignals(undefined, caller.signal)).toBe(caller.signal);
    expect(mergeAbortSignals(undefined, undefined)).toBeUndefined();
  } finally {
    Object.defineProperty(AbortSignal, "any", original);
  }
});

it.each(factories)("retains $name HTTP failure status", async ({ request, name }) => {
  const fetchFn = vi.fn(async () => new Response('{"error":"service unavailable"}', { status: 503 })) as typeof fetch;
  await expect(request(fetchFn)).rejects.toThrow(name === "RPC" ? "returned 503" : "service unavailable");
});

it("reports relayer status when its error body has no message", async () => {
  const fetchFn = vi.fn(async () => new Response('{}', { status: 503 })) as typeof fetch;
  const client = new XianShieldedRelayerClient({ relayerUrl: "http://127.0.0.1:38180", fetchFn });
  await expect(client.getInfo()).rejects.toThrow("relayer request failed with status 503");
});

it("preserves the relayer authorization header", async () => {
  const fetchFn = vi.fn(async (_input, init) => {
    expect(init?.headers).toMatchObject({ authorization: "Bearer task-token" });
    return new Response('{}');
  }) as typeof fetch;
  const client = new XianShieldedRelayerClient({ relayerUrl: "http://127.0.0.1:38180", fetchFn, authToken: " task-token " });
  await expect(client.getInfo()).resolves.toMatchObject({ available: false });
});
