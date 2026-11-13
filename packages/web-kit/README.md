# @xian-tech/web-kit

This package owns the reusable browser-app glue shared by Xian web frontends:
wallet connection helpers, RPC client persistence, formatting, toasts, and
React integration.

It builds on `@xian-tech/client` and `@xian-tech/provider` so individual web
apps do not re-implement the same wallet/RPC plumbing.

## Contents

- `src/wallet.ts`, `src/wallet-react.tsx`: injected-wallet connection helpers
  plus the React wallet context and hooks (`WalletProvider`,
  `useXianWallet`, `connectWallet`, `sendCall`). `sendCallFailureMessage`
  and `assertSendCallSucceeded` turn a failed call into user-facing text;
  `txFailureText` explains an `Out of chi.` failure as a chain-state change
  since the estimate (transactions supply exactly their simulated chi).
- `src/rpc.ts`, `src/rpc-react.ts`: RPC client creation and persisted
  RPC-endpoint stores (`createXianRpcStore`).
- `src/toast-react.tsx`: toast provider and helpers.
- `src/format.ts`: address, number, date, and clipboard utilities
  (`shortAddress`, …).

## Notes

- Keep this package app-agnostic: shared helpers only, no app-specific
  business logic or styling systems.

`createXianRpcStore` keeps the selected endpoint in memory. Set `storageKey`
to persist it in the supplied storage adapter or available browser localStorage.
Memory-only stores do not access browser storage. Endpoint changes replace the
cached client and notify epoch subscribers once per changed URL.

`maybeDate` interprets offset-free contract timestamps as UTC, including
microsecond fractions (truncated to JavaScript milliseconds). Explicit timezone
offsets are honored. This keeps chain timestamps consistent across browser
timezones.
