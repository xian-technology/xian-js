import { describe, expect, it } from "vitest";
import {
  fixedText,
  fixedUnits,
  minimumAmountOutV2,
  selectBestXianDexV2ExactInRoute,
  planXianDexV2ExactInExecution,
  deadlineFromNow,
} from "../src/index";

describe("v2 exact-input routing", () => {
  const pairs = [
    {
      id: 1,
      token0: "a",
      token1: "b",
      reserve0: "3",
      reserve1: "6",
      precision0: 2,
      precision1: 2,
    },
    {
      id: 2,
      token0: "b",
      token1: "c",
      reserve0: "5",
      reserve1: "10",
      precision0: 2,
      precision1: 1,
    },
  ];
  it("truncates source and each hop at token precision", () => {
    const quote = selectBestXianDexV2ExactInRoute({
      pairs,
      fromToken: "a",
      toToken: "c",
      amountIn: "1.239",
      feeBps: 0,
    })!;
    expect(quote.amountIn).toBe("1.23");
    expect(quote.hops.map((h) => h.amountOut)).toEqual(["1.74", "2.5"]);
    const plan = planXianDexV2ExactInExecution({
      quote,
      recipient: "alice",
      slippageBps: 100,
      allowance: "1.229999999999999999999999999999",
      deadline: deadlineFromNow(5),
    });
    expect(plan.amountOutMin).toBe("2.4");
    expect(plan.approval?.kwargs.amount).toEqual({ __fixed__: "1.23" });
    expect(plan.call.kwargs).toMatchObject({
      amountIn: { __fixed__: "1.23" },
      amountOutMin: { __fixed__: "2.4" },
      path: [1, 2],
    });
  });
  it("uses every input digit in slippage and wide integer comparisons", () => {
    expect(fixedText(fixedUnits("9007199254740993.1"))).toBe(
      "9007199254740993.1",
    );
    expect(minimumAmountOutV2("9007199254740993.1", 1)).toBe(
      "9006298534815519.00069",
    );
    const candidate = (id: number, reserve: string) => ({
      id,
      token0: "a",
      token1: "b",
      reserve0: "1",
      reserve1: reserve,
    });
    const quote = selectBestXianDexV2ExactInRoute({
      pairs: [
        candidate(1, "1"),
        candidate(2, "1.000000000000000000000000000002"),
      ],
      fromToken: "a",
      toToken: "b",
      amountIn: "1",
      feeBps: 0,
    });
    expect(quote?.path).toEqual([2]);
    expect(quote?.amountOut).toBe("0.500000000000000000000000000001");
  });
});
