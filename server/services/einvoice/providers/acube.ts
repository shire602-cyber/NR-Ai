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
import { createHash, createHmac } from "node:crypto";
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
import { isCreditNoteDocumentType } from "../pint-ae-codes";
import {
  acubeStatusErrorCode,
  legacyFromProviderTracks,
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
const kindOf = (ref: EInvoiceDocumentRef = {}): Kind => {
  const credit = ref.documentCollection
    ? ref.documentCollection === "credit-note"
    : isCreditNoteDocumentType(ref.documentType);
  return credit ? "credit-notes" : "invoices";
};
const COLLECTION_PAGE_SIZE = 30;
const COLLECTION_TIMEOUT_MS = 120_000;

interface RawResponse {
  ok: boolean;
  status: number;
  json: unknown;
  text: string;
  originalText?: string;
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
    accept = "application/json",
    options: { signal?: AbortSignal; preserveOriginalText?: boolean } = {}
  ): Promise<RawResponse> {
    const send = async (token: string): Promise<RawResponse> => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.cfg.timeoutMs);
      try {
        const signal = options.signal
          ? AbortSignal.any([options.signal, controller.signal])
          : controller.signal;
        signal.throwIfAborted();
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
          signal,
        });
        const parsed = await readProviderResponse(
          res,
          [this.cfg.email, this.cfg.password, token],
          res.ok && options.preserveOriginalText === true
        );
        return { ok: res.ok, status: res.status, ...parsed };
      } catch {
        throw new AcubeApiError(502, "TRANSPORT_ERROR", "Could not contact A-Cube.");
      } finally {
        clearTimeout(timer);
      }
    };
    const first = await send(await this.token());
    if (first.status !== 401) return first;
    options.signal?.throwIfAborted();
    return send(await this.token({ force: true }));
  }

  private submitPath(ref: EInvoiceDocumentRef): string {
    return kindOf(ref) === "credit-notes"
      ? this.cfg.creditNoteSubmitPath
      : this.cfg.invoiceSubmitPath;
  }

  /** Bind a queued submission to its company, A-Cube account and endpoint configuration. */
  async getSubmissionScope(companyId: string): Promise<string> {
    const { environment, email, baseUrl, loginUrl, invoiceSubmitPath, creditNoteSubmitPath } =
      this.cfg;
    return createHmac("sha256", this.cfg.password)
      .update(
        JSON.stringify([
          "einvoice-acube-submission",
          companyId,
          environment,
          email,
          baseUrl,
          loginUrl,
          invoiceSubmitPath,
          creditNoteSubmitPath,
        ])
      )
      .digest("hex");
  }

  private outcome(
    delivery: DeliveryStatus,
    reporting: ReportingStatus,
    extra: Partial<EInvoiceProviderResult> & { providerMessageId: string }
  ): EInvoiceProviderResult {
    const status: EInvoiceStatus = legacyFromProviderTracks(
      this.name,
      extra.providerStatus,
      delivery,
      reporting
    );
    return { status, delivery, reporting, ...extra };
  }

  async submit(submission: EInvoiceSubmission): Promise<EInvoiceProviderResult> {
    let r: RawResponse;
    try {
      r = await this.call("POST", this.submitPath(submission), {
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
      // A-Cube may already hold the document. The worker reconciles by source XML.
      return this.outcome("delivery_failed", "pending", {
        providerMessageId: "",
        detail: "Could not contact A-Cube.",
        errorCode: "TRANSPORT_ERROR",
      });
    }

    if (r.status === 201 || r.status === 200) {
      const body = providerObject(r.json) ?? {};
      const id = this.documentId(body, kindOf(submission));
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
      const delivery = mapAcubeDeliveryStatus(providerStatus);
      return this.outcome(delivery, "pending", {
        providerMessageId: id,
        providerStatus,
        detail:
          delivery === "delivery_failed" || delivery === "rejected"
            ? "A-Cube returned an unsuccessful document status."
            : null,
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
    const kind = kindOf(ref);
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

  // The TDD download only confirms that an artifact is available. The A-Cube contract does
  // not expose an FTA acknowledgement through that endpoint, so reporting remains pending.

  private async *documentPages(
    kind: Kind,
    direction: "incoming" | "outgoing",
    signal: AbortSignal
  ): AsyncGenerator<unknown[]> {
    const visited = new Set<string>();
    for (let page = 1; ; page++) {
      signal.throwIfAborted();
      const r = await this.call(
        "GET",
        `/${kind}?direction=${direction}&itemsPerPage=${COLLECTION_PAGE_SIZE}&page=${page}`,
        undefined,
        "application/ld+json",
        { signal }
      );
      const body = providerObject(r.json);
      const items = Array.isArray(r.json) ? r.json : (body?.member ?? body?.["hydra:member"]);
      if (!r.ok || !Array.isArray(items)) {
        throw new AcubeApiError(
          r.ok ? 502 : r.status,
          "ACUBE_UNAVAILABLE",
          `Could not read the A-Cube ${direction} collection.`
        );
      }
      const view = providerObject(body?.view ?? body?.["hydra:view"]);
      const total = body?.totalItems ?? body?.["hydra:totalItems"];
      // Rebuild the numbered page on the configured host, retaining our resource and filters.
      const more =
        !!providerString(view?.next ?? view?.["hydra:next"]) ||
        (typeof total === "number"
          ? total > page * COLLECTION_PAGE_SIZE
          : !view && items.length >= COLLECTION_PAGE_SIZE);
      const ids = items.map((item: unknown) => this.documentId(providerObject(item), kind) ?? "");
      const pageKey = JSON.stringify(ids.sort());
      if ((more && !items.length) || (items.length && visited.has(pageKey))) {
        throw new AcubeApiError(
          502,
          "ACUBE_UNAVAILABLE",
          `A-Cube returned inconsistent ${direction} pagination.`
        );
      }
      visited.add(pageKey);
      yield items;
      if (!more) return;
    }
  }

  /** A number can repeat across companies. Link only the original outbound XML we handed over. */
  async lookupSubmission(submission: EInvoiceSubmission): Promise<EInvoiceProviderResult | null> {
    const kind = kindOf(submission);
    const numberKey = kind === "credit-notes" ? "creditNoteNumber" : "invoiceNumber";
    const signal = AbortSignal.timeout(COLLECTION_TIMEOUT_MS);
    const checked = new Set<string>();
    let matched: EInvoiceProviderResult | null = null;
    for await (const items of this.documentPages(kind, "outgoing", signal)) {
      for (const item of items) {
        const candidate = providerObject(item);
        if (
          candidate?.[numberKey] !== submission.invoiceNumber ||
          candidate.direction !== "outgoing"
        )
          continue;
        const id = this.documentId(candidate, kind);
        if (!id || checked.has(id)) continue;
        checked.add(id);
        const source = await this.fetchSource(id, submission, signal);
        if (source !== submission.xml) continue;
        if (matched) return null;
        const providerStatus = providerString(candidate.status);
        if (!providerStatus || acubeStatusErrorCode(providerStatus) === "ACUBE_UNKNOWN_STATUS") {
          throw new AcubeApiError(
            502,
            "ACUBE_UNAVAILABLE",
            "Could not confirm the matched A-Cube document status."
          );
        }
        matched = this.outcome(mapAcubeDeliveryStatus(providerStatus), "pending", {
          providerMessageId: id,
          providerStatus,
          errorCode: acubeStatusErrorCode(providerStatus),
        });
      }
    }
    return matched;
  }

  async listInbound(): Promise<InboundListing[]> {
    const out = new Map<string, InboundListing>();
    const signal = AbortSignal.timeout(COLLECTION_TIMEOUT_MS);
    for (const kind of ["invoices", "credit-notes"] as const) {
      for await (const items of this.documentPages(kind, "incoming", signal)) {
        for (const item of items) {
          const raw = providerObject(item);
          const id = this.documentId(raw, kind);
          if (!raw || !id || (raw.direction && raw.direction !== "incoming")) continue;
          const documentCollection = kind === "credit-notes" ? "credit-note" : "invoice";
          const key = `${documentCollection}:${id}`;
          if (out.has(key)) continue;
          const code = raw.documentTypeCode;
          const documentType =
            typeof code === "number" && Number.isInteger(code)
              ? String(code)
              : providerString(code);
          out.set(key, {
            providerMessageId: id,
            documentCollection,
            documentType: documentType ?? (kind === "credit-notes" ? "381" : "380"),
            documentNumber: str(raw.invoiceNumber) ?? str(raw.creditNoteNumber),
            legalEntityId: str(raw.legalEntityUuid),
            ownerFiscalId: str(raw.ownerFiscalId),
          });
        }
      }
    }
    return [...out.values()];
  }

  /** Document metadata (legal entity, number) for an id from a webhook. */
  async getDocument(
    providerMessageId: string,
    ref: EInvoiceDocumentRef = {}
  ): Promise<Record<string, unknown>> {
    const kind = kindOf(ref);
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

  async fetchSource(
    providerMessageId: string,
    ref: EInvoiceDocumentRef = {},
    signal?: AbortSignal
  ): Promise<string> {
    const kind = kindOf(ref);
    const r = await this.call(
      "GET",
      `/${kind}/${encodeURIComponent(providerMessageId)}/source`,
      undefined,
      "application/xml",
      { signal, preserveOriginalText: true }
    );
    if (!r.ok || !r.originalText?.trimStart().startsWith("<")) {
      throw new AcubeApiError(r.status, "ACUBE_UNAVAILABLE", `A-Cube source answered ${r.status}`);
    }
    return r.originalText;
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
          xml: await this.fetchSource(item.providerMessageId, item),
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
    payload: Record<string, unknown>,
    expectedTin: string
  ): Promise<LegalEntityPatch> {
    const { legalEntityPatchFrom } = await import("../legal-entities");
    const current = await this.getLegalEntity(legalEntityId, expectedTin);
    return legalEntityPatchFrom({
      ...current,
      action: typeof payload.action === "string" ? payload.action : null,
    });
  }

  // ─── Legal entities ──────────────────────────────────────────────────

  /** Reserve the TIN so the taxpayer can link it in EmaraTax (POST /legal-entities). */
  async reserveLegalEntity(tin: string): Promise<AcubeLegalEntity> {
    const r = await this.call("POST", "/legal-entities", { json: { tin } });
    if (r.status === 201 || r.status === 200) return this.legalEntity(r.json, { tin });
    const reasons = acubeViolations(r.json);
    throw new AcubeApiError(
      r.status,
      r.status === 422 || r.status === 400 ? "ACUBE_VALIDATION" : "ACUBE_UNAVAILABLE",
      reasons.map((x) => x.message).join("; ") || `A-Cube answered HTTP ${r.status}`,
      r.json
    );
  }

  async getLegalEntity(legalEntityId: string, tin?: string): Promise<AcubeLegalEntity> {
    const r = await this.call("GET", `/legal-entities/${encodeURIComponent(legalEntityId)}`);
    if (!r.ok) {
      throw new AcubeApiError(r.status, "ACUBE_UNAVAILABLE", `A-Cube legal entity ${r.status}`);
    }
    return this.legalEntity(r.json, { id: legalEntityId, tin });
  }

  private legalEntity(value: unknown, expected: { id?: string; tin?: string }): AcubeLegalEntity {
    const body = providerObject(value);
    const legalEntityId = providerString(body?.uuid) ?? providerString(body?.legalEntityId);
    const tin = providerString(body?.tin);
    const status = providerString(body?.status);
    if (!legalEntityId || !tin || !status || (expected.id && legalEntityId !== expected.id)) {
      throw new AcubeApiError(
        502,
        "ACUBE_UNAVAILABLE",
        "A-Cube returned an invalid legal entity resource."
      );
    }
    if (expected.tin && tin !== expected.tin) {
      throw new AcubeApiError(
        502,
        "EINVOICE_PROVIDER_TIN_MISMATCH",
        "A-Cube returned a different taxpayer."
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
