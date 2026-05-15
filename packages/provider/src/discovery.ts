import { ProviderUnauthorizedError } from "./errors.js";
import type {
  BroadcastMode,
  TransactionSubmission,
  XianTransactionIntent,
  XianProvider,
  XianProviderRequest,
  XianWalletInfo,
  XianSignedTransaction,
  XianSigner,
  XianWatchAssetRequest,
  XianUnsignedTransaction
} from "./provider.js";

export const XIAN_INITIALIZED_EVENT = "xian#initialized";

export interface XianWalletMetadata {
  id: string;
  name: string;
  icon?: string;
  rdns?: string;
}

export interface InjectedXianProviderRecord {
  metadata: XianWalletMetadata;
  provider: XianProvider;
}

export interface XianProviderNamespace {
  provider?: XianProvider;
  providers: InjectedXianProviderRecord[];
}

export interface XianInjectionTarget extends EventTarget {
  xian?: XianProviderNamespace;
  xianProviders?: InjectedXianProviderRecord[];
}

export interface RegisterInjectedXianProviderOptions {
  metadata: XianWalletMetadata;
  provider: XianProvider;
  target?: XianInjectionTarget;
  setAsDefault?: boolean;
}

export interface FindInjectedXianProviderOptions {
  id?: string;
  target?: XianInjectionTarget;
  predicate?(record: InjectedXianProviderRecord): boolean;
}

export interface WaitForInjectedXianProviderOptions
  extends FindInjectedXianProviderOptions {
  timeoutMs?: number;
}

function getDefaultTarget(target?: XianInjectionTarget): XianInjectionTarget {
  if (target) {
    return target;
  }
  if (typeof window !== "undefined") {
    return window as unknown as XianInjectionTarget;
  }
  throw new TypeError(
    "window is not available; pass an explicit injection target"
  );
}

function ensureNamespace(target: XianInjectionTarget): XianProviderNamespace {
  const providers = target.xianProviders ?? target.xian?.providers ?? [];
  target.xianProviders = providers;

  if (!target.xian) {
    target.xian = { providers };
  } else {
    target.xian.providers = providers;
  }

  return target.xian;
}

function matchesFindOptions(
  record: InjectedXianProviderRecord,
  options?: FindInjectedXianProviderOptions
): boolean {
  if (!options) {
    return true;
  }
  if (options.id && record.metadata.id !== options.id) {
    return false;
  }
  if (options.predicate && !options.predicate(record)) {
    return false;
  }
  return true;
}

function createInitializedEvent(record: InjectedXianProviderRecord): Event {
  if (typeof CustomEvent === "function") {
    return new CustomEvent<InjectedXianProviderRecord>(
      XIAN_INITIALIZED_EVENT,
      {
        detail: record
      }
    );
  }

  const event = new Event(XIAN_INITIALIZED_EVENT);
  Object.defineProperty(event, "detail", {
    value: record
  });
  return event;
}

export function registerInjectedXianProvider(
  options: RegisterInjectedXianProviderOptions
): InjectedXianProviderRecord {
  const target = getDefaultTarget(options.target);
  const namespace = ensureNamespace(target);
  const record: InjectedXianProviderRecord = {
    metadata: options.metadata,
    provider: options.provider
  };

  const providers = target.xianProviders ?? [];
  const existingIndex = providers.findIndex(
    (entry) =>
      entry.provider === options.provider ||
      entry.metadata.id === options.metadata.id
  );
  const replacedDefault =
    existingIndex >= 0 && providers[existingIndex]?.provider === namespace.provider;

  if (existingIndex >= 0) {
    providers[existingIndex] = record;
  } else {
    providers.push(record);
  }

  target.xianProviders = providers;
  namespace.providers = providers;

  const shouldSetDefault =
    options.setAsDefault === true ||
    (options.setAsDefault !== false && namespace.provider == null) ||
    replacedDefault;

  if (shouldSetDefault) {
    namespace.provider = options.provider;
  } else if (
    namespace.provider &&
    !providers.some((entry) => entry.provider === namespace.provider)
  ) {
    namespace.provider = providers[0]?.provider;
  }

  target.dispatchEvent(createInitializedEvent(record));
  return record;
}

export function listInjectedXianProviders(
  target?: XianInjectionTarget
): InjectedXianProviderRecord[] {
  const resolvedTarget = getDefaultTarget(target);
  const namespace = ensureNamespace(resolvedTarget);
  return [...namespace.providers];
}

export function getInjectedXianProvider(
  options?: FindInjectedXianProviderOptions
): InjectedXianProviderRecord | undefined {
  const target = getDefaultTarget(options?.target);
  const namespace = ensureNamespace(target);
  const providers = listInjectedXianProviders(target);

  if (!options?.id && !options?.predicate && namespace.provider) {
    const defaultRecord = providers.find(
      (record) => record.provider === namespace.provider
    );
    if (defaultRecord) {
      return defaultRecord;
    }
  }

  return providers.find((record) =>
    matchesFindOptions(record, options)
  );
}

export async function waitForInjectedXianProvider(
  options?: WaitForInjectedXianProviderOptions
): Promise<InjectedXianProviderRecord | undefined> {
  const target = getDefaultTarget(options?.target);
  const existing = getInjectedXianProvider(options);
  if (existing) {
    return existing;
  }

  const timeoutMs = options?.timeoutMs ?? 0;

  return new Promise((resolve) => {
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const cleanup = (): void => {
      target.removeEventListener(XIAN_INITIALIZED_EVENT, handleInitialized);
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
    };

    const handleInitialized = (event: Event): void => {
      const detail = (
        event as Event & { detail?: InjectedXianProviderRecord }
      ).detail;
      if (detail && matchesFindOptions(detail, options)) {
        cleanup();
        resolve(detail);
      }
    };

    target.addEventListener(XIAN_INITIALIZED_EVENT, handleInitialized);

    if (timeoutMs > 0) {
      timeoutId = setTimeout(() => {
        cleanup();
        resolve(undefined);
      }, timeoutMs);
    }
  });
}

export class ProviderBackedXianSigner implements XianSigner {
  constructor(private readonly wallet: InjectedXianWallet) {}

  async getAddress(): Promise<string> {
    const [account] = await this.wallet.connect();
    if (!account) {
      throw new ProviderUnauthorizedError("wallet returned no accounts");
    }
    return account;
  }

  signMessage(message: string): Promise<string> {
    return this.wallet.signMessage(message);
  }
}

export class InjectedXianWallet {
  constructor(
    readonly provider: XianProvider,
    readonly metadata?: XianWalletMetadata
  ) {}

  static fromRecord(record: InjectedXianProviderRecord): InjectedXianWallet {
    return new InjectedXianWallet(record.provider, record.metadata);
  }

  static getInjected(
    options?: FindInjectedXianProviderOptions
  ): InjectedXianWallet | undefined {
    const record = getInjectedXianProvider(options);
    return record ? InjectedXianWallet.fromRecord(record) : undefined;
  }

  static async waitForInjected(
    options?: WaitForInjectedXianProviderOptions
  ): Promise<InjectedXianWallet | undefined> {
    const record = await waitForInjectedXianProvider(options);
    return record ? InjectedXianWallet.fromRecord(record) : undefined;
  }

  request<TResponse = unknown>(args: XianProviderRequest): Promise<TResponse> {
    return this.provider.request(args) as Promise<TResponse>;
  }

  on(event: string, listener: (...args: unknown[]) => void): void {
    this.provider.on(event, listener);
  }

  removeListener(event: string, listener: (...args: unknown[]) => void): void {
    this.provider.removeListener(event, listener);
  }

  connect(): Promise<string[]> {
    return this.request<string[]>({ method: "xian_requestAccounts" });
  }

  disconnect(): Promise<unknown> {
    return this.request({ method: "xian_disconnect" });
  }

  getAccounts(): Promise<string[]> {
    return this.request<string[]>({ method: "xian_accounts" });
  }

  getChainId(): Promise<string> {
    return this.request<string>({ method: "xian_chainId" });
  }

  async getWalletInfo(): Promise<XianWalletInfo> {
    const walletInfo = await this.request<XianWalletInfo>({
      method: "xian_getWalletInfo"
    });
    if (this.metadata && walletInfo.wallet == null) {
      return {
        ...walletInfo,
        wallet: this.metadata
      };
    }
    return walletInfo;
  }

  switchChain(chainId: string): Promise<unknown> {
    return this.request({
      method: "xian_switchChain",
      params: [{ chainId }]
    });
  }

  watchAsset(request: XianWatchAssetRequest): Promise<boolean> {
    return this.request<boolean>({
      method: "xian_watchAsset",
      params: [request]
    });
  }

  signMessage(message: string): Promise<string> {
    return this.request<string>({
      method: "xian_signMessage",
      params: [{ message }]
    });
  }

  prepareTransaction(intent: XianTransactionIntent): Promise<XianUnsignedTransaction> {
    return this.request<XianUnsignedTransaction>({
      method: "xian_prepareTransaction",
      params: [{ intent }]
    });
  }

  signTransaction(tx: XianUnsignedTransaction): Promise<XianSignedTransaction> {
    return this.request<XianSignedTransaction>({
      method: "xian_signTransaction",
      params: [{ tx }]
    });
  }

  sendTransaction(
    tx: XianUnsignedTransaction,
    options?: {
      mode?: BroadcastMode;
      waitForTx?: boolean;
      timeoutMs?: number;
      pollIntervalMs?: number;
    }
  ): Promise<TransactionSubmission> {
    return this.request<TransactionSubmission>({
      method: "xian_sendTransaction",
      params: [
        {
          tx,
          mode: options?.mode,
          waitForTx: options?.waitForTx,
          timeoutMs: options?.timeoutMs,
          pollIntervalMs: options?.pollIntervalMs
        }
      ]
    });
  }

  sendCall(
    intent: XianTransactionIntent,
    options?: {
      mode?: BroadcastMode;
      waitForTx?: boolean;
      timeoutMs?: number;
      pollIntervalMs?: number;
    }
  ): Promise<TransactionSubmission> {
    return this.request<TransactionSubmission>({
      method: "xian_sendCall",
      params: [
        {
          intent,
          mode: options?.mode,
          waitForTx: options?.waitForTx,
          timeoutMs: options?.timeoutMs,
          pollIntervalMs: options?.pollIntervalMs
        }
      ]
    });
  }

  asSigner(): ProviderBackedXianSigner {
    return new ProviderBackedXianSigner(this);
  }
}

declare global {
  interface Window {
    xian?: XianProviderNamespace;
    xianProviders?: InjectedXianProviderRecord[];
  }
}
