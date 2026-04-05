import nacl from "tweetnacl";

import { bytesToHex, hexToBytes, utf8ToBytes } from "./encoding.js";
import { TransactionError } from "./errors.js";
import type { XianSigner } from "./types.js";

const KEY_HEX_LENGTH = 64;
const SIGNATURE_HEX_LENGTH = 128;

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

export function signMessage(privateKey: string, message: string): string {
  assertEd25519PrivateKey(privateKey);
  const keyPair = nacl.sign.keyPair.fromSeed(hexToBytes(privateKey));
  const signature = nacl.sign.detached(utf8ToBytes(message), keyPair.secretKey);
  return bytesToHex(signature);
}

export function verifyMessage(publicKey: string, message: string, signature: string): boolean {
  if (!isValidEd25519Key(publicKey) || !isValidEd25519Signature(signature)) {
    return false;
  }

  try {
    return nacl.sign.detached.verify(
      utf8ToBytes(message),
      hexToBytes(signature),
      hexToBytes(publicKey)
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
