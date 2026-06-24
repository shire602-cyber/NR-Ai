// E-invoice submission lifecycle (provider-independent).
//
// UAE Peppol/DCTCE flow: the invoice XML is generated, handed to an Accredited
// Service Provider (ASP) for transmission to the buyer's ASP and reporting to
// the FTA, then we track the outcome. This module owns the status state machine
// only — it has no knowledge of any specific ASP (see einvoice-provider.ts).

export type EInvoiceStatus =
  | "not_generated"
  | "generated" // compliant XML produced and stored, not yet sent
  | "submitted" // handed to the ASP, awaiting clearance
  | "accepted" // cleared by the ASP / FTA
  | "rejected" // rejected by the ASP / FTA (fix and resubmit)
  | "failed"; // transport/technical failure (retry)

export const EINVOICE_STATUSES: EInvoiceStatus[] = [
  "not_generated",
  "generated",
  "submitted",
  "accepted",
  "rejected",
  "failed",
];

// Allowed transitions. A rejected/failed document can be corrected and
// resubmitted; accepted is terminal.
const TRANSITIONS: Record<EInvoiceStatus, EInvoiceStatus[]> = {
  not_generated: ["generated"],
  generated: ["submitted", "failed", "generated"], // regenerate allowed
  submitted: ["accepted", "rejected", "failed"],
  rejected: ["generated", "submitted"],
  failed: ["generated", "submitted"],
  accepted: [],
};

export function isEInvoiceStatus(s: string): s is EInvoiceStatus {
  return (EINVOICE_STATUSES as string[]).includes(s);
}

export function isEInvoiceTerminal(s: string): boolean {
  return s === "accepted";
}

/** Pure guard: may the e-invoice move from `from` to `to`? */
export function canTransitionEInvoice(from: string, to: string): boolean {
  if (from === to && to !== "generated") return true; // idempotent no-op (except regenerate)
  if (!isEInvoiceStatus(from) || !isEInvoiceStatus(to)) return false;
  return TRANSITIONS[from].includes(to);
}

/** Throwing variant for the service layer. */
export function assertEInvoiceTransition(from: string, to: string): void {
  if (!canTransitionEInvoice(from, to)) {
    const e: any = new Error(`Invalid e-invoice status transition: ${from} → ${to}`);
    e.code = "EINVOICE_INVALID_TRANSITION";
    throw e;
  }
}
