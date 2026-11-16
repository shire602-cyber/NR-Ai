// Complyance adapter for UAE e-invoicing (MoF-accredited ASP, "Complyance
// Electronics L.L.C").
//
// Built against Complyance's published Unify API (docs.complyance.io):
//
//   POST {base}/api/v3/unify                         Authorization: Bearer <key>
//        Content-Type: application/xml, body = <UnifyRequest> envelope whose
//        <payload> holds our PINT AE UBL invoice  -> 200 { documentId, ... } | 422 { errors }
//   GET  {base}/api/v3/documents/{documentId}?type=sales
//        -> { success, data: { state, isTerminal, errors, compliance: { ftaApprovedStatus } } }
//
// We use Unify's XML request form so the XML we already generate is what goes
// over the wire. Complyance reads <payload> through the source's mapping, so a
// one-time setup is needed in their Developer portal: send one sample with
// purpose "mapping" (see buildUnifyXmlRequest), map it in the Integration
// engine, then submit with purpose "invoicing".
//
// Complyance has no webhook for the final FTA/Peppol outcome (invoice.passed /
// invoice.failed only report validation), so getStatus polling is the source
// of truth.
//
// ENVIRONMENT
//   EINVOICE_PROVIDER=complyance
//   COMPLYANCE_API_KEY             sandbox or production key            (required)
//   COMPLYANCE_SOURCE              default source, "name:version"       (required unless every
//                                  seller is in COMPLYANCE_SOURCES_BY_TRN)
//   COMPLYANCE_SOURCES_BY_TRN      optional JSON {"<15-digit TRN>": "name:version"} for
//                                  ISV setups where each client company has its own source
//   COMPLYANCE_ENVIRONMENT         "sandbox" (default) | "production"; must match the key
//   COMPLYANCE_API_BASE_URL        override; default https://prod.gets.complyance.io
//   COMPLYANCE_TIMEOUT_MS          request timeout, default 20000

import type {
  EInvoiceProvider,
  EInvoiceProviderResult,
  EInvoiceSubmission,
} from "./einvoice-provider";
import type { EInvoiceStatus } from "./einvoice-status";
import { createLogger } from "../config/logger";

const log = createLogger("einvoice-complyance");

const DEFAULT_BASE_URL = "https://prod.gets.complyance.io";
export const COMPLYANCE_USER_AGENT = "Muhasib-EInvoicing/1.0";

/**
 * Complyance document `state` -> our status. delivery_failed is NOT terminal
 * in the UAE (Complyance keeps retrying), so it stays "submitted"; resending
 * under a new number would create a duplicate invoice.
 */
const COMPLYANCE_STATE_MAP: Record<string, EInvoiceStatus> = {
  submitted: "submitted",
  processing: "submitted",
  delivery_success: "submitted",
  delivery_failed: "submitted",
  final_valid: "accepted",
  final_invalid: "rejected",
  rejected: "rejected",
};

export function mapComplyanceState(raw: unknown): EInvoiceStatus {
  const key = String(raw ?? "")
    .trim()
    .toLowerCase();
  const mapped = COMPLYANCE_STATE_MAP[key];
  if (mapped) return mapped;
  log.warn({ raw }, "Unknown Complyance state; treating as failed");
  return "failed";
}

interface ComplyanceConfig {
  apiKey: string;
  environment: "sandbox" | "production";
  defaultSource: string;
  sourcesByTrn: Record<string, string>;
  baseUrl: string;
  timeoutMs: number;
}

const SOURCE_RE = /^.+:.+$/;

function readConfig(env: NodeJS.ProcessEnv): ComplyanceConfig {
  const apiKey = env.COMPLYANCE_API_KEY || "";
  if (!apiKey) {
    throw new Error(
      "Complyance e-invoicing requires COMPLYANCE_API_KEY (from the Developer portal)."
    );
  }
  let sourcesByTrn: Record<string, string> = {};
  if (env.COMPLYANCE_SOURCES_BY_TRN) {
    try {
      sourcesByTrn = JSON.parse(env.COMPLYANCE_SOURCES_BY_TRN);
    } catch {
      throw new Error(
        'COMPLYANCE_SOURCES_BY_TRN must be JSON, e.g. {"100000000000003":"acme-dubai:v1"}.'
      );
    }
  }
  const defaultSource = env.COMPLYANCE_SOURCE || "";
  if (!defaultSource && Object.keys(sourcesByTrn).length === 0) {
    throw new Error(
      'Complyance e-invoicing requires COMPLYANCE_SOURCE ("name:version") or COMPLYANCE_SOURCES_BY_TRN.'
    );
  }
  for (const s of [defaultSource, ...Object.values(sourcesByTrn)].filter(Boolean)) {
    if (!SOURCE_RE.test(s))
      throw new Error(`Complyance source "${s}" must be in "name:version" form.`);
  }
  return {
    apiKey,
    environment:
      (env.COMPLYANCE_ENVIRONMENT || "sandbox").toLowerCase() === "production"
        ? "production"
        : "sandbox",
    defaultSource,
    sourcesByTrn,
    baseUrl: (env.COMPLYANCE_API_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, ""),
    timeoutMs: Number(env.COMPLYANCE_TIMEOUT_MS) > 0 ? Number(env.COMPLYANCE_TIMEOUT_MS) : 20_000,
  };
}

function escapeText(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Wrap our PINT AE document in Unify's XML envelope. The XML declaration is
 * stripped because the document becomes a child of <payload>; DTDs are not
 * accepted by Unify (our generator never emits one).
 */
export function buildUnifyXmlRequest(args: {
  xml: string;
  environment: "sandbox" | "production";
  source: string;
  purpose: "invoicing" | "validate" | "mapping";
}): string {
  const body = args.xml.replace(/^\uFEFF?\s*<\?xml[^?]*\?>\s*/, "");
  const isCreditNote =
    /<(?:\w+:)?CreditNote[\s>]/.test(body) || /<cbc:InvoiceTypeCode[^>]*>\s*381\s*</.test(body);
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    "<UnifyRequest>",
    "<country>AE</country>",
    `<environment>${args.environment}</environment>`,
    `<purpose>${args.purpose}</purpose>`,
    `<source>${escapeText(args.source)}</source>`,
    `<documentType><base>${isCreditNote ? "credit_note" : "tax_invoice"}</base><modifiers/></documentType>`,
    `<payload>${body}</payload>`,
    "</UnifyRequest>",
  ].join("\n");
}

function summariseErrors(errors: unknown): string | null {
  if (!Array.isArray(errors) || errors.length === 0) return null;
  return errors
    .map((e: any) => {
      const where =
        e?.getsPath || e?.payloadPath || (Array.isArray(e?.path) ? e.path.join(".") : null);
      return [e?.code, where, e?.message].filter(Boolean).join(" · ");
    })
    .filter(Boolean)
    .join("; ");
}

export class ComplyanceEInvoiceProvider implements EInvoiceProvider {
  readonly name = "complyance";
  private readonly cfg: ComplyanceConfig;

  constructor(env: NodeJS.ProcessEnv = process.env) {
    this.cfg = readConfig(env);
  }

  /** Which Complyance source sends for this seller. */
  sourceFor(sellerTrn?: string | null): string | null {
    if (sellerTrn && this.cfg.sourcesByTrn[sellerTrn]) return this.cfg.sourcesByTrn[sellerTrn];
    return this.cfg.defaultSource || null;
  }

  private async request(method: "GET" | "POST", path: string, xmlBody?: string) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.cfg.timeoutMs);
    try {
      const res = await fetch(`${this.cfg.baseUrl}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.cfg.apiKey}`,
          Accept: "application/json",
          // Complyance's WAF answers 403 to requests without a User-Agent.
          "User-Agent": COMPLYANCE_USER_AGENT,
          ...(xmlBody !== undefined ? { "Content-Type": "application/xml; charset=utf-8" } : {}),
        },
        body: xmlBody,
        signal: controller.signal,
      });
      const text = await res.text();
      let json: any = null;
      try {
        json = JSON.parse(text);
      } catch {
        /* non-JSON body (e.g. WAF block page); keep text for the audit trail */
      }
      return { ok: res.ok, status: res.status, json, text };
    } finally {
      clearTimeout(timer);
    }
  }

  async submit(submission: EInvoiceSubmission): Promise<EInvoiceProviderResult> {
    const source = this.sourceFor(submission.sellerTrn);
    if (!source) {
      return {
        providerMessageId: "",
        status: "failed",
        detail: `No Complyance source is configured for seller TRN ${submission.sellerTrn ?? "(none)"}.`,
      };
    }
    const body = buildUnifyXmlRequest({
      xml: submission.xml,
      environment: this.cfg.environment,
      source,
      purpose: "invoicing",
    });

    let r;
    try {
      r = await this.request("POST", "/api/v3/unify", body);
    } catch (err: any) {
      // Timeout or dropped connection: the document may have been stored.
      // Resending the same number is safe (Complyance dedupes on documentNumber).
      log.error(
        { err: err?.message, invoiceId: submission.invoiceId },
        "Complyance submit transport error"
      );
      return {
        providerMessageId: "",
        status: "failed",
        detail: `Could not reach Complyance: ${err?.message ?? "unknown error"}. Safe to resend.`,
      };
    }

    if (r.status === 422) {
      const errors = r.json?.errors;
      const duplicate =
        Array.isArray(errors) && errors.some((e: any) => e?.code === "GETS-HEAD-010");
      if (duplicate && !r.json?.documentId) {
        // An earlier attempt was stored; this 422 carries no id to poll.
        return {
          providerMessageId: "",
          status: "failed",
          detail: `Complyance already has invoice ${submission.invoiceNumber}: ${summariseErrors(errors)}. Find it in the Complyance Invoice Portal.`,
          raw: r.json,
        };
      }
      return {
        providerMessageId: String(r.json?.documentId ?? ""),
        status: "rejected",
        detail: summariseErrors(errors) ?? r.json?.message ?? "Complyance validation failed.",
        raw: r.json,
      };
    }

    if (!r.ok) {
      // 400/401/403/404/409/412 are configuration problems (key, source,
      // mapping), not invoice data problems; 429/5xx are transient.
      log.error(
        { status: r.status, invoiceId: submission.invoiceId, body: r.text.slice(0, 500) },
        "Complyance refused submission"
      );
      const reason = r.json?.reason ? ` (${r.json.reason})` : "";
      return {
        providerMessageId: "",
        status: "failed",
        detail: `${r.json?.error ?? r.json?.message ?? `HTTP ${r.status}`}${reason}`,
        raw: r.json ?? r.text,
      };
    }

    const providerMessageId = String(r.json?.documentId ?? "");
    if (!providerMessageId) {
      return {
        providerMessageId: "",
        status: "failed",
        detail: "Complyance accepted the request but returned no documentId to track.",
        raw: r.json ?? r.text,
      };
    }
    return { providerMessageId, status: "submitted", detail: r.json?.message ?? null, raw: r.json };
  }

  async getStatus(providerMessageId: string): Promise<EInvoiceProviderResult> {
    let r;
    try {
      r = await this.request(
        "GET",
        `/api/v3/documents/${encodeURIComponent(providerMessageId)}?type=sales`
      );
    } catch (err: any) {
      return {
        providerMessageId,
        status: "failed",
        detail: `Could not reach Complyance: ${err?.message ?? "unknown error"}`,
      };
    }
    const data = r.json?.data;
    if (!r.ok || !data) {
      return {
        providerMessageId,
        status: "failed",
        detail: r.json?.message ?? `HTTP ${r.status}`,
        raw: r.json ?? r.text,
      };
    }
    return {
      providerMessageId,
      status: mapComplyanceState(data.state),
      detail: summariseErrors(data.errors),
      raw: r.json,
    };
  }

  /**
   * Complyance webhooks (invoice.passed / invoice.failed) only report the
   * validation result at send time, not the FTA outcome. Treat them as a nudge
   * to re-poll: report "submitted" for a pass and "rejected" for a failure.
   */
  parseWebhook(
    payload: unknown
  ): { providerMessageId: string; status: EInvoiceStatus; detail?: string | null } | null {
    if (!payload || typeof payload !== "object") return null;
    const p = payload as Record<string, any>;
    const data = p.data ?? p;
    const id = data.documentId ?? p.documentId;
    const event = String(p.event ?? p.type ?? p.eventType ?? "").toLowerCase();
    if (!id) return null;
    if (event === "invoice.failed") {
      return {
        providerMessageId: String(id),
        status: "rejected",
        detail: summariseErrors(data.errors),
      };
    }
    if (event === "invoice.passed")
      return { providerMessageId: String(id), status: "submitted", detail: null };
    if (data.state)
      return {
        providerMessageId: String(id),
        status: mapComplyanceState(data.state),
        detail: null,
      };
    return null;
  }
}
