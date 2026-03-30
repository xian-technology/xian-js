# Architecture

`xian-js` owns the official JS / TS integration surface for Xian.

Current packages:

- `@xian-tech/client`: typed network access, tx helpers, signing primitives, and
  websocket subscriptions
- `@xian-tech/provider`: browser wallet provider contract, injected-wallet discovery
  helpers, and a simple reference implementation
- `examples/browser-dapp`: a runnable browser-side integration example that
  exercises the public package surface

Companion repo:

- `../xian-wallet-browser`: browser wallet apps and wallet-domain product code

Dependency direction:

- `@xian-tech/client` must not depend on `@xian-tech/provider`
- `@xian-tech/provider` may depend on `@xian-tech/client` types and helpers
- browser wallet implementations should consume `@xian-tech/provider` rather than
  redefining the injected-provider contract locally

Design boundaries:

- browser-first, but usable from modern Node.js
- async-only APIs
- explicit transaction building, signing, and broadcast modes
- injected wallets register into `window.xian` and `window.xianProviders`
- browser wallet product code stays outside this repo
- no Python-style local projection helpers in the browser-focused core
