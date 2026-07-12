export interface XianDatetime {
  __time__: [number, number, number, number, number, number, number];
}

export interface ContractCallPlan {
  contract: string;
  function: string;
  kwargs: Record<string, unknown>;
}

export interface ExactInExecutionAdapter<Quote, Options, Metadata = unknown> {
  amountIn(quote: Quote): number;
  amountOut(quote: Quote): number;
  sourceToken(quote: Quote): string;
  approvalSpender(options: Options): string;
  buildSwapCall(args: {
    quote: Quote;
    recipient: string;
    amountOutMin: number;
    deadline: XianDatetime;
    options: Options;
  }): { call: ContractCallPlan; metadata: Metadata };
  buildApprovalCall(args: {
    token: string;
    spender: string;
    amount: number;
    options: Options;
  }): ContractCallPlan;
}

export interface ExactInSwapPlanRequest<Quote, Options, Metadata = unknown> {
  quote: Quote;
  recipient: string;
  slippageBps: number;
  deadline: XianDatetime;
  adapter: ExactInExecutionAdapter<Quote, Options, Metadata>;
  options: Options;
}

export interface ExactInSwapPlan<Metadata = unknown> {
  call: ContractCallPlan;
  amountOutMin: number;
  adapterMetadata: Metadata;
}

export interface ExactInExecutionPlanRequest<Quote, Options, Metadata = unknown>
  extends ExactInSwapPlanRequest<Quote, Options, Metadata> {
  allowance: number;
  approvalAmount?: number;
}

export interface ExactInExecutionPlan<Metadata = unknown>
  extends ExactInSwapPlan<Metadata> {
  approval: ContractCallPlan | null;
  calls: ContractCallPlan[];
}

function assertNonEmpty(value: string, label: string): void {
  if (value.trim().length === 0) throw new RangeError(`${label} must not be empty`);
}

function assertFiniteNonNegative(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${label} must be a finite non-negative number`);
  }
}

function assertFinitePositive(value: number, label: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${label} must be a finite positive number`);
  }
}

function assertBps(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 0 || value > 10_000) {
    throw new RangeError(`${label} must be an integer from 0 to 10000`);
  }
}

export function minimumAmountOut(amountOut: number, slippageBps: number): number {
  assertFiniteNonNegative(amountOut, "amountOut");
  assertBps(slippageBps, "slippageBps");
  return amountOut * (1 - slippageBps / 10_000);
}

export function deadlineFromDate(date: Date): XianDatetime {
  if (!Number.isFinite(date.getTime())) throw new RangeError("deadline date must be valid");
  return {
    __time__: [
      date.getUTCFullYear(),
      date.getUTCMonth() + 1,
      date.getUTCDate(),
      date.getUTCHours(),
      date.getUTCMinutes(),
      date.getUTCSeconds(),
      date.getUTCMilliseconds() * 1_000,
    ],
  };
}

export function deadlineFromNow(
  minutesFromNow: number,
  now: number | Date = Date.now(),
): XianDatetime {
  assertFiniteNonNegative(minutesFromNow, "minutesFromNow");
  const nowMs = now instanceof Date ? now.getTime() : now;
  if (!Number.isFinite(nowMs)) throw new RangeError("now must be a valid date or timestamp");
  return deadlineFromDate(new Date(nowMs + minutesFromNow * 60_000));
}

export function requiresApproval(allowance: number, amountIn: number): boolean {
  assertFiniteNonNegative(allowance, "allowance");
  assertFinitePositive(amountIn, "amountIn");
  return allowance < amountIn;
}

export function planExactInSwap<Quote, Options, Metadata = unknown>(
  request: ExactInSwapPlanRequest<Quote, Options, Metadata>,
): ExactInSwapPlan<Metadata> {
  assertNonEmpty(request.recipient, "recipient");
  const amountIn = request.adapter.amountIn(request.quote);
  const amountOut = request.adapter.amountOut(request.quote);
  assertFinitePositive(amountIn, "quote amountIn");
  assertFiniteNonNegative(amountOut, "quote amountOut");
  const amountOutMin = minimumAmountOut(amountOut, request.slippageBps);
  const built = request.adapter.buildSwapCall({
    quote: request.quote,
    recipient: request.recipient,
    amountOutMin,
    deadline: request.deadline,
    options: request.options,
  });
  return { call: built.call, amountOutMin, adapterMetadata: built.metadata };
}

export function planExactInExecution<Quote, Options, Metadata = unknown>(
  request: ExactInExecutionPlanRequest<Quote, Options, Metadata>,
): ExactInExecutionPlan<Metadata> {
  const swap = planExactInSwap(request);
  const amountIn = request.adapter.amountIn(request.quote);
  const approvalNeeded = requiresApproval(request.allowance, amountIn);
  const approvalAmount = request.approvalAmount ?? amountIn;
  if (approvalNeeded && approvalAmount < amountIn) {
    throw new RangeError("approvalAmount must cover the exact input amount");
  }
  const approval = approvalNeeded
    ? request.adapter.buildApprovalCall({
        token: request.adapter.sourceToken(request.quote),
        spender: request.adapter.approvalSpender(request.options),
        amount: approvalAmount,
        options: request.options,
      })
    : null;
  return {
    ...swap,
    approval,
    calls: approval ? [approval, swap.call] : [swap.call],
  };
}
