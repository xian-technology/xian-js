import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, encodeRuntime, utf8ToBytes } from "./encoding.js";
import { DEFAULT_VM_PROFILE, type XianVmProfile } from "./numeric.js";
import type { XianSignedTransaction } from "./types.js";

export interface PreparedTransaction {
  readonly json: string;
  readonly rpcHex: string;
  readonly txHash: string;
}

export function hashSubmittedTransaction(bytes: Uint8Array): string {
  return bytesToHex(sha256(bytes)).toUpperCase();
}

/** The exact bytes CometBFT stores are the ASCII hex of the canonical JSON. */
export function prepareTransaction(tx: XianSignedTransaction, profile: XianVmProfile = DEFAULT_VM_PROFILE): PreparedTransaction {
  const json = encodeRuntime(tx, profile);
  const rpcHex = bytesToHex(utf8ToBytes(json));
  return Object.freeze({ json, rpcHex, txHash: hashSubmittedTransaction(utf8ToBytes(rpcHex)) });
}
