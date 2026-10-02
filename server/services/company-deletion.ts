/**
 * Company deletion lifecycle (D5, migration 0120).
 *
 *   request -> [awaiting_firm -> firm owner confirms] -> pending (companies.deleted_at set,
 *   purge_after = +30 d, company API keys revoked) -> restored | purged -> erased
 *
 * Purge anonymises personal data and removes access; it NEVER touches journals,
 * invoices, bills, filings or evidence, which stay read-only until the statutory
 * retention (RETENTION_YEARS) runs out. Only then is the company erased.
 */
import crypto from "node:crypto";
import { and, eq, lte, sql } from "drizzle-orm";

import { db, pool } from "../db";
import { companies, companyDeletionRequests } from "../../shared/schema";
import { createLogger } from "../config/logger";
import { RETENTION_YEARS } from "./retention.service";

const log = createLogger("company-deletion");

export const RESTORE_WINDOW_DAYS = 30;

export class DeletionError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string
  ) {
    super(message);
  }
}

const DAY_MS = 24 * 60 * 60 * 1000;

async function revokeCompanyKeys(companyId: string, userId: string | null): Promise<void> {
  await pool.query(
    `UPDATE api_keys SET is_active = false, revoked_at = COALESCE(revoked_at, now()), revoked_by = COALESCE(revoked_by, $2)
      WHERE company_id = $1 AND revoked_at IS NULL`,
    [companyId, userId]
  );
}

async function startGrace(requestId: string, companyId: string, actorId: string | null): Promise<typeof companyDeletionRequests.$inferSelect> {
  const purgeAfter = new Date(Date.now() + RESTORE_WINDOW_DAYS * DAY_MS);
  const [row] = await db.transaction(async (tx: typeof db) => {
    await tx.update(companies).set({ deletedAt: new Date() }).where(eq(companies.id, companyId));
    return tx
      .update(companyDeletionRequests)
      .set({ status: "pending", purgeAfter })
      .where(eq(companyDeletionRequests.id, requestId))
      .returning();
  });
  await revokeCompanyKeys(companyId, actorId);
  return row;
}

/** Owner asks to delete. A firm-managed (client) company waits for its firm owner first. */
export async function requestDeletion(input: { companyId: string; userId: string; reason?: string | null }) {
  const [company] = await db.select().from(companies).where(eq(companies.id, input.companyId));
  if (!company || company.deletedAt) throw new DeletionError(404, "NOT_FOUND", "Company not found");
  const needsFirm = company.companyType === "client";
  let row;
  try {
    [row] = await db
      .insert(companyDeletionRequests)
      .values({
        companyId: input.companyId,
        companyName: company.name,
        requestedBy: input.userId,
        reason: input.reason ?? null,
        status: needsFirm ? "awaiting_firm" : "pending",
      })
      .returning();
  } catch (err: any) {
    let cur = err;
    for (let i = 0; i < 4 && cur; i++, cur = cur.cause) {
      if (cur.code === "23505") throw new DeletionError(409, "DELETION_ALREADY_REQUESTED", "A deletion request is already open for this company");
    }
    throw err;
  }
  return needsFirm ? row : startGrace(row.id, input.companyId, input.userId);
}

export async function confirmByFirm(requestId: string, firmUserId: string) {
  const [req] = await db.select().from(companyDeletionRequests).where(eq(companyDeletionRequests.id, requestId));
  if (!req) throw new DeletionError(404, "NOT_FOUND", "Deletion request not found");
  if (req.status !== "awaiting_firm") throw new DeletionError(409, "NOT_AWAITING_FIRM", "This request is not waiting for firm confirmation");
  const claimed = await db
    .update(companyDeletionRequests)
    .set({ firmConfirmedBy: firmUserId })
    .where(and(eq(companyDeletionRequests.id, requestId), eq(companyDeletionRequests.status, "awaiting_firm")))
    .returning({ id: companyDeletionRequests.id });
  if (!claimed.length) throw new DeletionError(409, "NOT_AWAITING_FIRM", "This request is not waiting for firm confirmation");
  return startGrace(requestId, req.companyId, firmUserId);
}

/** Requests the user may see: ones they filed, plus those of companies they own (direct SQL: the company may be hidden). */
export async function listDeletionsForUser(userId: string) {
  const res: any = await db.execute(sql`
    SELECT r.* FROM company_deletion_requests r
     WHERE r.requested_by = ${userId}
        OR EXISTS (SELECT 1 FROM company_users cu WHERE cu.company_id = r.company_id AND cu.user_id = ${userId} AND cu.role = 'owner')
     ORDER BY r.requested_at DESC`);
  return (res.rows ?? res).map((r: any) => ({
    id: r.id,
    companyId: r.company_id,
    companyName: r.company_name,
    status: r.status,
    reason: r.reason,
    requestedAt: r.requested_at,
    purgeAfter: r.purge_after,
    restoredAt: r.restored_at,
    purgedAt: r.purged_at,
  }));
}

export async function canActOnRequest(userId: string, request: { companyId: string; requestedBy: string | null }): Promise<boolean> {
  if (request.requestedBy === userId) return true;
  const { rows } = await pool.query(`SELECT 1 FROM company_users WHERE company_id = $1 AND user_id = $2 AND role = 'owner'`, [request.companyId, userId]);
  return rows.length > 0;
}

export async function getRequest(id: string) {
  const [row] = await db.select().from(companyDeletionRequests).where(eq(companyDeletionRequests.id, id));
  return row;
}

/** Within the 30 days, put the company back. Keys stay revoked; the owner issues new ones. */
export async function restoreCompany(requestId: string) {
  const req = await getRequest(requestId);
  if (!req) throw new DeletionError(404, "NOT_FOUND", "Deletion request not found");
  if (req.status === "awaiting_firm") {
    const [row] = await db.update(companyDeletionRequests).set({ status: "cancelled" }).where(eq(companyDeletionRequests.id, requestId)).returning();
    return row;
  }
  if (req.status !== "pending" || !req.purgeAfter || req.purgeAfter.getTime() <= Date.now()) {
    throw new DeletionError(410, "RESTORE_WINDOW_CLOSED", "The 30-day restore window has closed");
  }
  return db.transaction(async (tx: typeof db) => {
    const claimed = await tx
      .update(companyDeletionRequests)
      .set({ status: "restored", restoredAt: new Date() })
      .where(and(eq(companyDeletionRequests.id, requestId), eq(companyDeletionRequests.status, "pending")))
      .returning();
    if (!claimed.length) throw new DeletionError(410, "RESTORE_WINDOW_CLOSED", "The 30-day restore window has closed");
    await tx.update(companies).set({ deletedAt: null }).where(eq(companies.id, req.companyId));
    return claimed[0];
  });
}

// ───────────────────────── Purge ─────────────────────────

async function tableExists(name: string): Promise<boolean> {
  const { rows } = await pool.query(`SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = $1`, [name]);
  return rows.length > 0;
}

/** Latest date a retention clock runs from: last journal date or last filed VAT period, plus RETENTION_YEARS. */
export async function computeRetentionExpiry(companyId: string, now = new Date()): Promise<Date> {
  const { rows } = await pool.query(
    `SELECT GREATEST(
        COALESCE((SELECT max(date) FROM journal_entries WHERE company_id = $1), 'epoch'::timestamp),
        COALESCE((SELECT max(period_end) FROM vat_returns WHERE company_id = $1), 'epoch'::timestamp),
        COALESCE((SELECT max(date) FROM invoices WHERE company_id = $1), 'epoch'::timestamp)
      ) AS last_record`,
    [companyId]
  );
  const last = rows[0]?.last_record ? new Date(rows[0].last_record) : null;
  if (!last || last.getUTCFullYear() <= 1970) return now; // no financial records: nothing to retain
  const expiry = new Date(last);
  expiry.setUTCFullYear(expiry.getUTCFullYear() + RETENTION_YEARS);
  return expiry;
}

const ANON_EMAIL = (id: string) => `deleted+${id}@anonymised.invalid`;

export interface PurgeSummary {
  purged: string[];
  erased: string[];
  failed: Array<{ requestId: string; error: string }>;
}

/** Anonymise one company: personal data and access go, ledgers and documents stay. */
export async function purgeCompany(requestId: string, companyId: string): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Contacts: keep the row (invoices point at it), drop the person.
    await client.query(
      `UPDATE customer_contacts SET name = 'Anonymised contact', name_ar = NULL, email = NULL, phone = NULL, whatsapp_number = NULL,
              address = NULL, city = NULL, contact_person = NULL, notes = NULL, portal_access_token = NULL,
              portal_access_expires_at = NULL, is_active = false
        WHERE company_id = $1`,
      [companyId]
    );
    // Employees: identity and bank details go, payroll amounts stay for the books.
    await client.query(
      `UPDATE employees SET full_name = 'Anonymised employee', full_name_ar = NULL, passport_number = NULL, visa_number = NULL,
              labor_card_number = NULL, bank_name = NULL, bank_account_number = NULL, iban = NULL, routing_code = NULL
        WHERE company_id = $1`,
      [companyId]
    );

    // Members: collect, then anonymise those who belonged to nothing else. Never admins or firm staff.
    const members = (await client.query(`SELECT user_id FROM company_users WHERE company_id = $1`, [companyId])).rows.map((r: any) => r.user_id as string);
    await client.query(`DELETE FROM company_users WHERE company_id = $1`, [companyId]);
    let anonymised: string[] = [];
    if (members.length) {
      const orphans = await client.query(
        `SELECT u.id FROM users u
          WHERE u.id = ANY($1) AND u.is_admin = false AND u.firm_role IS NULL
            AND NOT EXISTS (SELECT 1 FROM company_users cu WHERE cu.user_id = u.id)`,
        [members]
      );
      anonymised = orphans.rows.map((r: any) => r.id as string);
      for (const id of anonymised) {
        await client.query(
          `UPDATE users SET email = $2, name = 'Deleted user', phone = NULL, avatar_url = NULL, is_active = false,
                  password_hash = $3, email_verified = false
            WHERE id = $1`,
          [id, ANON_EMAIL(id), crypto.randomBytes(32).toString("hex")]
        );
        await client.query(
          `UPDATE refresh_sessions SET revoked_at = COALESCE(revoked_at, now()), revoked_reason = COALESCE(revoked_reason, 'company_purged') WHERE user_id = $1`,
          [id]
        );
        if (await tableExists("push_subscriptions")) await client.query(`DELETE FROM push_subscriptions WHERE user_id = $1`, [id]);
        await client.query(`DELETE FROM user_totp WHERE user_id = $1`, [id]);
        await client.query(`DELETE FROM user_recovery_codes WHERE user_id = $1`, [id]);
      }
    }

    // Integrations and credentials never outlive the grace period.
    for (const table of ["webhook_endpoints", "bank_connections", "ecommerce_integrations", "whatsapp_configs", "client_email_sources", "api_keys"]) {
      if (await tableExists(table)) await client.query(`DELETE FROM ${table} WHERE company_id = $1`, [companyId]);
    }

    const retentionExpiresAt = await computeRetentionExpiry(companyId);
    await client.query(
      `UPDATE company_deletion_requests SET status = 'purged', purged_at = (now() AT TIME ZONE 'UTC'), retention_expires_at = $2 WHERE id = $1 AND status = 'pending'`,
      [requestId, retentionExpiresAt.toISOString()]
    );
    await client.query("COMMIT");
    log.info({ companyId, requestId, anonymisedUsers: anonymised.length, retentionExpiresAt }, "Company purged");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Delete every row of the company in an order the foreign keys accept. Several tables reference
 * accounts or journal entries without a cascade (journal_lines -> accounts, payments -> journals),
 * so a plain DELETE FROM companies fails; instead each company-owned table is tried inside a
 * savepoint and retried once the tables that still point at it are gone.
 */
async function deleteCompanyRows(client: { query: (sql: string, params?: unknown[]) => Promise<any> }, companyId: string): Promise<void> {
  // Self-references that restrict immediately even inside one statement.
  await client.query(`UPDATE invoices SET late_fee_for_invoice_id = NULL WHERE company_id = $1 AND late_fee_for_invoice_id IS NOT NULL`, [companyId]).catch(() => undefined);

  const { rows } = await client.query(
    `SELECT DISTINCT c.table_name FROM information_schema.columns c
       JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name AND t.table_type = 'BASE TABLE'
      WHERE c.table_schema = 'public' AND c.column_name = 'company_id'
        AND c.table_name NOT IN ('companies', 'company_deletion_requests')`
  );
  let pending: string[] = rows.map((r: any) => r.table_name as string);
  let lastError: unknown = null;
  while (pending.length) {
    const failed: string[] = [];
    for (const table of pending) {
      await client.query("SAVEPOINT erase_step");
      try {
        await client.query(`DELETE FROM "${table}" WHERE company_id = $1`, [companyId]);
        await client.query("RELEASE SAVEPOINT erase_step");
      } catch (err: any) {
        await client.query("ROLLBACK TO SAVEPOINT erase_step");
        if (err?.code !== "23503") throw err; // only "still referenced" is worth retrying
        lastError = err;
        failed.push(table);
      }
    }
    if (failed.length === pending.length) throw lastError ?? new Error("Could not delete company rows");
    pending = failed;
  }
  await client.query(`DELETE FROM companies WHERE id = $1`, [companyId]);
}

/** Best effort: remove the company's stored files from object storage / disk before the rows that name them go. */
async function deleteCompanyFiles(companyId: string): Promise<void> {
  const { deleteDocument, deleteReceiptImage } = await import("./fileStorage");
  const keys = await pool.query(
    `SELECT storage_key AS k FROM stored_files WHERE company_id = $1
     UNION SELECT file_url FROM documents WHERE company_id = $1
     UNION SELECT storage_key FROM tax_filing_evidence WHERE company_id = $1`,
    [companyId]
  );
  for (const r of keys.rows) await deleteDocument(r.k).catch(() => undefined);
  const images = await pool.query(`SELECT image_path FROM receipts WHERE company_id = $1 AND image_path IS NOT NULL`, [companyId]);
  for (const r of images.rows) await deleteReceiptImage(r.image_path).catch(() => undefined);
}

/** Last step, only after the retention clock ran out: the company row and everything under it go. */
export async function eraseCompany(requestId: string, companyId: string): Promise<void> {
  const [req] = await db.select().from(companyDeletionRequests).where(eq(companyDeletionRequests.id, requestId));
  if (!req || req.status !== "purged" || !req.retentionExpiresAt || req.retentionExpiresAt.getTime() > Date.now()) {
    throw new DeletionError(409, "RETENTION_NOT_EXPIRED", "The statutory retention period has not ended");
  }
  await deleteCompanyFiles(companyId);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await deleteCompanyRows(client, companyId);
    await client.query(`UPDATE company_deletion_requests SET status = 'erased' WHERE id = $1`, [requestId]);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
  log.info({ companyId, requestId }, "Company erased after retention");
}

/** Daily job: purge what is past its 30 days, erase what is past its retention. */
export async function runCompanyPurge(now = new Date()): Promise<PurgeSummary> {
  const summary: PurgeSummary = { purged: [], erased: [], failed: [] };

  const due = await db
    .select()
    .from(companyDeletionRequests)
    .where(and(eq(companyDeletionRequests.status, "pending"), lte(companyDeletionRequests.purgeAfter, now)));
  for (const req of due) {
    try {
      await purgeCompany(req.id, req.companyId);
      summary.purged.push(req.companyId);
    } catch (err) {
      log.error({ err, requestId: req.id }, "Company purge failed");
      summary.failed.push({ requestId: req.id, error: err instanceof Error ? err.message : String(err) });
    }
  }

  const expired = await db
    .select()
    .from(companyDeletionRequests)
    .where(and(eq(companyDeletionRequests.status, "purged"), lte(companyDeletionRequests.retentionExpiresAt, now)));
  for (const req of expired) {
    try {
      await eraseCompany(req.id, req.companyId);
      summary.erased.push(req.companyId);
    } catch (err) {
      log.error({ err, requestId: req.id }, "Company erase failed");
      summary.failed.push({ requestId: req.id, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return summary;
}
