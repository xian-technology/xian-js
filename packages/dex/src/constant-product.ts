import {
  enumerateExactInRoutes,
  selectBestExactInRoute,
  type ExactInQuote,
  type ExactInRoutingAdapter,
  type PoolId,
} from "./routing.js";

export const DEFAULT_CONSTANT_PRODUCT_FEE_BPS = 30;

export interface ConstantProductPool<Id extends PoolId = PoolId> {
  id: Id;
  token0: string;
  token1: string;
  reserve0: number;
  reserve1: number;
  /** Optional pool-specific fee; otherwise the adapter default is used. */
  feeBps?: number;
}

export interface ConstantProductHopMetadata {
  reserveIn: number;
  reserveOut: number;
  feeBps: number;
}

export type ConstantProductExactInQuote<Id extends PoolId = PoolId> = ExactInQuote<
  Id,
  ConstantProductHopMetadata
>;

export interface ConstantProductQuoteRequest<Id extends PoolId> {
  pools: readonly ConstantProductPool<Id>[];
  fromToken: string;
  toToken: string;
  amountIn: number;
  defaultFeeBps?: number;
  maxHops?: number;
}

function assertBps(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 0 || value > 10_000) {
    throw new RangeError(`${label} must be an integer from 0 to 10000`);
  }
}

export function amountOutForExactIn(
  amountIn: number,
  reserveIn: number,
  reserveOut: number,
  feeBps = DEFAULT_CONSTANT_PRODUCT_FEE_BPS,
): number {
  assertBps(feeBps, "feeBps");
  if (
    !Number.isFinite(amountIn) ||
    !Number.isFinite(reserveIn) ||
    !Number.isFinite(reserveOut) ||
    amountIn <= 0 ||
    reserveIn <= 0 ||
    reserveOut <= 0
  ) {
    return 0;
  }
  const amountInWithFee = amountIn * ((10_000 - feeBps) / 10_000);
  return (amountInWithFee * reserveOut) / (reserveIn + amountInWithFee);
}

export function createConstantProductAdapter<Id extends PoolId>(
  defaultFeeBps = DEFAULT_CONSTANT_PRODUCT_FEE_BPS,
): ExactInRoutingAdapter<
  ConstantProductPool<Id>,
  Id,
  ConstantProductHopMetadata
> {
  assertBps(defaultFeeBps, "defaultFeeBps");
  return {
    poolId: (pool) => pool.id,
    tokens: (pool) => [pool.token0, pool.token1],
    quoteExactIn: ({ pool, fromToken, toToken, amountIn }) => {
      const forward = fromToken === pool.token0 && toToken === pool.token1;
      const reverse = fromToken === pool.token1 && toToken === pool.token0;
      if (!forward && !reverse) return null;
      const reserveIn = forward ? pool.reserve0 : pool.reserve1;
      const reserveOut = forward ? pool.reserve1 : pool.reserve0;
      const feeBps = pool.feeBps ?? defaultFeeBps;
      const amountOut = amountOutForExactIn(amountIn, reserveIn, reserveOut, feeBps);
      if (amountOut <= 0) return null;
      return {
        amountOut,
        midPriceOut: reserveOut / reserveIn,
        metadata: { reserveIn, reserveOut, feeBps },
      };
    },
  };
}

export function enumerateConstantProductExactInRoutes<Id extends PoolId>(
  request: ConstantProductQuoteRequest<Id>,
): ConstantProductExactInQuote<Id>[] {
  return enumerateExactInRoutes({
    pools: request.pools,
    adapter: createConstantProductAdapter(request.defaultFeeBps),
    fromToken: request.fromToken,
    toToken: request.toToken,
    amountIn: request.amountIn,
    maxHops: request.maxHops,
  });
}

export function selectBestConstantProductExactInRoute<Id extends PoolId>(
  request: ConstantProductQuoteRequest<Id>,
): ConstantProductExactInQuote<Id> | null {
  return selectBestExactInRoute({
    pools: request.pools,
    adapter: createConstantProductAdapter(request.defaultFeeBps),
    fromToken: request.fromToken,
    toToken: request.toToken,
    amountIn: request.amountIn,
    maxHops: request.maxHops,
  });
}
