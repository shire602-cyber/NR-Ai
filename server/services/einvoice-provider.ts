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

export interface EInvoiceSubmission {
  invoiceId: string;
  invoiceNumber: string;
  uuid: string;
  xml: string;
  documentType?: string;
}

export interface EInvoiceProviderResult {
  /** The ASP's own message/document id, stored so we can poll status later. */
  providerMessageId: string;
  status: EInvoiceStatus;
  /** Provider-specific detail (rejection reasons, etc.) for the audit trail. */
  detail?: string | null;
  reasons?: EInvoiceRejectionReason[];
  raw?: unknown;
}

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
  getStatus(providerMessageId: string): Promise<EInvoiceProviderResult>;
  /** Pull supplier documents the ASP received since `since`. */
  receive(since?: Date | null): Promise<InboundEInvoice[]>;
  /** Withdraw a document before clearance. */
  cancel(providerMessageId: string, reason: string): Promise<EInvoiceProviderResult>;
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
export function aspConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  const base = env.EINVOICE_ASP_BASE_URL || env.EINVOICE_API_BASE_URL;
  const key = env.EINVOICE_ASP_API_KEY || env.EINVOICE_API_KEY;
  return !!base && !!key;
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
  const name = (env.EINVOICE_PROVIDER || (aspConfigured(env) ? "http" : "mock")).toLowerCase();

  if (name === "mock" && env.NODE_ENV === "production") {
    throw new EInvoiceProviderError(
      "EINVOICE_PROVIDER_NOT_CONFIGURED",
      "E-invoicing is not configured. The mock provider cannot be used in production because it " +
        "fabricates acceptance responses. Contract an MoF-accredited service provider and set " +
        "EINVOICE_ASP_BASE_URL and EINVOICE_ASP_API_KEY."
    );
  }

  switch (name) {
    case "mock":
      return new MockEInvoiceProvider();
    case "http":
      if (!aspConfigured(env)) {
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
        `Unknown EINVOICE_PROVIDER "${name}". Use "http" with an ASP mapping file.`
      );
  }
}
