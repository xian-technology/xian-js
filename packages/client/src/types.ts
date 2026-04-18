export type XianNumber = number | bigint;

export type BroadcastMode = "async" | "checktx" | "commit";

export interface XianSigner {
  getAddress?(): Promise<string> | string;
  signMessage(message: string): Promise<string> | string;
}

export interface XianClientOptions {
  rpcUrl: string;
  dashboardUrl?: string;
  chainId?: string;
  fetchFn?: typeof fetch;
  webSocketFactory?: XianWebSocketFactory;
  /**
   * Default timeout, in milliseconds, applied to each HTTP request the
   * client makes. Callers can override or disable per-call via options.
   * Defaults to 30_000 ms. Set to 0 or a negative value to disable.
   */
  requestTimeoutMs?: number;
}

export interface BuildTxRequest {
  sender: string;
  contract: string;
  function: string;
  kwargs: Record<string, unknown>;
  chainId?: string;
  nonce?: XianNumber;
  chi?: XianNumber;
  chiSupplied?: XianNumber;
}

export interface SimulateRequest {
  sender: string;
  contract: string;
  function: string;
  kwargs: Record<string, unknown>;
}

export interface XianTokenMetadata {
  contract: string;
  name: string | null;
  symbol: string | null;
  logoUrl: string | null;
  logoSvg: string | null;
}

export interface GetTokenBalancesOptions {
  limit?: number;
  offset?: number;
  includeZero?: boolean;
}

export interface GetShieldedWalletHistoryOptions {
  kind?: string;
  limit?: number;
  afterNoteIndex?: number;
}

export interface XianShieldedWalletHistoryEntry {
  eventId: number | null;
  txHash: string | null;
  blockHeight: XianNumber | null;
  txIndex: XianNumber | null;
  contract: string | null;
  function: string | null;
  action: string | null;
  outputIndex: XianNumber | null;
  noteIndex: XianNumber | null;
  commitment: string | null;
  newRoot: string | null;
  payloadHash: string | null;
  tagKind: string | null;
  tagValue: string | null;
  outputPayload: string | null;
  createdAt: string | null;
  raw: Record<string, unknown>;
}

export interface XianShieldedWalletHistoryResult {
  available: boolean;
  items: XianShieldedWalletHistoryEntry[];
  limit: number;
  afterNoteIndex: number;
}

export interface XianTokenBalance {
  contract: string;
  balance: string | null;
  name: string | null;
  symbol: string | null;
  logoUrl: string | null;
  lastTxHash: string | null;
  lastBlockHeight: XianNumber | null;
  updatedAt: string | null;
}

export interface XianTokenBalancesResult {
  available: boolean;
  address: string;
  items: XianTokenBalance[];
  total: number;
  limit: number;
  offset: number;
}

/**
 * Canonical unsigned Xian transaction payload.
 *
 * An identical definition lives in ``@xian-tech/provider`` (see
 * ``packages/provider/src/provider.ts``) because the two packages don't
 * depend on each other — the provider package describes the wallet-facing
 * contract and must stay lightweight. When changing the shape here, update
 * the provider copy in the same commit.
 */
export interface XianTxPayload {
  chain_id: string;
  contract: string;
  function: string;
  kwargs: Record<string, unknown>;
  nonce: XianNumber;
  sender: string;
  chi_supplied: XianNumber;
}

export interface XianUnsignedTransaction {
  payload: XianTxPayload;
}

export interface XianSignedTransaction {
  payload: XianTxPayload;
  metadata: {
    signature: string;
  };
}

export interface BroadcastTxOptions {
  mode?: BroadcastMode;
  waitForTx?: boolean;
  timeoutMs?: number;
  pollIntervalMs?: number;
}

export interface WaitForTxOptions {
  timeoutMs?: number;
  pollIntervalMs?: number;
}

export interface EstimateChiOptions {
  chiMargin?: number;
  minChiHeadroom?: number;
}

export interface EstimateChiResult {
  estimated: number;
  suggested: number;
  simulation: Record<string, unknown>;
}

export interface TransactionReceipt {
  success: boolean;
  txHash?: string;
  message?: unknown;
  response: Record<string, unknown>;
  transaction?: XianSignedTransaction;
  execution?: unknown;
}

export interface TransactionSubmission {
  submitted: boolean;
  accepted: boolean | null;
  finalized: boolean;
  txHash?: string;
  message?: unknown;
  mode: BroadcastMode;
  nonce: XianNumber;
  chiSupplied: XianNumber;
  chiEstimated?: number;
  response: Record<string, unknown>;
  receipt?: TransactionReceipt;
}

export interface XianShieldedRelayerClientOptions {
  relayerUrl: string;
  authToken?: string;
  fetchFn?: typeof fetch;
  /**
   * Default timeout, in milliseconds, applied to relayer HTTP requests.
   * Defaults to 30_000 ms. Set to 0 or a negative value to disable.
   */
  requestTimeoutMs?: number;
}

export type XianShieldedRelayKind =
  | "shielded_note_relay_transfer"
  | "shielded_command";

export type XianShieldedRelayerAuthScheme = "none" | "bearer";

export interface XianShieldedRelayerCatalogEntryInput {
  id?: string;
  relayerUrl?: string;
  baseUrl?: string;
  authToken?: string;
  authScheme?: XianShieldedRelayerAuthScheme;
  publicInfo?: boolean;
  publicQuote?: boolean;
  publicJobLookup?: boolean;
  priority?: number;
  submissionKinds?: XianShieldedRelayKind[];
}

export interface XianShieldedRelayerCatalogEntry {
  id: string;
  relayerUrl: string;
  authToken?: string;
  authScheme: XianShieldedRelayerAuthScheme;
  publicInfo: boolean;
  publicQuote: boolean;
  publicJobLookup: boolean;
  priority: number;
  submissionKinds: XianShieldedRelayKind[];
}

export interface XianShieldedRelayerPoolClientOptions {
  relayers: XianShieldedRelayerCatalogEntryInput[];
  fetchFn?: typeof fetch;
}

export interface XianShieldedRelayerRouteOptions {
  relayerId?: string;
}

export interface XianShieldedRelayerInfoPolicy {
  quoteTtlSeconds: number;
  defaultExpirySeconds: number;
  maxExpirySeconds: number;
  minNoteRelayerFee: XianNumber;
  minCommandRelayerFee: XianNumber;
  allowedNoteContracts: string[];
  allowedCommandContracts: string[];
  allowedCommandTargets: string[];
}

export interface XianShieldedRelayerInfo {
  service: string;
  protocolVersion: string;
  available: boolean;
  chainId: string | null;
  relayerAccount: string | null;
  submissionMode: BroadcastMode;
  waitForTx: boolean;
  capabilities: Record<string, boolean>;
  policy: XianShieldedRelayerInfoPolicy;
  raw: Record<string, unknown>;
}

export interface XianShieldedRelayerQuoteRequest {
  kind: XianShieldedRelayKind;
  contract: string;
  targetContract?: string;
  requestedRelayerFee?: XianNumber;
  requestedExpiresInSeconds?: number;
}

export interface XianShieldedRelayerQuote {
  kind: XianShieldedRelayKind;
  contract: string;
  targetContract: string | null;
  chainId: string | null;
  relayerAccount: string | null;
  relayerFee: XianNumber;
  expiresAt: string | null;
  issuedAt: string | null;
  policyVersion: string | null;
  raw: Record<string, unknown>;
}

export interface XianShieldedRelayerInfoResolution {
  relayer: XianShieldedRelayerCatalogEntry;
  info: XianShieldedRelayerInfo;
}

export interface XianShieldedRelayerQuoteResolution {
  relayer: XianShieldedRelayerCatalogEntry;
  quote: XianShieldedRelayerQuote;
}

export interface SubmitShieldedNoteRelayTransferRequest {
  contract: string;
  oldRoot: string;
  inputNullifiers: string[];
  outputCommitments: string[];
  proofHex: string;
  relayerFee: XianNumber;
  expiresAt?: string | null;
  outputPayloads?: string[];
  clientRequestId?: string;
}

export interface SubmitShieldedCommandRequest {
  contract: string;
  targetContract: string;
  oldRoot: string;
  inputNullifiers: string[];
  outputCommitments: string[];
  proofHex: string;
  relayerFee: XianNumber;
  publicAmount?: XianNumber;
  payload?: Record<string, unknown> | null;
  expiresAt?: string | null;
  outputPayloads?: string[];
  clientRequestId?: string;
}

export interface XianShieldedRelayerJob {
  jobId: string;
  kind: XianShieldedRelayKind;
  status: string;
  chainId: string | null;
  relayerAccount: string | null;
  contract: string | null;
  functionName: string | null;
  txHash: string | null;
  submittedAt: string | null;
  updatedAt: string | null;
  error: string | null;
  submission: TransactionSubmission | null;
  raw: Record<string, unknown>;
}

export interface XianShieldedRelayerJobResolution {
  relayer: XianShieldedRelayerCatalogEntry;
  job: XianShieldedRelayerJob;
}

export interface ContractSendOptions extends BroadcastTxOptions {
  chi?: XianNumber;
  nonce?: XianNumber;
  chainId?: string;
}

export interface TokenTransferOptions extends ContractSendOptions {
  signer: XianSigner;
  to: string;
  amount: string | number | bigint;
}

export interface TokenApproveOptions extends ContractSendOptions {
  signer: XianSigner;
  spender: string;
  amount: string | number | bigint;
}

export interface XianWebSocketLike {
  onopen: ((event: Event) => void) | null;
  onerror: ((event: Event) => void) | null;
  onclose: ((event: CloseEvent) => void) | null;
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

export type XianWebSocketFactory = (url: string) => XianWebSocketLike;

export interface WatchSubscription {
  unsubscribe(): Promise<void>;
}

export interface XianBlockMessage {
  type: "new_block";
  height?: number | string;
  hash?: string;
  proposer?: string;
  txs?: Array<Record<string, unknown>>;
  [key: string]: unknown;
}

export interface XianStateChangeMessage {
  type: "state_change";
  key: string;
  value: unknown;
}

export interface XianContractEventMessage {
  type: "contract_event";
  contract: string;
  event: string;
  signer?: string;
  caller?: string;
  data?: Record<string, unknown>;
}

export interface XianWatchEventFilter {
  contract: string;
  event?: string;
}
