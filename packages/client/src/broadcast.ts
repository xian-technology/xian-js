import { asRecord, readErrorMessage } from "./rpc-response.js";
import type { BroadcastMode, TransactionSubmission, XianSignedTransaction } from "./types.js";

export const BROADCAST_ENDPOINTS: Record<BroadcastMode, string> = {
  async: "broadcast_tx_async",
  checktx: "broadcast_tx_sync",
  commit: "broadcast_tx_commit"
};

function commitMessage(
  accepted: boolean,
  finalized: boolean,
  checkTx: Record<string, unknown>,
  deliverTx: Record<string, unknown>
): unknown {
  if (!accepted) return checkTx.log ?? "CheckTx failed";
  return finalized ? undefined : deliverTx.log ?? "transaction was not finalized";
}

function commitOutcome(response: Record<string, unknown>) {
  const checkTx = asRecord(response.check_tx ?? {});
  const deliverTx = asRecord(response.deliver_tx ?? response.tx_result ?? {});
  const accepted = checkTx.code === 0;
  const finalized = accepted && deliverTx.code === 0 && String(response.height ?? "0") !== "0";
  return {
    accepted,
    finalized,
    message: commitMessage(accepted, finalized, checkTx, deliverTx)
  };
}

const DUPLICATE_TX = /tx already exists in (?:cache|mempool)/i;

function field(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>)[key] : undefined;
}

/** The node's duplicate-transaction message from any broadcast mode, if present. */
export function duplicateTxMessage(data: Record<string, unknown>): string | undefined {
  const candidates = [
    field(data.error, "data"),
    field(data.error, "message"),
    field(data.result, "log"),
    field(field(data.result, "check_tx"), "log")
  ];
  return candidates.find((value): value is string => typeof value === "string" && DUPLICATE_TX.test(value));
}

function rpcErrorMessage(data: Record<string, unknown>): string | undefined {
  return "error" in data ? readErrorMessage(asRecord(data.error)) : undefined;
}

/** Decode admission/finality evidence; receipt polling belongs to the client. */
export function parseBroadcastResponse(
  tx: XianSignedTransaction,
  mode: BroadcastMode,
  data: Record<string, unknown>,
  localTxHash?: string
): TransactionSubmission {
  const response = asRecord(data.result ?? {});
  const txHash = typeof response.hash === "string" ? response.hash : undefined;
  const submission: TransactionSubmission = {
    submitted: !("error" in data),
    accepted: null,
    finalized: false,
    txHash,
    message: rpcErrorMessage(data),
    mode,
    nonce: tx.payload.nonce,
    chiSupplied: tx.payload.chi_supplied,
    response: data
  };

  const duplicate = duplicateTxMessage(data);
  if (duplicate !== undefined) {
    // The node cache holds these exact bytes, which proves neither admission
    // nor execution: unresolved until a receipt for the hash settles it.
    return { ...submission, submitted: true, txHash: txHash ?? localTxHash, message: duplicate };
  }
  if ("error" in data) return submission;
  if (mode === "commit") return { ...submission, ...commitOutcome(response) };
  if (mode === "checktx") {
    submission.accepted = response.code === 0;
    submission.message = submission.accepted ? undefined : response.log ?? "CheckTx failed";
  }
  return submission;
}
