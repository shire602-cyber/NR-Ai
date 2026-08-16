// Provider-agnostic ASP seam for UAE e-invoicing.
//
// The app never talks to a specific Accredited Service Provider (ASP) directly.
// It depends only on the EInvoiceProvider interface below; a concrete adapter is
// written per ASP and selected at runtime. This keeps the first ASP choice from
// being load-bearing, lets the whole submit→status→webhook flow be tested with a
// mock (no ASP account needed), and means switching/ adding a provider later is
// a new adapter class, not a rewrite.
//
// To add a real ASP (e.g. ClearTax / Complyance / Storecove / Pagero): implement
// EInvoiceProvider against their REST API and register it in getEInvoiceProvider.

import type { EInvoiceStatus } from "./einvoice-status";
import { HttpEInvoiceProvider } from "./einvoice-provider-http";

export interface EInvoiceSubmission {
  invoiceId: string;
  invoiceNumber: string;
  uuid: string;
  xml: string;
}

export interface EInvoiceProviderResult {
  /** The ASP's own message/document id, stored so we can poll status later. */
  providerMessageId: string;
  status: EInvoiceStatus;
  /** Provider-specific detail (rejection reasons, etc.) for the audit trail. */
  detail?: string | null;
  raw?: unknown;
}

export interface EInvoiceProvider {
  readonly name: string;
  /** Send a generated PINT-AE document to the ASP for clearance/transmission. */
  submit(submission: EInvoiceSubmission): Promise<EInvoiceProviderResult>;
  /** Poll the ASP for the current clearance status of a submitted document. */
  getStatus(providerMessageId: string): Promise<EInvoiceProviderResult>;
  /** Map an inbound ASP webhook payload to a normalised status update. */
  parseWebhook(payload: unknown): { providerMessageId: string; status: EInvoiceStatus; detail?: string | null } | null;
}

/**
 * Deterministic mock ASP for local dev and tests. submit() always accepts the
 * hand-off (returns "submitted"); the eventual clearance outcome is
 * configurable so tests can exercise accepted/rejected paths.
 */
export class MockEInvoiceProvider implements EInvoiceProvider {
  readonly name = "mock";
  private readonly outcome: EInvoiceStatus;
  private readonly detail: string | null;

  constructor(opts: { outcome?: EInvoiceStatus; detail?: string | null } = {}) {
    this.outcome = opts.outcome ?? "accepted";
    this.detail = opts.detail ?? null;
  }

  async submit(submission: EInvoiceSubmission): Promise<EInvoiceProviderResult> {
    return { providerMessageId: `mock-${submission.uuid}`, status: "submitted", detail: null };
  }

  async getStatus(providerMessageId: string): Promise<EInvoiceProviderResult> {
    return { providerMessageId, status: this.outcome, detail: this.detail };
  }

  parseWebhook(
    payload: unknown
  ): { providerMessageId: string; status: EInvoiceStatus; detail?: string | null } | null {
    const p = payload as Record<string, unknown> | null;
    const id = p?.messageId ?? p?.providerMessageId;
    const status = p?.status;
    if (typeof id !== "string" || typeof status !== "string") return null;
    const normalised: Record<string, EInvoiceStatus> = {
      submitted: "submitted",
      accepted: "accepted",
      cleared: "accepted",
      rejected: "rejected",
      failed: "failed",
    };
    const mapped = normalised[status.toLowerCase()];
    if (!mapped) return null;
    return { providerMessageId: id, status: mapped, detail: (p?.detail as string) ?? null };
  }
}

/**
 * Select the active provider. Defaults to the mock so nothing in dev/test
 * depends on a real ASP. Register real adapters here as they are implemented.
 */
export function getEInvoiceProvider(env: NodeJS.ProcessEnv = process.env): EInvoiceProvider {
  const name = (env.EINVOICE_PROVIDER || "mock").toLowerCase();

  // H2/H3 — the mock provider fabricates an "accepted" acknowledgement. That is
  // fine in dev and tests, and catastrophic in production: a UAE business would
  // believe its invoices had been transmitted to the FTA via an Accredited
  // Service Provider when nothing left the building, and is fined per
  // untransmitted invoice. Refuse to serve the mock in production.
  if (name === "mock" && env.NODE_ENV === "production") {
    throw new Error(
      "E-invoicing is not configured. The mock provider cannot be used in production because it " +
        "fabricates acceptance responses. Set EINVOICE_PROVIDER to a real, MoF-accredited service " +
        "provider adapter before enabling e-invoicing."
    );
  }

  switch (name) {
    case "mock":
      return new MockEInvoiceProvider();
    case "http":
      // Generic REST adapter for an MoF-accredited service provider. Going live
      // is configuration, not code: set EINVOICE_API_BASE_URL + EINVOICE_API_KEY
      // and flip EINVOICE_PROVIDER to "http". See einvoice-provider-http.ts.
      return new HttpEInvoiceProvider(env);
    default:
      throw new Error(
        `Unknown EINVOICE_PROVIDER "${name}". Implement an EInvoiceProvider adapter and register it in getEInvoiceProvider.`
      );
  }
}
