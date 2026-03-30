import { describe, expect, it, vi } from "vitest";

import { Ed25519Signer, XianClient } from "../src/index";
import type { XianWebSocketLike } from "../src/types";

function encodeBase64Utf8(value: string): string {
  return btoa(value);
}

function jsonResponse(value: Record<string, unknown>): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
}

describe("@xian-tech/client", () => {
  it("reads chain id and nonce through RPC surfaces", async () => {
    const fetchFn = vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.endsWith("/genesis")) {
        return jsonResponse({
          result: {
            genesis: {
              chain_id: "xian-local"
            }
          }
        });
      }
      if (url.includes("/abci_query") && url.includes("get_next_nonce")) {
        return jsonResponse({
          result: {
            response: {
              code: 0,
              value: encodeBase64Utf8("7")
            }
          }
        });
      }
      throw new Error(`unexpected URL: ${url}`);
    }) as typeof fetch;

    const client = new XianClient({
      rpcUrl: "http://127.0.0.1:26657",
      fetchFn
    });

    await expect(client.getChainId()).resolves.toBe("xian-local");
    await expect(client.getNonce("a".repeat(64))).resolves.toBe(7);
  });

  it("builds, signs, and broadcasts a checktx transaction", async () => {
    const signer = new Ed25519Signer("2".repeat(64));
    const fetchFn = vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.endsWith("/genesis")) {
        return jsonResponse({
          result: {
            genesis: {
              chain_id: "xian-local"
            }
          }
        });
      }
      if (url.includes("/broadcast_tx_sync")) {
        return jsonResponse({
          result: {
            hash: "ABC123",
            code: 0
          }
        });
      }
      throw new Error(`unexpected URL: ${url}`);
    }) as typeof fetch;

    const client = new XianClient({
      rpcUrl: "http://127.0.0.1:26657",
      fetchFn
    });

    const tx = await client.buildTx({
      sender: signer.address,
      contract: "currency",
      function: "transfer",
      kwargs: { to: "bob", amount: "5" },
      nonce: 1,
      stamps: 50_000
    });
    const signedTx = await client.signTx(tx, signer);
    const submission = await client.broadcastTx(signedTx, { mode: "checktx" });

    expect(submission.submitted).toBe(true);
    expect(submission.accepted).toBe(true);
    expect(submission.txHash).toBe("ABC123");
  });

  it("subscribes to state changes over websocket", async () => {
    const sentMessages: string[] = [];
    const sockets: FakeSocket[] = [];
    const webSocketFactory = vi.fn((url: string) => {
      const socket = new FakeSocket(url, sentMessages);
      sockets.push(socket);
      return socket;
    });

    const client = new XianClient({
      rpcUrl: "http://127.0.0.1:26657",
      dashboardUrl: "http://127.0.0.1:8080",
      fetchFn: vi.fn() as unknown as typeof fetch,
      webSocketFactory
    });

    const listener = vi.fn();
    const subscription = client.watch.state("currency.balances:*", listener);

    sockets[0]?.open();
    expect(sentMessages).toEqual([
      '{"action":"subscribe","type":"state","key":"currency.balances:*"}'
    ]);

    await sockets[0]?.message(
      JSON.stringify({
        type: "state_change",
        key: "currency.balances:alice",
        value: "10"
      })
    );

    expect(listener).toHaveBeenCalledWith({
      type: "state_change",
      key: "currency.balances:alice",
      value: "10"
    });

    await subscription.unsubscribe();
    expect(sockets[0]?.closeCalls).toBe(1);
  });

  it("falls back to direct state reads when balance simulation fails", async () => {
    const fetchFn = vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.includes("/abci_query") && url.includes("simulate_tx")) {
        return jsonResponse({
          result: {
            response: {
              code: 1,
              log: "simulation failed"
            }
          }
        });
      }
      if (url.includes("/abci_query") && url.includes("currency.balances")) {
        return jsonResponse({
          result: {
            response: {
              code: 0,
              value: encodeBase64Utf8("12")
            }
          }
        });
      }
      throw new Error(`unexpected URL: ${url}`);
    }) as typeof fetch;

    const client = new XianClient({
      rpcUrl: "http://127.0.0.1:26657",
      fetchFn
    });

    await expect(client.getBalance("a".repeat(64))).resolves.toBe(12);
  });

  it("reads token metadata and stamp rate through state lookups", async () => {
    const fetchFn = vi.fn(async (input: string | URL) => {
      const url = new URL(String(input));
      const path = decodeURIComponent(url.searchParams.get("path") ?? "");
      if (url.pathname.endsWith("/abci_query") && path.includes("con_token.metadata:token_name")) {
        return jsonResponse({
          result: {
            response: {
              code: 0,
              value: encodeBase64Utf8("Demo Token")
            }
          }
        });
      }
      if (url.pathname.endsWith("/abci_query") && path.includes("con_token.metadata:token_symbol")) {
        return jsonResponse({
          result: {
            response: {
              code: 0,
              value: encodeBase64Utf8("DMT")
            }
          }
        });
      }
      if (url.pathname.endsWith("/abci_query") && path.includes("con_token.metadata:token_logo_url")) {
        return jsonResponse({
          result: {
            response: {
              code: 0,
              value: encodeBase64Utf8("https://example.com/token.png")
            }
          }
        });
      }
      if (url.pathname.endsWith("/abci_query") && path.includes("stamp_cost.S:value")) {
        return jsonResponse({
          result: {
            response: {
              code: 0,
              value: encodeBase64Utf8("25")
            }
          }
        });
      }
      throw new Error(`unexpected URL: ${String(input)}`);
    }) as typeof fetch;

    const client = new XianClient({
      rpcUrl: "http://127.0.0.1:26657",
      fetchFn
    });

    await expect(client.getTokenMetadata("con_token")).resolves.toEqual({
      contract: "con_token",
      name: "Demo Token",
      symbol: "DMT",
      logoUrl: "https://example.com/token.png"
    });
    await expect(client.token("con_token").metadata()).resolves.toEqual({
      contract: "con_token",
      name: "Demo Token",
      symbol: "DMT",
      logoUrl: "https://example.com/token.png"
    });
    await expect(client.getStampRate()).resolves.toBe(25);
  });

  it("waits until a transaction lookup stops returning a pending error", async () => {
    let attempts = 0;
    const fetchFn = vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.includes("/tx?hash=0xABC123")) {
        attempts += 1;
        if (attempts === 1) {
          return jsonResponse({
            error: {
              message: "not found"
            }
          });
        }
        return jsonResponse({
          result: {
            hash: "ABC123",
            tx_result: {
              code: 0,
              data: encodeBase64Utf8('{"result":"ok"}')
            }
          }
        });
      }
      throw new Error(`unexpected URL: ${url}`);
    }) as typeof fetch;

    const client = new XianClient({
      rpcUrl: "http://127.0.0.1:26657",
      fetchFn
    });

    const receipt = await client.waitForTx("ABC123", {
      timeoutMs: 1_000,
      pollIntervalMs: 1
    });

    expect(receipt.success).toBe(true);
    expect(receipt.txHash).toBe("ABC123");
    expect(attempts).toBe(2);
  });
});

class FakeSocket implements XianWebSocketLike {
  onopen: ((event: Event) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
  closeCalls = 0;

  constructor(
    readonly url: string,
    private readonly sentMessages: string[]
  ) {}

  send(data: string): void {
    this.sentMessages.push(data);
  }

  close(): void {
    this.closeCalls += 1;
  }

  open(): void {
    this.onopen?.(new Event("open"));
  }

  async message(data: string): Promise<void> {
    this.onmessage?.({ data } as MessageEvent<unknown>);
    await Promise.resolve();
  }
}
