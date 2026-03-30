# xian-js

`xian-js` is the JavaScript / TypeScript SDK workspace for integrating Xian
from browsers, wallets, dapps, and Node.js applications that prefer TS.

## Quick Start

```bash
npm install
npm run validate
```

Example client usage:

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
  kwargs: { to: "bob", amount: "5" },
  stamps: 50_000,
});

const signedTx = await client.signTx(tx, signer);
const submission = await client.broadcastTx(signedTx, { mode: "checktx" });
console.log(submission.txHash);
```

## Principles

- browser and wallet integration come first
- the repo owns the official JS / TS client and provider surface for Xian
- backend- and operator-oriented Python patterns such as SQLite projection
  helpers do not belong in the browser-focused core packages
- transaction signing behavior should stay aligned with `xian-py`
- browser wallet product code now lives in the sibling
  `../xian-wallet-browser` repo

## Injected Wallets

`@xian-tech/provider` now includes the browser-side injection and discovery layer for
real wallet integrations.

Wallet-side registration:

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

Dapp-side discovery:

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

For transaction flows, injected wallets can now either:

- sign or send a fully prepared unsigned tx
- prepare the tx inside the wallet with `prepareTransaction(...)`
- send an intent directly with `sendCall(...)`

## Key Directories

- `packages/client/`: typed RPC client, tx helpers, Ed25519 signer, and
  websocket subscriptions
- `packages/provider/`: browser wallet provider contract and a simple in-memory
  provider implementation plus injected-wallet discovery helpers
- `examples/`: runnable integration examples that exercise the public packages
- `docs/`: repo-local architecture notes and backlog

Current entrypoints include:

- `examples/browser-dapp/`: a dapp-side playground for reads, provider calls,
  websocket subscriptions, and intent-based transaction flows

The browser wallet product line now lives in the sibling
`../xian-wallet-browser` repo.

## Validation

```bash
npm install
npm run typecheck
npm run build
npm run test
```

## Related Docs

- [AGENTS.md](AGENTS.md)
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- [docs/BACKLOG.md](docs/BACKLOG.md)
- [docs/RELEASING.md](docs/RELEASING.md)
- [../xian-meta/docs/XIAN_JS_SDK_MVP.md](../xian-meta/docs/XIAN_JS_SDK_MVP.md)
- [../xian-wallet-browser/README.md](../xian-wallet-browser/README.md)
