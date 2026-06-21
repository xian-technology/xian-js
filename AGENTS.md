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

## Shared Agent Practices
- Keep changes clean, modular, and professional. Prefer small, cohesive modules, clear naming, explicit boundaries, and tests over quick patches.
- When code behavior, public APIs, user workflows, operator workflows, or configuration semantics change, check whether `../xian-docs-web` needs corresponding documentation updates. If this repo is `xian-docs-web`, update the relevant published docs in place. Write durable user/developer documentation, not a changelog entry.
- For any non-trivial code change, update the local graph before final verification when `graphify-out/graph.json` exists. Run `graphify update .` from the repo root, or `graphify update . --force` when deletions or refactors intentionally shrink the graph.
- After updating the graph, check cross-repo impact before finishing: query the local `graphify-out/graph.json`, inspect paths with `graphify path` or `graphify explain`, and note any affected sibling repos.
- If graphify or dependency analysis shows affected sibling repos, update those repos in the same change when the impact is real and the fix is in scope.
- Treat `graphify-out/` as a generated local artifact. Do not commit it.
