import { parseXianNumber } from "./encoding.js";
import { TransportError, XianClientError } from "./errors.js";
import type {
  BroadcastMode,
  SubmitShieldedCommandRequest,
  SubmitShieldedNoteRelayTransferRequest,
  TransactionReceipt,
  TransactionSubmission,
  XianSignedTransaction,
  XianShieldedRelayKind,
  XianShieldedRelayerAuthScheme,
  XianShieldedRelayerCatalogEntry,
  XianShieldedRelayerCatalogEntryInput,
  XianShieldedRelayerClientOptions,
  XianShieldedRelayerInfo,
  XianShieldedRelayerInfoResolution,
  XianShieldedRelayerJob,
  XianShieldedRelayerJobResolution,
  XianShieldedRelayerQuote,
  XianShieldedRelayerQuoteResolution,
  XianShieldedRelayerQuoteRequest,
  XianShieldedRelayerPoolClientOptions,
  XianShieldedRelayerRouteOptions
} from "./types.js";

const ALL_RELAY_KINDS: readonly XianShieldedRelayKind[] = [
  "shielded_note_relay_transfer",
  "shielded_command"
];

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function jsonBody(value: Record<string, unknown>): string {
  return JSON.stringify(value, (_key, entry) =>
    typeof entry === "bigint" ? entry.toString() : entry
  );
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null) {
    throw new TransportError("expected object response");
  }
  return value as Record<string, unknown>;
}

function asArrayOfStrings(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string");
}

function normalizeMaybeString(value: unknown): string | null {
  if (value == null) {
    return null;
  }
  return typeof value === "string" ? value : String(value);
}

function normalizeMaybeInteger(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value)) {
    return value;
  }
  if (typeof value === "string" && /^-?\d+$/.test(value)) {
    return Number(value);
  }
  return null;
}

function normalizeMaybeXianNumber(value: unknown): number | bigint | null {
  if (typeof value === "number" || typeof value === "bigint") {
    return value;
  }
  if (typeof value === "string" && /^-?\d+$/.test(value)) {
    return parseXianNumber(value);
  }
  return null;
}

function normalizeRelayKind(value: unknown): XianShieldedRelayKind | null {
  return value === "shielded_command" ||
    value === "shielded_note_relay_transfer"
    ? value
    : null;
}

function normalizeAuthScheme(
  value: unknown
): XianShieldedRelayerAuthScheme {
  return value === "bearer" ? "bearer" : "none";
}

function normalizeBool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function normalizePriority(value: unknown): number {
  const parsed = normalizeMaybeInteger(value);
  return parsed !== null && parsed >= 0 ? parsed : 100;
}

function uniqueRelayKinds(values: unknown): XianShieldedRelayKind[] {
  if (!Array.isArray(values) || values.length === 0) {
    return [...ALL_RELAY_KINDS];
  }
  const unique = new Set<XianShieldedRelayKind>();
  for (const value of values) {
    const normalized = normalizeRelayKind(value);
    if (normalized !== null) {
      unique.add(normalized);
    }
  }
  return unique.size > 0 ? [...unique] : [...ALL_RELAY_KINDS];
}

function copyRelayerEntry(
  entry: XianShieldedRelayerCatalogEntry
): XianShieldedRelayerCatalogEntry {
  return {
    ...entry,
    submissionKinds: [...entry.submissionKinds]
  };
}

export function normalizeShieldedRelayerCatalogEntry(
  entry: XianShieldedRelayerCatalogEntryInput,
  index = 0
): XianShieldedRelayerCatalogEntry {
  const relayerUrl = stripTrailingSlash(
    typeof entry.relayerUrl === "string"
      ? entry.relayerUrl
      : typeof entry.baseUrl === "string"
        ? entry.baseUrl
        : ""
  );
  if (!relayerUrl) {
    throw new XianClientError(
      "shielded relayer entry must define relayerUrl or baseUrl"
    );
  }
  const id = normalizeMaybeString(entry.id)?.trim() || `relayer-${index + 1}`;
  const authToken = normalizeMaybeString(entry.authToken)?.trim() || undefined;
  return {
    id,
    relayerUrl,
    authToken,
    authScheme: normalizeAuthScheme(entry.authScheme),
    publicInfo: normalizeBool(entry.publicInfo, true),
    publicQuote: normalizeBool(entry.publicQuote, false),
    publicJobLookup: normalizeBool(entry.publicJobLookup, false),
    priority: normalizePriority(entry.priority),
    submissionKinds: uniqueRelayKinds(entry.submissionKinds)
  };
}

export function sortShieldedRelayerCatalog(
  entries: XianShieldedRelayerCatalogEntryInput[]
): XianShieldedRelayerCatalogEntry[] {
  const normalized = entries.map((entry, index) =>
    normalizeShieldedRelayerCatalogEntry(entry, index)
  );
  normalized.sort((left, right) => {
    if (left.priority !== right.priority) {
      return left.priority - right.priority;
    }
    if (left.id !== right.id) {
      return left.id.localeCompare(right.id);
    }
    return left.relayerUrl.localeCompare(right.relayerUrl);
  });
  const seen = new Set<string>();
  for (const entry of normalized) {
    if (seen.has(entry.id)) {
      throw new XianClientError(
        `duplicate shielded relayer id: ${entry.id}`
      );
    }
    seen.add(entry.id);
  }
  return normalized;
}

function buildAggregateTransportError(
  action: string,
  failures: Array<{ relayer: XianShieldedRelayerCatalogEntry; error: unknown }>
): TransportError {
  const detail = failures
    .map(({ relayer, error }) => {
      const message = error instanceof Error ? error.message : String(error);
      return `${relayer.id}: ${message}`;
    })
    .join("; ");
  return new TransportError(
    `${action} failed for all candidate relayers: ${detail}`
  );
}

function relayerSupportsKind(
  relayer: XianShieldedRelayerCatalogEntry,
  kind: XianShieldedRelayKind
): boolean {
  return relayer.submissionKinds.includes(kind);
}

function normalizeSignedTransaction(
  value: unknown
): XianSignedTransaction | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }
  const raw = value as Record<string, unknown>;
  const payload =
    typeof raw.payload === "object" && raw.payload !== null
      ? (raw.payload as XianSignedTransaction["payload"])
      : null;
  const metadata =
    typeof raw.metadata === "object" && raw.metadata !== null
      ? (raw.metadata as XianSignedTransaction["metadata"])
      : null;
  if (payload == null || metadata == null) {
    return undefined;
  }
  return { payload, metadata };
}

function normalizeReceipt(value: unknown): TransactionReceipt | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const raw = value as Record<string, unknown>;
  const txHash = normalizeMaybeString(raw.tx_hash ?? raw.txHash) ?? undefined;
  return {
    success: Boolean(raw.success),
    txHash,
    message: raw.message,
    response: asRecord(raw.raw ?? raw.response ?? raw),
    transaction: normalizeSignedTransaction(raw.transaction),
    execution: raw.execution
  };
}

function normalizeSubmission(value: unknown): TransactionSubmission | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const raw = value as Record<string, unknown>;
  const modeValue = normalizeMaybeString(raw.mode);
  const mode: BroadcastMode =
    modeValue === "async" || modeValue === "commit" || modeValue === "checktx"
      ? modeValue
      : "checktx";
  const nonce = normalizeMaybeXianNumber(raw.nonce) ?? 0;
  const stampsSupplied = normalizeMaybeXianNumber(
    raw.stamps_supplied ?? raw.stampsSupplied
  ) ?? 0;
  const stampsEstimated = normalizeMaybeInteger(
    raw.stamps_estimated ?? raw.stampsEstimated
  ) ?? undefined;
  return {
    submitted: Boolean(raw.submitted),
    accepted:
      typeof raw.accepted === "boolean" || raw.accepted == null
        ? (raw.accepted as boolean | null)
        : null,
    finalized: Boolean(raw.finalized),
    txHash: normalizeMaybeString(raw.tx_hash ?? raw.txHash) ?? undefined,
    message: raw.message,
    mode,
    nonce,
    stampsSupplied,
    stampsEstimated,
    response: asRecord(raw.response ?? raw),
    receipt: normalizeReceipt(raw.receipt) ?? undefined
  };
}

export class XianShieldedRelayerClient {
  private readonly relayerUrl: string;
  private readonly authToken?: string;
  private readonly fetchFn: typeof fetch;

  constructor(options: XianShieldedRelayerClientOptions) {
    this.relayerUrl = stripTrailingSlash(options.relayerUrl);
    this.authToken = options.authToken?.trim() || undefined;
    this.fetchFn = options.fetchFn ?? globalThis.fetch.bind(globalThis);
  }

  private async requestJson(
    method: "GET" | "POST",
    path: string,
    body?: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    const headers: Record<string, string> = {
      accept: "application/json"
    };
    let payload: string | undefined;
    if (body !== undefined) {
      headers["content-type"] = "application/json";
      payload = jsonBody(body);
    }
    if (this.authToken) {
      headers.authorization = `Bearer ${this.authToken}`;
    }

    let response: Response;
    try {
      response = await this.fetchFn(`${this.relayerUrl}${path}`, {
        method,
        headers,
        body: payload
      });
    } catch (error) {
      throw new TransportError(
        `request failed for ${this.relayerUrl}${path}`,
        { cause: error }
      );
    }

    let decoded: unknown;
    try {
      decoded = await response.json();
    } catch (error) {
      throw new TransportError(
        `invalid JSON response from ${this.relayerUrl}${path}`,
        { cause: error }
      );
    }
    const record = asRecord(decoded);
    if (!response.ok) {
      const message = normalizeMaybeString(record.error) ?? `relayer request failed with status ${response.status}`;
      throw new TransportError(message);
    }
    return record;
  }

  async getInfo(): Promise<XianShieldedRelayerInfo> {
    const raw = await this.requestJson("GET", "/v1/info");
    const policy = asRecord(raw.policy ?? {});
    return {
      service: normalizeMaybeString(raw.service) ?? "xian-shielded-relayer",
      protocolVersion: normalizeMaybeString(raw.protocol_version) ?? "v1",
      available: Boolean(raw.available),
      chainId: normalizeMaybeString(raw.chain_id),
      relayerAccount: normalizeMaybeString(raw.relayer_account),
      submissionMode:
        raw.submission_mode === "async" ||
        raw.submission_mode === "commit" ||
        raw.submission_mode === "checktx"
          ? (raw.submission_mode as BroadcastMode)
          : "checktx",
      waitForTx: Boolean(raw.wait_for_tx),
      capabilities:
        typeof raw.capabilities === "object" && raw.capabilities !== null
          ? Object.fromEntries(
              Object.entries(raw.capabilities as Record<string, unknown>).map(
                ([key, value]) => [key, Boolean(value)]
              )
            )
          : {},
      policy: {
        quoteTtlSeconds: normalizeMaybeInteger(policy.quote_ttl_seconds) ?? 0,
        defaultExpirySeconds:
          normalizeMaybeInteger(policy.default_expiry_seconds) ?? 0,
        maxExpirySeconds: normalizeMaybeInteger(policy.max_expiry_seconds) ?? 0,
        minNoteRelayerFee:
          normalizeMaybeXianNumber(policy.min_note_relayer_fee) ?? 0,
        minCommandRelayerFee:
          normalizeMaybeXianNumber(policy.min_command_relayer_fee) ?? 0,
        allowedNoteContracts: asArrayOfStrings(policy.allowed_note_contracts),
        allowedCommandContracts: asArrayOfStrings(
          policy.allowed_command_contracts
        ),
        allowedCommandTargets: asArrayOfStrings(policy.allowed_command_targets)
      },
      raw
    };
  }

  async getQuote(
    request: XianShieldedRelayerQuoteRequest
  ): Promise<XianShieldedRelayerQuote> {
    const raw = await this.requestJson("POST", "/v1/quote", {
      kind: request.kind,
      contract: request.contract,
      target_contract: request.targetContract,
      requested_relayer_fee: request.requestedRelayerFee,
      requested_expires_in_seconds: request.requestedExpiresInSeconds
    });
    return {
      kind:
        raw.kind === "shielded_command"
          ? "shielded_command"
          : "shielded_note_relay_transfer",
      contract: normalizeMaybeString(raw.contract) ?? "",
      targetContract: normalizeMaybeString(raw.target_contract),
      chainId: normalizeMaybeString(raw.chain_id),
      relayerAccount: normalizeMaybeString(raw.relayer_account),
      relayerFee: normalizeMaybeXianNumber(raw.relayer_fee) ?? 0,
      expiresAt: normalizeMaybeString(raw.expires_at),
      issuedAt: normalizeMaybeString(raw.issued_at),
      policyVersion: normalizeMaybeString(raw.policy_version),
      raw
    };
  }

  async submitShieldedNoteRelayTransfer(
    request: SubmitShieldedNoteRelayTransferRequest
  ): Promise<XianShieldedRelayerJob> {
    const raw = await this.requestJson("POST", "/v1/jobs/shielded-note-transfer", {
      contract: request.contract,
      old_root: request.oldRoot,
      input_nullifiers: request.inputNullifiers,
      output_commitments: request.outputCommitments,
      proof_hex: request.proofHex,
      relayer_fee: request.relayerFee,
      expires_at: request.expiresAt ?? null,
      output_payloads: request.outputPayloads ?? [],
      client_request_id: request.clientRequestId
    });
    return this.normalizeJob(raw);
  }

  async submitShieldedCommand(
    request: SubmitShieldedCommandRequest
  ): Promise<XianShieldedRelayerJob> {
    const raw = await this.requestJson("POST", "/v1/jobs/shielded-command", {
      contract: request.contract,
      target_contract: request.targetContract,
      old_root: request.oldRoot,
      input_nullifiers: request.inputNullifiers,
      output_commitments: request.outputCommitments,
      proof_hex: request.proofHex,
      relayer_fee: request.relayerFee,
      public_amount: request.publicAmount ?? 0,
      payload: request.payload ?? null,
      expires_at: request.expiresAt ?? null,
      output_payloads: request.outputPayloads ?? [],
      client_request_id: request.clientRequestId
    });
    return this.normalizeJob(raw);
  }

  async getJob(jobId: string): Promise<XianShieldedRelayerJob> {
    const raw = await this.requestJson(
      "GET",
      `/v1/jobs/${encodeURIComponent(jobId)}`
    );
    return this.normalizeJob(raw);
  }

  private normalizeJob(raw: Record<string, unknown>): XianShieldedRelayerJob {
    return {
      jobId: normalizeMaybeString(raw.job_id) ?? "",
      kind:
        raw.kind === "shielded_command"
          ? "shielded_command"
          : "shielded_note_relay_transfer",
      status: normalizeMaybeString(raw.status) ?? "unknown",
      chainId: normalizeMaybeString(raw.chain_id),
      relayerAccount: normalizeMaybeString(raw.relayer_account),
      contract: normalizeMaybeString(raw.contract),
      functionName: normalizeMaybeString(raw.function_name),
      txHash: normalizeMaybeString(raw.tx_hash),
      submittedAt: normalizeMaybeString(raw.submitted_at),
      updatedAt: normalizeMaybeString(raw.updated_at),
      error: normalizeMaybeString(raw.error),
      submission: normalizeSubmission(raw.submission),
      raw
    };
  }
}

export class XianShieldedRelayerPoolClient {
  private readonly relayers: XianShieldedRelayerCatalogEntry[];
  private readonly clients: Map<string, XianShieldedRelayerClient>;

  constructor(options: XianShieldedRelayerPoolClientOptions) {
    this.relayers = sortShieldedRelayerCatalog(options.relayers);
    if (this.relayers.length === 0) {
      throw new XianClientError(
        "shielded relayer pool requires at least one configured relayer"
      );
    }
    this.clients = new Map(
      this.relayers.map((relayer) => [
        relayer.id,
        new XianShieldedRelayerClient({
          relayerUrl: relayer.relayerUrl,
          authToken: relayer.authToken,
          fetchFn: options.fetchFn
        })
      ])
    );
  }

  listRelayers(
    kind?: XianShieldedRelayKind
  ): XianShieldedRelayerCatalogEntry[] {
    const relayers =
      kind == null
        ? this.relayers
        : this.relayers.filter((relayer) => relayerSupportsKind(relayer, kind));
    return relayers.map(copyRelayerEntry);
  }

  getClient(relayerId: string): XianShieldedRelayerClient {
    const client = this.clients.get(relayerId);
    if (client == null) {
      throw new XianClientError(
        `unknown shielded relayer id: ${relayerId}`
      );
    }
    return client;
  }

  async getInfo(
    options: XianShieldedRelayerRouteOptions = {}
  ): Promise<XianShieldedRelayerInfoResolution> {
    const candidates = this.selectCandidates(undefined, options);
    return this.resolveWithFailover("getInfo", candidates, async (relayer) => ({
      relayer,
      info: await this.getClient(relayer.id).getInfo()
    }));
  }

  async getQuote(
    request: XianShieldedRelayerQuoteRequest,
    options: XianShieldedRelayerRouteOptions = {}
  ): Promise<XianShieldedRelayerQuoteResolution> {
    const candidates = this.selectCandidates(request.kind, options);
    return this.resolveWithFailover("getQuote", candidates, async (relayer) => ({
      relayer,
      quote: await this.getClient(relayer.id).getQuote(request)
    }));
  }

  async submitShieldedNoteRelayTransfer(
    request: SubmitShieldedNoteRelayTransferRequest,
    options: XianShieldedRelayerRouteOptions = {}
  ): Promise<XianShieldedRelayerJobResolution> {
    const relayer = this.resolveSubmissionRelayer(
      "submitShieldedNoteRelayTransfer",
      "shielded_note_relay_transfer",
      options
    );
    return {
      relayer,
      job: await this.getClient(relayer.id).submitShieldedNoteRelayTransfer(
        request
      )
    };
  }

  async submitShieldedCommand(
    request: SubmitShieldedCommandRequest,
    options: XianShieldedRelayerRouteOptions = {}
  ): Promise<XianShieldedRelayerJobResolution> {
    const relayer = this.resolveSubmissionRelayer(
      "submitShieldedCommand",
      "shielded_command",
      options
    );
    return {
      relayer,
      job: await this.getClient(relayer.id).submitShieldedCommand(request)
    };
  }

  async getJob(
    jobId: string,
    options: XianShieldedRelayerRouteOptions = {}
  ): Promise<XianShieldedRelayerJobResolution> {
    const relayer = this.resolveJobRelayer("getJob", options);
    return {
      relayer,
      job: await this.getClient(relayer.id).getJob(jobId)
    };
  }

  private selectCandidates(
    kind?: XianShieldedRelayKind,
    options: XianShieldedRelayerRouteOptions = {}
  ): XianShieldedRelayerCatalogEntry[] {
    if (options.relayerId != null) {
      const relayer = this.lookupRelayer(options.relayerId);
      if (kind != null && !relayerSupportsKind(relayer, kind)) {
        throw new XianClientError(
          `shielded relayer ${relayer.id} does not support ${kind}`
        );
      }
      return [relayer];
    }
    const relayers =
      kind == null
        ? this.relayers
        : this.relayers.filter((relayer) => relayerSupportsKind(relayer, kind));
    if (relayers.length === 0) {
      throw new XianClientError(
        kind == null
          ? "no shielded relayers are configured"
          : `no shielded relayers are configured for ${kind}`
      );
    }
    return relayers;
  }

  private resolveSubmissionRelayer(
    action: string,
    kind: XianShieldedRelayKind,
    options: XianShieldedRelayerRouteOptions
  ): XianShieldedRelayerCatalogEntry {
    const candidates = this.selectCandidates(kind, options);
    if (options.relayerId != null || candidates.length === 1) {
      const [relayer] = candidates;
      if (relayer != null) {
        return relayer;
      }
    }
    throw new XianClientError(
      `${action} requires relayerId when multiple shielded relayers are configured`
    );
  }

  private resolveJobRelayer(
    action: string,
    options: XianShieldedRelayerRouteOptions
  ): XianShieldedRelayerCatalogEntry {
    const candidates = this.selectCandidates(undefined, options);
    if (options.relayerId != null || candidates.length === 1) {
      const [relayer] = candidates;
      if (relayer != null) {
        return relayer;
      }
    }
    throw new XianClientError(
      `${action} requires relayerId when multiple shielded relayers are configured`
    );
  }

  private lookupRelayer(relayerId: string): XianShieldedRelayerCatalogEntry {
    const relayer = this.relayers.find((entry) => entry.id === relayerId);
    if (relayer == null) {
      throw new XianClientError(
        `unknown shielded relayer id: ${relayerId}`
      );
    }
    return relayer;
  }

  private async resolveWithFailover<T>(
    action: string,
    candidates: XianShieldedRelayerCatalogEntry[],
    fn: (relayer: XianShieldedRelayerCatalogEntry) => Promise<T>
  ): Promise<T> {
    const failures: Array<{
      relayer: XianShieldedRelayerCatalogEntry;
      error: unknown;
    }> = [];
    for (const relayer of candidates) {
      try {
        return await fn(relayer);
      } catch (error) {
        failures.push({ relayer, error });
      }
    }
    throw buildAggregateTransportError(action, failures);
  }
}
