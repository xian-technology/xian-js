import { asRecord } from "./rpc-response.js";
import { TransportError } from "./errors.js";

/**
 * Combine a caller-provided AbortSignal with a timeout-backed internal
 * signal so either one triggering aborts the underlying fetch. We prefer
 * AbortSignal.any when available; on older runtimes we stitch them
 * together manually.
 */
export function mergeAbortSignals(
  a: AbortSignal | undefined,
  b: AbortSignal | undefined
): AbortSignal | undefined {
  return combineAbortSignals(a, b).signal;
}

interface CombinedSignal {
  signal?: AbortSignal;
  cleanup?(): void;
}

function combineAbortSignals(a: AbortSignal | undefined, b: AbortSignal | undefined): CombinedSignal {
  if (!a) return { signal: b };
  if (!b) return { signal: a };
  const anyFn = (AbortSignal as unknown as {
    any?: (signals: AbortSignal[]) => AbortSignal;
  }).any;
  return typeof anyFn === "function"
    ? { signal: anyFn([a, b]) }
    : fallbackAbortSignals(a, b);
}

function fallbackAbortSignals(a: AbortSignal, b: AbortSignal): CombinedSignal {
  const controller = new AbortController();
  const cleanup = () => {
    a.removeEventListener("abort", abort);
    b.removeEventListener("abort", abort);
  };
  const abort = () => {
    controller.abort(a.aborted ? a.reason : b.reason);
    cleanup();
  };
  if (a.aborted || b.aborted) {
    abort();
  } else {
    a.addEventListener("abort", abort);
    b.addEventListener("abort", abort);
  }
  return { signal: controller.signal, cleanup };
}

interface RequestDeadlineOptions {
  timeoutMs: number;
  signal?: AbortSignal;
  url: string;
  label: string;
}

/** Keep the HTTP deadline active through response-body consumption. */
export async function withRequestDeadline<T>(
  operation: (signal: AbortSignal | undefined) => Promise<T>,
  options: RequestDeadlineOptions
): Promise<T> {
  const controller = options.timeoutMs > 0 ? new AbortController() : undefined;
  const combined = combineAbortSignals(options.signal, controller?.signal);
  const timer = controller
    ? setTimeout(() => controller.abort(), options.timeoutMs)
    : undefined;
  try {
    return await operation(combined.signal);
  } catch (error) {
    if (deadlineExpired(options.signal, controller?.signal)) {
      throw new TransportError(
        `${options.label} timed out after ${options.timeoutMs}ms for ${options.url}`,
        { cause: error }
      );
    }
    throw error;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    combined.cleanup?.();
  }
}

function deadlineExpired(caller: AbortSignal | undefined, timer: AbortSignal | undefined): boolean {
  return !caller?.aborted && Boolean(timer?.aborted);
}

export async function fetchResponse(
  fetchFn: typeof fetch, url: string, init: RequestInit
): Promise<Response> {
  try {
    return await fetchFn(url, init);
  } catch (error) {
    if (init.signal?.aborted) throw error;
    throw new TransportError(`request failed for ${url}`, { cause: error });
  }
}

export async function readJsonResponse(
  response: Response, url: string, signal: AbortSignal | undefined
): Promise<Record<string, unknown>> {
  try {
    return asRecord(await response.json());
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new TransportError(`invalid JSON response from ${url}`, { cause: error });
  }
}
