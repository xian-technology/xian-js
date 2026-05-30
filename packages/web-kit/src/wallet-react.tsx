import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from "react";
import type { InjectedXianWallet, XianInjectionTarget } from "@xian-tech/provider";

import {
  getAccounts,
  getInjectedWallet,
  getWalletInfo,
  isWalletAvailable,
  onAccountsChanged,
  onChainChanged,
  onInjectedWalletInitialized,
  waitForInjectedWallet,
  type WalletInfo
} from "./wallet.js";

export type WalletStatus = "idle" | "missing" | "connected" | "error";

export interface WalletState {
  wallet: InjectedXianWallet | null;
  available: boolean;
  account: string | null;
  chainId: string | null;
  info: WalletInfo | null;
  connecting: boolean;
  error: string | null;
  status: WalletStatus;
}

export interface WalletContextValue extends WalletState {
  connect: () => Promise<string | null>;
  refresh: () => Promise<void>;
}

export interface UseXianWalletOptions {
  target?: XianInjectionTarget;
  injectionTimeoutMs?: number;
}

function initialWalletState(target?: XianInjectionTarget): WalletState {
  return {
    wallet: getInjectedWallet({ target }) ?? null,
    available: isWalletAvailable({ target }),
    account: null,
    chainId: null,
    info: null,
    connecting: false,
    error: null,
    status: "idle"
  };
}

export function useXianWallet(
  options?: UseXianWalletOptions
): WalletContextValue {
  const [state, setState] = useState<WalletState>(() =>
    initialWalletState(options?.target)
  );
  const connectInFlight = useRef<Promise<string | null> | null>(null);

  const refresh = useCallback(async () => {
    const wallet = getInjectedWallet({ target: options?.target });
    if (!wallet) {
      setState((current) => ({
        ...current,
        wallet: null,
        available: false,
        account: null,
        info: null,
        connecting: false,
        status: "missing"
      }));
      return;
    }

    try {
      const info = await getWalletInfo({ target: options?.target });
      const account = info.selectedAccount ?? info.accounts[0] ?? null;
      setState((current) => ({
        ...current,
        wallet,
        available: true,
        connecting: false,
        info,
        account,
        chainId: info.chainId ?? current.chainId,
        error: null,
        status: account ? "connected" : "idle"
      }));
    } catch {
      try {
        const accounts = await getAccounts({ target: options?.target });
        setState((current) => ({
          ...current,
          wallet,
          available: true,
          connecting: false,
          account: accounts[0] ?? null,
          error: null,
          status: accounts[0] ? "connected" : "idle"
        }));
      } catch {
        setState((current) => ({
          ...current,
          wallet,
          available: true,
          connecting: false
        }));
      }
    }
  }, [options?.target]);

  const connect = useCallback(async () => {
    if (connectInFlight.current) {
      return connectInFlight.current;
    }

    setState((current) => ({ ...current, connecting: true, error: null }));
    const pending = (async () => {
      try {
        const wallet = await waitForInjectedWallet({
          target: options?.target,
          timeoutMs: options?.injectionTimeoutMs ?? 800
        });
        if (!wallet) {
          setState((current) => ({
            ...current,
            wallet: null,
            available: false,
            connecting: false,
            status: "missing",
            error: "No injected Xian wallet found"
          }));
          return null;
        }

        const accounts = await wallet.connect();
        const account = accounts[0] ?? null;
        const chainId = await wallet.getChainId().catch(() => null);
        setState((current) => ({
          ...current,
          wallet,
          available: true,
          connecting: false,
          account,
          chainId: chainId ?? current.chainId,
          error: null,
          status: account ? "connected" : "idle"
        }));
        void refresh();
        return account;
      } catch (error) {
        setState((current) => ({
          ...current,
          connecting: false,
          status: "error",
          error: error instanceof Error ? error.message : "Failed to connect"
        }));
        return null;
      } finally {
        connectInFlight.current = null;
      }
    })();

    connectInFlight.current = pending;
    return pending;
  }, [options?.injectionTimeoutMs, options?.target, refresh]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const detect = () => {
      if (isWalletAvailable({ target: options?.target })) {
        setState((current) => ({ ...current, available: true }));
        void refresh();
        window.clearInterval(timer);
      }
    };

    const timer = window.setInterval(detect, 600);
    const stopInitialized = onInjectedWalletInitialized(detect, options?.target);
    detect();

    return () => {
      window.clearInterval(timer);
      stopInitialized();
    };
  }, [options?.target, refresh]);

  useEffect(() => {
    if (!state.wallet) {
      return;
    }

    const stopAccounts = onAccountsChanged((accounts) => {
      setState((current) => ({
        ...current,
        account: accounts[0] ?? null,
        status: accounts[0] ? "connected" : "idle"
      }));
      void refresh();
    }, { target: options?.target });

    const stopChain = onChainChanged((chainId) => {
      setState((current) => ({ ...current, chainId }));
    }, { target: options?.target });

    return () => {
      stopAccounts();
      stopChain();
    };
  }, [options?.target, refresh, state.wallet]);

  return useMemo<WalletContextValue>(
    () => ({ ...state, connect, refresh }),
    [state, connect, refresh]
  );
}

const WalletContext = createContext<WalletContextValue | null>(null);

export function WalletProvider({
  children,
  target,
  injectionTimeoutMs
}: {
  children: ReactNode;
} & UseXianWalletOptions) {
  const value = useXianWallet({ target, injectionTimeoutMs });
  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet(): WalletContextValue {
  const value = useContext(WalletContext);
  if (!value) {
    throw new Error("useWallet must be used inside <WalletProvider>");
  }
  return value;
}
