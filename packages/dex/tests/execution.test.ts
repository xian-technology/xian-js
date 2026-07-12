import { describe, expect, it } from "vitest";

import {
  deadlineFromNow,
  minimumAmountOut,
  planExactInExecution,
  planExactInSwap,
  planXianDexV1ExactInExecution,
  planXianDexV1ExactInSwap,
  selectBestXianDexV1ExactInRoute,
  type ExactInExecutionAdapter,
  type XianDexV1Pair,
} from "../src/index";

const pairs: XianDexV1Pair[] = [
  { id: 1, token0: "a", token1: "b", reserve0: 1_000, reserve1: 1_000 },
  { id: 2, token0: "b", token1: "c", reserve0: 1_000, reserve1: 2_000 },
];

const quote = selectBestXianDexV1ExactInRoute({
  pairs,
  fromToken: "a",
  toToken: "c",
  amountIn: 100,
  feeBps: 30,
});

if (!quote) throw new Error("test quote missing");

describe("canonical Xian DEX v1 adapter", () => {
  it("applies slippage and builds an explicit v1 router call", () => {
    const deadline = deadlineFromNow(15, new Date("2026-07-12T10:00:00.123Z"));
    expect(deadline).toEqual({ __time__: [2026, 7, 12, 10, 15, 0, 123_000] });
    expect(minimumAmountOut(100, 50)).toBe(99.5);

    const plan = planXianDexV1ExactInSwap({
      quote,
      recipient: "agent",
      slippageBps: 50,
      deadline,
      routerContract: "con_alternative_dex",
    });
    expect(plan.call).toEqual({
      contract: "con_alternative_dex",
      function: "swapExactTokensForTokens",
      kwargs: {
        amountIn: { __fixed__: "100" },
        amountOutMin: { __fixed__: String(quote.amountOut * 0.995) },
        path: [1, 2],
        src: "a",
        to: "agent",
        deadline,
      },
    });
  });

  it("returns approval and swap calls in submission order", () => {
    const plan = planXianDexV1ExactInExecution({
      quote,
      recipient: "agent",
      allowance: 25,
      approvalAmount: 1_000,
      slippageBps: 100,
      deadline: deadlineFromNow(10, 0),
      feeOnTransferTokens: ["c"],
    });

    expect(plan.approval).toEqual({
      contract: "a",
      function: "approve",
      kwargs: { amount: { __fixed__: "1000" }, to: "con_dex" },
    });
    expect(plan.calls.map((call) => call.function)).toEqual([
      "approve",
      "swapExactTokensForTokensSupportingFeeOnTransferTokens",
    ]);
    expect(plan.supportingFeeOnTransfer).toBe(true);
  });

  it("rejects fee-on-transfer intermediate tokens", () => {
    expect(() =>
      planXianDexV1ExactInSwap({
        quote,
        recipient: "agent",
        slippageBps: 50,
        deadline: deadlineFromNow(10, 0),
        feeOnTransferTokens: ["b"],
      }),
    ).toThrow(/intermediate route token/);
  });
});

describe("protocol-neutral execution planning", () => {
  interface CustomQuote {
    input: number;
    output: number;
    source: string;
  }

  interface CustomOptions {
    router: string;
  }

  const adapter: ExactInExecutionAdapter<CustomQuote, CustomOptions, { abi: "custom" }> = {
    amountIn: (item) => item.input,
    amountOut: (item) => item.output,
    sourceToken: (item) => item.source,
    approvalSpender: (options) => options.router,
    buildApprovalCall: ({ token, spender, amount }) => ({
      contract: token,
      function: "authorize",
      kwargs: { delegate: spender, quantity: amount },
    }),
    buildSwapCall: ({ quote: item, recipient, amountOutMin, options }) => ({
      call: {
        contract: options.router,
        function: "trade",
        kwargs: { input: item.input, minimum: amountOutMin, beneficiary: recipient },
      },
      metadata: { abi: "custom" },
    }),
  };

  it("builds calls for an unrelated router ABI without canonical contract assumptions", () => {
    const request = {
      quote: { input: 10, output: 25, source: "token_a" },
      recipient: "agent",
      slippageBps: 100,
      deadline: deadlineFromNow(5, 0),
      adapter,
      options: { router: "con_other_dex" },
    };
    const swap = planExactInSwap(request);
    expect(swap.call).toEqual({
      contract: "con_other_dex",
      function: "trade",
      kwargs: { input: 10, minimum: 24.75, beneficiary: "agent" },
    });
    expect(swap.adapterMetadata).toEqual({ abi: "custom" });

    const execution = planExactInExecution({
      ...request,
      allowance: 0,
      approvalAmount: 10,
    });
    expect(execution.calls).toEqual([
      {
        contract: "token_a",
        function: "authorize",
        kwargs: { delegate: "con_other_dex", quantity: 10 },
      },
      swap.call,
    ]);
  });
});
