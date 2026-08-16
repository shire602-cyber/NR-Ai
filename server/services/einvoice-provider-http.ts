// Generic HTTP adapter for an MoF-accredited e-invoicing Service Provider (ASP).
//
// WHY THIS EXISTS
// ---------------
// Under Ministerial Decision 64/2025 (as amended by Ministerial Resolution
// 56/2026) only an accredited provider may transmit UAE e-invoices. Muhasib
// cannot accredit directly (the ≥2-year operating-history rule), so the route to
// market is a white-label agreement with an accredited ASP.
//
// Everything on our side is already done: PINT AE / UBL 2.1 generation,
// validation, the status state machine, the audit trail. The only missing piece
// was the wire call. This adapter is that piece, written against the shape every
// ASP REST API in this market actually uses:
//
//     POST   {base}/invoices            -> { id, status, message? }
//     GET    {base}/invoices/{id}       -> { id, status, message? }
//     POST   {webhook}                  -> { id|documentId, status, message? }
//
// TO GO LIVE
// ----------
//   1. Sign with an accredited ASP (MoF publishes the list).
//   2. Set the environment variables below.
//   3. Set EINVOICE_PROVIDER=http.
//   4. Map their status vocabulary in STATUS_MAP if it differs.
//
// No application code changes. If a provider's API deviates structurally,
// subclass this and override the three methods — the seam is the interface, not
// this file.
//
// ENVIRONMENT
//   EINVOICE_API_BASE_URL   e.g. https://api.example-asp.ae/v1   (required)
//   EINVOICE_API_KEY        bearer token / API key               (required)
//   EINVOICE_API_AUTH_STYLE "bearer" (default) | "header"
//   EINVOICE_API_KEY_HEADER header name when auth style = header (default x-api-key)
//   EINVOICE_API_TIMEOUT_MS request timeout, default 20000

import type {
  EInvoiceProvider,
  EInvoiceProviderResult,
  EInvoiceSubmission,
} from "./einvoice-provider";
import type { EInvoiceStatus } from "./einvoice-status";
import { isEInvoiceStatus } from "./einvoice-status";
import { createLogger } from "../config/logger";

const log = createLogger("einvoice-http");

/**
 * Normalise the many vocabularies ASPs use into our six statuses. Extend this
 * for your provider rather than changing call sites.
 */
const STATUS_MAP: Record<string, EInvoiceStatus> = {
  // handed over, awaiting clearance
  submitted: "submitted",
  queued: "submitted",
  pending: "submitted",
  processing: "submitted",
  in_progress: "submitted",
  sent: "submitted",
  // cleared
  accepted: "accepted",
  cleared: "accepted",
  delivered: "accepted",
  success: "accepted",
  completed: "accepted",
  // business rejection — fix and resubmit
  rejected: "rejected",
  invalid: "rejected",
  validation_failed: "rejected",
  // transport/technical — retry
  failed: "failed",
  error: "failed",
  timeout: "failed",
};

export function mapProviderStatus(raw: unknown): EInvoiceStatus {
  const key = String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  if (STATUS_MAP[key]) return STATUS_MAP[key];
  if (isEInvoiceStatus(key)) return key;
  // Unknown vocabulary must never be silently treated as success. "failed" is
  // retryable and visible; "accepted" would be a lie with an FTA penalty behind it.
  log.warn({ raw }, "Unknown ASP status; treating as failed");
  return "failed";
}

interface HttpProviderConfig {
  baseUrl: string;
  apiKey: string;
  authStyle: "bearer" | "header";
  apiKeyHeader: string;
  timeoutMs: number;
}

function readConfig(env: NodeJS.ProcessEnv): HttpProviderConfig {
  const baseUrl = (env.EINVOICE_API_BASE_URL || "").replace(/\/+$/, "");
  const apiKey = env.EINVOICE_API_KEY || "";
  if (!baseUrl || !apiKey) {
    throw new Error(
      "E-invoicing HTTP provider requires EINVOICE_API_BASE_URL and EINVOICE_API_KEY. " +
        "These are issued by your accredited service provider."
    );
  }
  return {
    baseUrl,
    apiKey,
    authStyle: (env.EINVOICE_API_AUTH_STYLE || "bearer").toLowerCase() === "header"
      ? "header"
      : "bearer",
    apiKeyHeader: env.EINVOICE_API_KEY_HEADER || "x-api-key",
    timeoutMs: Number(env.EINVOICE_API_TIMEOUT_MS) > 0 ? Number(env.EINVOICE_API_TIMEOUT_MS) : 20_000,
  };
}

export class HttpEInvoiceProvider implements EInvoiceProvider {
  readonly name = "http";
  private readonly cfg: HttpProviderConfig;

  constructor(env: NodeJS.ProcessEnv = process.env) {
    this.cfg = readConfig(env);
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json",
    };
    if (this.cfg.authStyle === "bearer") h.Authorization = `Bearer ${this.cfg.apiKey}`;
    else h[this.cfg.apiKeyHeader] = this.cfg.apiKey;
    return h;
  }

  private async request(
    method: "GET" | "POST",
    path: string,
    body?: unknown
  ): Promise<{ ok: boolean; status: number; json: any; text: string }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.cfg.timeoutMs);
    try {
      const res = await fetch(`${this.cfg.baseUrl}${path}`, {
        method,
        headers: this.headers(),
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
      const text = await res.text();
      let json: any = null;
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

  async submit(submission: EInvoiceSubmission): Promise<EInvoiceProviderResult> {
    // The XML is sent base64-encoded: it is a signed document and must survive
    // JSON transport byte-for-byte.
    const payload = {
      invoiceNumber: submission.invoiceNumber,
      uuid: submission.uuid,
      documentFormat: "PINT_AE",
      documentEncoding: "base64",
      document: Buffer.from(submission.xml, "utf8").toString("base64"),
    };

    let r;
    try {
      r = await this.request("POST", "/invoices", payload);
    } catch (err: any) {
      // Transport failure. Retryable — never report this as delivered.
      log.error({ err: err?.message, invoiceId: submission.invoiceId }, "ASP submit transport error");
      return {
        providerMessageId: "",
        status: "failed",
        detail: `Transport error contacting the service provider: ${err?.message ?? "unknown"}`,
      };
    }

    if (!r.ok) {
      log.error(
        { status: r.status, invoiceId: submission.invoiceId, body: r.text.slice(0, 500) },
        "ASP rejected submission"
      );
      return {
        providerMessageId: String(r.json?.id ?? r.json?.documentId ?? ""),
        // 4xx is a business rejection (fix the invoice); 5xx is transport (retry).
        status: r.status >= 400 && r.status < 500 ? "rejected" : "failed",
        detail: r.json?.message ?? r.json?.error ?? `HTTP ${r.status}`,
        raw: r.json ?? r.text,
      };
    }

    const providerMessageId = String(r.json?.id ?? r.json?.documentId ?? r.json?.messageId ?? "");
    if (!providerMessageId) {
      // Without an id we cannot poll for clearance, so we cannot claim success.
      return {
        providerMessageId: "",
        status: "failed",
        detail: "Service provider accepted the request but returned no document id to track.",
        raw: r.json ?? r.text,
      };
    }

    return {
      providerMessageId,
      status: mapProviderStatus(r.json?.status ?? "submitted"),
      detail: r.json?.message ?? null,
      raw: r.json,
    };
  }

  async getStatus(providerMessageId: string): Promise<EInvoiceProviderResult> {
    let r;
    try {
      r = await this.request("GET", `/invoices/${encodeURIComponent(providerMessageId)}`);
    } catch (err: any) {
      return {
        providerMessageId,
        status: "failed",
        detail: `Transport error polling the service provider: ${err?.message ?? "unknown"}`,
      };
    }
    if (!r.ok) {
      return {
        providerMessageId,
        status: "failed",
        detail: r.json?.message ?? `HTTP ${r.status}`,
        raw: r.json ?? r.text,
      };
    }
    return {
      providerMessageId,
      status: mapProviderStatus(r.json?.status),
      detail: r.json?.message ?? null,
      raw: r.json,
    };
  }

  parseWebhook(
    payload: unknown
  ): { providerMessageId: string; status: EInvoiceStatus; detail?: string | null } | null {
    if (!payload || typeof payload !== "object") return null;
    const p = payload as Record<string, any>;
    const id = p.id ?? p.documentId ?? p.messageId ?? p.data?.id;
    const status = p.status ?? p.event ?? p.data?.status;
    if (!id || !status) return null;
    return {
      providerMessageId: String(id),
      status: mapProviderStatus(status),
      detail: p.message ?? p.detail ?? null,
    };
  }
}
