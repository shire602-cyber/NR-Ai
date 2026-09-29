// Keep an invoice's status in step with its credit notes.
//
// Called inside the transaction that issues or voids a credit note. It re-reads
// payments and live credit notes under a row lock on the ORIGINAL invoice (the
// same row recordInvoicePayment locks) and applies statusFromBalance():
//   fully credited, nothing paid  → 'credited'
//   credit + payments settle it   → 'paid'
//   a credit note is voided       → back to sent / posted / partial

import { sql } from "drizzle-orm";
import { statusFromBalance, type InvoiceStatus } from "./invoice-state-machine";

export async function syncInvoiceStatusFromBalance(
  tx: any,
  companyId: string,
  invoiceId: string
): Promise<InvoiceStatus | null> {
  const locked: any = await tx.execute(sql`
    SELECT id, total::float8 AS total, status
      FROM invoices
     WHERE id = ${invoiceId} AND company_id = ${companyId} AND invoice_type <> 'credit_note'
       FOR UPDATE
  `);
  const inv = ((locked.rows ?? locked) as Array<{ id: string; total: number; status: string }>)[0];
  if (!inv) return null;

  const sums: any = await tx.execute(sql`
    SELECT
      COALESCE((SELECT SUM(amount) FROM invoice_payments WHERE invoice_id = ${invoiceId}), 0)::float8 AS paid,
      COALESCE((SELECT SUM(ABS(total)) FROM invoices
                 WHERE original_invoice_id = ${invoiceId} AND invoice_type = 'credit_note'
                   AND status NOT IN ('void', 'cancelled')), 0)::float8 AS credited
  `);
  const { paid, credited } = ((sums.rows ?? sums) as Array<{ paid: number; credited: number }>)[0];

  // Legacy data: an invoice marked paid without any payment row is not ours to reopen.
  if (inv.status === "paid" && Number(paid) === 0) return "paid";

  const next = statusFromBalance(inv.status as InvoiceStatus, { total: inv.total, paid, credited });
  if (next !== inv.status) {
    await tx.execute(sql`UPDATE invoices SET status = ${next} WHERE id = ${invoiceId}`);
  }
  return next;
}
