/**
 * X5 (J1 D1): find, and optionally repair, payments posted to the wrong cash/bank account.
 *
 * Before X5 a bill payment recorded with "Default bank account" credited the generic
 * "1020 Bank Accounts" account even when the company had its own bank account (e.g. 1021), so
 * the bank statement line could never be matched. A payment is mis-posted when its payment
 * account is
 *   - a header account (it has sub-accounts), or
 *   - the generic 1020 while the company has an active managed bank account linked to another
 *     GL account and no managed bank account links to 1020 itself.
 * Payments already matched to a bank statement line are reported but never touched.
 *
 * The finder is read-only. The repair goes through the settlement seams only (service
 * registry): the payment is reversed with `bills.reversePayment` / `invoices.reversePayment`
 * (a kernel reversal of the original entry) and recorded again with `bills.recordPayment` /
 * `invoices.recordPayment` on the same date, amount, rate and reference against the company's
 * primary bank account GL. Nothing is deleted from the ledger.
 */
import { pool } from "../db";
import { fromFils, toFils } from "../../shared/money";
import { resolve } from "../platform/service-registry";
import { primaryBankGlAccountId } from "./payment-accounts.service";
import { assertPeriodNotLocked } from "./period-lock.service";
import { registerBillServices } from "./bill-payment.service";
import { registerInvoicePaymentService } from "./invoice-payment.service";

export interface MispostedPayment {
  kind: "bill_payment" | "invoice_payment";
  paymentId: string;
  documentId: string;
  companyId: string;
  date: string;
  amount: string;
  exchangeRate: string | null;
  method: string | null;
  reference: string | null;
  postedAccountId: string;
  postedAccountCode: string;
  reason: "header_account" | "generic_bank_account";
  /** The account the payment should have gone to (primary bank account GL), when known. */
  targetAccountId: string | null;
  /** True when a bank statement line is already matched to this payment's journal entry. */
  matched: boolean;
}

const WRONG_ACCOUNT_SQL = (alias: string) => `
  (EXISTS (SELECT 1 FROM accounts c WHERE c.parent_id = ${alias}.id AND c.is_archived = false)
   OR (${alias}.code = '1020'
       AND NOT EXISTS (SELECT 1 FROM bank_accounts b WHERE b.gl_account_id = ${alias}.id)
       AND EXISTS (SELECT 1 FROM bank_accounts b
                    WHERE b.company_id = ${alias}.company_id AND b.is_active = true
                      AND b.gl_account_id IS NOT NULL AND b.gl_account_id <> ${alias}.id)))`;

/** Read-only: every active payment posted to a header / generic bank account. */
export async function findMispostedPayments(
  companyId?: string | null
): Promise<MispostedPayment[]> {
  const bills = await pool.query(
    `SELECT 'bill_payment' AS kind, bp.id AS payment_id, bp.bill_id AS document_id,
            vb.company_id, (bp.payment_date::date)::text AS date, bp.amount::text AS amount,
            bp.exchange_rate::text AS exchange_rate, bp.payment_method AS method, bp.reference,
            a.id AS account_id, a.code AS account_code,
            EXISTS (SELECT 1 FROM accounts c WHERE c.parent_id = a.id AND c.is_archived = false)
              AS is_header,
            EXISTS (SELECT 1 FROM journal_entries je
                      JOIN bank_transactions bt ON bt.matched_journal_entry_id = je.id
                     WHERE je.company_id = vb.company_id AND je.source = 'bill_payment'
                       AND je.source_id = bp.id)
              AS matched
       FROM bill_payments bp
       JOIN vendor_bills vb ON vb.id = bp.bill_id
       JOIN accounts a ON a.id = bp.payment_account_id
      WHERE bp.kind = 'payment' AND bp.status = 'active'
        AND ($1::uuid IS NULL OR vb.company_id = $1::uuid)
        AND ${WRONG_ACCOUNT_SQL("a")}
      ORDER BY vb.company_id, bp.payment_date`,
    [companyId ?? null]
  );
  const invoices = await pool.query(
    `SELECT 'invoice_payment' AS kind, ip.id AS payment_id, ip.invoice_id AS document_id,
            ip.company_id, ((ip.date + interval '4 hours')::date)::text AS date,
            ip.amount::text AS amount, ip.exchange_rate::text AS exchange_rate,
            ip.method, ip.reference, a.id AS account_id, a.code AS account_code,
            EXISTS (SELECT 1 FROM accounts c WHERE c.parent_id = a.id AND c.is_archived = false)
              AS is_header,
            EXISTS (SELECT 1 FROM bank_transactions bt
                     WHERE bt.matched_journal_entry_id = ip.journal_entry_id) AS matched
       FROM invoice_payments ip
       JOIN accounts a ON a.id = ip.payment_account_id
      WHERE ($1::uuid IS NULL OR ip.company_id = $1::uuid)
        AND ${WRONG_ACCOUNT_SQL("a")}
      ORDER BY ip.company_id, ip.date`,
    [companyId ?? null]
  );
  const targets = new Map<string, string | null>();
  const out: MispostedPayment[] = [];
  for (const r of [...bills.rows, ...invoices.rows]) {
    if (!targets.has(r.company_id)) {
      targets.set(r.company_id, await primaryBankGlAccountId(r.company_id));
    }
    out.push({
      kind: r.kind,
      paymentId: r.payment_id,
      documentId: r.document_id,
      companyId: r.company_id,
      date: r.date,
      amount: r.amount,
      exchangeRate: r.exchange_rate ?? null,
      method: r.method ?? null,
      reference: r.reference ?? null,
      postedAccountId: r.account_id,
      postedAccountCode: r.account_code,
      reason: r.is_header ? "header_account" : "generic_bank_account",
      targetAccountId: targets.get(r.company_id) ?? null,
      matched: r.matched === true,
    });
  }
  return out;
}

export interface RepairOutcome {
  paymentId: string;
  kind: MispostedPayment["kind"];
  status: "repaired" | "skipped";
  detail: string;
}

async function ownerOf(companyId: string): Promise<string | null> {
  const r = await pool.query(
    `SELECT user_id FROM company_users WHERE company_id = $1
      ORDER BY (role = 'owner') DESC, created_at ASC LIMIT 1`,
    [companyId]
  );
  return (r.rows[0]?.user_id as string | undefined) ?? null;
}

type ReverseBill = (i: {
  companyId: string;
  paymentId: string;
  billId?: string | null;
  actorId: string;
  reason: string;
}) => Promise<unknown>;
type RecordBill = (i: {
  billId: string;
  companyId?: string;
  amountFils: number;
  date: string;
  paymentAccountId?: string | null;
  exchangeRate?: string | null;
  method?: string | null;
  reference?: string | null;
  notes?: string | null;
  actorId: string;
}) => Promise<unknown>;
type ReverseInvoice = (i: {
  companyId: string;
  paymentId: string;
  actorId: string;
  reason: string;
}) => Promise<unknown>;
type RecordInvoice = (i: {
  invoiceId: string;
  companyId: string;
  amount: number;
  date: Date;
  method?: string;
  reference?: string | null;
  notes?: string | null;
  paymentAccountId: string;
  paymentExchangeRate?: number | null;
  createdBy: string;
}) => Promise<unknown>;

/**
 * Repair the given findings (from findMispostedPayments): reverse + re-record each unmatched
 * payment on the primary bank account GL. `actorId` defaults to the company owner.
 */
export async function repairMispostedPayments(
  findings: MispostedPayment[],
  opts: { actorId?: string | null } = {}
): Promise<RepairOutcome[]> {
  registerBillServices();
  registerInvoicePaymentService();
  const out: RepairOutcome[] = [];
  for (const f of findings) {
    const base = { paymentId: f.paymentId, kind: f.kind };
    if (f.matched) {
      out.push({ ...base, status: "skipped", detail: "matched to a bank line; unmatch first" });
      continue;
    }
    if (!f.targetAccountId || f.targetAccountId === f.postedAccountId) {
      out.push({ ...base, status: "skipped", detail: "no managed bank account to move it to" });
      continue;
    }
    const actorId = opts.actorId ?? (await ownerOf(f.companyId));
    if (!actorId) {
      out.push({ ...base, status: "skipped", detail: "no company user to act as" });
      continue;
    }
    const reason = `Reclass: payment posted to ${f.postedAccountCode} moved to the bank account`;
    try {
      // The re-recorded payment keeps its date: refuse up front when that period is locked, so
      // a reversal is never left without its replacement.
      await assertPeriodNotLocked(f.companyId, f.date);
      if (f.kind === "bill_payment") {
        await resolve<ReverseBill>("bills.reversePayment")({
          companyId: f.companyId,
          paymentId: f.paymentId,
          billId: f.documentId,
          actorId,
          reason,
        });
        await resolve<RecordBill>("bills.recordPayment")({
          billId: f.documentId,
          companyId: f.companyId,
          amountFils: toFils(f.amount),
          date: f.date,
          paymentAccountId: f.targetAccountId,
          exchangeRate: f.exchangeRate,
          method: f.method,
          reference: f.reference,
          notes: reason,
          actorId,
        });
      } else {
        await resolve<ReverseInvoice>("invoices.reversePayment")({
          companyId: f.companyId,
          paymentId: f.paymentId,
          actorId,
          reason,
        });
        await resolve<RecordInvoice>("invoices.recordPayment")({
          invoiceId: f.documentId,
          companyId: f.companyId,
          amount: Number(fromFils(toFils(f.amount))),
          date: new Date(`${f.date}T00:00:00Z`),
          method: f.method ?? "bank",
          reference: f.reference,
          notes: reason,
          paymentAccountId: f.targetAccountId,
          paymentExchangeRate: f.exchangeRate ? Number(f.exchangeRate) : null,
          createdBy: actorId,
        });
      }
      out.push({ ...base, status: "repaired", detail: `moved to account ${f.targetAccountId}` });
    } catch (err) {
      out.push({ ...base, status: "skipped", detail: (err as Error).message });
    }
  }
  return out;
}
