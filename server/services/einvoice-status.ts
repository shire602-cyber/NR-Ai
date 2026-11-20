// E-invoice submission lifecycle (provider-independent).
//
// UAE Peppol/DCTCE 5-corner flow: the invoice XML is generated, handed to an
// Accredited Service Provider (ASP, corner 2) which validates it, delivers it
// to the buyer's ASP (corner 3) and reports the tax data to the FTA (corner 5).
// This module owns the status state machine and the retry policy only — it has
// no knowledge of any specific ASP (see einvoice-provider.ts).

export type EInvoiceStatus =
  | "not_generated"
  | "generated" // compliant XML produced and stored, not yet sent
  | "submitted" // handed to the ASP, awaiting its validation
  | "accepted" // validated and transmitted by the ASP, FTA report pending
  | "cleared" // ASP confirmed the tax data was reported to the FTA (terminal)
  | "rejected" // rejected by the ASP / FTA with reasons (fix and resubmit)
  | "failed" // transport/technical failure (retried with backoff)
  | "cancelled"; // withdrawn before clearance (terminal)

export const EINVOICE_STATUSES: EInvoiceStatus[] = [
  "not_generated",
  "generated",
  "submitted",
  "accepted",
  "cleared",
  "rejected",
  "failed",
  "cancelled",
];

// Allowed transitions. A rejected/failed document can be corrected and
// resubmitted; cleared and cancelled are terminal. A cleared invoice can only
// be corrected by issuing a credit note.
const TRANSITIONS: Record<EInvoiceStatus, EInvoiceStatus[]> = {
  not_generated: ["generated"],
  generated: ["submitted", "failed", "generated", "cancelled"], // regenerate allowed
  submitted: ["accepted", "cleared", "rejected", "failed", "cancelled"],
  accepted: ["cleared", "rejected"],
  rejected: ["generated", "submitted"],
  failed: ["generated", "submitted", "cancelled"],
  cleared: [],
  cancelled: [],
};

export function isEInvoiceStatus(s: string): s is EInvoiceStatus {
  return (EINVOICE_STATUSES as string[]).includes(s);
}

export function isEInvoiceTerminal(s: string): boolean {
  return s === "cleared" || s === "cancelled";
}

/** True once the ASP has taken the document (no new submission allowed). */
export function isEInvoiceInFlight(s: string): boolean {
  return s === "submitted" || s === "accepted" || s === "cleared";
}

/** Pure guard: may the e-invoice move from `from` to `to`? */
export function canTransitionEInvoice(from: string, to: string): boolean {
  if (from === to && to !== "generated") return isEInvoiceStatus(to); // idempotent no-op
  if (!isEInvoiceStatus(from) || !isEInvoiceStatus(to)) return false;
  return TRANSITIONS[from].includes(to);
}

/** Throwing variant for the service layer. */
export function assertEInvoiceTransition(from: string, to: string): void {
  if (!canTransitionEInvoice(from, to)) {
    const e = new Error(`Invalid e-invoice status transition: ${from} → ${to}`) as Error & {
      code: string;
      status: number;
    };
    e.code = "EINVOICE_INVALID_TRANSITION";
    e.status = 409;
    throw e;
  }
}

/** A structured rejection reason from the ASP/FTA. */
export interface EInvoiceRejectionReason {
  code: string;
  message: string;
  field?: string | null;
}

// ─── Retry with backoff (transport failures only) ───────────────────────

export const EINVOICE_MAX_ATTEMPTS = 6;
const BASE_DELAY_MS = 60_000; // 1 min, 2, 4, 8, 16 → then give up
const MAX_DELAY_MS = 6 * 60 * 60_000;

/**
 * When to retry after the `attempts`-th failed attempt (1-based), or null
 * when the retry budget is spent. Business rejections are never retried —
 * they need a corrected document.
 */
export function nextRetryAt(attempts: number, now: Date = new Date()): Date | null {
  if (attempts >= EINVOICE_MAX_ATTEMPTS) return null;
  const delay = Math.min(BASE_DELAY_MS * 2 ** Math.max(0, attempts - 1), MAX_DELAY_MS);
  return new Date(now.getTime() + delay);
}
