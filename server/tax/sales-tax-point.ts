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
      SELECT MIN((sp.date + interval '4 hours')::date) FROM invoice_payments sp
       WHERE sp.invoice_id = ${invoice}.id AND sp.company_id = ${invoice}.company_id
         AND sp.method <> 'write_off' AND sp.amount >= ${invoice}.total
         ${excludePaymentIdSql ? `AND sp.id <> ${excludePaymentIdSql}` : ""}
    )) END`;
}
