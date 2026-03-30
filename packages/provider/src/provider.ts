import {
  ProviderChainMismatchError,
  ProviderDisconnectedError,
  ProviderUnauthorizedError,
  ProviderUnsupportedMethodError
} from "./errors";

type Listener = (...args: unknown[]) => void;

export type BroadcastMode = "async" | "checktx" | "commit";

export type XianNumber = number | bigint;

export interface XianSigner {
  getAddress?(): Promise<string> | string;
  signMessage(message: string): Promise<string> | string;
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

export interface TransactionSubmission {
  submitted: boolean;
  accepted: boolean | null;
  finalized: boolean;
  txHash?: string;
  message?: unknown;
  mode: BroadcastMode;
  nonce: XianNumber;
  stampsSupplied: XianNumber;
  response: Record<string, unknown>;
}

export interface XianWalletCapabilities {
  getWalletInfo: boolean;
  prepareTransaction: boolean;
  signMessage: boolean;
  signTransaction: boolean;
  sendTransaction: boolean;
  sendCall: boolean;
  switchChain: boolean;
  watchAsset: boolean;
}

export interface XianWalletDescriptor {
  id?: string;
  name?: string;
  icon?: string;
  rdns?: string;
}

export interface XianWalletInfo {
  accounts: string[];
  selectedAccount?: string;
  chainId?: string;
  connected: boolean;
  locked: boolean;
  wallet?: XianWalletDescriptor;
  capabilities: XianWalletCapabilities;
}

export interface XianWatchedAsset {
  contract: string;
  name?: string;
  symbol?: string;
  icon?: string;
  decimals?: number;
}

export interface XianWatchAssetRequest {
  type?: "token";
  options: XianWatchedAsset;
}

export interface XianTransactionIntent {
  contract: string;
  function: string;
  kwargs: Record<string, unknown>;
  chainId?: string;
  stamps?: XianNumber | string;
  stampsSupplied?: XianNumber | string;
}

export interface XianProviderRequest {
  method: string;
  params?: unknown[] | Record<string, unknown>;
}

export interface XianProvider {
  request(args: XianProviderRequest): Promise<unknown>;
  on(event: string, listener: Listener): void;
  removeListener(event: string, listener: Listener): void;
}

export interface XianProviderClient {
  getChainId(): Promise<string>;
  buildTx(intent: {
    sender: string;
    contract: string;
    function: string;
    kwargs: Record<string, unknown>;
    chainId?: string;
    stamps?: XianNumber;
    stampsSupplied?: XianNumber;
  }): Promise<XianUnsignedTransaction>;
  signTx(tx: XianUnsignedTransaction, signer: XianSigner): Promise<XianSignedTransaction>;
  broadcastTx(
    tx: XianSignedTransaction,
    options?: {
      mode?: BroadcastMode;
      waitForTx?: boolean;
      timeoutMs?: number;
      pollIntervalMs?: number;
    }
  ): Promise<TransactionSubmission>;
}

export interface InMemoryXianProviderOptions {
  signer: XianSigner;
  client?: XianProviderClient;
  chainId?: string;
  locked?: boolean;
  watchedAssets?: XianWatchedAsset[];
  onWatchAsset?(asset: XianWatchedAsset): boolean | Promise<boolean>;
}

class EventEmitter {
  private readonly listeners = new Map<string, Set<Listener>>();

  on(event: string, listener: Listener): void {
    const set = this.listeners.get(event) ?? new Set<Listener>();
    set.add(listener);
    this.listeners.set(event, set);
  }

  removeListener(event: string, listener: Listener): void {
    this.listeners.get(event)?.delete(listener);
  }

  emit(event: string, ...args: unknown[]): void {
    for (const listener of this.listeners.get(event) ?? []) {
      listener(...args);
    }
  }
}

function firstParamObject(params: unknown[] | Record<string, unknown> | undefined): Record<string, unknown> {
  if (Array.isArray(params)) {
    const [first] = params;
    return (first ?? {}) as Record<string, unknown>;
  }
  return (params ?? {}) as Record<string, unknown>;
}

function isIdentifier(value: string): boolean {
  return /^[a-zA-Z][a-zA-Z0-9_]*$/.test(value);
}

function parseOptionalXianNumber(
  value: unknown,
  fieldName: string
): XianNumber | undefined {
  if (value == null) {
    return undefined;
  }
  if (typeof value === "bigint") {
    if (value < 0n) {
      throw new TypeError(`${fieldName} must be a non-negative integer`);
    }
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isInteger(value) || value < 0) {
      throw new TypeError(`${fieldName} must be a non-negative integer`);
    }
    return value;
  }
  if (typeof value === "string" && /^\d+$/.test(value)) {
    const parsed = BigInt(value);
    return parsed <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : parsed;
  }
  throw new TypeError(`${fieldName} must be a non-negative integer`);
}

export class InMemoryXianProvider implements XianProvider {
  private readonly events = new EventEmitter();
  private readonly watchedAssets = new Map<string, XianWatchedAsset>();
  private connected = false;
  private chainId?: string;
  private locked: boolean;

  constructor(private readonly options: InMemoryXianProviderOptions) {
    this.chainId = options.chainId;
    this.locked = options.locked ?? false;
    for (const asset of options.watchedAssets ?? []) {
      this.watchedAssets.set(asset.contract, asset);
    }
  }

  on(event: string, listener: Listener): void {
    this.events.on(event, listener);
  }

  removeListener(event: string, listener: Listener): void {
    this.events.removeListener(event, listener);
  }

  private async getAddress(): Promise<string> {
    if (typeof this.options.signer.getAddress === "function") {
      return this.options.signer.getAddress();
    }
    throw new TypeError("provider signer must implement getAddress()");
  }

  private requireUnlocked(): void {
    if (this.locked) {
      throw new ProviderUnauthorizedError("wallet is locked");
    }
  }

  private async ensureChainId(): Promise<string> {
    if (this.chainId) {
      return this.chainId;
    }
    if (!this.options.client) {
      throw new TypeError("provider client is required to resolve chain id");
    }
    this.chainId = await this.options.client.getChainId();
    return this.chainId;
  }

  private async maybeChainId(): Promise<string | undefined> {
    if (this.chainId) {
      return this.chainId;
    }
    if (!this.options.client) {
      return undefined;
    }
    return this.ensureChainId();
  }

  private getCapabilities(): XianWalletCapabilities {
    const hasClient = this.options.client != null;
    return {
      getWalletInfo: true,
      prepareTransaction: hasClient,
      signMessage: true,
      signTransaction: hasClient,
      sendTransaction: hasClient,
      sendCall: hasClient,
      switchChain: true,
      watchAsset: true
    };
  }

  private async getWalletInfo(): Promise<XianWalletInfo> {
    const accounts =
      this.connected && !this.locked ? [await this.getAddress()] : [];
    return {
      accounts,
      selectedAccount: accounts[0],
      chainId: await this.maybeChainId(),
      connected: this.connected,
      locked: this.locked,
      capabilities: this.getCapabilities()
    };
  }

  private async connect(): Promise<string[]> {
    this.requireUnlocked();
    const accounts = [await this.getAddress()];
    const wasConnected = this.connected;
    this.connected = true;
    const chainId = await this.ensureChainId();

    if (!wasConnected) {
      this.events.emit("connect", { chainId });
      this.events.emit("accountsChanged", accounts);
      this.events.emit("chainChanged", chainId);
    }

    return accounts;
  }

  private disconnect(): null {
    if (this.connected) {
      this.connected = false;
      this.events.emit("accountsChanged", []);
      this.events.emit("disconnect", { code: 4900, message: "provider disconnected" });
    }
    return null;
  }

  private async requireConnected(): Promise<void> {
    if (!this.connected) {
      throw new ProviderDisconnectedError();
    }
    this.requireUnlocked();
  }

  private async prepareTransaction(intent: XianTransactionIntent): Promise<XianUnsignedTransaction> {
    if (!this.options.client) {
      throw new TypeError("provider client is required for xian_prepareTransaction");
    }
    const activeChainId = await this.ensureChainId();
    if (intent.chainId && intent.chainId !== activeChainId) {
      throw new ProviderChainMismatchError();
    }

    return this.options.client.buildTx({
      sender: await this.getAddress(),
      contract: intent.contract,
      function: intent.function,
      kwargs: intent.kwargs,
      chainId: activeChainId,
      stamps: parseOptionalXianNumber(intent.stamps, "stamps"),
      stampsSupplied: parseOptionalXianNumber(
        intent.stampsSupplied,
        "stampsSupplied"
      )
    });
  }

  private normalizeWatchAssetRequest(
    request: Record<string, unknown>
  ): XianWatchedAsset {
    const type = request.type;
    if (type != null && type !== "token") {
      throw new TypeError("xian_watchAsset currently supports only type 'token'");
    }

    const options = firstParamObject(request.options as
      | unknown[]
      | Record<string, unknown>
      | undefined);
    const contract = options.contract;
    if (typeof contract !== "string" || !isIdentifier(contract)) {
      throw new TypeError("xian_watchAsset requires a token contract identifier");
    }

    const name = options.name;
    const symbol = options.symbol;
    const icon = options.icon;
    const decimals = options.decimals;

    if (name != null && typeof name !== "string") {
      throw new TypeError("asset name must be a string");
    }
    if (symbol != null && typeof symbol !== "string") {
      throw new TypeError("asset symbol must be a string");
    }
    if (icon != null && typeof icon !== "string") {
      throw new TypeError("asset icon must be a string");
    }
    if (
      decimals != null &&
      (typeof decimals !== "number" || !Number.isInteger(decimals) || decimals < 0)
    ) {
      throw new TypeError("asset decimals must be a non-negative integer");
    }

    return {
      contract,
      name: name as string | undefined,
      symbol: symbol as string | undefined,
      icon: icon as string | undefined,
      decimals: decimals as number | undefined
    };
  }

  listWatchedAssets(): XianWatchedAsset[] {
    return [...this.watchedAssets.values()];
  }

  async request(args: XianProviderRequest): Promise<unknown> {
    switch (args.method) {
      case "xian_connect":
      case "xian_requestAccounts":
        return this.connect();

      case "xian_getWalletInfo":
        return this.getWalletInfo();

      case "xian_disconnect":
        return this.disconnect();

      case "xian_accounts":
        return this.connected ? [await this.getAddress()] : [];

      case "xian_chainId":
        return this.ensureChainId();

      case "xian_switchChain": {
        const { chainId } = firstParamObject(args.params);
        if (typeof chainId !== "string" || chainId.length === 0) {
          throw new TypeError("xian_switchChain requires a chainId string");
        }
        this.chainId = chainId;
        this.events.emit("chainChanged", chainId);
        return null;
      }

      case "xian_signMessage": {
        await this.requireConnected();
        const { message } = firstParamObject(args.params);
        if (typeof message !== "string") {
          throw new TypeError("xian_signMessage requires a message string");
        }
        return this.options.signer.signMessage(message);
      }

      case "xian_signTransaction": {
        await this.requireConnected();
        if (!this.options.client) {
          throw new TypeError("provider client is required for xian_signTransaction");
        }
        const { tx } = firstParamObject(args.params);
        return this.options.client.signTx(tx as XianUnsignedTransaction, this.options.signer);
      }

      case "xian_prepareTransaction": {
        await this.requireConnected();
        const { intent } = firstParamObject(args.params);
        return this.prepareTransaction(intent as XianTransactionIntent);
      }

      case "xian_sendTransaction": {
        await this.requireConnected();
        if (!this.options.client) {
          throw new TypeError("provider client is required for xian_sendTransaction");
        }
        const { tx, mode, waitForTx, timeoutMs, pollIntervalMs } = firstParamObject(args.params);
        const signedTx = await this.options.client.signTx(
          tx as XianUnsignedTransaction,
          this.options.signer
        );
        return this.options.client.broadcastTx(signedTx, {
          mode: mode as BroadcastMode | undefined,
          waitForTx: waitForTx as boolean | undefined,
          timeoutMs: timeoutMs as number | undefined,
          pollIntervalMs: pollIntervalMs as number | undefined
        });
      }

      case "xian_sendCall": {
        await this.requireConnected();
        if (!this.options.client) {
          throw new TypeError("provider client is required for xian_sendCall");
        }
        const { intent, mode, waitForTx, timeoutMs, pollIntervalMs } = firstParamObject(
          args.params
        );
        const preparedTx = await this.prepareTransaction(
          intent as XianTransactionIntent
        );
        const signedTx = await this.options.client.signTx(
          preparedTx,
          this.options.signer
        );
        return this.options.client.broadcastTx(signedTx, {
          mode: mode as BroadcastMode | undefined,
          waitForTx: waitForTx as boolean | undefined,
          timeoutMs: timeoutMs as number | undefined,
          pollIntervalMs: pollIntervalMs as number | undefined
        });
      }

      case "xian_watchAsset": {
        const asset = this.normalizeWatchAssetRequest(firstParamObject(args.params));
        const accepted = this.options.onWatchAsset
          ? await this.options.onWatchAsset(asset)
          : true;
        if (accepted) {
          this.watchedAssets.set(asset.contract, asset);
        }
        return accepted;
      }

      default:
        throw new ProviderUnsupportedMethodError(args.method);
    }
  }
}
