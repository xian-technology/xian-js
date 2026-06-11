# @xian-tech/web-kit

This package owns the reusable browser-app glue shared by Xian web frontends:
wallet connection helpers, RPC client persistence, formatting, toasts, and
React integration.

It builds on `@xian-tech/client` and `@xian-tech/provider` so individual web
apps do not re-implement the same wallet/RPC plumbing.

## Contents

- `src/wallet.ts`, `src/wallet-react.tsx`: injected-wallet connection helpers
  plus the React wallet context and hooks (`WalletProvider`,
  `useXianWallet`, `connectWallet`, `sendCall`).
- `src/rpc.ts`, `src/rpc-react.ts`: RPC client creation and persisted
  RPC-endpoint stores (`createXianRpcStore`).
- `src/toast-react.tsx`: toast provider and helpers.
- `src/format.ts`: address, number, date, and clipboard utilities
  (`shortAddress`, …).

## Notes

- Keep this package app-agnostic: shared helpers only, no app-specific
  business logic or styling systems.
