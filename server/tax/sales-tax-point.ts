import { localDateSql } from "../reporting/settlement";

/**
 * UAE VAT Decree-Law Art. 25: for sales, the first of supply completion, issue,
 * or receipt of the full consideration sets the whole invoice's tax point.
 * Partial advances are accounted for through customer deposits. Credit/debit
 * notes keep their adjustment date, and write-offs are excluded.
 */
export function salesTaxPointSql(invoice: string, excludePaymentIdSql?: string): string {
  return `CASE WHEN ${invoice}.invoice_type IN ('credit_note', 'debit_note')
    THEN ${invoice}.date::date
    ELSE LEAST(${invoice}.date::date, ${invoice}.supply_date::date, (
      SELECT MIN(${localDateSql("sp.date")}) FROM invoice_payments sp
       WHERE sp.invoice_id = ${invoice}.id AND sp.company_id = ${invoice}.company_id
         AND sp.method NOT IN ('write_off', 'write_off_reinstatement') AND ${appliedReceiptAmountSql("sp")} >= ${invoice}.total
         ${excludePaymentIdSql ? `AND sp.id <> ${excludePaymentIdSql}` : ""}
    )) END`;
}

/** The original overpayment credit records the cash that did not settle the invoice. */
export function appliedReceiptAmountSql(payment: string): string {
  return `GREATEST(${payment}.amount - COALESCE((
    SELECT SUM(oc.amount) FROM customer_credits oc
     WHERE oc.company_id = ${payment}.company_id AND oc.source_id = ${payment}.id
       AND oc.source_type = 'overpayment'
  ), 0), 0)`;
}

/** An application offsets the invoice's VAT, once both the sale and advance have been taxed. */
export function depositApplicationTaxDateSql(taxPoint: string, deposit: string): string {
  return `GREATEST(${taxPoint}, ${deposit}.date::date)`;
}

/** VAT date override for a deposit application identified by its journal source ID. */
export function depositApplicationVatDateSql(companyId: string, sourceId: string): string {
  return `(SELECT ${depositApplicationTaxDateSql(salesTaxPointSql("si"), "sd")}
    FROM customer_credit_allocations sa
    JOIN customer_credits sc ON sc.id = sa.credit_id AND sc.company_id = sa.company_id
    JOIN customer_deposits sd ON sd.id = sc.source_id AND sd.company_id = sa.company_id
    JOIN invoices si ON si.id = sa.invoice_id AND si.company_id = sa.company_id
   WHERE sa.id = ${sourceId} AND sa.company_id = ${companyId}
     AND sa.kind = 'apply' AND sc.source_type = 'deposit')`;
}
