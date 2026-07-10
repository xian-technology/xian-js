# @xian-tech/provider

This package defines the browser wallet provider surface for Xian and ships a
simple in-memory provider plus injected-wallet discovery helpers.

It includes:

- `request(...)`-based provider interface
- account and chain event handling
- a reference provider that delegates signing and submission to `@xian-tech/client`
- browser injection and discovery helpers for `window.xian` and
  `window.xianProviders`
- a dapp-facing wrapper around an injected provider

Core helpers:

- `registerInjectedXianProvider(...)`: wallet-side registration into the global
  browser namespace
- `listInjectedXianProviders(...)`: enumerate known injected wallets
- `getInjectedXianProvider(...)`: resolve the default or matching injected
  wallet
- `waitForInjectedXianProvider(...)`: await late wallet injection via the
  `xian#initialized` event
- `InjectedXianWallet`: dapp-facing convenience wrapper for connect, chain,
  wallet info, asset watching, transaction preparation, sign, and send flows
- `ProviderBackedXianSigner`: adapter that lets provider-backed wallets fit
  transaction-signing APIs by delegating canonical payloads through
  `xian_signTransaction`

Current provider request methods include:

- `xian_getWalletInfo`
- `xian_requestAccounts`
- `xian_accounts`
- `xian_chainId`
- `xian_switchChain`
- `xian_watchAsset`
- `xian_prepareTransaction`
- `xian_signMessage`
- `xian_signTransaction`
- `xian_sendTransaction`
- `xian_sendCall`

`xian_signMessage` signs the version-1 Xian external-message envelope bound to
the active chain and account. It returns the usual 128-character hex signature,
but it never exposes raw provider signing. Verify it with
`verifyXianMessage(...)` from `@xian-tech/client`.

It does not own:

- framework bindings
- production wallet custody flows

The reference provider coordinates automatic nonces for concurrent
`xian_sendCall` requests per provider instance, active chain, and signer. Each
same-scope build/sign/broadcast lifecycle is serialized so CheckTx sees the
contiguous nonce order; different chains remain independent.
Prebuilt `xian_sendTransaction` payloads bypass that manager. Ambiguous
broadcast failures block further automatic calls until the network nonce
advances; a wallet owner can explicitly call `resetNonceReservation()` only
after independently reconciling the transaction outcome.

```mermaid
flowchart LR
  Wallet["Wallet implementation"] --> Register["registerInjectedXianProvider"]
  Register --> Namespace["window.xian and window.xianProviders"]
  Dapp["Dapp"] --> Discovery["InjectedXianWallet discovery"]
  Discovery --> Namespace
  Dapp --> Request["provider.request"]
  Request --> Wallet
  Wallet --> Client["@xian-tech/client"]
```
