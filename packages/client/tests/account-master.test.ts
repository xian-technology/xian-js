import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { AccountTransitionDraft, canonicalAccountJson, HybridAccountSigner, parseAccountBackup,
  verifyAccountAuthorization } from "../src/hybrid.js";
import { MasterAccountTransitionDraft, accountBackupFromMaster, createAccountMaster,
  exportAccountMaster, importAccountMaster, readAccountCredential } from "../src/account-master.js";
import { AccountVault, type AccountVaultState } from "../src/account-vault.js";
import { Ed25519Signer } from "../src/ed25519.js";

const seed = "23".repeat(32), sender = new Ed25519Signer(seed).address.toUpperCase();
const payload = (d: AccountTransitionDraft, operation = "enroll") => ({
  sender, chain_id: "local-test", nonce: 0, chi_supplied: 1000,
  contract: "_accounts", function: operation, kwargs: { record: d.active.record },
});
describe("one master account backup", { timeout: 60000 }, () => {
  it("reopens one backup, rejects role-only verification, and detects draft changes", async () => {
    const d = new MasterAccountTransitionDraft("local-test", sender, 0);
    expect(() => d.sign(payload(d), seed)).toThrow(/master/);
    for (const role of ["active", "recovery"] as const)
      await d.verifyBackup(role, await d.exportBackup(role, "long enough password"), "long enough password");
    expect(d.ready).toBe(false);
    const file = await d.exportMasterBackup();
    await d.verifyMasterBackup(file);
    const tx = d.sign(payload(d), seed);
    expect(verifyAccountAuthorization(d.active.record.active, 0, tx.payload, tx.metadata.auth!.active_proof!, "new_active")).toBe(true);
    await expect(d.verifyMasterBackup(file.replace('"master_seed":"', '"master_seed":"0'))).rejects.toThrow();
    expect(d.ready).toBe(false);
    await d.verifyMasterBackup(file);
    d.active.sender = "ff".repeat(32);
    expect(d.ready).toBe(false);
  });
  it("binds derivation to chain, case, epoch, role and algorithm", () => {
    const m = createAccountMaster("local-test", sender, 7, "01".repeat(32));
    const a = accountBackupFromMaster(m, "active"), r = accountBackupFromMaster(m, "recovery");
    expect(new Set([a.secret.ed25519_seed, a.secret.ml_dsa_65, r.secret.ed25519_seed, r.secret.ml_dsa_65]).size).toBe(4);
    for (const other of [createAccountMaster("other", sender, 7, m.master_seed),
      createAccountMaster("local-test", sender.toLowerCase(), 7, m.master_seed),
      createAccountMaster("local-test", sender, 8, m.master_seed)])
      expect(other.record).not.toEqual(m.record);
    expect(createHash("sha256").update(canonicalAccountJson(m)).digest("hex")).toBe("241736b09799e51e179b9a60d33994d15014b8047643cf4d10d5af0ef6500eb0");
    expect(() => parseAccountBackup({ ...a, version: 1 })).toThrow();
  });
  it("imports encrypted/plain master backups and preserves older role backups", async () => {
    const d = new MasterAccountTransitionDraft("local-test", sender, 0);
    const file = await d.exportMasterBackup("long enough password");
    await expect(importAccountMaster(file, "wrong")).rejects.toThrow();
    expect(await readAccountCredential(file, "long enough password", "active")).toEqual(d.active);
    expect(await readAccountCredential(file, "long enough password", "recovery")).toEqual(d.recovery);
    const old = new AccountTransitionDraft("local-test", sender, 0);
    const oldFile = await old.exportBackup("recovery", "long enough password");
    expect(await readAccountCredential(oldFile, "long enough password", "recovery")).toEqual(old.recovery);
    await expect(readAccountCredential(oldFile, "long enough password", "active")).rejects.toThrow(/role/);
    await expect(importAccountMaster(JSON.stringify({ ...JSON.parse(file), iterations: 1e9 }))).rejects.toThrow(/invalid/);
  });
  it("recovers from the sole master, preserves identity, and stores only active children", async () => {
    let state: AccountVaultState | null = null, record: unknown = null;
    const vault = new AccountVault({ load: async () => state, save: async s => { state = structuredClone(s); } }, {
      getChainId: async () => "local-test", getNonce: async () => 0,
      getState: async (_, variable) => variable === "policy" ? { version: 1, enrollment_open: true, transition_chi: 1000 } : record,
      broadcastTx: async tx => { record = tx.payload.kwargs.record; return { accepted: true } as never; },
    });
    const old = await vault.begin(sender, "enroll"), file = await old.exportMasterBackup();
    await old.verifyMasterBackup(file); await vault.submit(old, "enroll", seed); await vault.reconcile(sender);
    expect(canonicalAccountJson(state)).not.toContain((await importAccountMaster(file)).master_seed);
    expect(canonicalAccountJson(state)).not.toContain(old.recovery.secret.ml_dsa_65);
    const next = await vault.begin(sender, "recover"), nextFile = await next.exportMasterBackup();
    await next.verifyMasterBackup(nextFile);
    const recovery = await readAccountCredential(file, "", "recovery");
    const tx = next.sign(payload(next, "recover"), recovery);
    expect(verifyAccountAuthorization(old.recovery.record.recovery, 0, tx.payload, tx.metadata.auth!.signature, "authority")).toBe(true);
    await vault.submit(next, "recover", recovery); await vault.reconcile(sender);
    await expect(vault.importActive(await readAccountCredential(file, "", "active"))).rejects.toThrow(/committed/);
    await vault.importActive(await readAccountCredential(nextFile, "", "active"));
    const active = await vault.active(sender);
    expect(new HybridAccountSigner(active).getAddress()).toBe(sender);
    expect(BigInt(active.record.epoch)).toBe(1n);
    expect(canonicalAccountJson(state)).not.toContain((await importAccountMaster(nextFile)).master_seed);
  });
});
