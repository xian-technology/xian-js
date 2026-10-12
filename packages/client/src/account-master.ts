/** One user backup; independent, domain-separated active/recovery children. */
import { ed25519 } from "@noble/curves/ed25519.js";
import { ml_dsa65 } from "@noble/post-quantum/ml-dsa.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256, sha512 } from "@noble/hashes/sha2.js";
import { pbkdf2Async } from "@noble/hashes/pbkdf2.js";
import { randomBytes } from "@noble/hashes/utils.js";
import { gcm } from "@noble/ciphers/aes.js";
import { bytesToHex as hex, hexToBytes, utf8ToBytes as utf8, decodeRuntime } from "./encoding.js";
import { AccountTransitionDraft, canonicalAccountJson, decryptAccountBackup,
  parseAccountBackup, parseAccountRecord, type AccountBackup, type AccountKeyRole,
  type AccountRecord } from "./hybrid.js";
import type { XianTxPayload } from "./types.js";

export interface AccountMasterBackup {
  version: 1;
  kind: "xian-account-master";
  chain_id: string;
  sender: string;
  record: AccountRecord;
  master_seed: string;
}
const DOMAIN = utf8("XIAN-ACCOUNT-MASTER\0v1");
const AAD = utf8("XIAN-ACCOUNT-MASTER-BACKUP\0v1");
const MAX = 100_000;
function exact(v: unknown, fields: string[]): asserts v is Record<string, unknown> {
  if (!v || Object.getPrototypeOf(v) !== Object.prototype ||
      Object.keys(v).sort().join() !== fields.sort().join()) throw new Error("invalid master backup fields");
}
function bytes(v: unknown, length: number): Uint8Array {
  if (typeof v !== "string" || v.length !== length * 2 || !/^[0-9a-f]+$/.test(v))
    throw new Error("invalid master backup encoding");
  return hexToBytes(v);
}
function material(chain: string, sender: string, epoch: number | bigint, seed: string) {
  if (typeof chain !== "string" || !chain.length || chain.length > 256 ||
      typeof sender !== "string" || !/^[0-9a-fA-F]{64}$/.test(sender) ||
      (typeof epoch !== "bigint" && (typeof epoch !== "number" || !Number.isSafeInteger(epoch))) ||
      BigInt(epoch) < 0n || BigInt(epoch) >= 1n << 64n) throw new Error("invalid master identity");
  const root = bytes(seed, 32);
  const pair = (role: AccountKeyRole) => {
    const derive = (algorithm: string) => hkdf(sha512, root, DOMAIN,
      utf8(canonicalAccountJson([chain, sender, epoch, role, algorithm])), 32);
    const ed = derive("ed25519"), pq = derive("ml-dsa-65");
    return { public: { ed25519: hex(ed25519.getPublicKey(ed)), ml_dsa_65: hex(ml_dsa65.keygen(pq).publicKey) },
      secret: { ed25519_seed: hex(ed), ml_dsa_65: hex(pq) } };
  };
  try {
    const active = pair("active"), recovery = pair("recovery");
    const record = parseAccountRecord({ version: 1, epoch, active: active.public, recovery: recovery.public });
    const backup = (role: AccountKeyRole): AccountBackup => parseAccountBackup({
      version: 2, kind: "xian-account-backup", chain_id: chain, sender, record, role,
      secret: role === "active" ? active.secret : recovery.secret,
    });
    return { record, active: backup("active"), recovery: backup("recovery") };
  } finally { root.fill(0); }
}
export function createAccountMaster(chain: string, sender: string, epoch: number | bigint,
  seed = hex(randomBytes(32))): AccountMasterBackup {
  const { record } = material(chain, sender, epoch, seed);
  return { version: 1, kind: "xian-account-master", chain_id: chain, sender, record, master_seed: seed };
}
export function parseAccountMaster(value: unknown): AccountMasterBackup {
  exact(value, ["version", "kind", "chain_id", "sender", "record", "master_seed"]);
  if (value.version !== 1 || value.kind !== "xian-account-master") throw new Error("unsupported master backup");
  const record = parseAccountRecord(value.record);
  const derived = material(value.chain_id as string, value.sender as string, record.epoch, value.master_seed as string);
  if (canonicalAccountJson(derived.record) !== canonicalAccountJson(record))
    throw new Error("master does not match account keys");
  return { version: 1, kind: "xian-account-master", chain_id: value.chain_id as string,
    sender: value.sender as string, record, master_seed: value.master_seed as string };
}
export function accountBackupFromMaster(value: AccountMasterBackup, role: AccountKeyRole): AccountBackup {
  if (role !== "active" && role !== "recovery") throw new Error("invalid account role");
  const master = parseAccountMaster(value);
  return material(master.chain_id, master.sender, master.record.epoch, master.master_seed)[role];
}
/** Without a password the file IS the secret. Keep it offline. */
export async function exportAccountMaster(value: AccountMasterBackup, password = ""): Promise<string> {
  const text = canonicalAccountJson(parseAccountMaster(value));
  if (!password) return text;
  if (password.length < 12) throw new Error("use a backup password of at least 12 characters");
  const salt = randomBytes(16), iv = randomBytes(12), clear = utf8(text);
  const key = await pbkdf2Async(sha256, utf8(password), salt, { c: 600000, dkLen: 32 });
  try {
    return JSON.stringify({ version: 1, kind: "xian-account-master-encrypted", iterations: 600000,
      salt: hex(salt), iv: hex(iv), ciphertext: hex(gcm(key, iv, AAD).encrypt(clear)) });
  } finally { key.fill(0); clear.fill(0); }
}
function read(text: string): Record<string, unknown> {
  if (typeof text !== "string" || text.length > MAX) throw new Error("account backup too large");
  const v = decodeRuntime(text);
  if (!v || Object.getPrototypeOf(v) !== Object.prototype) throw new Error("invalid backup");
  return v as Record<string, unknown>;
}
export async function importAccountMaster(text: string, password = ""): Promise<AccountMasterBackup> {
  const v = read(text);
  if (v.kind === "xian-account-master") return parseAccountMaster(v);
  exact(v, ["version", "kind", "iterations", "salt", "iv", "ciphertext"]);
  if (v.version !== 1 || v.kind !== "xian-account-master-encrypted" || v.iterations !== 600000 ||
      typeof v.ciphertext !== "string" || v.ciphertext.length < 32 || v.ciphertext.length > MAX)
    throw new Error("invalid encrypted master backup");
  const salt = bytes(v.salt, 16), iv = bytes(v.iv, 12), ciphertext = bytes(v.ciphertext, v.ciphertext.length / 2);
  const key = await pbkdf2Async(sha256, utf8(password), salt, { c: 600000, dkLen: 32 });
  try {
    const clear = gcm(key, iv, AAD).decrypt(ciphertext);
    try { return parseAccountMaster(read(new TextDecoder().decode(clear))); }
    finally { clear.fill(0); }
  } finally { key.fill(0); }
}
/** Compatibility imports never upgrade an unrelated/obsolete authority. */
export async function readAccountCredential(text: string, password: string, role: AccountKeyRole): Promise<AccountBackup> {
  const kind = read(text).kind;
  const backup = kind === "xian-account-master" || kind === "xian-account-master-encrypted"
    ? accountBackupFromMaster(await importAccountMaster(text, password), role)
    : await decryptAccountBackup(text, password);
  if (backup.role !== role) throw new Error("wrong backup role");
  return backup;
}
/** Recommended transition: exactly one reopened master backup authorizes signing. */
export class MasterAccountTransitionDraft extends AccountTransitionDraft {
  private readonly master: AccountMasterBackup;
  private verifiedMaster: string | null = null;
  constructor(chain: string, sender: string, epoch: number | bigint) {
    const master = createAccountMaster(chain, sender, epoch);
    super(chain, sender, epoch, { active: accountBackupFromMaster(master, "active"),
      recovery: accountBackupFromMaster(master, "recovery") });
    this.master = master;
  }
  exportMasterBackup(password = ""): Promise<string> { return exportAccountMaster(this.master, password); }
  async verifyMasterBackup(text: string, password = ""): Promise<void> {
    this.verifiedMaster = null;
    const master = await importAccountMaster(text, password);
    if (canonicalAccountJson(master) !== canonicalAccountJson(this.master) ||
        canonicalAccountJson(accountBackupFromMaster(master, "active")) !== canonicalAccountJson(this.active) ||
        canonicalAccountJson(accountBackupFromMaster(master, "recovery")) !== canonicalAccountJson(this.recovery))
      throw new Error("not the master backup for this draft");
    this.verifiedMaster = this.fingerprint();
  }
  private fingerprint(): string { return canonicalAccountJson([this.master, this.active, this.recovery]); }
  override get ready(): boolean { return this.verifiedMaster === this.fingerprint(); }
  override sign(payload: XianTxPayload, authority: string | AccountBackup) {
    if (!this.ready) throw new Error("reopen and verify the new master backup first");
    return super.sign(payload, authority);
  }
}
