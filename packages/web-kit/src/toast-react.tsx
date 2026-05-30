import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode
} from "react";

export type ToastKind = "info" | "success" | "warning" | "error" | "pending";

export interface Toast {
  id: number;
  kind: ToastKind;
  title: string;
  message?: string;
  txHash?: string;
  autoDismissMs?: number;
}

export interface ToastContextValue {
  toasts: Toast[];
  push(toast: Omit<Toast, "id">): number;
  dismiss(id: number): void;
  update(id: number, patch: Partial<Toast>): void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

let nextToastId = 1;

function dismissDelayMs(toast: Pick<Toast, "kind" | "autoDismissMs">): number | null {
  if (toast.kind === "pending") {
    return null;
  }
  return toast.autoDismissMs ?? (toast.kind === "error" ? 8000 : 7000);
}

function scheduleDismiss(toast: Toast, dismiss: (id: number) => void): void {
  const delay = dismissDelayMs(toast);
  if (delay == null) {
    return;
  }
  setTimeout(() => dismiss(toast.id), delay);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const push = useCallback(
    (toast: Omit<Toast, "id">) => {
      const nextToast = { ...toast, id: nextToastId++ };
      setToasts((current) => [...current, nextToast]);
      scheduleDismiss(nextToast, dismiss);
      return nextToast.id;
    },
    [dismiss]
  );

  const update = useCallback(
    (id: number, patch: Partial<Toast>) => {
      let updatedToast: Toast | null = null;
      setToasts((current) =>
        current.map((toast) => {
          if (toast.id !== id) {
            return toast;
          }
          updatedToast = { ...toast, ...patch };
          return updatedToast;
        })
      );
      if (updatedToast && patch.kind && patch.kind !== "pending") {
        scheduleDismiss(updatedToast, dismiss);
      }
    },
    [dismiss]
  );

  const value = useMemo<ToastContextValue>(
    () => ({ toasts, push, dismiss, update }),
    [toasts, push, dismiss, update]
  );

  return <ToastContext.Provider value={value}>{children}</ToastContext.Provider>;
}

export function useToasts(): ToastContextValue {
  const value = useContext(ToastContext);
  if (!value) {
    throw new Error("useToasts must be used inside <ToastProvider>");
  }
  return value;
}
