// Shared rules for the date a settlement (invoice payment, bill payment,
// bank match, expense-claim reimbursement) is posted to the ledger.
// A payment may be dated before its document (deposits and prepayments are
// real): the cash is recorded on the real bank date. Only an invalid date or
// a future date is refused here; period locks are enforced by the guard.
//
// Pure module: no database or framework imports, so it is trivially testable.
// The route-facing wrapper (which also enforces period locks) lives in
// payment-date-guard.service.ts.
//
// Calendar days are compared in UAE local time (UTC+4, no DST), the same
// convention as server/utils/date.ts, so "today" and "the document date"
// mean what an accountant in Dubai means by them.

import { uaeYmdParts } from "../utils/date";

export type PaymentDateResult =
  | { ok: true; date: Date; ymd: string; source: "requested" | "fallback" }
  | { ok: false; status: number; code: string; message: string };

export interface ResolvePaymentDateInput {
  /** Date supplied by the caller (ISO date or datetime). Empty = not supplied. */
  requested?: string | Date | null;
  /** Used when `requested` is absent: the bank transaction date, else today. */
  fallback?: string | Date | null;
  now?: Date;
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

function ymdOf(date: Date): string {
  const { year, month, day } = uaeYmdParts(date);
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Parse to a Date; a bare YYYY-MM-DD becomes UTC midnight (invoice convention). */
function parse(value: string | Date): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const text = value.trim();
  if (DATE_ONLY.test(text)) {
    const d = new Date(`${text}T00:00:00Z`);
    // Reject impossible calendar dates such as 2026-02-30 (Date rolls them over).
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === text ? d : null;
  }
  const d = new Date(text);
  return Number.isNaN(d.getTime()) ? null : d;
}

function isBlank(value: unknown): boolean {
  return value === undefined || value === null || (typeof value === "string" && value.trim() === "");
}

export function resolvePaymentDate(input: ResolvePaymentDateInput): PaymentDateResult {
  const now = input.now ?? new Date();
  const hasRequested = !isBlank(input.requested);
  const raw = hasRequested ? input.requested! : isBlank(input.fallback) ? now : input.fallback!;

  const date = parse(raw);
  if (!date) {
    return {
      ok: false,
      status: 400,
      code: "PAYMENT_DATE_INVALID",
      message: "Payment date must be a valid date (YYYY-MM-DD).",
    };
  }
  const ymd = ymdOf(date);

  if (ymd > ymdOf(now)) {
    return {
      ok: false,
      status: 422,
      code: "PAYMENT_DATE_IN_FUTURE",
      message: `Payment date ${ymd} is in the future. Payments must be dated on or before today.`,
    };
  }

  return { ok: true, date, ymd, source: hasRequested ? "requested" : "fallback" };
}
