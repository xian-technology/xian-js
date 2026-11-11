import { fixed } from "@xian-tech/types";
import type { ContractCallPlan, XianDatetime } from "../execution.js";
import { enumeratePoolPaths } from "../routing.js";
import {
  DEFAULT_XIAN_DEX_V1_CONTRACTS,
  DEFAULT_XIAN_DEX_V1_TRADE_FEE_BPS,
  type XianDexV1ExecutionOptions,
} from "./xian-v1.js";

const SCALE = 10n ** 30n;
const LIMIT = 10n ** 91n;

export function fixedUnits(value: string): bigint {
  const [whole, fraction = ""] = fixed(value).__fixed__.split(".");
  return BigInt(whole + fraction.padEnd(30, "0"));
}

function formatUnits(units: bigint): string {
  const sign = units < 0n ? "-" : "";
  const digits = (units < 0n ? -units : units).toString().padStart(31, "0");
  const fraction = digits.slice(-30).replace(/0+$/, "");
  return sign + digits.slice(0, -30) + (fraction ? "." + fraction : "");
}

export function fixedText(units: bigint): string {
  if (typeof units !== "bigint" || units >= LIMIT || units <= -LIMIT)
    throw new RangeError("decimal exceeds supported range");
  return formatUnits(units);
}

function precisionOf(precision?: number | null): number {
  if (precision == null) return 30;
  if (!Number.isSafeInteger(precision) || precision < 0)
    throw new RangeError("invalid token precision");
  return Math.min(precision, 30);
}

function floorUnits(units: bigint, precision: number): bigint {
  const step = 10n ** BigInt(30 - precisionOf(precision));
  return (units / step) * step;
}

export function minimumAmountOutV2(
  amountOut: string,
  slippageBps: number,
  precision = 30,
): string {
  if (
    !Number.isInteger(slippageBps) ||
    slippageBps < 0 ||
    slippageBps > 10_000
  ) {
    throw new RangeError("slippageBps must be an integer from 0 to 10000");
  }
  const amount = fixedUnits(amountOut);
  if (amount < 0n) throw new RangeError("amountOut must be non-negative");
  return fixedText(
    floorUnits((amount * BigInt(10_000 - slippageBps)) / 10_000n, precision),
  );
}

export interface XianDexV2Pair {
  id: number;
  token0: string;
  token1: string;
  reserve0: string;
  reserve1: string;
  precision0?: number | null;
  precision1?: number | null;
}

export interface XianDexV2QuoteRequest {
  pairs: readonly XianDexV2Pair[];
  fromToken: string;
  toToken: string;
  amountIn: string;
  feeBps?: number;
  maxHops?: number;
}

export interface XianDexV2ExactInQuoteHop {
  pairId: number;
  fromToken: string;
  toToken: string;
  reserveIn: string;
  reserveOut: string;
  amountIn: string;
  amountOut: string;
}

export interface XianDexV2ExactInQuote {
  path: number[];
  hops: XianDexV2ExactInQuoteHop[];
  amountIn: string;
  amountOut: string;
  outputPrecision: number;
  feeBps: number;
  priceImpact: string;
  midPriceOut: string;
}

export function enumerateXianDexV2ExactInRoutes(
  request: XianDexV2QuoteRequest,
): XianDexV2ExactInQuote[] {
  const input = fixedUnits(request.amountIn);
  if (input <= 0n) throw new RangeError("amountIn must be positive");
  const fee = request.feeBps ?? DEFAULT_XIAN_DEX_V1_TRADE_FEE_BPS;
  if (fee !== 0 && fee !== DEFAULT_XIAN_DEX_V1_TRADE_FEE_BPS)
    throw new RangeError("unsupported router fee");
  const candidates = enumeratePoolPaths(
    request.pairs,
    {
      poolId: (pair) => pair.id,
      tokens: (pair) => [pair.token0, pair.token1],
    },
    request.fromToken,
    request.toToken,
    request.maxHops,
  );
  const quotes: { out: bigint; quote: XianDexV2ExactInQuote }[] = [];
  for (const candidate of candidates) {
    const hops: XianDexV2ExactInQuoteHop[] = [];
    let amount = input;
    let source = request.fromToken;
    let spotNumerator = 1n;
    let spotDenominator = 1n;
    let outputPrecision = 30;
    for (const { pool, other } of candidate.edges) {
      const forward = pool.token0 === source;
      const reserveIn = fixedUnits(forward ? pool.reserve0 : pool.reserve1);
      const reserveOut = fixedUnits(forward ? pool.reserve1 : pool.reserve0);
      if (!hops.length)
        amount = floorUnits(
          amount,
          precisionOf(forward ? pool.precision0 : pool.precision1),
        );
      outputPrecision = precisionOf(
        forward ? pool.precision1 : pool.precision0,
      );
      if (amount <= 0n || reserveIn <= 0n || reserveOut <= 0n) break;
      // Match the contract's two fixed-point multiplications, then its division.
      const withFee = (amount * BigInt(10_000 - fee)) / 10_000n;
      const numerator = (withFee * reserveOut) / SCALE;
      const denominator = reserveIn + withFee;
      if (numerator >= LIMIT || denominator >= LIMIT) break;
      const out = floorUnits(
        (numerator * SCALE) / denominator,
        outputPrecision,
      );
      if (out <= 0n) break;
      hops.push({
        pairId: pool.id,
        fromToken: source,
        toToken: other,
        reserveIn: fixedText(reserveIn),
        reserveOut: fixedText(reserveOut),
        amountIn: fixedText(amount),
        amountOut: fixedText(out),
      });
      spotNumerator *= reserveOut;
      spotDenominator *= reserveIn;
      amount = out;
      source = other;
    }
    if (source !== request.toToken || !hops.length) continue;
    const amountIn = hops[0]!.amountIn;
    const expectedNumerator = fixedUnits(amountIn) * spotNumerator;
    const loss =
      ((expectedNumerator - amount * spotDenominator) * SCALE) /
      expectedNumerator;
    quotes.push({
      out: amount,
      quote: {
        amountIn,
        amountOut: fixedText(amount),
        path: candidate.poolIds,
        hops,
        outputPrecision,
        feeBps: fee,
        midPriceOut: formatUnits((spotNumerator * SCALE) / spotDenominator),
        priceImpact: fixedText(loss < 0n ? 0n : loss),
      },
    });
  }
  // enumeratePoolPaths already breaks ties by path length and ordered pool IDs.
  return quotes
    .sort((a, b) => (a.out < b.out ? 1 : a.out > b.out ? -1 : 0))
    .map(({ quote }) => quote);
}

export function selectBestXianDexV2ExactInRoute(
  request: XianDexV2QuoteRequest,
): XianDexV2ExactInQuote | null {
  return enumerateXianDexV2ExactInRoutes(request)[0] ?? null;
}

export interface XianDexV2SwapPlanRequest extends XianDexV1ExecutionOptions {
  quote: XianDexV2ExactInQuote;
  recipient: string;
  slippageBps: number;
  deadline: XianDatetime;
}

export function planXianDexV2TokenApproval(request: {
  token: string;
  spender?: string;
  amount: string;
}): ContractCallPlan {
  const spender = request.spender ?? DEFAULT_XIAN_DEX_V1_CONTRACTS.router;
  if (
    !request.token.trim() ||
    !spender.trim() ||
    fixedUnits(request.amount) <= 0n
  )
    throw new RangeError("invalid token approval");
  return {
    contract: request.token,
    function: "approve",
    kwargs: { amount: fixed(request.amount), to: spender },
  };
}

export function planXianDexV2ExactInSwap(request: XianDexV2SwapPlanRequest) {
  const { quote } = request;
  const first = quote.hops[0],
    last = quote.hops.at(-1);
  const router = request.routerContract ?? DEFAULT_XIAN_DEX_V1_CONTRACTS.router;
  if (
    !first ||
    !last ||
    !request.recipient.trim() ||
    !router.trim() ||
    quote.path.length !== quote.hops.length ||
    fixedUnits(quote.amountIn) <= 0n
  )
    throw new RangeError("invalid swap request");
  const feeTokens = new Set(request.feeOnTransferTokens);
  if (quote.hops.slice(0, -1).some((h) => feeTokens.has(h.toToken)))
    throw new RangeError("fee-on-transfer intermediate token");
  const supportingFeeOnTransfer =
    !!request.supportingFeeOnTransfer ||
    feeTokens.has(first.fromToken) ||
    feeTokens.has(last.toToken);
  const amountOutMin = minimumAmountOutV2(
    quote.amountOut,
    request.slippageBps,
    quote.outputPrecision,
  );
  const call: ContractCallPlan = {
    contract: router,
    function: supportingFeeOnTransfer
      ? "swapExactTokensForTokensSupportingFeeOnTransferTokens"
      : "swapExactTokensForTokens",
    kwargs: {
      amountIn: fixed(quote.amountIn),
      amountOutMin: fixed(amountOutMin),
      path: [...quote.path],
      src: first.fromToken,
      to: request.recipient,
      deadline: request.deadline,
    },
  };
  return { call, amountOutMin, supportingFeeOnTransfer };
}

export function planXianDexV2ExactInExecution(
  request: XianDexV2SwapPlanRequest & {
    allowance: string;
    approvalAmount?: string;
  },
) {
  const plan = planXianDexV2ExactInSwap(request);
  const amount = fixedUnits(request.quote.amountIn);
  const allowance = fixedUnits(request.allowance);
  if (allowance < 0n) throw new RangeError("allowance must be non-negative");
  const approvalAmount = request.approvalAmount ?? request.quote.amountIn;
  if (allowance < amount && fixedUnits(approvalAmount) < amount)
    throw new RangeError("approvalAmount must cover input amount");
  const approval =
    allowance < amount
      ? planXianDexV2TokenApproval({
          token: request.quote.hops[0]!.fromToken,
          spender: plan.call.contract,
          amount: approvalAmount,
        })
      : null;
  return {
    ...plan,
    approval,
    calls: approval ? [approval, plan.call] : [plan.call],
  };
}
