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

/** Decode admission/finality evidence; receipt polling belongs to the client. */
export function parseBroadcastResponse(
  tx: XianSignedTransaction,
  mode: BroadcastMode,
  data: Record<string, unknown>
): TransactionSubmission {
  const response = asRecord(data.result ?? {});
  const txHash = typeof response.hash === "string" ? response.hash : undefined;
  const submission: TransactionSubmission = {
    submitted: !("error" in data),
    accepted: null,
    finalized: false,
    txHash,
    message: "error" in data ? readErrorMessage(asRecord(data.error)) : undefined,
    mode,
    nonce: tx.payload.nonce,
    chiSupplied: tx.payload.chi_supplied,
    response: data
  };

  if ("error" in data) return submission;
  if (mode === "commit") return { ...submission, ...commitOutcome(response) };
  if (mode === "checktx") {
    submission.accepted = response.code === 0;
    submission.message = submission.accepted ? undefined : response.log ?? "CheckTx failed";
  }
  return submission;
}
