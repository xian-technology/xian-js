# Repository Guidelines

## Scope
- `xian-js` is the JS / TS SDK workspace for browser apps, wallets, dapps, and
  Node.js consumers that want official Xian integration packages.
- Keep the repo focused on the public client and provider surface.
- Do not mix backend-operator helpers or Python-specific projection patterns
  into the core browser path.
- Browser wallet product code lives in the sibling `../xian-wallet-browser`
  repo.

## Project Layout
- `packages/client/`: typed Xian RPC client, tx payload helpers, Ed25519 signer,
  and websocket subscriptions.
- `packages/provider/`: provider request / event contract and a simple provider
  implementation for tests and reference integrations.
- `docs/ARCHITECTURE.md`: package ownership and dependency direction.
- `docs/BACKLOG.md`: future work and links to deeper notes.

## Workflow
- Treat `../xian-meta/docs/XIAN_JS_SDK_MVP.md` as the shared cross-repo
  contract until the implementation diverges intentionally.
- When public behavior changes, update `xian-docs-web` and
  `../xian-wallet-browser` alongside this repo where relevant.
- Favor explicit transport and transaction behavior over hidden retries or
  magic wallet state.

## Validation
- Install dependencies with `npm install`.
- Type-check with `npm run typecheck`.
- Build packages with `npm run build`.
- Run tests with `npm run test`.
