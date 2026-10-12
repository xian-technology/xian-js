# Tests

This folder covers the public behavior of `@xian-tech/client`.

Current focus:

- deterministic runtime encoding helpers
- transaction building and signing
- basic RPC client and websocket behavior

Account tests also cover hybrid transcript validation, cross-language master
vectors, encrypted backups, vault persistence failures, transition reconciliation,
and recovery. See `account-master.test.ts` and the account-vault tests.
