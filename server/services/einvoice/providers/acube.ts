/**
 * A-Cube UAE e-invoicing adapter (E1).
 *
 * A-Cube (Platform ACube Technologies LLC) is on the Ministry of Finance register of accredited
 * e-invoicing service providers, accreditation no. 188961. It is our Peppol corner 2: it takes
 * our PINT AE UBL, validates it (XSD + UAE schematron, synchronously), delivers it over Peppol and
 * reports the tax data to the FTA (Tax Data Document, TDD). Source: docs.acubeapi.com, UAE section,
 * read 2026-11-16; see docs/einvoicing-acube.md for every open question to confirm in sandbox.
 *
 * ENVIRONMENT (secrets come from env / the secret store only and are never logged)
 *   EINVOICE_PROVIDER=acube           selects this adapter
 *   ACUBE_ENV                         sandbox (default) | production
 *   ACUBE_EMAIL, ACUBE_PASSWORD       A-Cube platform login (POST common.api.acubeapi.com/login)
 *   ACUBE_BASE_URL                    override; default ae-sandbox / ae.api.acubeapi.com
 *   ACUBE_LOGIN_URL                   override; default https://common.api.acubeapi.com/login
 *   ACUBE_INVOICE_SUBMIT_PATH         default /invoices
 *   ACUBE_CREDIT_NOTE_SUBMIT_PATH     default /credit-notes
 *   ACUBE_TIMEOUT_MS                  default 20000
 */
import { createHash } from "node:crypto";
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
import type { EInvoiceProviderModule } from "./types";
import { MOF_ASP_REGISTER_URL as REGISTER_URL } from "./types";
import { providerObject, providerString, readProviderResponse } from "./response";
import type { EInvoiceRejectionReason, EInvoiceStatus } from "../../einvoice-status";
import { createLogger } from "../../../config/logger";
import { parseXml } from "../dom";
import {
  acubeStatusErrorCode,
  legacyFromTracks,
  mapAcubeDeliveryStatus,
  type DeliveryStatus,
  type ReportingStatus,
} from "../tracks";

const log = createLogger("einvoice-acube");

export const ACUBE_ACCREDITATION_NUMBER = "188961";
export const ACUBE_PROVIDER_NAME = "acube";
export const MOF_ASP_REGISTER_URL = REGISTER_URL;

export type AcubeEnvironment = "sandbox" | "production";

export function acubeConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return !!env.ACUBE_EMAIL && !!env.ACUBE_PASSWORD;
}

export function acubeEnvironment(env: NodeJS.ProcessEnv = process.env): AcubeEnvironment {
  return (env.ACUBE_ENV ?? "").toLowerCase() === "production" ? "production" : "sandbox";
}

export interface AcubeConfig {
  environment: AcubeEnvironment;
  baseUrl: string;
  loginUrl: string;
  email: string;
  password: string;
  invoiceSubmitPath: string;
  creditNoteSubmitPath: string;
  timeoutMs: number;
}

const trimSlash = (s: string) => s.replace(/\/+$/, "");
const withSlash = (s: string) => (s.startsWith("/") ? s : `/${s}`);

export function readAcubeConfig(env: NodeJS.ProcessEnv = process.env): AcubeConfig {
  if (!acubeConfigured(env)) {
    throw new Error("A-Cube requires ACUBE_EMAIL and ACUBE_PASSWORD.");
  }
  const environment = acubeEnvironment(env);
  const timeout = Number(env.ACUBE_TIMEOUT_MS);
  return {
    environment,
    baseUrl: trimSlash(
      env.ACUBE_BASE_URL ||
        (environment === "production"
          ? "https://ae.api.acubeapi.com"
          : "https://ae-sandbox.api.acubeapi.com")
    ),
    loginUrl: env.ACUBE_LOGIN_URL || "https://common.api.acubeapi.com/login",
    email: env.ACUBE_EMAIL as string,
    password: env.ACUBE_PASSWORD as string,
    invoiceSubmitPath: withSlash(env.ACUBE_INVOICE_SUBMIT_PATH || "/invoices"),
    creditNoteSubmitPath: withSlash(env.ACUBE_CREDIT_NOTE_SUBMIT_PATH || "/credit-notes"),
    timeoutMs: Number.isFinite(timeout) && timeout > 0 ? Math.min(timeout, 60_000) : 20_000,
  };
}

// ─── JWT login + cache ──────────────────────────────────────────────────

/** Refresh this long before the token's exp (A-Cube tokens last 24 h). */
const REFRESH_MARGIN_MS = 60 * 60 * 1000;
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

interface CachedToken {
  token: string;
  expiresAt: number;
}
const tokenCache = new Map<string, CachedToken>();
const pendingLogins = new Map<string, Promise<CachedToken>>();
const MAX_CACHED_TOKENS = 256;

export function resetAcubeTokenCache(): void {
  tokenCache.clear();
  pendingLogins.clear();
}

/** exp (ms) from the JWT payload, or null when it cannot be read. */
export function jwtExpiry(token: string): number | null {
  const part = token.split(".")[1];
  if (!part) return null;
  try {
    const json = JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as { exp?: number };
    return typeof json.exp === "number" ? json.exp * 1000 : null;
  } catch {
    return null;
  }
}

export class AcubeApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly body?: unknown
  ) {
    super(message);
    this.name = "AcubeApiError";
  }
}

/** A-Cube's legal-entity resource, as documented (GET /legal-entities/{id}). */
export interface AcubeLegalEntity {
  legalEntityId: string;
  tin: string;
  status: string;
  legalType?: string | null;
  nameEn?: string | null;
  nameAr?: string | null;
  vatTrn?: string | null;
  isEnabled?: boolean;
  enabledCapabilities?: Array<{ key: string; type?: string; domain?: string }>;
  smpSyncAt?: string | null;
  registrySyncAt?: string | null;
  reservationExpiresAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

type Kind = "invoices" | "credit-notes";
const kindOf = (documentType?: string | null): Kind =>
  documentType === "381" || documentType === "81" || documentType === "credit-note"
    ? "credit-notes"
    : "invoices";

interface RawResponse {
  ok: boolean;
  status: number;
  json: unknown;
  text: string;
}

function str(v: unknown): string | null {
  return v === undefined || v === null || v === "" ? null : String(v);
}

/** 422 body: {violations: [{propertyPath, message, code, hint}], detail, title}. */
export function acubeViolations(json: unknown): EInvoiceRejectionReason[] {
  const body = (json ?? {}) as Record<string, unknown>;
  const list = Array.isArray(body.violations) ? body.violations : [];
  const reasons = list.map((v) => {
    const r = (v ?? {}) as Record<string, unknown>;
    const hint = str(r.hint);
    const message = str(r.message) ?? "Validation failed";
    return {
      code: str(r.code) ?? "ACUBE_VALIDATION",
      message: hint ? `${message} (${hint})` : message,
      field: str(r.propertyPath),
    };
  });
  if (reasons.length === 0) {
    const detail = str(body.detail) ?? str(body.description) ?? str(body.title);
    if (detail) reasons.push({ code: "ACUBE_VALIDATION", message: detail, field: null });
  }
  return reasons;
}

type FetchLike = typeof fetch;

export class AcubeEInvoiceProvider implements EInvoiceProvider {
  readonly name = ACUBE_PROVIDER_NAME;
  readonly environment: EInvoiceProviderEnvironment;
  // No cancel: A-Cube has no withdraw call; a sent invoice is corrected with a credit note.
  readonly capabilities: EInvoiceProviderCapabilities = {
    submit: true,
    getStatus: true,
    receive: true,
    cancel: false,
  };
  readonly requiresLegalEntity = true;
  readonly displayName = "A-Cube";
  readonly cfg: AcubeConfig;
  private readonly fetchImpl: FetchLike;
  private readonly cacheKey: string;

  constructor(env: NodeJS.ProcessEnv = process.env, deps: { fetch?: FetchLike } = {}) {
    this.cfg = readAcubeConfig(env);
    this.environment = this.cfg.environment;
    this.fetchImpl = deps.fetch ?? fetch;
    this.cacheKey = createHash("sha256")
      .update(
        JSON.stringify([
          env.ACUBE_CREDENTIAL_SCOPE,
          this.environment,
          this.cfg.baseUrl,
          this.cfg.loginUrl,
          this.cfg.email,
          this.cfg.password,
        ])
      )
      .digest("hex");
  }

  /** A valid JWT, logging in when there is none or it expires within the refresh margin. */
  async token(opts: { force?: boolean; now?: number } = {}): Promise<string> {
    const now = opts.now ?? Date.now();
    const key = this.cacheKey;
    const cached = tokenCache.get(key);
    if (!opts.force && cached && cached.expiresAt - REFRESH_MARGIN_MS > now) return cached.token;
    let pending = pendingLogins.get(key);
    if (!pending) {
      pending = this.login(now).finally(() => pendingLogins.delete(key));
      pendingLogins.set(key, pending);
    }
    return (await pending).token;
  }

  private async login(now: number): Promise<CachedToken> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.cfg.timeoutMs);
    try {
      const res = await this.fetchImpl(this.cfg.loginUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          email: this.cfg.email,
          password: this.cfg.password,
          environment: this.cfg.environment,
        }),
        redirect: "error",
        signal: controller.signal,
      });
      if (!res.ok) {
        await res.body?.cancel();
        log.warn({ status: res.status, environment: this.cfg.environment }, "A-Cube login failed");
        throw new AcubeApiError(
          res.status,
          res.status === 429 ? "ACUBE_RATE_LIMITED" : "ACUBE_AUTH_FAILED",
          `A-Cube login failed (${res.status})`
        );
      }
      const token = providerString(providerObject(await res.json())?.token);
      if (!token) throw new AcubeApiError(502, "ACUBE_AUTH_FAILED", "A-Cube login: no token");
      const entry = { token, expiresAt: jwtExpiry(token) ?? now + DEFAULT_TTL_MS };
      tokenCache.delete(this.cacheKey);
      const oldest = tokenCache.keys().next().value;
      if (tokenCache.size >= MAX_CACHED_TOKENS && oldest) tokenCache.delete(oldest);
      tokenCache.set(this.cacheKey, entry);
      return entry;
    } catch (err) {
      if (err instanceof AcubeApiError) throw err;
      throw new AcubeApiError(502, "ACUBE_AUTH_FAILED", "Could not complete A-Cube login.");
    } finally {
      clearTimeout(timer);
    }
  }

  /** Authenticated call; a 401 triggers one fresh login and one retry. */
  async call(
    method: "GET" | "POST" | "PUT",
    path: string,
    body?: { xml?: string; json?: unknown },
    accept = "application/json"
  ): Promise<RawResponse> {
    const send = async (token: string): Promise<RawResponse> => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.cfg.timeoutMs);
      try {
        const headers: Record<string, string> = {
          Accept: accept,
          Authorization: `Bearer ${token}`,
        };
        if (body?.xml !== undefined) headers["Content-Type"] = "application/xml";
        else if (body?.json !== undefined) headers["Content-Type"] = "application/json";
        const res = await this.fetchImpl(`${this.cfg.baseUrl}${path}`, {
          method,
          headers,
          body: body?.xml ?? (body?.json === undefined ? undefined : JSON.stringify(body.json)),
          redirect: "error",
          signal: controller.signal,
        });
        const parsed = await readProviderResponse(res, [this.cfg.email, this.cfg.password, token]);
        return { ok: res.ok, status: res.status, ...parsed };
      } catch {
        throw new AcubeApiError(502, "TRANSPORT_ERROR", "Could not contact A-Cube.");
      } finally {
        clearTimeout(timer);
      }
    };
    const first = await send(await this.token());
    if (first.status !== 401) return first;
    return send(await this.token({ force: true }));
  }

  private submitPath(documentType?: string | null): string {
    return kindOf(documentType) === "credit-notes"
      ? this.cfg.creditNoteSubmitPath
      : this.cfg.invoiceSubmitPath;
  }

  private outcome(
    delivery: DeliveryStatus,
    reporting: ReportingStatus,
    extra: Partial<EInvoiceProviderResult> & { providerMessageId: string }
  ): EInvoiceProviderResult {
    const status: EInvoiceStatus = legacyFromTracks(delivery, reporting);
    return { status, delivery, reporting, ...extra };
  }

  async submit(submission: EInvoiceSubmission): Promise<EInvoiceProviderResult> {
    let r: RawResponse;
    try {
      r = await this.call("POST", this.submitPath(submission.documentType), {
        xml: submission.xml,
      });
    } catch (err) {
      if (err instanceof AcubeApiError) {
        return this.outcome("delivery_failed", "pending", {
          providerMessageId: "",
          detail: err.message,
          errorCode: err.code,
        });
      }
      // Transport failure: ambiguous (A-Cube may have created the document). Retried with backoff;
      // the workflow looks the document up before re-posting (lookupSubmission).
      return this.outcome("delivery_failed", "pending", {
        providerMessageId: "",
        detail: "Could not contact A-Cube.",
        errorCode: "TRANSPORT_ERROR",
      });
    }

    if (r.status === 201 || r.status === 200) {
      const body = providerObject(r.json) ?? {};
      const id = this.documentId(body, kindOf(submission.documentType));
      if (!id) {
        return this.outcome("delivery_failed", "pending", {
          providerMessageId: "",
          detail: "A-Cube accepted the request but returned no document id to track.",
          errorCode: "ACUBE_NO_DOCUMENT_ID",
          raw: r.json,
        });
      }
      const providerStatus = providerString(body.status) ?? "";
      const errorCode = acubeStatusErrorCode(providerStatus);
      return this.outcome(mapAcubeDeliveryStatus(providerStatus), "pending", {
        providerMessageId: id,
        providerStatus,
        detail: errorCode ? "A-Cube returned an unsuccessful document status." : null,
        errorCode,
        raw: r.json,
      });
    }

    log.warn(
      { status: r.status, invoiceId: submission.invoiceId },
      "A-Cube did not accept the submission"
    );
    if (r.status === 422 || r.status === 400 || r.status === 404) {
      const reasons = acubeViolations(r.json);
      const code =
        r.status === 422
          ? "ACUBE_VALIDATION"
          : r.status === 404
            ? "ACUBE_LEGAL_ENTITY_NOT_FOUND"
            : "ACUBE_BAD_REQUEST";
      return this.outcome("rejected", "pending", {
        providerMessageId: "",
        reasons: reasons.length
          ? reasons
          : [{ code, message: `A-Cube answered HTTP ${r.status}`, field: null }],
        detail: reasons.map((x) => x.message).join("; ") || `HTTP ${r.status}`,
        errorCode: code,
        raw: r.json ?? r.text,
      });
    }
    return this.outcome("delivery_failed", "pending", {
      providerMessageId: "",
      detail: `A-Cube answered HTTP ${r.status}`,
      errorCode:
        r.status === 401 || r.status === 403
          ? "ACUBE_AUTH_FAILED"
          : r.status === 429
            ? "ACUBE_RATE_LIMITED"
            : "ACUBE_UNAVAILABLE",
      raw: r.json ?? r.text,
    });
  }

  async getStatus(
    providerMessageId: string,
    ref: EInvoiceDocumentRef = {}
  ): Promise<EInvoiceProviderResult> {
    const kind = kindOf(ref.documentType);
    let r: RawResponse;
    try {
      r = await this.call("GET", `/${kind}/${encodeURIComponent(providerMessageId)}`);
    } catch (err) {
      return {
        providerMessageId,
        status: "failed",
        detail: "Could not read the document status from A-Cube.",
        errorCode: err instanceof AcubeApiError ? err.code : "TRANSPORT_ERROR",
      };
    }
    if (!r.ok) {
      return {
        providerMessageId,
        status: "failed",
        detail: `A-Cube answered HTTP ${r.status}`,
        errorCode: r.status === 429 ? "ACUBE_RATE_LIMITED" : "ACUBE_UNAVAILABLE",
        raw: r.json ?? r.text,
      };
    }
    const body = providerObject(r.json);
    const providerStatus = providerString(body?.status);
    const returnedId = this.documentId(body, kind);
    if (!providerStatus || returnedId !== providerMessageId) {
      return {
        providerMessageId,
        status: "failed",
        detail: "A-Cube returned an invalid document status response.",
        errorCode: "ACUBE_UNAVAILABLE",
      };
    }
    const delivery = mapAcubeDeliveryStatus(providerStatus);
    return this.outcome(delivery, "pending", {
      providerMessageId,
      providerStatus,
      detail: delivery === "delivery_failed" ? `A-Cube status: ${providerStatus}` : null,
      errorCode: acubeStatusErrorCode(providerStatus),
      raw: r.json,
    });
  }

  /**
   * FTA reporting track. A-Cube builds and transmits the Tax Data Document (TDD) to the FTA;
   * GET /{kind}/{id}/tdd answers 200 with the TDD once it exists and 204/404 before that.
   * ASSUMPTION to confirm in sandbox: TDD present = reported. FTA rejections arrive as Message
   * Level Status (MLS) documents, which the public docs do not enumerate yet.
   */
  async getReportingStatus(
    providerMessageId: string,
    ref: EInvoiceDocumentRef = {}
  ): Promise<{ reporting: ReportingStatus; detail?: string | null }> {
    const kind = kindOf(ref.documentType);
    const r = await this.call(
      "GET",
      `/${kind}/${encodeURIComponent(providerMessageId)}/tdd`,
      undefined,
      "application/xml"
    );
    if (r.status === 200) {
      // The source must be a TDD, not an HTML or generic XML error returned with HTTP 200.
      try {
        if (parseXml(r.text).documentElement?.localName === "TaxDataDocument")
          return { reporting: "reported" };
      } catch {
        // An invalid response leaves the reporting status pending.
      }
    }
    if (r.status === 204 || r.status === 404) return { reporting: "pending" };
    throw new AcubeApiError(r.status, "ACUBE_UNAVAILABLE", `A-Cube TDD answered HTTP ${r.status}`);
  }

  /** A number can repeat across companies. Link only the original outbound XML we handed over. */
  async lookupSubmission(submission: EInvoiceSubmission): Promise<EInvoiceProviderResult | null> {
    const kind = kindOf(submission.documentType);
    const r = await this.call("GET", `/${kind}?direction=outgoing&itemsPerPage=30&page=1`);
    const items = Array.isArray(r.json) ? r.json : providerObject(r.json)?.["hydra:member"];
    if (!r.ok || !Array.isArray(items)) {
      throw new AcubeApiError(
        502,
        "ACUBE_UNAVAILABLE",
        "Could not read the A-Cube outgoing collection."
      );
    }
    const numberKey = kind === "credit-notes" ? "creditNoteNumber" : "invoiceNumber";
    const matches: EInvoiceProviderResult[] = [];
    for (const item of items) {
      const candidate = providerObject(item);
      if (
        !candidate ||
        candidate[numberKey] !== submission.invoiceNumber ||
        candidate.direction !== "outgoing"
      )
        continue;
      const id = this.documentId(candidate, kind);
      if (!id) continue;
      const source = await this.fetchSource(id, { documentType: submission.documentType });
      if (source.trim() !== submission.xml.trim()) continue;
      const providerStatus = providerString(candidate.status);
      if (!providerStatus || acubeStatusErrorCode(providerStatus) === "ACUBE_UNKNOWN_STATUS") {
        throw new AcubeApiError(
          502,
          "ACUBE_UNAVAILABLE",
          "Could not confirm the matched A-Cube document status."
        );
      }
      matches.push(
        this.outcome(mapAcubeDeliveryStatus(providerStatus), "pending", {
          providerMessageId: id,
          providerStatus,
          errorCode: acubeStatusErrorCode(providerStatus),
        })
      );
    }
    return matches.length === 1 ? matches[0] : null;
  }

  async listInbound(): Promise<InboundListing[]> {
    const out: InboundListing[] = [];
    for (const kind of ["invoices", "credit-notes"] as const) {
      const r = await this.call("GET", `/${kind}?direction=incoming&itemsPerPage=30&page=1`);
      if (!r.ok) throw new AcubeApiError(r.status, "ACUBE_UNAVAILABLE", `A-Cube list ${kind}`);
      const items = Array.isArray(r.json)
        ? r.json
        : (((r.json as Record<string, unknown>)?.["hydra:member"] as unknown[]) ?? []);
      for (const item of items) {
        const raw = providerObject(item);
        const id = this.documentId(raw, kind);
        if (!raw || !id || (raw.direction && raw.direction !== "incoming")) continue;
        out.push({
          providerMessageId: id,
          documentType: str(raw.documentTypeCode) ?? (kind === "credit-notes" ? "381" : "380"),
          documentNumber: str(raw.invoiceNumber) ?? str(raw.creditNoteNumber),
          legalEntityId: str(raw.legalEntityUuid),
          ownerFiscalId: str(raw.ownerFiscalId),
        });
      }
    }
    return out;
  }

  /** Document metadata (legal entity, number) for an id from a webhook. */
  async getDocument(
    providerMessageId: string,
    ref: EInvoiceDocumentRef = {}
  ): Promise<Record<string, unknown>> {
    const kind = kindOf(ref.documentType);
    const r = await this.call("GET", `/${kind}/${encodeURIComponent(providerMessageId)}`);
    if (!r.ok) {
      throw new AcubeApiError(r.status, "ACUBE_UNAVAILABLE", `A-Cube ${kind} answered ${r.status}`);
    }
    const document = providerObject(r.json);
    if (!document || this.documentId(document, kind) !== providerMessageId) {
      throw new AcubeApiError(
        502,
        "ACUBE_UNAVAILABLE",
        "A-Cube returned an invalid document resource."
      );
    }
    return document;
  }

  async fetchSource(providerMessageId: string, ref: EInvoiceDocumentRef = {}): Promise<string> {
    const kind = kindOf(ref.documentType);
    const r = await this.call(
      "GET",
      `/${kind}/${encodeURIComponent(providerMessageId)}/source`,
      undefined,
      "application/xml"
    );
    if (!r.ok || !r.text.trim().startsWith("<")) {
      throw new AcubeApiError(r.status, "ACUBE_UNAVAILABLE", `A-Cube source answered ${r.status}`);
    }
    return r.text;
  }

  private documentId(body: Record<string, unknown> | null, kind: Kind): string | null {
    return (
      providerString(body?.uuid) ??
      providerString(body?.[kind === "credit-notes" ? "creditNoteId" : "invoiceId"])
    );
  }

  /** Two-step receive: list incoming documents, then fetch each one's source XML. */
  async receive(): Promise<InboundEInvoice[]> {
    const out: InboundEInvoice[] = [];
    for (const item of await this.listInbound()) {
      try {
        out.push({
          providerMessageId: item.providerMessageId,
          xml: await this.fetchSource(item.providerMessageId, { documentType: item.documentType }),
          receivedAt: null,
        });
      } catch {
        log.warn({ id: item.providerMessageId }, "A-Cube source fetch failed");
      }
    }
    return out;
  }

  async cancel(providerMessageId: string): Promise<EInvoiceProviderResult> {
    return {
      providerMessageId,
      status: "failed",
      detail: "A-Cube has no cancellation; issue a credit note instead.",
    };
  }

  /** Webhooks are verified and queued by the route; nothing is parsed here. */
  parseWebhook(): null {
    return null;
  }

  /** E2 inbox hook: the document's legal entity, re-read from A-Cube (never from the payload). */
  async inboundOwner(providerMessageId: string, ref: EInvoiceDocumentRef): Promise<InboundOwner> {
    const meta = await this.getDocument(providerMessageId, ref);
    return {
      legalEntityId: (meta.legalEntityUuid as string | undefined) ?? null,
      tin: (meta.ownerFiscalId as string | undefined) ?? null,
    };
  }

  /** E2 inbox hook: legal_entity.synchronized -> the legal entity as A-Cube holds it now. */
  async legalEntityPatch(
    legalEntityId: string,
    payload: Record<string, unknown>
  ): Promise<LegalEntityPatch> {
    const { legalEntityPatchFrom } = await import("../legal-entities");
    const current = await this.getLegalEntity(legalEntityId);
    return legalEntityPatchFrom({
      ...current,
      action: typeof payload.action === "string" ? payload.action : null,
    });
  }

  // ─── Legal entities ──────────────────────────────────────────────────

  /** Reserve the TIN so the taxpayer can link it in EmaraTax (POST /legal-entities). */
  async reserveLegalEntity(tin: string): Promise<AcubeLegalEntity> {
    const r = await this.call("POST", "/legal-entities", { json: { tin } });
    if (r.status === 201 || r.status === 200) return this.legalEntity(r.json);
    const reasons = acubeViolations(r.json);
    throw new AcubeApiError(
      r.status,
      r.status === 422 || r.status === 400 ? "ACUBE_VALIDATION" : "ACUBE_UNAVAILABLE",
      reasons.map((x) => x.message).join("; ") || `A-Cube answered HTTP ${r.status}`,
      r.json
    );
  }

  async getLegalEntity(legalEntityId: string): Promise<AcubeLegalEntity> {
    const r = await this.call("GET", `/legal-entities/${encodeURIComponent(legalEntityId)}`);
    if (!r.ok) {
      throw new AcubeApiError(r.status, "ACUBE_UNAVAILABLE", `A-Cube legal entity ${r.status}`);
    }
    return this.legalEntity(r.json, legalEntityId);
  }

  private legalEntity(value: unknown, expectedId?: string): AcubeLegalEntity {
    const body = providerObject(value);
    const legalEntityId = providerString(body?.uuid) ?? providerString(body?.legalEntityId);
    const tin = providerString(body?.tin);
    const status = providerString(body?.status);
    if (!legalEntityId || !tin || !status || (expectedId && legalEntityId !== expectedId)) {
      throw new AcubeApiError(
        502,
        "ACUBE_UNAVAILABLE",
        "A-Cube returned an invalid legal entity resource."
      );
    }
    return { ...body, legalEntityId, tin, status };
  }

  /** Register the account's webhook destinations (idempotent: existing targets are kept). */
  async ensureEventDestinations(args: {
    target: string;
    events: string[];
    authKey?: string | null;
    authToken?: string | null;
  }): Promise<{ created: string[]; existing: string[] }> {
    const list = await this.call("GET", "/event-destinations");
    const items = Array.isArray(list.json)
      ? (list.json as Array<Record<string, unknown>>)
      : (((list.json as Record<string, unknown>)?.["hydra:member"] as Array<
          Record<string, unknown>
        >) ?? []);
    const created: string[] = [];
    const existing: string[] = [];
    for (const event of args.events) {
      if (items.some((i) => i.event === event && i.target === args.target)) {
        existing.push(event);
        continue;
      }
      const r = await this.call("POST", "/event-destinations", {
        json: {
          event,
          target: args.target,
          delivery: "webhook",
          authType: args.authToken ? "header" : "none",
          authKey: args.authToken ? (args.authKey ?? null) : null,
          authToken: args.authToken ?? null,
        },
      });
      if (!r.ok) {
        throw new AcubeApiError(r.status, "ACUBE_UNAVAILABLE", `event destination ${event}`);
      }
      created.push(event);
    }
    return { created, existing };
  }
}

/** E2: A-Cube's entry in the provider registry (registry.ts). */
export const ACUBE_PROVIDER_MODULE: EInvoiceProviderModule = {
  id: ACUBE_PROVIDER_NAME,
  displayName: "A-Cube",
  legalName: "Platform ACube Technologies LLC",
  accreditationNumber: ACUBE_ACCREDITATION_NUMBER,
  website: "https://www.acubeapi.com/en/uae",
  emaraTaxListing: "PLATFORM ACUBE TECHNOLOGIES L.L.C",
  envVars: [
    "ACUBE_ENV",
    "ACUBE_EMAIL",
    "ACUBE_PASSWORD",
    "ACUBE_BASE_URL",
    "ACUBE_LOGIN_URL",
    "ACUBE_INVOICE_SUBMIT_PATH",
    "ACUBE_CREDIT_NOTE_SUBMIT_PATH",
    "ACUBE_TIMEOUT_MS",
    "ACUBE_WEBHOOK_BASE_URL",
    "ACUBE_WEBHOOK_TOKEN",
    "ACUBE_WEBHOOK_TOKEN_HEADER",
    "ACUBE_SIGNATURE_PUBLIC_KEY",
    "ACUBE_WEBHOOK_MAX_AGE_SECONDS",
  ],
  configured: acubeConfigured,
  environment: acubeEnvironment,
  notConfiguredMessage: "The A-Cube e-invoicing provider requires ACUBE_EMAIL and ACUBE_PASSWORD.",
  create: (env, deps) => new AcubeEInvoiceProvider(env, deps),
};
