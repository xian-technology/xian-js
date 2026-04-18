import {
  base64ToUtf8,
  bytesToHex,
  canonicalizeRuntime,
  decodeRuntime,
  encodeRuntime,
  normalizeMaybeInteger,
  normalizeMaybeXianNumber,
  parseXianNumber,
  sortKeysDeep,
  utf8ToBytes
} from "./encoding.js";
import { isValidEd25519Signature } from "./ed25519.js";
import { AbciError, RpcError, SimulationError, TransactionError, TransportError, TxTimeoutError } from "./errors.js";
import { WatchApi } from "./watch.js";
import type {
  BroadcastMode,
  BroadcastTxOptions,
  BuildTxRequest,
  ContractSendOptions,
  EstimateChiOptions,
  EstimateChiResult,
  GetShieldedWalletHistoryOptions,
  GetTokenBalancesOptions,
  SimulateRequest,
  TokenApproveOptions,
  TokenTransferOptions,
  TransactionReceipt,
  TransactionSubmission,
  WaitForTxOptions,
  XianClientOptions,
  XianShieldedWalletHistoryEntry,
  XianShieldedWalletHistoryResult,
  XianTokenBalance,
  XianTokenBalancesResult,
  XianSignedTransaction,
  XianSigner,
  XianTxPayload,
  XianUnsignedTransaction
} from "./types.js";

const EMPTY_ABCI_VALUE = "AA==";
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_POLL_INTERVAL_MS = 500;
const DEFAULT_CHI_MARGIN = 0.2;
const DEFAULT_MIN_CHI_HEADROOM = 5_000;

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isIdentifier(value: string): boolean {
  return /^[a-zA-Z][a-zA-Z0-9_]*$/.test(value);
}

function isNonNegativeInteger(value: unknown): value is number | bigint {
  if (typeof value === "bigint") {
    return value >= 0n;
  }
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isHexKey(value: string): boolean {
  return /^[a-fA-F0-9]{64}$/.test(value);
}

function readErrorMessage(value: Record<string, unknown>): string {
  const data = value.data;
  if (typeof data === "string" && data.length > 0) {
    return data;
  }
  const message = value.message;
  if (typeof message === "string" && message.length > 0) {
    return message;
  }
  return "RPC error";
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null) {
    throw new TransportError("expected object response");
  }
  return value as Record<string, unknown>;
}

function parseJsonResult(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function normalizeMaybeNumber(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }
  if (/^-?\d+$/.test(value)) {
    return parseXianNumber(value);
  }
  return value;
}

function normalizeMaybeString(value: unknown): string | null {
  if (value == null) {
    return null;
  }
  return typeof value === "string" ? value : String(value);
}

/**
 * Coerce a chi_used value from a simulation response to a JS number.
 *
 * The simulator returns chi_used as either a number or a stringified
 * integer. Historically we used Number.parseInt here, which silently
 * truncates on scientific notation ("1e6" → 1), decimals ("1.5" → 1),
 * and loses precision above 2^53 for large strings. parseXianNumber
 * runs it through BigInt so oversized values are flagged. Chi values
 * in practice fit comfortably inside Number.MAX_SAFE_INTEGER, so we
 * collapse the bigint branch back to a number and throw only if the
 * estimate is actually too large to represent safely — that can't
 * happen today, but an explicit failure beats a silent mis-estimate.
 */
function coerceChiEstimate(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (value == null) {
    return 0;
  }
  const raw = String(value).trim();
  if (raw === "") {
    return 0;
  }
  try {
    const parsed = parseXianNumber(raw);
    if (typeof parsed === "bigint") {
      throw new Error(
        `chi_used estimate ${raw} exceeds Number.MAX_SAFE_INTEGER`
      );
    }
    return parsed;
  } catch (err) {
    throw new Error(
      `invalid chi_used estimate ${JSON.stringify(value)}: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
  }
}

function clampPageSize(value: number | undefined, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(0, Math.min(Math.trunc(value), 1_000));
}

function clampOffset(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.trunc(value));
}

function isPendingLookupReceipt(receipt: TransactionReceipt): boolean {
  return !receipt.success && receipt.txHash == null && receipt.transaction == null;
}

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
  if (!a) return b;
  if (!b) return a;
  const anyFn = (AbortSignal as unknown as {
    any?: (signals: AbortSignal[]) => AbortSignal;
  }).any;
  if (typeof anyFn === "function") {
    return anyFn([a, b]);
  }
  const controller = new AbortController();
  const forward = (signal: AbortSignal) => {
    if (signal.aborted) {
      controller.abort(signal.reason);
      return;
    }
    signal.addEventListener(
      "abort",
      () => controller.abort(signal.reason),
      { once: true }
    );
  };
  forward(a);
  forward(b);
  return controller.signal;
}

function validatePayload(payload: XianTxPayload): void {
  const keys = Object.keys(payload).sort();
  const expected = ["chain_id", "chi_supplied", "contract", "function", "kwargs", "nonce", "sender"];
  if (keys.join(",") !== expected.join(",")) {
    throw new TransactionError("payload must contain the canonical Xian transaction keys");
  }
  if (!isHexKey(payload.sender)) {
    throw new TransactionError("sender must be a 32-byte hex public key");
  }
  if (!isIdentifier(payload.contract)) {
    throw new TransactionError("contract must be a valid identifier");
  }
  if (!isIdentifier(payload.function)) {
    throw new TransactionError("function must be a valid identifier");
  }
  if (!isNonNegativeInteger(payload.nonce)) {
    throw new TransactionError("nonce must be a non-negative integer");
  }
  if (!isNonNegativeInteger(payload.chi_supplied)) {
    throw new TransactionError("chi_supplied must be a non-negative integer");
  }

  for (const key of Object.keys(payload.kwargs)) {
    if (!isIdentifier(key)) {
      throw new TransactionError("kwargs keys must be valid identifiers");
    }
  }
}

export class XianClient {
  readonly rpcUrl: string;
  readonly dashboardUrl?: string;
  readonly watch: WatchApi;

  private readonly fetchFn: typeof fetch;
  private readonly requestTimeoutMs: number;
  private chainIdCache?: string;

  constructor(options: XianClientOptions) {
    this.rpcUrl = stripTrailingSlash(options.rpcUrl);
    this.dashboardUrl = options.dashboardUrl
      ? stripTrailingSlash(options.dashboardUrl)
      : undefined;
    this.chainIdCache = options.chainId;
    this.fetchFn = options.fetchFn ?? globalThis.fetch.bind(globalThis);
    this.requestTimeoutMs =
      options.requestTimeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.watch = new WatchApi({
      dashboardUrl: this.dashboardUrl,
      webSocketFactory: options.webSocketFactory
    });
  }

  private async requestJson(
    method: "GET" | "POST",
    url: string,
    options?: { signal?: AbortSignal; timeoutMs?: number }
  ): Promise<Record<string, unknown>> {
    const timeoutMs = options?.timeoutMs ?? this.requestTimeoutMs;
    const timeoutController =
      timeoutMs > 0 ? new AbortController() : undefined;
    const timeoutHandle = timeoutController
      ? setTimeout(() => timeoutController.abort(), timeoutMs)
      : undefined;

    const callerSignal = options?.signal;
    const signal = mergeAbortSignals(callerSignal, timeoutController?.signal);

    let response: Response;
    try {
      response = await this.fetchFn(url, {
        method,
        headers: method === "POST" ? { "content-type": "application/json" } : undefined,
        signal,
      });
    } catch (error) {
      if (callerSignal?.aborted) {
        throw error;
      }
      if (timeoutController?.signal.aborted) {
        throw new TransportError(
          `request timed out after ${timeoutMs}ms for ${url}`,
          { cause: error }
        );
      }
      throw new TransportError(`request failed for ${url}`, { cause: error });
    } finally {
      if (timeoutHandle !== undefined) {
        clearTimeout(timeoutHandle);
      }
    }

    if (!response.ok) {
      throw new TransportError(`${method} ${url} returned ${response.status}`);
    }

    try {
      return asRecord(await response.json());
    } catch (error) {
      throw new TransportError(`invalid JSON response from ${url}`, { cause: error });
    }
  }

  private async abciQuery(path: string): Promise<Record<string, unknown>> {
    const url = new URL(`${this.rpcUrl}/abci_query`);
    url.searchParams.set("path", `"${path}"`);

    const data = await this.requestJson("POST", url.toString());
    if ("error" in data) {
      throw new RpcError(readErrorMessage(asRecord(data.error)), data.error);
    }

    const response = asRecord(asRecord(data.result).response);
    const code = response.code;
    if (typeof code === "number" && code !== 0) {
      throw new AbciError(String(response.log ?? "ABCI query failed"), {
        path,
        response
      });
    }

    return data;
  }

  private decodeAbciValue(value: unknown): unknown {
    if (value == null || value === EMPTY_ABCI_VALUE) {
      return null;
    }
    const decodedUtf8 = base64ToUtf8(String(value));
    const decoded = decodeRuntime(decodedUtf8);
    if (decoded == null) {
      return normalizeMaybeNumber(decodedUtf8);
    }
    return normalizeMaybeNumber(decoded);
  }

  private normalizeTxLookup(data: Record<string, unknown>): TransactionReceipt {
    const result = asRecord(data.result ?? {});
    const txResult = asRecord(result.tx_result ?? {});
    const execution = txResult.data == null ? undefined : parseJsonResult(base64ToUtf8(String(txResult.data)));
    const transaction = result.tx == null ? undefined : (this.decodeTxRecord(String(result.tx)) as XianSignedTransaction);

    if ("error" in data) {
      return {
        success: false,
        message: readErrorMessage(asRecord(data.error)),
        response: data
      };
    }

    const code = txResult.code;
    const success = typeof code === "number" ? code === 0 : false;
    const txHash = typeof result.hash === "string" ? result.hash : undefined;

    return {
      success,
      txHash,
      message: success ? undefined : execution ?? txResult.log ?? "Transaction failed",
      response: data,
      transaction,
      execution
    };
  }

  private decodeTxRecord(value: string): unknown {
    const hexPayload = base64ToUtf8(value);
    const decoded = decodeRuntime(hexPayload);
    if (decoded != null) {
      return decoded;
    }
    return decodeRuntime(hexToUtf8(hexPayload));
  }

  async getGenesis(): Promise<Record<string, unknown>> {
    return this.requestJson("GET", `${this.rpcUrl}/genesis`);
  }

  async getChainId(): Promise<string> {
    if (this.chainIdCache) {
      return this.chainIdCache;
    }

    const genesis = await this.getGenesis();
    const chainId = asRecord(asRecord(genesis.result).genesis).chain_id;
    if (typeof chainId !== "string" || chainId.length === 0) {
      throw new RpcError("genesis response did not include chain_id", genesis);
    }

    this.chainIdCache = chainId;
    return chainId;
  }

  async getStatus(): Promise<Record<string, unknown>> {
    return this.requestJson("GET", `${this.rpcUrl}/status`);
  }

  async getBlock(height: number | string): Promise<Record<string, unknown>> {
    return this.requestJson("GET", `${this.rpcUrl}/block?height=${height}`);
  }

  async getTx(txHash: string): Promise<TransactionReceipt> {
    const data = await this.requestJson("GET", `${this.rpcUrl}/tx?hash=0x${txHash}`);
    return this.normalizeTxLookup(data);
  }

  async getNonce(address: string): Promise<number | bigint> {
    const data = await this.abciQuery(`/get_next_nonce/${address}`);
    const value = asRecord(asRecord(data.result).response).value;
    if (value == null || value === EMPTY_ABCI_VALUE) {
      return 0;
    }
    return parseXianNumber(base64ToUtf8(String(value)));
  }

  async getState(contract: string, variable: string, keys: string[] = []): Promise<unknown> {
    const suffix = keys.length > 0 ? `:${keys.join(":")}` : "";
    const data = await this.abciQuery(`/get/${contract}.${variable}${suffix}`);
    return this.decodeAbciValue(asRecord(asRecord(data.result).response).value);
  }

  async getBalance(address: string, options?: { contract?: string }): Promise<unknown> {
    const contract = options?.contract ?? "currency";
    try {
      const simulation = await this.simulate({
        sender: address,
        contract,
        function: "balance_of",
        kwargs: { address }
      });
      return normalizeMaybeNumber(simulation.result);
    } catch {
      return this.getState(contract, "balances", [address]);
    }
  }

  async getTokenMetadata(contract: string): Promise<{
    contract: string;
    name: string | null;
    symbol: string | null;
    logoUrl: string | null;
    logoSvg: string | null;
  }> {
    const [name, symbol, logoUrl] = await Promise.all([
      this.getState(contract, "metadata", ["token_name"]),
      this.getState(contract, "metadata", ["token_symbol"]),
      this.getState(contract, "metadata", ["token_logo_url"])
    ]);
    const rawLogoUrl = normalizeMaybeString(logoUrl);
    const normalizedLogoUrl = rawLogoUrl?.trim() ? rawLogoUrl.trim() : null;
    let logoSvg: string | null = null;
    if (!normalizedLogoUrl) {
      const rawLogoSvg = normalizeMaybeString(
        await this.getState(contract, "metadata", ["token_logo_svg"]).catch(() => null)
      );
      logoSvg = rawLogoSvg?.trim() ? rawLogoSvg.trim() : null;
    }

    return {
      contract,
      name: normalizeMaybeString(name),
      symbol: normalizeMaybeString(symbol),
      logoUrl: normalizedLogoUrl,
      logoSvg
    };
  }

  async getTokenBalances(
    address: string,
    options?: GetTokenBalancesOptions
  ): Promise<XianTokenBalancesResult> {
    const limit = clampPageSize(options?.limit, 100);
    const offset = clampOffset(options?.offset);
    const includeZero = options?.includeZero === true;
    let path = `/token_balances/${address}/limit=${limit}/offset=${offset}`;
    if (includeZero) {
      path += "/include_zero=true";
    }

    const data = await this.abciQuery(path);
    const value = this.decodeAbciValue(asRecord(asRecord(data.result).response).value);
    const payload = asRecord(value);
    const items = Array.isArray(payload.items)
      ? payload.items
          .filter((item): item is Record<string, unknown> => item != null && typeof item === "object")
          .map((item): XianTokenBalance => ({
            contract: String(item.contract ?? ""),
            balance: normalizeMaybeString(item.balance),
            name: normalizeMaybeString(item.name),
            symbol: normalizeMaybeString(item.symbol),
            logoUrl: normalizeMaybeString(item.logo_url),
            lastTxHash: normalizeMaybeString(item.last_tx_hash),
            lastBlockHeight: normalizeMaybeXianNumber(item.last_block_height),
            updatedAt: normalizeMaybeString(item.updated_at)
          }))
      : [];

    return {
      available: payload.available !== false,
      address: String(payload.address ?? address),
      items,
      total: Number(payload.total ?? items.length),
      limit: Number(payload.limit ?? limit),
      offset: Number(payload.offset ?? offset)
    };
  }

  async getShieldedWalletHistory(
    tagValue: string,
    options?: GetShieldedWalletHistoryOptions
  ): Promise<XianShieldedWalletHistoryResult> {
    const limit = clampPageSize(options?.limit, 100);
    const afterNoteIndex = clampOffset(options?.afterNoteIndex);
    const kind = typeof options?.kind === "string" && options.kind.trim().length > 0
      ? options.kind.trim()
      : "sync_hint";

    const data = await this.abciQuery(
      `/shielded_wallet_history/${tagValue}/limit=${limit}/kind=${kind}/after_note_index=${afterNoteIndex}`
    );
    const value = this.decodeAbciValue(asRecord(asRecord(data.result).response).value);
    const payload = asRecord(value);
    const items = Array.isArray(payload.items)
      ? payload.items
          .filter((item): item is Record<string, unknown> => item != null && typeof item === "object")
          .map((item): XianShieldedWalletHistoryEntry => ({
            eventId: normalizeMaybeInteger(item.event_id),
            txHash: normalizeMaybeString(item.tx_hash),
            blockHeight: normalizeMaybeXianNumber(item.block_height),
            txIndex: normalizeMaybeXianNumber(item.tx_index),
            contract: normalizeMaybeString(item.contract),
            function: normalizeMaybeString(item.function),
            action: normalizeMaybeString(item.action),
            outputIndex: normalizeMaybeXianNumber(item.output_index),
            noteIndex: normalizeMaybeXianNumber(item.note_index),
            commitment: normalizeMaybeString(item.commitment),
            newRoot: normalizeMaybeString(item.new_root),
            payloadHash: normalizeMaybeString(item.payload_hash),
            tagKind: normalizeMaybeString(item.tag_kind),
            tagValue: normalizeMaybeString(item.tag_value),
            outputPayload: normalizeMaybeString(item.output_payload),
            createdAt: normalizeMaybeString(item.created_at ?? item.created),
            raw: item
          }))
      : [];

    return {
      available: payload.available !== false,
      items,
      limit: Number(payload.limit ?? limit),
      afterNoteIndex: Number(payload.after_note_index ?? afterNoteIndex)
    };
  }

  async getChiRate(): Promise<number | bigint | null> {
    const value = await this.getState("chi_cost", "S", ["value"]);
    if (value == null) {
      return null;
    }
    if (typeof value === "number" || typeof value === "bigint") {
      return value;
    }
    return parseXianNumber(String(value));
  }

  async getContract(contract: string): Promise<string | null> {
    const data = await this.abciQuery(`/contract/${contract}`);
    const value = asRecord(asRecord(data.result).response).value;
    if (value == null || value === EMPTY_ABCI_VALUE) {
      return null;
    }
    return base64ToUtf8(String(value));
  }

  async getContractCode(contract: string): Promise<string | null> {
    const data = await this.abciQuery(`/contract_code/${contract}`);
    const value = asRecord(asRecord(data.result).response).value;
    if (value == null || value === EMPTY_ABCI_VALUE) {
      return null;
    }
    return base64ToUtf8(String(value));
  }

  async getContractMethods(
    contract: string
  ): Promise<{ name: string; arguments: { name: string; type: string }[] }[]> {
    const data = await this.abciQuery(`/contract_methods/${contract}`);
    const value = asRecord(asRecord(data.result).response).value;
    if (value == null || value === EMPTY_ABCI_VALUE) {
      return [];
    }
    const decoded = JSON.parse(base64ToUtf8(String(value)));
    const raw: unknown[] = Array.isArray(decoded)
      ? decoded
      : decoded != null &&
          typeof decoded === "object" &&
          Array.isArray((decoded as Record<string, unknown>).methods)
        ? (decoded as Record<string, unknown>).methods as unknown[]
        : [];
    return raw
      .filter(
        (v): v is { name: string; arguments?: unknown[] } =>
          v != null && typeof v === "object" && typeof (v as Record<string, unknown>).name === "string"
      )
      .map((m) => ({
        name: m.name,
        arguments: Array.isArray(m.arguments)
          ? m.arguments
              .filter(
                (a: unknown): a is { name: string; type: string } =>
                  a != null &&
                  typeof a === "object" &&
                  typeof (a as Record<string, unknown>).name === "string" &&
                  typeof (a as Record<string, unknown>).type === "string"
              )
              .map((a) => ({ name: a.name, type: a.type }))
          : []
      }));
  }

  async simulate(request: SimulateRequest): Promise<Record<string, unknown>> {
    const payload = sortKeysDeep({
      contract: request.contract,
      function: request.function,
      kwargs: request.kwargs,
      sender: request.sender
    });
    const encoded = bytesToHex(utf8ToBytes(encodeRuntime(payload)));
    const data = await this.abciQuery(`/simulate_tx/${encoded}`);
    const response = asRecord(asRecord(data.result).response);
    if (response.code != null && response.code !== 0) {
      throw new SimulationError(String(response.log ?? "simulation failed"), response);
    }

    const rawValue = response.value;
    const decoded = rawValue == null ? null : decodeRuntime<Record<string, unknown>>(base64ToUtf8(String(rawValue)));
    if (decoded == null) {
      throw new SimulationError("simulation response did not decode to JSON", response);
    }
    return decoded;
  }

  async call(request: SimulateRequest): Promise<unknown> {
    const simulation = await this.simulate(request);
    const status = simulation.status;
    if (status != null && status !== 0) {
      throw new SimulationError(String(simulation.result ?? "Simulation failed"), simulation);
    }
    return simulation.result;
  }

  async estimateChi(
    request: SimulateRequest,
    options?: EstimateChiOptions
  ): Promise<EstimateChiResult> {
    const simulation = await this.simulate(request);
    const estimated = coerceChiEstimate(simulation.chi_used);
    const chiMargin = options?.chiMargin ?? DEFAULT_CHI_MARGIN;
    const minChiHeadroom = options?.minChiHeadroom ?? DEFAULT_MIN_CHI_HEADROOM;
    const proportional = Math.ceil(estimated * chiMargin);
    const suggested = estimated + Math.max(proportional, minChiHeadroom);

    return {
      estimated,
      suggested,
      simulation
    };
  }

  async buildTx(request: BuildTxRequest): Promise<XianUnsignedTransaction> {
    const chainId = request.chainId ?? (await this.getChainId());
    const nonce = request.nonce ?? (await this.getNonce(request.sender));
    let chiSupplied = request.chiSupplied ?? request.chi;

    if (chiSupplied == null) {
      const estimate = await this.estimateChi({
        sender: request.sender,
        contract: request.contract,
        function: request.function,
        kwargs: request.kwargs
      });
      chiSupplied = estimate.suggested;
    }

    const payload = sortKeysDeep({
      chain_id: chainId,
      contract: request.contract,
      function: request.function,
      kwargs: request.kwargs,
      nonce,
      sender: request.sender,
      chi_supplied: chiSupplied
    }) as XianTxPayload;

    validatePayload(payload);
    return { payload };
  }

  async signTx(tx: XianUnsignedTransaction, signer: XianSigner): Promise<XianSignedTransaction> {
    validatePayload(tx.payload);

    const signerAddress =
      typeof signer.getAddress === "function" ? await signer.getAddress() : undefined;
    if (signerAddress && signerAddress !== tx.payload.sender) {
      throw new TransactionError("signer address does not match payload sender");
    }

    const signature = await signer.signMessage(canonicalizeRuntime(tx.payload));
    if (!isValidEd25519Signature(signature)) {
      throw new TransactionError("signer returned an invalid Ed25519 signature");
    }

    return sortKeysDeep({
      metadata: { signature },
      payload: tx.payload
    }) as XianSignedTransaction;
  }

  async broadcastTx(
    tx: XianSignedTransaction,
    options?: BroadcastTxOptions
  ): Promise<TransactionSubmission> {
    validatePayload(tx.payload);
    const mode = options?.mode ?? "checktx";
    if (!["async", "checktx", "commit"].includes(mode)) {
      throw new TransactionError("mode must be one of: async, checktx, commit");
    }

    const endpoint =
      mode === "async"
        ? "broadcast_tx_async"
        : mode === "commit"
          ? "broadcast_tx_commit"
          : "broadcast_tx_sync";

    const encodedTx = bytesToHex(utf8ToBytes(encodeRuntime(sortKeysDeep(tx))));
    const url = new URL(`${this.rpcUrl}/${endpoint}`);
    url.searchParams.set("tx", `"${encodedTx}"`);

    const data = await this.requestJson("POST", url.toString());
    const response = asRecord(data.result ?? {});
    const txHash = typeof response.hash === "string" ? response.hash : undefined;

    const submission: TransactionSubmission = {
      submitted: !("error" in data),
      accepted: null,
      finalized: false,
      txHash,
      message: "error" in data ? readErrorMessage(asRecord(data.error)) : undefined,
      mode,
      nonce: tx.payload.nonce,
      chiSupplied: tx.payload.chi_supplied,
      response: data
    };

    if ("error" in data) {
      return submission;
    }

    if (mode === "commit") {
      const checkTx = asRecord(response.check_tx ?? {});
      const deliverTx = asRecord(response.deliver_tx ?? response.tx_result ?? {});
      submission.accepted = checkTx.code === 0;
      submission.finalized = submission.accepted && deliverTx.code === 0 && String(response.height ?? "0") !== "0";
      submission.message = submission.accepted
        ? submission.finalized
          ? undefined
          : deliverTx.log ?? "transaction was not finalized"
        : checkTx.log ?? "CheckTx failed";
      return submission;
    }

    if (mode === "async") {
      if (options?.waitForTx && submission.txHash) {
        submission.receipt = await this.waitForTx(submission.txHash, options);
        submission.finalized = true;
      }
      return submission;
    }

    submission.accepted = response.code === 0;
    submission.message = submission.accepted ? undefined : response.log ?? "CheckTx failed";
    if (submission.accepted && options?.waitForTx && submission.txHash) {
      submission.receipt = await this.waitForTx(submission.txHash, options);
      submission.finalized = true;
    }
    return submission;
  }

  async waitForTx(txHash: string, options?: WaitForTxOptions): Promise<TransactionReceipt> {
    const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const pollIntervalMs = options?.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    const deadline = Date.now() + timeoutMs;
    let lastError: unknown;

    while (Date.now() < deadline) {
      try {
        const receipt = await this.getTx(txHash);
        if (!isPendingLookupReceipt(receipt)) {
          return receipt;
        }
      } catch (error) {
        lastError = error;
      }
      await sleep(pollIntervalMs);
    }

    throw new TxTimeoutError(`timed out waiting for transaction ${txHash}`, {
      cause: lastError
    });
  }

  async sendTx(
    request: BuildTxRequest & {
      signer: XianSigner;
      mode?: BroadcastMode;
      waitForTx?: boolean;
      timeoutMs?: number;
      pollIntervalMs?: number;
    }
  ): Promise<TransactionSubmission> {
    const tx = await this.buildTx(request);
    const signedTx = await this.signTx(tx, request.signer);
    return this.broadcastTx(signedTx, {
      mode: request.mode,
      waitForTx: request.waitForTx,
      timeoutMs: request.timeoutMs,
      pollIntervalMs: request.pollIntervalMs
    });
  }

  contract(name: string): ContractClient {
    return new ContractClient(this, name);
  }

  token(name: string = "currency"): TokenClient {
    return new TokenClient(this, name);
  }
}

function hexToUtf8(value: string): string {
  const out = new Uint8Array(value.length / 2);
  for (let index = 0; index < value.length; index += 2) {
    out[index / 2] = Number.parseInt(value.slice(index, index + 2), 16);
  }
  return new TextDecoder().decode(out);
}

export class ContractClient {
  constructor(private readonly client: XianClient, private readonly contractName: string) {}

  async call(functionName: string, kwargs: Record<string, unknown>, sender = "0".repeat(64)): Promise<unknown> {
    return this.client.call({
      sender,
      contract: this.contractName,
      function: functionName,
      kwargs
    });
  }

  async send(
    functionName: string,
    kwargs: Record<string, unknown>,
    options: ContractSendOptions & { signer: XianSigner }
  ): Promise<TransactionSubmission> {
    if (typeof options.signer.getAddress !== "function") {
      throw new TransactionError("signer.getAddress() is required for contract sends");
    }
    const sender = await options.signer.getAddress();
    return this.client.sendTx({
      sender,
      contract: this.contractName,
      function: functionName,
      kwargs,
      signer: options.signer,
      mode: options.mode,
      waitForTx: options.waitForTx,
      timeoutMs: options.timeoutMs,
      pollIntervalMs: options.pollIntervalMs,
      chi: options.chi,
      nonce: options.nonce,
      chainId: options.chainId
    });
  }
}

export class TokenClient {
  constructor(private readonly client: XianClient, private readonly tokenName: string) {}

  balanceOf(address: string): Promise<unknown> {
    return this.client.getBalance(address, { contract: this.tokenName });
  }

  metadata(): Promise<{
    contract: string;
    name: string | null;
    symbol: string | null;
    logoUrl: string | null;
    logoSvg: string | null;
  }> {
    return this.client.getTokenMetadata(this.tokenName);
  }

  allowance(owner: string, spender: string): Promise<unknown> {
    return this.client.getState(this.tokenName, "approvals", [owner, spender]);
  }

  async transfer(options: TokenTransferOptions): Promise<TransactionSubmission> {
    if (typeof options.signer.getAddress !== "function") {
      throw new TransactionError("signer.getAddress() is required for token transfer");
    }
    const sender = await options.signer.getAddress();
    return this.client.sendTx({
      sender,
      contract: this.tokenName,
      function: "transfer",
      kwargs: {
        to: options.to,
        amount: options.amount
      },
      signer: options.signer,
      mode: options.mode,
      waitForTx: options.waitForTx,
      timeoutMs: options.timeoutMs,
      pollIntervalMs: options.pollIntervalMs,
      chi: options.chi,
      nonce: options.nonce,
      chainId: options.chainId
    });
  }

  async approve(options: TokenApproveOptions): Promise<TransactionSubmission> {
    if (typeof options.signer.getAddress !== "function") {
      throw new TransactionError("signer.getAddress() is required for token approve");
    }
    const sender = await options.signer.getAddress();
    return this.client.sendTx({
      sender,
      contract: this.tokenName,
      function: "approve",
      kwargs: {
        to: options.spender,
        amount: options.amount
      },
      signer: options.signer,
      mode: options.mode,
      waitForTx: options.waitForTx,
      timeoutMs: options.timeoutMs,
      pollIntervalMs: options.pollIntervalMs,
      chi: options.chi,
      nonce: options.nonce,
      chainId: options.chainId
    });
  }
}
