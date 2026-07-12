#!/usr/bin/env node

import { Ed25519Signer, XianClient } from "../packages/client/dist/index.js";
import {
  deadlineFromNow,
  planXianDexV1ExactInExecution,
  selectBestXianDexV1ExactInRoute,
} from "../packages/dex/dist/index.js";

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function finiteNumber(value, label) {
  const parsed = typeof value === "bigint" ? Number(value) : Number(value ?? 0);
  if (!Number.isFinite(parsed)) throw new Error(`${label} is not numeric`);
  return parsed;
}

async function main() {
  const rpcUrl = process.env.XIAN_NODE_URL?.trim() || "http://127.0.0.1:26657";
  const router = process.env.XIAN_DEX_ROUTER?.trim() || "con_dex";
  const pairsContract = process.env.XIAN_DEX_PAIRS?.trim() || "con_pairs";
  const tokenIn = process.env.XIAN_DEX_TOKEN_IN?.trim() || "currency";
  const tokenOut = process.env.XIAN_DEX_TOKEN_OUT?.trim() || "con_dex_demo_token";
  const pairId = Number(process.env.XIAN_DEX_PAIR_ID || "1");
  const amountIn = Number(process.env.XIAN_DEX_AMOUNT_IN || "0.01");
  const privateKey = requiredEnv("XIAN_PRIVATE_KEY");
  if (!Number.isInteger(pairId) || pairId <= 0) throw new Error("pair id must be positive");
  if (!Number.isFinite(amountIn) || amountIn <= 0) throw new Error("amount must be positive");

  const signer = new Ed25519Signer(privateKey);
  const client = new XianClient({ rpcUrl });
  const [token0, token1, reserve0, reserve1, allowanceValue, feeValue] =
    await Promise.all([
      client.getState(pairsContract, "pairs", [String(pairId), "token0"]),
      client.getState(pairsContract, "pairs", [String(pairId), "token1"]),
      client.getState(pairsContract, "pairs", [String(pairId), "reserve0"]),
      client.getState(pairsContract, "pairs", [String(pairId), "reserve1"]),
      client.token(tokenIn).allowance(signer.address, router),
      client.contract(router).call("getTradeFeeBps", { account: signer.address }, signer.address),
    ]);

  const pair = {
    id: pairId,
    token0: String(token0),
    token1: String(token1),
    reserve0: finiteNumber(reserve0, "reserve0"),
    reserve1: finiteNumber(reserve1, "reserve1"),
  };
  const feeBps = finiteNumber(feeValue, "feeBps");
  const quote = selectBestXianDexV1ExactInRoute({
    pairs: [pair],
    fromToken: tokenIn,
    toToken: tokenOut,
    amountIn,
    feeBps,
    maxHops: 1,
  });
  if (!quote) throw new Error("canonical Xian DEX v1 adapter found no route");

  const plan = planXianDexV1ExactInExecution({
    quote,
    recipient: signer.address,
    allowance: finiteNumber(allowanceValue, "allowance"),
    approvalAmount: amountIn,
    slippageBps: 100,
    deadline: deadlineFromNow(5),
    routerContract: router,
  });

  const transactions = [];
  for (const call of plan.calls) {
    const submission = await client.contract(call.contract).send(call.function, call.kwargs, {
      signer,
      mode: "checktx",
      waitForTx: true,
      timeoutMs: 60_000,
      pollIntervalMs: 250,
    });
    if (submission.accepted === false || !submission.finalized || submission.receipt?.success === false) {
      throw new Error(
        `${call.contract}.${call.function} failed: ${String(submission.message ?? "not finalized")}`,
      );
    }
    transactions.push({
      contract: call.contract,
      function: call.function,
      txHash: submission.txHash,
      finalized: submission.finalized,
      receiptSuccess: submission.receipt?.success ?? null,
    });
  }

  process.stdout.write(
    `${JSON.stringify(
      {
        adapter: "xian-dex-v1",
        rpcUrl,
        pair,
        feeBps,
        quote: {
          amountIn: quote.amountIn,
          amountOut: quote.amountOut,
          amountOutMin: plan.amountOutMin,
          path: quote.path,
        },
        calls: plan.calls,
        transactions,
        finalTransaction: transactions.at(-1),
      },
      null,
      2,
    )}\n`,
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
});
