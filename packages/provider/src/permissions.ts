import type { XianNumber, XianProviderRequest } from "./provider";

export const XIAN_WALLETCONNECT_NAMESPACE = "xian";

export const XIAN_WALLETCONNECT_METHODS = [
  "xian_requestAccounts",
  "xian_getWalletInfo",
  "xian_accounts",
  "xian_chainId",
  "xian_prepareTransaction",
  "xian_signMessage",
  "xian_signTransaction",
  "xian_sendTransaction",
  "xian_sendCall",
  "xian_watchAsset"
] as const;

export const XIAN_WALLETCONNECT_EVENTS = [
  "accountsChanged",
  "chainChanged",
  "connect",
  "disconnect"
] as const;

export type XianWalletConnectMethod =
  (typeof XIAN_WALLETCONNECT_METHODS)[number];

export type XianWalletConnectEvent =
  (typeof XIAN_WALLETCONNECT_EVENTS)[number];

export type XianAutoApproveMethod =
  | "xian_signTransaction"
  | "xian_sendTransaction"
  | "xian_sendCall";

export interface XianDappRequestContext {
  origin: string;
  account: string;
  chainId: string;
  now?: number;
}

export interface XianDappAction {
  method: XianAutoApproveMethod;
  sender?: string;
  chainId?: string;
  contract?: string;
  function?: string;
  chi?: XianNumber | string;
  kwargs?: Record<string, unknown>;
}

export interface XianDappPolicy {
  id: string;
  origin: string;
  account: string;
  chainId: string;
  methods: XianAutoApproveMethod[];
  contract?: string;
  function?: string;
  maxChi?: XianNumber | string;
  kwargs?: Record<string, unknown>;
  label?: string;
  createdAt: number;
  updatedAt?: number;
  expiresAt?: number;
  lastUsedAt?: number;
  useCount?: number;
}

export interface XianDappPolicyMatch {
  matched: boolean;
  policy?: XianDappPolicy;
  action?: XianDappAction;
  reason?: string;
}

function firstParamObject(
  params: unknown[] | Record<string, unknown> | undefined
): Record<string, unknown> {
  if (Array.isArray(params)) {
    const [first] = params;
    return isRecord(first) ? first : {};
  }
  return isRecord(params) ? params : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value != null && !Array.isArray(value);
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function txPayloadFromRequest(request: XianProviderRequest): Record<string, unknown> {
  const root = firstParamObject(request.params);
  const tx = isRecord(root.tx) ? root.tx : root;
  return isRecord(tx.payload) ? tx.payload : tx;
}

function intentFromRequest(request: XianProviderRequest): Record<string, unknown> {
  const root = firstParamObject(request.params);
  return isRecord(root.intent) ? root.intent : root;
}

function normalizeNumber(value: unknown): bigint | null {
  if (value == null) {
    return null;
  }
  if (typeof value === "bigint") {
    return value >= 0n ? value : null;
  }
  if (typeof value === "number") {
    return Number.isInteger(value) && value >= 0 ? BigInt(value) : null;
  }
  if (typeof value === "string" && /^\d+$/.test(value)) {
    return BigInt(value);
  }
  return null;
}

function deepEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) {
    return true;
  }
  if (typeof left !== typeof right) {
    return false;
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right)) {
      return false;
    }
    return (
      left.length === right.length &&
      left.every((entry, index) => deepEqual(entry, right[index]))
    );
  }
  if (isRecord(left) || isRecord(right)) {
    if (!isRecord(left) || !isRecord(right)) {
      return false;
    }
    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);
    return (
      leftKeys.length === rightKeys.length &&
      leftKeys.every((key) => key in right && deepEqual(left[key], right[key]))
    );
  }
  return false;
}

function kwargsMatch(
  policyKwargs: Record<string, unknown> | undefined,
  actionKwargs: Record<string, unknown> | undefined
): boolean {
  if (!policyKwargs || Object.keys(policyKwargs).length === 0) {
    return true;
  }
  if (!actionKwargs) {
    return false;
  }
  return Object.entries(policyKwargs).every(([key, value]) =>
    deepEqual(actionKwargs[key], value)
  );
}

export function xianChainIdToCaip2(chainId: string): string {
  if (!chainId.trim()) {
    throw new TypeError("chainId is required");
  }
  return `${XIAN_WALLETCONNECT_NAMESPACE}:${chainId.trim()}`;
}

export function xianAccountToCaip10(chainId: string, account: string): string {
  const normalizedAccount = account.trim();
  if (!normalizedAccount) {
    throw new TypeError("account is required");
  }
  return `${xianChainIdToCaip2(chainId)}:${normalizedAccount}`;
}

export function xianChainIdFromCaip2(value: string): string | null {
  const prefix = `${XIAN_WALLETCONNECT_NAMESPACE}:`;
  return value.startsWith(prefix) && value.length > prefix.length
    ? value.slice(prefix.length)
    : null;
}

export function xianAccountFromCaip10(value: string): {
  chainId: string;
  account: string;
} | null {
  const prefix = `${XIAN_WALLETCONNECT_NAMESPACE}:`;
  if (!value.startsWith(prefix)) {
    return null;
  }
  const withoutNamespace = value.slice(prefix.length);
  const separator = withoutNamespace.lastIndexOf(":");
  if (separator <= 0 || separator === withoutNamespace.length - 1) {
    return null;
  }
  return {
    chainId: withoutNamespace.slice(0, separator),
    account: withoutNamespace.slice(separator + 1)
  };
}

export function parseXianDappAction(
  request: XianProviderRequest
): XianDappAction | null {
  switch (request.method) {
    case "xian_sendCall": {
      const intent = intentFromRequest(request);
      const kwargs = isRecord(intent.kwargs) ? intent.kwargs : undefined;
      return {
        method: "xian_sendCall",
        chainId: optionalString(intent.chainId),
        contract: optionalString(intent.contract),
        function: optionalString(intent.function),
        chi: (intent.chiSupplied ?? intent.chi) as XianNumber | string | undefined,
        kwargs
      };
    }
    case "xian_signTransaction":
    case "xian_sendTransaction": {
      const payload = txPayloadFromRequest(request);
      const kwargs = isRecord(payload.kwargs) ? payload.kwargs : undefined;
      return {
        method: request.method,
        sender: optionalString(payload.sender),
        chainId: optionalString(payload.chain_id),
        contract: optionalString(payload.contract),
        function: optionalString(payload.function),
        chi: payload.chi_supplied as XianNumber | string | undefined,
        kwargs
      };
    }
    default:
      return null;
  }
}

export function evaluateXianDappPolicy(
  policy: XianDappPolicy,
  context: XianDappRequestContext,
  request: XianProviderRequest
): XianDappPolicyMatch {
  const action = parseXianDappAction(request);
  if (!action) {
    return { matched: false, reason: "request is not auto-approvable" };
  }

  if (policy.expiresAt != null && policy.expiresAt <= (context.now ?? Date.now())) {
    return { matched: false, action, reason: "policy expired" };
  }
  if (policy.origin !== context.origin) {
    return { matched: false, action, reason: "origin mismatch" };
  }
  if (policy.account !== context.account) {
    return { matched: false, action, reason: "account mismatch" };
  }
  if (policy.chainId !== context.chainId) {
    return { matched: false, action, reason: "active chain mismatch" };
  }
  if (action.chainId && action.chainId !== policy.chainId) {
    return { matched: false, action, reason: "request chain mismatch" };
  }
  if (action.sender && action.sender !== policy.account) {
    return { matched: false, action, reason: "sender mismatch" };
  }
  if (!policy.methods.includes(action.method)) {
    return { matched: false, action, reason: "method mismatch" };
  }
  if (policy.contract && action.contract !== policy.contract) {
    return { matched: false, action, reason: "contract mismatch" };
  }
  if (policy.function && action.function !== policy.function) {
    return { matched: false, action, reason: "function mismatch" };
  }
  if (policy.maxChi != null) {
    const policyChi = normalizeNumber(policy.maxChi);
    const actionChi = normalizeNumber(action.chi);
    if (policyChi == null || actionChi == null || actionChi > policyChi) {
      return { matched: false, action, reason: "chi limit exceeded" };
    }
  }
  if (!kwargsMatch(policy.kwargs, action.kwargs)) {
    return { matched: false, action, reason: "arguments mismatch" };
  }

  return { matched: true, policy, action };
}

export function findMatchingXianDappPolicy(
  policies: XianDappPolicy[],
  context: XianDappRequestContext,
  request: XianProviderRequest
): XianDappPolicyMatch {
  let lastAction: XianDappAction | undefined;
  for (const policy of policies) {
    const match = evaluateXianDappPolicy(policy, context, request);
    if (match.matched) {
      return match;
    }
    lastAction = match.action ?? lastAction;
  }
  return {
    matched: false,
    action: lastAction ?? parseXianDappAction(request) ?? undefined,
    reason: policies.length === 0 ? "no policies" : "no matching policy"
  };
}

export function createXianDappPolicyForRequest(input: {
  id: string;
  origin: string;
  account: string;
  chainId: string;
  request: XianProviderRequest;
  now: number;
  expiresAt?: number;
  label?: string;
}): XianDappPolicy | null {
  const action = parseXianDappAction(input.request);
  if (!action) {
    return null;
  }
  const contract = action.contract?.trim();
  const fn = action.function?.trim();
  if (!contract || !fn) {
    return null;
  }
  return {
    id: input.id,
    origin: input.origin,
    account: input.account,
    chainId: input.chainId,
    methods: [action.method],
    contract,
    function: fn,
    maxChi: action.chi,
    label: input.label ?? `${contract}.${fn}`,
    createdAt: input.now,
    updatedAt: input.now,
    expiresAt: input.expiresAt
  };
}
