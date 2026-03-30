import { TransportError } from "./errors";
import type {
  WatchSubscription,
  XianBlockMessage,
  XianContractEventMessage,
  XianStateChangeMessage,
  XianWatchEventFilter,
  XianWebSocketFactory,
  XianWebSocketLike
} from "./types";

interface WatchApiOptions {
  dashboardUrl?: string;
  webSocketFactory?: XianWebSocketFactory;
}

interface ManagedSubscriptionOptions<TMessage> {
  url: string;
  webSocketFactory: XianWebSocketFactory;
  subscribeMessage?: Record<string, unknown>;
  shouldHandle(message: unknown): message is TMessage;
  onMessage(message: TMessage): void;
}

function ensureWebSocketFactory(factory?: XianWebSocketFactory): XianWebSocketFactory {
  if (factory) {
    return factory;
  }
  if (typeof WebSocket === "function") {
    return (url: string) => new WebSocket(url);
  }
  throw new TransportError("global WebSocket is not available");
}

async function coerceSocketMessage(data: unknown): Promise<string> {
  if (typeof data === "string") {
    return data;
  }
  if (data instanceof ArrayBuffer) {
    return new TextDecoder().decode(new Uint8Array(data));
  }
  if (data instanceof Uint8Array) {
    return new TextDecoder().decode(data);
  }
  if (typeof Blob !== "undefined" && data instanceof Blob) {
    return await data.text();
  }
  throw new TransportError("unsupported websocket message payload");
}

class ManagedSubscription<TMessage> implements WatchSubscription {
  private socket: XianWebSocketLike | null = null;
  private closed = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly options: ManagedSubscriptionOptions<TMessage>) {
    this.connect();
  }

  private connect(): void {
    if (this.closed) {
      return;
    }

    this.socket = this.options.webSocketFactory(this.options.url);
    this.socket.onopen = () => {
      if (this.options.subscribeMessage) {
        this.socket?.send(JSON.stringify(this.options.subscribeMessage));
      }
    };
    this.socket.onerror = () => {};
    this.socket.onclose = () => {
      if (this.closed) {
        return;
      }
      this.reconnectTimer = setTimeout(() => this.connect(), 500);
    };
    this.socket.onmessage = (event) => {
      void this.handleMessage(event.data);
    };
  }

  private async handleMessage(rawData: unknown): Promise<void> {
    const text = await coerceSocketMessage(rawData);
    const parsed = JSON.parse(text) as unknown;
    if (this.options.shouldHandle(parsed)) {
      this.options.onMessage(parsed);
    }
  }

  async unsubscribe(): Promise<void> {
    this.closed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.socket?.close(1000, "unsubscribed");
    this.socket = null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isBlockMessage(value: unknown): value is XianBlockMessage {
  return isRecord(value) && value.type === "new_block";
}

function isStateChangeMessage(value: unknown): value is XianStateChangeMessage {
  return isRecord(value) && value.type === "state_change" && typeof value.key === "string";
}

function isContractEventMessage(value: unknown): value is XianContractEventMessage {
  return (
    isRecord(value) &&
    value.type === "contract_event" &&
    typeof value.contract === "string" &&
    typeof value.event === "string"
  );
}

export class WatchApi {
  private readonly webSocketFactory: XianWebSocketFactory;

  constructor(private readonly options: WatchApiOptions) {
    this.webSocketFactory = ensureWebSocketFactory(options.webSocketFactory);
  }

  private socketUrl(): string {
    if (!this.options.dashboardUrl) {
      throw new TransportError("dashboardUrl is required for websocket subscriptions");
    }
    return `${this.options.dashboardUrl.replace(/\/+$/, "")}/ws`;
  }

  blocks(listener: (message: XianBlockMessage) => void): WatchSubscription {
    return new ManagedSubscription({
      url: this.socketUrl(),
      webSocketFactory: this.webSocketFactory,
      shouldHandle: isBlockMessage,
      onMessage: listener
    });
  }

  state(key: string, listener: (message: XianStateChangeMessage) => void): WatchSubscription {
    return new ManagedSubscription({
      url: this.socketUrl(),
      webSocketFactory: this.webSocketFactory,
      subscribeMessage: {
        action: "subscribe",
        type: "state",
        key
      },
      shouldHandle: isStateChangeMessage,
      onMessage: listener
    });
  }

  events(filter: XianWatchEventFilter, listener: (message: XianContractEventMessage) => void): WatchSubscription {
    return new ManagedSubscription({
      url: this.socketUrl(),
      webSocketFactory: this.webSocketFactory,
      subscribeMessage: {
        action: "subscribe",
        type: "event",
        contract: filter.contract,
        ...(filter.event ? { event: filter.event } : {})
      },
      shouldHandle: isContractEventMessage,
      onMessage: listener
    });
  }
}
