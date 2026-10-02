// Vendor resolution on every purchase-side write (bills, purchase orders, vendor credit notes,
// opening-balance bills). One contacts table serves customers and vendors (migration 0106).
//
//   - vendorId given: it must be a contact of the company (422 INVALID_VENDOR); a customer contact
//     becomes "both". The document snapshots the contact's name (and TRN when none is supplied).
//   - no vendorId, a name: link to the ONE contact whose normalised name (lower(btrim)) matches;
//     none matches -> a vendor contact is created; several match -> left unlinked and the caller is
//     warned (VENDOR_AMBIGUOUS), never guessed.
//
// The resolver runs in its own short transaction under an advisory lock keyed on the company and
// the normalised name, so ten parallel bills for a new vendor create one contact.

import { sql } from "drizzle-orm";
import type { Pool, PoolClient } from "pg";
import { pool } from "../db";
import { AppError } from "../errors";

const TRN_PATTERN = /^[0-9]{15}$/;

export interface VendorInput {
  vendorId?: string | null;
  vendorName?: string | null;
  vendorTrn?: string | null;
}

export interface VendorWarning {
  code: "VENDOR_AMBIGUOUS";
  message: string;
}

export interface ResolvedVendor {
  vendorId: string | null;
  vendorName: string;
  vendorTrn: string | null;
  warnings: VendorWarning[];
}

/** Normalised vendor name: the key the backfill and the resolver both match on. */
export function normalizeVendorName(name: string): string {
  return name.trim().toLowerCase();
}

export type Queryable = Pick<Pool | PoolClient, "query">;

/** Adapt a Drizzle transaction to the `$1`-style query interface the resolver uses (opening balances). */
export function drizzleQueryable(tx: { execute: (q: any) => Promise<any> }): Queryable {
  return {
    query: async (text: string, params: unknown[] = []) => {
      const parts = text.split(/\$(\d+)/);
      const chunks = parts.map((part, i) => (i % 2 === 0 ? sql.raw(part) : sql.param(params[Number(part) - 1])));
      const res = await tx.execute(sql.join(chunks, sql``));
      return { rows: res.rows ?? res };
    },
  } as unknown as Queryable;
}

export async function resolveVendorWith(db: Queryable, companyId: string, input: VendorInput): Promise<ResolvedVendor> {
  const suppliedName = input.vendorName?.trim() ?? "";
  const suppliedTrn = input.vendorTrn?.trim() || null;

  if (input.vendorId) {
    const found = await db.query(
      `SELECT id, name, trn_number, contact_type FROM customer_contacts WHERE id = $1 AND company_id = $2`,
      [input.vendorId, companyId]
    );
    const contact = found.rows[0];
    if (!contact) throw new AppError({ message: "The vendor does not belong to this company.", statusCode: 422, code: "INVALID_VENDOR" });
    if (contact.contact_type === "customer") {
      await db.query(`UPDATE customer_contacts SET contact_type = 'both', updated_at = NOW() WHERE id = $1`, [contact.id]);
    }
    return {
      vendorId: contact.id,
      vendorName: contact.name,
      vendorTrn: suppliedTrn ?? contact.trn_number ?? null,
      warnings: [],
    };
  }

  if (!suppliedName) {
    throw new AppError({ message: "Vendor name is required.", statusCode: 422, code: "VENDOR_REQUIRED" });
  }

  const norm = normalizeVendorName(suppliedName);
  // Serialises "find or create" per company and name (transaction-scoped; released at COMMIT).
  await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`vendor:${companyId}:${norm}`]);
  const matches = await db.query(
    `SELECT id, name, trn_number, contact_type FROM customer_contacts
      WHERE company_id = $1 AND lower(btrim(name)) = $2 ORDER BY created_at ASC`,
    [companyId, norm]
  );

  if (matches.rows.length > 1) {
    return {
      vendorId: null,
      vendorName: suppliedName,
      vendorTrn: suppliedTrn,
      warnings: [
        {
          code: "VENDOR_AMBIGUOUS",
          message: `More than one contact is named "${suppliedName}"; the document was left unlinked. Pick the vendor explicitly.`,
        },
      ],
    };
  }

  if (matches.rows.length === 1) {
    const contact = matches.rows[0];
    if (contact.contact_type === "customer") {
      await db.query(`UPDATE customer_contacts SET contact_type = 'both', updated_at = NOW() WHERE id = $1`, [contact.id]);
    }
    return { vendorId: contact.id, vendorName: suppliedName, vendorTrn: suppliedTrn ?? contact.trn_number ?? null, warnings: [] };
  }

  const created = await db.query(
    `INSERT INTO customer_contacts (company_id, name, trn_number, contact_type)
     VALUES ($1, $2, $3, 'vendor') RETURNING id`,
    [companyId, suppliedName, suppliedTrn && TRN_PATTERN.test(suppliedTrn) ? suppliedTrn : null]
  );
  return { vendorId: created.rows[0].id, vendorName: suppliedName, vendorTrn: suppliedTrn, warnings: [] };
}

/** Resolve (and if needed create) the vendor contact in a short transaction of its own. */
export async function resolveVendor(companyId: string, input: VendorInput): Promise<ResolvedVendor> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const out = await resolveVendorWith(client, companyId, input);
    await client.query("COMMIT");
    return out;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}
