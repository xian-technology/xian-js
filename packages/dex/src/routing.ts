export const DEFAULT_MAX_HOPS = 3;

export type PoolId = string | number;

export interface ExactInPoolQuote<HopMetadata = unknown> {
  amountOut: number;
  /** Output tokens per input token before price impact and fees. */
  midPriceOut: number;
  metadata: HopMetadata;
}

export interface ExactInRoutingAdapter<
  Pool,
  Id extends PoolId,
  HopMetadata = unknown,
> {
  poolId(pool: Pool): Id;
  tokens(pool: Pool): readonly [string, string];
  quoteExactIn(args: {
    pool: Pool;
    fromToken: string;
    toToken: string;
    amountIn: number;
  }): ExactInPoolQuote<HopMetadata> | null;
  comparePoolIds?(left: Id, right: Id): number;
}

export interface ExactInQuoteHop<Id extends PoolId, HopMetadata = unknown> {
  poolId: Id;
  fromToken: string;
  toToken: string;
  amountIn: number;
  amountOut: number;
  metadata: HopMetadata;
}

export interface ExactInQuote<Id extends PoolId = PoolId, HopMetadata = unknown> {
  amountIn: number;
  amountOut: number;
  hops: ExactInQuoteHop<Id, HopMetadata>[];
  path: Id[];
  /** Fractional loss versus the route's spot mid-price, including route fees. */
  priceImpact: number;
  /** Output tokens per input token at the route's zero-impact spot price. */
  midPriceOut: number;
}

export interface ExactInQuoteRequest<
  Pool,
  Id extends PoolId,
  HopMetadata = unknown,
> {
  pools: readonly Pool[];
  adapter: ExactInRoutingAdapter<Pool, Id, HopMetadata>;
  fromToken: string;
  toToken: string;
  amountIn: number;
  maxHops?: number;
}

interface AdjacencyEdge<Pool, Id extends PoolId> {
  pool: Pool;
  poolId: Id;
  other: string;
}

interface CandidateRoute<Pool, Id extends PoolId> {
  poolIds: Id[];
  tokens: string[];
  edges: AdjacencyEdge<Pool, Id>[];
}

function assertNonEmpty(value: string, label: string): void {
  if (value.trim().length === 0) throw new RangeError(`${label} must not be empty`);
}

function assertFinitePositive(value: number, label: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${label} must be a finite positive number`);
  }
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function defaultComparePoolIds(left: PoolId, right: PoolId): number {
  if (typeof left === "number" && typeof right === "number") return left - right;
  const leftKey = `${typeof left}:${String(left)}`;
  const rightKey = `${typeof right}:${String(right)}`;
  return compareStrings(leftKey, rightKey);
}

function compareIdLists<Id extends PoolId>(
  left: readonly Id[],
  right: readonly Id[],
  compare: (left: Id, right: Id) => number,
): number {
  const sharedLength = Math.min(left.length, right.length);
  for (let index = 0; index < sharedLength; index += 1) {
    const leftValue = left[index];
    const rightValue = right[index];
    if (leftValue === undefined || rightValue === undefined) continue;
    const result = compare(leftValue, rightValue);
    if (result !== 0) return result;
  }
  return left.length - right.length;
}

function poolIdentity(id: PoolId): string {
  return `${typeof id}:${String(id)}`;
}

function buildAdjacency<Pool, Id extends PoolId, HopMetadata>(
  pools: readonly Pool[],
  adapter: ExactInRoutingAdapter<Pool, Id, HopMetadata>,
): Map<string, AdjacencyEdge<Pool, Id>[]> {
  const adjacency = new Map<string, AdjacencyEdge<Pool, Id>[]>();
  const seenPoolIds = new Set<string>();
  const compareIds = adapter.comparePoolIds ?? defaultComparePoolIds;
  const sortedPools = [...pools].sort((left, right) => {
    const idComparison = compareIds(adapter.poolId(left), adapter.poolId(right));
    if (idComparison !== 0) return idComparison;
    const [left0, left1] = adapter.tokens(left);
    const [right0, right1] = adapter.tokens(right);
    return compareStrings(left0, right0) || compareStrings(left1, right1);
  });

  const push = (token: string, edge: AdjacencyEdge<Pool, Id>): void => {
    const edges = adjacency.get(token);
    if (edges) edges.push(edge);
    else adjacency.set(token, [edge]);
  };

  for (const pool of sortedPools) {
    const id = adapter.poolId(pool);
    if ((typeof id === "string" && id.length === 0) ||
        (typeof id === "number" && !Number.isFinite(id))) {
      throw new RangeError("pool ids must be non-empty strings or finite numbers");
    }
    const identity = poolIdentity(id);
    if (seenPoolIds.has(identity)) throw new RangeError(`duplicate pool id ${String(id)}`);
    seenPoolIds.add(identity);

    const [token0, token1] = adapter.tokens(pool);
    assertNonEmpty(token0, `pool ${String(id)} token0`);
    assertNonEmpty(token1, `pool ${String(id)} token1`);
    if (token0 === token1) {
      throw new RangeError(`pool ${String(id)} must contain two different tokens`);
    }
    push(token0, { pool, poolId: id, other: token1 });
    push(token1, { pool, poolId: id, other: token0 });
  }

  for (const edges of adjacency.values()) {
    edges.sort(
      (left, right) =>
        compareIds(left.poolId, right.poolId) || compareStrings(left.other, right.other),
    );
  }
  return adjacency;
}

function enumerateCandidates<Pool, Id extends PoolId>(
  adjacency: ReadonlyMap<string, readonly AdjacencyEdge<Pool, Id>[]>,
  fromToken: string,
  toToken: string,
  maxHops: number,
  compareIds: (left: Id, right: Id) => number,
): CandidateRoute<Pool, Id>[] {
  const candidates: CandidateRoute<Pool, Id>[] = [];
  const visitedTokens = new Set<string>([fromToken]);
  const usedPools = new Set<string>();

  const visit = (current: string, route: CandidateRoute<Pool, Id>): void => {
    if (route.poolIds.length > 0 && current === toToken) {
      candidates.push({
        poolIds: [...route.poolIds],
        tokens: [...route.tokens],
        edges: [...route.edges],
      });
      return;
    }
    if (route.poolIds.length >= maxHops) return;

    for (const edge of adjacency.get(current) ?? []) {
      const identity = poolIdentity(edge.poolId);
      if (usedPools.has(identity)) continue;
      if (visitedTokens.has(edge.other) && edge.other !== toToken) continue;

      usedPools.add(identity);
      visitedTokens.add(edge.other);
      route.poolIds.push(edge.poolId);
      route.tokens.push(edge.other);
      route.edges.push(edge);
      visit(edge.other, route);
      route.edges.pop();
      route.tokens.pop();
      route.poolIds.pop();
      usedPools.delete(identity);
      if (edge.other !== toToken) visitedTokens.delete(edge.other);
    }
  };

  visit(fromToken, { poolIds: [], tokens: [fromToken], edges: [] });
  return candidates.sort(
    (left, right) =>
      left.poolIds.length - right.poolIds.length ||
      compareIdLists(left.poolIds, right.poolIds, compareIds) ||
      compareStrings(left.tokens.join("\u0000"), right.tokens.join("\u0000")),
  );
}

export function calculatePriceImpact(
  amountIn: number,
  amountOut: number,
  midPriceOut: number,
): number {
  if (amountIn <= 0 || amountOut <= 0 || midPriceOut <= 0) return 0;
  return Math.max(0, 1 - amountOut / amountIn / midPriceOut);
}

function quoteCandidate<Pool, Id extends PoolId, HopMetadata>(
  candidate: CandidateRoute<Pool, Id>,
  amountIn: number,
  adapter: ExactInRoutingAdapter<Pool, Id, HopMetadata>,
): ExactInQuote<Id, HopMetadata> | null {
  let currentAmount = amountIn;
  let midPriceOut = 1;
  const hops: ExactInQuoteHop<Id, HopMetadata>[] = [];

  for (let index = 0; index < candidate.edges.length; index += 1) {
    const edge = candidate.edges[index];
    const fromToken = candidate.tokens[index];
    const toToken = candidate.tokens[index + 1];
    if (!edge || fromToken === undefined || toToken === undefined) return null;
    const quoted = adapter.quoteExactIn({
      pool: edge.pool,
      fromToken,
      toToken,
      amountIn: currentAmount,
    });
    if (
      quoted === null ||
      !Number.isFinite(quoted.amountOut) ||
      !Number.isFinite(quoted.midPriceOut) ||
      quoted.amountOut <= 0 ||
      quoted.midPriceOut <= 0
    ) {
      return null;
    }
    hops.push({
      poolId: edge.poolId,
      fromToken,
      toToken,
      amountIn: currentAmount,
      amountOut: quoted.amountOut,
      metadata: quoted.metadata,
    });
    midPriceOut *= quoted.midPriceOut;
    currentAmount = quoted.amountOut;
  }

  return {
    amountIn,
    amountOut: currentAmount,
    hops,
    path: [...candidate.poolIds],
    priceImpact: calculatePriceImpact(amountIn, currentAmount, midPriceOut),
    midPriceOut,
  };
}

/** Enumerate viable simple routes using caller-supplied pool and quote semantics. */
export function enumerateExactInRoutes<Pool, Id extends PoolId, HopMetadata = unknown>(
  request: ExactInQuoteRequest<Pool, Id, HopMetadata>,
): ExactInQuote<Id, HopMetadata>[] {
  assertNonEmpty(request.fromToken, "fromToken");
  assertNonEmpty(request.toToken, "toToken");
  assertFinitePositive(request.amountIn, "amountIn");
  const maxHops = request.maxHops ?? DEFAULT_MAX_HOPS;
  if (!Number.isInteger(maxHops) || maxHops <= 0) {
    throw new RangeError("maxHops must be a positive integer");
  }
  if (request.fromToken === request.toToken) return [];

  const compareIds = request.adapter.comparePoolIds ?? defaultComparePoolIds;
  const candidates = enumerateCandidates(
    buildAdjacency(request.pools, request.adapter),
    request.fromToken,
    request.toToken,
    maxHops,
    compareIds,
  );
  return candidates
    .map((candidate) => quoteCandidate(candidate, request.amountIn, request.adapter))
    .filter((quote): quote is ExactInQuote<Id, HopMetadata> => quote !== null)
    .sort(
      (left, right) =>
        right.amountOut - left.amountOut ||
        left.path.length - right.path.length ||
        compareIdLists(left.path, right.path, compareIds) ||
        compareStrings(
          left.hops.map((hop) => hop.toToken).join("\u0000"),
          right.hops.map((hop) => hop.toToken).join("\u0000"),
        ),
    );
}

export function selectBestExactInRoute<Pool, Id extends PoolId, HopMetadata = unknown>(
  request: ExactInQuoteRequest<Pool, Id, HopMetadata>,
): ExactInQuote<Id, HopMetadata> | null {
  return enumerateExactInRoutes(request)[0] ?? null;
}
