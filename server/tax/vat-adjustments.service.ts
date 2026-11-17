/**
 * VAT adjustments (W4-E, R07-08, R07-15):
 *   - bad-debt relief (Art. 64): a tracked claim on an invoice unpaid more than six months after
 *     its due date, written off and notified to the customer. Posts Dr Output VAT 2020 /
 *     Cr Bad Debt Expense 5120 through the ledger kernel; a later payment reverses it.
 *   - return adjustments: tourist refunds (Box 2), import adjustments (Box 7), output / input
 *     corrections and voluntary disclosures. They change the return only (no GL posting) and are
 *     reported as explained reconciliation differences.
 *   - VAT groups (Art. 14): the representative files one return for all members.
 */
import { and, eq, sql } from "drizzle-orm";
import type { Request } from "express";
import { db, pool } from "../db";
import { DomainError } from "../errors";
import { storage } from "../storage";
import {
  badDebtReliefClaims,
  invoiceLines,
  invoices,
  vatReturnAdjustments,
  type BadDebtReliefClaim,
} from "../../shared/schema";
import { fromFils, toFils } from "../../shared/money";
import { validateUaeTrn } from "../../shared/receipt-ocr-parser";
import { postJournal, reverseEntry, withLedgerTx } from "../ledger";
import { recordAudit } from "../services/audit.service";
import { invoiceSettlement, totalsForStoredDocument } from "../services/invoice-posting.service";
import { invoiceWrittenOffFils } from "../services/invoice-payment.service";
import { onDomainEvent } from "../platform/domain-events";
import { createLogger } from "../config/logger";
import { normaliseEmirate, toBaseFils } from "./vat-boxes";
import { loadVatCompany, returnAdjustmentDelta, type ReturnAdjustmentKind } from "./vat-engine";
import { assertAlignedPeriod } from "./vat-periods";

const log = createLogger("vat-adjustments");

export const BAD_DEBT_SOURCE = "vat_bad_debt_relief";
export const BAD_DEBT_EXPENSE_CODE = "5120";

function addMonthsIso(iso: string, months: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)
  ).getUTCDate();
  target.setUTCDate(Math.min(d, last));
  return target.toISOString().slice(0, 10);
}

/** Earliest date a bad-debt relief claim may be made: due date + 6 months (exclusive). */
export function badDebtEligibleFrom(dueDate: string): string {
  return addMonthsIso(dueDate, 6);
}

async function ensureBadDebtExpense(companyId: string) {
  const found = await storage.getAccountByCode(companyId, BAD_DEBT_EXPENSE_CODE);
  if (found && found.isActive && !found.isArchived) return found;
  return storage.createAccount({
    companyId,
    code: BAD_DEBT_EXPENSE_CODE,
    nameEn: "Bad Debt Expense",
    nameAr: "مصروف الديون المعدومة",
    description: "Created by VAT bad-debt relief (W4-E)",
    type: "expense",
    subType: "operating_expense",
    isVatAccount: false,
    vatType: null,
    isSystemAccount: false,
  } as Parameters<typeof storage.createAccount>[0]);
}

async function vatAccountId(companyId: string, type: "output" | "input"): Promise<string> {
  const accounts = await storage.getAccountsByCompanyId(companyId);
  const code = type === "output" ? "2020" : "1050";
  const a =
    accounts.find((x) => x.code === code && x.isActive && !x.isArchived) ??
    accounts.find((x) => x.isVatAccount && x.vatType === type && x.isActive && !x.isArchived);
  if (!a) throw new DomainError("VAT_ACCOUNTS_MISSING", 422, { code });
  return a.id;
}

export async function createBadDebtReliefClaim(input: {
  companyId: string;
  userId: string;
  invoiceId: string;
  claimDate: string;
  writtenOff: boolean;
  customerNotified: boolean;
  customerNotifiedAt?: string | null;
  notes?: string | null;
  req?: Request;
}): Promise<BadDebtReliefClaim> {
  const [inv] = await db
    .select()
    .from(invoices)
    .where(and(eq(invoices.id, input.invoiceId), eq(invoices.companyId, input.companyId)));
  if (!inv) throw new DomainError("INVOICE_NOT_FOUND", 404);
  if (inv.invoiceType === "credit_note" || ["draft", "void", "cancelled"].includes(inv.status)) {
    throw new DomainError("INVOICE_NOT_ELIGIBLE", 422, {
      status: inv.status,
      type: inv.invoiceType,
    });
  }
  if (!input.writtenOff) {
    throw new DomainError(
      "BAD_DEBT_NOT_WRITTEN_OFF",
      422,
      undefined,
      "The debt must be written off in the accounts first"
    );
  }
  if (!input.customerNotified) {
    throw new DomainError(
      "CUSTOMER_NOT_NOTIFIED",
      422,
      undefined,
      "The customer must be notified of the write-off"
    );
  }
  if (!inv.dueDate) throw new DomainError("INVOICE_NO_DUE_DATE", 422);
  const due = new Date(inv.dueDate).toISOString().slice(0, 10);
  const eligible = badDebtEligibleFrom(due);
  if (input.claimDate <= eligible) {
    throw new DomainError(
      "BAD_DEBT_TOO_EARLY",
      422,
      { dueDate: due, eligibleAfter: eligible },
      `Bad-debt relief needs more than six months after the due date (after ${eligible}).`
    );
  }
  const emirate = normaliseEmirate(inv.placeOfSupplyEmirate);
  if (!emirate) throw new DomainError("EMIRATE_MISSING", 422, { invoiceId: inv.id });
  const lines = await db.select().from(invoiceLines).where(eq(invoiceLines.invoiceId, inv.id));
  const totals = totalsForStoredDocument(inv, lines);
  if (totals.vatFils <= 0) throw new DomainError("INVOICE_HAS_NO_VAT", 422);
  const rate =
    (inv.currency || "AED").toUpperCase() === "AED" ? "1" : String(inv.exchangeRate || 1);
  const output = await vatAccountId(input.companyId, "output");
  const expense = await ensureBadDebtExpense(input.companyId);

  return withLedgerTx(async (tx) => {
    const s = await invoiceSettlement(tx, inv.id);
    // A3 (H1): Art. 64(1)(b) needs an actual write-off in the accounts, not a self-attestation.
    // The write-off settles the invoice (method 'write_off'), so the unpaid consideration is
    // what was neither received nor credited, and relief is limited to what was written off.
    const writtenOffDoc = await invoiceWrittenOffFils(tx, inv.id);
    if (writtenOffDoc <= 0) {
      throw new DomainError(
        "BAD_DEBT_NOT_WRITTEN_OFF",
        422,
        undefined,
        "Write the debt off in the accounts first (invoice write-off), then claim the relief"
      );
    }
    const unpaidDoc =
      totals.totalFils - (s.paidFils - writtenOffDoc) - s.creditedFils - s.appliedFils;
    const outstandingDoc = Math.min(unpaidDoc, writtenOffDoc);
    if (outstandingDoc <= 0) throw new DomainError("INVOICE_NOT_OUTSTANDING", 422);
    // VAT element of the unpaid consideration: VAT x outstanding / total.
    const vatDoc = Math.round((totals.vatFils * outstandingDoc) / totals.totalFils);
    const vatBase = toBaseFils(vatDoc, rate);
    const taxableBase = toBaseFils(outstandingDoc - vatDoc, rate);
    if (vatBase <= 0) throw new DomainError("INVOICE_HAS_NO_VAT", 422);
    const existing = await tx
      .select({ id: badDebtReliefClaims.id })
      .from(badDebtReliefClaims)
      .where(
        and(eq(badDebtReliefClaims.invoiceId, inv.id), eq(badDebtReliefClaims.status, "claimed"))
      );
    if (existing.length)
      throw new DomainError("BAD_DEBT_ALREADY_CLAIMED", 409, { claimId: existing[0].id });
    const [claim] = await tx
      .insert(badDebtReliefClaims)
      .values({
        companyId: input.companyId,
        invoiceId: inv.id,
        claimDate: input.claimDate,
        emirate,
        outstandingAmount: Number(fromFils(toBaseFils(outstandingDoc, rate))),
        taxableAmount: Number(fromFils(taxableBase)),
        vatAmount: Number(fromFils(vatBase)),
        writtenOff: true,
        customerNotified: true,
        customerNotifiedAt: input.customerNotifiedAt ?? null,
        notes: input.notes ?? null,
        createdBy: input.userId,
      })
      .returning();
    const { entry } = await postJournal(
      {
        companyId: input.companyId,
        date: input.claimDate,
        memo: `Bad-debt relief (Art. 64) - Invoice ${inv.number}`,
        status: "posted",
        source: BAD_DEBT_SOURCE,
        sourceId: claim.id,
        idempotencyKey: `vat_bad_debt_relief:${claim.id}`,
        lines: [
          {
            accountId: output,
            debitFils: vatBase,
            description: `Output VAT relief - ${inv.number}`,
          },
          {
            accountId: expense.id,
            creditFils: vatBase,
            description: `VAT recovered on bad debt - ${inv.number}`,
          },
        ],
      },
      { actorId: input.userId, tx }
    );
    const [saved] = await tx
      .update(badDebtReliefClaims)
      .set({ journalEntryId: entry.id, updatedAt: new Date() })
      .where(eq(badDebtReliefClaims.id, claim.id))
      .returning();
    await recordAudit({
      userId: input.userId,
      companyId: input.companyId,
      action: "vat.bad_debt_relief.claim",
      entityType: "bad_debt_relief_claim",
      entityId: claim.id,
      after: saved,
      req: input.req,
    });
    return saved;
  });
}

export async function reverseBadDebtReliefClaim(input: {
  companyId: string;
  claimId: string;
  userId: string;
  date: string;
  reason: string;
  req?: Request;
}): Promise<BadDebtReliefClaim> {
  const [claim] = await db
    .select()
    .from(badDebtReliefClaims)
    .where(
      and(
        eq(badDebtReliefClaims.id, input.claimId),
        eq(badDebtReliefClaims.companyId, input.companyId)
      )
    );
  if (!claim) throw new DomainError("BAD_DEBT_CLAIM_NOT_FOUND", 404);
  if (claim.status !== "claimed") throw new DomainError("BAD_DEBT_CLAIM_NOT_ACTIVE", 409);
  const date = input.date < String(claim.claimDate) ? String(claim.claimDate) : input.date;
  return withLedgerTx(async (tx) => {
    const rev = claim.journalEntryId
      ? await reverseEntry(
          claim.journalEntryId,
          { date, reason: input.reason, source: BAD_DEBT_SOURCE, sourceId: claim.id },
          { actorId: input.userId, tx, companyId: input.companyId }
        )
      : null;
    const [saved] = await tx
      .update(badDebtReliefClaims)
      .set({
        status: "reversed",
        reversedAt: date,
        reversalReason: input.reason,
        reversalEntryId: rev?.reversal.id ?? null,
        updatedAt: new Date(),
      })
      .where(and(eq(badDebtReliefClaims.id, claim.id), eq(badDebtReliefClaims.status, "claimed")))
      .returning();
    if (!saved) throw new DomainError("BAD_DEBT_CLAIM_NOT_ACTIVE", 409);
    await recordAudit({
      userId: input.userId,
      companyId: input.companyId,
      action: "vat.bad_debt_relief.reverse",
      entityType: "bad_debt_relief_claim",
      entityId: claim.id,
      after: saved,
      req: input.req,
    });
    return saved;
  });
}

export async function listBadDebtReliefClaims(companyId: string) {
  return db
    .select()
    .from(badDebtReliefClaims)
    .where(eq(badDebtReliefClaims.companyId, companyId))
    .orderBy(sql`${badDebtReliefClaims.claimDate} DESC`);
}

let paymentHookInstalled = false;
/** A payment received on an invoice with an active claim reverses the relief (Art. 64(3)). */
export function installBadDebtPaymentHook(): void {
  if (paymentHookInstalled) return;
  paymentHookInstalled = true;
  onDomainEvent("payment.received", async (e) => {
    const p = e.payload as typeof e.payload & { actorUserId?: string };
    if (!p.invoiceId) return;
    const { rows } = await pool.query(
      `SELECT c.id, c.created_by FROM bad_debt_relief_claims c
        WHERE c.company_id = $1 AND c.invoice_id = $2 AND c.status = 'claimed'`,
      [p.companyId, p.invoiceId]
    );
    if (!rows[0]) return;
    const pay = await pool.query(
      `SELECT to_char(date, 'YYYY-MM-DD') AS d FROM invoice_payments WHERE id = $1`,
      [p.entityId]
    );
    const date = pay.rows[0]?.d ?? new Date().toISOString().slice(0, 10);
    const reverse = (on: string) =>
      reverseBadDebtReliefClaim({
        companyId: p.companyId,
        claimId: rows[0].id,
        userId: p.actorUserId || rows[0].created_by,
        date: on,
        reason: "Payment received after bad-debt relief was claimed",
      });
    try {
      try {
        await reverse(date);
      } catch (err) {
        // A payment dated in a filed VAT period: the recovered VAT is declared in the next open
        // period's return (Executive Regulation Art. 70), never by changing the filed one.
        const next = (err as DomainError & { details?: { nextOpenPeriodStart?: string } })?.details
          ?.nextOpenPeriodStart;
        if ((err as DomainError)?.code !== "VAT_PERIOD_FILED" || !next) throw err;
        await reverse(next);
      }
    } catch (err) {
      log.error({ err, claimId: rows[0].id }, "bad-debt relief reversal on payment failed");
    }
  });
}

// ─── Return adjustments ──────────────────────────────────────────────────

export async function addReturnAdjustment(input: {
  companyId: string;
  userId: string;
  periodStart: string;
  periodEnd: string;
  kind: ReturnAdjustmentKind;
  emirate?: string | null;
  amount: number;
  vatAmount: number;
  reason: string;
  reference?: string | null;
  correctsPeriodStart?: string | null;
  correctsPeriodEnd?: string | null;
  req?: Request;
}) {
  const company = await loadVatCompany(input.companyId);
  const period = assertAlignedPeriod({
    from: input.periodStart,
    to: input.periodEnd,
    frequency: company.frequency,
    startMonth: company.startMonth,
  });
  const emirate = input.emirate ? normaliseEmirate(input.emirate) : null;
  if (input.emirate && !emirate)
    throw new DomainError("INVALID_EMIRATE", 422, { emirate: input.emirate });
  // Validates the mapping (e.g. corrections need an emirate) before anything is stored.
  returnAdjustmentDelta(
    input.kind,
    emirate ?? company.emirate,
    toFils(input.amount, { rounding: "halfUp" }),
    toFils(input.vatAmount, { rounding: "halfUp" })
  );
  const locked = await pool.query(
    `SELECT status FROM vat_returns
      WHERE company_id = $1 AND period_start::date = $2::date AND period_end::date = $3::date
        AND status IN ('submitted','filed')`,
    [input.companyId, period.from, period.to]
  );
  if (locked.rows.length) {
    throw new DomainError(
      "VAT_RETURN_FINAL",
      409,
      undefined,
      "That period's return is submitted; record the correction in the current period or amend the return."
    );
  }
  const [row] = await db
    .insert(vatReturnAdjustments)
    .values({
      companyId: input.companyId,
      periodStart: period.from,
      periodEnd: period.to,
      kind: input.kind,
      emirate,
      amount: input.amount,
      vatAmount: input.vatAmount,
      reason: input.reason,
      reference: input.reference ?? null,
      correctsPeriodStart: input.correctsPeriodStart ?? null,
      correctsPeriodEnd: input.correctsPeriodEnd ?? null,
      createdBy: input.userId,
    })
    .returning();
  await recordAudit({
    userId: input.userId,
    companyId: input.companyId,
    action: "vat.return_adjustment.add",
    entityType: "vat_return_adjustment",
    entityId: row.id,
    after: row,
    req: input.req,
  });
  return row;
}

export async function listReturnAdjustments(companyId: string, from: string, to: string) {
  return db
    .select()
    .from(vatReturnAdjustments)
    .where(
      and(
        eq(vatReturnAdjustments.companyId, companyId),
        eq(vatReturnAdjustments.periodStart, from),
        eq(vatReturnAdjustments.periodEnd, to)
      )
    );
}

export async function deleteReturnAdjustment(
  companyId: string,
  id: string,
  userId: string,
  req?: Request
) {
  const [row] = await db
    .select()
    .from(vatReturnAdjustments)
    .where(and(eq(vatReturnAdjustments.id, id), eq(vatReturnAdjustments.companyId, companyId)));
  if (!row) throw new DomainError("VAT_ADJUSTMENT_NOT_FOUND", 404);
  const locked = await pool.query(
    `SELECT 1 FROM vat_returns WHERE company_id = $1 AND period_start::date = $2::date
        AND period_end::date = $3::date AND status IN ('submitted','filed')`,
    [companyId, row.periodStart, row.periodEnd]
  );
  if (locked.rows.length) throw new DomainError("VAT_RETURN_FINAL", 409);
  await db.delete(vatReturnAdjustments).where(eq(vatReturnAdjustments.id, id));
  await recordAudit({
    userId,
    companyId,
    action: "vat.return_adjustment.delete",
    entityType: "vat_return_adjustment",
    entityId: id,
    before: row,
    req,
  });
  return { id };
}

// ─── VAT groups ──────────────────────────────────────────────────────────

export async function upsertVatGroup(input: {
  representativeCompanyId: string;
  userId: string;
  name: string;
  groupTrn: string;
  memberCompanyIds: string[];
  req?: Request;
}) {
  const trn = validateUaeTrn(input.groupTrn);
  if (!trn.valid) throw new DomainError("INVALID_TRN", 422, { issue: trn.issue });
  for (const id of input.memberCompanyIds) {
    if (!(await storage.hasCompanyAccess(input.userId, id))) {
      throw new DomainError("COMPANY_ACCESS_DENIED", 403, { companyId: id });
    }
  }
  return withLedgerTx(async (tx) => {
    const existing = await tx.execute(
      sql`SELECT id FROM vat_groups WHERE representative_company_id = ${input.representativeCompanyId}`
    );
    const rows = ((existing as unknown as { rows?: Array<{ id: string }> }).rows ??
      existing) as Array<{
      id: string;
    }>;
    let groupId: string;
    if (rows[0]) {
      groupId = rows[0].id;
      await tx.execute(
        sql`UPDATE vat_groups SET name = ${input.name}, group_trn = ${trn.trn} WHERE id = ${groupId}`
      );
      await tx.execute(sql`DELETE FROM vat_group_members WHERE group_id = ${groupId}`);
    } else {
      const ins = await tx.execute(
        sql`INSERT INTO vat_groups (representative_company_id, name, group_trn, created_by)
            VALUES (${input.representativeCompanyId}, ${input.name}, ${trn.trn}, ${input.userId}) RETURNING id`
      );
      groupId = (
        ((ins as unknown as { rows?: Array<{ id: string }> }).rows ?? ins) as Array<{ id: string }>
      )[0].id;
    }
    const members = new Set([input.representativeCompanyId, ...input.memberCompanyIds]);
    for (const m of members) {
      const clash = await tx.execute(
        sql`SELECT group_id FROM vat_group_members WHERE company_id = ${m} AND group_id <> ${groupId}`
      );
      const c = ((clash as { rows?: unknown[] }).rows ?? clash) as unknown[];
      if (c.length) throw new DomainError("ALREADY_IN_VAT_GROUP", 409, { companyId: m });
      await tx.execute(
        sql`INSERT INTO vat_group_members (group_id, company_id) VALUES (${groupId}, ${m})`
      );
    }
    await recordAudit({
      userId: input.userId,
      companyId: input.representativeCompanyId,
      action: "vat.group.upsert",
      entityType: "vat_group",
      entityId: groupId,
      after: { name: input.name, groupTrn: trn.trn, members: [...members] },
      req: input.req,
    });
    return { id: groupId, name: input.name, groupTrn: trn.trn, memberCompanyIds: [...members] };
  });
}
