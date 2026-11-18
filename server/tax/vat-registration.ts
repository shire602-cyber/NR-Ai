/**
 * E3 (J2-r3): whether a company can recover input VAT. A company that is not VAT registered
 * (taxRegistrationType "Non-registered") pays supplier VAT as part of the cost of what it buys:
 * nothing is debited to Input VAT 1050 and nothing reaches a VAT 201 return. Rule in
 * shared/vat-registration.ts; this reads the company row.
 */
import { pool } from "../db";
import { isVatRegistered } from "../../shared/vat-registration";

export async function companyIsVatRegistered(companyId: string): Promise<boolean> {
  const r = await pool.query(
    `SELECT tax_registration_type, trn_vat_number FROM companies WHERE id = $1`,
    [companyId]
  );
  const row = r.rows[0] as
    | { tax_registration_type: string | null; trn_vat_number: string | null }
    | undefined;
  return isVatRegistered(
    row
      ? { taxRegistrationType: row.tax_registration_type, trnVatNumber: row.trn_vat_number }
      : null
  );
}
