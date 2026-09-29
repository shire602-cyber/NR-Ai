// Reads the manual journals of a period that touch the output / input VAT accounts and turns them
// into VAT adjustments (vat-adjustments.ts). Read-only; runs on whatever executor the caller has.
//
// Which entries: posted, dated in the period (`date::date`, exactly like the ledger reading in
// vat-clearing.service.ts), and either source "manual" or the reversal of a manual entry (a user
// correcting a correction). Anything else that touches the VAT accounts (invoices, bills,
// receipts, clearing entries, ...) is document / filing activity, not an adjustment.

import { sql } from "drizzle-orm";
import { periodYmd } from "./vat-period-status.service";
import {
  summariseVatJournalAdjustments,
  VAT_INPUT_ACCOUNT,
  VAT_OUTPUT_ACCOUNT,
  type VatJournalAdjustments,
  type VatJournalLineRow,
} from "./vat-adjustments";

type Executor = { execute: (query: any) => Promise<any> };
const rowsOf = (res: any): any[] => (res?.rows ?? res) as any[];

export async function loadVatJournalAdjustmentRows(
  ex: Executor,
  companyId: string,
  periodStart: string | Date,
  periodEnd: string | Date
): Promise<VatJournalLineRow[]> {
  const start = periodYmd(periodStart);
  const end = periodYmd(periodEnd);
  const res = await ex.execute(sql`
    SELECT je.id AS entry_id, je.entry_number, COALESCE(NULLIF(BTRIM(je.memo), ''), '') AS description,
           to_char(je.date, 'YYYY-MM-DD') AS d, a.code, jl.debit, jl.credit
      FROM journal_lines jl
      JOIN journal_entries je ON je.id = jl.entry_id
      JOIN accounts a ON a.id = jl.account_id
      LEFT JOIN journal_entries orig ON orig.id = je.reversed_entry_id
     WHERE je.company_id = ${companyId} AND je.status = 'posted'
       AND je.date::date >= ${start}::date AND je.date::date <= ${end}::date
       AND (je.source = 'manual' OR (je.source = 'reversal' AND orig.source = 'manual'))
       AND ((a.code = ${VAT_OUTPUT_ACCOUNT.code} AND a.type = ${VAT_OUTPUT_ACCOUNT.type})
         OR (a.code = ${VAT_INPUT_ACCOUNT.code} AND a.type = ${VAT_INPUT_ACCOUNT.type}))
     ORDER BY je.date, je.entry_number, jl.id`);
  return rowsOf(res).map((r) => ({
    entryId: String(r.entry_id),
    entryNumber: String(r.entry_number),
    description: r.description ?? "",
    date: String(r.d),
    accountCode: String(r.code),
    debit: Number(r.debit) || 0,
    credit: Number(r.credit) || 0,
  }));
}

export async function loadVatJournalAdjustments(
  ex: Executor,
  companyId: string,
  periodStart: string | Date,
  periodEnd: string | Date,
  emirate: string | null | undefined
): Promise<VatJournalAdjustments & { rows: VatJournalLineRow[] }> {
  const rows = await loadVatJournalAdjustmentRows(ex, companyId, periodStart, periodEnd);
  return { ...summariseVatJournalAdjustments(rows, emirate), rows };
}
