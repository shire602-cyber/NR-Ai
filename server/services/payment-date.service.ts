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

import { parseCalendarDay, uaeYmdParts } from "../utils/date";

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

/**
 * The posting date is the UTC midnight of the UAE calendar day (utils/date.ts parseCalendarDay): a bare YYYY-MM-DD keeps
 * its day, an instant becomes the UAE day it falls on, so the journal's date::date is the day the user meant.
 */
function parse(value: string | Date): Date | null {
  return parseCalendarDay(value);
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
