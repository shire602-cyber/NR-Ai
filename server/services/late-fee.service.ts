// Late-fee job (Phase 8 D1). Runs daily for the companies that switched late fees on (chase_configs.late_fee_enabled,
// OFF by default). For every issued ordinary invoice that is still open `late_fee_after_days` after its due date,
// it creates ONE `late_fee` invoice (never a second: a unique index on late_fee_for_invoice_id backs that, and a voided
// fee is never recreated). The fee is a compensatory late-payment charge, outside the scope of VAT unless the company
// chose to charge VAT on it. It posts through the ordinary issue path: Dr 1040 / Cr 4040 (and Cr 2020 when taxed).

import { eq, sql } from "drizzle-orm";
import { db, pool } from "../db";
import { invoices, type Invoice } from "../../shared/schema";
import { storage } from "../storage";
import { createLogger } from "../config/logger";
import { ACCOUNT_CODES, UAE_VAT_RATE } from "../constants";
import { uaeCalendarDate } from "../utils/date";
import { allocateInvoiceNumber } from "./invoice-numbering.service";
import { assertPeriodNotLocked } from "./period-lock.service";
import { issueInvoice } from "./invoice-issue.service";
import { getInvoiceBalance, openReceivableSql } from "./invoice-outstanding.db";
import { ensureSystemAccount } from "./inventory-costing.service";
import { replaceInvoiceLines } from "./sales-lines.service";
import { computeLateFee, isLateFeeDue } from "./late-fee-math";

const log = createLogger("late-fee");

export const uaeTodayYmd = (now: Date = new Date()): string => uaeCalendarDate(now).toISOString().slice(0, 10);

export interface LateFeeRunSummary {
  companies: number;
  created: number;
  skipped: number;
}

export async function runLateFeeJob(opts: { companyId?: string; today?: string } = {}): Promise<LateFeeRunSummary> {
  const today = opts.today ?? uaeTodayYmd();
  const params: unknown[] = [];
  let scope = "";
  if (opts.companyId) {
    params.push(opts.companyId);
    scope = " AND cc.company_id = $1";
  }
  const configs = await pool.query(
    // A company in its deletion window gets no new documents (D5).
    `SELECT cc.company_id AS "companyId", cc.late_fee_type AS type, cc.late_fee_value::float8 AS value, cc.late_fee_after_days AS "afterDays",
            cc.late_fee_vat_treatment AS "vatTreatment", cc.do_not_chase_contact_ids AS "doNotChase"
       FROM chase_configs cc JOIN companies c ON c.id = cc.company_id AND c.deleted_at IS NULL
      WHERE cc.late_fee_enabled = true${scope}`,
    params
  );
  const summary: LateFeeRunSummary = { companies: 0, created: 0, skipped: 0 };
  for (const cfg of configs.rows) {
    summary.companies++;
    try {
      const r = await runForCompany(cfg, today);
      summary.created += r.created;
      summary.skipped += r.skipped;
    } catch (err) {
      log.error({ err, companyId: cfg.companyId }, "Late-fee run failed for one company - continuing");
    }
  }
  log.info(summary, "Late-fee run complete");
  return summary;
}

async function runForCompany(
  cfg: { companyId: string; type: "percent" | "fixed"; value: number; afterDays: number; vatTreatment: string; doNotChase: string | null },
  today: string
): Promise<{ created: number; skipped: number }> {
  const doNotChase = new Set<string>(safeList(cfg.doNotChase));
  const due = await pool.query(
    `SELECT i.id::text AS id, to_char(i.due_date, 'YYYY-MM-DD') AS "dueDate", i.contact_id::text AS "contactId"
       FROM invoices i
      WHERE i.company_id = $1 AND i.invoice_type = 'invoice' AND i.is_opening_balance = false
        AND i.due_date IS NOT NULL AND i.do_not_chase = false
        AND ${openReceivableSql("i")}
        AND NOT EXISTS (SELECT 1 FROM invoices f WHERE f.late_fee_for_invoice_id = i.id)
      ORDER BY i.due_date`,
    [cfg.companyId]
  );
  const owner = await ownerOf(cfg.companyId);
  let created = 0;
  let skipped = 0;
  for (const row of due.rows) {
    if (!isLateFeeDue({ dueDate: row.dueDate, afterDays: cfg.afterDays, today })) continue;
    if (row.contactId && doNotChase.has(row.contactId)) continue;
    if (!owner) {
      skipped++;
      continue;
    }
    try {
      const made = await createLateFee({ companyId: cfg.companyId, invoiceId: row.id, cfg, today, userId: owner });
      if (made) created++;
      else skipped++;
    } catch (err: any) {
      skipped++;
      log.warn({ err: err?.message, invoiceId: row.id }, "Late fee not created for one invoice");
    }
  }
  return { created, skipped };
}

function safeList(raw: string | null): string[] {
  try {
    const v = JSON.parse(raw ?? "[]");
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

async function ownerOf(companyId: string): Promise<string | null> {
  const users = await storage.getCompanyUsersByCompanyId(companyId);
  const owner = users.find((u: any) => u.role === "owner") ?? users[0];
  return owner?.userId ?? null;
}

/** Returns true when a fee was created, false when it was skipped (already charged, nothing owed, locked period). */
export async function createLateFee(args: {
  companyId: string;
  invoiceId: string;
  cfg: { type: "percent" | "fixed"; value: number; vatTreatment: string };
  today: string;
  userId: string;
}): Promise<boolean> {
  const { companyId, invoiceId, cfg, today, userId } = args;
  const original = await storage.getInvoice(invoiceId, companyId);
  if (!original || original.invoiceType !== "invoice" || original.isOpeningBalance) return false;
  const balance = await getInvoiceBalance(companyId, invoiceId);
  const fee = computeLateFee({ outstanding: balance.outstanding, type: cfg.type, value: cfg.value });
  if (fee <= 0) return false;
  const date = uaeCalendarDate(new Date(`${today}T12:00:00Z`));
  try {
    await assertPeriodNotLocked(companyId, date);
  } catch {
    return false; // the month is closed: leave the fee for a run after it reopens
  }
  const taxed = cfg.vatTreatment === "standard_rated";
  const account = await ensureSystemAccount(db, companyId, ACCOUNT_CODES.LATE_FEE_INCOME, "income");

  let feeInvoice: Invoice;
  try {
    feeInvoice = await db.transaction(async (tx: typeof db) => {
      const number = await allocateInvoiceNumber(companyId, "invoice", date, tx);
      const [row] = await tx
        .insert(invoices)
        .values({
          companyId,
          number,
          customerName: original.customerName,
          customerTrn: original.customerTrn ?? undefined,
          customerAddress: original.customerAddress ?? undefined,
          contactId: original.contactId ?? null,
          date,
          dueDate: date,
          currency: original.currency,
          exchangeRate: original.exchangeRate,
          invoiceType: "late_fee",
          status: "draft",
          lateFeeForInvoiceId: invoiceId,
          subtotal: fee,
          vatAmount: 0,
          total: fee,
        } as any)
        .returning();
      await replaceInvoiceLines(tx, {
        companyId,
        invoiceId: row.id,
        lines: [
          {
            kind: "item",
            description: `Late payment fee - Invoice ${original.number}`,
            quantity: 1,
            unitPrice: fee,
            vatRate: taxed ? UAE_VAT_RATE : 0,
            vatSupplyType: taxed ? "standard_rated" : "out_of_scope",
            revenueAccountId: account.id,
          },
        ],
        exchangeRate: Number(original.exchangeRate) || 1,
      });
      await tx.execute(sql`UPDATE invoice_lines SET line_kind = 'late_fee' WHERE invoice_id = ${row.id}`);
      const [stored] = await tx.select().from(invoices).where(eq(invoices.id, row.id));
      return stored;
    });
  } catch (err: any) {
    // The unique index: another run already charged this invoice.
    if (err?.code === "23505" || err?.cause?.code === "23505") return false;
    throw err;
  }
  const issued = await issueInvoice(feeInvoice, userId);
  if (!issued.ok) {
    log.warn({ invoiceId: feeInvoice.id }, "Late fee created but could not be issued (chart of accounts)");
    return true;
  }
  await storage.updateInvoiceStatus(feeInvoice.id, companyId, "sent");
  return true;
}
