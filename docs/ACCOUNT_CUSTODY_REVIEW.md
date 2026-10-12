# Account custody security review and recovery drills

Review date: 2026-10-11. Scope: the local, unreleased account vault, browser and
mobile custody adapters, portable backups, and production node registry recovery.
This is an implementation review with fault-injection tests, not an independent
cryptographic audit or approval to enable enrollment.

## Findings addressed

| Finding | Risk | Resolution and regression evidence |
| --- | --- | --- |
| Recovered identity lost after another rotation | High availability risk: reconciliation removed the active backup containing the seed used to bind a recovered wallet's stored account identity. A subsequent unlock failed. | Retain superseded active backups when activating or importing replacement keys. Reproduced the failure in both wallets before the fix; both now recover, rotate, reconcile, lock/unlock, export and restore a full backup with the original address. Retained keys do not override the committed registry. |
| Concurrent SDK vault writes | High custody risk for SDK integrators: atomic individual saves did not prevent two vault operations from overwriting each other's state. | Serialize complete operations across vault instances sharing a store object. A suspended-save test runs enrollment and import concurrently and checks preservation of both accounts and the pending transaction. Product adapters also serialize operations. Separate processes/store objects still require external coordination. |
| Incomplete expanded ML-DSA secret validation | Medium recovery risk: public-key derivation ignored cached private-key fields. A damaged `tr` field passed parsing even though signing would fail. | Backup parsing also signs and verifies a domain-separated test message. A mutation test reproduces acceptance before the fix and rejection afterwards. Transition signing already self-verified its signatures, so this was not a bypass of node possession proofs. |
| Submission continued after wallet lock/context change | Sensitive operation could continue using credentials captured before an asynchronous RPC completed. | Check session generation, expiry, selected account, encryption identity and network before vault access/persistence/broadcast. Mobile acquires the operation lock before loading signing material. Both wallet drills suspend nonce lookup, lock the wallet, resume lookup and require rejection with no broadcast and continued access after unlock. |
| Mobile in-memory session outlived authorization | High confidentiality risk: an expired persisted session could still export a full backup because session restoration returned early when keys remained in memory. | Reload and validate persisted authorization before restoring in-memory credentials, clearing them on expiry. The mobile custody drill expires the session after recovery and requires full-vault export to fail. |
| Acknowledged but dropped storage write | An adapter returning success without preserving credentials could allow a transition broadcast. | Validate state before saving and read it back before proceeding. Fault injection proves a silent dropped write prevents broadcast; an activation-write failure leaves the pending credentials usable after restart. Read-back does not certify hardware durability; atomic encrypted storage remains an adapter requirement. |

## Automated recovery matrix

- `packages/client/tests/account-vault-security.test.ts`: concurrent shared-store
  operations; dropped writes; failed activation write and restart; stale,
  wrong-chain and wrong-role imports; corrupted expanded private key.
- `packages/client/tests/hybrid.test.ts`: both encrypted files required; wrong
  password/role; original case-sensitive identity; offline recovery without the
  old seed; unsigned payload mutation; uint64 epochs; timeout/restart;
  archived candidate committing late; failed saves; malformed registry responses;
  exact JSON-RPC wire bytes; production Python/node interoperability.
- Browser `packages/wallet-core/tests/controller.test.ts`, hybrid custody drill:
  fresh-wallet recovery, repeated rotation, full version-3 backup restore,
  lock during submission and unchanged sender. The extension's Playwright file
  picker test covers actual encrypted file download/reopening and submit gating.
- Mobile `src/lib/__tests__/hybrid-custody.test.ts`: real SDK cryptography with
  mocked platform storage/crypto interfaces, fresh-wallet recovery, repeated
  rotation, full backup restore, hybrid spending and lock during submission.
- Node `tests/abci_methods/test_account_registry.py`: actual ABCI/LMDB enrollment,
  rotation and recovery; balances, allowances and ownership preservation;
  old-key/replay rejection; invalid proof rejection; failed execution and atomic
  commit; restart and snapshot restore; configured fees; enrollment closure.
  Additional drills interrupt recovery commit, restart after retry, reject stale
  active/recovery backups, and repeat recovery with the current backup. An
  insufficient-fee recovery keeps the old authorization, consumes its execution
  nonce, and succeeds after funding the same address using the next nonce.

## Local validation result

The reviewed local source passed:

- JS SDK validation: 133 tests, plus 6 release checks; 2 unrelated optional
  compiler tests skipped. The production Python/node interoperability test ran.
- Browser wallet validation: 112 unit tests, 6 release checks, and all 17
  Playwright checks, including backup file verification.
- Mobile: type checking and 88 tests across 20 suites, including session expiry.
- Node registry: 17 tests and 11 adversarial subtests against ABCI/LMDB.
- Python portable-backup interoperability: 3 tests against the rebuilt JS SDK.
- Documentation build, workspace conventions and diff whitespace checks passed.

These counts describe this local review run, not a pinned production release.

## Activation decision

The 2026-10-12 follow-up closes the archived-candidate downgrade gap, bounds
canonicalization before recursive traversal, and tests malformed backup envelopes
before KDF work. Browser and mobile session persistence now serialize save/clear
and reject reads/writes that finish after locking. Delayed-write, stale-read,
restart and password-unlock tests cover these cases. See the
[node security and resource review](../../xian-abci/docs/ACCOUNT_SECURITY_REVIEW.md)
for local admission benchmarks, allocation stress and unchanged enrollment gates.

Keep enrollment disabled. Before activation, obtain independent review of the
protocol and implementations. The five-validator native rehearsal now passes on
CometBFT 0.39.3 with current working sources; its command and integration inventory
are documented in `xian-meta/docs/ACCOUNT_REGISTRY_PROTOCOL.md`. Repeat against the
coordinated published packages/images before activation. Exercise browser service
worker termination and physical Android/iOS force-stop, storage exhaustion,
SecureStore/Keychain loss, biometric/password migration and file-provider
round-trips. Measure signing, verification, backup validation and memory costs
on supported devices, including malformed inputs and growing retained-key vaults.
Unit mocks and JavaScript bundle builds do not close these device gates.

RPC state is trusted; wallets do not authenticate registry queries with a light
client proof. Recovery is immediate and cannot veto an attacker who already
controls both active secrets. Losing both usable backup roles/passwords can
permanently lose access. Old seed-only backups cannot restore enrolled accounts.
All of these boundaries must remain explicit in the product documentation.

Closing enrollment means setting `enrollment_open` false while retaining the
policy and records. Removing the policy or rolling nodes back to software that
cannot verify hybrid accounts can lock enrolled accounts out. Rehearse rollback
and emergency procedures without reverting committed account epochs or restoring
legacy authority. No change here activates a network or establishes quantum
security for validators, bridges or shielded proofs.
