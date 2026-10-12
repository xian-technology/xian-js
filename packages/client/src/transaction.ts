import { canonicalAccountJson } from "./hybrid.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, encodeRuntime, sortKeysDeep, utf8ToBytes } from "./encoding.js";
import type { XianSignedTransaction } from "./types.js";

export interface PreparedTransaction {
  readonly json: string;
  readonly rpcHex: string;
  readonly txHash: string;
}

/** The exact bytes CometBFT stores are the ASCII hex of the canonical JSON. */
export function prepareTransaction(tx: XianSignedTransaction): PreparedTransaction {
  const json = tx.metadata.tx_format === "xian_account_v1" ? canonicalAccountJson(tx) : encodeRuntime(sortKeysDeep(tx));
  if (tx.metadata.tx_format === "xian_account_v1" && utf8ToBytes(json).length * 2 > 524288) throw new Error("account transaction exceeds wire limit");
  const rpcHex = bytesToHex(utf8ToBytes(json));
  return Object.freeze({ json, rpcHex, txHash: bytesToHex(sha256(utf8ToBytes(rpcHex))).toUpperCase() });
}
