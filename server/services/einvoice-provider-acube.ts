// A-Cube adapter for UAE e-invoicing (MoF-accredited ASP, "Platform ACube
// Technologies LLC", accreditation no. 188961).
//
// Built against A-Cube's published UAE API (docs.acubeapi.com/documentation/gov-ae,
// OpenAPI: docs.acubeapi.com/openapi/gov-ae-api.json):
//
//   POST {login}                     { email, password, environment } -> { token }  (JWT, 24h)
//   POST {base}/invoices/outgoing     body = PINT AE UBL XML (application/xml) -> 201 { invoiceId, status, ... }
//   POST {base}/credit-notes/outgoing body = PINT AE UBL XML                     -> 201 { ... }
//   GET  {base}/invoices/{uuid}                                                 -> { invoiceId, status, ... }
//
// A-Cube takes our generated XML byte-for-byte, so no field mapping lives here.
// The seller company must first be linked to A-Cube as a legal entity through
// the EmaraTax onboarding flow; until then sends return 404 "Legal entity not found".
//
// ENVIRONMENT
//   EINVOICE_PROVIDER=acube
//   ACUBE_EMAIL / ACUBE_PASSWORD   A-Cube platform credentials              (required)
//   ACUBE_ENVIRONMENT              "sandbox" (default) | "production"
//   ACUBE_API_BASE_URL             override; defaults per environment
//   ACUBE_LOGIN_URL                override; default https://common.api.acubeapi.com/login
//   ACUBE_TIMEOUT_MS               request timeout, default 20000

import type {
  EInvoiceProvider,
  EInvoiceProviderResult,
  EInvoiceSubmission,
} from "./einvoice-provider";
import type { EInvoiceStatus } from "./einvoice-status";
import { createLogger } from "../config/logger";

const log = createLogger("einvoice-acube");

const BASE_URLS = {
  sandbox: "https://ae-sandbox.api.acubeapi.com",
  production: "https://ae.api.acubeapi.com",
} as const;
const DEFAULT_LOGIN_URL = "https://common.api.acubeapi.com/login";
// Refresh well before the documented 24h expiry.
const TOKEN_TTL_MS = 23 * 60 * 60 * 1000;

/**
 * A-Cube's document status vocabulary (OpenAPI enum plus the names used on the
 * lifecycle page) mapped onto our six statuses. Anything not listed falls
 * through to "failed": an unknown state must never read as cleared.
 */
const ACUBE_STATUS_MAP: Record<string, EInvoiceStatus> = {
  new: "submitted",
  valid: "submitted",
  sending_started: "submitted",
  sending_queued: "submitted",
  processed: "submitted",
  delivered: "accepted",
  accepted: "accepted",
  rejected: "rejected",
  // Needs a human fix on the document before it can go again.
  action_required: "rejected",
  sending_failed: "failed",
  sending_error: "failed",
  delivery_failed: "failed",
  delivery_error: "failed",
  withdrawn: "failed",
};

export function mapACubeStatus(raw: unknown): EInvoiceStatus {
  const key = String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  const mapped = ACUBE_STATUS_MAP[key];
  if (mapped) return mapped;
  log.warn({ raw }, "Unknown A-Cube status; treating as failed");
  return "failed";
}

interface ACubeConfig {
  email: string;
  password: string;
  environment: "sandbox" | "production";
  baseUrl: string;
  loginUrl: string;
  timeoutMs: number;
}

function readConfig(env: NodeJS.ProcessEnv): ACubeConfig {
  const email = env.ACUBE_EMAIL || "";
  const password = env.ACUBE_PASSWORD || "";
  if (!email || !password) {
    throw new Error(
      "A-Cube e-invoicing requires ACUBE_EMAIL and ACUBE_PASSWORD (your A-Cube platform login)."
    );
  }
  const environment =
    (env.ACUBE_ENVIRONMENT || "sandbox").toLowerCase() === "production" ? "production" : "sandbox";
  return {
    email,
    password,
    environment,
    baseUrl: (env.ACUBE_API_BASE_URL || BASE_URLS[environment]).replace(/\/+$/, ""),
    loginUrl: env.ACUBE_LOGIN_URL || DEFAULT_LOGIN_URL,
    timeoutMs: Number(env.ACUBE_TIMEOUT_MS) > 0 ? Number(env.ACUBE_TIMEOUT_MS) : 20_000,
  };
}

/** Summarise an A-Cube error body (problem+json or constraint violations). */
function errorDetail(json: any, httpStatus: number): string {
  const violations = Array.isArray(json?.violations)
    ? json.violations
        .map((v: any) => [v?.propertyPath, v?.message].filter(Boolean).join(": "))
        .filter(Boolean)
    : [];
  if (violations.length) return violations.join("; ");
  return json?.detail || json?.title || json?.message || `HTTP ${httpStatus}`;
}

export class ACubeEInvoiceProvider implements EInvoiceProvider {
  readonly name = "acube";
  private readonly cfg: ACubeConfig;
  private token: { value: string; expiresAt: number } | null = null;

  constructor(env: NodeJS.ProcessEnv = process.env) {
    this.cfg = readConfig(env);
  }

  private async fetchWithTimeout(url: string, init: RequestInit) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.cfg.timeoutMs);
    try {
      const res = await fetch(url, { ...init, signal: controller.signal });
      const text = await res.text();
      let json: any = null;
      try {
        json = JSON.parse(text);
      } catch {
        /* non-JSON body; keep text for the audit trail */
      }
      return { ok: res.ok, status: res.status, json, text };
    } finally {
      clearTimeout(timer);
    }
  }

  private async getToken(forceRefresh = false): Promise<string> {
    if (!forceRefresh && this.token && this.token.expiresAt > Date.now()) return this.token.value;
    const r = await this.fetchWithTimeout(this.cfg.loginUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        email: this.cfg.email,
        password: this.cfg.password,
        environment: this.cfg.environment,
      }),
    });
    const value = r.json?.token;
    if (!r.ok || typeof value !== "string" || !value) {
      throw new Error(`A-Cube login failed (HTTP ${r.status})`);
    }
    this.token = { value, expiresAt: Date.now() + TOKEN_TTL_MS };
    return value;
  }

  /** Authenticated request; re-logs in once if the cached token was rejected. */
  private async request(method: "GET" | "POST", path: string, xmlBody?: string) {
    const send = async (token: string) =>
      this.fetchWithTimeout(`${this.cfg.baseUrl}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
          ...(xmlBody !== undefined ? { "Content-Type": "application/xml" } : {}),
        },
        body: xmlBody,
      });
    let r = await send(await this.getToken());
    if (r.status === 401) r = await send(await this.getToken(true));
    return r;
  }

  async submit(submission: EInvoiceSubmission): Promise<EInvoiceProviderResult> {
    const isCreditNote = /<(?:\w+:)?CreditNote[\s>]/.test(submission.xml);
    const path = isCreditNote ? "/credit-notes/outgoing" : "/invoices/outgoing";

    let r;
    try {
      r = await this.request("POST", path, submission.xml);
    } catch (err: any) {
      log.error(
        { err: err?.message, invoiceId: submission.invoiceId },
        "A-Cube submit transport error"
      );
      return {
        providerMessageId: "",
        status: "failed",
        detail: `Could not reach A-Cube: ${err?.message ?? "unknown error"}`,
      };
    }

    if (!r.ok) {
      log.error(
        { status: r.status, invoiceId: submission.invoiceId, body: r.text.slice(0, 500) },
        "A-Cube refused submission"
      );
      // 400/422 = the document itself is wrong (fix and resubmit).
      // 404 = seller legal entity not onboarded; 401/403/5xx = config or transport. Retryable.
      const isDocumentProblem = r.status === 400 || r.status === 422;
      const detail =
        r.status === 404
          ? "A-Cube has no legal entity for this seller TRN. Complete the EmaraTax onboarding for this company in A-Cube first."
          : errorDetail(r.json, r.status);
      return {
        providerMessageId: "",
        status: isDocumentProblem ? "rejected" : "failed",
        detail,
        raw: r.json ?? r.text,
      };
    }

    const providerMessageId = String(r.json?.invoiceId ?? r.json?.uuid ?? r.json?.id ?? "");
    if (!providerMessageId) {
      return {
        providerMessageId: "",
        status: "failed",
        detail: "A-Cube accepted the request but returned no document id to track.",
        raw: r.json ?? r.text,
      };
    }
    return {
      providerMessageId,
      status: mapACubeStatus(r.json?.status ?? "new"),
      detail: null,
      raw: r.json,
    };
  }

  async getStatus(providerMessageId: string): Promise<EInvoiceProviderResult> {
    let r;
    try {
      // Credit notes live under their own collection; try invoices first.
      r = await this.request("GET", `/invoices/${encodeURIComponent(providerMessageId)}`);
      if (r.status === 404) {
        r = await this.request("GET", `/credit-notes/${encodeURIComponent(providerMessageId)}`);
      }
    } catch (err: any) {
      return {
        providerMessageId,
        status: "failed",
        detail: `Could not reach A-Cube: ${err?.message ?? "unknown error"}`,
      };
    }
    if (!r.ok) {
      return {
        providerMessageId,
        status: "failed",
        detail: errorDetail(r.json, r.status),
        raw: r.json ?? r.text,
      };
    }
    return { providerMessageId, status: mapACubeStatus(r.json?.status), detail: null, raw: r.json };
  }

  /**
   * A-Cube's document-event payload is not published in detail. Accept the id
   * under any of the names its API uses; when the event carries no status,
   * report "submitted" so the caller re-polls getStatus for the real outcome
   * instead of guessing.
   */
  parseWebhook(
    payload: unknown
  ): { providerMessageId: string; status: EInvoiceStatus; detail?: string | null } | null {
    if (!payload || typeof payload !== "object") return null;
    const p = payload as Record<string, any>;
    const doc = p.data ?? p.document ?? p;
    const id = doc.invoiceId ?? doc.creditNoteId ?? doc.uuid ?? doc.documentId ?? p.uuid;
    if (!id) return null;
    const rawStatus = doc.status ?? (p.eventType === "document.delivered" ? "delivered" : null);
    return {
      providerMessageId: String(id),
      status: rawStatus ? mapACubeStatus(rawStatus) : "submitted",
      detail: null,
    };
  }
}
