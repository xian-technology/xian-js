import { describe, expect, it } from "vitest";

import {
  amountOutForExactIn,
  enumerateConstantProductExactInRoutes,
  enumerateExactInRoutes,
  selectBestConstantProductExactInRoute,
  selectBestExactInRoute,
  type ConstantProductPool,
  type ExactInRoutingAdapter,
} from "../src/index";

const pools: ConstantProductPool<number>[] = [
  { id: 1, token0: "a", token1: "b", reserve0: 1_000, reserve1: 1_000 },
  { id: 2, token0: "b", token1: "c", reserve0: 1_000, reserve1: 2_000 },
  { id: 3, token0: "a", token1: "c", reserve0: 1_000, reserve1: 1_500 },
];

describe("constant-product route quoting", () => {
  it("enumerates routes best-first and chooses the highest output", () => {
    const routes = enumerateConstantProductExactInRoutes({
      pools,
      fromToken: "a",
      toToken: "c",
      amountIn: 100,
      defaultFeeBps: 30,
      maxHops: 3,
    });

    expect(routes.map((route) => route.path)).toEqual([[1, 2], [3]]);
    expect(routes[0]?.amountOut).toBeCloseTo(
      amountOutForExactIn(
        amountOutForExactIn(100, 1_000, 1_000, 30),
        1_000,
        2_000,
        30,
      ),
    );
    expect(
      selectBestConstantProductExactInRoute({
        pools,
        fromToken: "a",
        toToken: "c",
        amountIn: 100,
        defaultFeeBps: 30,
      })?.path,
    ).toEqual([1, 2]);
    expect(routes[0]?.priceImpact).toBeGreaterThan(0);
    expect(routes[0]?.hops[0]?.metadata.feeBps).toBe(30);
  });

  it("supports pool-specific fees and string pool ids", () => {
    const stringPools: ConstantProductPool<string>[] = [
      {
        id: "expensive",
        token0: "a",
        token1: "b",
        reserve0: 1_000,
        reserve1: 1_000,
        feeBps: 100,
      },
      {
        id: "cheap",
        token0: "a",
        token1: "b",
        reserve0: 1_000,
        reserve1: 1_000,
        feeBps: 5,
      },
    ];
    const quote = selectBestConstantProductExactInRoute({
      pools: stringPools,
      fromToken: "a",
      toToken: "b",
      amountIn: 10,
    });
    expect(quote?.path).toEqual(["cheap"]);
    expect(quote?.hops[0]?.metadata.feeBps).toBe(5);
  });

  it("is deterministic across pool input ordering and stable output ties", () => {
    const tiedPools: ConstantProductPool<number>[] = [
      { id: 8, token0: "a", token1: "c", reserve0: 1_000, reserve1: 1_000 },
      { id: 2, token0: "a", token1: "c", reserve0: 1_000, reserve1: 1_000 },
    ];
    const request = {
      fromToken: "a",
      toToken: "c",
      amountIn: 10,
      defaultFeeBps: 0,
      maxHops: 3,
    } as const;

    expect(
      enumerateConstantProductExactInRoutes({ ...request, pools: tiedPools }),
    ).toEqual(
      enumerateConstantProductExactInRoutes({
        ...request,
        pools: [...tiedPools].reverse(),
      }),
    );
    expect(
      enumerateConstantProductExactInRoutes({ ...request, pools: tiedPools }).map(
        (route) => route.path,
      ),
    ).toEqual([[2], [8]]);
  });
});

describe("protocol-neutral routing", () => {
  interface WeightedPool {
    key: string;
    assets: readonly [string, string];
    outputMultiplier: number;
  }

  const adapter: ExactInRoutingAdapter<WeightedPool, string, { model: "weighted" }> = {
    poolId: (pool) => pool.key,
    tokens: (pool) => pool.assets,
    quoteExactIn: ({ pool, amountIn }) => ({
      amountOut: amountIn * pool.outputMultiplier,
      midPriceOut: pool.outputMultiplier,
      metadata: { model: "weighted" },
    }),
  };

  it("routes arbitrary pool records using caller-owned quote semantics", () => {
    const weightedPools: WeightedPool[] = [
      { key: "direct", assets: ["a", "c"], outputMultiplier: 1.5 },
      { key: "hop-a", assets: ["a", "b"], outputMultiplier: 1.1 },
      { key: "hop-b", assets: ["b", "c"], outputMultiplier: 1.6 },
    ];
    const quote = selectBestExactInRoute({
      pools: weightedPools,
      adapter,
      fromToken: "a",
      toToken: "c",
      amountIn: 10,
    });
    expect(quote?.path).toEqual(["hop-a", "hop-b"]);
    expect(quote?.amountOut).toBeCloseTo(17.6);
    expect(quote?.hops[0]?.metadata.model).toBe("weighted");
  });

  it("honors custom pool id ordering for deterministic ties", () => {
    const descendingAdapter: ExactInRoutingAdapter<WeightedPool, string, null> = {
      poolId: (pool) => pool.key,
      tokens: (pool) => pool.assets,
      comparePoolIds: (left, right) => right.localeCompare(left),
      quoteExactIn: ({ amountIn }) => ({
        amountOut: amountIn,
        midPriceOut: 1,
        metadata: null,
      }),
    };
    const routes = enumerateExactInRoutes({
      pools: [
        { key: "a", assets: ["x", "y"], outputMultiplier: 1 },
        { key: "z", assets: ["x", "y"], outputMultiplier: 1 },
      ],
      adapter: descendingAdapter,
      fromToken: "x",
      toToken: "y",
      amountIn: 1,
    });
    expect(routes.map((route) => route.path)).toEqual([["z"], ["a"]]);
  });
});
