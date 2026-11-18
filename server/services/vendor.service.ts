/**
 * Vendor master (W3-B: R04-16). Vendors are deduplicated per company by TRN and by
 * case-insensitive name; bills and purchase orders link `vendor_id` while the free-text
 * `vendor_name` stays on legacy rows (backfilled by exact name).
 */
import { and, asc, eq } from "drizzle-orm";
import { db, pool } from "../db";
import { DomainError } from "../errors";
import { assertChosenAccountsNotControl } from "../ledger/control-accounts";
import { vendors, type Vendor } from "../../shared/schema";
import { scopedGet } from "../tenancy";
import { agedPayables, type AgingReport } from "../reporting";
import { fromFils, toFils } from "../../shared/money";
import type { VendorCreateInput, VendorUpdateInput } from "../../shared/validators/vendors";

export async function listVendors(companyId: string, opts: { includeInactive?: boolean } = {}) {
  const rows = await db
    .select()
    .from(vendors)
    .where(
      opts.includeInactive
        ? eq(vendors.companyId, companyId)
        : and(eq(vendors.companyId, companyId), eq(vendors.isActive, true))
    )
    .orderBy(asc(vendors.name));
  return rows;
}

export async function getVendor(companyId: string, vendorId: string): Promise<Vendor> {
  const v = await scopedGet(vendors, companyId, vendorId);
  if (!v) throw new DomainError("VENDOR_NOT_FOUND", 404, undefined, "Vendor not found");
  return v;
}

async function findDuplicate(
  companyId: string,
  name: string | undefined,
  trn: string | null | undefined,
  exceptId?: string
): Promise<{ id: string; field: "trn" | "name" } | null> {
  if (trn) {
    const r = await pool.query(
      `SELECT id FROM vendors WHERE company_id = $1 AND trn = $2 AND ($3::uuid IS NULL OR id <> $3) LIMIT 1`,
      [companyId, trn, exceptId ?? null]
    );
    if (r.rows[0]) return { id: r.rows[0].id, field: "trn" };
  }
  if (name) {
    const r = await pool.query(
      `SELECT id FROM vendors WHERE company_id = $1 AND lower(name) = lower($2) AND ($3::uuid IS NULL OR id <> $3) LIMIT 1`,
      [companyId, name.trim(), exceptId ?? null]
    );
    if (r.rows[0]) return { id: r.rows[0].id, field: "name" };
  }
  return null;
}

async function assertExpenseAccount(companyId: string, accountId: string | null | undefined) {
  if (!accountId) return;
  const r = await pool.query(
    `SELECT type FROM accounts WHERE id = $1 AND company_id = $2 AND COALESCE(is_archived, false) = false`,
    [accountId, companyId]
  );
  if (!r.rows[0]) throw new DomainError("ACCOUNT_NOT_FOUND", 404);
  if (!["expense", "asset"].includes(r.rows[0].type)) {
    throw new DomainError(
      "EXPENSE_ACCOUNT_REQUIRED",
      400,
      undefined,
      "Default account must be an expense or asset account"
    );
  }
  // D2 (N12): the default is copied onto bill lines, so it follows the bill-line rule (C1, RH1):
  // a control account (1040, 1050, 1070, 2010, ...) is refused at save, not at approval.
  await assertChosenAccountsNotControl(companyId, [
    { field: "default_expense_account_id", accountId },
  ]);
}

export async function createVendor(companyId: string, input: VendorCreateInput): Promise<Vendor> {
  const dup = await findDuplicate(companyId, input.name, input.trn);
  if (dup) {
    throw new DomainError(
      "VENDOR_DUPLICATE",
      409,
      { existingVendorId: dup.id, field: dup.field },
      dup.field === "trn"
        ? "A vendor with this TRN already exists"
        : "A vendor with this name already exists"
    );
  }
  await assertExpenseAccount(companyId, input.default_expense_account_id);
  const [row] = await db
    .insert(vendors)
    .values({
      companyId,
      name: input.name,
      nameAr: input.name_ar ?? null,
      trn: input.trn ?? null,
      email: input.email ?? null,
      phone: input.phone ?? null,
      address: input.address ?? null,
      emirate: input.emirate ?? null,
      country: input.country ?? "AE",
      paymentTermsDays: input.payment_terms_days ?? 30,
      currency: input.currency ?? "AED",
      defaultExpenseAccountId: input.default_expense_account_id ?? null,
      iban: input.iban ?? null,
      bankName: input.bank_name ?? null,
      notes: input.notes ?? null,
    })
    .returning();
  return row;
}

export async function updateVendor(
  companyId: string,
  vendorId: string,
  input: VendorUpdateInput
): Promise<Vendor> {
  await getVendor(companyId, vendorId);
  const dup = await findDuplicate(companyId, input.name, input.trn, vendorId);
  if (dup)
    throw new DomainError("VENDOR_DUPLICATE", 409, { existingVendorId: dup.id, field: dup.field });
  await assertExpenseAccount(companyId, input.default_expense_account_id);
  const patch: Partial<typeof vendors.$inferInsert> = { updatedAt: new Date() };
  if (input.name !== undefined) patch.name = input.name;
  if (input.name_ar !== undefined) patch.nameAr = input.name_ar;
  if (input.trn !== undefined) patch.trn = input.trn;
  if (input.email !== undefined) patch.email = input.email;
  if (input.phone !== undefined) patch.phone = input.phone;
  if (input.address !== undefined) patch.address = input.address;
  if (input.emirate !== undefined) patch.emirate = input.emirate;
  if (input.country !== undefined) patch.country = input.country;
  if (input.payment_terms_days !== undefined) patch.paymentTermsDays = input.payment_terms_days;
  if (input.currency !== undefined) patch.currency = input.currency;
  if (input.default_expense_account_id !== undefined)
    patch.defaultExpenseAccountId = input.default_expense_account_id;
  if (input.iban !== undefined) patch.iban = input.iban;
  if (input.bank_name !== undefined) patch.bankName = input.bank_name;
  if (input.notes !== undefined) patch.notes = input.notes;
  if (input.is_active !== undefined) patch.isActive = input.is_active;
  const [row] = await db
    .update(vendors)
    .set(patch)
    .where(and(eq(vendors.id, vendorId), eq(vendors.companyId, companyId)))
    .returning();
  return row;
}

export interface ResolvedVendor {
  vendorId: string | null;
  vendorName: string;
  vendorTrn: string | null;
  defaultExpenseAccountId: string | null;
  paymentTermsDays: number | null;
}

/**
 * Resolve the vendor for a bill / PO: an explicit vendor_id (must belong to the company), else
 * an exact TRN match, else an exact case-insensitive name match, else free text (legacy).
 */
export async function resolveVendor(
  companyId: string,
  input: { vendor_id?: string | null; vendor_name?: string | null; vendor_trn?: string | null }
): Promise<ResolvedVendor | null> {
  if (input.vendor_id) {
    const v = await getVendor(companyId, input.vendor_id);
    return {
      vendorId: v.id,
      vendorName: input.vendor_name || v.name,
      vendorTrn: v.trn ?? input.vendor_trn ?? null,
      defaultExpenseAccountId: v.defaultExpenseAccountId ?? null,
      paymentTermsDays: v.paymentTermsDays,
    };
  }
  if (!input.vendor_name && !input.vendor_trn) return null;
  const r = await pool.query(
    `SELECT * FROM vendors WHERE company_id = $1 AND is_active = true
        AND (($2::text IS NOT NULL AND trn = $2) OR ($3::text IS NOT NULL AND lower(name) = lower($3)))
      ORDER BY (trn = $2) DESC NULLS LAST LIMIT 1`,
    [companyId, input.vendor_trn ?? null, input.vendor_name ?? null]
  );
  const v = r.rows[0];
  if (!v) {
    return {
      vendorId: null,
      vendorName: input.vendor_name ?? "",
      vendorTrn: input.vendor_trn ?? null,
      defaultExpenseAccountId: null,
      paymentTermsDays: null,
    };
  }
  return {
    vendorId: v.id,
    vendorName: input.vendor_name || v.name,
    vendorTrn: input.vendor_trn ?? v.trn ?? null,
    defaultExpenseAccountId: v.default_expense_account_id ?? null,
    paymentTermsDays: v.payment_terms_days ?? null,
  };
}

/**
 * Link legacy bills / POs (vendor_id NULL) to vendors by exact case-insensitive name. With
 * `createMissing`, a vendor is created for each unmatched distinct name first.
 */
export async function backfillVendorLinks(
  companyId: string,
  opts: { createMissing?: boolean } = {}
): Promise<{ vendorsCreated: number; billsLinked: number; purchaseOrdersLinked: number }> {
  let vendorsCreated = 0;
  if (opts.createMissing) {
    const names = await pool.query(
      `SELECT DISTINCT ON (lower(trim(vendor_name))) trim(vendor_name) AS name, vendor_trn
         FROM vendor_bills WHERE company_id = $1 AND vendor_id IS NULL AND trim(vendor_name) <> ''
        ORDER BY lower(trim(vendor_name)), created_at DESC`,
      [companyId]
    );
    for (const n of names.rows) {
      const trn =
        typeof n.vendor_trn === "string" && /^\d{15}$/.test(n.vendor_trn) ? n.vendor_trn : null;
      const ins = await pool.query(
        `INSERT INTO vendors (company_id, name, trn)
         SELECT $1, $2, $3
          WHERE NOT EXISTS (SELECT 1 FROM vendors WHERE company_id = $1 AND (lower(name) = lower($2) OR ($3::text IS NOT NULL AND trn = $3)))
         RETURNING id`,
        [companyId, n.name, trn]
      );
      vendorsCreated += ins.rowCount ?? 0;
    }
  }
  const bills = await pool.query(
    `UPDATE vendor_bills b SET vendor_id = v.id
       FROM vendors v
      WHERE b.company_id = $1 AND v.company_id = $1 AND b.vendor_id IS NULL
        AND lower(trim(b.vendor_name)) = lower(v.name)`,
    [companyId]
  );
  const pos = await pool.query(
    `UPDATE purchase_orders p SET vendor_id = v.id
       FROM vendors v
      WHERE p.company_id = $1 AND v.company_id = $1 AND p.vendor_id IS NULL
        AND lower(trim(p.vendor_name)) = lower(v.name)`,
    [companyId]
  );
  return {
    vendorsCreated,
    billsLinked: bills.rowCount ?? 0,
    purchaseOrdersLinked: pos.rowCount ?? 0,
  };
}

export interface VendorStatementLine {
  date: string;
  type:
    | "bill"
    | "payment"
    | "debit_note"
    | "credit_applied"
    | "payment_reversal"
    | "prepayment_applied";
  reference: string | null;
  documentId: string;
  /** AED; bills increase the balance owed, payments / credits reduce it. */
  charge: number;
  credit: number;
  balance: number;
}

/**
 * Vendor statement in AED (bill rate for bills and settlements, debit-note rate for credits):
 * approved bills, payments (and their reversals) and debit notes dated in the range, with an
 * opening balance from earlier activity.
 */
export async function vendorStatement(
  companyId: string,
  vendorId: string,
  range: { from?: string | null; to: string }
): Promise<{
  vendor: Vendor;
  openingBalance: number;
  closingBalance: number;
  lines: VendorStatementLine[];
}> {
  const vendor = await getVendor(companyId, vendorId);
  const { rows } = await pool.query(
    `SELECT * FROM (
       SELECT b.bill_date::date AS d, 'bill' AS type, b.bill_number AS ref, b.id AS doc,
              ROUND(b.total_amount * COALESCE(NULLIF(b.exchange_rate,0),1) * 100)::bigint AS charge, 0::bigint AS credit
         FROM vendor_bills b
        WHERE b.company_id = $1 AND b.vendor_id = $2
          AND b.status IN ('approved','partial','paid','overdue')
       UNION ALL
       SELECT p.payment_date::date, CASE WHEN p.kind = 'reversal' THEN 'payment_reversal'
                                         WHEN p.kind = 'vendor_credit' THEN 'credit_applied'
                                         WHEN p.kind = 'prepayment' THEN 'prepayment_applied'
                                         ELSE 'payment' END,
              p.reference, p.id,
              -- Applying a debit note moves no A/P (the note debited A/P when raised), so neither
              -- the application nor its reversal changes the balance (D5c).
              CASE WHEN p.amount < 0 AND vc.id IS NULL THEN ROUND(-p.amount * COALESCE(NULLIF(b.exchange_rate,0),1) * 100)::bigint ELSE 0 END,
              CASE WHEN p.amount > 0 AND p.kind <> 'vendor_credit' THEN ROUND(p.amount * COALESCE(NULLIF(b.exchange_rate,0),1) * 100)::bigint ELSE 0 END
         FROM bill_payments p JOIN vendor_bills b ON b.id = p.bill_id
         LEFT JOIN bill_payments vc ON p.kind = 'reversal' AND vc.id = p.reverses_payment_id
                                   AND vc.kind = 'vendor_credit'
        WHERE b.company_id = $1 AND b.vendor_id = $2
       UNION ALL
       SELECT n.note_date::date, 'debit_note', n.debit_note_number, n.id,
              0, ROUND(n.total_amount * COALESCE(NULLIF(n.exchange_rate,0),1) * 100)::bigint
         FROM vendor_debit_notes n
        WHERE n.company_id = $1 AND n.vendor_id = $2 AND n.status <> 'void'
     ) t ORDER BY d, type`,
    [companyId, vendorId]
  );
  let opening = 0;
  let running = 0;
  const lines: VendorStatementLine[] = [];
  for (const r of rows) {
    const d = r.d instanceof Date ? r.d.toISOString().slice(0, 10) : String(r.d).slice(0, 10);
    const delta = Number(r.charge) - Number(r.credit);
    if (d > range.to) continue;
    if (range.from && d < range.from) {
      opening += delta;
      continue;
    }
    if (lines.length === 0) running = opening;
    running += delta;
    lines.push({
      date: d,
      type: r.type,
      reference: r.ref,
      documentId: r.doc,
      charge: Number(fromFils(Number(r.charge))),
      credit: Number(fromFils(Number(r.credit))),
      balance: Number(fromFils(running)),
    });
  }
  const closing = lines.length ? running : opening;
  return {
    vendor,
    openingBalance: Number(fromFils(opening)),
    closingBalance: Number(fromFils(closing)),
    lines,
  };
}

export interface PayablesAging extends AgingReport {
  vendors: Array<{ vendorId: string | null; name: string; total: number }>;
}

/**
 * A/P aging as of a date (R04-07, R04-22): approved bills only, FX-converted at the bill rate,
 * by vendor, reconciled to GL 2010. Unapplied debit notes reduce A/P in the GL, so they are a
 * separate line and part of the reconciliation.
 */
export async function payablesAging(companyId: string, asOf: string): Promise<PayablesAging> {
  // The kernel aging already nets unapplied debit notes into its reconciliation (D5c).
  const base = await agedPayables({ companyId, asOf });
  const ids = await pool.query(
    `SELECT id, vendor_id FROM vendor_bills WHERE company_id = $1 AND vendor_id IS NOT NULL`,
    [companyId]
  );
  const vendorOf = new Map<string, string>(
    (ids.rows as Array<{ id: string; vendor_id: string }>).map((r) => [r.id, r.vendor_id])
  );
  const byVendor = new Map<string, { vendorId: string | null; name: string; fils: number }>();
  for (const d of base.documents) {
    const vid = vendorOf.get(d.documentId) ?? null;
    const key = vid ?? `name:${d.name}`;
    const cur = byVendor.get(key) ?? { vendorId: vid, name: d.name, fils: 0 };
    cur.fils += toFils(String(d.open), { rounding: "halfUp" });
    byVendor.set(key, cur);
  }
  return {
    ...base,
    vendors: [...byVendor.values()]
      .map((v) => ({ vendorId: v.vendorId, name: v.name, total: Number(fromFils(v.fils)) }))
      .sort((a, b) => b.total - a.total),
  };
}
