import {
  AccountTransitionDraft,
  HybridAccountSigner,
  canonicalAccountJson,
  parseAccountBackup,
  parseAccountRecord,
  type AccountBackup,
  type AccountOperation,
  type AccountRecord,
} from "./hybrid.js";
import { MasterAccountTransitionDraft } from "./account-master.js";
import type {
  XianSignedTransaction,
  XianUnsignedTransaction,
  XianSigner,
} from "./types.js";
import type { TransactionSubmission } from "./types.js";

export interface AccountVaultState {
  version: 1;
  active: AccountBackup[];
  retained?: AccountBackup[];
  pending: Array<{
    candidate: AccountBackup;
    transaction: XianSignedTransaction;
  }>;
}
/** Adapters must encrypt secrets and atomically finish save before resolving.
 * Reuse one store object per vault. Independent processes/adapters must coordinate
 * writes themselves; the in-process queue cannot provide cross-process locking.
 */
export interface AccountVaultStore {
  load(): Promise<AccountVaultState | null>;
  save(state: AccountVaultState): Promise<void>;
}
export interface AccountRegistryClient {
  getChainId(): Promise<string>;
  getNonce(sender: string): Promise<number | bigint>;
  getState(
    contract: string,
    variable: string,
    keys?: string[],
  ): Promise<unknown>;
  broadcastTx(tx: XianSignedTransaction): Promise<TransactionSubmission>;
}
const same = (a: unknown, b: unknown) =>
  canonicalAccountJson(a) === canonicalAccountJson(b);
const matches = (a: AccountBackup, chain: string, sender: string) =>
  a.chain_id === chain && a.sender === sender;
export function parseAccountVault(value: unknown): AccountVaultState {
  const v = value as AccountVaultState;
  if (
    !v ||
    v.version !== 1 ||
    !Array.isArray(v.active) ||
    !Array.isArray(v.pending) ||
    v.active.length > 1000 ||
    (v.retained !== undefined &&
      (!Array.isArray(v.retained) || v.retained.length > 1000)) ||
    v.pending.length > 1000
  )
    throw new Error("invalid account vault");
  const active = v.active.map(parseAccountBackup);
  const retained = (v.retained ?? []).map(parseAccountBackup);
  const pending = v.pending.map((p) => ({
    candidate: parseAccountBackup(p.candidate),
    transaction: p.transaction,
  }));
  if (
    [...active, ...retained].some((b) => b.role !== "active") ||
    pending.some(
      (p) =>
        p.candidate.role !== "active" ||
        !p.transaction ||
        !same(p.transaction.payload.kwargs.record, p.candidate.record) ||
        p.transaction.payload.sender !== p.candidate.sender ||
        p.transaction.payload.chain_id !== p.candidate.chain_id ||
        p.transaction.payload.contract !== "_accounts",
    )
  )
    throw new Error("invalid account vault binding");
  return { version: 1, active, retained, pending };
}
const storeOperations = new WeakMap<AccountVaultStore, Promise<void>>();
async function exclusive<T>(
  store: AccountVaultStore,
  action: () => Promise<T>,
): Promise<T> {
  const previous = storeOperations.get(store) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  storeOperations.set(store, current);
  await previous;
  try {
    return await action();
  } finally {
    release();
    if (storeOperations.get(store) === current) storeOperations.delete(store);
  }
}
function retain(state: AccountVaultState, backups: AccountBackup[]): void {
  state.retained ??= [];
  for (const backup of backups)
    if (!state.retained.some((b) => same(b, backup)))
      state.retained.push(backup);
}
/** Stateful wallet boundary: never treats CheckTx acceptance as activation. */
export class AccountVault {
  constructor(
    private readonly store: AccountVaultStore,
    private readonly client: AccountRegistryClient,
  ) {}
  begin(
    sender: string,
    operation: AccountOperation,
  ): Promise<MasterAccountTransitionDraft> {
    return exclusive(this.store, () => this.beginUnlocked(sender, operation));
  }
  submit(
    draft: AccountTransitionDraft,
    operation: AccountOperation,
    authority: string | AccountBackup,
  ): Promise<TransactionSubmission> {
    return exclusive(this.store, () =>
      this.submitUnlocked(draft, operation, authority),
    );
  }
  reconcile(
    sender: string,
  ): Promise<"pending" | "active" | "legacy" | "missing-keys"> {
    return exclusive(this.store, () => this.reconcileUnlocked(sender));
  }
  archivePending(sender: string): Promise<void> {
    return exclusive(this.store, () => this.archivePendingUnlocked(sender));
  }
  retry(sender: string): Promise<TransactionSubmission> {
    return exclusive(this.store, () => this.retryUnlocked(sender));
  }
  importActive(backup: AccountBackup): Promise<void> {
    return exclusive(this.store, () => this.importActiveUnlocked(backup));
  }
  active(sender: string): Promise<AccountBackup> {
    return exclusive(this.store, () => this.activeUnlocked(sender));
  }
  sign(
    tx: XianUnsignedTransaction,
    legacy: XianSigner,
  ): Promise<XianSignedTransaction> {
    return exclusive(this.store, () => this.signUnlocked(tx, legacy));
  }
  private async save(state: AccountVaultState): Promise<void> {
    const validated = parseAccountVault(state);
    await this.store.save(validated);
    // Never broadcast after a dropped or altered write, even if save resolved.
    if (!same(await this.state(), validated))
      throw new Error("account storage persistence verification failed");
  }
  private async state(): Promise<AccountVaultState> {
    const s = await this.store.load();
    return s ? parseAccountVault(s) : { version: 1, active: [], pending: [] };
  }
  async record(sender: string): Promise<AccountRecord | null> {
    const raw = await this.client.getState("_accounts", "records", [sender]);
    return raw === null ? null : parseAccountRecord(raw);
  }
  async policy(): Promise<{
    transition_chi: number | bigint;
    enrollment_open: boolean;
  }> {
    const p = (await this.client.getState("_accounts", "policy")) as Record<
      string,
      unknown
    > | null;
    if (
      !p ||
      p.version !== 1 ||
      typeof p.enrollment_open !== "boolean" ||
      !["number", "bigint"].includes(typeof p.transition_chi) ||
      (typeof p.transition_chi === "number" &&
        !Number.isSafeInteger(p.transition_chi)) ||
      BigInt(p.transition_chi as number | bigint) <= 0n ||
      BigInt(p.transition_chi as number | bigint) >= 1n << 64n
    )
      throw new Error("account authorization is not enabled on this network");
    return {
      transition_chi: p.transition_chi as number | bigint,
      enrollment_open: p.enrollment_open,
    };
  }
  private async beginUnlocked(
    sender: string,
    operation: AccountOperation,
  ): Promise<MasterAccountTransitionDraft> {
    const chain = await this.client.getChainId(),
      policy = await this.policy(),
      record = await this.record(sender);
    if (
      operation === "enroll"
        ? record !== null || !policy.enrollment_open
        : record === null
    )
      throw new Error("account is not eligible for this transition");
    const state = await this.state();
    if (state.pending.some((p) => matches(p.candidate, chain, sender)))
      throw new Error(
        "resolve the pending transition before creating new keys",
      );
    return new MasterAccountTransitionDraft(
      chain,
      sender,
      record ? BigInt(record.epoch) + 1n : 0,
    );
  }
  private async submitUnlocked(
    draft: AccountTransitionDraft,
    operation: AccountOperation,
    authority: string | AccountBackup,
  ): Promise<TransactionSubmission> {
    const chain = await this.client.getChainId(),
      b = draft.active,
      record = await this.record(b.sender),
      policy = await this.policy();
    if (
      chain !== b.chain_id ||
      (operation === "enroll"
        ? record !== null || !policy.enrollment_open
        : typeof authority === "string" || !same(record, authority.record))
    )
      throw new Error("account state changed; do not enroll with stale keys");
    const state = await this.state();
    if (state.pending.some((p) => matches(p.candidate, chain, b.sender)))
      throw new Error("pending transition must be resolved first");
    const tx = draft.sign(
      {
        chain_id: chain,
        sender: b.sender,
        nonce: await this.client.getNonce(b.sender),
        chi_supplied: policy.transition_chi,
        contract: "_accounts",
        function: operation,
        kwargs: { record: b.record },
      },
      authority,
    );
    // Commit the only future spending keys and exact retry bytes BEFORE network I/O.
    state.pending.push({ candidate: parseAccountBackup(b), transaction: tx });
    await this.save(state);
    return await this.client.broadcastTx(tx);
  }
  private async reconcileUnlocked(
    sender: string,
  ): Promise<"pending" | "active" | "legacy" | "missing-keys"> {
    const chain = await this.client.getChainId(),
      record = await this.record(sender),
      state = await this.state();
    const pending = state.pending.find((p) =>
      matches(p.candidate, chain, sender),
    );
    const recovered = (state.retained ?? []).find(
      (b) => matches(b, chain, sender) && same(record, b.record),
    );
    if (
      recovered &&
      !state.active.some(
        (b) => matches(b, chain, sender) && same(b.record, record),
      )
    ) {
      state.active.push(recovered);
      await this.save(state);
    }
    if (pending && same(record, pending.candidate.record)) {
      // Recovered wallets may use an older seed as their encrypted local identity
      // anchor. Preserve its binding across rotations and full-backup restoration.
      retain(
        state,
        state.active.filter((b) => matches(b, chain, sender)),
      );
      state.active = state.active.filter((b) => !matches(b, chain, sender));
      state.active.push(pending.candidate);
      state.pending = state.pending.filter((p) => p !== pending);
      await this.save(state);
      return "active";
    }
    if (pending) return "pending";
    if (record === null) return "legacy";
    return state.active.some(
      (b) => matches(b, chain, sender) && same(b.record, record),
    )
      ? "active"
      : "missing-keys";
  }
  /** Stops local retries only. A broadcast may still commit: retain its spending keys. */
  private async archivePendingUnlocked(sender: string): Promise<void> {
    const chain = await this.client.getChainId();
    await this.reconcileUnlocked(sender);
    const state = await this.state();
    const pending = state.pending.filter((p) =>
      matches(p.candidate, chain, sender),
    );
    retain(
      state,
      pending.map((p) => p.candidate),
    );
    state.pending = state.pending.filter(
      (p) => !matches(p.candidate, chain, sender),
    );
    await this.save(state);
  }
  private async retryUnlocked(sender: string): Promise<TransactionSubmission> {
    const chain = await this.client.getChainId(),
      state = await this.state();
    const pending = state.pending.find((p) =>
      matches(p.candidate, chain, sender),
    );
    if (!pending) throw new Error("no pending transition");
    if ((await this.reconcileUnlocked(sender)) === "active")
      throw new Error("transition already committed");
    return this.client.broadcastTx(pending.transaction);
  }
  private async importActiveUnlocked(backup: AccountBackup): Promise<void> {
    const b = parseAccountBackup(backup),
      chain = await this.client.getChainId();
    if (
      b.role !== "active" ||
      b.chain_id !== chain ||
      !same(b.record, await this.record(b.sender))
    )
      throw new Error(
        "active backup does not match the committed account on this chain",
      );
    const state = await this.state();
    retain(
      state,
      state.active.filter((old) => matches(old, chain, b.sender)),
    );
    state.active = state.active.filter((old) => !matches(old, chain, b.sender));
    state.active.push(b);
    await this.save(state);
  }
  private async activeUnlocked(sender: string): Promise<AccountBackup> {
    await this.reconcileUnlocked(sender);
    const chain = await this.client.getChainId(),
      record = await this.record(sender),
      state = await this.state();
    const b = state.active.find(
      (b) => matches(b, chain, sender) && same(b.record, record),
    );
    if (!b)
      throw new Error(
        "current hybrid keys unavailable; restore the active backup or recover with the recovery backup",
      );
    return b;
  }
  private async signUnlocked(
    tx: XianUnsignedTransaction,
    legacy: XianSigner,
  ): Promise<XianSignedTransaction> {
    if (tx.payload.chain_id !== (await this.client.getChainId()))
      throw new Error("wrong account chain");
    const record = await this.record(tx.payload.sender);
    if (record !== null)
      return new HybridAccountSigner(
        await this.activeUnlocked(tx.payload.sender),
      ).signTransaction(tx);
    // A missing registry after a local upgrade may be a stale RPC. Never downgrade.
    const state = await this.state();
    if (
      state.active.some((b) =>
        matches(b, tx.payload.chain_id, tx.payload.sender),
      ) ||
      (state.retained ?? []).some((b) =>
        matches(b, tx.payload.chain_id, tx.payload.sender),
      ) ||
      state.pending.some((p) =>
        matches(p.candidate, tx.payload.chain_id, tx.payload.sender),
      )
    )
      throw new Error("hybrid account state unavailable or transition pending");
    if (tx.payload.contract === "_accounts")
      throw new Error("use the verified backup transition flow");
    const address = await legacy.getAddress?.();
    if (address !== tx.payload.sender)
      throw new Error("legacy signer address mismatch");
    const { canonicalizeRuntime } = await import("./encoding.js");
    return {
      payload: tx.payload,
      metadata: {
        signature: await legacy.signMessage(canonicalizeRuntime(tx.payload)),
      },
    };
  }
}
