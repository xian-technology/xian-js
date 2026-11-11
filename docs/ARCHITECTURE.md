# Architecture

`xian-js` owns the official JS / TS integration surface for Xian.

Current packages:

- `@xian-tech/client`: typed network access, tx helpers, signing primitives, and
  websocket subscriptions
- `@xian-tech/dex`: dependency-free protocol-neutral routing, reusable
  constant-product math, and explicit DEX execution adapters
- `@xian-tech/provider`: browser wallet provider contract, injected-wallet discovery
  helpers, and a simple reference implementation
- `@xian-tech/types`: shared transaction, signer, number, and broadcast-mode
  types and dependency-free runtime primitives consumed by the other packages
- `@xian-tech/web-kit`: shared browser-app helpers for wallet connection, RPC
  client persistence, formatting, toasts, and React integration
- `examples/browser-dapp`: a runnable browser-side integration example that
  exercises the public package surface

Companion repo:

- `../xian-wallet-browser`: browser wallet apps and wallet-domain product code

Dependency direction:

- `@xian-tech/types` has no workspace dependencies
- `@xian-tech/dex` has no workspace dependencies; its routing core accepts
  caller-owned pool/quote semantics, while named adapters isolate individual
  contract ABIs. Callers own RPC, simulation, signing, and submission.
- `@xian-tech/client` must not depend on `@xian-tech/provider`
- `@xian-tech/provider` may depend on `@xian-tech/client` types and helpers
- `@xian-tech/web-kit` builds on `@xian-tech/client` and `@xian-tech/provider`
- browser wallet implementations should consume `@xian-tech/provider` rather than
  redefining the injected-provider contract locally

Design boundaries:

- browser-first, but usable from modern Node.js
- async-only APIs
- explicit transaction building, signing, and broadcast modes
- injected wallets register into `window.xian` and `window.xianProviders`
- browser wallet product code stays outside this repo
- protocol planners return explicit call descriptions and never submit them
- DEX-specific contract names and function ABIs stay in named adapters rather
  than the routing or pricing core
- no Python-style local projection helpers in the browser-focused core

Automatic nonce coordination lives in `@xian-tech/types/internal/nonce-reservation`
so both client and provider use one reservation and submission lifecycle without
adding a dependency between them. Managers are owned by each client/provider
instance and serialize automatic sends within a chain/sender scope. Package
adapters supply the existing public error classes. Explicit client nonces bypass
coordination.

A preparation failure releases its reservation; a definite rejection re-reads the
network nonce; admission or finalization consumes the nonce. An ambiguous
broadcast or an acknowledgement without admission evidence quarantines the scope
until the network advances or the caller explicitly resets reconciled local
state. Preparation observers finish before broadcast begins.

The internal runtime entry ships in the types tarball. New client/provider builds
must be released with the matching types package in the next coordinated SDK
release; they cannot use the previously published types package merely because a
development checkout retains its version. `npm run test:package` installs freshly
packed types, client, and provider into a temporary project outside this workspace
and exercises public automatic sends. It requires built packages and uses npm's
local cache populated by dependency installation. `npm run validate` includes this
check after build and behavior tests.
