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
import { createHmac } from "node:crypto";
import type {
  EInvoiceDocumentRef,
  EInvoiceOutboundIdentity,
  EInvoiceProvider,
  EInvoiceProviderCapabilities,
  EInvoiceProviderContext,
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
import { legacyFromProviderTracks, type DeliveryStatus, type ReportingStatus } from "../tracks";
import type { EInvoiceProviderModule } from "./types";
import { ublToGets, unifyXmlRequest } from "./complyance-gets";
import { providerObject, providerString, readProviderResponse } from "./response";

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
    timeoutMs: Number.isFinite(timeout) && timeout > 0 ? Math.min(timeout, 60_000) : 30_000,
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

// ─── Link verification (manual link after GETS-HEAD-010) ───────────────────

/** Who a company is at Complyance, as recorded at onboarding. */
export interface ComplyanceSellerIdentity {
  /** 10-digit UAE TIN (Peppol 0235 scheme). */
  tin: string | null;
  /** 15-digit VAT TRN. */
  trn: string | null;
  /** The Connect company id (einvoice_legal_entities.legal_entity_id). */
  connectCompanyId: string | null;
  /** The company's invoice source name (provider_details.sourceName). */
  sourceName: string | null;
}

const uaeTin = (value: unknown): string | null =>
  typeof value === "string" && /^(?:0235:)?1\d{9}$/.test(value)
    ? value.replace(/^0235:/, "")
    : null;

const uaeTrn = (value: unknown): string | null =>
  typeof value === "string" && /^1\d{14}$/.test(value) ? value : null;

function sourceNameFromReference(value: unknown): unknown {
  if (typeof value === "string") return value.split(":", 1)[0];
  // A nonempty but invalid source must not disappear behind a matching alternate field.
  return providerObject(value)?.name ?? value;
}

/**
 * Invoice numbers can repeat across sellers. An authenticated sales read for a recovery must carry
 * at least one verified owner marker. Check each source, Connect company and seller TIN/TRN
 * independently so a matching alias cannot hide contradictory ownership.
 */
export function complyanceDocumentBelongsTo(
  data: Record<string, unknown>,
  me: ComplyanceSellerIdentity
): { ok: boolean; checked: string[]; mismatched: string[] } {
  const checked = new Set<string>();
  const mismatched = new Set<string>();
  const present = (v: unknown) => v != null && v !== "";
  const compare = (label: string, value: unknown, matches: boolean) => {
    if (!present(value)) return;
    checked.add(label);
    if (!matches) mismatched.add(label);
  };

  for (const owner of [data, providerObject(data.attribution)]) {
    if (!owner) continue;
    compare("source", owner.source, sourceNameFromReference(owner.source) === me.sourceName);
    compare("source", owner.sourceName, owner.sourceName === me.sourceName);
    for (const companyId of [owner.companyId, owner.connectCompanyId]) {
      compare("connectCompanyId", companyId, companyId === me.connectCompanyId);
    }
  }

  const nestedSeller = (body: unknown) =>
    providerObject(providerObject(providerObject(body)?.parties)?.seller);
  const tin = uaeTin(me.tin);
  const trn = uaeTrn(me.trn);
  const matchesTin = (value: unknown) => !!tin && uaeTin(value) === tin;
  const matchesTrn = (value: unknown) => !!trn && uaeTrn(value) === trn;
  const checkTaxId = (value: unknown) =>
    compare("sellerTaxId", value, matchesTin(value) || matchesTrn(value));
  for (const seller of [
    providerObject(data.seller),
    nestedSeller(data.invoice),
    nestedSeller(data.payload),
  ]) {
    if (!seller) continue;
    for (const value of [seller.tin, seller.peppolId])
      compare("sellerTaxId", value, matchesTin(value));
    for (const value of [seller.trn, seller.vatTrn, seller.vatNumber])
      compare("sellerTaxId", value, matchesTrn(value));
    checkTaxId(seller.taxId);
    if (!Array.isArray(seller.taxIds)) {
      compare("sellerTaxId", seller.taxIds, false);
      continue;
    }
    for (const taxId of seller.taxIds) {
      const entry = providerObject(taxId);
      if (entry && (present(entry.value) || present(entry.id))) {
        checkTaxId(entry.value);
        checkTaxId(entry.id);
      } else {
        checkTaxId(taxId);
      }
    }
  }
  return {
    ok: checked.size > 0 && mismatched.size === 0,
    checked: [...checked],
    mismatched: [...mismatched],
  };
}

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

function isCorrectableSalesState(data: Record<string, unknown>): boolean {
  if (
    data.state !== "rejected" ||
    data.isTerminal !== true ||
    (data.validationStage != null && data.validationStage !== "gets")
  )
    return false;
  const compliance = providerObject(data.compliance);
  if (compliance?.ftaApprovedStatus != null && compliance.ftaApprovedStatus !== "PENDING")
    return false;
  const delivery = [data.deliveryStatus, compliance?.peppolStatus, data.mlsStatus];
  const final = [
    "APPROVED",
    "ACCEPTED",
    "DELIVERED",
    "DELIVERY_SUCCESS",
    "FINAL_VALID",
    "FINAL_INVALID",
    "REJECTED",
  ];
  if (delivery.some((value) => final.includes(providerString(value)?.toUpperCase() ?? "")))
    return false;
  return (
    !Array.isArray(data.errors) ||
    !data.errors.some((item) =>
      ["delivery", "government"].includes(
        providerString(providerObject(item)?.source)?.toLowerCase() ?? ""
      )
    )
  );
}

/**
 * Complyance document status -> our two tracks (docs /api-reference/unify/documents/, UAE):
 *   submitted          passed validation, delivery not started    -> queued / pending
 *   processing         delivery started or an answer is awaited   -> sending / pending
 *   delivery_success   handed to the buyer's ASP (C3), not final  -> delivered / pending
 *   delivery_failed    an attempt failed, NOT final in the UAE: Complyance keeps trying and
 *                      says not to resend under a new number      -> sending / pending
 *                      (terminal only if isTerminal says so)      -> delivery_failed
 *   final_valid        final recipient outcome                   -> delivered; FTA approval
 *                      comes from the explicit compliance field
 *   final_invalid      buyer's ASP or the FTA rejected            -> by explicit error sources
 *   rejected           failed validation (Needs Correction)       -> rejected / pending
 * Unknown states never read as success: delivery_failed with COMPLYANCE_UNKNOWN_STATE.
 */
export function mapComplyanceStatus(data: Record<string, unknown>): ComplyanceTrackOutcome {
  const state = providerString(data.state)?.toLowerCase();
  const terminal = data.isTerminal === true;
  const reasons = complyanceReasons(data.errors);
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
    case "final_valid": {
      const approval = providerString(providerObject(data.compliance)?.ftaApprovedStatus);
      return {
        delivery: "delivered",
        reporting: approval === "APPROVED" ? "reported" : "pending",
        errorCode: null,
        reasons: [],
      };
    }
    case "final_invalid": {
      const sources = new Set(
        (Array.isArray(data.errors) ? data.errors : []).map((e) =>
          providerString(providerObject(e)?.source)?.toLowerCase()
        )
      );
      if (sources.has("government")) {
        const buyerRejected = sources.has("delivery");
        return {
          delivery: buyerRejected ? "rejected" : "delivered",
          reporting: "report_failed",
          errorCode: buyerRejected ? "COMPLYANCE_FINAL_INVALID" : "EINVOICE_REPORT_FAILED",
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

function sourceFromLegalEntity(
  legalEntity: EInvoiceProviderContext["legalEntity"]
): ComplyanceSource | null {
  const details = providerObject(legalEntity?.providerDetails);
  const name = providerString(details?.sourceName);
  return name ? { name, version: providerString(details?.sourceVersion) ?? "v1" } : null;
}

/** Default: the source recorded at onboarding (einvoice_legal_entities.provider_details). */
const dbSourceResolver: SourceResolver = async (companyId, environment) => {
  const { getLegalEntity } = await import("../legal-entities");
  return sourceFromLegalEntity(
    (await getLegalEntity(companyId, COMPLYANCE_PROVIDER_NAME, environment)) ?? null
  );
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
        redirect: "error",
        signal: controller.signal,
      });
      const parsed = await readProviderResponse(res, [this.cfg.apiKey]);
      const ra = Number(res.headers.get("retry-after"));
      return {
        ok: res.ok,
        status: res.status,
        ...parsed,
        retryAfter: Number.isFinite(ra) && ra > 0 ? ra : null,
      };
    } catch {
      throw new ComplyanceApiError(
        502,
        "TRANSPORT_ERROR",
        "Could not contact Complyance.",
        undefined,
        true
      );
    } finally {
      clearTimeout(timer);
    }
  }

  private outcome(
    delivery: DeliveryStatus,
    reporting: ReportingStatus,
    extra: Partial<EInvoiceProviderResult> & { providerMessageId: string }
  ): EInvoiceProviderResult {
    const status = legacyFromProviderTracks(this.name, extra.providerStatus, delivery, reporting);
    return { status, delivery, reporting, ...extra };
  }

  /** Bind a retry to the original workspace credential, source and environment. */
  async getSubmissionScope(
    companyId: string,
    context?: EInvoiceProviderContext
  ): Promise<string | null> {
    const source = await this.resolveSource(companyId, context);
    return source ? this.submissionScope(companyId, source) : null;
  }

  private async resolveSource(
    companyId: string,
    context?: EInvoiceProviderContext
  ): Promise<ComplyanceSource | null> {
    if (context) return sourceFromLegalEntity(context.legalEntity);
    return this.sourceFor(companyId, this.cfg.environment);
  }

  private submissionScope(companyId: string, source: ComplyanceSource): string {
    return createHmac("sha256", this.cfg.apiKey)
      .update(
        JSON.stringify([
          "einvoice-complyance-submission",
          this.cfg.baseUrl,
          this.cfg.environment,
          this.cfg.submitFormat,
          companyId,
          source.name,
          source.version,
        ])
      )
      .digest("hex");
  }

  async submit(submission: EInvoiceSubmission): Promise<EInvoiceProviderResult> {
    const companyId = submission.companyId;
    const source = companyId ? await this.resolveSource(companyId, submission.context) : null;
    if (
      submission.scopeFingerprint &&
      (!source ||
        !companyId ||
        this.submissionScope(companyId, source) !== submission.scopeFingerprint)
    ) {
      return this.outcome("delivery_failed", "pending", {
        providerMessageId: "",
        detail: "The Complyance submission source changed after this e-invoice was queued.",
        errorCode: "COMPLYANCE_SOURCE_AMBIGUOUS",
      });
    }
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
    } catch {
      // Ambiguous: Complyance may have stored it. A retry answers GETS-HEAD-010 if it did.
      return this.outcome("delivery_failed", "pending", {
        providerMessageId: "",
        detail: "Could not contact Complyance.",
        errorCode: "TRANSPORT_ERROR",
      });
    }

    const body = providerObject(r.json) ?? {};
    if (r.status === 200 || r.status === 201) {
      const id = providerString(body.documentId);
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
      const documentId =
        body.documentNumber === submission.invoiceNumber ? providerString(body.documentId) : null;
      if (reasons.some((x) => x.code === "GETS-HEAD-010")) {
        // The number is already used: an earlier attempt was stored, or this is a resend after a
        // final rejection. Complyance does not return the id here and has no sales listing.
        return this.outcome("rejected", "pending", {
          providerMessageId: "",
          detail:
            str(body.message) ??
            "Complyance already holds a document with this number. Link it from the Complyance Invoice Portal.",
          errorCode: "COMPLYANCE_DUPLICATE_NUMBER",
          numberAlreadyHeld: true,
          reasons,
          raw: r.json,
        });
      }
      if (str(body.validationStage) === "xml") {
        return this.outcome("rejected", "pending", {
          providerMessageId: documentId ?? "",
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
        providerMessageId: documentId ?? "",
        providerStatus: documentId ? "rejected" : null,
        correctableRejection: !!documentId && body.validationStage === "gets",
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

  private salesDocumentPath(providerMessageId: string): string {
    return `/api/v3/documents/${encodeURIComponent(providerMessageId)}?type=sales`;
  }

  async verifyOutboundDocument(
    providerMessageId: string,
    identity: EInvoiceOutboundIdentity
  ): Promise<boolean> {
    return (await this.checkOutboundDocument(providerMessageId, identity)) === "verified";
  }

  /** Verify one exact outbound resource, keeping temporary failures distinct from bad proof. */
  async checkOutboundDocument(
    providerMessageId: string,
    identity: EInvoiceOutboundIdentity
  ): Promise<"verified" | "mismatch" | "unavailable"> {
    return (await this.readOwnedSalesDocument(providerMessageId, identity)).verdict;
  }

  async checkCorrectableRejection(
    providerMessageId: string,
    identity: EInvoiceOutboundIdentity,
    context?: EInvoiceProviderContext
  ) {
    const proof = await this.readOwnedSalesDocument(providerMessageId, identity);
    if (proof.verdict !== "verified") return proof.verdict;
    const source = sourceFromLegalEntity(context?.legalEntity ?? null);
    if (!source || source.name !== identity.sourceName) return "mismatch";
    for (const aliases of [proof.data, providerObject(proof.data.attribution)]) {
      if (!aliases) continue;
      const reference = aliases.source;
      const version =
        typeof reference === "string" && reference.includes(":")
          ? reference.slice(reference.indexOf(":") + 1)
          : providerObject(reference)?.version;
      if (
        [version, aliases.sourceVersion].some((value) => value != null && value !== source.version)
      )
        return "mismatch";
    }
    return isCorrectableSalesState(proof.data) ? "verified" : "mismatch";
  }

  private async readOwnedSalesDocument(
    providerMessageId: string,
    identity: EInvoiceOutboundIdentity
  ): Promise<
    { verdict: "verified"; data: Record<string, unknown> } | { verdict: "mismatch" | "unavailable" }
  > {
    try {
      const response = await this.call("GET", this.salesDocumentPath(providerMessageId));
      if (response.status >= 500 || [401, 403, 408, 429].includes(response.status)) {
        return { verdict: "unavailable" };
      }
      const envelope = providerObject(response.json);
      const data = providerObject(envelope?.data);
      if (
        !response.ok ||
        !data ||
        envelope?.success === false ||
        data.documentId !== providerMessageId ||
        data.documentNumber !== identity.documentNumber ||
        (data.environment != null && data.environment !== this.environment)
      )
        return { verdict: "mismatch" };
      const ownsDocument = complyanceDocumentBelongsTo(data, {
        tin: identity.supplierTin,
        trn: identity.supplierTrn,
        connectCompanyId: identity.legalEntityId,
        sourceName: identity.sourceName,
      }).ok;
      return ownsDocument ? { verdict: "verified", data } : { verdict: "mismatch" };
    } catch {
      return { verdict: "unavailable" };
    }
  }

  async getStatus(providerMessageId: string): Promise<EInvoiceProviderResult> {
    let r: RawResponse;
    try {
      r = await this.call("GET", this.salesDocumentPath(providerMessageId));
    } catch {
      return {
        providerMessageId,
        status: "failed",
        detail: "Could not read the document status from Complyance.",
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
    const result = providerObject(r.json);
    const data = providerObject(result?.data);
    const providerStatus = providerString(data?.state);
    const returnedId = providerString(data?.documentId);
    if (!data || !providerStatus || result?.success === false || returnedId !== providerMessageId) {
      return {
        providerMessageId,
        status: "failed",
        detail: "Complyance returned an invalid document status response.",
        errorCode: "COMPLYANCE_UNAVAILABLE",
      };
    }
    const m = mapComplyanceStatus(data);
    const failed = m.errorCode !== null;
    return this.outcome(m.delivery, m.reporting, {
      providerMessageId,
      providerStatus,
      correctableRejection: isCorrectableSalesState(data),
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
    const data = providerObject(providerObject(r.json)?.data);
    if (
      !data ||
      providerString(data.documentId) !== documentId ||
      (data.environment != null && providerString(data.environment) !== this.environment)
    ) {
      throw new ComplyanceApiError(
        502,
        "COMPLYANCE_UNAVAILABLE",
        "Complyance returned an invalid purchase",
        undefined,
        true
      );
    }
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
            legalEntityId: str(providerObject(raw.attribution)?.companyId) ?? companyId,
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

  /** Re-read the authenticated purchase before treating webhook or list attribution as valid. */
  async inboundOwner(
    providerMessageId: string,
    _ref: EInvoiceDocumentRef,
    _payload?: Record<string, unknown>
  ): Promise<InboundOwner> {
    const data = await this.purchase(providerMessageId);
    const invoice = providerObject(data.invoice);
    const buyer = providerObject(providerObject(invoice?.parties)?.buyer);
    const peppol = providerString(buyer?.peppolId);
    return {
      legalEntityId: providerString(providerObject(data.attribution)?.companyId),
      tin: peppol?.replace(/^0235:/, "") ?? null,
    };
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
  async legalEntityPatch(
    legalEntityId: string,
    _payload: Record<string, unknown>,
    expectedTin: string
  ): Promise<LegalEntityPatch | null> {
    const c = await this.findCompany({ companyId: legalEntityId });
    if (!c) return null;
    const { assertProviderTin } = await import("../legal-entities");
    assertProviderTin(expectedTin, c.tin);
    return patchFromComplyance(c);
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
