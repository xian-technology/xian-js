# @xian-tech/types

This package owns the shared TypeScript contracts used across the `xian-js`
workspace: transaction payload and envelope types, signer interfaces, and
broadcast-mode and numeric helper types.

It has no workspace dependencies and no runtime logic. `@xian-tech/client`
and `@xian-tech/provider` build on these types so dapps, wallets, and tools
can share one transaction model.

## Contents

- `src/index.ts`: the full exported type surface, including
  `XianTxPayload`, `XianUnsignedTransaction`, `XianSignedTransaction`,
  `XianSigner`, `BroadcastMode`, and `XianNumber`.

## Notes

- Changes here are cross-package API changes; align `client/`, `provider/`,
  and downstream wallet repos in the same change set.
