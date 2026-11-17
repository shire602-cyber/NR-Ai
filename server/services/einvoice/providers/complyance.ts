/**
 * Complyance UAE e-invoicing adapter (E2).
 *
 * Complyance (Complyance Electronics L.L.C) is on the Ministry of Finance register of accredited
 * e-invoicing service providers, accreditation no. 112219 (register row 15 of 88, page "Last
 * updated on 16/11/2026", read 2026-11-17). It is our Peppol corner 2: it validates the invoice,
 * produces the PINT AE e-invoice, delivers it to the buyer's ASP over Peppol and reports the tax
 * data document (TDD) to the FTA. API facts: docs.complyance.io, read 2026-11-17; see
 * docs/einvoicing-complyance.md for every open question to confirm in its sandbox.
 *
 * How it differs from A-Cube, and what this adapter does about it:
 *   - Auth is a static API key per workspace and environment (sandbox "mock" key / production
 *     key), no login: `Authorization: Bearer` on Unify/documents, `X-API-Key` on Connect.
 *   - One host for both environments; the request body's `environment` must match the key.
 *   - Unify takes GETS JSON (or XML through a mapping), not raw PINT AE: we map our validated
 *     UBL to GETS (complyance-gets.ts). COMPLYANCE_SUBMIT_FORMAT=xml sends the UBL itself in a
 *     UnifyRequest envelope for a workspace that built an XML mapping.
 *   - Idempotency is by document number per workspace/country/environment: a repeat answers 422
 *     GETS-HEAD-010 without the document id, and there is no sales listing to look it up, so an
 *     ambiguous transport failure ends as "already held by Complyance" for a person to link.
 *   - Final status (buyer ASP + FTA) is only learnt by polling GET /api/v3/documents/{id}; the
 *     invoice.passed / invoice.failed webhooks only report validation at submission.
 *
 * ENVIRONMENT (secrets come from env / the secret store only and are never logged)
 *   EINVOICE_PROVIDER=complyance     selects this adapter
 *   COMPLYANCE_ENV                   sandbox (default) | production
 *   COMPLYANCE_API_KEY               workspace API key for that environment (read + write)
 *   COMPLYANCE_BASE_URL              default https://prod.gets.complyance.io (both environments)
 *   COMPLYANCE_SUBMIT_FORMAT         gets (default, Default GETS Mapping) | xml
 *   COMPLYANCE_SOURCE_PREFIX         invoice source name prefix per company (default "muhasib")
 *   COMPLYANCE_SOURCE_VERSION        invoice source version (default "v1")
 *   COMPLYANCE_USER_AGENT            required by Complyance's WAF (default Muhasib-EInvoicing/1.0)
 *   COMPLYANCE_TIMEOUT_MS            default 30000
 *   COMPLYANCE_POLL_DAYS             purchase listing window for the poll fallback (default 3)
 *   COMPLYANCE_WEBHOOK_SECRET        HMAC signing secret of the Complyance webhook
 *   COMPLYANCE_WEBHOOK_ALGORITHM     sha256 (default) | sha512
 *   COMPLYANCE_WEBHOOK_MAX_AGE_SECONDS  timestamp window (default 3600)
 */
import type {
  EInvoiceDocumentRef,
  EInvoiceProvider,
  EInvoiceProviderCapabilities,
  EInvoiceProviderEnvironment,
  EInvoiceProviderResult,
  EInvoiceSubmission,
  InboundEInvoice,
  InboundListing,
  InboundOwner,
  LegalEntityPatch,
} from "../../einvoice-provider";
import type { EInvoiceRejectionReason } from "../../einvoice-status";
import { createLogger } from "../../../config/logger";
import { legacyFromTracks, type DeliveryStatus, type ReportingStatus } from "../tracks";
import type { EInvoiceProviderModule } from "./types";
import { ublToGets, unifyXmlRequest } from "./complyance-gets";

const log = createLogger("einvoice-complyance");

export const COMPLYANCE_PROVIDER_NAME = "complyance";
export const COMPLYANCE_ACCREDITATION_NUMBER = "112219";
export const COMPLYANCE_LEGAL_NAME = "Complyance Electronics L.L.C";

export type ComplyanceEnvironment = "sandbox" | "production";
export type ComplyanceSubmitFormat = "gets" | "xml";

export function complyanceConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return !!env.COMPLYANCE_API_KEY;
}

export function complyanceEnvironment(env: NodeJS.ProcessEnv = process.env): ComplyanceEnvironment {
  return (env.COMPLYANCE_ENV ?? "").toLowerCase() === "production" ? "production" : "sandbox";
}

export interface ComplyanceConfig {
  environment: ComplyanceEnvironment;
  baseUrl: string;
  apiKey: string;
  submitFormat: ComplyanceSubmitFormat;
  sourcePrefix: string;
  sourceVersion: string;
  userAgent: string;
  timeoutMs: number;
  pollDays: number;
}

export function readComplyanceConfig(env: NodeJS.ProcessEnv = process.env): ComplyanceConfig {
  if (!complyanceConfigured(env)) throw new Error("Complyance requires COMPLYANCE_API_KEY.");
  const timeout = Number(env.COMPLYANCE_TIMEOUT_MS);
  const days = Number(env.COMPLYANCE_POLL_DAYS);
  return {
    environment: complyanceEnvironment(env),
    baseUrl: (env.COMPLYANCE_BASE_URL || "https://prod.gets.complyance.io").replace(/\/+$/, ""),
    apiKey: env.COMPLYANCE_API_KEY as string,
    submitFormat: (env.COMPLYANCE_SUBMIT_FORMAT ?? "").toLowerCase() === "xml" ? "xml" : "gets",
    sourcePrefix: (env.COMPLYANCE_SOURCE_PREFIX || "muhasib").replace(/[^A-Za-z0-9._-]/g, ""),
    sourceVersion: env.COMPLYANCE_SOURCE_VERSION || "v1",
    userAgent: env.COMPLYANCE_USER_AGENT || "Muhasib-EInvoicing/1.0",
    timeoutMs: timeout > 0 ? timeout : 30_000,
    pollDays: Number.isInteger(days) && days > 0 && days <= 31 ? days : 3,
  };
}

/** The invoice source Complyance knows a company by (name:version in every Unify request). */
export interface ComplyanceSource {
  name: string;
  version: string;
}

/** Deterministic, workspace-unique source name for one of our companies. */
export function defaultSourceFor(
  companyId: string,
  cfg: Pick<ComplyanceConfig, "sourcePrefix" | "sourceVersion">
): ComplyanceSource {
  return { name: `${cfg.sourcePrefix}-${companyId}`, version: cfg.sourceVersion };
}

export class ComplyanceApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly body?: unknown,
    public readonly retryable = false
  ) {
    super(message);
    this.name = "ComplyanceApiError";
  }
}

/** A Connect company item (POST/GET /v3/connect/companies), as documented. */
export interface ComplyanceCompany {
  companyId: string;
  sourceId?: string | null;
  branchId?: string | null;
  userGivenBranchId?: string | null;
  peppolParticipantId?: string | null;
  peppolId?: string | null;
  legalName?: string | null;
  legalNameArabic?: string | null;
  tin?: string | null;
  vatTrn?: string | null;
  sourceName?: string | null;
  sourceVersion?: string | null;
  branchName?: string | null;
  status?: string | null;
  onboardingStatus?: string | null;
  platformEnvironment?: string | null;
  readyForInvoicing?: boolean;
  mappingReadiness?: { status?: string; code?: string; templateId?: string } | null;
}

interface RawResponse {
  ok: boolean;
  status: number;
  json: unknown;
  text: string;
  retryAfter: number | null;
}

const str = (v: unknown): string | null =>
  v === undefined || v === null || v === "" ? null : String(v);

// ─── Status mapping (two tracks) ─────────────────────────────────────────

export interface ComplyanceTrackOutcome {
  delivery: DeliveryStatus;
  reporting: ReportingStatus;
  errorCode: string | null;
  reasons: EInvoiceRejectionReason[];
}

/** Each entry of a document's `errors` (code, message, path[], source). */
export function complyanceReasons(errors: unknown): EInvoiceRejectionReason[] {
  const list = Array.isArray(errors) ? errors : [];
  return list.map((e) => {
    const r = (e ?? {}) as Record<string, unknown>;
    const path = Array.isArray(r.path) ? r.path.map(String).join(".") : str(r.path);
    return {
      code: str(r.code) ?? "COMPLYANCE",
      message: str(r.message) ?? "Validation failed",
      field: str(r.getsPath) ?? path ?? str(r.payloadPath),
    };
  });
}

/**
 * Complyance document status -> our two tracks (docs /api-reference/unify/documents/, UAE):
 *   submitted          passed validation, delivery not started    -> queued / pending
 *   processing         delivery started or an answer is awaited   -> sending / pending
 *   delivery_success   handed to the buyer's ASP (C3), not final  -> delivered / pending
 *   delivery_failed    an attempt failed, NOT final in the UAE: Complyance keeps trying and
 *                      says not to resend under a new number      -> sending / pending
 *                      (terminal only if isTerminal says so)      -> delivery_failed
 *   final_valid        buyer's ASP and the FTA both accepted      -> delivered / reported
 *   final_invalid      buyer's ASP or the FTA rejected            -> by the errors' source:
 *                      government -> delivered / report_failed; otherwise rejected / pending
 *   rejected           failed validation (Needs Correction)       -> rejected / pending
 * Unknown states never read as success: delivery_failed with COMPLYANCE_UNKNOWN_STATE.
 */
export function mapComplyanceStatus(data: Record<string, unknown>): ComplyanceTrackOutcome {
  const state = String(data.state ?? "")
    .trim()
    .toLowerCase();
  const terminal = data.isTerminal === true;
  const reasons = complyanceReasons(data.errors);
  const compliance = (data.compliance ?? {}) as Record<string, unknown>;
  const steps = (((data.validationResults ?? {}) as Record<string, unknown>).validationSteps ??
    []) as Array<Record<string, unknown>>;
  const delivered = steps.some(
    (s) => /delivery success/i.test(String(s.name ?? "")) && String(s.status) === "Valid"
  );
  switch (state) {
    case "submitted":
      return { delivery: "queued", reporting: "pending", errorCode: null, reasons: [] };
    case "processing":
      return { delivery: "sending", reporting: "pending", errorCode: null, reasons: [] };
    case "delivery_success":
      return { delivery: "delivered", reporting: "pending", errorCode: null, reasons: [] };
    case "delivery_failed":
      return terminal
        ? {
            delivery: "delivery_failed",
            reporting: "pending",
            errorCode: "COMPLYANCE_DELIVERY_FAILED",
            reasons,
          }
        : { delivery: "sending", reporting: "pending", errorCode: null, reasons: [] };
    case "final_valid":
      return { delivery: "delivered", reporting: "reported", errorCode: null, reasons: [] };
    case "final_invalid": {
      const sources = new Set(
        (Array.isArray(data.errors) ? data.errors : []).map((e) =>
          String((e as Record<string, unknown>)?.source ?? "").toLowerCase()
        )
      );
      if (sources.has("government") || (delivered && !sources.has("delivery"))) {
        return {
          delivery: "delivered",
          reporting: "report_failed",
          errorCode: "EINVOICE_REPORT_FAILED",
          reasons,
        };
      }
      return {
        delivery: "rejected",
        reporting: "pending",
        errorCode: "COMPLYANCE_FINAL_INVALID",
        reasons,
      };
    }
    case "rejected":
      return {
        delivery: "rejected",
        reporting: "pending",
        errorCode: "COMPLYANCE_VALIDATION",
        reasons,
      };
    default:
      if (String(compliance.ftaApprovedStatus ?? "") === "APPROVED") {
        return { delivery: "delivered", reporting: "reported", errorCode: null, reasons: [] };
      }
      return {
        delivery: "delivery_failed",
        reporting: "pending",
        errorCode: "COMPLYANCE_UNKNOWN_STATE",
        reasons,
      };
  }
}

/** Connect company -> our legal-entity status vocabulary (legal-entities.ts). */
export function complyanceLegalEntityStatus(
  c: Pick<ComplyanceCompany, "status" | "onboardingStatus" | "readyForInvoicing">
): "pending" | "active" | "inactive" {
  if (String(c.status ?? "").toLowerCase() === "inactive") return "inactive";
  if (String(c.onboardingStatus ?? "onboarded").toLowerCase() === "draft") return "pending";
  return c.readyForInvoicing ? "active" : "pending";
}

/** A Connect company as a row patch (einvoice_legal_entities). */
export function patchFromComplyance(
  c: ComplyanceCompany,
  previousDetails: Record<string, unknown> | null = null,
  now: Date = new Date()
): LegalEntityPatch {
  const status = complyanceLegalEntityStatus(c);
  const peppol = str(c.peppolParticipantId) ?? str(c.peppolId);
  const details: Record<string, unknown> = { ...(previousDetails ?? {}) };
  for (const k of [
    "sourceId",
    "sourceName",
    "sourceVersion",
    "branchId",
    "branchName",
    "userGivenBranchId",
    "onboardingStatus",
  ] as const) {
    if (c[k] !== undefined && c[k] !== null) details[k] = c[k];
  }
  details.readyForInvoicing = !!c.readyForInvoicing;
  details.mappingReadiness = c.mappingReadiness ?? null;
  return {
    legalEntityId: c.companyId,
    status,
    nameEn: c.legalName ?? undefined,
    nameAr: c.legalNameArabic ?? undefined,
    vatTrn: c.vatTrn ?? undefined,
    peppolAddress: status === "inactive" ? null : peppol,
    capabilities: c.readyForInvoicing ? ["invoicing"] : [],
    providerDetails: details,
    lastSyncAt: now,
    updatedAt: now,
  };
}

type FetchLike = typeof fetch;
type SourceResolver = (
  companyId: string,
  environment: ComplyanceEnvironment
) => Promise<ComplyanceSource | null>;

/** Default: the source recorded at onboarding (einvoice_legal_entities.provider_details). */
const dbSourceResolver: SourceResolver = async (companyId, environment) => {
  const { getLegalEntity } = await import("../legal-entities");
  const le = await getLegalEntity(companyId, COMPLYANCE_PROVIDER_NAME, environment);
  const d = (le?.providerDetails ?? null) as Record<string, unknown> | null;
  const name = str(d?.sourceName);
  return name ? { name, version: str(d?.sourceVersion) ?? "v1" } : null;
};

export class ComplyanceEInvoiceProvider implements EInvoiceProvider {
  readonly name = COMPLYANCE_PROVIDER_NAME;
  readonly displayName = "Complyance";
  readonly environment: EInvoiceProviderEnvironment;
  // No cancel: a document that passed validation keeps its number; correct with a credit note.
  readonly capabilities: EInvoiceProviderCapabilities = {
    submit: true,
    getStatus: true,
    receive: true,
    cancel: false,
  };
  readonly requiresLegalEntity = true;
  readonly cfg: ComplyanceConfig;
  private readonly fetchImpl: FetchLike;
  private readonly sourceFor: SourceResolver;
  private readonly purchaseCache = new Map<string, Record<string, unknown>>();

  constructor(
    env: NodeJS.ProcessEnv = process.env,
    deps: { fetch?: FetchLike; sourceFor?: SourceResolver } = {}
  ) {
    this.cfg = readComplyanceConfig(env);
    this.environment = this.cfg.environment;
    this.fetchImpl = deps.fetch ?? fetch;
    this.sourceFor = deps.sourceFor ?? dbSourceResolver;
  }

  /** One authenticated request. The key goes in a header only, never in logs or errors. */
  async call(
    method: "GET" | "POST" | "PATCH",
    path: string,
    opts: {
      auth?: "bearer" | "apikey";
      json?: unknown;
      xml?: string;
      headers?: Record<string, string>;
    } = {}
  ): Promise<RawResponse> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.cfg.timeoutMs);
    try {
      const headers: Record<string, string> = {
        Accept: "application/json",
        "User-Agent": this.cfg.userAgent,
        ...(opts.auth === "apikey"
          ? { "X-API-Key": this.cfg.apiKey }
          : { Authorization: `Bearer ${this.cfg.apiKey}` }),
        ...(opts.headers ?? {}),
      };
      if (opts.xml !== undefined) headers["Content-Type"] = "application/xml; charset=utf-8";
      else if (opts.json !== undefined) headers["Content-Type"] = "application/json";
      const res = await this.fetchImpl(`${this.cfg.baseUrl}${path}`, {
        method,
        headers,
        body: opts.xml ?? (opts.json === undefined ? undefined : JSON.stringify(opts.json)),
        signal: controller.signal,
      });
      const text = await res.text();
      let json: unknown = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        /* plain-text 401 ("Authentication required") or XML */
      }
      const ra = Number(res.headers.get("retry-after"));
      return {
        ok: res.ok,
        status: res.status,
        json,
        text,
        retryAfter: Number.isFinite(ra) && ra > 0 ? ra : null,
      };
    } finally {
      clearTimeout(timer);
    }
  }

  private outcome(
    delivery: DeliveryStatus,
    reporting: ReportingStatus,
    extra: Partial<EInvoiceProviderResult> & { providerMessageId: string }
  ): EInvoiceProviderResult {
    return { status: legacyFromTracks(delivery, reporting), delivery, reporting, ...extra };
  }

  async submit(submission: EInvoiceSubmission): Promise<EInvoiceProviderResult> {
    const source = submission.companyId
      ? await this.sourceFor(submission.companyId, this.cfg.environment)
      : null;
    if (!source) {
      return this.outcome("rejected", "pending", {
        providerMessageId: "",
        detail: "This company has no Complyance invoice source yet; finish connecting it first.",
        errorCode: "COMPLYANCE_SOURCE_MISSING",
        reasons: [
          { code: "COMPLYANCE_SOURCE_MISSING", message: "No Complyance source", field: null },
        ],
      });
    }
    let gets;
    try {
      gets = ublToGets(submission.xml);
    } catch (err) {
      return this.outcome("rejected", "pending", {
        providerMessageId: "",
        detail: (err as Error).message,
        errorCode: "COMPLYANCE_BAD_REQUEST",
        reasons: [{ code: "COMPLYANCE_MAPPING", message: (err as Error).message, field: null }],
      });
    }
    const sourceRef = `${source.name}:${source.version}`;
    let r: RawResponse;
    try {
      r =
        this.cfg.submitFormat === "xml"
          ? await this.call("POST", "/api/v3/unify", {
              xml: unifyXmlRequest({
                environment: this.cfg.environment,
                source: sourceRef,
                purpose: "invoicing",
                documentType: gets.documentType,
                xml: submission.xml,
              }),
            })
          : await this.call("POST", "/api/v3/unify", {
              headers: { "new-api": "true" },
              json: {
                country: "AE",
                environment: this.cfg.environment,
                purpose: "invoicing",
                source: sourceRef,
                documentType: gets.documentType,
                payload: gets.payload,
              },
            });
    } catch (err) {
      // Ambiguous: Complyance may have stored it. A retry answers GETS-HEAD-010 if it did.
      const msg = (err as Error)?.message ?? "unknown";
      log.error({ err: msg, invoiceId: submission.invoiceId }, "Complyance submit transport error");
      return this.outcome("delivery_failed", "pending", {
        providerMessageId: "",
        detail: `Transport error contacting Complyance: ${msg}`,
        errorCode: "TRANSPORT_ERROR",
      });
    }

    const body = (r.json ?? {}) as Record<string, unknown>;
    if (r.status === 200 || r.status === 201) {
      const id = str(body.documentId);
      if (!id) {
        return this.outcome("delivery_failed", "pending", {
          providerMessageId: "",
          detail: "Complyance accepted the request but returned no document id to track.",
          errorCode: "COMPLYANCE_NO_DOCUMENT_ID",
          raw: r.json,
        });
      }
      return this.outcome("queued", "pending", {
        providerMessageId: id,
        providerStatus: "submitted",
        detail: null,
        raw: {
          documentId: id,
          documentNumber: body.documentNumber ?? null,
          message: body.message ?? null,
        },
      });
    }

    log.warn(
      { status: r.status, invoiceId: submission.invoiceId },
      "Complyance did not accept the submission"
    );
    if (r.status === 422) {
      const reasons = complyanceReasons(body.errors);
      if (reasons.some((x) => x.code === "GETS-HEAD-010")) {
        // The number is already used: an earlier attempt was stored, or this is a resend after a
        // final rejection. Complyance does not return the id here and has no sales listing.
        return this.outcome("rejected", "pending", {
          providerMessageId: "",
          detail:
            str(body.message) ??
            "Complyance already holds a document with this number. Link it from the Complyance Invoice Portal.",
          errorCode: "COMPLYANCE_DUPLICATE_NUMBER",
          reasons,
          raw: r.json,
        });
      }
      if (str(body.validationStage) === "xml") {
        return this.outcome("rejected", "pending", {
          providerMessageId: "",
          detail: str(body.message) ?? "Complyance could not produce the e-invoice.",
          errorCode: "COMPLYANCE_XML_FAILED",
          reasons: [
            {
              code: "COMPLYANCE_XML_FAILED",
              message: str(body.message) ?? "XML stage failed",
              field: null,
            },
          ],
          raw: { documentId: body.documentId ?? null, validationStage: "xml" },
        });
      }
      return this.outcome("rejected", "pending", {
        providerMessageId: "",
        detail: reasons.map((x) => x.message).join("; ") || str(body.message) || "HTTP 422",
        errorCode: "COMPLYANCE_VALIDATION",
        reasons: reasons.length
          ? reasons
          : [
              {
                code: "COMPLYANCE_VALIDATION",
                message: str(body.message) ?? "Validation failed",
                field: null,
              },
            ],
        raw: { documentId: body.documentId ?? null, errors: body.errors ?? [] },
      });
    }
    const refusal: Record<number, string> = {
      400: "COMPLYANCE_BAD_REQUEST",
      404: "COMPLYANCE_SOURCE_NOT_FOUND",
      409: "COMPLYANCE_SOURCE_AMBIGUOUS",
      412: "COMPLYANCE_MAPPING_NOT_READY",
      413: "COMPLYANCE_BAD_REQUEST",
      415: "COMPLYANCE_BAD_REQUEST",
    };
    if (refusal[r.status]) {
      const code = refusal[r.status];
      const message =
        [str(body.message) ?? str(body.error), str(body.reason)].filter(Boolean).join(" — ") ||
        `Complyance answered HTTP ${r.status}`;
      return this.outcome("rejected", "pending", {
        providerMessageId: "",
        detail: message,
        errorCode: code,
        reasons: [{ code: str(body.reason) ?? str(body.code) ?? code, message, field: null }],
        raw: r.json ?? null,
      });
    }
    return this.outcome("delivery_failed", "pending", {
      providerMessageId: "",
      detail: `Complyance answered HTTP ${r.status}`,
      errorCode:
        r.status === 401 || r.status === 403
          ? "COMPLYANCE_AUTH_FAILED"
          : r.status === 429
            ? "COMPLYANCE_RATE_LIMITED"
            : "COMPLYANCE_UNAVAILABLE",
      raw: r.json ?? null,
    });
  }

  async getStatus(providerMessageId: string): Promise<EInvoiceProviderResult> {
    let r: RawResponse;
    try {
      r = await this.call(
        "GET",
        `/api/v3/documents/${encodeURIComponent(providerMessageId)}?type=sales`
      );
    } catch (err) {
      return {
        providerMessageId,
        status: "failed",
        detail: `Transport error polling Complyance: ${(err as Error)?.message ?? "unknown"}`,
        errorCode: "TRANSPORT_ERROR",
      };
    }
    if (!r.ok) {
      return {
        providerMessageId,
        status: "failed",
        detail: `Complyance answered HTTP ${r.status}`,
        errorCode:
          r.status === 401 || r.status === 403
            ? "COMPLYANCE_AUTH_FAILED"
            : r.status === 429
              ? "COMPLYANCE_RATE_LIMITED"
              : "COMPLYANCE_UNAVAILABLE",
        raw: r.json ?? null,
      };
    }
    const data = (((r.json ?? {}) as Record<string, unknown>).data ?? {}) as Record<
      string,
      unknown
    >;
    const providerStatus = str(data.state) ?? "";
    const m = mapComplyanceStatus(data);
    const failed = m.errorCode !== null;
    return this.outcome(m.delivery, m.reporting, {
      providerMessageId,
      providerStatus,
      detail: failed
        ? m.reasons.map((x) => x.message).join("; ") || `Complyance state: ${providerStatus}`
        : null,
      errorCode: m.errorCode,
      reasons: m.reasons,
      raw: {
        state: data.state ?? null,
        isTerminal: data.isTerminal ?? null,
        compliance: data.compliance ?? null,
        lastUpdatedAt: data.lastUpdatedAt ?? null,
      },
    });
  }

  // ─── Inbound (purchases) ─────────────────────────────────────────────

  private async purchase(documentId: string): Promise<Record<string, unknown>> {
    const cached = this.purchaseCache.get(documentId);
    if (cached) return cached;
    const r = await this.call(
      "GET",
      `/api/v3/documents/${encodeURIComponent(documentId)}?type=purchases`
    );
    if (!r.ok) {
      throw new ComplyanceApiError(
        r.status,
        "COMPLYANCE_UNAVAILABLE",
        `Complyance purchase answered ${r.status}`,
        undefined,
        r.status >= 500 || r.status === 429
      );
    }
    const data = (((r.json ?? {}) as Record<string, unknown>).data ?? {}) as Record<
      string,
      unknown
    >;
    this.purchaseCache.set(documentId, data);
    return data;
  }

  /** Purchases received in the poll window, per company (cursor pagination, 100 per page). */
  async listInbound(opts: { legalEntityIds?: string[] } = {}): Promise<InboundListing[]> {
    const to = new Date();
    const from = new Date(to.getTime() - this.cfg.pollDays * 24 * 60 * 60 * 1000);
    const day = (d: Date) => d.toISOString().slice(0, 10);
    const companies = opts.legalEntityIds?.length ? opts.legalEntityIds : [null];
    const out: InboundListing[] = [];
    for (const companyId of companies) {
      let cursor: string | null = null;
      for (let page = 0; page < 20; page++) {
        const q = new URLSearchParams({
          type: "purchases",
          from: day(from),
          to: day(to),
          limit: "100",
        });
        if (companyId) q.set("companyId", companyId);
        if (cursor) q.set("cursor", cursor);
        const r = await this.call("GET", `/api/v3/documents?${q.toString()}`);
        if (!r.ok) {
          throw new ComplyanceApiError(
            r.status,
            "COMPLYANCE_UNAVAILABLE",
            `Complyance purchase list answered ${r.status}`
          );
        }
        const data = (((r.json ?? {}) as Record<string, unknown>).data ?? {}) as Record<
          string,
          unknown
        >;
        for (const raw of (Array.isArray(data.items) ? data.items : []) as Array<
          Record<string, unknown>
        >) {
          const id = str(raw.documentId);
          if (!id) continue;
          out.push({
            providerMessageId: id,
            documentType: null,
            documentNumber: str(raw.invoiceNumber),
            legalEntityId: companyId,
            ownerFiscalId: null,
          });
        }
        cursor = data.hasMore ? str(data.nextCursor) : null;
        if (!cursor) break;
      }
    }
    return out;
  }

  /** The purchase's original XML (`data.xml`; base64 is accepted as well). */
  async fetchSource(providerMessageId: string): Promise<string> {
    const data = await this.purchase(providerMessageId);
    const raw = str(data.xml) ?? "";
    if (raw.trim().startsWith("<")) return raw;
    if (raw) {
      const decoded = Buffer.from(raw, "base64").toString("utf8");
      if (decoded.trim().startsWith("<")) return decoded;
    }
    throw new ComplyanceApiError(
      404,
      "COMPLYANCE_NO_SOURCE_XML",
      "Complyance returned no XML for this purchase",
      undefined,
      true
    );
  }

  /**
   * Which company the purchase belongs to: the Connect company id the webhook (attribution) or the
   * per-company listing gave, else the buyer's Peppol id (0235:TIN) read from the document.
   */
  async inboundOwner(
    providerMessageId: string,
    _ref: EInvoiceDocumentRef,
    payload: Record<string, unknown>
  ): Promise<InboundOwner> {
    const fromPayload = str(payload.complyanceCompanyId) ?? str(payload.ownerLegalEntityId);
    if (fromPayload) return { legalEntityId: fromPayload, tin: null };
    const data = await this.purchase(providerMessageId);
    const invoice = (data.invoice ?? {}) as Record<string, unknown>;
    const buyer = (((invoice.parties ?? {}) as Record<string, unknown>).buyer ?? {}) as Record<
      string,
      unknown
    >;
    const peppol = str(buyer.peppolId);
    const tin = peppol ? peppol.replace(/^0235:/, "") : null;
    return { legalEntityId: null, tin: tin && /^\d{10}$/.test(tin) ? tin : null };
  }

  async receive(): Promise<InboundEInvoice[]> {
    const out: InboundEInvoice[] = [];
    for (const item of await this.listInbound()) {
      try {
        out.push({
          providerMessageId: item.providerMessageId,
          xml: await this.fetchSource(item.providerMessageId),
          receivedAt: null,
        });
      } catch (err) {
        log.warn(
          { id: item.providerMessageId, err: (err as Error).message },
          "Complyance purchase fetch failed"
        );
      }
    }
    return out;
  }

  async cancel(providerMessageId: string): Promise<EInvoiceProviderResult> {
    return {
      providerMessageId,
      status: "failed",
      detail: "Complyance has no cancellation; issue a credit note instead.",
    };
  }

  /** Webhooks are verified and queued by the route; nothing is parsed here. */
  parseWebhook(): null {
    return null;
  }

  // ─── Connect (per-company onboarding) ────────────────────────────────

  /** POST /v3/connect/companies. Throws ComplyanceApiError with Connect's error code. */
  async createCompany(body: {
    sourceName: string;
    sourceVersion: string;
    tin: string;
    contactPersonEmail: string;
    contactPersonName?: string | null;
    branchName: string;
  }): Promise<ComplyanceCompany> {
    const r = await this.call("POST", "/v3/connect/companies", {
      auth: "apikey",
      json: {
        sourceName: body.sourceName,
        sourceVersion: body.sourceVersion,
        countryCode: "AE",
        tin: body.tin,
        contactPersonEmail: body.contactPersonEmail,
        ...(body.contactPersonName ? { contactPersonName: body.contactPersonName } : {}),
        branchName: body.branchName,
        platformEnvironment: this.cfg.environment,
      },
    });
    const json = (r.json ?? {}) as Record<string, unknown>;
    if (r.status === 201 || r.status === 200) return json.data as ComplyanceCompany;
    const err = (json.error ?? {}) as Record<string, unknown>;
    const code =
      str(err.code) ??
      str(json.code) ??
      (r.status === 504 ? "ONBOARDING_TIMEOUT" : `HTTP_${r.status}`);
    throw new ComplyanceApiError(
      r.status,
      code,
      str(err.message) ?? str(json.message) ?? `Complyance Connect answered HTTP ${r.status}`,
      undefined,
      err.retryable === true || r.status >= 500 || r.status === 429
    );
  }

  /** GET /v3/connect/companies (one item per branch; newest first). */
  async listCompanies(
    opts: { search?: string; page?: number } = {}
  ): Promise<{ items: ComplyanceCompany[]; hasMore: boolean }> {
    const q = new URLSearchParams({
      countryCode: "AE",
      limit: "100",
      page: String(opts.page ?? 1),
    });
    if (opts.search) q.set("search", opts.search);
    const r = await this.call("GET", `/v3/connect/companies?${q.toString()}`, { auth: "apikey" });
    if (!r.ok) {
      const err = (((r.json ?? {}) as Record<string, unknown>).error ?? {}) as Record<
        string,
        unknown
      >;
      throw new ComplyanceApiError(
        r.status,
        str(err.code) ?? "COMPLYANCE_UNAVAILABLE",
        `Complyance Connect answered HTTP ${r.status}`
      );
    }
    const json = (r.json ?? {}) as Record<string, unknown>;
    const meta = ((json.meta ?? {}) as Record<string, unknown>).pagination as
      | Record<string, unknown>
      | undefined;
    return {
      items: (Array.isArray(json.data) ? json.data : []) as ComplyanceCompany[],
      hasMore: meta?.hasMore === true,
    };
  }

  /** Find a company by Connect id, TIN and/or source name (follows up to 10 pages). */
  async findCompany(match: {
    companyId?: string | null;
    tin?: string | null;
    sourceName?: string | null;
  }): Promise<ComplyanceCompany | null> {
    for (let page = 1; page <= 10; page++) {
      const { items, hasMore } = await this.listCompanies({
        search: match.sourceName ?? undefined,
        page,
      });
      const hit = items.find(
        (c) =>
          (match.companyId && c.companyId === match.companyId) ||
          (!match.companyId && match.sourceName && c.sourceName === match.sourceName) ||
          (!match.companyId && !match.sourceName && match.tin && c.tin === match.tin)
      );
      if (hit) return hit;
      if (!hasMore) break;
    }
    return null;
  }

  /** Inbox hook: a company/Peppol event -> the company as Complyance holds it now. */
  async legalEntityPatch(legalEntityId: string): Promise<LegalEntityPatch | null> {
    const c = await this.findCompany({ companyId: legalEntityId });
    return c ? patchFromComplyance(c) : null;
  }
}

/** E2: Complyance's entry in the provider registry (registry.ts). */
export const COMPLYANCE_PROVIDER_MODULE: EInvoiceProviderModule = {
  id: COMPLYANCE_PROVIDER_NAME,
  displayName: "Complyance",
  legalName: COMPLYANCE_LEGAL_NAME,
  accreditationNumber: COMPLYANCE_ACCREDITATION_NUMBER,
  website: "https://www.complyance.io",
  // The MoF register name; the exact EmaraTax wording must be confirmed in the sandbox.
  emaraTaxListing: "COMPLYANCE ELECTRONICS L.L.C",
  envVars: [
    "COMPLYANCE_ENV",
    "COMPLYANCE_API_KEY",
    "COMPLYANCE_BASE_URL",
    "COMPLYANCE_SUBMIT_FORMAT",
    "COMPLYANCE_SOURCE_PREFIX",
    "COMPLYANCE_SOURCE_VERSION",
    "COMPLYANCE_USER_AGENT",
    "COMPLYANCE_TIMEOUT_MS",
    "COMPLYANCE_POLL_DAYS",
    "COMPLYANCE_WEBHOOK_SECRET",
    "COMPLYANCE_WEBHOOK_ALGORITHM",
    "COMPLYANCE_WEBHOOK_MAX_AGE_SECONDS",
  ],
  configured: complyanceConfigured,
  environment: complyanceEnvironment,
  notConfiguredMessage: "The Complyance e-invoicing provider requires COMPLYANCE_API_KEY.",
  create: (env, deps) => new ComplyanceEInvoiceProvider(env, deps),
};
