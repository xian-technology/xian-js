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
  const storage = options.storage ?? defaultStorage();
  const createClient = options.createClient;

  let cached: { url: string; client: TClient } | null = null;
  let epoch = 0;
  const subscribers = new Set<(epoch: number) => void>();

  function getRpcUrl(): string {
    if (!options.storageKey) {
      return options.defaultRpcUrl;
    }
    return storage?.getItem(options.storageKey) ?? options.defaultRpcUrl;
  }

  function setRpcUrl(url: string): void {
    const cleaned = cleanRpcUrl(url);
    if (cleaned === getRpcUrl()) {
      return;
    }
    if (options.storageKey) {
      storage?.setItem(options.storageKey, cleaned);
    }
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

  async function pingRpc(url: string, timeoutMs = 4000): Promise<boolean> {
    try {
      const response = await (options.fetchFn ?? fetch)(`${cleanRpcUrl(url)}/status`, {
        signal: AbortSignal.timeout(timeoutMs)
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  return {
    getRpcUrl,
    setRpcUrl,
    getRpcEpoch,
    subscribeRpcEpoch,
    getClient,
    pingRpc
  };
}
