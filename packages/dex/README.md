# `@xian-tech/dex`

Dependency-free routing and transaction-planning primitives for DEX clients,
agents, and browser applications. The package performs no RPC reads, key
handling, simulation, signing, or submission.

The public surface has three layers:

- protocol-neutral route enumeration driven by caller-supplied pool and quote
  adapters;
- reusable constant-product pricing with numeric or string pool IDs and
  optional per-pool fees;
- an explicit canonical Xian DEX v1 adapter for `con_pairs` / `con_dex` call
  shapes and fee-on-transfer behavior.

## Canonical Xian DEX v1

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
  feeBps: 30,
  maxHops: 3,
});

if (!quote) throw new Error("No route");

const plan = planXianDexV1ExactInExecution({
  quote,
  recipient: agentAddress,
  allowance,
  approvalAmount: 10,
  slippageBps: 50,
  deadline: deadlineFromNow(15),
  routerContract: "con_dex",
  feeOnTransferTokens: knownFeeOnTransferTokens,
});

for (const call of plan.calls) await submitCall(call);
```

Pass `routerContract` to target another deployment of the same v1 contract
interface. The canonical adapter chooses the supporting fee-on-transfer
entrypoint for flagged source/destination tokens and rejects a flagged
intermediate token.

## Another DEX or Pool Model

Use the routing core with records and quote semantics owned by the integration:

```ts
import { selectBestExactInRoute } from "@xian-tech/dex/routing";

const quote = selectBestExactInRoute({
  pools,
  adapter: {
    poolId: (pool) => pool.address,
    tokens: (pool) => pool.assets,
    quoteExactIn: ({ pool, fromToken, amountIn }) =>
      quoteStablePool(pool, fromToken, amountIn),
  },
  fromToken: "currency",
  toToken: "con_usdc",
  amountIn: 10,
});
```

An execution adapter supplies the approval and swap ABI. The generic planner
then applies slippage and allowance rules without assuming a router contract,
function name, or keyword shape. See `tests/execution.test.ts` for a complete
custom-ABI example.

## Boundaries

- Pool state and quote adapters are caller-owned.
- All built-in quote math currently uses JavaScript numbers. Consumers needing
  arbitrary precision must validate against on-chain simulation before signing.
- The generic router handles simple non-split exact-input routes. DEX-specific
  split routing or concentrated-liquidity traversal belongs in an adapter or a
  future focused module.
- New DEX integrations should add adapters, not duplicate the routing core.

## Validation

From the `xian-js` root:

```bash
npm run typecheck
npm run build
npm run test
```

Against a stack localnet with the canonical demo pool installed:

```bash
XIAN_PRIVATE_KEY="$XIAN_PRIVATE_KEY" npm run test:live:dex
```

The smoke test reads real reserves and signer fees, plans through the Xian DEX
v1 adapter, submits any required approval plus the exact planned router call,
and requires finalized successful receipts.
