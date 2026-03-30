# @xian-tech/client

This package owns the typed Xian client surface for JS / TS consumers.

It includes:

- HTTP and ABCI query helpers
- transaction payload building, signing, and broadcast helpers
- Ed25519 signing primitives for tests and local development
- websocket subscriptions for dashboard state and event streams

It does not own:

- browser wallet discovery
- wallet-provider event contracts
- framework-specific bindings
