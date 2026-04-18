import { describe, expect, it, vi } from "vitest";

import { base64ToUtf8 } from "../src/encoding";
import {
  Ed25519Signer,
  shieldedSyncHintFromViewingPublicKey,
  XianClient
} from "../src/index";
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
      chi: 50_000
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

  it("reads token metadata and chi rate through state lookups", async () => {
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
      if (url.pathname.endsWith("/abci_query") && path.includes("chi_cost.S:value")) {
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
      logoUrl: "https://example.com/token.png",
      logoSvg: null
    });
    await expect(client.token("con_token").metadata()).resolves.toEqual({
      contract: "con_token",
      name: "Demo Token",
      symbol: "DMT",
      logoUrl: "https://example.com/token.png",
      logoSvg: null
    });
    await expect(client.getChiRate()).resolves.toBe(25);
  });

  it("falls back to on-chain SVG metadata when no logo URL is configured", async () => {
    const fetchFn = vi.fn(async (input: string | URL) => {
      const url = new URL(String(input));
      const path = decodeURIComponent(url.searchParams.get("path") ?? "");
      if (url.pathname.endsWith("/abci_query") && path.includes("con_svg.metadata:token_name")) {
        return jsonResponse({
          result: {
            response: {
              code: 0,
              value: encodeBase64Utf8("SVG Token")
            }
          }
        });
      }
      if (url.pathname.endsWith("/abci_query") && path.includes("con_svg.metadata:token_symbol")) {
        return jsonResponse({
          result: {
            response: {
              code: 0,
              value: encodeBase64Utf8("SVG")
            }
          }
        });
      }
      if (url.pathname.endsWith("/abci_query") && path.includes("con_svg.metadata:token_logo_url")) {
        return jsonResponse({
          result: {
            response: {
              code: 0,
              value: encodeBase64Utf8("")
            }
          }
        });
      }
      if (url.pathname.endsWith("/abci_query") && path.includes("con_svg.metadata:token_logo_svg")) {
        return jsonResponse({
          result: {
            response: {
              code: 0,
              value: encodeBase64Utf8("<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1 1'></svg>")
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

    await expect(client.getTokenMetadata("con_svg")).resolves.toEqual({
      contract: "con_svg",
      name: "SVG Token",
      symbol: "SVG",
      logoUrl: null,
      logoSvg: "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1 1'></svg>"
    });
  });

  it("reads indexed token balances through the BDS portfolio query", async () => {
    const fetchFn = vi.fn(async (input: string | URL) => {
      const url = new URL(String(input));
      const path = decodeURIComponent(url.searchParams.get("path") ?? "");
      if (url.pathname.endsWith("/abci_query") && path.includes("/token_balances/")) {
        return jsonResponse({
          result: {
            response: {
              code: 0,
              value: encodeBase64Utf8(
                JSON.stringify({
                  available: true,
                  address: "alice",
                  items: [
                    {
                      contract: "currency",
                      balance: "12.5",
                      name: "Xian",
                      symbol: "XIAN",
                      logo_url: "https://example.com/xian.svg",
                      last_tx_hash: "TX-1",
                      last_block_height: 12,
                      updated_at: "2026-04-02T12:00:00Z"
                    }
                  ],
                  total: 1,
                  limit: 50,
                  offset: 10
                })
              )
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

    await expect(
      client.getTokenBalances("alice", { limit: 50, offset: 10, includeZero: true })
    ).resolves.toEqual({
      available: true,
      address: "alice",
      items: [
        {
          contract: "currency",
          balance: "12.5",
          name: "Xian",
          symbol: "XIAN",
          logoUrl: "https://example.com/xian.svg",
          lastTxHash: "TX-1",
          lastBlockHeight: 12,
          updatedAt: "2026-04-02T12:00:00Z"
        }
      ],
      total: 1,
      limit: 50,
      offset: 10
    });
  });

  it("reads shielded wallet history through the indexed wallet feed", async () => {
    const fetchFn = vi.fn(async (input: string | URL) => {
      const url = new URL(String(input));
      const path = decodeURIComponent(url.searchParams.get("path") ?? "");
      if (
        url.pathname.endsWith("/abci_query") &&
        path.includes("/shielded_wallet_history/0x1234/limit=5/kind=sync_hint/after_note_index=3")
      ) {
        return jsonResponse({
          result: {
            response: {
              code: 0,
              value: encodeBase64Utf8(
                JSON.stringify({
                  available: true,
                  items: [
                    {
                      event_id: 10,
                      tx_hash: "TX-1",
                      block_height: 12,
                      tx_index: 0,
                      contract: "con_private",
                      function: "transfer_shielded",
                      action: "transfer",
                      output_index: 1,
                      note_index: 4,
                      commitment: "0xabc",
                      new_root: "0xroot",
                      payload_hash: "0xhash",
                      tag_kind: "sync_hint",
                      tag_value: "0x1234",
                      output_payload: "0xpayload",
                      created_at: "2026-04-10T12:00:00Z"
                    }
                  ],
                  limit: 5,
                  after_note_index: 3
                })
              )
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

    await expect(
      client.getShieldedWalletHistory("0x1234", {
        limit: 5,
        afterNoteIndex: 3
      })
    ).resolves.toEqual({
      available: true,
      items: [
        {
          eventId: 10,
          txHash: "TX-1",
          blockHeight: 12,
          txIndex: 0,
          contract: "con_private",
          function: "transfer_shielded",
          action: "transfer",
          outputIndex: 1,
          noteIndex: 4,
          commitment: "0xabc",
          newRoot: "0xroot",
          payloadHash: "0xhash",
          tagKind: "sync_hint",
          tagValue: "0x1234",
          outputPayload: "0xpayload",
          createdAt: "2026-04-10T12:00:00Z",
          raw: {
            event_id: 10,
            tx_hash: "TX-1",
            block_height: 12,
            tx_index: 0,
            contract: "con_private",
            function: "transfer_shielded",
            action: "transfer",
            output_index: 1,
            note_index: 4,
            commitment: "0xabc",
            new_root: "0xroot",
            payload_hash: "0xhash",
            tag_kind: "sync_hint",
            tag_value: "0x1234",
            output_payload: "0xpayload",
            created_at: "2026-04-10T12:00:00Z"
          }
        }
      ],
      limit: 5,
      afterNoteIndex: 3
    });
  });

  it("derives the shielded sync hint from a viewing public key", () => {
    expect(
      shieldedSyncHintFromViewingPublicKey("3".repeat(64))
    ).toBe("0x2d0f3fbca5001e8d629dc630");
  });

  it("falls back to Buffer decoding when atob is unavailable", () => {
    const originalAtob = globalThis.atob;
    Object.defineProperty(globalThis, "atob", {
      value: undefined,
      configurable: true,
      writable: true
    });

    try {
      const payload = Buffer.from("hello from buffer", "utf-8").toString("base64");
      expect(base64ToUtf8(payload)).toBe("hello from buffer");
    } finally {
      Object.defineProperty(globalThis, "atob", {
        value: originalAtob,
        configurable: true,
        writable: true
      });
    }
  });

  it("rejects oversized chi estimates instead of truncating them", async () => {
    const fetchFn = vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.includes("/abci_query") && url.includes("simulate_tx")) {
        return jsonResponse({
          result: {
            response: {
              code: 0,
              value: encodeBase64Utf8(
                JSON.stringify({
                  status: 0,
                  result: "ok",
                  chi_used: "9007199254740993"
                })
              )
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

    await expect(
      client.estimateChi({
        sender: "a".repeat(64),
        contract: "currency",
        function: "transfer",
        kwargs: { to: "bob", amount: 1 }
      })
    ).rejects.toThrow(/Number\.MAX_SAFE_INTEGER/);
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

  it("surfaces malformed websocket payloads through onError", async () => {
    const sentMessages: string[] = [];
    const sockets: FakeSocket[] = [];
    const webSocketFactory = vi.fn((url: string) => {
      const socket = new FakeSocket(url, sentMessages);
      sockets.push(socket);
      return socket;
    });
    const onError = vi.fn();

    const client = new XianClient({
      rpcUrl: "http://127.0.0.1:26657",
      dashboardUrl: "http://127.0.0.1:8080",
      fetchFn: vi.fn() as unknown as typeof fetch,
      webSocketFactory
    });

    const subscription = client.watch.state(
      "currency.balances:*",
      () => {},
      { onError }
    );

    sockets[0]?.open();
    await sockets[0]?.message("not json");

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0]?.[0]).toBeInstanceOf(Error);
    expect((onError.mock.calls[0]?.[0] as Error).message).toContain("non-JSON");

    await subscription.unsubscribe();
  });

  it("surfaces async watch listener failures through onError", async () => {
    const sentMessages: string[] = [];
    const sockets: FakeSocket[] = [];
    const webSocketFactory = vi.fn((url: string) => {
      const socket = new FakeSocket(url, sentMessages);
      sockets.push(socket);
      return socket;
    });
    const onError = vi.fn();
    const listener = vi.fn(async () => {
      throw new Error("listener failed");
    });

    const client = new XianClient({
      rpcUrl: "http://127.0.0.1:26657",
      dashboardUrl: "http://127.0.0.1:8080",
      fetchFn: vi.fn() as unknown as typeof fetch,
      webSocketFactory
    });

    const subscription = client.watch.state(
      "currency.balances:*",
      listener,
      { onError }
    );

    sockets[0]?.open();
    await sockets[0]?.message(
      JSON.stringify({
        type: "state_change",
        key: "currency.balances:alice",
        value: "10"
      })
    );
    await Promise.resolve();

    expect(listener).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledTimes(1);
    expect((onError.mock.calls[0]?.[0] as Error).message).toContain(
      "listener failed"
    );

    await subscription.unsubscribe();
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
