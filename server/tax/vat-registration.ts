/**
 * E3 (J2-r3): whether a company can recover input VAT. A company that is not VAT registered
 * (taxRegistrationType "Non-registered") pays supplier VAT as part of the cost of what it buys:
 * nothing is debited to Input VAT 1050 and nothing reaches a VAT 201 return. Rule in
 * shared/vat-registration.ts; this reads the company row.
 */
import { sql } from "drizzle-orm";
import { type LedgerTx } from "../ledger";
import { rowsOf } from "../ledger/tx";
import { pool } from "../db";
import { isVatRegistered } from "../../shared/vat-registration";

export async function companyIsVatRegistered(companyId: string, tx?: LedgerTx): Promise<boolean> {
  const rows = tx
    ? rowsOf(
        await tx.execute(
          sql`SELECT tax_registration_type, trn_vat_number FROM companies WHERE id = ${companyId}`
        )
      )
    : (
        await pool.query(
          `SELECT tax_registration_type, trn_vat_number FROM companies WHERE id = $1`,
          [companyId]
        )
      ).rows;
  const row = rows[0] as
    | { tax_registration_type: string | null; trn_vat_number: string | null }
    | undefined;
  return isVatRegistered(
    row
      ? { taxRegistrationType: row.tax_registration_type, trnVatNumber: row.trn_vat_number }
      : null
  );
}
