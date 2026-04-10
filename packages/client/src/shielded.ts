import { sha3_256 } from "@noble/hashes/sha3";

import { bytesToHex, hexToBytes, utf8ToBytes } from "./encoding.js";
import { publicKeyFromPrivateKey } from "./ed25519.js";

const SYNC_HINT_PREFIX = utf8ToBytes("xian-zk-note-sync-v1");
const SYNC_HINT_BYTES = 12;

function concatBytes(left: Uint8Array, right: Uint8Array): Uint8Array {
  const out = new Uint8Array(left.length + right.length);
  out.set(left, 0);
  out.set(right, left.length);
  return out;
}

export function shieldedSyncHintFromViewingPublicKey(
  viewingPublicKey: string
): string {
  const digest = sha3_256(
    concatBytes(SYNC_HINT_PREFIX, hexToBytes(viewingPublicKey))
  );
  return `0x${bytesToHex(digest.slice(0, SYNC_HINT_BYTES))}`;
}

export function shieldedSyncHintFromViewingPrivateKey(
  viewingPrivateKey: string
): string {
  return shieldedSyncHintFromViewingPublicKey(
    publicKeyFromPrivateKey(viewingPrivateKey)
  );
}
