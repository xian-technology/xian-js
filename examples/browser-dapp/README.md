# Browser dApp Example

This example is a small Vite app that exercises the public `xian-js` packages
from a browser environment.

It demonstrates:

- constructing a `XianClient`
- generating or restoring an Ed25519 dev signer
- connecting through the in-memory provider contract
- reading wallet info through the provider surface
- registering that provider as an injected wallet on `window`
- rediscovering the injected wallet through `InjectedXianWallet`
- requesting asset watching for the native token
- reading chain id, nonce, and balance
- preparing, signing, and broadcasting a transaction through the wallet
- sending an intent-based call without building the full tx in the dapp
- subscribing to block and balance updates through the dashboard websocket

## Run

From the repo root:

```bash
npm install
npm run build
npm run dev --workspace example-browser-dapp
```

Then open the local Vite URL and point the app at a reachable Xian RPC and
dashboard endpoint.

The example includes two wallet-specific actions:

- `Inject Demo Wallet`: registers the in-memory provider into the browser
  namespace as if a wallet extension had injected it
- `Use Injected Wallet`: rebinds the app to the discovered injected wallet path
