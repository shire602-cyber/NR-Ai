// Provider-agnostic ASP seam for UAE e-invoicing.
//
// The app never talks to a specific Accredited Service Provider (ASP) directly.
// It depends only on the EInvoiceProvider interface below; a concrete adapter is
// selected at runtime. The generic HTTP adapter (einvoice-provider-http.ts) is
// configuration-driven: base URL, auth scheme and a field-mapping file describe
// the ASP's API, so onboarding an ASP is configuration plus a recorded contract
// test, not a rewrite.
//
// EXTERNAL: no ASP is contracted yet. Until EINVOICE_ASP_BASE_URL/API_KEY are
// issued by an MoF-accredited provider, production answers 503
// EINVOICE_PROVIDER_NOT_CONFIGURED and the mock is refused.

import {
  isEInvoiceStatus,
  type EInvoiceRejectionReason,
  type EInvoiceStatus,
} from "./einvoice-status";
import { HttpEInvoiceProvider } from "./einvoice-provider-http";
import type { DeliveryStatus, ReportingStatus } from "./einvoice/tracks";
import type { einvoiceLegalEntities } from "../../shared/schema";
// E2: accredited providers (A-Cube, Complyance) are registered modules, selected by name.
import { providerModule, registeredProviderIds } from "./einvoice/providers/registry";

export interface EInvoiceSubmission {
  invoiceId: string;
  invoiceNumber: string;
  uuid: string;
  xml: string;
  documentType?: string;
  /** E2: our company id, for providers that address each submission to a per-company source. */
  companyId?: string;
}

export interface EInvoiceProviderResult {
  /** The ASP's own message/document id, stored so we can poll status later. */
  providerMessageId: string;
  status: EInvoiceStatus;
  /** Provider-specific detail (rejection reasons, etc.) for the audit trail. */
  detail?: string | null;
  reasons?: EInvoiceRejectionReason[];
  raw?: unknown;
  /** E1 two-track status, when the provider reports it (else derived from `status`). */
  delivery?: DeliveryStatus;
  reporting?: ReportingStatus;
  /** The provider's own status word, kept for the history drawer. */
  providerStatus?: string | null;
  /** Stable error code (tracks.ts EINVOICE_ERROR_CODES) for the UI to localise. */
  errorCode?: string | null;
  /**
   * X6a: the ASP refused the submission because it already holds a document with this number,
   * without saying which one. After an ambiguous transport error that document is probably this
   * invoice, so the workflow records "needs link" instead of a rejection.
   */
  numberAlreadyHeld?: boolean;
}

/** Options for a status/source call: credit notes live under a separate resource at some ASPs. */
export interface EInvoiceDocumentRef {
  documentType?: string | null;
}

/** A document listed in the ASP's incoming collection (fetch its XML with fetchSource). */
export interface InboundListing {
  providerMessageId: string;
  documentType: string | null;
  documentNumber?: string | null;
  legalEntityId?: string | null;
  ownerFiscalId?: string | null;
}

/** E2: which of our legal entities an incoming document belongs to (provider ids, or the TIN). */
export interface InboundOwner {
  legalEntityId: string | null;
  tin: string | null;
}

export type LegalEntityPatch = Partial<typeof einvoiceLegalEntities.$inferInsert>;

/** A supplier e-invoice the ASP received for us (Peppol corner 3). */
export interface InboundEInvoice {
  providerMessageId: string;
  xml: string;
  receivedAt?: string | null;
}

export interface EInvoiceProviderCapabilities {
  submit: boolean;
  getStatus: boolean;
  receive: boolean;
  cancel: boolean;
}

export type EInvoiceProviderEnvironment = "mock" | "sandbox" | "production";

export interface EInvoiceProvider {
  readonly name: string;
  readonly environment: EInvoiceProviderEnvironment;
  readonly capabilities: EInvoiceProviderCapabilities;
  /** Send a generated PINT-AE document to the ASP for validation/transmission. */
  submit(submission: EInvoiceSubmission): Promise<EInvoiceProviderResult>;
  /** Poll the ASP for the current status of a submitted document. */
  getStatus(providerMessageId: string, ref?: EInvoiceDocumentRef): Promise<EInvoiceProviderResult>;
  /** Pull supplier documents the ASP received since `since`. */
  receive(since?: Date | null): Promise<InboundEInvoice[]>;
  /** Withdraw a document before clearance. */
  cancel(providerMessageId: string, reason: string): Promise<EInvoiceProviderResult>;
  /** E1: FTA reporting track for a delivered document (A-Cube: the Tax Data Document). */
  getReportingStatus?(
    providerMessageId: string,
    ref?: EInvoiceDocumentRef
  ): Promise<{ reporting: ReportingStatus; detail?: string | null }>;
  /** E1: find a document we may already have handed over (ambiguous transport failure). */
  lookupSubmission?(submission: EInvoiceSubmission): Promise<EInvoiceProviderResult | null>;
  /**
   * E1: list incoming documents (two-step receive: list, then fetchSource). E2: providers whose
   * inbox is listed per company receive the provider legal-entity ids to list.
   */
  listInbound?(opts?: { legalEntityIds?: string[] }): Promise<InboundListing[]>;
  /** E1: the original XML of a document held by the ASP. */
  fetchSource?(providerMessageId: string, ref?: EInvoiceDocumentRef): Promise<string>;
  /** E1/E2: providers that only transmit for a linked, active legal entity (EmaraTax). */
  readonly requiresLegalEntity?: boolean;
  /** E2: short brand name for messages ("A-Cube"). */
  readonly displayName?: string;
  /** E2: which legal entity an incoming document (webhook or poll payload) belongs to. */
  inboundOwner?(
    providerMessageId: string,
    ref: EInvoiceDocumentRef,
    payload: Record<string, unknown>
  ): Promise<InboundOwner>;
  /**
   * E2: the current state of a provider legal entity after a provider event, as a row patch
   * (the provider re-reads it; the event payload is not trusted).
   */
  legalEntityPatch?(
    legalEntityId: string,
    payload: Record<string, unknown>
  ): Promise<LegalEntityPatch | null>;
  /** Map an inbound ASP status webhook payload to a normalised status update. */
  parseWebhook(
    payload: unknown
  ): { providerMessageId: string; status: EInvoiceStatus; detail?: string | null } | null;
}

export class EInvoiceProviderError extends Error {
  constructor(
    public readonly code: "EINVOICE_PROVIDER_NOT_CONFIGURED" | "EINVOICE_CAPABILITY_UNSUPPORTED",
    message: string,
    public readonly status = 503
  ) {
    super(message);
    this.name = "EInvoiceProviderError";
  }
}

const MOCK_STATUS: Record<string, EInvoiceStatus> = {
  submitted: "submitted",
  accepted: "accepted",
  delivered: "accepted",
  cleared: "cleared",
  reported: "cleared",
  rejected: "rejected",
  failed: "failed",
  cancelled: "cancelled",
};

/**
 * Deterministic mock ASP for local dev and tests. submit() always accepts the
 * hand-off (returns "submitted"); the eventual outcome is configurable so tests
 * can exercise cleared/rejected paths. Never available in production.
 */
export class MockEInvoiceProvider implements EInvoiceProvider {
  readonly name = "mock";
  readonly environment = "mock" as const;
  readonly capabilities = { submit: true, getStatus: true, receive: true, cancel: true };
  private readonly outcome: EInvoiceStatus;
  private readonly detail: string | null;
  private readonly reasons: EInvoiceRejectionReason[];
  private readonly inbox: InboundEInvoice[];

  constructor(
    opts: {
      outcome?: EInvoiceStatus;
      detail?: string | null;
      reasons?: EInvoiceRejectionReason[];
      inbox?: InboundEInvoice[];
    } = {}
  ) {
    this.outcome = opts.outcome ?? "cleared";
    this.detail = opts.detail ?? null;
    this.reasons = opts.reasons ?? [];
    this.inbox = opts.inbox ?? [];
  }

  async submit(submission: EInvoiceSubmission): Promise<EInvoiceProviderResult> {
    return { providerMessageId: `mock-${submission.uuid}`, status: "submitted", detail: null };
  }

  async getStatus(providerMessageId: string): Promise<EInvoiceProviderResult> {
    return {
      providerMessageId,
      status: this.outcome,
      detail: this.detail,
      reasons: this.outcome === "rejected" ? this.reasons : [],
    };
  }

  async receive(): Promise<InboundEInvoice[]> {
    return [...this.inbox];
  }

  async cancel(providerMessageId: string): Promise<EInvoiceProviderResult> {
    return { providerMessageId, status: "cancelled", detail: null };
  }

  parseWebhook(
    payload: unknown
  ): { providerMessageId: string; status: EInvoiceStatus; detail?: string | null } | null {
    const p = payload as Record<string, unknown> | null;
    const id = p?.messageId ?? p?.providerMessageId;
    const status = p?.status;
    if (typeof id !== "string" || typeof status !== "string") return null;
    const key = status.toLowerCase();
    const mapped = MOCK_STATUS[key] ?? (isEInvoiceStatus(key) ? key : undefined);
    if (!mapped) return null;
    return {
      providerMessageId: id,
      status: mapped,
      detail: typeof p?.detail === "string" ? p.detail : null,
    };
  }
}

/** True when an ASP base URL + key are configured (new or legacy variable names). */
export function httpAspConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  const base = env.EINVOICE_ASP_BASE_URL || env.EINVOICE_API_BASE_URL;
  const key = env.EINVOICE_ASP_API_KEY || env.EINVOICE_API_KEY;
  return !!base && !!key;
}

/** True when a real ASP is configured: the generic HTTP adapter or a registered ASP (E1/E2). */
export function aspConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  const m = providerModule(env.EINVOICE_PROVIDER);
  if (m) return m.configured(env);
  return httpAspConfigured(env);
}

/**
 * Select the active provider. EINVOICE_PROVIDER = mock | http; when unset,
 * "http" if an ASP is configured, else "mock" outside production. Production
 * never gets the mock: it would fabricate acceptance responses.
 */
export function getEInvoiceProvider(
  env: NodeJS.ProcessEnv = process.env,
  deps: { fetch?: typeof fetch } = {}
): EInvoiceProvider {
  const name = (env.EINVOICE_PROVIDER || (httpAspConfigured(env) ? "http" : "mock")).toLowerCase();

  if (name === "mock" && env.NODE_ENV === "production") {
    throw new EInvoiceProviderError(
      "EINVOICE_PROVIDER_NOT_CONFIGURED",
      "E-invoicing is not configured. The mock provider cannot be used in production because it " +
        "fabricates acceptance responses. Contract an MoF-accredited service provider and set " +
        "EINVOICE_ASP_BASE_URL and EINVOICE_ASP_API_KEY."
    );
  }

  // E1/E2: an accredited provider module (A-Cube, Complyance). Credentials come from
  // env/secrets only; a selected provider without them is "not configured", never a fallback.
  const registered = providerModule(name);
  if (registered) {
    if (!registered.configured(env)) {
      throw new EInvoiceProviderError(
        "EINVOICE_PROVIDER_NOT_CONFIGURED",
        registered.notConfiguredMessage
      );
    }
    return registered.create(env, deps);
  }

  switch (name) {
    case "mock":
      return new MockEInvoiceProvider();
    case "http":
      if (!httpAspConfigured(env)) {
        throw new EInvoiceProviderError(
          "EINVOICE_PROVIDER_NOT_CONFIGURED",
          "E-invoicing HTTP provider requires EINVOICE_ASP_BASE_URL and EINVOICE_ASP_API_KEY, " +
            "issued by your accredited service provider."
        );
      }
      return new HttpEInvoiceProvider(env, deps);
    default:
      throw new EInvoiceProviderError(
        "EINVOICE_PROVIDER_NOT_CONFIGURED",
        `Unknown EINVOICE_PROVIDER "${name}". Use ${registeredProviderIds()
          .map((id) => `"${id}"`)
          .join(" or ")}, or "http" with an ASP mapping file.`
      );
  }
}
