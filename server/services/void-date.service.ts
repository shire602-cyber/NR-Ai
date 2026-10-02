// The date a void or cancellation reverses on. A posted document is undone on ITS OWN date, so the period that reported
// it stops reporting it (the VAT 201, the ledger and the ageing for that period never show a document that was cancelled):
//   default   the document's date when that month is unlocked and no filed VAT return covers it;
//             otherwise the first open day after it (next unlocked, unfiled day, never later than today);
//   explicit  `date` from the client: not before the document, not in the future, not in a locked month or a filed VAT period.

import { pool } from "../db";
import { isPeriodLocked } from "./month-end.service";
import { calendarDayYmd, parseCalendarDay, uaeCalendarDate } from "../utils/date";

export type VoidDate =
  | { ok: true; date: Date; ymd: string; documentYmd: string; moved: boolean }
  | { ok: false; status: number; code: string; message: string };

const bad = (code: string, message: string): VoidDate => ({ ok: false, status: 400, code, message });
const addDaysYmd = (ymd: string, days: number): string => new Date(Date.parse(`${ymd}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
const firstOfNextMonth = (ymd: string): string => {
  const d = new Date(`${ymd.slice(0, 7)}-01T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + 1);
  return d.toISOString().slice(0, 10);
};

/** The filed (or submitted) VAT return covering a day, if any: its period end. */
async function filedVatPeriodEnd(companyId: string, ymd: string): Promise<string | null> {
  const res = await pool.query(
    `SELECT to_char(MAX(period_end), 'YYYY-MM-DD') AS period_end FROM vat_returns
      WHERE company_id = $1 AND period_start <= $2::date AND period_end >= $2::date AND status NOT IN ('draft', 'void', 'cancelled')`,
    [companyId, ymd]
  );
  return res.rows[0]?.period_end ?? null;
}

export async function resolveVoidDate(args: { companyId: string; documentDate: Date | string; requested?: unknown }): Promise<VoidDate> {
  const documentYmd = calendarDayYmd(uaeCalendarDate(args.documentDate instanceof Date ? args.documentDate : new Date(args.documentDate)));
  const todayYmd = calendarDayYmd(uaeCalendarDate());

  if (args.requested !== undefined && args.requested !== null && args.requested !== "") {
    const parsed = parseCalendarDay(args.requested);
    if (!parsed) return bad("INVALID_VOID_DATE", "The date must be a valid calendar day (YYYY-MM-DD).");
    const ymd = calendarDayYmd(parsed);
    if (ymd < documentYmd) return bad("VOID_DATE_BEFORE_DOCUMENT", `The date cannot be before the document's own date (${documentYmd}).`);
    if (ymd > todayYmd) return bad("VOID_DATE_IN_FUTURE", "The date cannot be in the future.");
    if (await isPeriodLocked(args.companyId, ymd)) return bad("VOID_DATE_PERIOD_LOCKED", `The month of ${ymd} is locked. Choose a date in an open month.`);
    if (await filedVatPeriodEnd(args.companyId, ymd)) return bad("VOID_DATE_PERIOD_FILED", `A VAT return covering ${ymd} is already filed. Choose a date after it.`);
    return { ok: true, date: parsed, ymd, documentYmd, moved: ymd !== documentYmd };
  }

  let candidate = documentYmd;
  for (let i = 0; i < 48 && candidate < todayYmd; i += 1) {
    if (await isPeriodLocked(args.companyId, candidate)) {
      candidate = firstOfNextMonth(candidate);
      continue;
    }
    const filedEnd = await filedVatPeriodEnd(args.companyId, candidate);
    if (filedEnd) {
      candidate = addDaysYmd(filedEnd, 1);
      continue;
    }
    break;
  }
  if (candidate > todayYmd) candidate = todayYmd;
  return { ok: true, date: new Date(`${candidate}T00:00:00Z`), ymd: candidate, documentYmd, moved: candidate !== documentYmd };
}
