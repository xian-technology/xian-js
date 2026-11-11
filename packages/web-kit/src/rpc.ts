export interface RpcStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface RpcClientStoreOptions<TClient> {
  defaultRpcUrl: string;
  storageKey?: string;
  storage?: RpcStorage;
  createClient: (url: string) => TClient;
  fetchFn?: typeof fetch;
}

export interface RpcClientStore<TClient> {
  getRpcUrl(): string;
  setRpcUrl(url: string): void;
  getRpcEpoch(): number;
  subscribeRpcEpoch(cb: (epoch: number) => void): () => void;
  getClient(): TClient;
  pingRpc(url: string, timeoutMs?: number): Promise<boolean>;
}

function defaultStorage(): RpcStorage | undefined {
  if (typeof localStorage === "undefined") {
    return undefined;
  }
  return localStorage;
}

function cleanRpcUrl(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

export function createXianRpcStore<TClient>(
  options: RpcClientStoreOptions<TClient>
): RpcClientStore<TClient> {
  const storage = options.storage ?? (options.storageKey ? defaultStorage() : undefined);
  const createClient = options.createClient;

  let currentRpcUrl = options.defaultRpcUrl;
  let cached: { url: string; client: TClient } | null = null;
  let epoch = 0;
  const subscribers = new Set<(epoch: number) => void>();

  function getRpcUrl(): string {
    return readRpcUrl(storage, options.storageKey, currentRpcUrl);
  }

  function setRpcUrl(url: string): void {
    const cleaned = cleanRpcUrl(url);
    if (cleaned === getRpcUrl()) {
      return;
    }
    if (options.storageKey) {
      storage?.setItem(options.storageKey, cleaned);
    }
    currentRpcUrl = cleaned;
    cached = null;
    epoch += 1;
    for (const cb of subscribers) {
      cb(epoch);
    }
  }

  function getRpcEpoch(): number {
    return epoch;
  }

  function subscribeRpcEpoch(cb: (epoch: number) => void): () => void {
    subscribers.add(cb);
    return () => {
      subscribers.delete(cb);
    };
  }

  function getClient(): TClient {
    const url = getRpcUrl();
    if (!cached || cached.url !== url) {
      cached = { url, client: createClient(url) };
    }
    return cached.client;
  }

  return {
    getRpcUrl,
    setRpcUrl,
    getRpcEpoch,
    subscribeRpcEpoch,
    getClient,
    pingRpc: (url, timeoutMs = 4000) => pingRpc(url, timeoutMs, options.fetchFn)
  };
}

function readRpcUrl(storage: RpcStorage | undefined, key: string | undefined, fallback: string): string {
  return key ? storage?.getItem(key) ?? fallback : fallback;
}

async function pingRpc(url: string, timeoutMs: number, fetchFn?: typeof fetch): Promise<boolean> {
  try {
    const response = await (fetchFn ?? fetch)(`${cleanRpcUrl(url)}/status`, {
      signal: AbortSignal.timeout(timeoutMs)
    });
    return response.ok;
  } catch {
    return false;
  }
}
