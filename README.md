# xian-js

`xian-js` is the JavaScript / TypeScript SDK workspace for integrating Xian
from browsers, wallets, dapps, and Node.js applications. It owns the typed
RPC client, the browser wallet provider contract, the injected-wallet
discovery layer, and runnable integration examples.

The repo is a TypeScript monorepo. Packages publish independently under the
`@xian-tech/*` scope. Browser wallet *product* code now lives in the sibling
[`xian-wallet-browser`](../xian-wallet-browser) repo; this repo provides the
SDK and provider primitives that wallet implementations depend on.

## Quick Start

```bash
npm install
npm run validate
```

Build a transaction, sign it, and broadcast it:

```ts
import { Ed25519Signer, XianClient } from "@xian-tech/client";

const signer = new Ed25519Signer();
const client = new XianClient({
  rpcUrl: "http://127.0.0.1:26657",
  dashboardUrl: "http://127.0.0.1:8080",
});

const tx = await client.buildTx({
  sender: signer.address,
  contract: "currency",
  function: "transfer",
  kwargs: { to: "bob", amount: 5 },
  chi: 50_000,
});

const signedTx = await client.signTx(tx, signer);
const submission = await client.broadcastTx(signedTx, { mode: "checktx" });
console.log(submission.txHash);
```

### Wallet-Side Registration

Register a wallet provider so dapps can discover it:

```ts
import { registerInjectedXianProvider } from "@xian-tech/provider";

registerInjectedXianProvider({
  provider,
  metadata: {
    id: "xian-wallet",
    name: "Xian Wallet",
    rdns: "org.xian.wallet",
  },
  setAsDefault: true,
});
```

### Dapp-Side Discovery

```ts
import { InjectedXianWallet } from "@xian-tech/provider";

const wallet = await InjectedXianWallet.waitForInjected({ timeoutMs: 1_000 });
const accounts = wallet ? await wallet.connect() : [];
const [account] = accounts;
const info = await wallet?.getWalletInfo();
await wallet?.watchAsset({
  type: "token",
  options: { contract: "currency", symbol: "XIAN", name: "Xian" },
});
```

The provider package uses `window.xian` for the default provider namespace,
`window.xianProviders` for multi-wallet discovery, and dispatches the
`xian#initialized` event when a wallet registers itself.

For transaction flows, injected wallets can:

- sign or send a fully prepared unsigned tx
- prepare the tx inside the wallet with `prepareTransaction(...)`
- send an intent directly with `sendCall(...)`

## Principles

- **Browser and wallet integration first.** The package surface is shaped
  for dapps, browser wallets, and TS-first Node.js code.
- **Official JS/TS surface for Xian.** This repo is the canonical home for
  the JS client, the wallet provider contract, and the injected-wallet
  discovery shape.
- **Aligned with `xian-py`.** Transaction signing behavior, broadcast modes,
  and wire formats stay aligned with the Python SDK so the same chain
  semantics apply on both sides.
- **No backend convenience here.** Backend- and operator-oriented patterns
  (SQLite projections, daemon helpers) belong in `xian-py`, not in the
  browser-focused core packages.
- **Wallet product is separate.** The browser wallet product lives in
  `xian-wallet-browser`; this repo only provides the SDK and provider
  primitives.

## Key Directories

- `packages/client/` — `@xian-tech/client`: typed RPC client, transaction
  builder, Ed25519 signer, websocket subscriptions.
- `packages/provider/` — `@xian-tech/provider`: browser wallet provider
  contract, an in-memory reference implementation, and the injected-wallet
  discovery helpers.
- `packages/types/` — shared TypeScript types used across packages.
- `examples/` — runnable integration examples that exercise the public
  packages.
  - `browser-dapp/` — dapp-side playground for reads, provider calls,
    websocket subscriptions, and intent-based transaction flows.
- `apps/` — internal apps used during development.
- `docs/` — repo-local architecture, backlog, and release notes.

## Validation

```bash
npm install
npm run typecheck
npm run build
npm run test
```

`npm run validate` runs the same gates that CI uses.

## Related Docs

- [AGENTS.md](AGENTS.md) — repo-specific guidance for AI agents and contributors
- [docs/README.md](docs/README.md) — index of internal docs
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — major components and dependency direction
- [docs/BACKLOG.md](docs/BACKLOG.md) — open work and follow-ups
- [docs/RELEASING.md](docs/RELEASING.md) — package release process
- [../xian-wallet-browser/README.md](../xian-wallet-browser/README.md) — the browser wallet product that consumes these packages
