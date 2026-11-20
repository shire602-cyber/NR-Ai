import { sql } from "drizzle-orm";
import { db } from "../db";
import { DomainError } from "../errors";

export type InvoiceDocType = "invoice" | "cash_sale" | "credit_note" | "debit_note" | "quote";

export const NUMBERED_DOC_TYPES: readonly InvoiceDocType[] = [
  "invoice",
  "cash_sale",
  "credit_note",
  "debit_note",
  "quote",
];

const PREFIX: Record<InvoiceDocType, string> = {
  invoice: "INV",
  // CASH-SERIES (owner decision 2026-11-18): cash sales are tax invoices with their own
  // gap-free series (own prefix and counter per company), never shared with "invoice".
  // Migration 0130 gives "CSL" to a company where another type already uses "CS".
  cash_sale: "CS",
  credit_note: "CN",
  // W3-A: debit notes (additional charges on an issued invoice) are tax
  // documents with their own gap-free sequence.
  debit_note: "DN",
  // Quotes are not tax documents, so FTA gap-free numbering does not apply to
  // them — but they still need a unique, sequential, server-allocated number.
  // `quotes.number` is NOT NULL, and the create route used to leave it unset,
  // which made every API-created quote fail with a 500.
  quote: "QT",
};

/**
 * Numbering settings per document type (WQ7, Settings › Numbering). The allocator below stays the
 * single writer of invoice_number_sequences, so numbers stay gap-free and unique whatever the
 * settings say: a prefix or padding change only changes how the next number is written, never
 * the counter, and "next number" can only move the counter forward.
 */
export interface NumberingSettings {
  docType: InvoiceDocType;
  prefix: string;
  padding: number;
  /** true: the year is part of the number and the counter restarts each year. */
  yearlyReset: boolean;
}

export function defaultNumberingSettings(docType: InvoiceDocType): NumberingSettings {
  return { docType, prefix: PREFIX[docType], padding: 5, yearlyReset: true };
}

/** Year key of the sequence row: the calendar year, or 0 for one continuous sequence. */
function sequenceYear(s: NumberingSettings, date: Date): number {
  return s.yearlyReset ? date.getUTCFullYear() : 0;
}

export function formatDocumentNumber(s: NumberingSettings, year: number, n: number): string {
  const digits = String(n).padStart(s.padding, "0");
  return s.yearlyReset ? `${s.prefix}-${year}-${digits}` : `${s.prefix}-${digits}`;
}

/** Default format (INV-2026-00001); kept for callers and tests that format without settings. */
export function formatInvoiceNumber(docType: InvoiceDocType, year: number, n: number): string {
  return formatDocumentNumber(defaultNumberingSettings(docType), year, n);
}

// Drizzle executor type — accepts the global db handle or any nested tx so that
// callers can include allocation in a wider transaction. Using `typeof db`
// matches the convention already in use in storage.ts (createJournalEntry,
// recordInvoicePayment, etc.).
type Executor = typeof db;

function rowsOf<T>(result: unknown): T[] {
  return ((result as { rows?: T[] }).rows ?? (result as T[])) as T[];
}

export async function getNumberingSettings(
  companyId: string,
  docType: InvoiceDocType,
  executor: Executor = db
): Promise<NumberingSettings> {
  const result = await executor.execute(sql`
    SELECT prefix, padding, yearly_reset FROM document_numbering_settings
     WHERE company_id = ${companyId} AND doc_type = ${docType}
  `);
  const row = rowsOf<{ prefix: string; padding: number; yearly_reset: boolean }>(result)[0];
  if (!row) return defaultNumberingSettings(docType);
  return {
    docType,
    prefix: row.prefix,
    padding: Number(row.padding),
    yearlyReset: row.yearly_reset === true,
  };
}

// Atomically allocate the next number in a (company, docType, year) sequence.
// The INSERT ... ON CONFLICT DO UPDATE ... RETURNING pattern is single-statement
// and serialised by Postgres row locking, so concurrent calls cannot collide
// and cannot produce gaps. Returns a fully formatted number like INV-2026-00001
// (or the company's own prefix / padding / reset from Settings › Numbering).
//
// Pass `executor` (a Drizzle tx) to enroll the allocation in a wider
// transaction — required by FTA-compliance to ensure that if the surrounding
// invoice insert fails, the sequence rollback also fires (otherwise the number
// is burned and the next allocation produces a gap).
export async function allocateInvoiceNumber(
  companyId: string,
  docType: InvoiceDocType,
  date: Date = new Date(),
  executor: Executor = db
): Promise<string> {
  const settings = await getNumberingSettings(companyId, docType, executor);
  const year = sequenceYear(settings, date);
  const result = await executor.execute(sql`
    INSERT INTO invoice_number_sequences (company_id, doc_type, year, last_value, updated_at)
      VALUES (${companyId}, ${docType}, ${year}, 1, now())
    ON CONFLICT (company_id, doc_type, year)
      DO UPDATE SET last_value = invoice_number_sequences.last_value + 1,
                    updated_at = now()
    RETURNING last_value
  `);
  const allocated = Number(rowsOf<{ last_value: string | number }>(result)[0]?.last_value);
  return formatDocumentNumber(settings, date.getUTCFullYear(), allocated);
}

/** Last number issued in the sequence the settings point at for `date` (0 = none yet). */
async function lastIssued(
  companyId: string,
  docType: InvoiceDocType,
  year: number,
  executor: Executor
): Promise<number> {
  const result = await executor.execute(sql`
    SELECT last_value FROM invoice_number_sequences
    WHERE company_id = ${companyId} AND doc_type = ${docType} AND year = ${year}
  `);
  const rows = rowsOf<{ last_value: string | number }>(result);
  return rows.length === 0 ? 0 : Number(rows[0].last_value);
}

// Peek the next number without allocating it (for UI display before save).
export async function peekNextInvoiceNumber(
  companyId: string,
  docType: InvoiceDocType,
  date: Date = new Date(),
  executor: Executor = db
): Promise<string> {
  const settings = await getNumberingSettings(companyId, docType, executor);
  const next = (await lastIssued(companyId, docType, sequenceYear(settings, date), executor)) + 1;
  return formatDocumentNumber(settings, date.getUTCFullYear(), next);
}

export interface NumberingView extends NumberingSettings {
  /** Next counter value and how it will be written. */
  nextNumber: number;
  nextFormatted: string;
  /** Highest counter value already issued in this sequence (0 = none). */
  lastIssued: number;
}

export async function numberingView(
  companyId: string,
  docType: InvoiceDocType,
  date: Date = new Date()
): Promise<NumberingView> {
  const settings = await getNumberingSettings(companyId, docType);
  const last = await lastIssued(companyId, docType, sequenceYear(settings, date), db);
  return {
    ...settings,
    lastIssued: last,
    nextNumber: last + 1,
    nextFormatted: formatDocumentNumber(settings, date.getUTCFullYear(), last + 1),
  };
}

/**
 * Highest counter value already written in the format `settings` produce for `year` (0 = none),
 * across every numbered document table. Used when a prefix or the yearly reset changes, so the
 * new format starts above any number already printed in it (imported documents, an earlier
 * prefix that is reused) and the next number can never collide with an existing one.
 */
async function highestExistingInFormat(
  companyId: string,
  settings: NumberingSettings,
  year: number,
  executor: Executor
): Promise<number> {
  // Prefixes are letters, digits, "-" and "/" only (validator), all literal in a POSIX regex.
  const pattern = settings.yearlyReset
    ? `^${settings.prefix}-${year}-([0-9]+)$`
    : `^${settings.prefix}-([0-9]+)$`;
  const result = await executor.execute(sql`
    SELECT COALESCE(MAX(substring(number from ${pattern})::bigint), 0) AS n FROM (
      SELECT number FROM invoices WHERE company_id = ${companyId}
      UNION ALL SELECT number FROM credit_notes WHERE company_id = ${companyId}
      UNION ALL SELECT number FROM quotes WHERE company_id = ${companyId}
    ) docs
    WHERE number ~ ${pattern}
  `);
  return Number(rowsOf<{ n: string | number }>(result)[0]?.n ?? 0);
}

/**
 * Save the numbering settings and, optionally, move the next number forward. One transaction:
 *   - the settings row is upserted;
 *   - switching between yearly and continuous numbering seeds the new sequence with the highest
 *     number already issued, so the counter never repeats;
 *   - `nextNumber` must be above the highest number issued (409 NUMBERING_BELOW_ISSUED): the
 *     sequence row is locked (FOR UPDATE) so a concurrent issue cannot slip under it.
 */
export async function saveNumberingSettings(
  companyId: string,
  docType: InvoiceDocType,
  input: { prefix: string; padding: number; yearlyReset: boolean; nextNumber?: number },
  userId: string,
  date: Date = new Date()
): Promise<NumberingView> {
  await db.transaction(async (tx: Executor) => {
    const before = await getNumberingSettings(companyId, docType, tx);
    const settings: NumberingSettings = {
      docType,
      prefix: input.prefix.trim().toUpperCase(),
      padding: input.padding,
      yearlyReset: input.yearlyReset,
    };
    const year = sequenceYear(settings, date);
    // Make sure the target sequence row exists, then lock it.
    if (before.yearlyReset !== settings.yearlyReset || before.prefix !== settings.prefix) {
      const prevLast = Math.max(
        before.yearlyReset !== settings.yearlyReset
          ? await lastIssued(companyId, docType, sequenceYear(before, date), tx)
          : 0,
        await highestExistingInFormat(companyId, settings, date.getUTCFullYear(), tx)
      );
      await tx.execute(sql`
        INSERT INTO invoice_number_sequences (company_id, doc_type, year, last_value, updated_at)
          VALUES (${companyId}, ${docType}, ${year}, ${prevLast}, now())
        ON CONFLICT (company_id, doc_type, year)
          DO UPDATE SET last_value = GREATEST(invoice_number_sequences.last_value, ${prevLast}),
                        updated_at = now()
      `);
    }
    if (input.nextNumber !== undefined) {
      await tx.execute(sql`
        INSERT INTO invoice_number_sequences (company_id, doc_type, year, last_value, updated_at)
          VALUES (${companyId}, ${docType}, ${year}, 0, now())
        ON CONFLICT (company_id, doc_type, year) DO NOTHING
      `);
      const locked = await tx.execute(sql`
        SELECT last_value FROM invoice_number_sequences
         WHERE company_id = ${companyId} AND doc_type = ${docType} AND year = ${year}
         FOR UPDATE
      `);
      const last = Number(rowsOf<{ last_value: string | number }>(locked)[0]?.last_value ?? 0);
      if (input.nextNumber <= last) {
        throw new DomainError(
          "NUMBERING_BELOW_ISSUED",
          409,
          { lastIssued: last, requested: input.nextNumber },
          `The next number must be above ${last}, the highest number already issued`
        );
      }
      await tx.execute(sql`
        UPDATE invoice_number_sequences SET last_value = ${input.nextNumber - 1}, updated_at = now()
         WHERE company_id = ${companyId} AND doc_type = ${docType} AND year = ${year}
      `);
    }
    await tx.execute(sql`
      INSERT INTO document_numbering_settings (company_id, doc_type, prefix, padding, yearly_reset, updated_by, updated_at)
        VALUES (${companyId}, ${docType}, ${settings.prefix}, ${settings.padding}, ${settings.yearlyReset}, ${userId}, now())
      ON CONFLICT (company_id, doc_type) DO UPDATE SET
        prefix = EXCLUDED.prefix, padding = EXCLUDED.padding, yearly_reset = EXCLUDED.yearly_reset,
        updated_by = EXCLUDED.updated_by, updated_at = now()
    `);
  });
  return numberingView(companyId, docType, date);
}
