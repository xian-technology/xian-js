import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import {
  AccountTransitionDraft,
  HybridAccountSigner,
  canonicalAccountJson,
  decryptAccountBackup,
  verifyAccountAuthorization
} from "../src/hybrid.js";
import { AccountVault, type AccountVaultState } from "../src/account-vault.js";
import { Ed25519Signer } from "../src/ed25519.js";
import { prepareTransaction } from "../src/transaction.js";
const seed = "23".repeat(32),
  sender = new Ed25519Signer(seed).address.toUpperCase();
const password = "correct horse battery staple";
async function verified(epoch: number | bigint = 0) {
  const d = new AccountTransitionDraft("local-test", sender, epoch);
  for (const role of ["active", "recovery"] as const)
    await d.verifyBackup(role, await d.exportBackup(role, password), password);
  return d;
}
const payload = (d: AccountTransitionDraft, op = "enroll") => ({
  chain_id: "local-test",
  sender,
  nonce: 0,
  chi_supplied: 1000,
  contract: "_accounts",
  function: op,
  kwargs: { record: d.active.record }
});
describe("production account authorization", { timeout: 60000 }, () => {
  it("requires reopening both correct role backups and rejects mismatches", async () => {
    const d = new AccountTransitionDraft("local-test", sender, 0);
    expect(() => d.sign(payload(d), seed)).toThrow(/both/);
    const a = await d.exportBackup("active", password);
    await expect(d.verifyBackup("recovery", a, password)).rejects.toThrow();
    await expect(d.verifyBackup("active", a, "wrong password")).rejects.toThrow();
    await d.verifyBackup("active", a, password);
    expect(d.ready).toBe(false);
    await d.verifyBackup("recovery", await d.exportBackup("recovery", password), password);
    const tx = d.sign(payload(d), seed);
    expect(tx.payload.sender).toBe(sender);
    expect(
      verifyAccountAuthorization(
        d.active.record.active,
        0,
        tx.payload,
        tx.metadata.auth!.active_proof!,
        "new_active"
      )
    ).toBe(true);
    expect(
      verifyAccountAuthorization(
        d.active.record.active,
        0,
        { ...tx.payload, nonce: 1 },
        tx.metadata.auth!.active_proof!,
        "new_active"
      )
    ).toBe(false);
  });
  it("restores spending and recovery without the old private key, retaining exact identity", async () => {
    const old = await verified(),
      next = await verified(1);
    const recovery = await decryptAccountBackup(
      await old.exportBackup("recovery", password),
      password
    );
    const tx = next.sign(payload(next, "recover"), recovery);
    expect(
      verifyAccountAuthorization(
        old.active.record.recovery,
        0,
        tx.payload,
        tx.metadata.auth!.signature,
        "authority"
      )
    ).toBe(true);
    expect(() => new HybridAccountSigner(recovery)).toThrow(/cannot spend/);
    const active = await decryptAccountBackup(
      await next.exportBackup("active", password),
      password
    );
    const spend = new HybridAccountSigner(active).signTransaction({
      payload: {
        ...payload(next),
        contract: "currency",
        function: "transfer",
        kwargs: { to: "a", amount: { __fixed__: "1.5" } }
      }
    });
    expect(spend.payload.sender).toBe(sender);
    expect(
      verifyAccountAuthorization(
        active.record.active,
        1,
        spend.payload,
        spend.metadata.auth!.signature
      )
    ).toBe(true);
    expect(() => new HybridAccountSigner(active).signMessage()).toThrow();
  });
  it("keeps uint64 epochs as canonical integer tokens", async () => {
    const d = await verified((1n << 64n) - 1n);
    const tx = new HybridAccountSigner(d.active).signTransaction({
      payload: {
        ...payload(d),
        contract: "currency",
        function: "transfer",
        kwargs: { to: "a", amount: 1 }
      }
    });
    expect(canonicalAccountJson(d.active.record)).toContain('"epoch":18446744073709551615');
    expect(prepareTransaction(tx).json).not.toContain("__big_int__");
    expect(() => new AccountTransitionDraft("local-test", sender, 1n << 64n)).toThrow();
  });
  it("persists before broadcast, survives timeout/restart, and activates only committed keys", async () => {
    let stored: AccountVaultState | null = null,
      record: unknown = null,
      readsFail = false;
    const client = {
      getChainId: async () => "local-test",
      getNonce: async () => 0,
      getState: async (_c: string, variable: string) => {
        if (readsFail) throw new Error("offline");
        return variable === "policy"
          ? { version: 1, enrollment_open: true, transition_chi: 1000 }
          : record;
      },
      broadcastTx: async () => {
        expect(stored!.pending).toHaveLength(1);
        throw new Error("timeout");
      }
    };
    const store = {
      load: async () => stored,
      save: async (v: AccountVaultState) => {
        stored = structuredClone(v);
      }
    };
    const vault = new AccountVault(store, client),
      draft = await vault.begin(sender, "enroll");
    await draft.verifyMasterBackup(await draft.exportMasterBackup(password), password);
    await expect(vault.submit(draft, "enroll", seed)).rejects.toThrow("timeout");
    const restarted = new AccountVault(store, client);
    expect(await restarted.reconcile(sender)).toBe("pending");
    expect(stored!.active).toHaveLength(0);
    record = draft.active.record;
    expect(await restarted.reconcile(sender)).toBe("active");
    expect(stored!.pending).toHaveLength(0);
    expect((await restarted.active(sender)).sender).toBe(sender);
    readsFail = true;
    await expect(
      restarted.sign({ payload: payload(draft) }, new Ed25519Signer(seed))
    ).rejects.toThrow("offline");
  });
  it("retains an archived candidate when a late broadcast commits", async () => {
    const draft = await verified();
    let record: unknown = null;
    let state: AccountVaultState = {
      version: 1,
      active: [],
      pending: [{ candidate: draft.active, transaction: draft.sign(payload(draft), seed) }]
    };
    const vault = new AccountVault(
      {
        load: async () => structuredClone(state),
        save: async (s) => {
          state = structuredClone(s);
        }
      },
      {
        getChainId: async () => "local-test",
        getNonce: async () => 1,
        getState: async () => record,
        broadcastTx: async () => {
          throw new Error("not used");
        }
      }
    );
    await vault.archivePending(sender);
    expect(state.pending).toHaveLength(0);
    expect(state.retained).toHaveLength(1);
    record = draft.active.record;
    expect(await vault.reconcile(sender)).toBe("active");
    expect((await vault.active(sender)).secret).toEqual(draft.active.secret);
  });
  it("uses a JSON-RPC body containing the exact ASCII-hex transaction bytes", async () => {
    const { XianClient } = await import("../src/client.js");
    const draft = await verified();
    const tx = draft.sign(payload(draft), seed);
    let called = false;
    const client = new XianClient({
      rpcUrl: "http://127.0.0.1:26657",
      fetchFn: async (url, options) => {
        called = true;
        expect(String(url)).toBe("http://127.0.0.1:26657/");
        const body = JSON.parse(options!.body as string);
        expect(body.method).toBe("broadcast_tx_sync");
        expect(atob(body.params.tx)).toBe(prepareTransaction(tx).rpcHex);
        return new Response(
          JSON.stringify({ jsonrpc: "2.0", id: body.id, result: { code: 0, hash: "1234" } }),
          { status: 200 }
        );
      }
    });
    expect((await client.broadcastTx(tx)).accepted).toBe(true);
    expect(called).toBe(true);
  });
  it("rejects malformed registry RPC responses instead of interpreting them as a legacy account", async () => {
    const { XianClient } = await import("../src/client.js");
    for (const result of [
      {},
      { response: { value: "" } },
      { response: { value: btoa("invalid JSON") } }
    ]) {
      const client = new XianClient({
        rpcUrl: "http://127.0.0.1:26657",
        fetchFn: async () => new Response(JSON.stringify({ result }), { status: 200 })
      });
      await expect(client.getState("_accounts", "records", [sender])).rejects.toThrow();
    }
  });
  it("does not broadcast if durable storage fails", async () => {
    const d = await verified();
    let calls = 0;
    const v = new AccountVault(
      {
        load: async () => null,
        save: async () => {
          throw new Error("disk full");
        }
      },
      {
        getChainId: async () => "local-test",
        getNonce: async () => 0,
        getState: async (_, key) =>
          key === "policy" ? { version: 1, enrollment_open: true, transition_chi: 1000 } : null,
        broadcastTx: async () => {
          calls++;
          throw new Error("unexpected");
        }
      }
    );
    await expect(v.submit(d, "enroll", seed)).rejects.toThrow("disk full");
    expect(calls).toBe(0);
  });
  it.skipIf(!process.env.XIAN_ACCOUNT_PYTHON)(
    "interoperates with the production Python verifier",
    async () => {
      const d = await verified(),
        tx = d.sign(payload(d), seed);
      const code = `import sys,json\nfrom xian_accounts.hybrid import AccountRecord,verify,enrollment_transcript\nfrom nacl.signing import VerifyKey\nt=json.load(sys.stdin);p=t['payload'];a=t['metadata']['auth'];r=AccountRecord.from_dict(p['kwargs']['record']);m=json.dumps(p,ensure_ascii=False,sort_keys=True,separators=(',',':')).encode()\nVerifyKey(bytes.fromhex(p['sender'])).verify(enrollment_transcript(m),bytes.fromhex(a['signature']))\nassert verify(r.active,r.epoch,m,bytes.fromhex(a['active_proof']),role='new_active')\nassert verify(r.recovery,r.epoch,m,bytes.fromhex(a['recovery_proof']),role='new_recovery')\nprint('ok')`;
      const next = await verified(1);
      const recoveryTx = next.sign(payload(next, "recover"), d.recovery);
      const spend = new HybridAccountSigner(next.active).signTransaction({
        payload: {
          ...payload(next),
          contract: "currency",
          function: "transfer",
          kwargs: { to: "ff".repeat(32), amount: 1 }
        }
      });
      const nodeCode = `import sys,json\nfrom xian.account_registry import AccountRegistry\nfrom xian.utils.tx import decode_and_validate_transaction_static_bytes\nclass Driver:\n def __init__(self): self.data={'_accounts.policy':{'version':1,'enrollment_open':True,'transition_chi':1000}}\n def get(self,key,**kwargs): return self.data.get(key)\nd=Driver()\nfor tx in json.load(sys.stdin):\n raw=json.dumps(tx,ensure_ascii=False,sort_keys=True,separators=(',',':')).encode().hex().encode()\n reg=AccountRegistry(d,'local-test')\n decode_and_validate_transaction_static_bytes(raw,chain_id='local-test',account_registry=reg)\n candidate=reg.authorize(tx)\n if candidate: d.data['_accounts.records:'+tx['payload']['sender']]=candidate.to_dict()\nprint('ok')`;
      expect(
        execFileSync(process.env.XIAN_ACCOUNT_PYTHON!, ["-c", nodeCode], {
          input: canonicalAccountJson([tx, recoveryTx, spend]),
          encoding: "utf8"
        }).trim()
      ).toBe("ok");
      expect(
        execFileSync(process.env.XIAN_ACCOUNT_PYTHON!, ["-c", code], {
          input: canonicalAccountJson(tx),
          encoding: "utf8"
        }).trim()
      ).toBe("ok");
    }
  );
});
