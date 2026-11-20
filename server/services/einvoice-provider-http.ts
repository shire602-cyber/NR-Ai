// Generic, configuration-driven HTTP adapter for an MoF-accredited e-invoicing
// Service Provider (ASP).
//
// WHY THIS EXISTS
// ---------------
// Under Ministerial Decision 64/2025 only an accredited provider may transmit
// UAE e-invoices. Muhasib cannot accredit directly, so the route to market is
// an agreement with an accredited ASP. Every ASP exposes the same four verbs
// (submit, status, inbox, cancel) with different paths, auth and field names.
// This adapter takes those differences from a mapping file instead of code.
//
// EXTERNAL: no ASP is contracted. The default mapping below is the generic
// shape recorded in tests/fixtures/pint-ae/asp/generic-sandbox.json; a real
// ASP's mapping is written from its API docs and proven with a recorded
// contract test before go-live.
//
// ENVIRONMENT (EINVOICE_API_* names are accepted as legacy aliases)
//   EINVOICE_ASP_BASE_URL      e.g. https://sandbox.example-asp.ae/v1      (required)
//   EINVOICE_ASP_API_KEY       bearer token / API key / "user:password"     (required)
//   EINVOICE_ASP_ENV           sandbox | production (default sandbox)
//   EINVOICE_ASP_AUTH_SCHEME   bearer (default) | header | basic
//   EINVOICE_ASP_KEY_HEADER    header name for the "header" scheme (default x-api-key)
//   EINVOICE_ASP_MAPPING_FILE  path to a JSON mapping (see AspMapping)
//   EINVOICE_ASP_TIMEOUT_MS    request timeout, default 20000

import fs from "node:fs";
import type {
  EInvoiceProvider,
  EInvoiceProviderCapabilities,
  EInvoiceProviderEnvironment,
  EInvoiceProviderResult,
  EInvoiceSubmission,
  InboundEInvoice,
} from "./einvoice-provider";
import type { EInvoiceRejectionReason, EInvoiceStatus } from "./einvoice-status";
import { isEInvoiceStatus } from "./einvoice-status";
import { createLogger } from "../config/logger";

const log = createLogger("einvoice-http");

/**
 * Normalise the many vocabularies ASPs use into our statuses. A mapping file
 * can extend this; unknown values are treated as "failed" (retryable, visible)
 * and never as a success.
 */
const STATUS_MAP: Record<string, EInvoiceStatus> = {
  // handed over, awaiting validation
  submitted: "submitted",
  queued: "submitted",
  pending: "submitted",
  processing: "submitted",
  in_progress: "submitted",
  sent: "submitted",
  received: "submitted",
  // validated and transmitted by the ASP, FTA report pending
  accepted: "accepted",
  delivered: "accepted",
  transmitted: "accepted",
  validated: "accepted",
  // tax data reported to the FTA
  cleared: "cleared",
  reported: "cleared",
  success: "cleared",
  completed: "cleared",
  // business rejection — fix and resubmit
  rejected: "rejected",
  invalid: "rejected",
  validation_failed: "rejected",
  // transport/technical — retry
  failed: "failed",
  error: "failed",
  timeout: "failed",
  // withdrawn
  cancelled: "cancelled",
  canceled: "cancelled",
  withdrawn: "cancelled",
};

export function mapProviderStatus(
  raw: unknown,
  extra: Record<string, string> = {}
): EInvoiceStatus {
  const key = String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  const fromExtra = extra[key];
  if (fromExtra && isEInvoiceStatus(fromExtra)) return fromExtra;
  if (STATUS_MAP[key]) return STATUS_MAP[key];
  if (isEInvoiceStatus(key) && key !== "not_generated" && key !== "generated") return key;
  log.warn({ raw }, "Unknown ASP status; treating as failed");
  return "failed";
}

// ─── Mapping file ───────────────────────────────────────────────────────

interface Endpoint {
  method: "GET" | "POST" | "PUT" | "DELETE";
  /** "{id}" and "{since}" are substituted (URL-encoded). */
  path: string;
}

export interface AspMapping {
  name: string;
  endpoints: {
    submit: Endpoint;
    status: Endpoint;
    inbox?: Endpoint | null;
    cancel?: Endpoint | null;
  };
  request: {
    /** "json-base64" wraps the XML in JSON; "xml" posts it raw. */
    format: "json-base64" | "xml";
    documentField: string;
    numberField?: string;
    uuidField?: string;
    reasonField?: string;
    extra?: Record<string, string>;
  };
  /** Dotted paths tried in order. */
  response: {
    id: string[];
    status: string[];
    message: string[];
    reasons: string[];
    reasonCode: string[];
    reasonMessage: string[];
    reasonField?: string[];
    inboxItems: string[];
    inboxId: string[];
    inboxDocument: string[];
    inboxReceivedAt?: string[];
  };
  statusMap?: Record<string, string>;
}

export const DEFAULT_ASP_MAPPING: AspMapping = {
  name: "generic",
  endpoints: {
    submit: { method: "POST", path: "/invoices" },
    status: { method: "GET", path: "/invoices/{id}" },
    inbox: { method: "GET", path: "/inbox?since={since}" },
    cancel: { method: "POST", path: "/invoices/{id}/cancel" },
  },
  request: {
    format: "json-base64",
    documentField: "document",
    numberField: "invoiceNumber",
    uuidField: "uuid",
    reasonField: "reason",
    extra: { documentFormat: "PINT_AE", documentEncoding: "base64" },
  },
  response: {
    id: ["id", "documentId", "messageId", "data.id"],
    status: ["status", "event", "data.status"],
    message: ["message", "detail", "error", "data.message"],
    reasons: ["errors", "validationErrors", "data.errors"],
    reasonCode: ["code", "ruleId", "id"],
    reasonMessage: ["message", "description", "text"],
    reasonField: ["field", "path", "location"],
    inboxItems: ["items", "documents", "data"],
    inboxId: ["id", "documentId", "messageId"],
    inboxDocument: ["document", "xml", "content"],
    inboxReceivedAt: ["receivedAt", "received_at", "createdAt"],
  },
};

function getPath(obj: unknown, dotted: string): unknown {
  let cur: unknown = obj;
  for (const part of dotted.split(".")) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

function pick(obj: unknown, paths: string[] | undefined): unknown {
  for (const p of paths ?? []) {
    const v = getPath(obj, p);
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return undefined;
}

const str = (v: unknown): string | null =>
  v === undefined || v === null || v === "" ? null : String(v);

export function loadAspMapping(env: NodeJS.ProcessEnv = process.env): AspMapping {
  const file = env.EINVOICE_ASP_MAPPING_FILE;
  if (!file) return DEFAULT_ASP_MAPPING;
  const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as Partial<AspMapping>;
  return {
    ...DEFAULT_ASP_MAPPING,
    ...parsed,
    endpoints: { ...DEFAULT_ASP_MAPPING.endpoints, ...(parsed.endpoints ?? {}) },
    request: { ...DEFAULT_ASP_MAPPING.request, ...(parsed.request ?? {}) },
    response: { ...DEFAULT_ASP_MAPPING.response, ...(parsed.response ?? {}) },
  };
}

// ─── Config ─────────────────────────────────────────────────────────────

interface HttpProviderConfig {
  baseUrl: string;
  apiKey: string;
  authScheme: "bearer" | "header" | "basic";
  keyHeader: string;
  timeoutMs: number;
  environment: EInvoiceProviderEnvironment;
}

function readConfig(env: NodeJS.ProcessEnv): HttpProviderConfig {
  const baseUrl = (env.EINVOICE_ASP_BASE_URL || env.EINVOICE_API_BASE_URL || "").replace(
    /\/+$/,
    ""
  );
  const apiKey = env.EINVOICE_ASP_API_KEY || env.EINVOICE_API_KEY || "";
  if (!baseUrl || !apiKey) {
    throw new Error(
      "E-invoicing HTTP provider requires EINVOICE_ASP_BASE_URL and EINVOICE_ASP_API_KEY " +
        "(legacy: EINVOICE_API_BASE_URL and EINVOICE_API_KEY). These are issued by your " +
        "accredited service provider."
    );
  }
  const scheme = (
    env.EINVOICE_ASP_AUTH_SCHEME ||
    env.EINVOICE_API_AUTH_STYLE ||
    "bearer"
  ).toLowerCase();
  const timeout = Number(env.EINVOICE_ASP_TIMEOUT_MS || env.EINVOICE_API_TIMEOUT_MS);
  const isProd =
    (env.EINVOICE_ASP_ENV ?? "").toLowerCase() === "production" &&
    !/sandbox|test|staging|uat|demo/i.test(baseUrl);
  return {
    baseUrl,
    apiKey,
    authScheme: scheme === "header" ? "header" : scheme === "basic" ? "basic" : "bearer",
    keyHeader: env.EINVOICE_ASP_KEY_HEADER || env.EINVOICE_API_KEY_HEADER || "x-api-key",
    timeoutMs: timeout > 0 ? timeout : 20_000,
    environment: isProd ? "production" : "sandbox",
  };
}

type FetchLike = typeof fetch;

export class HttpEInvoiceProvider implements EInvoiceProvider {
  readonly name: string;
  readonly environment: EInvoiceProviderEnvironment;
  readonly capabilities: EInvoiceProviderCapabilities;
  private readonly cfg: HttpProviderConfig;
  private readonly mapping: AspMapping;
  private readonly fetchImpl: FetchLike;

  constructor(
    env: NodeJS.ProcessEnv = process.env,
    deps: { fetch?: FetchLike; mapping?: AspMapping } = {}
  ) {
    this.cfg = readConfig(env);
    this.mapping = deps.mapping ?? loadAspMapping(env);
    this.fetchImpl = deps.fetch ?? fetch;
    this.environment = this.cfg.environment;
    this.name = this.mapping.name === "generic" ? "http" : `http:${this.mapping.name}`;
    this.capabilities = {
      submit: true,
      getStatus: true,
      receive: !!this.mapping.endpoints.inbox,
      cancel: !!this.mapping.endpoints.cancel,
    };
  }

  private headers(contentType: string | null): Record<string, string> {
    const h: Record<string, string> = { Accept: "application/json" };
    if (contentType) h["Content-Type"] = contentType;
    if (this.cfg.authScheme === "bearer") h.Authorization = `Bearer ${this.cfg.apiKey}`;
    else if (this.cfg.authScheme === "basic")
      h.Authorization = `Basic ${Buffer.from(this.cfg.apiKey, "utf8").toString("base64")}`;
    else h[this.cfg.keyHeader] = this.cfg.apiKey;
    return h;
  }

  private url(ep: Endpoint, vars: Record<string, string>): string {
    const path = ep.path.replace(/\{(\w+)\}/g, (_m, k: string) =>
      encodeURIComponent(vars[k] ?? "")
    );
    return `${this.cfg.baseUrl}${path}`;
  }

  private async request(
    ep: Endpoint,
    vars: Record<string, string>,
    body?: { json?: unknown; xml?: string }
  ): Promise<{ ok: boolean; status: number; json: unknown; text: string }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.cfg.timeoutMs);
    try {
      const res = await this.fetchImpl(this.url(ep, vars), {
        method: ep.method,
        headers: this.headers(
          body?.xml !== undefined
            ? "application/xml"
            : body?.json !== undefined
              ? "application/json"
              : null
        ),
        body: body?.xml ?? (body?.json === undefined ? undefined : JSON.stringify(body.json)),
        signal: controller.signal,
      });
      const text = await res.text();
      let json: unknown = null;
      try {
        json = JSON.parse(text);
      } catch {
        /* provider returned non-JSON; keep the raw text for the audit trail */
      }
      return { ok: res.ok, status: res.status, json, text };
    } finally {
      clearTimeout(timer);
    }
  }

  private reasons(json: unknown): EInvoiceRejectionReason[] {
    const raw = pick(json, this.mapping.response.reasons);
    if (!Array.isArray(raw)) return [];
    return raw.map((r) => ({
      code: str(pick(r, this.mapping.response.reasonCode)) ?? "ASP",
      message:
        str(pick(r, this.mapping.response.reasonMessage)) ??
        (typeof r === "string" ? r : "Rejected"),
      field: str(pick(r, this.mapping.response.reasonField)),
    }));
  }

  private result(
    json: unknown,
    fallbackId: string,
    fallbackStatus: unknown
  ): EInvoiceProviderResult {
    const reasons = this.reasons(json);
    return {
      providerMessageId: str(pick(json, this.mapping.response.id)) ?? fallbackId,
      status: mapProviderStatus(
        pick(json, this.mapping.response.status) ?? fallbackStatus,
        this.mapping.statusMap
      ),
      detail:
        str(pick(json, this.mapping.response.message)) ??
        (reasons.length ? reasons.map((r) => `${r.code}: ${r.message}`).join("; ") : null),
      reasons,
      raw: json,
    };
  }

  async submit(submission: EInvoiceSubmission): Promise<EInvoiceProviderResult> {
    const rq = this.mapping.request;
    const body =
      rq.format === "xml"
        ? { xml: submission.xml }
        : {
            json: {
              ...(rq.extra ?? {}),
              ...(rq.numberField ? { [rq.numberField]: submission.invoiceNumber } : {}),
              ...(rq.uuidField ? { [rq.uuidField]: submission.uuid } : {}),
              // Base64 keeps the document byte-for-byte through JSON transport.
              [rq.documentField]: Buffer.from(submission.xml, "utf8").toString("base64"),
            },
          };

    let r;
    try {
      r = await this.request(this.mapping.endpoints.submit, { id: submission.uuid }, body);
    } catch (err) {
      // Transport failure. Retryable — never report this as delivered.
      const msg = (err as Error)?.message ?? "unknown";
      log.error({ err: msg, invoiceId: submission.invoiceId }, "ASP submit transport error");
      return {
        providerMessageId: "",
        status: "failed",
        detail: `Transport error contacting the service provider: ${msg}`,
      };
    }

    if (!r.ok) {
      log.error(
        { status: r.status, invoiceId: submission.invoiceId, body: r.text.slice(0, 500) },
        "ASP rejected submission"
      );
      const res = this.result(r.json, "", "failed");
      return {
        ...res,
        // 4xx (other than 408/429) is a business rejection; 5xx/408/429 is retryable.
        status:
          r.status >= 400 && r.status < 500 && r.status !== 408 && r.status !== 429
            ? "rejected"
            : "failed",
        detail: res.detail ?? `HTTP ${r.status}`,
        raw: r.json ?? r.text,
      };
    }

    const res = this.result(r.json, "", "submitted");
    if (!res.providerMessageId) {
      // Without an id we cannot poll, so we cannot claim success.
      return {
        providerMessageId: "",
        status: "failed",
        detail: "Service provider accepted the request but returned no document id to track.",
        raw: r.json ?? r.text,
      };
    }
    return res;
  }

  async getStatus(providerMessageId: string): Promise<EInvoiceProviderResult> {
    let r;
    try {
      r = await this.request(this.mapping.endpoints.status, { id: providerMessageId });
    } catch (err) {
      return {
        providerMessageId,
        status: "failed",
        detail: `Transport error polling the service provider: ${(err as Error)?.message ?? "unknown"}`,
      };
    }
    if (!r.ok) {
      return {
        providerMessageId,
        status: "failed",
        detail: str(pick(r.json, this.mapping.response.message)) ?? `HTTP ${r.status}`,
        raw: r.json ?? r.text,
      };
    }
    return this.result(r.json, providerMessageId, undefined);
  }

  async receive(since?: Date | null): Promise<InboundEInvoice[]> {
    const ep = this.mapping.endpoints.inbox;
    if (!ep) return [];
    const r = await this.request(ep, { since: since ? since.toISOString() : "" });
    if (!r.ok) throw new Error(`ASP inbox returned HTTP ${r.status}`);
    const items = pick(r.json, this.mapping.response.inboxItems);
    if (!Array.isArray(items)) return [];
    const out: InboundEInvoice[] = [];
    for (const item of items) {
      const id = str(pick(item, this.mapping.response.inboxId));
      const doc = str(pick(item, this.mapping.response.inboxDocument));
      if (!id || !doc) continue;
      const xml = doc.trimStart().startsWith("<")
        ? doc
        : Buffer.from(doc, "base64").toString("utf8");
      out.push({
        providerMessageId: id,
        xml,
        receivedAt: str(pick(item, this.mapping.response.inboxReceivedAt)),
      });
    }
    return out;
  }

  async cancel(providerMessageId: string, reason: string): Promise<EInvoiceProviderResult> {
    const ep = this.mapping.endpoints.cancel;
    if (!ep) {
      return {
        providerMessageId,
        status: "failed",
        detail: "This service provider does not support cancellation.",
      };
    }
    const field = this.mapping.request.reasonField ?? "reason";
    let r;
    try {
      r = await this.request(ep, { id: providerMessageId }, { json: { [field]: reason } });
    } catch (err) {
      return { providerMessageId, status: "failed", detail: (err as Error).message };
    }
    if (!r.ok) {
      return {
        ...this.result(r.json, providerMessageId, "failed"),
        status: "failed",
        detail: str(pick(r.json, this.mapping.response.message)) ?? `HTTP ${r.status}`,
      };
    }
    return this.result(r.json, providerMessageId, "cancelled");
  }

  parseWebhook(
    payload: unknown
  ): { providerMessageId: string; status: EInvoiceStatus; detail?: string | null } | null {
    if (!payload || typeof payload !== "object") return null;
    const id = str(pick(payload, this.mapping.response.id));
    const status = pick(payload, this.mapping.response.status);
    if (!id || status === undefined) return null;
    return {
      providerMessageId: id,
      status: mapProviderStatus(status, this.mapping.statusMap),
      detail: str(pick(payload, this.mapping.response.message)),
    };
  }
}
