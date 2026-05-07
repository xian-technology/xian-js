import {
  ProviderChainMismatchError,
  ProviderDisconnectedError,
  ProviderUnauthorizedError
} from "./errors";
import type {
  XianProvider,
  XianProviderRequest,
  XianWalletCapabilities,
  XianWalletDescriptor,
  XianWalletInfo
} from "./provider";
import {
  XIAN_WALLETCONNECT_METHODS,
  xianAccountFromCaip10,
  xianChainIdToCaip2
} from "./permissions";

type Listener = (...args: unknown[]) => void;

export interface WalletConnectRequestClient {
  request(args: {
    topic: string;
    chainId: string;
    request: XianProviderRequest;
  }): Promise<unknown>;
}

export interface WalletConnectXianProviderOptions {
  client: WalletConnectRequestClient;
  topic: string;
  chainId: string;
  accounts?: string[];
  wallet?: XianWalletDescriptor;
}

class EventEmitter {
  private readonly listeners = new Map<string, Set<Listener>>();

  on(event: string, listener: Listener): void {
    const listeners = this.listeners.get(event) ?? new Set<Listener>();
    listeners.add(listener);
    this.listeners.set(event, listeners);
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

function normalizeAccounts(accounts: string[] | undefined): string[] {
  return [...new Set((accounts ?? []).map((account) => account.trim()).filter(Boolean))];
}

function capabilities(): XianWalletCapabilities {
  return {
    getWalletInfo: true,
    prepareTransaction: true,
    signMessage: true,
    signTransaction: true,
    sendTransaction: true,
    sendCall: true,
    switchChain: false,
    watchAsset: true
  };
}

function methodCanUseRemoteWallet(method: string): boolean {
  return (XIAN_WALLETCONNECT_METHODS as readonly string[]).includes(method);
}

export class WalletConnectXianProvider implements XianProvider {
  private readonly events = new EventEmitter();
  private chainId: string;
  private accounts: string[];
  private connected = true;

  constructor(private readonly options: WalletConnectXianProviderOptions) {
    this.chainId = options.chainId;
    this.accounts = normalizeAccounts(options.accounts);
  }

  on(event: string, listener: Listener): void {
    this.events.on(event, listener);
  }

  removeListener(event: string, listener: Listener): void {
    this.events.removeListener(event, listener);
  }

  setSessionState(input: { chainId?: string; accounts?: string[] }): void {
    if (input.chainId && input.chainId !== this.chainId) {
      this.chainId = input.chainId;
      this.events.emit("chainChanged", this.chainId);
    }
    if (input.accounts) {
      const nextAccounts = normalizeAccounts(input.accounts);
      if (nextAccounts.join("\n") !== this.accounts.join("\n")) {
        this.accounts = nextAccounts;
        this.events.emit("accountsChanged", [...this.accounts]);
      }
    }
  }

  handleSessionEvent(event: string, args: unknown[]): void {
    switch (event) {
      case "accountsChanged": {
        const [accounts] = args;
        if (Array.isArray(accounts)) {
          this.setSessionState({
            accounts: accounts.filter(
              (account): account is string => typeof account === "string"
            )
          });
        }
        break;
      }
      case "chainChanged": {
        const [chainId] = args;
        if (typeof chainId === "string") {
          this.setSessionState({ chainId });
        }
        break;
      }
      case "disconnect":
        this.disconnect();
        break;
      default:
        this.events.emit(event, ...args);
    }
  }

  setAccountsFromCaip10(accounts: string[]): void {
    const parsed = accounts
      .map(xianAccountFromCaip10)
      .filter((entry): entry is { chainId: string; account: string } => entry != null);
    const active = parsed.filter((entry) => entry.chainId === this.chainId);
    this.setSessionState({
      accounts: active.map((entry) => entry.account)
    });
  }

  disconnect(): null {
    if (this.connected) {
      this.connected = false;
      this.accounts = [];
      this.events.emit("accountsChanged", []);
      this.events.emit("disconnect", {
        code: 4900,
        message: "WalletConnect session disconnected"
      });
    }
    return null;
  }

  private requireConnected(): void {
    if (!this.connected) {
      throw new ProviderDisconnectedError("WalletConnect session is disconnected");
    }
  }

  private async remoteRequest(request: XianProviderRequest): Promise<unknown> {
    this.requireConnected();
    if (!methodCanUseRemoteWallet(request.method)) {
      throw new ProviderUnauthorizedError(`method cannot be sent over WalletConnect: ${request.method}`);
    }
    return this.options.client.request({
      topic: this.options.topic,
      chainId: xianChainIdToCaip2(this.chainId),
      request
    });
  }

  private walletInfo(): XianWalletInfo {
    return {
      accounts: this.connected ? [...this.accounts] : [],
      selectedAccount: this.connected ? this.accounts[0] : undefined,
      chainId: this.chainId,
      connected: this.connected,
      locked: false,
      wallet: this.options.wallet,
      capabilities: capabilities()
    };
  }

  async request(args: XianProviderRequest): Promise<unknown> {
    switch (args.method) {
      case "xian_getWalletInfo":
        return this.walletInfo();

      case "xian_accounts":
        return this.connected ? [...this.accounts] : [];

      case "xian_chainId":
        this.requireConnected();
        return this.chainId;

      case "xian_disconnect":
        return this.disconnect();

      case "xian_switchChain": {
        throw new ProviderChainMismatchError(
          "WalletConnect sessions cannot switch to chains that were not approved by the wallet"
        );
      }

      case "xian_connect":
      case "xian_requestAccounts": {
        const result = await this.remoteRequest({
          method: "xian_requestAccounts",
          params: args.params
        });
        if (Array.isArray(result)) {
          this.setSessionState({
            accounts: result.filter(
              (account): account is string => typeof account === "string"
            )
          });
        }
        if (this.accounts.length === 0) {
          throw new ProviderUnauthorizedError("wallet did not return an account");
        }
        return [...this.accounts];
      }

      default:
        return this.remoteRequest(args);
    }
  }
}
