import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, encodeRuntime, sortKeysDeep, utf8ToBytes } from "./encoding.js";
import type { XianVmProfile } from "./numeric.js";
import type { XianSignedTransaction } from "./types.js";

export interface PreparedTransaction {
  readonly json: string;
  readonly rpcHex: string;
  readonly txHash: string;
}

/** The exact bytes CometBFT stores are the ASCII hex of the canonical JSON. */
export function prepareTransaction(tx: XianSignedTransaction, profile: XianVmProfile = "xian_vm_v1"): PreparedTransaction {
  const json = encodeRuntime(sortKeysDeep(tx), profile);
  const rpcHex = bytesToHex(utf8ToBytes(json));
  return Object.freeze({ json, rpcHex, txHash: bytesToHex(sha256(utf8ToBytes(rpcHex))).toUpperCase() });
}
