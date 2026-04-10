import { describe, expect, it, vi } from "vitest";

import {
  XianShieldedRelayerClient,
  XianShieldedRelayerPoolClient
} from "../src/index";

function jsonResponse(value: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" }
  });
}

describe("@xian-tech/client relayer", () => {
  it("reads relayer info and quote responses", async () => {
    const fetchFn = vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/v1/info")) {
        return jsonResponse({
          service: "xian-shielded-relayer",
          protocol_version: "v1",
          available: true,
          chain_id: "xian-local",
          relayer_account: "a".repeat(64),
          submission_mode: "checktx",
          wait_for_tx: true,
          capabilities: {
            quote: true,
            shielded_note_relay_transfer: true
          },
          policy: {
            quote_ttl_seconds: 30,
            default_expiry_seconds: 300,
            max_expiry_seconds: 1800,
            min_note_relayer_fee: "2",
            min_command_relayer_fee: "5",
            allowed_note_contracts: ["con_shielded_note_token"],
            allowed_command_contracts: ["con_shielded_commands"],
            allowed_command_targets: ["currency"]
          }
        });
      }
      if (url.endsWith("/v1/quote")) {
        expect(init?.method).toBe("POST");
        return jsonResponse({
          kind: "shielded_note_relay_transfer",
          contract: "con_shielded_note_token",
          target_contract: null,
          chain_id: "xian-local",
          relayer_account: "a".repeat(64),
          relayer_fee: "2",
          issued_at: "2026-04-10 12:00:00",
          expires_at: "2026-04-10 12:05:00",
          policy_version: "abc123"
        });
      }
      throw new Error(`unexpected URL: ${url}`);
    }) as typeof fetch;

    const client = new XianShieldedRelayerClient({
      relayerUrl: "http://127.0.0.1:38180",
      fetchFn
    });

    await expect(client.getInfo()).resolves.toMatchObject({
      available: true,
      chainId: "xian-local",
      relayerAccount: "a".repeat(64),
      policy: {
        minNoteRelayerFee: 2,
        minCommandRelayerFee: 5
      }
    });
    await expect(
      client.getQuote({
        kind: "shielded_note_relay_transfer",
        contract: "con_shielded_note_token"
      })
    ).resolves.toMatchObject({
      kind: "shielded_note_relay_transfer",
      relayerFee: 2,
      expiresAt: "2026-04-10 12:05:00"
    });
  });

  it("submits shielded commands and normalizes relayer jobs", async () => {
    const fetchFn = vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/v1/jobs/shielded-command")) {
        expect(init?.method).toBe("POST");
        return jsonResponse({
          job_id: "job-1",
          kind: "shielded_command",
          status: "accepted",
          chain_id: "xian-local",
          relayer_account: "b".repeat(64),
          contract: "con_shielded_commands",
          function_name: "execute_command",
          tx_hash: "ABC123",
          submitted_at: "2026-04-10 12:00:00",
          updated_at: "2026-04-10 12:00:01",
          error: null,
          submission: {
            submitted: true,
            accepted: true,
            finalized: false,
            tx_hash: "ABC123",
            mode: "checktx",
            nonce: 7,
            chi_supplied: 123,
            chi_estimated: 111,
            response: {
              result: {
                hash: "ABC123"
              }
            }
          }
        });
      }
      if (url.endsWith("/v1/jobs/job-1")) {
        return jsonResponse({
          job_id: "job-1",
          kind: "shielded_command",
          status: "accepted",
          chain_id: "xian-local",
          relayer_account: "b".repeat(64),
          contract: "con_shielded_commands",
          function_name: "execute_command",
          tx_hash: "ABC123",
          submitted_at: "2026-04-10 12:00:00",
          updated_at: "2026-04-10 12:00:01",
          error: null,
          submission: {
            submitted: true,
            accepted: true,
            finalized: false,
            tx_hash: "ABC123",
            mode: "checktx",
            nonce: 7,
            chi_supplied: 123,
            chi_estimated: 111,
            response: {
              result: {
                hash: "ABC123"
              }
            }
          }
        });
      }
      throw new Error(`unexpected URL: ${url}`);
    }) as typeof fetch;

    const client = new XianShieldedRelayerClient({
      relayerUrl: "http://127.0.0.1:38180",
      fetchFn
    });

    const submitted = await client.submitShieldedCommand({
      contract: "con_shielded_commands",
      targetContract: "currency",
      oldRoot: "0xold",
      inputNullifiers: ["0xnullifier"],
      outputCommitments: [],
      outputPayloads: [],
      proofHex: "0xproof",
      relayerFee: 3n
    });
    const fetched = await client.getJob("job-1");

    expect(submitted).toMatchObject({
      jobId: "job-1",
      status: "accepted",
      txHash: "ABC123",
      submission: {
        submitted: true,
        accepted: true,
        chiSupplied: 123
      }
    });
    expect(fetched.jobId).toBe("job-1");
    expect(fetched.submission?.nonce).toBe(7);
  });

  it("fails over quote requests across configured relayers", async () => {
    const fetchFn = vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.startsWith("http://relayer-a/")) {
        throw new Error("relayer-a unavailable");
      }
      if (url === "http://relayer-b/v1/quote") {
        return jsonResponse({
          kind: "shielded_note_relay_transfer",
          contract: "con_private_usd",
          target_contract: null,
          chain_id: "xian-local",
          relayer_account: "c".repeat(64),
          relayer_fee: "4",
          issued_at: "2026-04-10 12:00:00",
          expires_at: "2026-04-10 12:05:00",
          policy_version: "fallback"
        });
      }
      throw new Error(`unexpected URL: ${url}`);
    }) as typeof fetch;

    const pool = new XianShieldedRelayerPoolClient({
      relayers: [
        {
          id: "relayer-b",
          relayerUrl: "http://relayer-b",
          priority: 20,
          submissionKinds: ["shielded_note_relay_transfer"]
        },
        {
          id: "relayer-a",
          relayerUrl: "http://relayer-a",
          priority: 10,
          submissionKinds: ["shielded_note_relay_transfer"]
        }
      ],
      fetchFn
    });

    const result = await pool.getQuote({
      kind: "shielded_note_relay_transfer",
      contract: "con_private_usd"
    });

    expect(result.relayer.id).toBe("relayer-b");
    expect(result.quote.relayerFee).toBe(4);
    expect(fetchFn).toHaveBeenNthCalledWith(
      1,
      "http://relayer-a/v1/quote",
      expect.any(Object)
    );
    expect(fetchFn).toHaveBeenNthCalledWith(
      2,
      "http://relayer-b/v1/quote",
      expect.any(Object)
    );
  });

  it("requires relayerId for submission when multiple relayers are configured", async () => {
    const pool = new XianShieldedRelayerPoolClient({
      relayers: [
        {
          id: "relayer-a",
          relayerUrl: "http://relayer-a",
          submissionKinds: ["shielded_command"]
        },
        {
          id: "relayer-b",
          relayerUrl: "http://relayer-b",
          submissionKinds: ["shielded_command"]
        }
      ],
      fetchFn: vi.fn() as typeof fetch
    });

    await expect(
      pool.submitShieldedCommand({
        contract: "con_shielded_commands",
        targetContract: "currency",
        oldRoot: "0xold",
        inputNullifiers: ["0xnullifier"],
        outputCommitments: [],
        outputPayloads: [],
        proofHex: "0xproof",
        relayerFee: 3n
      })
    ).rejects.toThrow(
      "submitShieldedCommand requires relayerId when multiple shielded relayers are configured"
    );
  });

  it("allows single-relayer submission without relayerId", async () => {
    const fetchFn = vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url === "http://relayer-only/v1/jobs/shielded-command") {
        return jsonResponse({
          job_id: "job-2",
          kind: "shielded_command",
          status: "accepted",
          chain_id: "xian-local",
          relayer_account: "d".repeat(64),
          contract: "con_shielded_commands",
          function_name: "execute_command",
          tx_hash: "DEF456",
          submitted_at: "2026-04-10 12:00:00",
          updated_at: "2026-04-10 12:00:01",
          error: null,
          submission: {
            submitted: true,
            accepted: true,
            finalized: false,
            tx_hash: "DEF456",
            mode: "checktx",
            nonce: 11,
            chi_supplied: 222,
            chi_estimated: 200,
            response: {
              result: {
                hash: "DEF456"
              }
            }
          }
        });
      }
      throw new Error(`unexpected URL: ${url}`);
    }) as typeof fetch;

    const pool = new XianShieldedRelayerPoolClient({
      relayers: [
        {
          id: "relayer-only",
          relayerUrl: "http://relayer-only",
          submissionKinds: ["shielded_command"]
        }
      ],
      fetchFn
    });

    const result = await pool.submitShieldedCommand({
      contract: "con_shielded_commands",
      targetContract: "currency",
      oldRoot: "0xold",
      inputNullifiers: ["0xnullifier"],
      outputCommitments: [],
      outputPayloads: [],
      proofHex: "0xproof",
      relayerFee: 3n
    });

    expect(result.relayer.id).toBe("relayer-only");
    expect(result.job.jobId).toBe("job-2");
  });
});
