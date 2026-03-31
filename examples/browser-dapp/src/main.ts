import {
  Ed25519Signer,
  XianClient,
  type TransactionSubmission,
  type WatchSubscription,
  type XianSignedTransaction,
  type XianUnsignedTransaction
} from "@xian-tech/client";
import {
  InjectedXianWallet,
  InMemoryXianProvider,
  registerInjectedXianProvider
} from "@xian-tech/provider";

import "./style.css";

/* ── Types ─────────────────────────────────────────────────── */

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

/* ── Mount ─────────────────────────────────────────────────── */

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) {
  throw new Error("expected #app root");
}

app.innerHTML = `
  <section class="hero">
    <div class="hero-label">xian-js example</div>
    <h1>dApp Playground</h1>
    <p>
      Test <code>@xian-tech/client</code> and <code>@xian-tech/provider</code>
      against a live Xian node. Connect, read state, sign messages, build
      transactions, and watch live updates.
    </p>
  </section>

  <div class="status-bar">
    <div class="status-item">
      <span class="label">Wallet</span>
      <span class="value" id="wallet-output">none</span>
    </div>
    <div class="status-item">
      <span class="label">Address</span>
      <span class="value" id="address">not initialized</span>
    </div>
    <div class="status-item">
      <span class="label">Chain</span>
      <span class="value" id="chain-output">unknown</span>
    </div>
  </div>

  <div class="sections">
    <!-- 1. Setup -->
    <article class="card">
      <div class="card-head" data-toggle="setup">
        <span class="card-title">Setup</span>
        <span class="card-badge">Network & Signer</span>
      </div>
      <div class="card-body" id="setup-body">
        <div class="field-row">
          <label>RPC URL<input id="rpc-url" value="http://127.0.0.1:26657" /></label>
          <label>Dashboard URL<input id="dashboard-url" value="http://127.0.0.1:8080" /></label>
        </div>
        <div class="field-row">
          <label>Chain ID <span style="font-weight:400">(optional)</span><input id="chain-id" placeholder="leave blank to auto-detect" /></label>
          <label>Private Key <span style="font-weight:400">(optional)</span><input id="private-key" placeholder="leave blank to generate" /></label>
        </div>
        <div class="btn-row">
          <button class="primary" id="initialize" data-tip="Create an in-memory signer and XianClient from the fields above">Initialize</button>
          <button class="secondary" id="connect-provider" data-tip="Call wallet.connect() to request account access from the provider">Connect</button>
          <button class="secondary" id="wallet-info" data-tip="Fetch wallet metadata (name, version, capabilities)">Wallet Info</button>
        </div>
        <hr class="separator" />
        <div class="btn-row">
          <button class="secondary" id="inject-wallet" data-tip="Register the demo provider into window.xian so other tabs can discover it">Inject Demo Wallet</button>
          <button class="secondary" id="use-injected-wallet" data-tip="Detect and connect to a wallet already injected by a browser extension">Use Injected Wallet</button>
          <button class="secondary" id="watch-currency" data-tip="Ask the wallet to track the native XIAN currency token">Watch Currency</button>
        </div>
      </div>
    </article>

    <!-- 2. Read -->
    <article class="card">
      <div class="card-head" data-toggle="read">
        <span class="card-title">Read Calls</span>
        <span class="card-badge">Chain State</span>
      </div>
      <div class="card-body" id="read-body">
        <div class="btn-row">
          <button class="primary" id="read-chain" data-tip="Query the connected chain identifier from the RPC node">Chain ID</button>
          <button class="secondary" id="read-nonce" data-tip="Get the next transaction nonce for your address">Nonce</button>
          <button class="secondary" id="read-balance" data-tip="Read the native currency balance for your address">Balance</button>
        </div>
        <pre id="reads-output">No reads yet.</pre>
      </div>
    </article>

    <!-- 3. Sign Message -->
    <article class="card">
      <div class="card-head" data-toggle="sign">
        <span class="card-title">Message Signing</span>
      </div>
      <div class="card-body" id="sign-body">
        <label>Message<input id="message" value="hello from xian-js" /></label>
        <button class="primary" id="sign-message" data-tip="Sign the message text using the wallet provider and return the signature">Sign Message</button>
        <pre id="message-output">No signature yet.</pre>
      </div>
    </article>

    <!-- 4. Transactions -->
    <article class="card">
      <div class="card-head" data-toggle="tx">
        <span class="card-title">Transaction Builder</span>
        <span class="card-badge">Build &rarr; Sign &rarr; Send</span>
      </div>
      <div class="card-body" id="tx-body">
        <div class="field-row">
          <label>Contract<input id="tx-contract" value="currency" /></label>
          <label>Function<input id="tx-function" value="transfer" /></label>
        </div>
        <div class="field-row">
          <label>Stamps<input id="tx-stamps" value="50000" /></label>
          <label>Mode
            <select id="tx-mode">
              <option value="checktx">checktx</option>
              <option value="async">async</option>
              <option value="commit" selected>commit</option>
            </select>
          </label>
        </div>
        <label>Kwargs JSON<textarea id="tx-kwargs">{"to": "bob", "amount": 5}</textarea></label>
        <div class="btn-row">
          <button class="primary" id="build-tx" data-tip="Build an unsigned transaction from the fields above (fetches nonce and estimates stamps)">Prepare</button>
          <button class="secondary" id="sign-tx" data-tip="Sign the previously prepared unsigned transaction">Sign</button>
          <button class="primary" id="send-tx" data-tip="Sign and broadcast the prepared transaction to the network">Send Prepared</button>
          <button class="secondary" id="send-call" data-tip="Prepare, sign, and broadcast in one step (intent-based call)">Quick Send</button>
        </div>
        <pre id="tx-output">No transaction built yet.</pre>
      </div>
    </article>

    <!-- 5. Live -->
    <article class="card">
      <div class="card-head" data-toggle="live">
        <span class="card-title">Live Subscriptions</span>
      </div>
      <div class="card-body" id="live-body">
        <p class="hint">
          Watch real-time block production and balance state changes
          via the dashboard WebSocket.
        </p>
        <div class="btn-row">
          <button class="primary" id="watch-blocks" data-tip="Subscribe to new blocks via the dashboard WebSocket">Watch Blocks</button>
          <button class="secondary" id="watch-balance" data-tip="Subscribe to real-time balance changes for your address">Watch Balance</button>
          <button class="danger" id="clear-watchers" data-tip="Unsubscribe from all active block and balance watchers">Clear All</button>
        </div>
      </div>
    </article>

    <!-- 6. Log -->
    <article class="card">
      <div class="card-head" data-toggle="log">
        <span class="card-title">Activity Log</span>
      </div>
      <div class="card-body" id="log-body">
        <pre id="log-output" class="log">Ready.</pre>
      </div>
    </article>
  </div>
`;

/* ── State ─────────────────────────────────────────────────── */

let state: AppState | null = null;
const observedProviders = new WeakSet<object>();

/* ── DOM refs ──────────────────────────────────────────────── */

const rpcUrlInput = q<HTMLInputElement>("#rpc-url");
const dashboardUrlInput = q<HTMLInputElement>("#dashboard-url");
const chainIdInput = q<HTMLInputElement>("#chain-id");
const privateKeyInput = q<HTMLInputElement>("#private-key");
const messageInput = q<HTMLInputElement>("#message");
const txContractInput = q<HTMLInputElement>("#tx-contract");
const txFunctionInput = q<HTMLInputElement>("#tx-function");
const txStampsInput = q<HTMLInputElement>("#tx-stamps");
const txModeSelect = q<HTMLSelectElement>("#tx-mode");
const txKwargsInput = q<HTMLTextAreaElement>("#tx-kwargs");
const addressOutput = q<HTMLElement>("#address");
const chainOutput = q<HTMLElement>("#chain-output");
const readsOutput = q<HTMLElement>("#reads-output");
const messageOutput = q<HTMLElement>("#message-output");
const txOutput = q<HTMLElement>("#tx-output");
const logOutput = q<HTMLElement>("#log-output");
const walletOutput = q<HTMLElement>("#wallet-output");

/* ── Card toggle (collapse / expand) ──────────────────────── */

for (const head of app.querySelectorAll<HTMLElement>("[data-toggle]")) {
  head.addEventListener("click", () => {
    const id = head.dataset.toggle;
    const body = app.querySelector<HTMLElement>(`#${id}-body`);
    body?.classList.toggle("collapsed");
  });
}

/* ── 1. Setup ──────────────────────────────────────────────── */

q<HTMLButtonElement>("#initialize").addEventListener("click", async () => {
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

    state = { client, signer, provider, wallet, address: signer.address };
    walletOutput.textContent = wallet.metadata?.name ?? "demo wallet";
    addressOutput.textContent = signer.address;
    chainOutput.textContent = chainIdInput.value.trim() || "lazy";
    readsOutput.textContent = "Client initialized.";
    messageOutput.textContent = "No signature yet.";
    txOutput.textContent = "No transaction built yet.";
    log("initialized client and demo wallet");
  } catch (error) {
    log(fmtError(error));
  }
});

q<HTMLButtonElement>("#connect-provider").addEventListener("click", async () => {
  try {
    const s = need();
    const accounts = await s.wallet.connect();
    s.address = accounts[0];
    addressOutput.textContent = s.address ?? "none";
    chainOutput.textContent = await s.wallet.getChainId();
    log(`provider connected ${JSON.stringify(accounts)}`);
  } catch (error) {
    log(fmtError(error));
  }
});

q<HTMLButtonElement>("#wallet-info").addEventListener("click", async () => {
  try {
    const s = need();
    const info = await s.wallet.getWalletInfo();
    readsOutput.textContent = JSON.stringify(info, null, 2);
    log("read wallet info");
  } catch (error) {
    log(fmtError(error));
  }
});

q<HTMLButtonElement>("#inject-wallet").addEventListener("click", () => {
  try {
    const s = need();
    if (!s.provider) {
      throw new Error("initialize the demo wallet first");
    }
    const record = registerInjectedXianProvider({
      provider: s.provider,
      metadata: {
        id: "xian-js-demo",
        name: "Xian JS Demo Wallet",
        rdns: "local.xian-js.demo"
      }
    });
    log(`injected wallet ${record.metadata.name} into window`);
  } catch (error) {
    log(fmtError(error));
  }
});

q<HTMLButtonElement>("#use-injected-wallet").addEventListener("click", async () => {
  try {
    const injected = InjectedXianWallet.getInjected();
    if (!injected) {
      throw new Error("no injected Xian wallet found on window");
    }
    const current =
      state ??
      ({
        client: new XianClient({
          rpcUrl: rpcUrlInput.value.trim(),
          dashboardUrl: dashboardUrlInput.value.trim() || undefined,
          chainId: chainIdInput.value.trim() || undefined
        }),
        wallet: injected
      } satisfies AppState);
    state = current;
    attachWalletListeners(injected);
    current.wallet = injected;
    const accounts = await injected.connect();
    current.address = accounts[0];
    walletOutput.textContent = injected.metadata?.name ?? "injected wallet";
    addressOutput.textContent = current.address ?? "none";
    chainOutput.textContent = await injected.getChainId();
    log(`using injected wallet ${injected.metadata?.name ?? "unknown"}`);
  } catch (error) {
    log(fmtError(error));
  }
});

q<HTMLButtonElement>("#watch-currency").addEventListener("click", async () => {
  try {
    const s = need();
    const accepted = await s.wallet.watchAsset({
      type: "token",
      options: { contract: "currency", symbol: "XIAN", name: "Xian" }
    });
    log(
      accepted
        ? "wallet accepted currency asset watch request"
        : "wallet rejected currency asset watch request"
    );
  } catch (error) {
    log(fmtError(error));
  }
});

/* ── 2. Read Calls ─────────────────────────────────────────── */

q<HTMLButtonElement>("#read-chain").addEventListener("click", async () => {
  try {
    const s = need();
    const chainId = await s.client.getChainId();
    chainOutput.textContent = chainId;
    readsOutput.textContent = JSON.stringify({ chainId }, null, 2);
    log(`chain id ${chainId}`);
  } catch (error) {
    log(fmtError(error));
  }
});

q<HTMLButtonElement>("#read-nonce").addEventListener("click", async () => {
  try {
    const s = need();
    const address = await addr(s);
    const nonce = await s.client.getNonce(address);
    readsOutput.textContent = JSON.stringify({ nonce }, null, 2);
    log(`nonce ${String(nonce)}`);
  } catch (error) {
    log(fmtError(error));
  }
});

q<HTMLButtonElement>("#read-balance").addEventListener("click", async () => {
  try {
    const s = need();
    const address = await addr(s);
    const balance = await s.client.getBalance(address);
    readsOutput.textContent = JSON.stringify({ balance }, null, 2);
    log(`balance ${JSON.stringify(balance)}`);
  } catch (error) {
    log(fmtError(error));
  }
});

/* ── 3. Message Signing ────────────────────────────────────── */

q<HTMLButtonElement>("#sign-message").addEventListener("click", async () => {
  try {
    const s = need();
    const signature = await s.wallet.signMessage(messageInput.value);
    messageOutput.textContent = JSON.stringify({ signature }, null, 2);
    log("signed message through provider");
  } catch (error) {
    log(fmtError(error));
  }
});

/* ── 4. Transaction Builder ────────────────────────────────── */

q<HTMLButtonElement>("#build-tx").addEventListener("click", async () => {
  try {
    const s = need();
    const kwargs = JSON.parse(txKwargsInput.value) as Record<string, unknown>;
    const parsedStamps = Number.parseInt(txStampsInput.value, 10);
    s.unsignedTx = await s.wallet.prepareTransaction({
      contract: txContractInput.value.trim(),
      function: txFunctionInput.value.trim(),
      kwargs,
      stamps: Number.isNaN(parsedStamps) ? undefined : parsedStamps
    });
    s.signedTx = undefined;
    txOutput.textContent = JSON.stringify(s.unsignedTx, null, 2);
    log("prepared unsigned transaction");
  } catch (error) {
    log(fmtError(error));
  }
});

q<HTMLButtonElement>("#sign-tx").addEventListener("click", async () => {
  try {
    const s = need();
    if (!s.unsignedTx) {
      throw new Error("prepare a transaction first");
    }
    s.signedTx = await s.wallet.signTransaction(s.unsignedTx);
    txOutput.textContent = JSON.stringify(s.signedTx, null, 2);
    log("signed transaction");
  } catch (error) {
    log(fmtError(error));
  }
});

q<HTMLButtonElement>("#send-tx").addEventListener("click", async () => {
  try {
    const s = need();
    if (!s.unsignedTx) {
      throw new Error("prepare a transaction first");
    }
    const submission = (await s.wallet.sendTransaction(s.unsignedTx, {
      mode: txModeSelect.value as "async" | "checktx" | "commit",
      waitForTx: txModeSelect.value !== "async"
    })) as TransactionSubmission;
    txOutput.textContent = JSON.stringify(submission, null, 2);
    log(`sent transaction ${submission.txHash ?? "(no hash)"}`);
  } catch (error) {
    log(fmtError(error));
  }
});

q<HTMLButtonElement>("#send-call").addEventListener("click", async () => {
  try {
    const s = need();
    const kwargs = JSON.parse(txKwargsInput.value) as Record<string, unknown>;
    const parsedStamps = Number.parseInt(txStampsInput.value, 10);
    const submission = await s.wallet.sendCall(
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
    log(`sent intent-based call ${submission.txHash ?? "(no hash)"}`);
  } catch (error) {
    log(fmtError(error));
  }
});

/* ── 5. Live Subscriptions ─────────────────────────────────── */

q<HTMLButtonElement>("#watch-blocks").addEventListener("click", () => {
  try {
    const s = need();
    s.blockSub?.unsubscribe();
    s.blockSub = s.client.watch.blocks((message) => {
      log(`block ${String(message.height ?? "?")} ${String(message.hash ?? "")}`);
    });
    log("watching new_block stream");
  } catch (error) {
    log(fmtError(error));
  }
});

q<HTMLButtonElement>("#watch-balance").addEventListener("click", async () => {
  try {
    const s = need();
    const address = await addr(s);
    s.balanceSub?.unsubscribe();
    s.balanceSub = s.client.watch.state(
      `currency.balances:${address}`,
      (message) => {
        log(`balance update ${message.key} => ${JSON.stringify(message.value)}`);
      }
    );
    log("watching balance state");
  } catch (error) {
    log(fmtError(error));
  }
});

q<HTMLButtonElement>("#clear-watchers").addEventListener("click", () => {
  clearWatchers();
  log("cleared subscriptions");
});

/* ── Helpers ───────────────────────────────────────────────── */

function need(): AppState {
  if (!state) {
    throw new Error("initialize the client first");
  }
  return state;
}

async function addr(s: AppState): Promise<string> {
  if (s.address) {
    return s.address;
  }
  const [account] = await s.wallet.connect();
  s.address = account;
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
  const ref = wallet.provider as object;
  if (observedProviders.has(ref)) {
    return;
  }
  observedProviders.add(ref);

  wallet.on("connect", (event) => log(`connect ${JSON.stringify(event)}`));
  wallet.on("disconnect", (event) => log(`disconnect ${JSON.stringify(event)}`));
  wallet.on("accountsChanged", (accounts) => {
    log(`accountsChanged ${JSON.stringify(accounts)}`);
    if (state) {
      state.address = Array.isArray(accounts) ? (accounts[0] as string | undefined) : undefined;
      addressOutput.textContent = state.address ?? "none";
    }
  });
  wallet.on("chainChanged", (chainId) => {
    log(`chainChanged ${String(chainId)}`);
    chainOutput.textContent = String(chainId);
  });
}

function q<T extends Element>(selector: string): T {
  const el = app?.querySelector<T>(selector);
  if (!el) {
    throw new Error(`missing element ${selector}`);
  }
  return el;
}

function log(message: string): void {
  const ts = new Date().toLocaleTimeString();
  logOutput.textContent = `${ts}  ${message}\n${logOutput.textContent}`;
}

function fmtError(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`;
  }
  return `Error: ${String(error)}`;
}
