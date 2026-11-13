import {
  InjectedXianWallet,
  XIAN_INITIALIZED_EVENT,
  getInjectedXianProvider,
  waitForInjectedXianProvider,
  type BroadcastMode,
  type FindInjectedXianProviderOptions,
  type InjectedXianProviderRecord,
  type TransactionSubmission,
  type WaitForInjectedXianProviderOptions,
  type XianInjectionTarget,
  type XianTransactionIntent,
  type XianWalletInfo
} from "@xian-tech/provider";

export type WalletInfo = XianWalletInfo;
export type CallIntent = XianTransactionIntent;

export interface SendCallResult extends Partial<TransactionSubmission> {
  receipt?: {
    success: boolean;
    message?: unknown;
    txHash?: string;
  };
  error?: unknown;
  [key: string]: unknown;
}

export interface SendCallOptions {
  mode?: BroadcastMode;
  waitForTx?: boolean;
  timeoutMs?: number;
  pollIntervalMs?: number;
  wallet?: InjectedXianWallet;
  target?: XianInjectionTarget;
}

function resolveTarget(target?: XianInjectionTarget): XianInjectionTarget | undefined {
  if (target) {
    return target;
  }
  if (typeof window !== "undefined") {
    return window as unknown as XianInjectionTarget;
  }
  return undefined;
}

function walletFromRecord(
  record: InjectedXianProviderRecord | undefined
): InjectedXianWallet | undefined {
  return record ? InjectedXianWallet.fromRecord(record) : undefined;
}

export function getInjectedWallet(
  options?: FindInjectedXianProviderOptions
): InjectedXianWallet | undefined {
  const target = resolveTarget(options?.target);
  if (!target) {
    return undefined;
  }

  const record = getInjectedXianProvider({ ...options, target });
  return walletFromRecord(record);
}

export async function waitForInjectedWallet(
  options?: WaitForInjectedXianProviderOptions
): Promise<InjectedXianWallet | undefined> {
  const target = resolveTarget(options?.target);
  if (!target) {
    return undefined;
  }

  const existing = getInjectedWallet({ ...options, target });
  if (existing) {
    return existing;
  }

  const providerRecord = await waitForInjectedXianProvider({ ...options, target });
  const wallet = walletFromRecord(providerRecord);
  if (wallet) {
    return wallet;
  }

  const timeoutMs = options?.timeoutMs ?? 0;
  if (timeoutMs <= 0) {
    return getInjectedWallet({ ...options, target });
  }

  const started = Date.now();
  return new Promise((resolve) => {
    const interval = setInterval(() => {
      const found = getInjectedWallet({ ...options, target });
      if (found || Date.now() - started >= timeoutMs) {
        clearInterval(interval);
        resolve(found);
      }
    }, 50);
  });
}

export function isWalletAvailable(options?: FindInjectedXianProviderOptions): boolean {
  return getInjectedWallet(options) != null;
}

async function requireWallet(
  options?: FindInjectedXianProviderOptions
): Promise<InjectedXianWallet> {
  const wallet = getInjectedWallet(options);
  if (!wallet) {
    throw new Error("Xian wallet not detected. Install the Xian browser wallet to continue.");
  }
  return wallet;
}

export async function connectWallet(
  options?: FindInjectedXianProviderOptions
): Promise<string[]> {
  return (await requireWallet(options)).connect();
}

export async function disconnectWallet(
  options?: FindInjectedXianProviderOptions
): Promise<unknown> {
  return (await requireWallet(options)).disconnect();
}

export async function getAccounts(
  options?: FindInjectedXianProviderOptions
): Promise<string[]> {
  return (await requireWallet(options)).getAccounts();
}

export async function getWalletInfo(
  options?: FindInjectedXianProviderOptions
): Promise<WalletInfo> {
  return (await requireWallet(options)).getWalletInfo();
}

export async function signMessage(
  message: string,
  options?: FindInjectedXianProviderOptions
): Promise<string> {
  return (await requireWallet(options)).signMessage(message);
}

export async function sendCall(
  intent: CallIntent,
  options?: SendCallOptions
): Promise<SendCallResult> {
  const wallet = options?.wallet ?? (await requireWallet({ target: options?.target }));
  return wallet.sendCall(intent, {
    mode: options?.mode,
    waitForTx: options?.waitForTx ?? true,
    timeoutMs: options?.timeoutMs ?? 30_000,
    pollIntervalMs: options?.pollIntervalMs
  }) as Promise<SendCallResult>;
}

/**
 * Transactions supply exactly their simulated chi. When the chain state
 * changes between the estimate and execution (a pool moved, a recipient
 * appeared), the transaction can run out of chi; the node reports
 * "Out of chi.".
 */
export const OUT_OF_CHI_MESSAGE =
  "Out of chi: the chain state changed since the estimate. Review the transaction and try again.";

/** The user-facing text for a failed transaction's message. */
export function txFailureText(message: string): string {
  return /out of chi/i.test(message) ? OUT_OF_CHI_MESSAGE : message;
}

// A call that stopped before execution, checked in this order: the node's
// message when it sent one, else the default text.
const UNSETTLED_DEFAULTS: readonly (readonly ["accepted" | "submitted" | "finalized", string])[] = [
  ["accepted", "Transaction was rejected by the node"],
  ["submitted", "Transaction was not submitted"],
  ["finalized", "Transaction was not finalized before the timeout"]
];

export function sendCallFailureMessage(result: SendCallResult): string | null {
  if (result.receipt?.success === false) {
    return txFailureText(String(result.receipt.message ?? result.message ?? "Transaction failed"));
  }
  const unsettled = UNSETTLED_DEFAULTS.find(([field]) => result[field] === false);
  if (unsettled) {
    return typeof result.message === "string" ? result.message : unsettled[1];
  }
  if (typeof result.error === "string" && result.error.trim()) {
    return result.error;
  }
  return null;
}

export function assertSendCallSucceeded(result: SendCallResult): void {
  const message = sendCallFailureMessage(result);
  if (message) {
    throw new Error(message);
  }
}

export function onAccountsChanged(
  cb: (accounts: string[]) => void,
  options?: FindInjectedXianProviderOptions
): () => void {
  const wallet = getInjectedWallet(options);
  if (!wallet) {
    return () => {};
  }
  const handler = (accounts: unknown) => cb(accounts as string[]);
  wallet.on("accountsChanged", handler);
  return () => wallet.removeListener("accountsChanged", handler);
}

export function onChainChanged(
  cb: (chainId: string) => void,
  options?: FindInjectedXianProviderOptions
): () => void {
  const wallet = getInjectedWallet(options);
  if (!wallet) {
    return () => {};
  }
  const handler = (chainId: unknown) => cb(chainId as string);
  wallet.on("chainChanged", handler);
  return () => wallet.removeListener("chainChanged", handler);
}

export function onInjectedWalletInitialized(
  cb: () => void,
  target?: XianInjectionTarget
): () => void {
  const resolvedTarget = resolveTarget(target);
  if (!resolvedTarget) {
    return () => {};
  }
  resolvedTarget.addEventListener(XIAN_INITIALIZED_EVENT, cb);
  return () => resolvedTarget.removeEventListener(XIAN_INITIALIZED_EVENT, cb);
}
