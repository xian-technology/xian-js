/** Production account authorization. See ACCOUNT_REGISTRY_PROTOCOL.md. */
import { ed25519 } from "@noble/curves/ed25519.js";
import { ml_dsa65 } from "@noble/post-quantum/ml-dsa.js";
import { gcm } from "@noble/ciphers/aes.js";
import { pbkdf2Async } from "@noble/hashes/pbkdf2.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { randomBytes, concatBytes } from "@noble/hashes/utils.js";
import {
  bytesToHex as hex,
  hexToBytes,
  utf8ToBytes as utf8,
  decodeRuntime,
} from "./encoding.js";
import type {
  XianSigner,
  XianSignedTransaction,
  XianUnsignedTransaction,
  XianTxPayload,
} from "./types.js";

export interface HybridPublicKeys {
  ed25519: string;
  ml_dsa_65: string;
}
export interface HybridSecretKeys {
  ed25519_seed: string;
  ml_dsa_65: string;
}
export interface AccountRecord {
  version: 1;
  epoch: number | bigint;
  active: HybridPublicKeys;
  recovery: HybridPublicKeys;
}
export type AccountKeyRole = "active" | "recovery";
export interface AccountBackup {
  version: 1 | 2;
  kind: "xian-account-backup";
  chain_id: string;
  sender: string;
  record: AccountRecord;
  role: AccountKeyRole;
  secret: HybridSecretKeys;
}
export type AccountOperation = "enroll" | "rotate" | "recover";
const SCHEME = "ed25519_ml_dsa_65_v1";
const MAX64 = (1n << 64n) - 1n;
const MAX_BACKUP = 100_000;
function exact(
  v: unknown,
  keys: string[],
): asserts v is Record<string, unknown> {
  if (
    !v ||
    Object.getPrototypeOf(v) !== Object.prototype ||
    Object.keys(v).sort().join() !== keys.sort().join()
  )
    throw new Error("unexpected account fields");
}
function bytes(v: unknown, n: number): Uint8Array {
  if (typeof v !== "string" || v.length !== n * 2 || !/^[0-9a-f]+$/.test(v))
    throw new Error("invalid account key encoding");
  return hexToBytes(v);
}
function uint(v: unknown): bigint {
  if (
    (typeof v !== "bigint" &&
      (typeof v !== "number" || !Number.isSafeInteger(v))) ||
    BigInt(v as number | bigint) < 0n ||
    BigInt(v as number | bigint) > MAX64
  )
    throw new Error("invalid account epoch");
  return BigInt(v as number | bigint);
}
function be(v: bigint, n: number): Uint8Array {
  const out = new Uint8Array(n);
  for (let i = n - 1; i >= 0; i--) {
    out[i] = Number(v & 255n);
    v >>= 8n;
  }
  return out;
}
function publicKeys(v: unknown): HybridPublicKeys {
  exact(v, ["ed25519", "ml_dsa_65"]);
  const p = ed25519.Point.fromBytes(bytes(v.ed25519, 32), false);
  if (p.isSmallOrder() || !p.isTorsionFree())
    throw new Error("account Ed25519 key must be prime order");
  bytes(v.ml_dsa_65, 1952);
  return { ed25519: v.ed25519 as string, ml_dsa_65: v.ml_dsa_65 as string };
}
export function parseAccountRecord(v: unknown): AccountRecord {
  exact(v, ["version", "epoch", "active", "recovery"]);
  if (v.version !== 1) throw new Error("unsupported account version");
  uint(v.epoch);
  const active = publicKeys(v.active),
    recovery = publicKeys(v.recovery);
  if (
    active.ed25519 === recovery.ed25519 ||
    active.ml_dsa_65 === recovery.ml_dsa_65
  )
    throw new Error("active and recovery keys must differ");
  return { version: 1, epoch: v.epoch as number | bigint, active, recovery };
}
/** Canonical JSON used by the account protocol: uint64 tokens stay integers. */
export function canonicalAccountJson(value: unknown, depth = 0): string {
  if (depth > 128) throw new Error("account JSON too deep");
  if (typeof value === "bigint" || typeof value === "number") {
    if (typeof value === "number" && !Number.isSafeInteger(value))
      throw new Error(
        "use bigint for large integers; decimal values need runtime markers",
      );
    const n = BigInt(value);
    if (n < -(1n << 63n) || n > MAX64)
      throw new Error("integer outside wire range");
    return String(n);
  }
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "string"
  ) {
    // Python's UTF-8 encoder rejects lone UTF-16 surrogates.
    if (
      typeof value === "string" &&
      value !== new TextDecoder().decode(utf8(value))
    )
      throw new Error("invalid Unicode");
    return JSON.stringify(value);
  }
  if (Array.isArray(value))
    return `[${value.map((v) => canonicalAccountJson(v, depth + 1)).join(",")}]`;
  if (value && Object.getPrototypeOf(value) === Object.prototype) {
    // Sort this level only. Recursively copying the subtree here bypasses the
    // depth bound on cyclic/deep inputs and repeats work at every parent.
    const keys = Object.keys(value).sort((a, b) => {
      const x = Array.from(a),
        y = Array.from(b);
      for (let i = 0; i < Math.min(x.length, y.length); i++) {
        const d = x[i]!.codePointAt(0)! - y[i]!.codePointAt(0)!;
        if (d) return d;
      }
      return x.length - y.length;
    });
    return `{${keys.map((k) => `${canonicalAccountJson(k)}:${canonicalAccountJson((value as Record<string, unknown>)[k], depth + 1)}`).join(",")}}`;
  }
  throw new Error("invalid account JSON value");
}
export function generateHybridKeys(): {
  public: HybridPublicKeys;
  secret: HybridSecretKeys;
} {
  const seed = randomBytes(32),
    pq = ml_dsa65.keygen();
  return {
    public: {
      ed25519: hex(ed25519.getPublicKey(seed)),
      ml_dsa_65: hex(pq.publicKey),
    },
    secret: { ed25519_seed: hex(seed), ml_dsa_65: hex(pq.secretKey) },
  };
}
function checkSecret(secret: HybridSecretKeys, keys: HybridPublicKeys): void {
  exact(secret, ["ed25519_seed", "ml_dsa_65"]);
  if (
    hex(ed25519.getPublicKey(bytes(secret.ed25519_seed, 32))) !==
      keys.ed25519 ||
    hex(ml_dsa65.getPublicKey(expandPqSecret(secret))) !== keys.ml_dsa_65
  )
    throw new Error("backup private keys do not match registry");
}
function expandPqSecret(secret: HybridSecretKeys): Uint8Array {
  return secret.ml_dsa_65.length === 64
    ? ml_dsa65.keygen(bytes(secret.ml_dsa_65, 32)).secretKey
    : bytes(secret.ml_dsa_65, 4032);
}
function payloadBytes(payload: XianTxPayload): Uint8Array {
  const message = utf8(canonicalAccountJson(payload));
  if (!message.length || message.length > 131072)
    throw new Error("account payload exceeds limit");
  return concatBytes(be(BigInt(message.length), 4), message);
}
function transcript(
  keys: HybridPublicKeys,
  epoch: number | bigint,
  payload: XianTxPayload,
  role: string,
): Uint8Array {
  if (
    !["transaction", "authority", "new_active", "new_recovery"].includes(role)
  )
    throw new Error("invalid role");
  return concatBytes(
    utf8("XIAN-ACCOUNT-TX\0"),
    new Uint8Array([1, 1, role.length]),
    utf8(role),
    be(uint(epoch), 8),
    bytes(keys.ed25519, 32),
    bytes(keys.ml_dsa_65, 1952),
    payloadBytes(payload),
  );
}
export function signAccountAuthorization(
  keys: HybridPublicKeys,
  secret: HybridSecretKeys,
  epoch: number | bigint,
  payload: XianTxPayload,
  role = "transaction",
): string {
  publicKeys(keys);
  checkSecret(secret, keys);
  const msg = transcript(keys, epoch, payload, role);
  const sig = concatBytes(
    utf8("XIAN-ACCOUNT-AUTH\0"),
    new Uint8Array([1, 1]),
    be(uint(epoch), 8),
    ed25519.sign(msg, bytes(secret.ed25519_seed, 32)),
    ml_dsa65.sign(msg, expandPqSecret(secret)),
  );
  if (!verifyAccountAuthorization(keys, epoch, payload, hex(sig), role))
    throw new Error("account signature self-check failed");
  return hex(sig);
}
export function verifyAccountAuthorization(
  keys: HybridPublicKeys,
  epoch: number | bigint,
  payload: XianTxPayload,
  signature: string,
  role = "transaction",
): boolean {
  try {
    publicKeys(keys);
    const sig = bytes(signature, 3401),
      head = concatBytes(
        utf8("XIAN-ACCOUNT-AUTH\0"),
        new Uint8Array([1, 1]),
        be(uint(epoch), 8),
      );
    if (hex(sig.subarray(0, head.length)) !== hex(head)) return false;
    const msg = transcript(keys, epoch, payload, role);
    return (
      ed25519.verify(
        sig.subarray(head.length, head.length + 64),
        msg,
        bytes(keys.ed25519, 32),
        {
          zip215: false,
        },
      ) &&
      ml_dsa65.verify(
        sig.subarray(head.length + 64),
        msg,
        bytes(keys.ml_dsa_65, 1952),
      )
    );
  } catch {
    return false;
  }
}
export function parseAccountBackup(value: unknown): AccountBackup {
  exact(value, [
    "version",
    "kind",
    "chain_id",
    "sender",
    "record",
    "role",
    "secret",
  ]);
  if (
    (value.version !== 1 && value.version !== 2) ||
    value.kind !== "xian-account-backup" ||
    typeof value.chain_id !== "string" ||
    !value.chain_id.length ||
    value.chain_id.length > 256 ||
    typeof value.sender !== "string" ||
    !/^[0-9a-fA-F]{64}$/.test(value.sender) ||
    !["active", "recovery"].includes(value.role as string)
  )
    throw new Error("invalid account backup");
  const record = parseAccountRecord(value.record),
    role = value.role as AccountKeyRole;
  exact(value.secret, ["ed25519_seed", "ml_dsa_65"]);
  bytes(value.secret.ml_dsa_65, value.version === 2 ? 32 : 4032);
  checkSecret(value.secret as unknown as HybridSecretKeys, record[role]);
  // Public-key derivation ignores cached fields in an expanded ML-DSA secret.
  // A usable backup must also produce a valid signature (not just the same pk).
  const challenge = utf8("XIAN-ACCOUNT-BACKUP-CHECK\0v1");
  const proof = ml_dsa65.sign(
    challenge,
    expandPqSecret(value.secret as unknown as HybridSecretKeys),
  );
  if (!ml_dsa65.verify(proof, challenge, bytes(record[role].ml_dsa_65, 1952)))
    throw new Error("backup private key signing check failed");
  return {
    version: value.version,
    kind: "xian-account-backup",
    chain_id: value.chain_id,
    sender: value.sender,
    record,
    role,
    secret: { ...(value.secret as unknown as HybridSecretKeys) },
  };
}
const AAD = utf8("XIAN-ACCOUNT-BACKUP\0v1");
export async function encryptAccountBackup(
  value: AccountBackup,
  password: string,
): Promise<string> {
  const clear = utf8(canonicalAccountJson(parseAccountBackup(value)));
  if (password.length < 12)
    throw new Error("use a backup password of at least 12 characters");
  const salt = randomBytes(16),
    iv = randomBytes(12);
  const key = await pbkdf2Async(sha256, utf8(password), salt, {
    c: 600000,
    dkLen: 32,
  });
  try {
    return JSON.stringify({
      version: 1,
      kind: "xian-account-backup-encrypted",
      iterations: 600000,
      salt: hex(salt),
      iv: hex(iv),
      ciphertext: hex(gcm(key, iv, AAD).encrypt(clear)),
    });
  } finally {
    key.fill(0);
    clear.fill(0);
  }
}
export async function decryptAccountBackup(
  text: string,
  password: string,
): Promise<AccountBackup> {
  if (typeof text !== "string" || text.length > MAX_BACKUP)
    throw new Error("account backup too large");
  const v = JSON.parse(text);
  exact(v, ["version", "kind", "iterations", "salt", "iv", "ciphertext"]);
  if (
    v.version !== 1 ||
    v.kind !== "xian-account-backup-encrypted" ||
    v.iterations !== 600000 ||
    typeof v.ciphertext !== "string" ||
    v.ciphertext.length > MAX_BACKUP ||
    v.ciphertext.length < 32
  )
    throw new Error("invalid encrypted account backup");
  const salt = bytes(v.salt, 16),
    iv = bytes(v.iv, 12),
    ciphertext = bytes(v.ciphertext, v.ciphertext.length / 2);
  const key = await pbkdf2Async(sha256, utf8(password), salt, {
    c: 600000,
    dkLen: 32,
  });
  try {
    const clear = gcm(key, iv, AAD).decrypt(ciphertext);
    try {
      return parseAccountBackup(decodeRuntime(new TextDecoder().decode(clear)));
    } finally {
      clear.fill(0);
    }
  } finally {
    key.fill(0);
  }
}
export class HybridAccountSigner implements XianSigner {
  readonly backup: AccountBackup;
  constructor(backup: AccountBackup) {
    this.backup = parseAccountBackup(backup);
    if (this.backup.role !== "active")
      throw new Error("recovery keys cannot spend");
  }
  getAddress(): string {
    return this.backup.sender;
  }
  signMessage(): never {
    throw new Error(
      "hybrid account message signing is not supported by the legacy message protocol",
    );
  }
  signTransaction(tx: XianUnsignedTransaction): XianSignedTransaction {
    const b = this.backup;
    if (
      tx.payload.sender !== b.sender ||
      tx.payload.chain_id !== b.chain_id ||
      tx.payload.contract === "_accounts"
    )
      throw new Error("account, chain or operation mismatch");
    return {
      payload: tx.payload,
      metadata: {
        tx_format: "xian_account_v1",
        auth: {
          scheme: SCHEME,
          signature: signAccountAuthorization(
            b.record.active,
            b.secret,
            b.record.epoch,
            tx.payload,
          ),
        },
      },
    };
  }
}

/** A draft cannot sign until both independently saved files have been reopened. */
export class AccountTransitionDraft {
  readonly active: AccountBackup;
  readonly recovery: AccountBackup;
  private verified = new Map<AccountKeyRole, string>();
  constructor(chainId: string, sender: string, epoch: number | bigint,
    material?: { active: AccountBackup; recovery: AccountBackup }) {
    if (material) {
      this.active = parseAccountBackup(material.active);
      this.recovery = parseAccountBackup(material.recovery);
      if (this.active.chain_id !== chainId || this.active.sender !== sender ||
          uint(this.active.record.epoch) !== uint(epoch) || this.active.role !== "active" ||
          this.recovery.role !== "recovery" || this.recovery.chain_id !== chainId ||
          this.recovery.sender !== sender ||
          canonicalAccountJson(this.active.record) !== canonicalAccountJson(this.recovery.record))
        throw new Error("draft credential binding mismatch");
      return;
    }
    const active = generateHybridKeys(),
      recovery = generateHybridKeys();
    const record: AccountRecord = {
      version: 1,
      epoch,
      active: active.public,
      recovery: recovery.public,
    };
    this.active = parseAccountBackup({
      version: 1,
      kind: "xian-account-backup",
      chain_id: chainId,
      sender,
      record,
      role: "active",
      secret: active.secret,
    });
    this.recovery = parseAccountBackup({
      ...this.active,
      role: "recovery",
      secret: recovery.secret,
    });
  }
  async exportBackup(role: AccountKeyRole, password: string): Promise<string> {
    return encryptAccountBackup(this[role], password);
  }
  async verifyBackup(
    role: AccountKeyRole,
    file: string,
    password: string,
  ): Promise<void> {
    this.verified.delete(role);
    if (
      canonicalAccountJson(await decryptAccountBackup(file, password)) !==
      canonicalAccountJson(this[role])
    )
      throw new Error("this is not the new backup for this account and role");
    this.verified.set(role, canonicalAccountJson(this[role]));
  }
  get ready(): boolean {
    return (
      this.verified.get("active") === canonicalAccountJson(this.active) &&
      this.verified.get("recovery") === canonicalAccountJson(this.recovery)
    );
  }
  sign(
    payload: XianTxPayload,
    authority: string | AccountBackup,
  ): XianSignedTransaction {
    if (!this.ready)
      throw new Error(
        "reopen and verify both new backup files before enrollment or recovery",
      );
    if (
      payload.chain_id !== this.active.chain_id ||
      payload.sender !== this.active.sender ||
      payload.contract !== "_accounts" ||
      !["enroll", "rotate", "recover"].includes(payload.function) ||
      Object.keys(payload.kwargs).join() !== "record" ||
      canonicalAccountJson(payload.kwargs.record) !==
        canonicalAccountJson(this.active.record)
    )
      throw new Error("transition draft does not match payload");
    let signature: string;
    if (payload.function === "enroll") {
      if (
        typeof authority !== "string" ||
        hex(ed25519.getPublicKey(bytes(authority, 32))) !==
          payload.sender.toLowerCase() ||
        uint(this.active.record.epoch) !== 0n
      )
        throw new Error("invalid enrollment authority");
      signature = hex(
        ed25519.sign(
          concatBytes(
            utf8("XIAN-ACCOUNT-ENROLL\0"),
            new Uint8Array([1, 1]),
            payloadBytes(payload),
          ),
          bytes(authority, 32),
        ),
      );
    } else {
      const old = parseAccountBackup(authority);
      const role = payload.function === "recover" ? "recovery" : "active";
      if (
        old.role !== role ||
        old.sender !== payload.sender ||
        old.chain_id !== payload.chain_id ||
        uint(old.record.epoch) + 1n !== uint(this.active.record.epoch)
      )
        throw new Error("invalid transition authority");
      signature = signAccountAuthorization(
        old.record[role],
        old.secret,
        old.record.epoch,
        payload,
        "authority",
      );
    }
    return {
      payload,
      metadata: {
        tx_format: "xian_account_v1",
        auth: {
          scheme: payload.function === "enroll" ? "ed25519_enroll_v1" : SCHEME,
          signature,
          active_proof: signAccountAuthorization(
            this.active.record.active,
            this.active.secret,
            this.active.record.epoch,
            payload,
            "new_active",
          ),
          recovery_proof: signAccountAuthorization(
            this.recovery.record.recovery,
            this.recovery.secret,
            this.recovery.record.epoch,
            payload,
            "new_recovery",
          ),
        },
      },
    };
  }
}
