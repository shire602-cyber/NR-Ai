/**
 * Pension contribution payments (A4: M14, M11).
 *
 * Approved payroll runs credit 2032 Pension Payable with the employee + employer contributions of
 * every UAE / GCC national, tagged per line with the fund that receives them (`payroll_items.
 * pension_fund`: gpssa - UAE and, under the GCC extension, other GCC nationals - or adpf). Paying a fund clears its share of the liability from a
 * cash / bank account through the ledger:
 *
 *   Dr 2032 Pension payable   amount
 *   Cr bank / cash            amount
 *
 * A payment cannot exceed what is outstanding for the fund (accrued from approved runs less
 * payments already posted). Reversing a payment reverses its journal. Contributions are paid
 * through the fund's own portal (GPSSA / ADPF): Muhasib only records the payment.
 */
import type { Request } from "express";
import { DomainError } from "../../errors";
import { recordAudit } from "../audit.service";
import { postJournal, reverseBySource, withLedgerTx, type LedgerTx } from "../../ledger";
import { fromFils } from "../../../shared/money";
import { assertPaymentAccount, payrollAccounts, requireAccount } from "./context";
import type { PensionFund } from "./legal-params";
import { fils, q, q1, type Row } from "./sql";

export const PENSION_PAYMENT_SOURCE = "payroll_pension_payment";
export const PENSION_FUNDS: readonly PensionFund[] = ["gpssa", "adpf"];

const FUND_LABEL: Record<PensionFund, string> = {
  gpssa: "GPSSA",
  adpf: "Abu Dhabi Pension Fund",
};

export interface PensionFundBalance {
  fund: PensionFund;
  label: string;
  accrued: string;
  paid: string;
  outstanding: string;
}

/** Contributions accrued by approved / paid runs less posted payments, per fund (fils). */
async function fundTotals(
  companyId: string,
  tx?: LedgerTx
): Promise<Map<PensionFund, { accrued: number; paid: number }>> {
  const accrued = await q<{ fund: PensionFund; total: string }>(
    `SELECT COALESCE(pi.pension_fund, 'gpssa') AS fund,
            COALESCE(SUM(pi.pension_employee + pi.pension_employer), 0)::text AS total
       FROM payroll_items pi JOIN payroll_runs pr ON pr.id = pi.payroll_run_id
      WHERE pr.company_id = $1 AND pr.status IN ('approved', 'paid')
      GROUP BY 1`,
    [companyId],
    tx
  );
  const paid = await q<{ fund: PensionFund; total: string }>(
    `SELECT fund, COALESCE(SUM(amount), 0)::text AS total FROM payroll_pension_payments
      WHERE company_id = $1 AND status = 'posted' GROUP BY fund`,
    [companyId],
    tx
  );
  const out = new Map<PensionFund, { accrued: number; paid: number }>();
  for (const f of PENSION_FUNDS) out.set(f, { accrued: 0, paid: 0 });
  for (const r of accrued) out.get(r.fund)!.accrued += fils(r.total);
  for (const r of paid) out.get(r.fund)!.paid += fils(r.total);
  return out;
}

export async function pensionLiability(companyId: string): Promise<{
  funds: PensionFundBalance[];
  totalOutstanding: string;
}> {
  const totals = await fundTotals(companyId);
  let total = 0;
  const funds = PENSION_FUNDS.map((fund) => {
    const t = totals.get(fund)!;
    total += t.accrued - t.paid;
    return {
      fund,
      label: FUND_LABEL[fund],
      accrued: fromFils(t.accrued),
      paid: fromFils(t.paid),
      outstanding: fromFils(t.accrued - t.paid),
    };
  });
  return { funds, totalOutstanding: fromFils(total) };
}

export async function listPensionPayments(companyId: string): Promise<Row[]> {
  return q(
    `SELECT p.*, je.entry_number FROM payroll_pension_payments p
       LEFT JOIN journal_entries je ON je.id = p.journal_entry_id
      WHERE p.company_id = $1 ORDER BY p.payment_date DESC, p.created_at DESC`,
    [companyId]
  );
}

export interface PensionPaymentInput {
  fund: PensionFund;
  amount: string;
  paymentDate: string;
  paymentAccountId: string;
  reference?: string | null;
  periodYear?: number | null;
  periodMonth?: number | null;
}

export async function payPension(
  companyId: string,
  actorId: string,
  body: PensionPaymentInput,
  req?: Request
): Promise<Row> {
  const amountFils = fils(body.amount);
  if (amountFils <= 0) throw new DomainError("INVALID_AMOUNT", 422, undefined, "Enter an amount");
  return withLedgerTx(async (tx) => {
    // Serialise payments of one company so two payments cannot both pass the outstanding check.
    await q(`SELECT pg_advisory_xact_lock(hashtext('pension-pay:' || $1::text))`, [companyId], tx);
    await assertPaymentAccount(companyId, body.paymentAccountId, tx);
    const t = (await fundTotals(companyId, tx)).get(body.fund)!;
    const outstanding = t.accrued - t.paid;
    if (amountFils > outstanding) {
      throw new DomainError(
        "PENSION_PAYMENT_EXCEEDS_LIABILITY",
        422,
        { fund: body.fund, outstanding: fromFils(outstanding) },
        `The payment exceeds the ${FUND_LABEL[body.fund]} contributions outstanding (AED ${fromFils(outstanding)})`
      );
    }
    const accounts = await payrollAccounts(companyId, tx);
    const row = await q1<Row & { id: string }>(
      `INSERT INTO payroll_pension_payments
         (company_id, fund, period_year, period_month, payment_date, amount, payment_account_id,
          reference, created_by)
       VALUES ($1, $2, $3, $4, $5::date, $6, $7, $8, $9) RETURNING *`,
      [
        companyId,
        body.fund,
        body.periodYear ?? null,
        body.periodMonth ?? null,
        body.paymentDate,
        fromFils(amountFils),
        body.paymentAccountId,
        body.reference ?? null,
        actorId,
      ],
      tx
    );
    const period =
      body.periodYear && body.periodMonth
        ? ` ${String(body.periodMonth).padStart(2, "0")}/${body.periodYear}`
        : "";
    const label = `${FUND_LABEL[body.fund]} contributions${period}`;
    const posted = await postJournal(
      {
        companyId,
        date: body.paymentDate,
        memo: `Pension contribution payment - ${label}`,
        source: PENSION_PAYMENT_SOURCE,
        sourceId: row!.id,
        idempotencyKey: `payroll-pension:${row!.id}:payment`,
        reference: body.reference ?? null,
        status: "posted",
        lines: [
          {
            accountId: requireAccount(accounts, "pensionPayable"),
            debitFils: amountFils,
            description: `Pension payable cleared - ${label}`,
          },
          {
            accountId: body.paymentAccountId,
            creditFils: amountFils,
            description: `Paid to ${label}`,
          },
        ],
      },
      { actorId, tx, req, audit: true }
    );
    const updated = await q1<Row>(
      `UPDATE payroll_pension_payments SET journal_entry_id = $2 WHERE id = $1 RETURNING *`,
      [row!.id, posted.entry.id],
      tx
    );
    await recordAudit({
      userId: actorId,
      companyId,
      action: "payroll.pension_payment",
      entityType: "payroll_pension_payment",
      entityId: row!.id,
      before: null,
      after: { fund: body.fund, amount: fromFils(amountFils), journalEntryId: posted.entry.id },
      req,
      tx,
    });
    return { ...updated!, entry_number: posted.entry.entryNumber };
  });
}

export async function reversePensionPayment(
  companyId: string,
  paymentId: string,
  actorId: string,
  reason: string,
  req?: Request
): Promise<Row> {
  const updated = await withLedgerTx(async (tx) => {
    const row = await q1<{ id: string; status: string }>(
      `SELECT id, status FROM payroll_pension_payments WHERE id = $1 AND company_id = $2
        FOR UPDATE`,
      [paymentId, companyId],
      tx
    );
    if (!row) throw new DomainError("PENSION_PAYMENT_NOT_FOUND", 404);
    if (row.status !== "posted") {
      throw new DomainError("PENSION_PAYMENT_REVERSED", 409, { status: row.status });
    }
    await reverseBySource(
      companyId,
      PENSION_PAYMENT_SOURCE,
      paymentId,
      { reason: `Pension payment reversed: ${reason}` },
      { actorId, req, companyId, tx }
    );
    return q1<Row>(
      `UPDATE payroll_pension_payments SET status = 'reversed', reversed_at = NOW()
        WHERE id = $1 AND status = 'posted' RETURNING *`,
      [paymentId],
      tx
    );
  });
  if (!updated) throw new DomainError("PENSION_PAYMENT_REVERSED", 409);
  await recordAudit({
    userId: actorId,
    companyId,
    action: "payroll.pension_payment_reversed",
    entityType: "payroll_pension_payment",
    entityId: paymentId,
    before: { status: "posted" },
    after: { status: "reversed", reason },
    req,
  });
  return updated;
}
