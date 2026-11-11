import { describe, expect, it, vi } from "vitest";

import { TransactionError, TransportError, TxTimeoutError, XianClient } from "../src/index";
import { prepareTransaction } from "../src/transaction";
import type { BroadcastMode, TransactionReceipt, XianSignedTransaction } from "../src/types";

const tx: XianSignedTransaction = {
  payload: {
    chain_id: "local", sender: "a".repeat(64), nonce: 7, chi_supplied: 100,
    contract: "currency", function: "transfer", kwargs: { amount: "1.25", to: "bob" }
  },
  metadata: { signature: "b".repeat(128) }
};

function clientFor(data: Record<string, unknown>) {
  const fetchFn = vi.fn(async () => new Response(JSON.stringify(data), { status: 200 }));
  return { client: new XianClient({ rpcUrl: "http://node/", fetchFn }), fetchFn };
}

const failedReceipt: TransactionReceipt = {
  success: false, txHash: "hash", message: "contract rejected", response: { result: {} }
};

describe("broadcast response and finality behavior", () => {
  it.each([
    ["async", "broadcast_tx_async"], ["checktx", "broadcast_tx_sync"], ["commit", "broadcast_tx_commit"]
  ] as const)("uses the %s endpoint and canonical wire transaction", async (mode, endpoint) => {
    const { client, fetchFn } = clientFor({ result: { code: 0 } });
    const submission = await client.broadcastTx(tx, { mode });
    const [input, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    const url = new URL(input);
    expect(url.pathname).toBe(`/${endpoint}`);
    expect(url.searchParams.get("tx")).toBe(`"${prepareTransaction(tx).rpcHex}"`);
    expect(init.method).toBe("POST");
    expect(submission).toMatchObject({ nonce: 7, chiSupplied: 100, mode });
  });

  it("defaults to CheckTx", async () => {
    const { client, fetchFn } = clientFor({ result: { code: 0 } });
    expect((await client.broadcastTx(tx)).mode).toBe("checktx");
    expect(String(fetchFn.mock.calls[0]?.[0])).toContain("broadcast_tx_sync");
  });

  it.each([
    [{ data: "details", message: "summary" }, "details"],
    [{ data: "", message: "summary" }, "summary"],
    [{ data: 123, message: "" }, "RPC error"],
    [{ data: "x", message: "summary" }, "x"],
    [{ data: "", message: "x" }, "x"]
  ])("preserves structured RPC rejection and message precedence", async (error, message) => {
    const data = { error, result: { hash: "hash", code: 0 } };
    const { client } = clientFor(data);
    const wait = vi.spyOn(client, "waitForTx");
    await expect(client.broadcastTx(tx, { mode: "async", waitForTx: true })).resolves.toEqual({
      submitted: false, accepted: null, finalized: false, txHash: "hash", message,
      mode: "async", nonce: 7, chiSupplied: 100, response: data
    });
    expect(wait).not.toHaveBeenCalled();
  });

  it.each([
    [0, true, undefined], [1, false, "CheckTx failed"], ["0", false, "CheckTx failed"],
    [undefined, false, "CheckTx failed"]
  ])("requires numeric CheckTx code zero: %s", async (code, accepted, message) => {
    const { client } = clientFor({ result: { code, hash: "hash" } });
    await expect(client.broadcastTx(tx)).resolves.toMatchObject({ accepted, message, finalized: false });
  });

  it.each(["", { reason: "nonce" }])("preserves CheckTx rejection log %j", async (log) => {
    const { client } = clientFor({ result: { code: 7, log } });
    expect((await client.broadcastTx(tx)).message).toEqual(log);
  });

  it.each([
    [{ check_tx: { code: 0 }, deliver_tx: { code: 0 }, height: "5" }, true, true, undefined],
    [{ check_tx: { code: 0 }, tx_result: { code: 0 }, height: 5 }, true, true, undefined],
    [{ check_tx: { code: 0 }, deliver_tx: { code: 0 }, height: 0 }, true, false, "transaction was not finalized"],
    [{ check_tx: { code: 0 }, deliver_tx: { code: 0 } }, true, false, "transaction was not finalized"],
    [{ check_tx: { code: 0 }, deliver_tx: { code: 9, log: "execution failed" }, height: "5" }, true, false, "execution failed"],
    [{ check_tx: { code: 0 }, deliver_tx: { code: 0, log: "delivery" }, tx_result: { code: 0 }, height: "0" }, true, false, "delivery"],
    [{ check_tx: { code: 7, log: "admission failed" }, deliver_tx: { code: 0 }, height: "5" }, false, false, "admission failed"],
    [{ check_tx: { code: "0" }, deliver_tx: { code: 0 }, height: "5" }, false, false, "CheckTx failed"],
    [{ check_tx: { code: 7, log: "" } }, false, false, ""],
    [{ check_tx: { code: 0 }, deliver_tx: { code: 7, log: "" }, height: "5" }, true, false, ""],
    [{}, false, false, "CheckTx failed"]
  ])("preserves commit response outcome: %j", async (result, accepted, finalized, message) => {
    const { client } = clientFor({ result });
    const wait = vi.spyOn(client, "waitForTx");
    await expect(client.broadcastTx(tx, { mode: "commit", waitForTx: true })).resolves.toMatchObject({
      accepted, finalized, message
    });
    expect(wait).not.toHaveBeenCalled();
  });

  it.each(["async", "checktx"] as const)("attaches a finalized failed receipt in %s mode", async (mode) => {
    const { client } = clientFor({ result: { hash: "hash", code: 0 } });
    const wait = vi.spyOn(client, "waitForTx").mockResolvedValue(failedReceipt);
    const options = { mode, waitForTx: true, timeoutMs: 123, pollIntervalMs: 4 };
    const submission = await client.broadcastTx(tx, options);
    expect(submission.accepted).toBe(mode === "async" ? null : true);
    expect(submission.finalized).toBe(true);
    expect(submission.receipt).toBe(failedReceipt);
    expect(wait).toHaveBeenCalledWith("hash", options);
  });

  it.each([
    ["async", true, undefined, 0], ["checktx", true, "hash", 7],
    ["async", false, "hash", 0], ["checktx", false, "hash", 0]
  ] as const)("does not poll without eligible admission/hash/wait: %s %s %s %s", async (mode, waitForTx, hash, code) => {
    const { client } = clientFor({ result: { hash, code } });
    const wait = vi.spyOn(client, "waitForTx");
    const submission = await client.broadcastTx(tx, { mode, waitForTx });
    expect(submission.finalized).toBe(false);
    expect(wait).not.toHaveBeenCalled();
  });

  it("does not infer admission from an async response code", async () => {
    const { client } = clientFor({ result: { hash: "hash", code: 9, log: "ignored" } });
    expect(await client.broadcastTx(tx, { mode: "async" })).toMatchObject({
      submitted: true, accepted: null, finalized: false, message: undefined
    });
  });

  it("preserves finality error identity", async () => {
    const { client } = clientFor({ result: { hash: "hash", code: 0 } });
    const failure = new TxTimeoutError("deadline");
    vi.spyOn(client, "waitForTx").mockRejectedValue(failure);
    await expect(client.broadcastTx(tx, { waitForTx: true })).rejects.toBe(failure);
  });

  it("validates payload before mode and performs no network request on invalid input", async () => {
    const { client, fetchFn } = clientFor({});
    const options = { mode: "bad" as BroadcastMode };
    await expect(client.broadcastTx({ ...tx, payload: { ...tx.payload, contract: "bad-name" } }, options))
      .rejects.toThrow("contract must be a valid identifier");
    await expect(client.broadcastTx(tx, options)).rejects.toBeInstanceOf(TransactionError);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("rejects an empty mode rather than applying the default", async () => {
    const { client, fetchFn } = clientFor({ result: { code: 0 } });
    await expect(client.broadcastTx(tx, { mode: "" as BroadcastMode })).rejects.toThrow(
      "mode must be one of: async, checktx, commit"
    );
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it.each([{ result: 7 }, { result: 0 }, { result: { check_tx: 0 } }, { result: { check_tx: 7 } }, { result: { deliver_tx: 7 } }])(
    "preserves malformed response errors: %j", async (data) => {
      const { client } = clientFor(data);
      await expect(client.broadcastTx(tx, { mode: "commit" })).rejects.toBeInstanceOf(TransportError);
    }
  );
  describe("duplicate transactions", () => {
    const localHash = prepareTransaction(tx).txHash;
    const duplicates = [
      ["checktx", { result: { code: 19, log: "tx already exists in cache" } }],
      ["async", { error: { code: -32603, message: "Internal error", data: "tx already exists in mempool" } }],
      ["checktx", { error: { message: "tx already exists in cache" } }],
      ["commit", { result: { check_tx: { code: 19, log: "tx already exists in cache" }, height: "0" } }]
    ] as const;

    it.each(duplicates)("reports a %s duplicate as unresolved under the local hash: %j", async (mode, data) => {
      const { client } = clientFor(data);
      const wait = vi.spyOn(client, "waitForTx");
      const submission = await client.broadcastTx(tx, { mode });
      expect(submission).toMatchObject({ submitted: true, accepted: null, finalized: false, txHash: localHash });
      expect(String(submission.message)).toMatch(/already exists/);
      expect(wait).not.toHaveBeenCalled();
    });

    it.each(duplicates)("confirms a %s duplicate only by its receipt: %j", async (mode, data) => {
      const { client } = clientFor(data);
      const receipt: TransactionReceipt = { success: true, txHash: localHash, response: { result: {} } };
      const wait = vi.spyOn(client, "waitForTx").mockResolvedValue(receipt);
      const options = { mode, waitForTx: true, timeoutMs: 50, pollIntervalMs: 1 };
      await expect(client.broadcastTx(tx, options)).resolves.toMatchObject({
        submitted: true, accepted: true, finalized: true, txHash: localHash, receipt
      });
      expect(wait).toHaveBeenCalledWith(localHash, options);
    });
  });
});
