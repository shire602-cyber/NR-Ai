/**
 * VAT adjustments (W4-E, R07-08, R07-15):
 *   - bad-debt relief (Art. 64): a tracked claim on an invoice unpaid more than six months after
 *     its due date, written off and notified to the customer. Posts Dr Output VAT 2020 /
 *     Cr Bad Debt Expense 5120 through the ledger kernel; a later payment reverses it.
 *   - return adjustments: tourist refunds (Box 2), import adjustments (Box 7), output / input
 *     corrections and voluntary disclosures. They change the return only (no GL posting) and are
 *     reported as explained reconciliation differences. A correction for VAT from before the
 *     go-live date is refused (INTEGRATE-H, N4 residual): it would have no GL side.
 *   - VAT groups (Art. 14): the representative files one return for all members.
 */
import { journalLine, journalMemo } from "@shared/journal-memo";
import { uaeToday } from "@shared/uae-date";
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
  vatReturns,
  type BadDebtReliefClaim,
} from "../../shared/schema";
import { allocate, fromFils, toFils } from "../../shared/money";
import { validateUaeTrn } from "../../shared/receipt-ocr-parser";
import {
  loadBaseCurrency,
  postJournal,
  reverseEntry,
  withLedgerTx,
  type LedgerTx,
} from "../ledger";
import { ledgerQueryable } from "../ledger/tx";
import {
  assertVatGroupManagers,
  legacyFilingVatGroups,
  loadVatGroupForRepresentative,
  UNVERIFIED_VAT_GROUP,
  vatGroupVerificationRequiredError,
  withFilingVatGroup,
} from "../ledger/vat-group-scope";
import {
  findFiledVatPeriod,
  lockVatGroupMembership,
  lockVatReturnCompanies,
  lockVatReturns,
  vatPeriodFiledError,
} from "../ledger/vat-lock";
import { recordAudit } from "../services/audit.service";
import {
  invoiceSettlement,
  lockInvoice,
  totalsForStoredDocument,
} from "../services/invoice-posting.service";
import { lockPeriodPolicy } from "../services/period-lock.service";
import { localDateSql } from "../reporting/settlement";
import { invoiceWrittenOffFils } from "../services/invoice-payment.service";
import { onDomainEvent } from "../platform/domain-events";
import { createLogger } from "../config/logger";
import { has, provide } from "../platform/service-registry";
import { normaliseEmirate, toBaseFils } from "./vat-boxes";
import { loadVatCompany, returnAdjustmentDelta, type ReturnAdjustmentKind } from "./vat-engine";
import { appliedReceiptAmountSql, salesTaxPointSql } from "./sales-tax-point";
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

/**
 * Earliest date a bad-debt relief claim may be made (exclusive): six months after the DATE OF
 * SUPPLY (FDL 8/2017 Art. 64(1)(c), L1), not after the due date.
 */
export function badDebtEligibleFrom(dateOfSupply: string): string {
  return addMonthsIso(dateOfSupply, 6);
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
  // L1: the six months run from the date of supply (the supply date when recorded, else the
  // invoice date), FDL 8/2017 Art. 64(1)(c).
  const { rows } = await pool.query(
    `SELECT (${salesTaxPointSql("si")})::text AS d FROM invoices si
      WHERE si.company_id = $1 AND si.id = $2`,
    [input.companyId, inv.id]
  );
  const supplied = rows[0]?.d;
  if (!supplied) throw new DomainError("INVOICE_NO_DATE", 422);
  const eligible = badDebtEligibleFrom(supplied);
  if (input.claimDate <= eligible) {
    throw new DomainError(
      "BAD_DEBT_TOO_EARLY",
      422,
      { dateOfSupply: supplied, eligibleAfter: eligible },
      `Bad-debt relief needs more than six months after the date of supply (after ${eligible}).`
    );
  }
  const emirate = normaliseEmirate(inv.placeOfSupplyEmirate);
  if (!emirate) throw new DomainError("EMIRATE_MISSING", 422, { invoiceId: inv.id });
  const lines = await db.select().from(invoiceLines).where(eq(invoiceLines.invoiceId, inv.id));
  const totals = totalsForStoredDocument(inv, lines);
  if (totals.vatFils <= 0) throw new DomainError("INVOICE_HAS_NO_VAT", 422);
  const baseCurrency = await loadBaseCurrency(input.companyId);
  const rate =
    (inv.currency || baseCurrency).toUpperCase() === baseCurrency
      ? "1"
      : String(inv.exchangeRate || 1);
  const output = await vatAccountId(input.companyId, "output");
  const expense = await ensureBadDebtExpense(input.companyId);

  return withLedgerTx(async (tx) => {
    await lockInvoice(tx, inv.id, input.companyId);
    const s = await invoiceSettlement(tx, inv.id);
    // A3 (H1): Art. 64(1)(b) needs an actual write-off in the accounts, not a self-attestation.
    // The write-off settles the invoice (method 'write_off'), so the unpaid consideration is
    // what was neither received nor credited, and relief is limited to what was written off.
    const writtenOffDoc = await invoiceWrittenOffFils(tx, input.companyId, inv.id);
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
    // Split the VAT in document currency, assigning a half-fil tie to the unpaid portion.
    const [vatDoc] = allocate(totals.vatFils, [outstandingDoc, totals.totalFils - outstandingDoc]);
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
        ...journalMemo("badDebtRelief", {
          ref: inv.number,
          outstandingDocFils: String(outstandingDoc),
        }),
        status: "posted",
        source: BAD_DEBT_SOURCE,
        sourceId: claim.id,
        idempotencyKey: `vat_bad_debt_relief:${claim.id}`,
        lines: [
          {
            accountId: output,
            debitFils: vatBase,
            systemVat: true,
            ...journalLine("vatReliefOutput", { ref: inv.number }),
          },
          {
            accountId: expense.id,
            creditFils: vatBase,
            ...journalLine("vatReliefRecovered", { ref: inv.number }),
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
      tx,
    });
    return saved;
  });
}

async function restoredBadDebtVatFils(tx: LedgerTx, claim: BadDebtReliefClaim): Promise<number> {
  const { rows } = await ledgerQueryable(tx).query(
    `SELECT COALESCE(SUM(ROUND((jl.credit - jl.debit) * 100)), 0) AS restored
       FROM journal_entries je JOIN journal_lines jl ON jl.entry_id = je.id
      WHERE je.company_id = $1 AND je.source = $2 AND je.source_id = $3 AND je.status = 'posted'
        AND je.reversed_by_entry_id IS NULL AND jl.system_vat
        AND split_part(je.idempotency_key, ':', 3) = 'recover'`,
    [claim.companyId, BAD_DEBT_SOURCE, claim.id]
  );
  return Number(rows[0].restored);
}

async function postBadDebtVatRecovery(
  tx: LedgerTx,
  claim: BadDebtReliefClaim,
  vatFils: number,
  date: string,
  userId: string,
  reason: string,
  key: string
) {
  const { rows } = await ledgerQueryable(tx).query(
    `SELECT jl.account_id, jl.system_vat
       FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id
      WHERE jl.entry_id = $1 AND je.company_id = $2`,
    [claim.journalEntryId, claim.companyId]
  );
  const output = rows.find((line) => line.system_vat);
  const expense = rows.find((line) => !line.system_vat);
  if (!output || !expense) throw new DomainError("BAD_DEBT_CLAIM_JOURNAL_MISSING", 409);

  const { entry } = await postJournal(
    {
      companyId: claim.companyId,
      date,
      memo: reason,
      status: "posted",
      source: BAD_DEBT_SOURCE,
      sourceId: claim.id,
      idempotencyKey: `vat_bad_debt_relief:${claim.id}:recover:${key}`,
      lines: [
        { accountId: output.account_id, creditFils: vatFils, systemVat: true },
        { accountId: expense.account_id, debitFils: vatFils },
      ],
    },
    { actorId: userId, tx, audit: true }
  );
  return entry;
}

export async function reverseBadDebtReliefClaim(input: {
  companyId: string;
  claimId: string;
  userId: string;
  date: string;
  reason: string;
  req?: Request;
}): Promise<BadDebtReliefClaim> {
  return withLedgerTx(async (tx) => {
    const [target] = await tx
      .select({ invoiceId: badDebtReliefClaims.invoiceId })
      .from(badDebtReliefClaims)
      .where(
        and(
          eq(badDebtReliefClaims.id, input.claimId),
          eq(badDebtReliefClaims.companyId, input.companyId)
        )
      );
    if (!target) throw new DomainError("BAD_DEBT_CLAIM_NOT_FOUND", 404);
    await lockInvoice(tx, target.invoiceId, input.companyId);
    const [claim] = await tx
      .select()
      .from(badDebtReliefClaims)
      .where(
        and(
          eq(badDebtReliefClaims.id, input.claimId),
          eq(badDebtReliefClaims.companyId, input.companyId)
        )
      )
      .for("update");
    if (!claim) throw new DomainError("BAD_DEBT_CLAIM_NOT_FOUND", 404);
    if (claim.status !== "claimed") throw new DomainError("BAD_DEBT_CLAIM_NOT_ACTIVE", 409);
    const date = input.date < String(claim.claimDate) ? String(claim.claimDate) : input.date;
    const restoredFils = await restoredBadDebtVatFils(tx, claim);
    const remainingFils = toFils(claim.vatAmount) - restoredFils;
    const rev =
      claim.journalEntryId && !restoredFils
        ? await reverseEntry(
            claim.journalEntryId,
            { date, reason: input.reason, source: BAD_DEBT_SOURCE, sourceId: claim.id },
            { actorId: input.userId, tx, companyId: input.companyId }
          )
        : null;
    const entry =
      restoredFils && remainingFils > 0
        ? await postBadDebtVatRecovery(
            tx,
            claim,
            remainingFils,
            date,
            input.userId,
            input.reason,
            "manual"
          )
        : null;
    const [saved] = await tx
      .update(badDebtReliefClaims)
      .set({
        status: "reversed",
        reversedAt: date,
        reversalReason: input.reason,
        reversalEntryId: entry?.id ?? rev?.reversal.id ?? null,
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
      tx,
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

const PAYMENT_RECOVERY_REASON = "Payment received after bad-debt relief was claimed";

/** Process committed receipts in order, independently of which callback runs first. */
export async function reverseReliefOnPayment(p: {
  companyId: string;
  invoiceId: string;
  paymentId: string;
  actorUserId?: string | null;
}): Promise<{ claimId: string; reversed: true; date: string; remainingVatFils: number } | null> {
  return withLedgerTx(async (tx) => {
    const q = ledgerQueryable(tx);
    // Match the invoice -> claim lock order used by payment reversal and claim creation.
    const locked = await q.query(
      "SELECT id FROM invoices WHERE company_id = $1 AND id = $2 FOR UPDATE",
      [p.companyId, p.invoiceId]
    );
    if (!locked.rows.length) return null;
    const [claim] = await tx
      .select()
      .from(badDebtReliefClaims)
      .where(
        and(
          eq(badDebtReliefClaims.companyId, p.companyId),
          eq(badDebtReliefClaims.invoiceId, p.invoiceId),
          eq(badDebtReliefClaims.status, "claimed")
        )
      )
      .for("update");
    if (!claim) return null;

    const { rows: receipts } = await q.query(
      `SELECT sp.id, sp.created_by, ${localDateSql("sp.date")}::text AS date,
              ROUND(${appliedReceiptAmountSql("sp")} * 100) AS applied_fils,
              EXISTS (
                SELECT 1 FROM journal_entries je
                 WHERE je.company_id = sp.company_id AND je.source = $4 AND je.source_id = c.id
                   AND je.idempotency_key = $4 || ':' || c.id || ':recover:' || sp.id
                   AND je.status = 'posted' AND je.reversed_by_entry_id IS NULL
              ) AS recovered
         FROM invoice_payments sp
         JOIN bad_debt_relief_claims c ON c.invoice_id = sp.invoice_id AND c.company_id = sp.company_id
        WHERE sp.invoice_id = $1 AND sp.company_id = $2 AND c.id = $3
          AND sp.method <> 'write_off' AND sp.created_at >= c.created_at
        ORDER BY sp.created_at, sp.id`,
      [p.invoiceId, p.companyId, claim.id, BAD_DEBT_SOURCE]
    );
    if (!receipts.some((receipt) => receipt.id === p.paymentId)) return null;

    const {
      rows: [basis],
    } = await q.query(
      `SELECT (je.memo_params ->> 'outstandingDocFils')::bigint AS outstanding_doc_fils,
              i.currency, i.exchange_rate
         FROM invoices i
         LEFT JOIN journal_entries je ON je.id = $3 AND je.company_id = i.company_id
        WHERE i.id = $1 AND i.company_id = $2`,
      [p.invoiceId, p.companyId, claim.journalEntryId]
    );
    // Older claim journals recorded the outstanding amount using an AED-based rate.
    const legacyRate =
      (basis.currency || "AED").toUpperCase() === "AED" ? 1 : Number(basis.exchange_rate || 1);
    const outstandingFils = Number(
      basis.outstanding_doc_fils ?? Math.round(toFils(claim.outstandingAmount) / legacyRate)
    );
    if (outstandingFils <= 0) return null;

    const cap = toFils(claim.vatAmount);
    let restoredFils = await restoredBadDebtVatFils(tx, claim);
    let receivedFils = 0;
    let previousTarget = 0;
    let paymentDate: string | undefined;
    for (const receipt of receipts) {
      receivedFils = Math.min(receivedFils + Number(receipt.applied_fils), outstandingFils);
      const [target] = allocate(cap, [receivedFils, outstandingFils - receivedFils]);
      const incrementalFils = Math.min(target - previousTarget, cap - restoredFils);
      previousTarget = target;
      if (receipt.recovered || incrementalFils <= 0) continue;

      await lockPeriodPolicy(tx, p.companyId, "shared");
      await lockVatReturns(tx, p.companyId, "shared");
      let date = receipt.date < claim.claimDate ? claim.claimDate : receipt.date;
      // If the receipt's return is filed, keep its correction in the first open return.
      for (
        let closure = await findFiledVatPeriod(tx, p.companyId, date);
        closure;
        closure = await findFiledVatPeriod(tx, p.companyId, date)
      ) {
        if (closure === UNVERIFIED_VAT_GROUP) throw vatPeriodFiledError(closure, date);
        const next = new Date(`${closure.periodEnd}T00:00:00.000Z`);
        next.setUTCDate(next.getUTCDate() + 1);
        date = next.toISOString().slice(0, 10);
      }
      const entry = await postBadDebtVatRecovery(
        tx,
        claim,
        incrementalFils,
        date,
        (receipt.id === p.paymentId ? p.actorUserId : null) ?? receipt.created_by,
        PAYMENT_RECOVERY_REASON,
        receipt.id
      );
      if (receipt.id === p.paymentId) paymentDate = date;
      restoredFils += incrementalFils;
      if (restoredFils === cap) {
        await tx
          .update(badDebtReliefClaims)
          .set({
            status: "reversed",
            reversedAt: date,
            reversalReason: PAYMENT_RECOVERY_REASON,
            reversalEntryId: entry.id,
            updatedAt: new Date(),
          })
          .where(eq(badDebtReliefClaims.id, claim.id));
        break;
      }
    }
    return paymentDate
      ? {
          claimId: claim.id,
          reversed: true,
          date: paymentDate,
          remainingVatFils: cap - restoredFils,
        }
      : null;
  });
}

/** Undo the VAT recovery in the same transaction that removes the receipt. */
export async function undoReliefRecoveryOnPayment(input: {
  companyId: string;
  invoiceId: string;
  paymentId: string;
  actorId: string;
  reason: string;
  date?: string | null;
  tx: LedgerTx;
}) {
  const { tx, companyId, invoiceId, paymentId, actorId } = input;
  const q = ledgerQueryable(tx);
  const { rows: recoveries } = await q.query(
    `SELECT je.id, c.id AS claim_id, ROUND((jl.credit - jl.debit) * 100) AS vat_fils,
            last.idempotency_key = $4 || ':' || c.id || ':recover:manual' AS manually_closed
       FROM bad_debt_relief_claims c
       JOIN journal_entries je ON je.source_id = c.id AND je.company_id = c.company_id
       JOIN journal_lines jl ON jl.entry_id = je.id AND jl.system_vat
       LEFT JOIN journal_entries last ON last.id = c.reversal_entry_id AND last.company_id = c.company_id
      WHERE c.company_id = $1 AND c.invoice_id = $2 AND je.source = $4
        AND je.idempotency_key = $4 || ':' || c.id || ':recover:' || $3
        AND je.status = 'posted' AND je.reversed_by_entry_id IS NULL
      ORDER BY c.id FOR UPDATE OF c`,
    [companyId, invoiceId, paymentId, BAD_DEBT_SOURCE]
  );
  for (const recovery of recoveries) {
    const { reversal } = await reverseEntry(
      recovery.id,
      {
        date: input.date,
        reason: input.reason,
        source: BAD_DEBT_SOURCE,
        sourceId: recovery.claim_id,
      },
      { actorId, tx, companyId }
    );
    if (recovery.manually_closed) {
      // A manual withdrawal still restores the whole claim after a receipt is removed.
      const [claim] = await tx
        .select()
        .from(badDebtReliefClaims)
        .where(eq(badDebtReliefClaims.id, recovery.claim_id));
      await postBadDebtVatRecovery(
        tx,
        claim,
        Number(recovery.vat_fils),
        uaeToday(reversal.date),
        actorId,
        "Maintain manual withdrawal of bad-debt relief after receipt reversal",
        `manual:${paymentId}`
      );
    } else {
      await tx
        .update(badDebtReliefClaims)
        .set({
          status: "claimed",
          reversedAt: null,
          reversalReason: null,
          reversalEntryId: null,
          updatedAt: new Date(),
        })
        .where(eq(badDebtReliefClaims.id, recovery.claim_id));
    }
  }
}

let paymentHookInstalled = false;
/** Retry path for reverseReliefOnPayment (see above). */
export function installBadDebtPaymentHook(): void {
  if (paymentHookInstalled) return;
  paymentHookInstalled = true;
  if (!has("vat.reverseReliefOnPayment"))
    provide("vat.reverseReliefOnPayment", reverseReliefOnPayment);
  if (!has("vat.undoReliefRecoveryOnPayment"))
    provide("vat.undoReliefRecoveryOnPayment", undoReliefRecoveryOnPayment);
  onDomainEvent("payment.received", async (e) => {
    const p = e.payload as typeof e.payload & { actorUserId?: string };
    if (!p.invoiceId) return;
    try {
      await reverseReliefOnPayment({
        companyId: p.companyId,
        invoiceId: p.invoiceId,
        paymentId: p.entityId,
        actorUserId: p.actorUserId,
      });
    } catch (err) {
      log.error({ err, invoiceId: p.invoiceId }, "bad-debt relief reversal on payment failed");
    }
  });
}

// ─── Return adjustments ──────────────────────────────────────────────────

const CORRECTION_KINDS: ReadonlySet<ReturnAdjustmentKind> = new Set([
  "output_correction",
  "input_correction",
  "voluntary_disclosure_output",
  "voluntary_disclosure_input",
]);

/**
 * INTEGRATE-H (re-audit 3 N4 residual): a return adjustment changes the return only, while the
 * settlement clears Box 12 / Box 13 from 2020 / 1050. A correction for VAT of the days before the
 * go-live date (cut-over of a committed opening import) therefore has no GL side: VAT carried on
 * 2040 (the pre-D1 opening guidance) plus such an adjustment ends with 2020 debit and 2040
 * credit for ever. That VAT is moved onto the VAT account by a reasoned VAT journal instead
 * (Dr the account it is carried on / Cr 2020, or Dr 1050 / Cr that account): the engine reports
 * it in the return's adjustment column and the settlement then clears both accounts.
 * Corrections that concern only periods after the go-live date are unchanged.
 */
async function assertNotPreGoLiveCorrection(
  companyId: string,
  kind: ReturnAdjustmentKind,
  periodStart: string,
  corrects: { start: string | null }
): Promise<void> {
  if (!CORRECTION_KINDS.has(kind)) return;
  const { rows } = await pool.query<{ go_live: string | null }>(
    `SELECT MAX(cut_over_date)::date::text AS go_live FROM import_jobs
      WHERE company_id = $1 AND status = 'committed' AND cut_over_date IS NOT NULL`,
    [companyId]
  );
  const goLive = rows[0]?.go_live ?? null;
  if (!goLive) return;
  const covers = periodStart <= goLive || (corrects.start !== null && corrects.start <= goLive);
  if (!covers) return;
  const output = kind === "output_correction" || kind === "voluntary_disclosure_output";
  throw new DomainError(
    "VAT_PRE_GO_LIVE_ADJUSTMENT",
    422,
    { goLiveDate: goLive, kind, vatAccount: output ? "2020" : "1050" },
    `This correction covers VAT from before your go-live date ${goLive}, which is not on the VAT account. ` +
      (output
        ? "Move it with a VAT journal instead: debit the account it is carried on (for example 2040 Accrued Expenses) and credit 2020 Output VAT, with a reason, dated in this period."
        : "Move it with a VAT journal instead: debit 1050 Input VAT and credit the account it is carried on (for example 2040 Accrued Expenses), with a reason, dated in this period.") +
      " The return reports it as an adjustment and its payment or refund clears both accounts."
  );
}

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
  await assertNotPreGoLiveCorrection(input.companyId, input.kind, period.from, {
    start: input.correctsPeriodStart ?? null,
  });
  return withLedgerTx(async (tx) => {
    await lockVatReturns(tx, input.companyId, "shared");
    const closure = await findFiledVatPeriod(tx, input.companyId, period.from, period.to);
    if (closure === UNVERIFIED_VAT_GROUP) throw vatGroupVerificationRequiredError();
    if (closure) {
      throw new DomainError(
        "VAT_RETURN_FINAL",
        409,
        undefined,
        "That period's return is submitted; record the correction in the current period or amend the return."
      );
    }
    const [row] = await tx
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
      tx,
    });
    return row;
  });
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
  return withLedgerTx(async (tx) => {
    await lockVatReturns(tx, companyId, "shared");
    const [row] = await tx
      .select()
      .from(vatReturnAdjustments)
      .where(and(eq(vatReturnAdjustments.id, id), eq(vatReturnAdjustments.companyId, companyId)))
      .for("update");
    if (!row) throw new DomainError("VAT_ADJUSTMENT_NOT_FOUND", 404);
    const closure = await findFiledVatPeriod(tx, companyId, row.periodStart, row.periodEnd);
    if (closure === UNVERIFIED_VAT_GROUP) throw vatGroupVerificationRequiredError();
    if (closure) {
      throw new DomainError("VAT_RETURN_FINAL", 409);
    }
    await tx.delete(vatReturnAdjustments).where(eq(vatReturnAdjustments.id, id));
    await recordAudit({
      userId,
      companyId,
      action: "vat.return_adjustment.delete",
      entityType: "vat_return_adjustment",
      entityId: id,
      before: row,
      req,
      tx,
    });
    return { id };
  });
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
  return withLedgerTx(async (tx) => {
    await lockVatGroupMembership(tx, input.representativeCompanyId);
    const existing = await loadVatGroupForRepresentative(input.representativeCompanyId, tx);
    const legacy = existing
      ? await legacyFilingVatGroups(tx, input.representativeCompanyId, existing.groupId)
      : [];
    const members = new Set([input.representativeCompanyId, ...input.memberCompanyIds]);
    // The posting guard reads membership while holding the company's shared lock.
    await lockVatReturnCompanies(tx, [
      ...members,
      ...(existing?.memberIds ?? []),
      ...legacy.flatMap(({ group }) => group.memberIds),
    ]);
    await assertVatGroupManagers(tx, input.userId, [...members]);
    for (const { row, group } of legacy) {
      await tx
        .update(vatReturns)
        .set({
          vatGroupId: group.groupId,
          reconciliationSnapshot: withFilingVatGroup(row.reconciliationSnapshot, group),
        })
        .where(and(eq(vatReturns.id, row.id), eq(vatReturns.companyId, row.companyId)));
    }
    let groupId: string;
    if (existing) {
      groupId = existing.groupId;
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
      before: existing ? { members: existing.memberIds } : undefined,
      after: {
        name: input.name,
        groupTrn: trn.trn,
        members: [...members],
        memberAuthority: "settings.company",
      },
      req: input.req,
      tx,
      required: true,
    });
    return { id: groupId, name: input.name, groupTrn: trn.trn, memberCompanyIds: [...members] };
  });
}
