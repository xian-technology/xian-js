import { beforeAll, describe, expect, it, vi } from "vitest";
import { AccountVault, type AccountVaultState } from "../src/account-vault.js";
import { AccountTransitionDraft as LegacyAccountTransitionDraft, parseAccountBackup } from "../src/hybrid.js";
import { MasterAccountTransitionDraft as AccountTransitionDraft } from "../src/account-master.js";
import { Ed25519Signer } from "../src/ed25519.js";

const seed = "56".repeat(32);
const sender = new Ed25519Signer(seed).address;
const password = "recovery test password";
let draft: AccountTransitionDraft;
let other: AccountTransitionDraft;
beforeAll(async () => {
  draft = new AccountTransitionDraft("local-test", sender, 0);
  other = new AccountTransitionDraft(
    "local-test",
    new Ed25519Signer("78".repeat(32)).address,
    0,
  );
  await draft.verifyMasterBackup(await draft.exportMasterBackup(password), password);
}, 60000);

function harness() {
  let state: AccountVaultState | null = null;
  const records = new Map<string, unknown>();
  const store = {
    load: vi.fn(async () => structuredClone(state)),
    save: vi.fn(async (next: AccountVaultState) => {
      state = structuredClone(next);
    }),
  };
  const client = {
    getChainId: async () => "local-test",
    getNonce: async () => 0,
    getState: async (_: string, key: string, keys?: string[]) =>
      key === "policy"
        ? { version: 1, enrollment_open: true, transition_chi: 1000 }
        : (records.get(keys![0]) ?? null),
    broadcastTx: vi.fn(async () => ({
      submitted: true,
      accepted: true,
      finalized: false,
      response: {},
    })),
  };
  return {
    store,
    client,
    records,
    state: () => state,
    vault: new AccountVault(store, client),
  };
}

describe("account custody failure boundaries", { timeout: 60000 }, () => {
  it("serializes separate vault instances sharing a store without losing pending keys", async () => {
    const h = harness();
    h.records.set(other.active.sender, other.active.record);
    const realSave = h.store.save.getMockImplementation()!;
    let release!: () => void, entered!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const saving = new Promise<void>((resolve) => {
      entered = resolve;
    });
    h.store.save.mockImplementationOnce(async (state) => {
      entered();
      await gate;
      await realSave(state);
    });
    const submitting = h.vault.submit(draft, "enroll", seed);
    await saving;
    const importing = new AccountVault(h.store, h.client).importActive(
      other.active,
    );
    // Drain any runnable competing operation while the first atomic save is suspended.
    await new Promise<void>((resolve) => setImmediate(resolve));
    release();
    await Promise.all([submitting, importing]);
    expect(h.state()!.pending).toHaveLength(1);
    expect(h.state()!.active.map((b) => b.sender)).toEqual([
      other.active.sender,
    ]);
    expect(h.client.broadcastTx).toHaveBeenCalledTimes(1);
  });

  it("does not broadcast when storage acknowledges a write but fails read-back", async () => {
    const h = harness();
    h.store.save.mockResolvedValue(undefined);
    await expect(h.vault.submit(draft, "enroll", seed)).rejects.toThrow(
      /persist|storage/,
    );
    expect(h.client.broadcastTx).not.toHaveBeenCalled();
  });

  it("can restart after a failed activation write without discarding pending keys", async () => {
    const h = harness();
    await h.vault.submit(draft, "enroll", seed);
    h.records.set(sender, draft.active.record);
    h.store.save.mockRejectedValueOnce(new Error("disk full"));
    await expect(h.vault.reconcile(sender)).rejects.toThrow("disk full");
    expect(h.state()!.pending).toHaveLength(1);
    const restarted = new AccountVault(h.store, h.client);
    expect(await restarted.reconcile(sender)).toBe("active");
    expect((await restarted.active(sender)).secret).toEqual(
      draft.active.secret,
    );
  });

  it("rejects stale, wrong-chain and recovery-only active imports without changing custody", async () => {
    const h = harness();
    h.records.set(sender, draft.active.record);
    await h.vault.importActive(draft.active);
    const original = structuredClone(h.state());
    for (const backup of [
      draft.recovery,
      { ...draft.active, chain_id: "another-chain" },
      { ...draft.active, record: { ...draft.active.record, epoch: 1 } },
    ])
      await expect(h.vault.importActive(backup)).rejects.toThrow();
    expect(h.state()).toEqual(original);
    expect(h.client.broadcastTx).not.toHaveBeenCalled();
  });

  it("rejects a corrupted ML-DSA secret even when its derived public key is unchanged", () => {
    const backup = new LegacyAccountTransitionDraft("local-test", sender, 0).active;
    // Expanded key tr begins at byte 64; deriving pk ignores tr.
    const key = Buffer.from(backup.secret.ml_dsa_65, "hex");
    key[64] ^= 1;
    backup.secret.ml_dsa_65 = key.toString("hex");
    expect(() => parseAccountBackup(backup)).toThrow();
  });

  it("rejects a corrupted derived ML-DSA seed", () => {
    const backup = structuredClone(draft.active);
    const key = Buffer.from(backup.secret.ml_dsa_65, "hex");
    key[0] ^= 1;
    backup.secret.ml_dsa_65 = key.toString("hex");
    expect(() => parseAccountBackup(backup)).toThrow();
  });

  it("never falls back to old-key signing after archiving an uncertain broadcast", async () => {
    const h = harness();
    await h.vault.submit(draft, "enroll", seed);
    await h.vault.archivePending(sender);
    expect(h.state()!.pending).toHaveLength(0);
    expect(h.state()!.retained).toHaveLength(1);
    const legacy = new Ed25519Signer(seed);
    const sign = vi.spyOn(legacy, "signMessage");
    const tx = { payload: { chain_id: "local-test", sender, nonce: 0, chi_supplied: 1000,
      contract: "currency", function: "transfer", kwargs: { to: "receiver", amount: 1 } } };
    // The record may be absent because the RPC lags a committed enrollment.
    await expect(new AccountVault(h.store, h.client).sign(tx, legacy)).rejects.toThrow(/hybrid account state unavailable/);
    expect(sign).not.toHaveBeenCalled();
    // When the RPC catches up, the archived keys still restore normal spending.
    h.records.set(sender, draft.active.record);
    expect((await h.vault.sign(tx, legacy)).metadata.tx_format).toBe("xian_account_v1");
  });
});
