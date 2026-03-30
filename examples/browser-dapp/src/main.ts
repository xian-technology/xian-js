import {
  Ed25519Signer,
  XianClient,
  type TransactionSubmission,
  type WatchSubscription,
  type XianSignedTransaction,
  type XianUnsignedTransaction
} from "@xian/client";
import {
  InjectedXianWallet,
  InMemoryXianProvider,
  registerInjectedXianProvider
} from "@xian/provider";

import "./style.css";

interface AppState {
  client: XianClient;
  signer?: Ed25519Signer;
  provider?: InMemoryXianProvider;
  wallet: InjectedXianWallet;
  address?: string;
  unsignedTx?: XianUnsignedTransaction;
  signedTx?: XianSignedTransaction;
  blockSub?: WatchSubscription;
  balanceSub?: WatchSubscription;
}

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) {
  throw new Error("expected #app root");
}

app.innerHTML = `
  <section class="hero">
    <p class="muted">xian-js example</p>
    <h1>Browser dApp Playground</h1>
    <p>
      This app uses <code>@xian/client</code> and <code>@xian/provider</code>
      directly. Point it at a reachable Xian RPC and dashboard endpoint, then
      read state, preview transactions, sign messages, and watch live updates.
    </p>
  </section>

  <section class="grid">
    <article class="card stack">
      <h2>1. Network & Signer</h2>
      <label>RPC URL
        <input id="rpc-url" value="http://127.0.0.1:26657" />
      </label>
      <label>Dashboard URL
        <input id="dashboard-url" value="http://127.0.0.1:8080" />
      </label>
      <label>Chain ID (optional)
        <input id="chain-id" placeholder="xian-local" />
      </label>
      <label>Private Key (optional)
        <input id="private-key" placeholder="leave blank to generate a dev signer" />
      </label>
      <div class="row">
        <button id="initialize">Initialize Client</button>
        <button id="connect-provider" class="secondary">Connect Provider</button>
        <button id="wallet-info" class="secondary">Wallet Info</button>
      </div>
      <div class="row">
        <button id="inject-wallet" class="secondary">Inject Demo Wallet</button>
        <button id="use-injected-wallet" class="secondary">Use Injected Wallet</button>
        <button id="watch-currency" class="secondary">Watch Currency</button>
      </div>
      <div class="status">
        <div><strong>Wallet:</strong> <span id="wallet-output" class="muted">none</span></div>
        <div><strong>Address:</strong> <span id="address" class="muted">not initialized</span></div>
        <div><strong>Chain:</strong> <span id="chain-output" class="muted">unknown</span></div>
      </div>
    </article>

    <article class="card stack">
      <h2>2. Read Calls</h2>
      <div class="row">
        <button id="read-chain">Get Chain ID</button>
        <button id="read-nonce">Get Nonce</button>
        <button id="read-balance">Get Balance</button>
      </div>
      <pre id="reads-output">No reads yet.</pre>
    </article>

    <article class="card stack">
      <h2>3. Message Signing</h2>
      <label>Message
        <input id="message" value="hello from xian-js" />
      </label>
      <button id="sign-message">Sign Message Through Provider</button>
      <pre id="message-output">No signature yet.</pre>
    </article>

    <article class="card stack">
      <h2>4. Transaction Builder</h2>
      <div class="row">
        <label>Contract
          <input id="tx-contract" value="currency" />
        </label>
        <label>Function
          <input id="tx-function" value="transfer" />
        </label>
      </div>
      <div class="row">
        <label>Stamps
          <input id="tx-stamps" value="50000" />
        </label>
        <label>Mode
          <select id="tx-mode">
            <option value="checktx">checktx</option>
            <option value="async">async</option>
            <option value="commit">commit</option>
          </select>
        </label>
      </div>
      <label>Kwargs JSON
        <textarea id="tx-kwargs">{"to":"bob","amount":"5"}</textarea>
      </label>
      <div class="row">
        <button id="build-tx">Prepare</button>
        <button id="sign-tx" class="secondary">Sign</button>
        <button id="send-tx">Send Prepared</button>
        <button id="send-call" class="secondary">Quick Send</button>
      </div>
      <pre id="tx-output">No transaction built yet.</pre>
    </article>

    <article class="card stack">
      <h2>5. Live Subscriptions</h2>
      <div class="row">
        <button id="watch-blocks">Watch Blocks</button>
        <button id="watch-balance" class="secondary">Watch Balance</button>
        <button id="clear-watchers" class="secondary">Clear Watchers</button>
      </div>
      <p class="muted">
        Balance subscriptions watch <code>currency.balances:&lt;your address&gt;</code>
        over the dashboard websocket.
      </p>
    </article>

    <article class="card stack">
      <h2>Activity Log</h2>
      <pre id="log-output" class="log">Ready.</pre>
    </article>
  </section>
`;

let state: AppState | null = null;
const observedProviders = new WeakSet<object>();

const rpcUrlInput = query<HTMLInputElement>("#rpc-url");
const dashboardUrlInput = query<HTMLInputElement>("#dashboard-url");
const chainIdInput = query<HTMLInputElement>("#chain-id");
const privateKeyInput = query<HTMLInputElement>("#private-key");
const messageInput = query<HTMLInputElement>("#message");
const txContractInput = query<HTMLInputElement>("#tx-contract");
const txFunctionInput = query<HTMLInputElement>("#tx-function");
const txStampsInput = query<HTMLInputElement>("#tx-stamps");
const txModeSelect = query<HTMLSelectElement>("#tx-mode");
const txKwargsInput = query<HTMLTextAreaElement>("#tx-kwargs");
const addressOutput = query<HTMLElement>("#address");
const chainOutput = query<HTMLElement>("#chain-output");
const readsOutput = query<HTMLElement>("#reads-output");
const messageOutput = query<HTMLElement>("#message-output");
const txOutput = query<HTMLElement>("#tx-output");
const logOutput = query<HTMLElement>("#log-output");
const walletOutput = query<HTMLElement>("#wallet-output");

query<HTMLButtonElement>("#initialize").addEventListener("click", async () => {
  try {
    clearWatchers();
    const signer = new Ed25519Signer(privateKeyInput.value.trim() || undefined);
    privateKeyInput.value = signer.privateKey;

    const client = new XianClient({
      rpcUrl: rpcUrlInput.value.trim(),
      dashboardUrl: dashboardUrlInput.value.trim() || undefined,
      chainId: chainIdInput.value.trim() || undefined
    });
    const provider = new InMemoryXianProvider({
      signer,
      client,
      chainId: chainIdInput.value.trim() || undefined
    });
    const wallet = new InjectedXianWallet(provider, {
      id: "xian-js-demo",
      name: "Xian JS Demo Wallet",
      rdns: "local.xian-js.demo"
    });

    attachWalletListeners(wallet);

    state = {
      client,
      signer,
      provider,
      wallet,
      address: signer.address
    };
    walletOutput.textContent = wallet.metadata?.name ?? "demo wallet";
    addressOutput.textContent = signer.address;
    chainOutput.textContent = chainIdInput.value.trim() || "lazy";
    readsOutput.textContent = "Client initialized.";
    messageOutput.textContent = "No signature yet.";
    txOutput.textContent = "No transaction built yet.";
    appendLog("initialized client and demo wallet");
  } catch (error) {
    appendLog(formatError(error));
  }
});

query<HTMLButtonElement>("#connect-provider").addEventListener("click", async () => {
  try {
    const current = ensureState();
    const accounts = await current.wallet.connect();
    current.address = accounts[0];
    addressOutput.textContent = current.address ?? "none";
    chainOutput.textContent = await current.wallet.getChainId();
    appendLog(`provider connected ${JSON.stringify(accounts)}`);
  } catch (error) {
    appendLog(formatError(error));
  }
});

query<HTMLButtonElement>("#wallet-info").addEventListener("click", async () => {
  try {
    const current = ensureState();
    const walletInfo = await current.wallet.getWalletInfo();
    readsOutput.textContent = JSON.stringify(walletInfo, null, 2);
    appendLog("read wallet info");
  } catch (error) {
    appendLog(formatError(error));
  }
});

query<HTMLButtonElement>("#inject-wallet").addEventListener("click", () => {
  try {
    const current = ensureState();
    if (!current.provider) {
      throw new Error("initialize the demo wallet first");
    }
    const record = registerInjectedXianProvider({
      provider: current.provider,
      metadata: {
        id: "xian-js-demo",
        name: "Xian JS Demo Wallet",
        rdns: "local.xian-js.demo"
      }
    });
    appendLog(`injected wallet ${record.metadata.name} into window`);
  } catch (error) {
    appendLog(formatError(error));
  }
});

query<HTMLButtonElement>("#watch-currency").addEventListener("click", async () => {
  try {
    const current = ensureState();
    const accepted = await current.wallet.watchAsset({
      type: "token",
      options: {
        contract: "currency",
        symbol: "XIAN",
        name: "Xian"
      }
    });
    appendLog(
      accepted
        ? "wallet accepted currency asset watch request"
        : "wallet rejected currency asset watch request"
    );
  } catch (error) {
    appendLog(formatError(error));
  }
});

query<HTMLButtonElement>("#use-injected-wallet").addEventListener("click", async () => {
  try {
    const current = ensureState();
    const injected = InjectedXianWallet.getInjected();
    if (!injected) {
      throw new Error("no injected Xian wallet found on window");
    }
    attachWalletListeners(injected);
    current.wallet = injected;
    const accounts = await injected.connect();
    current.address = accounts[0];
    walletOutput.textContent = injected.metadata?.name ?? "injected wallet";
    addressOutput.textContent = current.address ?? "none";
    chainOutput.textContent = await injected.getChainId();
    appendLog(`using injected wallet ${injected.metadata?.name ?? "unknown"}`);
  } catch (error) {
    appendLog(formatError(error));
  }
});

query<HTMLButtonElement>("#read-chain").addEventListener("click", async () => {
  try {
    const current = ensureState();
    const chainId = await current.client.getChainId();
    chainOutput.textContent = chainId;
    readsOutput.textContent = JSON.stringify({ chainId }, null, 2);
    appendLog(`chain id ${chainId}`);
  } catch (error) {
    appendLog(formatError(error));
  }
});

query<HTMLButtonElement>("#read-nonce").addEventListener("click", async () => {
  try {
    const current = ensureState();
    const address = await ensureAddress(current);
    const nonce = await current.client.getNonce(address);
    readsOutput.textContent = JSON.stringify({ nonce }, null, 2);
    appendLog(`nonce ${String(nonce)}`);
  } catch (error) {
    appendLog(formatError(error));
  }
});

query<HTMLButtonElement>("#read-balance").addEventListener("click", async () => {
  try {
    const current = ensureState();
    const address = await ensureAddress(current);
    const balance = await current.client.getBalance(address);
    readsOutput.textContent = JSON.stringify({ balance }, null, 2);
    appendLog(`balance ${JSON.stringify(balance)}`);
  } catch (error) {
    appendLog(formatError(error));
  }
});

query<HTMLButtonElement>("#sign-message").addEventListener("click", async () => {
  try {
    const current = ensureState();
    const signature = await current.wallet.signMessage(messageInput.value);
    messageOutput.textContent = JSON.stringify({ signature }, null, 2);
    appendLog("signed message through provider");
  } catch (error) {
    appendLog(formatError(error));
  }
});

query<HTMLButtonElement>("#build-tx").addEventListener("click", async () => {
  try {
    const current = ensureState();
    const kwargs = JSON.parse(txKwargsInput.value) as Record<string, unknown>;
    const parsedStamps = Number.parseInt(txStampsInput.value, 10);
    current.unsignedTx = await current.wallet.prepareTransaction({
      contract: txContractInput.value.trim(),
      function: txFunctionInput.value.trim(),
      kwargs,
      stamps: Number.isNaN(parsedStamps) ? undefined : parsedStamps
    });
    current.signedTx = undefined;
    txOutput.textContent = JSON.stringify(current.unsignedTx, null, 2);
    appendLog("prepared unsigned transaction through wallet");
  } catch (error) {
    appendLog(formatError(error));
  }
});

query<HTMLButtonElement>("#sign-tx").addEventListener("click", async () => {
  try {
    const current = ensureState();
    if (!current.unsignedTx) {
      throw new Error("build a transaction first");
    }
    current.signedTx = await current.wallet.signTransaction(current.unsignedTx);
    txOutput.textContent = JSON.stringify(current.signedTx, null, 2);
    appendLog("signed transaction");
  } catch (error) {
    appendLog(formatError(error));
  }
});

query<HTMLButtonElement>("#send-tx").addEventListener("click", async () => {
  try {
    const current = ensureState();
    if (!current.unsignedTx) {
      throw new Error("build a transaction first");
    }
    const submission = (await current.wallet.sendTransaction(
      current.unsignedTx,
      {
        mode: txModeSelect.value as "async" | "checktx" | "commit",
        waitForTx: txModeSelect.value !== "async"
      }
    )) as TransactionSubmission;
    txOutput.textContent = JSON.stringify(submission, null, 2);
    appendLog(`sent transaction ${submission.txHash ?? "(no hash)"}`);
  } catch (error) {
    appendLog(formatError(error));
  }
});

query<HTMLButtonElement>("#send-call").addEventListener("click", async () => {
  try {
    const current = ensureState();
    const kwargs = JSON.parse(txKwargsInput.value) as Record<string, unknown>;
    const parsedStamps = Number.parseInt(txStampsInput.value, 10);
    const submission = await current.wallet.sendCall(
      {
        contract: txContractInput.value.trim(),
        function: txFunctionInput.value.trim(),
        kwargs,
        stamps: Number.isNaN(parsedStamps) ? undefined : parsedStamps
      },
      {
        mode: txModeSelect.value as "async" | "checktx" | "commit",
        waitForTx: txModeSelect.value !== "async"
      }
    );
    txOutput.textContent = JSON.stringify(submission, null, 2);
    appendLog(`sent intent-based call ${submission.txHash ?? "(no hash)"}`);
  } catch (error) {
    appendLog(formatError(error));
  }
});

query<HTMLButtonElement>("#watch-blocks").addEventListener("click", () => {
  try {
    const current = ensureState();
    current.blockSub?.unsubscribe();
    current.blockSub = current.client.watch.blocks((message) => {
      appendLog(`block ${String(message.height ?? "?")} ${String(message.hash ?? "")}`);
    });
    appendLog("watching new_block stream");
  } catch (error) {
    appendLog(formatError(error));
  }
});

query<HTMLButtonElement>("#watch-balance").addEventListener("click", async () => {
  try {
    const current = ensureState();
    const address = await ensureAddress(current);
    current.balanceSub?.unsubscribe();
    current.balanceSub = current.client.watch.state(
      `currency.balances:${address}`,
      (message) => {
        appendLog(`balance update ${message.key} => ${JSON.stringify(message.value)}`);
      }
    );
    appendLog("watching balance state");
  } catch (error) {
    appendLog(formatError(error));
  }
});

query<HTMLButtonElement>("#clear-watchers").addEventListener("click", () => {
  clearWatchers();
  appendLog("cleared subscriptions");
});

function ensureState(): AppState {
  if (!state) {
    throw new Error("initialize the client first");
  }
  return state;
}

async function ensureAddress(current: AppState): Promise<string> {
  if (current.address) {
    return current.address;
  }
  const [account] = await current.wallet.connect();
  current.address = account;
  addressOutput.textContent = account ?? "none";
  return account ?? "";
}

function clearWatchers(): void {
  void state?.blockSub?.unsubscribe();
  void state?.balanceSub?.unsubscribe();
  if (state) {
    state.blockSub = undefined;
    state.balanceSub = undefined;
  }
}

function attachWalletListeners(wallet: InjectedXianWallet): void {
  const providerRef = wallet.provider as object;
  if (observedProviders.has(providerRef)) {
    return;
  }
  observedProviders.add(providerRef);

  wallet.on("connect", (event) =>
    appendLog(`provider connect ${JSON.stringify(event)}`)
  );
  wallet.on("disconnect", (event) =>
    appendLog(`provider disconnect ${JSON.stringify(event)}`)
  );
  wallet.on("accountsChanged", (accounts) => {
    appendLog(`accountsChanged ${JSON.stringify(accounts)}`);
    if (state) {
      state.address = Array.isArray(accounts) ? (accounts[0] as string | undefined) : undefined;
      addressOutput.textContent = state.address ?? "none";
    }
  });
  wallet.on("chainChanged", (chainId) => {
    appendLog(`chainChanged ${String(chainId)}`);
    chainOutput.textContent = String(chainId);
  });
}

function query<TElement extends Element>(selector: string): TElement {
  const element = app?.querySelector<TElement>(selector);
  if (!element) {
    throw new Error(`missing element ${selector}`);
  }
  return element;
}

function appendLog(message: string): void {
  const prefix = new Date().toLocaleTimeString();
  logOutput.textContent = `${prefix} ${message}\n${logOutput.textContent}`;
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`;
  }
  return `Error: ${String(error)}`;
}
