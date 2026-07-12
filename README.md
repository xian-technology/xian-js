# xian-js

`xian-js` is the JavaScript / TypeScript SDK workspace for integrating Xian
from browsers, wallets, dapps, and Node.js applications. It owns the typed
RPC client, the browser wallet provider contract, the injected-wallet
discovery layer, deterministic DEX planning helpers, and runnable integration
examples.

The repo is a TypeScript monorepo. Its focused packages are installed
independently under the `@xian-tech/*` scope and released together under the
repo-level version policy. Browser wallet *product* code lives in the sibling
[`xian-wallet-browser`](../xian-wallet-browser) repo; this repo provides the
SDK and provider primitives that wallet implementations depend on.

## Workspace Shape

```mermaid
flowchart LR
  Dapp["Dapp"] --> Provider["Injected wallet provider"]
  Dapp --> Dex["@xian-tech/dex planner"]
  Provider --> WalletProduct["Browser wallet product"]
  Dapp --> Client["@xian-tech/client"]
  WalletProduct --> Client
  Client --> RPC["Xian RPC and dashboard websockets"]
  Packages["@xian-tech packages"] --> Client
  Packages --> Provider
  Examples["Examples"] --> Provider
  Examples --> Client
```

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

### DEX Planning

Plan an exact-input DEX swap without coupling route logic to an RPC or wallet:

```ts
import {
  deadlineFromNow,
  planXianDexV1ExactInExecution,
  selectBestXianDexV1ExactInRoute,
} from "@xian-tech/dex";

const quote = selectBestXianDexV1ExactInRoute({
  pairs,
  fromToken: "currency",
  toToken: "con_usdc",
  amountIn: 10,
});
if (!quote) throw new Error("No route");

const plan = planXianDexV1ExactInExecution({
  quote,
  recipient: agentAddress,
  allowance,
  slippageBps: 50,
  deadline: deadlineFromNow(15),
});
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

## Integration Cookbook

Use the client directly when your code owns the signer, such as local
automation, tests, or server-side tooling:

```ts
import { Ed25519Signer, XianClient } from "@xian-tech/client";

const signer = new Ed25519Signer(process.env.XIAN_PRIVATE_KEY);
const client = new XianClient({
  rpcUrl: "http://127.0.0.1:26657",
  dashboardUrl: "http://127.0.0.1:8080",
});

const [chainId, status, balance] = await Promise.all([
  client.getChainId(),
  client.getStatus(),
  client.token().balanceOf(signer.address),
]);

console.log(chainId, status.result, balance);
```

Read contract state, metadata, and simulation results:

```ts
const reserve = await client.getState("con_pairs", "reserves", ["1"]);
const metadata = await client.token("currency").metadata();
const quote = await client.call({
  sender: signer.address,
  contract: "con_dex",
  function: "getAmountsOut",
  kwargs: { amountIn: 10, src: "currency", path: [1] },
});

console.log(reserve, metadata.symbol, quote);
```

Submit a direct transaction with automatic chi estimation:

```ts
const submission = await client.token("currency").transfer({
  signer,
  to: "bob",
  amount: 5,
  mode: "checktx",
  waitForTx: true,
});

console.log(submission.txHash, submission.accepted, submission.finalized);
```

Automatic sends reserve nonces per `XianClient`, chain, and sender. Concurrent
`sendTx(...)` calls (including contract and token convenience helpers) therefore
run their build, sign, and broadcast lifecycles in nonce order and use distinct
sequential nonces. Different senders and chains remain concurrent. Supplying
`nonce` explicitly bypasses this coordination, and `buildTx(...)` remains a
snapshot operation that does not hold a reservation.

Known pre-broadcast failures and structured RPC or CheckTx rejections release
the automatic reservation. A thrown transport error or finalization timeout
after broadcast is ambiguous, so the sender is quarantined from further
automatic sends until `get_next_nonce` proves that the network advanced.
`NonceReservationError` identifies that state. After independently reconciling
the transaction, a caller can deliberately clear it with:

```ts
await client.resetNonceReservation(signer.address, chainId);
```

This reset can allow reuse of a transaction that the network may already have
accepted, so it should not be used as an automatic retry mechanism.

Submit contract source:

```ts
const submission = await client.submitContract({
  name: "con_counter",
  source,
  signer,
  mode: "checktx",
  waitForTx: true,
});
```

`deployContract` is a source-only alias for the same network submission path:

```ts
const submission = await client.deployContract({
  name: "con_counter",
  source,
  signer,
  mode: "checktx",
  waitForTx: true,
});
```

Nodes compile submitted source and store canonical IR themselves. Client-side
artifact compilation remains available only as an offline utility.

Use an injected wallet when a dapp must not see private keys:

```ts
import { verifyXianMessage } from "@xian-tech/client";
import { InjectedXianWallet } from "@xian-tech/provider";

const wallet = await InjectedXianWallet.waitForInjected({ timeoutMs: 1_000 });
if (!wallet) {
  throw new Error("No Xian wallet detected");
}

const [account] = await wallet.connect();
const chainId = await wallet.getChainId();
const info = await wallet.getWalletInfo();

const message = "Authorize this login";
const signature = await wallet.signMessage(message);
const messageIsValid = verifyXianMessage(
  account,
  { account, chainId, message },
  signature
);

const prepared = await wallet.prepareTransaction({
  chainId,
  contract: "currency",
  function: "transfer",
  kwargs: { to: "bob", amount: 5 },
});
const signed = await wallet.signTransaction(prepared);
const sent = await wallet.sendTransaction(prepared, {
  mode: "checktx",
  waitForTx: true,
});

console.log(account, info.capabilities, messageIsValid, signed, sent.txHash);
```

`xian_signMessage` uses the version-1 Xian signed-message envelope. The signed
bytes are length-prefixed and bound to both the active chain and account, so a
signature cannot be replayed as a raw transaction payload or on another Xian
chain/account. Dapps should verify wallet signatures with `verifyXianMessage`;
`verifyMessage` and `signMessage` are low-level raw Ed25519 primitives retained
for transaction internals and explicit low-level integrations.

For the common dapp path, let the wallet prepare, sign, and broadcast from an
intent:

```ts
const submission = await wallet.sendCall(
  {
    chainId,
    contract: "currency",
    function: "transfer",
    kwargs: { to: "bob", amount: 5 },
  },
  { mode: "checktx", waitForTx: true },
);
```

The reference `InMemoryXianProvider` applies the same per-chain, per-sender
ordered lifecycle to concurrent `xian_sendCall` requests. Prebuilt
`xian_sendTransaction` payloads keep their explicit nonce and bypass the
automatic manager. Wallet owners that have independently reconciled an
ambiguous broadcast can call `provider.resetNonceReservation()`; this is an
owner-side recovery method, not a provider request exposed to dapps.

`ProviderBackedXianSigner` delegates canonical transaction payloads through
`xian_signTransaction`. It does not expose a raw provider message-signing mode.

Subscribe to dashboard websocket streams:

```ts
const blockSub = client.watch.blocks((message) => {
  console.log("block", message.height, message.hash);
});

const balanceSub = client.watch.state(
  `currency.balances:${signer.address}`,
  (message) => {
    console.log("balance changed", message.value);
  },
  { onError: console.error },
);

// Later, for cleanup:
await blockSub.unsubscribe();
await balanceSub.unsubscribe();
```

Talk to a shielded relayer:

```ts
import { XianShieldedRelayerClient } from "@xian-tech/client";

const relayer = new XianShieldedRelayerClient({
  relayerUrl: "http://127.0.0.1:38480",
});
const info = await relayer.getInfo();
const quote = await relayer.getQuote({
  kind: "shielded_command",
  contract: "shielded_note_token",
  targetContract: "currency",
});

console.log(info.available, quote.relayerFee, quote.expiresAt);
```

The browser dapp under
[`examples/browser-dapp`](examples/browser-dapp/README.md) exercises these
same flows interactively.

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
- `packages/dex/` — `@xian-tech/dex`: deterministic exact-in route quotes,
  price impact, slippage/deadline, and ordered approval/swap call plans.
- `packages/provider/` — `@xian-tech/provider`: browser wallet provider
  contract, an in-memory reference implementation, and the injected-wallet
  discovery helpers.
- `packages/types/` — shared TypeScript types used across packages.
- `packages/web-kit/` — `@xian-tech/web-kit`: shared browser-app helpers for
  wallet connection, RPC client persistence, formatting, toasts, and React
  integration.
- `examples/` — runnable integration examples that exercise the public
  packages.
  - `browser-dapp/` — dapp-side playground for reads, provider calls,
    websocket subscriptions, and intent-based transaction flows.
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
