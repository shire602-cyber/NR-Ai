import { sql } from 'drizzle-orm';
import { db } from '../db';

export type InvoiceDocType = 'invoice' | 'credit_note';

const PREFIX: Record<InvoiceDocType, string> = {
  invoice: 'INV',
  credit_note: 'CN',
};

export function formatInvoiceNumber(docType: InvoiceDocType, year: number, n: number): string {
  return `${PREFIX[docType]}-${year}-${String(n).padStart(5, '0')}`;
}

// Drizzle executor type — accepts the global db handle or any nested tx so that
// callers can include allocation in a wider transaction. Using `typeof db`
// matches the convention already in use in storage.ts (createJournalEntry,
// recordInvoicePayment, etc.).
type Executor = typeof db;

// Atomically allocate the next number in a (company, docType, year) sequence.
// The INSERT ... ON CONFLICT DO UPDATE ... RETURNING pattern is single-statement
// and serialised by Postgres row locking, so concurrent calls cannot collide
// and cannot produce gaps. Returns a fully formatted number like INV-2026-00001.
//
// Pass `executor` (a Drizzle tx) to enroll the allocation in a wider
// transaction — required by FTA-compliance to ensure that if the surrounding
// invoice insert fails, the sequence rollback also fires (otherwise the number
// is burned and the next allocation produces a gap).
export async function allocateInvoiceNumber(
  companyId: string,
  docType: InvoiceDocType,
  date: Date = new Date(),
  executor: Executor = db,
): Promise<string> {
  const year = date.getUTCFullYear();
  const result: any = await executor.execute(sql`
    INSERT INTO invoice_number_sequences (company_id, doc_type, year, last_value, updated_at)
      VALUES (${companyId}, ${docType}, ${year}, 1, now())
    ON CONFLICT (company_id, doc_type, year)
      DO UPDATE SET last_value = invoice_number_sequences.last_value + 1,
                    updated_at = now()
    RETURNING last_value
  `);
  const rows = (result.rows ?? result) as Array<{ last_value: string | number }>;
  const allocated = Number(rows[0]?.last_value);
  return formatInvoiceNumber(docType, year, allocated);
}

// Peek the next number without allocating it (for UI display before save).
export async function peekNextInvoiceNumber(
  companyId: string,
  docType: InvoiceDocType,
  date: Date = new Date(),
  executor: Executor = db,
): Promise<string> {
  const year = date.getUTCFullYear();
  const result: any = await executor.execute(sql`
    SELECT last_value FROM invoice_number_sequences
    WHERE company_id = ${companyId} AND doc_type = ${docType} AND year = ${year}
  `);
  const rows = (result.rows ?? result) as Array<{ last_value: string | number }>;
  const next = rows.length === 0 ? 1 : Number(rows[0].last_value) + 1;
  return formatInvoiceNumber(docType, year, next);
}
