# @xian-tech/types

This package owns the shared TypeScript contracts used across the `xian-js`
workspace: transaction payload and envelope types, signer interfaces, and
broadcast-mode and numeric helper types, plus dependency-free fixed-point and
message-signing primitives.

It has no workspace dependencies. `@xian-tech/client` and
`@xian-tech/provider` build on these contracts and primitives so dapps,
wallets, and tools can share one transaction model.

## Contents

- `src/index.ts`: the full exported type surface, including
  `XianTxPayload`, `XianUnsignedTransaction`, `XianSignedTransaction`,
  `XianSigner`, `BroadcastMode`, and `XianNumber`.

- `src/internal/nonce-reservation.ts`: automatic nonce coordination shared by
  client and provider through `@xian-tech/types/internal/nonce-reservation`.
  This is an SDK implementation detail, outside the public root exports.
  Each client/provider owns its own manager; package-specific adapters
  preserve its public error classes.

## Notes

- Changes here are cross-package API changes; align `client/`, `provider/`,
  and downstream wallet repos in the same change set.
