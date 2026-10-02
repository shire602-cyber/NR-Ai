import { sql } from "drizzle-orm";
import { db } from "../db";
import { AppError } from "../errors";

export type InvoiceDocType = "invoice" | "credit_note" | "quote" | "sales_order" | "delivery_note" | "advance";

const PREFIX: Record<InvoiceDocType, string> = {
  invoice: "INV",
  credit_note: "CN",
  // Quotes are not tax documents, so FTA gap-free numbering does not apply to
  // them — but they still need a unique, sequential, server-allocated number.
  // `quotes.number` is NOT NULL, and the create route used to leave it unset,
  // which made every API-created quote fail with a 500.
  quote: "QT",
  // Phase 8 D1: sales orders, their delivery notes and customer advances are not tax documents (the advance TAX
  // invoice is an ordinary INV- invoice), but each needs a unique, sequential, server-allocated number.
  sales_order: "SO",
  delivery_note: "DN",
  advance: "ADV",
};

export function formatInvoiceNumber(docType: InvoiceDocType, year: number, n: number): string {
  return `${PREFIX[docType]}-${year}-${String(n).padStart(5, "0")}`;
}

// ── Numbers that are already taken ───────────────────────────────────────────
//
// The counter only knows what IT has handed out. Documents can already carry a
// number of the sequence's own format that it did not issue: opening-balance
// invoices and imports keep the customer's old numbers. When the counter reached
// such a number the insert failed (409), the allocation rolled back with it, and
// every retry produced the same number: invoicing was blocked for good.
// Allocation therefore skips forward over taken numbers, inside the same
// transaction, up to a bound.

/** At most this many taken numbers are skipped before allocation gives up loudly. */
export const MAX_SEQUENCE_SKIPS = 10_000;

export type NextFreeResult = { ok: true; value: number; skipped: number } | { ok: false; skipped: number };

/** First counter value >= `candidate` that is not in `taken` (pure). */
export function findNextFreeSequenceValue(
  candidate: number,
  taken: Iterable<number>,
  maxSkips: number = MAX_SEQUENCE_SKIPS
): NextFreeResult {
  const used = new Set(taken);
  let value = candidate;
  let skipped = 0;
  while (used.has(value)) {
    if (skipped >= maxSkips) return { ok: false, skipped };
    value += 1;
    skipped += 1;
  }
  return { ok: true, value, skipped };
}

/** Year and counter of a number in the sequence's own format (INV-2026-00003), else null. */
export function parseSequenceNumber(docType: InvoiceDocType, number: string): { year: number; value: number } | null {
  const m = new RegExp(`^${PREFIX[docType]}-(\\d{4})-(\\d{1,9})$`).exec(number);
  return m ? { year: Number(m[1]), value: Number(m[2]) } : null;
}

/** Highest counter per year among numbers that match the sequence's own format. */
export function sequenceAdvancesFromNumbers(
  docType: InvoiceDocType,
  numbers: string[]
): Array<{ year: number; value: number }> {
  const byYear = new Map<number, number>();
  for (const number of numbers) {
    const parsed = parseSequenceNumber(docType, number);
    if (parsed) byYear.set(parsed.year, Math.max(byYear.get(parsed.year) ?? 0, parsed.value));
  }
  return [...byYear.entries()].sort((a, b) => a[0] - b[0]).map(([year, value]) => ({ year, value }));
}

// ── Gaps that an imported number opens ───────────────────────────────────────

export interface SequenceJump {
  year: number;
  /** Highest counter in use before the import (0 when none). */
  highestExisting: number;
  /** Highest imported counter in the sequence's own format for that year. */
  importedHighest: number;
  /** The number the next invoice will get after the import. */
  nextNumber: string;
  /** How many numbers are skipped for good. */
  gap: number;
  firstUnused: string;
  lastUnused: string;
  /** Plain-language warning for the owner and the accountant. */
  message: string;
}

/**
 * Where an import would move a sequence forward by more than 1 beyond the highest number in use
 * (pure). UAE tax invoices are numbered in sequence: a jump that can be explained is defensible, a
 * silent one is not. Never changes the numbering, only describes what will happen.
 */
export function sequenceJumps(
  docType: InvoiceDocType,
  numbers: string[],
  highestExistingByYear: Map<number, number>
): SequenceJump[] {
  const importedByYear = new Map<number, Set<number>>();
  for (const number of numbers) {
    const parsed = parseSequenceNumber(docType, number);
    if (!parsed) continue;
    const set = importedByYear.get(parsed.year) ?? new Set<number>();
    set.add(parsed.value);
    importedByYear.set(parsed.year, set);
  }
  const out: SequenceJump[] = [];
  for (const [year, imported] of [...importedByYear.entries()].sort((a, b) => a[0] - b[0])) {
    const highestImported = Math.max(...imported);
    const existing = highestExistingByYear.get(year) ?? 0;
    if (highestImported - existing <= 1) continue;
    // Numbers between the highest one in use and the highest imported one that nothing will ever carry
    // (the imported numbers themselves fill part of the run and are not a gap).
    let gap = 0;
    let firstUnused = 0;
    let lastUnused = 0;
    for (let v = existing + 1; v < highestImported; v++) {
      if (imported.has(v)) continue;
      gap += 1;
      if (firstUnused === 0) firstUnused = v;
      lastUnused = v;
    }
    if (gap < 1) continue;
    const f = (n: number) => formatInvoiceNumber(docType, year, n);
    const nextNumber = f(highestImported + 1);
    const still =
      existing > 0
        ? `Your highest number so far is ${f(existing)}, so `
        : `You have not issued a number in this format for ${year} yet, so `;
    out.push({
      year,
      highestExisting: existing,
      importedHighest: highestImported,
      nextNumber,
      gap,
      firstUnused: f(firstUnused),
      lastUnused: f(lastUnused),
      message:
        `${f(highestImported)} is in your invoice numbering format, so the next invoice you issue will be ${nextNumber}. ` +
        `${still}the numbers between ${f(firstUnused)} and ${f(lastUnused)} that you did not import (${gap} in all) will never be issued. ` +
        `UAE tax invoices must be numbered in sequence: keep a note of why (for example, those numbers were used in your previous system).`,
    });
  }
  return out;
}

// Drizzle executor type — accepts the global db handle or any nested tx so that
// callers can include allocation in a wider transaction. Using `typeof db`
// matches the convention already in use in storage.ts (createJournalEntry,
// recordInvoicePayment, etc.).
type Executor = typeof db;

/** Credit notes live in `invoices`; quotes in `quotes`. */
const NUMBER_TABLE: Record<InvoiceDocType, "invoices" | "quotes" | "sales_orders" | "sales_order_deliveries" | "customer_advances"> = {
  invoice: "invoices",
  credit_note: "invoices",
  quote: "quotes",
  sales_order: "sales_orders",
  delivery_note: "sales_order_deliveries",
  advance: "customer_advances",
};

/** Counter values >= `from` already used by documents of this company (sorted, bounded). */
async function takenValuesFrom(
  executor: Executor,
  companyId: string,
  docType: InvoiceDocType,
  year: number,
  from: number
): Promise<number[]> {
  const prefix = `${PREFIX[docType]}-${year}-`;
  const pattern = `^${prefix}([0-9]{1,9})$`;
  const table = sql.raw(NUMBER_TABLE[docType]);
  const res: any = await executor.execute(sql`
    SELECT n FROM (
      SELECT substring(number from ${pattern}::text)::bigint AS n
        FROM ${table}
       WHERE company_id = ${companyId} AND number LIKE ${prefix + "%"}
    ) t
    WHERE n >= ${from}
    ORDER BY n
    LIMIT ${MAX_SEQUENCE_SKIPS + 2}`);
  return ((res.rows ?? res) as Array<{ n: string | number }>).map((r) => Number(r.n));
}

async function nextFreeValue(
  executor: Executor,
  companyId: string,
  docType: InvoiceDocType,
  year: number,
  candidate: number
): Promise<number> {
  const taken = await takenValuesFrom(executor, companyId, docType, year, candidate);
  const found = findNextFreeSequenceValue(candidate, taken);
  if (!found.ok) {
    throw new AppError({
      message:
        `The ${PREFIX[docType]} number sequence for ${year} is blocked: the next ${MAX_SEQUENCE_SKIPS} numbers after ` +
        `${formatInvoiceNumber(docType, year, candidate)} are all already used by existing documents. ` +
        `Check for imported or opening-balance documents that reuse this numbering format.`,
      statusCode: 500,
      code: "NUMBER_SEQUENCE_EXHAUSTED",
    });
  }
  return found.value;
}

async function allocateInExecutor(executor: Executor, companyId: string, docType: InvoiceDocType, year: number): Promise<string> {
  const result: any = await executor.execute(sql`
    INSERT INTO invoice_number_sequences (company_id, doc_type, year, last_value, updated_at)
      VALUES (${companyId}, ${docType}, ${year}, 1, now())
    ON CONFLICT (company_id, doc_type, year)
      DO UPDATE SET last_value = invoice_number_sequences.last_value + 1,
                    updated_at = now()
    RETURNING last_value
  `);
  const rows = (result.rows ?? result) as Array<{ last_value: string | number }>;
  const candidate = Number(rows[0]?.last_value);
  // The row above is now locked by this transaction: nobody else allocates for
  // this (company, type, year) until it ends, so skipping taken numbers is safe.
  const value = await nextFreeValue(executor, companyId, docType, year, candidate);
  if (value !== candidate) {
    await executor.execute(sql`
      UPDATE invoice_number_sequences SET last_value = ${value}, updated_at = now()
       WHERE company_id = ${companyId} AND doc_type = ${docType} AND year = ${year}`);
  }
  return formatInvoiceNumber(docType, year, value);
}

// Atomically allocate the next FREE number in a (company, docType, year) sequence.
// The INSERT ... ON CONFLICT DO UPDATE ... RETURNING pattern is single-statement
// and serialised by Postgres row locking, so concurrent calls cannot collide
// and cannot produce gaps. A number already used by another document is skipped
// in the same transaction (see above). Returns a number like INV-2026-00001.
//
// Pass `executor` (a Drizzle tx) to enroll the allocation in a wider
// transaction — required by FTA-compliance to ensure that if the surrounding
// invoice insert fails, the sequence rollback also fires (otherwise the number
// is burned and the next allocation produces a gap). Without one, the
// allocation runs in a transaction of its own.
export async function allocateInvoiceNumber(
  companyId: string,
  docType: InvoiceDocType,
  date: Date = new Date(),
  executor: Executor = db
): Promise<string> {
  const year = date.getUTCFullYear();
  if (executor === db) {
    return await db.transaction((tx: Executor) => allocateInExecutor(tx, companyId, docType, year));
  }
  return await allocateInExecutor(executor, companyId, docType, year);
}

/**
 * Move a sequence past numbers that were entered from outside (opening-balance invoices):
 * for every matching number the counter becomes at least that number, so normal numbering
 * continues after the highest imported one. Never moves a counter backwards.
 */
export async function advanceSequencePast(
  executor: Executor,
  companyId: string,
  docType: InvoiceDocType,
  numbers: string[]
): Promise<Array<{ year: number; value: number }>> {
  const advances = sequenceAdvancesFromNumbers(docType, numbers);
  for (const { year, value } of advances) {
    await executor.execute(sql`
      INSERT INTO invoice_number_sequences (company_id, doc_type, year, last_value, updated_at)
        VALUES (${companyId}, ${docType}, ${year}, ${value}, now())
      ON CONFLICT (company_id, doc_type, year)
        DO UPDATE SET last_value = GREATEST(invoice_number_sequences.last_value, ${value}),
                      updated_at = now()`);
  }
  return advances;
}

/** Highest counter in use per year: the larger of the sequence counter and the highest number on a document. */
async function highestExistingByYear(
  executor: Executor,
  companyId: string,
  docType: InvoiceDocType,
  years: number[]
): Promise<Map<number, number>> {
  const out = new Map<number, number>();
  const table = sql.raw(NUMBER_TABLE[docType]);
  for (const year of years) {
    const prefix = `${PREFIX[docType]}-${year}-`;
    const pattern = `^${prefix}([0-9]{1,9})$`;
    const seq: any = await executor.execute(sql`
      SELECT last_value FROM invoice_number_sequences WHERE company_id = ${companyId} AND doc_type = ${docType} AND year = ${year}`);
    const used: any = await executor.execute(sql`
      SELECT COALESCE(MAX(substring(number from ${pattern}::text)::bigint), 0) AS n
        FROM ${table} WHERE company_id = ${companyId} AND number LIKE ${prefix + "%"} AND number ~ ${pattern}`);
    const counter = Number(((seq.rows ?? seq) as Array<{ last_value: string | number }>)[0]?.last_value ?? 0);
    const highest = Number(((used.rows ?? used) as Array<{ n: string | number }>)[0]?.n ?? 0);
    out.set(year, Math.max(counter, highest));
  }
  return out;
}

/** The gaps an import of these numbers would open in the sequence (read-only; see sequenceJumps). */
export async function previewSequenceJumps(
  executor: Executor,
  companyId: string,
  docType: InvoiceDocType,
  numbers: string[]
): Promise<SequenceJump[]> {
  const years = sequenceAdvancesFromNumbers(docType, numbers).map((a) => a.year);
  if (years.length === 0) return [];
  return sequenceJumps(docType, numbers, await highestExistingByYear(executor, companyId, docType, years));
}

// Peek the next number without allocating it (for UI display before save).
export async function peekNextInvoiceNumber(
  companyId: string,
  docType: InvoiceDocType,
  date: Date = new Date(),
  executor: Executor = db
): Promise<string> {
  const year = date.getUTCFullYear();
  const result: any = await executor.execute(sql`
    SELECT last_value FROM invoice_number_sequences
    WHERE company_id = ${companyId} AND doc_type = ${docType} AND year = ${year}
  `);
  const rows = (result.rows ?? result) as Array<{ last_value: string | number }>;
  const candidate = rows.length === 0 ? 1 : Number(rows[0].last_value) + 1;
  return formatInvoiceNumber(docType, year, await nextFreeValue(executor, companyId, docType, year, candidate));
}
