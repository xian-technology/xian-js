# `@xian-tech/dex`

Routing and transaction-planning primitives for DEX clients,
agents, and browser applications. The package performs no RPC reads, key
handling, simulation, signing, or submission.

The package provides

- protocol-neutral route enumeration driven by caller-supplied pool and quote
  adapters;
- reusable constant-product pricing with numeric or string pool IDs and
  optional per-pool fees;
- an explicit canonical Xian DEX v1 adapter for `con_pairs` / `con_dex` call
  shapes and fee-on-transfer behavior;
- an exact adapter for fresh chains using the V2 numeric profile.

## Exact amounts on V2

Pass token amounts, pool reserves and allowances as decimal strings. Read
`precision0` and `precision1` from each token's `metadata["precision"]`.
Absent precision uses all 30 decimal places. The planner floors the input
and every hop output to the corresponding token precision. Its approval and
swap calls contain canonical `__fixed__` values.

```ts
const quote = selectBestXianDexV2ExactInRoute({
  pairs: [{ id: 1, token0: "currency", token1: "con_token",
    reserve0: "100.25", reserve1: "201.5", precision0: 8, precision1: 6 }],
  fromToken: "currency", toToken: "con_token", amountIn: "0.01"
});
if (quote) {
  const plan = planXianDexV2ExactInExecution({
    quote, recipient, allowance: "0", slippageBps: 50,
    deadline: deadlineFromNow(5)
  });
  for (const call of plan.calls) await submitCall(call);
}
```

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
- V1 and generic quote adapters use JavaScript numbers. The V2 adapter uses
  integer arithmetic at the VM’s fixed-point scale.
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
V2 adapter, submits any required approval plus the exact planned router call,
and requires finalized successful receipts.
