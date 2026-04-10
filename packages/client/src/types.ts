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
}

export interface BuildTxRequest {
  sender: string;
  contract: string;
  function: string;
  kwargs: Record<string, unknown>;
  chainId?: string;
  nonce?: XianNumber;
  stamps?: XianNumber;
  stampsSupplied?: XianNumber;
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

export interface XianTxPayload {
  chain_id: string;
  contract: string;
  function: string;
  kwargs: Record<string, unknown>;
  nonce: XianNumber;
  sender: string;
  stamps_supplied: XianNumber;
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

export interface EstimateStampsOptions {
  stampMargin?: number;
  minStampHeadroom?: number;
}

export interface EstimateStampsResult {
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
  stampsSupplied: XianNumber;
  stampsEstimated?: number;
  response: Record<string, unknown>;
  receipt?: TransactionReceipt;
}

export interface ContractSendOptions extends BroadcastTxOptions {
  stamps?: XianNumber;
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
