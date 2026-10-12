import { ed25519 } from "@noble/curves/ed25519.js";
import nacl from "tweetnacl";
import {
  XIAN_SIGNED_MESSAGE_VERSION,
  createXianMessageSigningPayload,
  type XianSignedMessageInput
} from "@xian-tech/types";

import { bytesToHex, hexToBytes, utf8ToBytes } from "./encoding.js";
import { TransactionError } from "./errors.js";
import type { XianSigner } from "./types.js";

const KEY_HEX_LENGTH = 64;
const SIGNATURE_HEX_LENGTH = 128;

export {
  XIAN_SIGNED_MESSAGE_VERSION,
  createXianMessageSigningPayload,
  type XianSignedMessageInput
};

function isHexString(value: string, expectedLength: number): boolean {
  if (value.length !== expectedLength) {
    return false;
  }
  try {
    hexToBytes(value);
  } catch {
    return false;
  }
  return true;
}

export function isValidEd25519Key(value: string): boolean {
  return isHexString(value, KEY_HEX_LENGTH);
}

export function isValidEd25519Signature(value: string): boolean {
  return isHexString(value, SIGNATURE_HEX_LENGTH);
}

export function generatePrivateKey(): string {
  return bytesToHex(nacl.randomBytes(32));
}

export function publicKeyFromPrivateKey(privateKey: string): string {
  assertEd25519PrivateKey(privateKey);
  const keyPair = nacl.sign.keyPair.fromSeed(hexToBytes(privateKey));
  return bytesToHex(keyPair.publicKey);
}

/**
 * Low-level raw Ed25519 signing primitive. Transaction signing depends on these
 * exact bytes. User-facing wallet message requests must use the versioned Xian
 * signed-message envelope instead.
 */
export function signMessage(privateKey: string, message: string): string {
  assertEd25519PrivateKey(privateKey);
  const keyPair = nacl.sign.keyPair.fromSeed(hexToBytes(privateKey));
  const signature = nacl.sign.detached(utf8ToBytes(message), keyPair.secretKey);
  return bytesToHex(signature);
}

/** Low-level counterpart to signMessage; see createXianMessageSigningPayload. */
export function verifyMessage(publicKey: string, message: string, signature: string): boolean {
  if (!isValidEd25519Key(publicKey) || !isValidEd25519Signature(signature)) {
    return false;
  }

  try {
    const signatureBytes = hexToBytes(signature);
    const publicKeyBytes = hexToBytes(publicKey);
    const messageBytes = utf8ToBytes(message);
    // Reject small-order R and use strict point/scalar decoding. Keep NaCl's
    // uncofactored verification equation as well: noble's RFC8032 verifier uses
    // the cofactored equation, which accepts a broader set of edge cases.
    if (ed25519.Point.fromBytes(signatureBytes.subarray(0, 32), false).isSmallOrder()) {
      return false;
    }
    return ed25519.verify(signatureBytes, messageBytes, publicKeyBytes, { zip215: false }) &&
      nacl.sign.detached.verify(messageBytes, signatureBytes, publicKeyBytes);
  } catch {
    return false;
  }
}

export function signXianMessage(
  privateKey: string,
  input: XianSignedMessageInput
): string {
  assertEd25519PrivateKey(privateKey);
  const account = publicKeyFromPrivateKey(privateKey);
  if (input.account.trim().toLowerCase() !== account) {
    throw new TransactionError("message signing account does not match private key");
  }
  return signMessage(
    privateKey,
    createXianMessageSigningPayload({ ...input, account })
  );
}

export function verifyXianMessage(
  publicKey: string,
  input: XianSignedMessageInput,
  signature: string
): boolean {
  const account = input.account.trim().toLowerCase();
  if (!isValidEd25519Key(publicKey) || account !== publicKey.toLowerCase()) {
    return false;
  }
  try {
    return verifyMessage(
      publicKey,
      createXianMessageSigningPayload({ ...input, account }),
      signature
    );
  } catch {
    return false;
  }
}

export function assertEd25519PrivateKey(privateKey: string): void {
  if (!isValidEd25519Key(privateKey)) {
    throw new TransactionError("private key must be a 32-byte hex string");
  }
}

export class Ed25519Signer implements XianSigner {
  readonly privateKey: string;

  constructor(privateKey: string = generatePrivateKey()) {
    assertEd25519PrivateKey(privateKey);
    this.privateKey = privateKey;
  }

  get address(): string {
    return publicKeyFromPrivateKey(this.privateKey);
  }

  getAddress(): string {
    return this.address;
  }

  signMessage(message: string): string {
    return signMessage(this.privateKey, message);
  }

  verifyMessage(message: string, signature: string): boolean {
    return verifyMessage(this.address, message, signature);
  }
}
