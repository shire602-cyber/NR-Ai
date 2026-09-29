/**
 * Legacy filed VAT returns. Before "filed with evidence", a return could reach status `filed`
 * with only its stored box values: no snapshot, no hash, nothing to detect drift against and
 * nothing to amend from. They are made first-class the first time they are read.
 *
 * Why lazily, in code, rather than in a migration: the snapshot hash is the SHA-256 of canonical
 * JSON produced by tax-filing-core (the same code that verifies it), and re-implementing that
 * byte-for-byte in SQL would be fragile. Reading is cheap when there is nothing to do (one
 * indexed anti-join), the insert is idempotent (unique kind+return index, ON CONFLICT DO
 * NOTHING), and no journal is posted: the period was settled outside this system, so a legacy
 * row carries `legacy: true`, clearing entry null, net 0, and is left out of the ledger-mismatch rule.
 */

import { eq, sql } from "drizzle-orm";
import { db } from "../db";
import { taxFilings, vatReturns, type VatReturn } from "../../shared/schema";
import { buildVatSnapshot, snapshotHash, ymdOf } from "./tax-filing-core";

export const LEGACY_REFERENCE_PLACEHOLDER = "(not recorded)";

/** Give every `filed` VAT return of the company that has no filing record a legacy snapshot. Returns the count created. */
export async function ensureLegacyVatFilings(companyId: string): Promise<number> {
  const res: any = await db.execute(sql`
    SELECT r.* FROM vat_returns r
     WHERE r.company_id = ${companyId} AND r.status = 'filed'
       AND NOT EXISTS (SELECT 1 FROM tax_filings f WHERE f.kind = 'vat' AND f.return_id = r.id)`);
  const rows = (res.rows ?? res) as Array<Record<string, any>>;
  let created = 0;
  for (const row of rows) {
    created += await insertLegacyFiling(row.id as string);
  }
  return created;
}

async function insertLegacyFiling(returnId: string): Promise<number> {
  const [ret] = (await db.select().from(vatReturns).where(eq(vatReturns.id, returnId))) as VatReturn[];
  if (!ret || ret.status !== "filed") return 0;
  const snapshot = { ...buildVatSnapshot(ret as unknown as Record<string, unknown>), legacy: true };
  const filedAt = ymdOf((ret.submittedAt ?? ret.updatedAt ?? ret.createdAt) as Date);
  const inserted = await db
    .insert(taxFilings)
    .values({
      companyId: ret.companyId,
      kind: "vat",
      returnId: ret.id,
      referenceNumber: ret.ftaReferenceNumber?.trim() || LEGACY_REFERENCE_PLACEHOLDER,
      filedAt,
      notes: "Filed before filing records existed: snapshot created from the stored figures.",
      snapshot,
      snapshotHash: snapshotHash(snapshot),
      baseFilingId: null,
      settlementOutput: snapshot.boxes.box12TotalDueTax ?? 0,
      settlementInput: snapshot.boxes.box13RecoverableTax ?? 0,
      // settled outside this system: nothing is owed or refundable here
      settlementNet: 0,
      clearingEntryId: null,
      filedBy: ret.submittedBy ?? null,
    })
    .onConflictDoNothing()
    .returning({ id: taxFilings.id });
  return inserted.length;
}
