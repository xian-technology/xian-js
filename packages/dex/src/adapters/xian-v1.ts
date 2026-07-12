import {
  createConstantProductAdapter,
  type ConstantProductExactInQuote,
  type ConstantProductHopMetadata,
  type ConstantProductPool,
} from "../constant-product.js";
import {
  planExactInExecution,
  planExactInSwap,
  type ContractCallPlan,
  type ExactInExecutionAdapter,
  type ExactInExecutionPlan,
  type ExactInSwapPlan,
  type XianDatetime,
} from "../execution.js";
import { enumerateExactInRoutes } from "../routing.js";

export const DEFAULT_XIAN_DEX_V1_CONTRACTS = {
  router: "con_dex",
  pairs: "con_pairs",
} as const;

export const DEFAULT_XIAN_DEX_V1_TRADE_FEE_BPS = 30;

export interface XianFixed {
  __fixed__: string;
}

export interface XianDexV1Pair extends Omit<ConstantProductPool<number>, "feeBps"> {}

export interface XianDexV1ExactInQuoteHop {
  pairId: number;
  fromToken: string;
  toToken: string;
  reserveIn: number;
  reserveOut: number;
  amountIn: number;
  amountOut: number;
}

export interface XianDexV1ExactInQuote
  extends Omit<ConstantProductExactInQuote<number>, "hops"> {
  hops: XianDexV1ExactInQuoteHop[];
  /** The canonical v1 signer fee applied uniformly to each hop. */
  feeBps: number;
}

export interface XianDexV1QuoteRequest {
  pairs: readonly XianDexV1Pair[];
  fromToken: string;
  toToken: string;
  amountIn: number;
  feeBps?: number;
  maxHops?: number;
}

export interface XianDexV1ExecutionOptions {
  routerContract?: string;
  feeOnTransferTokens?: Iterable<string>;
  supportingFeeOnTransfer?: boolean;
}

interface XianDexV1ExecutionMetadata {
  supportingFeeOnTransfer: boolean;
}

export interface XianDexV1TokenApprovalRequest {
  token: string;
  spender?: string;
  amount: number;
}

export interface XianDexV1SwapPlanRequest extends XianDexV1ExecutionOptions {
  quote: XianDexV1ExactInQuote;
  recipient: string;
  slippageBps: number;
  deadline: XianDatetime;
}

export interface XianDexV1ExecutionPlanRequest extends XianDexV1SwapPlanRequest {
  allowance: number;
  approvalAmount?: number;
}

export interface XianDexV1SwapPlan extends ExactInSwapPlan<XianDexV1ExecutionMetadata> {
  supportingFeeOnTransfer: boolean;
}

export interface XianDexV1ExecutionPlan
  extends ExactInExecutionPlan<XianDexV1ExecutionMetadata> {
  supportingFeeOnTransfer: boolean;
}

function assertNonEmpty(value: string, label: string): void {
  if (value.trim().length === 0) throw new RangeError(`${label} must not be empty`);
}

function assertFinitePositive(value: number, label: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${label} must be a finite positive number`);
  }
}

/** Encode a deterministic decimal for Xian transaction payloads. */
export function xianFixed(value: number | string): XianFixed {
  const text = String(value).trim();
  if (text.length === 0 || !Number.isFinite(Number(text))) {
    throw new RangeError("fixed value must be finite");
  }
  return { __fixed__: text };
}

function routeEndpoints(quote: XianDexV1ExactInQuote): {
  source: string;
  destination: string;
} {
  if (quote.hops.length === 0 || quote.path.length !== quote.hops.length) {
    throw new RangeError("quote must contain matching non-empty hops and path");
  }
  const firstHop = quote.hops[0];
  const lastHop = quote.hops[quote.hops.length - 1];
  if (!firstHop || !lastHop) throw new RangeError("quote route is incomplete");
  return { source: firstHop.fromToken, destination: lastHop.toToken };
}

export function enumerateXianDexV1ExactInRoutes(
  request: XianDexV1QuoteRequest,
): XianDexV1ExactInQuote[] {
  const feeBps = request.feeBps ?? DEFAULT_XIAN_DEX_V1_TRADE_FEE_BPS;
  const quotes = enumerateExactInRoutes<XianDexV1Pair, number, ConstantProductHopMetadata>({
    pools: request.pairs,
    adapter: createConstantProductAdapter(feeBps),
    fromToken: request.fromToken,
    toToken: request.toToken,
    amountIn: request.amountIn,
    maxHops: request.maxHops,
  });
  return quotes.map((quote) => ({
    ...quote,
    feeBps,
    hops: quote.hops.map((hop) => ({
      pairId: hop.poolId,
      fromToken: hop.fromToken,
      toToken: hop.toToken,
      reserveIn: hop.metadata.reserveIn,
      reserveOut: hop.metadata.reserveOut,
      amountIn: hop.amountIn,
      amountOut: hop.amountOut,
    })),
  }));
}

export function selectBestXianDexV1ExactInRoute(
  request: XianDexV1QuoteRequest,
): XianDexV1ExactInQuote | null {
  return enumerateXianDexV1ExactInRoutes(request)[0] ?? null;
}

export function planXianDexV1TokenApproval(
  request: XianDexV1TokenApprovalRequest,
): ContractCallPlan {
  assertNonEmpty(request.token, "token");
  const spender = request.spender ?? DEFAULT_XIAN_DEX_V1_CONTRACTS.router;
  assertNonEmpty(spender, "spender");
  assertFinitePositive(request.amount, "approval amount");
  return {
    contract: request.token,
    function: "approve",
    kwargs: { amount: xianFixed(request.amount), to: spender },
  };
}

export function createXianDexV1ExecutionAdapter(): ExactInExecutionAdapter<
  XianDexV1ExactInQuote,
  XianDexV1ExecutionOptions,
  XianDexV1ExecutionMetadata
> {
  return {
    amountIn: (quote) => quote.amountIn,
    amountOut: (quote) => quote.amountOut,
    sourceToken: (quote) => routeEndpoints(quote).source,
    approvalSpender: (options) =>
      options.routerContract ?? DEFAULT_XIAN_DEX_V1_CONTRACTS.router,
    buildApprovalCall: ({ token, spender, amount }) =>
      planXianDexV1TokenApproval({ token, spender, amount }),
    buildSwapCall: ({ quote, recipient, amountOutMin, deadline, options }) => {
      const routerContract =
        options.routerContract ?? DEFAULT_XIAN_DEX_V1_CONTRACTS.router;
      assertNonEmpty(routerContract, "routerContract");
      const { source, destination } = routeEndpoints(quote);
      const feeOnTransferTokens = new Set(options.feeOnTransferTokens ?? []);
      const blockedIntermediate = quote.hops
        .slice(0, -1)
        .map((hop) => hop.toToken)
        .find((token) => feeOnTransferTokens.has(token));
      if (blockedIntermediate) {
        throw new RangeError(
          `fee-on-transfer token ${blockedIntermediate} cannot be an intermediate route token`,
        );
      }
      const supportingFeeOnTransfer =
        options.supportingFeeOnTransfer === true ||
        feeOnTransferTokens.has(source) ||
        feeOnTransferTokens.has(destination);
      return {
        call: {
          contract: routerContract,
          function: supportingFeeOnTransfer
            ? "swapExactTokensForTokensSupportingFeeOnTransferTokens"
            : "swapExactTokensForTokens",
          kwargs: {
            amountIn: xianFixed(quote.amountIn),
            amountOutMin: xianFixed(amountOutMin),
            path: [...quote.path],
            src: source,
            to: recipient,
            deadline,
          },
        },
        metadata: { supportingFeeOnTransfer },
      };
    },
  };
}

function executionOptions(request: XianDexV1ExecutionOptions): XianDexV1ExecutionOptions {
  return {
    routerContract: request.routerContract,
    feeOnTransferTokens: request.feeOnTransferTokens,
    supportingFeeOnTransfer: request.supportingFeeOnTransfer,
  };
}

export function planXianDexV1ExactInSwap(
  request: XianDexV1SwapPlanRequest,
): XianDexV1SwapPlan {
  const plan = planExactInSwap({
    quote: request.quote,
    recipient: request.recipient,
    slippageBps: request.slippageBps,
    deadline: request.deadline,
    adapter: createXianDexV1ExecutionAdapter(),
    options: executionOptions(request),
  });
  return {
    ...plan,
    supportingFeeOnTransfer: plan.adapterMetadata.supportingFeeOnTransfer,
  };
}

export function planXianDexV1ExactInExecution(
  request: XianDexV1ExecutionPlanRequest,
): XianDexV1ExecutionPlan {
  const plan = planExactInExecution({
    quote: request.quote,
    recipient: request.recipient,
    allowance: request.allowance,
    approvalAmount: request.approvalAmount,
    slippageBps: request.slippageBps,
    deadline: request.deadline,
    adapter: createXianDexV1ExecutionAdapter(),
    options: executionOptions(request),
  });
  return {
    ...plan,
    supportingFeeOnTransfer: plan.adapterMetadata.supportingFeeOnTransfer,
  };
}
