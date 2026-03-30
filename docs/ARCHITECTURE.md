# Architecture

`xian-js` owns the official JS / TS integration surface for Xian.

Current packages:

- `@xian/client`: typed network access, tx helpers, signing primitives, and
  websocket subscriptions
- `@xian/provider`: browser wallet provider contract, injected-wallet discovery
  helpers, and a simple reference implementation
- `examples/browser-dapp`: a runnable browser-side integration example that
  exercises the public package surface

Companion repo:

- `../xian-wallet-browser`: browser wallet apps and wallet-domain product code

Dependency direction:

- `@xian/client` must not depend on `@xian/provider`
- `@xian/provider` may depend on `@xian/client` types and helpers
- browser wallet implementations should consume `@xian/provider` rather than
  redefining the injected-provider contract locally

Design boundaries:

- browser-first, but usable from modern Node.js
- async-only APIs
- explicit transaction building, signing, and broadcast modes
- injected wallets register into `window.xian` and `window.xianProviders`
- browser wallet product code stays outside this repo
- no Python-style local projection helpers in the browser-focused core
