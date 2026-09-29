// When does a sales document count in a VAT return? ONE rule for every engine (the VAT 201, the
// autopilot, the firm workpaper pull, the FAF supply listing), so they cannot drift apart.
//
// A tax return reflects the documents as they stood in the period. An invoice issued in August and
// cancelled in September was a valid supply in August; its cancellation is a September event and
// is reported in September as a negative line (like a credit note), because that is where the
// books put it: the void posts a reversal entry dated the day of the void, so the LEDGER for August
// still holds the invoice and the ledger for September holds the reversal.
//
//   invoice dated in P, not void                          -> include
//   invoice dated in P, void on or before P's last day    -> exclude   (issued and cancelled inside P: net zero)
//   invoice dated in P, void AFTER P's last day           -> include
//   invoice dated before P, void dated inside P           -> reverse_in_period (negative lines in P)
//   anything else                                         -> none
//
// EXCEPT a document that was NEVER DECLARED (`neverDeclared`, decided in vat-void-history.ts): an
// invoice voided after its period whose filed return was prepared under the old rule AFTER the
// void, so that return already left it out. It stays out of its own period and is not reported
// negatively in the period of the void (that would claim a refund on a sale nobody declared).
//
// The void date is the date of the reversal journal entry (VOID_DATE_LATERAL_SQL), read the way the
// ledger reads it (`date::date`). A void or cancelled document with NO reversal entry was never
// posted (a draft that was voided), so it never counts. Pure: no I/O.

import { periodYmd } from "./vat-period-status.service";

export type VatDocumentEffect = "include" | "exclude" | "reverse_in_period" | "none";

type DayInput = string | Date;

export function vatDocumentEffectForPeriod(args: {
  documentDate: DayInput;
  /** Calendar day of the reversal entry; null when the document was never voided. */
  voidedOn: DayInput | null | undefined;
  /** Void / cancelled but nothing was ever posted for it: it never counted anywhere. */
  neverPosted?: boolean;
  /** A later void of a sale an old-rule filed return had already left out (vat-void-history.ts). */
  neverDeclared?: boolean;
  periodStart: DayInput;
  periodEnd: DayInput;
}): VatDocumentEffect {
  if (args.neverPosted) return "none";
  const doc = periodYmd(args.documentDate);
  const start = periodYmd(args.periodStart);
  const end = periodYmd(args.periodEnd);
  let voided = args.voidedOn ? periodYmd(args.voidedOn) : null;
  // A void dated before its own document (bad data) takes effect on the document date: it can
  // then never be reversed in a later period than the one that excluded it.
  if (voided !== null && voided < doc) voided = doc;

  if (doc >= start && doc <= end) {
    if (voided === null) return "include";
    if (voided <= end) return "exclude";
    return args.neverDeclared ? "exclude" : "include";
  }
  if (doc < start && voided !== null && voided >= start && voided <= end) {
    return args.neverDeclared ? "none" : "reverse_in_period";
  }
  return "none";
}

/**
 * SQL for the void date of an invoice or credit note `i` (LEFT JOIN LATERAL ... rev): the calendar
 * day of the reversal entry that invoice-void.service.ts posts, i.e. a posted entry of the document
 * (source "invoice", sourceId = the document) that reverses ANOTHER entry of the same document.
 * (A credit note's own issue entry also carries reversedEntryId, but it reverses the ORIGINAL
 * INVOICE's entry, so it does not qualify; same rule as selectVoidableEntries.) `rev.d` is NULL
 * when there is none; `rev.at_ms` is the instant (epoch ms) the reversal was recorded.
 */
export const VOID_DATE_LATERAL_SQL = `LEFT JOIN LATERAL (
  SELECT MIN(je.date::date) AS d,
         (extract(epoch from MIN(je.created_at)) * 1000)::float8 AS at_ms
    FROM journal_entries je
    JOIN journal_entries orig ON orig.id = je.reversed_entry_id
   WHERE je.company_id = i.company_id AND je.source = 'invoice' AND je.source_id = i.id
     AND je.status = 'posted'
     AND orig.company_id = i.company_id AND orig.source = 'invoice' AND orig.source_id = i.id
) rev ON true`;

export const VOIDED_STATUSES: readonly string[] = ["void", "cancelled"];

export interface VatSalesInvoiceRow {
  id: string;
  date: DayInput;
  status: string;
  /** Calendar day of the reversal entry (see VOID_DATE_LATERAL_SQL). */
  voidedOn?: DayInput | null;
  /** The instant the void was recorded (epoch ms), when known. */
  voidedAtMs?: number | null;
  /** Voided after its period, but the return that covers it never declared it (vat-void-history.ts). */
  neverDeclared?: boolean;
  isOpeningBalance?: boolean | null;
}

export interface VatSalesLineRow {
  invoiceId: string;
  quantity: number | string;
}

/** The effect a stored invoice has on the return for [periodStart, periodEnd]. */
export function invoiceEffectForPeriod(
  inv: VatSalesInvoiceRow,
  periodStart: DayInput,
  periodEnd: DayInput
): VatDocumentEffect {
  // Drafts were never issued; pre-go-live documents are inside the opening balances.
  if (inv.status === "draft" || inv.isOpeningBalance === true) return "none";
  const isVoid = VOIDED_STATUSES.includes(inv.status);
  return vatDocumentEffectForPeriod({
    documentDate: inv.date,
    voidedOn: isVoid ? inv.voidedOn ?? null : null,
    neverPosted: isVoid && !inv.voidedOn,
    neverDeclared: isVoid && inv.neverDeclared === true,
    periodStart,
    periodEnd,
  });
}

/**
 * The invoices (with their effect) and the signed lines a period's return is built from.
 * `reverse_in_period` invoices contribute their lines NEGATED: same VAT category, same rate, so a
 * cancellation lands in the same box as the original supply did. A credit note (negative lines)
 * that is voided later therefore comes back as positive lines.
 */
export function selectPeriodSalesDocuments<I extends VatSalesInvoiceRow, L extends VatSalesLineRow>(input: {
  invoices: I[];
  lines: L[];
  periodStart: DayInput;
  periodEnd: DayInput;
}): { invoices: Array<I & { effect: "include" | "reverse_in_period" }>; lines: Array<Omit<L, "quantity"> & { quantity: number }> } {
  const selected: Array<I & { effect: "include" | "reverse_in_period" }> = [];
  const effectById = new Map<string, "include" | "reverse_in_period">();
  for (const inv of input.invoices) {
    const effect = invoiceEffectForPeriod(inv, input.periodStart, input.periodEnd);
    if (effect === "include" || effect === "reverse_in_period") {
      selected.push({ ...inv, effect });
      effectById.set(inv.id, effect);
    }
  }
  const lines: Array<Omit<L, "quantity"> & { quantity: number }> = [];
  for (const line of input.lines) {
    const effect = effectById.get(line.invoiceId);
    if (!effect) continue;
    const quantity = Number(line.quantity);
    lines.push({ ...line, quantity: effect === "reverse_in_period" ? -quantity : quantity });
  }
  return { invoices: selected, lines };
}
