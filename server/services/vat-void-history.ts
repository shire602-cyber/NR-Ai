// Was a voided document ever DECLARED in a filed VAT return? Pure decision: no I/O.
//
// Until the date-based void rule (vat-document-effect.ts) the VAT return left out an invoice by its
// CURRENT status: a return prepared after an invoice was voided simply did not contain it. Such a
// return was recorded BEFORE the cutover (the moment the date rule took effect on this
// installation, see vat-date-rule-cutover.service.ts). For a document dated in P0 and voided on a
// later day V, the date rule would report a negative line in the period of V. That is only right
// when the sale WAS declared; if the old rule had already left it out, deducting it again claims a
// refund on a sale that was never declared. Hence, for the return F0 that covers the document date:
//
//   a. F0 recorded before the cutover (old rule) and on or after the void  -> NEVER DECLARED
//   b. F0 recorded before the void (old or new rule)                        -> declared
//   c. F0 recorded at or after the cutover (new rule: included the document) -> declared
//   d. no filed return covers the document date (live computation)           -> declared
//
// "Recorded" is the time the return was recorded in the system (its figures frozen), not the
// user-entered FTA filing date: what matters is what the computation saw. With amendments, the
// EARLIEST recording time of the return chain decides ("was it already void when it was first
// declared"). The void instant is the moment the void was posted; when only its calendar day is
// known the end of that UAE day is used. Instants compare with "on or after" (a return recorded at
// the very instant of the void had already seen it).
//
// A filed return with no usable recording time (legacy) is treated as recorded at cutover - 1 ms
// and on or after every void made before the cutover: never deduct when in doubt.

import { periodYmd } from "./vat-period-status.service";

type DayInput = string | Date;

export interface FiledVatReturnRecord {
  periodStart: DayInput;
  periodEnd: DayInput;
  /** When the return was recorded, epoch ms; null when unknown (legacy return without a timestamp). */
  recordedAtMs: number | null;
}

const UAE_OFFSET_MS = 4 * 3600 * 1000;

/** The last instant (23:59:59.999) of a UAE calendar day. */
export function uaeDayEndMs(ymd: string): number {
  return Date.parse(`${ymd.slice(0, 10)}T00:00:00Z`) + 24 * 3600 * 1000 - 1 - UAE_OFFSET_MS;
}

export function voidedDocumentNeverDeclared(args: {
  documentDate: DayInput;
  /** Calendar day of the void (reversal entry). */
  voidedOn: DayInput;
  /** The instant the void was posted, epoch ms, when known. */
  voidedAtMs?: number | null;
  /** Every FILED VAT return of the company (originals, amendments, legacy). */
  filedReturns: readonly FiledVatReturnRecord[];
  /** When the date-based rule took effect; 0 means "every filing is a new-rule filing". */
  cutoverMs: number;
}): boolean {
  const doc = periodYmd(args.documentDate);
  const covering = args.filedReturns.filter((r) => periodYmd(r.periodStart) <= doc && doc <= periodYmd(r.periodEnd));
  if (covering.length === 0) return false; // (d)

  // Earliest recording. An unknown time counts as cutover - 1 ms and remembers that it was unknown.
  let earliest = Infinity;
  let earliestUnknown = false;
  let earliestEnd = "";
  for (const r of covering) {
    const unknown = r.recordedAtMs === null || !Number.isFinite(r.recordedAtMs);
    const ms = unknown ? args.cutoverMs - 1 : (r.recordedAtMs as number);
    if (ms < earliest || (ms === earliest && unknown)) {
      earliest = ms;
      earliestUnknown = unknown;
      earliestEnd = periodYmd(r.periodEnd);
    }
  }

  let voidDay = periodYmd(args.voidedOn);
  if (voidDay < doc) voidDay = doc; // a void dated before its own document takes effect on the document date
  // Voided inside the period of the return: issued and cancelled within it, never a later-period matter.
  if (voidDay <= earliestEnd) return false;

  const voidInstant = args.voidedAtMs != null && Number.isFinite(args.voidedAtMs) ? args.voidedAtMs : uaeDayEndMs(voidDay);
  if (earliestUnknown) return voidInstant < args.cutoverMs;
  if (earliest >= args.cutoverMs) return false; // (c) new rule: the document was included
  return earliest >= voidInstant; // (a) vs (b)
}
