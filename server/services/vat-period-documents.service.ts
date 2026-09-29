// The sales documents a VAT period's return is built from, read from the database with the ONE
// void rule of vat-document-effect.ts (used by the VAT 201, the autopilot and the firm workpaper
// pull). Read-only; runs on whatever executor the caller has (the pool, or a filing transaction).

import { sql } from "drizzle-orm";
import { periodYmd } from "./vat-period-status.service";
import { neverDeclaredAmong } from "./vat-void-history.service";
import {
  VOID_DATE_LATERAL_SQL,
  selectPeriodSalesDocuments,
  type VatSalesInvoiceRow,
} from "./vat-document-effect";

type Executor = { execute: (query: any) => Promise<any> };
const rowsOf = (res: any): any[] => (res?.rows ?? res) as any[];

export interface PeriodSalesInvoice extends VatSalesInvoiceRow {
  /** Calendar day (YYYY-MM-DD) of the invoice date. */
  date: string;
  number: string | null;
  invoiceType: string | null;
  exchangeRate: number;
  customerName: string | null;
  customerTrn: string | null;
  voidedOn: string | null;
  voidedAtMs: number | null;
  /** Voided after its period, but the filed return that covers it never declared it. */
  neverDeclared: boolean;
}

export interface PeriodSalesLine {
  invoiceId: string;
  description: string | null;
  quantity: number | string;
  unitPrice: number;
  vatRate: number | null;
  vatSupplyType: string | null;
}

/** Invoices dated in the period, plus older ones whose void falls in it (unsigned lines, no decision yet). */
export async function fetchPeriodSalesCandidates(
  ex: Executor,
  companyId: string,
  periodStart: string | Date,
  periodEnd: string | Date
): Promise<{ invoices: PeriodSalesInvoice[]; lines: PeriodSalesLine[] }> {
  const start = periodYmd(periodStart);
  const end = periodYmd(periodEnd);
  const where = sql`
    i.company_id = ${companyId} AND i.status <> 'draft' AND COALESCE(i.is_opening_balance, false) = false
    AND ( (i.date::date >= ${start}::date AND i.date::date <= ${end}::date)
       OR (i.status IN ('void', 'cancelled') AND rev.d >= ${start}::date AND rev.d <= ${end}::date) )`;
  const lateral = sql.raw(VOID_DATE_LATERAL_SQL);

  const inv = rowsOf(
    await ex.execute(sql`
      SELECT i.id, i.number, to_char(i.date, 'YYYY-MM-DD') AS date_ymd, i.status, i.invoice_type,
             i.exchange_rate, i.customer_name, i.customer_trn, to_char(rev.d, 'YYYY-MM-DD') AS voided_on, rev.at_ms
        FROM invoices i ${lateral}
       WHERE ${where}
       ORDER BY i.date, i.id`)
  );
  const lines = rowsOf(
    await ex.execute(sql`
      SELECT il.invoice_id, il.description, il.quantity, il.unit_price, il.vat_rate, il.vat_supply_type
        FROM invoice_lines il
        JOIN invoices i ON i.id = il.invoice_id ${lateral}
       WHERE ${where}
       ORDER BY il.invoice_id, il.id`)
  );
  const declared = await neverDeclaredAmong(
    ex,
    companyId,
    inv.map((r) => ({
      id: String(r.id),
      date: String(r.date_ymd),
      status: String(r.status),
      voidedOn: r.voided_on ?? null,
      voidedAtMs: r.at_ms == null ? null : Number(r.at_ms),
    }))
  );
  return {
    invoices: inv.map((r) => ({
      id: String(r.id),
      number: r.number ?? null,
      date: String(r.date_ymd),
      status: String(r.status),
      invoiceType: r.invoice_type ?? null,
      exchangeRate: Number(r.exchange_rate) > 0 ? Number(r.exchange_rate) : 1,
      customerName: r.customer_name ?? null,
      customerTrn: r.customer_trn ?? null,
      voidedOn: r.voided_on ?? null,
      voidedAtMs: r.at_ms == null ? null : Number(r.at_ms),
      neverDeclared: declared.has(String(r.id)),
      isOpeningBalance: false,
    })),
    lines: lines.map((r) => ({
      invoiceId: String(r.invoice_id),
      description: r.description ?? null,
      quantity: Number(r.quantity),
      unitPrice: Number(r.unit_price),
      vatRate: r.vat_rate === null || r.vat_rate === undefined ? null : Number(r.vat_rate),
      vatSupplyType: r.vat_supply_type ?? null,
    })),
  };
}

/** The decided documents of the period: invoices with their effect and the SIGNED lines. */
export async function loadPeriodSalesDocuments(
  ex: Executor,
  companyId: string,
  periodStart: string | Date,
  periodEnd: string | Date
) {
  const candidates = await fetchPeriodSalesCandidates(ex, companyId, periodStart, periodEnd);
  const selected = selectPeriodSalesDocuments({ ...candidates, periodStart, periodEnd });
  const rateByInvoiceId = new Map(selected.invoices.map((i) => [i.id, i.exchangeRate]));
  return { ...selected, rateByInvoiceId };
}
