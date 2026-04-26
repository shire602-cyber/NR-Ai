import { pool } from '../db';

export type InvoiceDocType = 'invoice' | 'credit_note';

const PREFIX: Record<InvoiceDocType, string> = {
  invoice: 'INV',
  credit_note: 'CN',
};

export function formatInvoiceNumber(docType: InvoiceDocType, year: number, n: number): string {
  return `${PREFIX[docType]}-${year}-${String(n).padStart(5, '0')}`;
}

// Atomically allocate the next number in a (company, docType, year) sequence.
// The INSERT ... ON CONFLICT DO UPDATE ... RETURNING pattern is single-statement
// and serialised by Postgres row locking, so concurrent calls cannot collide
// and cannot produce gaps. Returns a fully formatted number like INV-2026-00001.
export async function allocateInvoiceNumber(
  companyId: string,
  docType: InvoiceDocType,
  date: Date = new Date(),
): Promise<string> {
  const year = date.getUTCFullYear();
  const result = await pool.query(
    `INSERT INTO invoice_number_sequences (company_id, doc_type, year, last_value, updated_at)
       VALUES ($1, $2, $3, 1, now())
     ON CONFLICT (company_id, doc_type, year)
       DO UPDATE SET last_value = invoice_number_sequences.last_value + 1,
                     updated_at = now()
     RETURNING last_value`,
    [companyId, docType, year],
  );
  const allocated = Number((result.rows[0] as { last_value: string | number }).last_value);
  return formatInvoiceNumber(docType, year, allocated);
}

// Peek the next number without allocating it (for UI display before save).
export async function peekNextInvoiceNumber(
  companyId: string,
  docType: InvoiceDocType,
  date: Date = new Date(),
): Promise<string> {
  const year = date.getUTCFullYear();
  const result = await pool.query(
    `SELECT last_value FROM invoice_number_sequences
     WHERE company_id = $1 AND doc_type = $2 AND year = $3`,
    [companyId, docType, year],
  );
  const next = result.rows.length === 0
    ? 1
    : Number((result.rows[0] as { last_value: string | number }).last_value) + 1;
  return formatInvoiceNumber(docType, year, next);
}
