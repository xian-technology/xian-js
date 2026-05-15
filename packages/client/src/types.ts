import type {
  BroadcastMode,
  XianNumber,
  XianSignedTransaction,
  XianSigner,
  XianTxPayload,
  XianUnsignedTransaction
} from "@xian-tech/types";

export type {
  BroadcastMode,
  XianNumber,
  XianSignedTransaction,
  XianSigner,
  XianTxPayload,
  XianUnsignedTransaction
} from "@xian-tech/types";

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

export interface ContractDeploymentArtifacts {
  format: string;
  module_name?: string;
  vm_profile?: string;
  source?: string;
  vm_ir_json?: string;
  hashes?: Record<string, string>;
  [key: string]: unknown;
}

export interface SubmitContractOptions {
  name: string;
  deploymentArtifacts: ContractDeploymentArtifacts;
  signer: XianSigner;
  args?: Record<string, unknown>;
  mode?: BroadcastMode;
  waitForTx?: boolean;
  timeoutMs?: number;
  pollIntervalMs?: number;
  chi?: XianNumber;
  nonce?: XianNumber;
  chainId?: string;
}

export interface XianContractCompiler {
  compileContractArtifact?: (
    moduleName: string,
    source: string,
    options?: { vmProfile?: string; lint?: boolean }
  ) => ContractDeploymentArtifacts | Promise<ContractDeploymentArtifacts>;
  compileContractArtifactJson?: (
    moduleName: string,
    source: string,
    optionsJson?: string
  ) => string | Promise<string>;
}

export interface DeployContractOptions
  extends Omit<SubmitContractOptions, "deploymentArtifacts"> {
  source: string;
  compiler?: XianContractCompiler;
  lint?: boolean;
  vmProfile?: string;
}

export interface SimulateRequest {
  sender: string;
  contract: string;
  function: string;
  kwargs: Record<string, unknown>;
}

export interface XianAbciQueryOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface XianContractVars {
  variables: string[];
  hashes: string[];
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

export interface XianPageOptions {
  limit?: number;
  offset?: number;
}

export interface XianEventListOptions extends XianPageOptions {
  afterId?: number;
}

export interface XianIndexedBlock {
  height: XianNumber | null;
  blockHash: string | null;
  appHash: string | null;
  blockTime: string | XianNumber | null;
  blockTimeIso: string | null;
  proposer: string | null;
  txCount: number | null;
  raw: Record<string, unknown>;
}

export interface XianIndexedTransaction {
  hash: string | null;
  blockHeight: XianNumber | null;
  blockHash: string | null;
  blockTime: string | XianNumber | null;
  txIndex: number | null;
  sender: string | null;
  nonce: XianNumber | null;
  contract: string | null;
  functionName: string | null;
  success: boolean | null;
  statusCode: number | null;
  chiUsed: XianNumber | null;
  result: unknown;
  payload: Record<string, unknown> | null;
  envelope: unknown;
  createdAt: string | null;
  raw: Record<string, unknown>;
}

export interface XianIndexedEvent {
  id: number | null;
  blockHeight: XianNumber | null;
  txHash: string | null;
  txIndex: number | null;
  eventIndex: number | null;
  contract: string | null;
  event: string | null;
  signer: string | null;
  caller: string | null;
  dataIndexed: Record<string, unknown> | null;
  data: Record<string, unknown> | null;
  createdAt: string | null;
  raw: Record<string, unknown>;
}

export interface XianRecentEventsResult {
  available: boolean;
  items: XianIndexedEvent[];
  limit: number;
  offset: number;
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

export interface EstimateChiResult {
  estimated: number;
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

export interface XianWatchOptions {
  onError?(error: Error): void;
}
