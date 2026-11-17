// Customer deposits and advances (A4: M1).
//
// FDL 8/2017 Art. 25-26: the date of supply is the EARLIEST of the tax invoice, the receipt of
// payment and the supply itself, so VAT is due on an advance when it is received. IFRS 15.106:
// consideration received before the entity performs is a contract liability.
//
//   Receipt (VAT-inclusive amount A, standard rate 5%):
//     Dr bank                          A
//     Cr 2050 contract liability       A - VAT
//     Cr 2020 output VAT               VAT = A x 5/105 (rounded to the fils)
//
//   Applying (part of) the deposit to the final invoice, which charges VAT on the full price:
//     Dr 2050 contract liability       applied - its VAT share
//     Dr 2020 output VAT               its VAT share      (the advance VAT, now on the invoice)
//     Cr 1040 accounts receivable      applied
//
// so the supply's VAT is declared once: on the deposit in the receipt period and the balance on
// the invoice (VAT 201: deposit +net/+VAT on receipt, -net/-VAT when applied, the invoice in
// full). A refund reverses the same share against the bank. The VAT share of a part
// application is pro rata, and the last application takes the remainder, so the shares add up
// to the deposit's VAT exactly.
//
// A deposit is also a customer credit (customer_credits, source_type 'deposit'): applying and
// refunding run through invoice-payment.service (applyCustomerCredit / refundCustomerCredit) so
// the one settlement rule (server/reporting/settlement.ts) sees the application. Deposits are in
// the company's functional currency; journals post only through server/ledger.

import { and, eq, sql } from "drizzle-orm";
import { db } from "../db";
import {
  accounts,
  companies,
  customerContacts,
  customerCreditAllocations,
  customerCredits,
  customerDeposits,
  type CustomerCredit,
  type CustomerDeposit,
} from "../../shared/schema";
import { defaultChartOfAccounts } from "../defaultChartOfAccounts";
import { DomainError } from "../errors";
import { findFiledVatPeriod, vatPeriodFiledError } from "../ledger/vat-lock";
import {
  loadBaseCurrency,
  postJournal,
  withLedgerTx,
  type LedgerTx,
  type PostJournalLineInput,
} from "../ledger";
import { fromFils, toFils } from "../../shared/money";
import { normaliseEmirate } from "../tax/vat-boxes";

export const CUSTOMER_DEPOSIT_SOURCE = "customer_deposit";
export const DEPOSIT_LIABILITY_CODE = "2050";
const VAT_OUTPUT_CODE = "2020";
export const DEPOSIT_VAT_TREATMENTS = ["standard", "zero_rated", "exempt", "out_of_scope"] as const;
export type DepositVatTreatment = (typeof DEPOSIT_VAT_TREATMENTS)[number];

/** VAT inside a VAT-inclusive standard-rated amount: A x 5/105, half-up to the fils. */
export function vatInsideFils(grossFils: number, rate = "0.05"): number {
  const r = Number(rate);
  if (!(r > 0)) return 0;
  // Integer maths: gross * r / (1 + r) with r expressed in basis points of a percent.
  const bp = Math.round(r * 10_000);
  return Math.floor((grossFils * bp * 2 + (10_000 + bp)) / ((10_000 + bp) * 2));
}

/**
 * VAT share of applying `amountFils` of a deposit: pro rata on the deposit's VAT, the remainder
 * when the application uses up the rest of the deposit (shares add up exactly).
 */
export function depositVatShareFils(args: {
  depositGrossFils: number;
  depositVatFils: number;
  remainingGrossFils: number;
  vatAlreadyReversedFils: number;
  amountFils: number;
}): number {
  if (args.depositVatFils === 0 || args.depositGrossFils === 0) return 0;
  if (args.amountFils >= args.remainingGrossFils) {
    return args.depositVatFils - args.vatAlreadyReversedFils;
  }
  return Math.floor(
    (args.amountFils * args.depositVatFils * 2 + args.depositGrossFils) /
      (args.depositGrossFils * 2)
  );
}

async function accountByCode(tx: LedgerTx, companyId: string, code: string): Promise<string> {
  const [found] = await tx
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.companyId, companyId), eq(accounts.code, code)));
  if (found) return found.id;
  const tpl = defaultChartOfAccounts.find((a) => a.code === code);
  if (!tpl) throw new DomainError("CHART_OF_ACCOUNTS_MISSING", 422, { code });
  const [created] = await tx
    .insert(accounts)
    .values({
      companyId,
      code,
      nameEn: tpl.nameEn,
      nameAr: tpl.nameAr,
      description: tpl.description,
      type: tpl.type,
      subType: tpl.subType,
      isVatAccount: tpl.isVatAccount,
      vatType: tpl.vatType,
      isSystemAccount: tpl.isSystemAccount,
    })
    .returning({ id: accounts.id });
  return created.id;
}

/**
 * 422 unless the account is an active cash / bank account of the company (the rule of
 * invoice-payment.service assertCashOrBankAccount; kept local so this module, which that
 * service imports, does not import it back).
 */
async function cashOrBankAccount(companyId: string, accountId: string) {
  const [acct] = await db
    .select()
    .from(accounts)
    .where(and(eq(accounts.id, accountId), eq(accounts.companyId, companyId)));
  if (!acct) {
    throw new DomainError(
      "PAYMENT_ACCOUNT_NOT_FOUND",
      422,
      { accountId },
      "Invalid payment account"
    );
  }
  if (
    acct.type !== "asset" ||
    !["cash", "bank"].includes(String(acct.subType)) ||
    !acct.isActive ||
    acct.isArchived
  ) {
    throw new DomainError(
      "PAYMENT_ACCOUNT_NOT_CASH_OR_BANK",
      422,
      { accountId, code: acct.code, subType: acct.subType },
      "Payment account must be an active cash or bank account (sub-type cash or bank)."
    );
  }
  return acct;
}

export interface CreateDepositInput {
  companyId: string;
  userId: string;
  contactId?: string | null;
  customerName?: string | null;
  customerTrn?: string | null;
  date: string;
  amountFils: number;
  vatTreatment: DepositVatTreatment;
  paymentAccountId: string;
  reference?: string | null;
  description?: string | null;
}

export async function createCustomerDeposit(input: CreateDepositInput) {
  if (!Number.isSafeInteger(input.amountFils) || input.amountFils <= 0) {
    throw new DomainError("INVALID_AMOUNT", 422, undefined, "Enter the amount received");
  }
  const acct = await cashOrBankAccount(input.companyId, input.paymentAccountId);
  const baseCurrency = await loadBaseCurrency(input.companyId);
  const acctCurrency = String((acct as { currency?: string | null }).currency || baseCurrency);
  if (acctCurrency.toUpperCase() !== baseCurrency.toUpperCase()) {
    throw new DomainError(
      "DEPOSIT_CURRENCY_NOT_SUPPORTED",
      422,
      { accountCurrency: acctCurrency, baseCurrency },
      `Customer deposits are recorded in ${baseCurrency}; receive this one into a ${baseCurrency} account`
    );
  }
  let customerName = (input.customerName ?? "").trim();
  let customerTrn = input.customerTrn ?? null;
  if (input.contactId) {
    const [contact] = await db
      .select()
      .from(customerContacts)
      .where(
        and(
          eq(customerContacts.id, input.contactId),
          eq(customerContacts.companyId, input.companyId)
        )
      );
    if (!contact) throw new DomainError("CONTACT_NOT_FOUND", 404, undefined, "Customer not found");
    customerName = customerName || contact.name;
    customerTrn = customerTrn ?? contact.trnNumber ?? null;
  }
  if (!customerName) {
    throw new DomainError("CUSTOMER_REQUIRED", 422, undefined, "Choose or name the customer");
  }
  const [company] = await db
    .select({ emirate: companies.emirate })
    .from(companies)
    .where(eq(companies.id, input.companyId));
  const emirate = normaliseEmirate(company?.emirate ?? null);
  if (input.vatTreatment === "standard" && !emirate) {
    // Validated up front (like invoices): the Box 1 row is the emirate of the supply.
    throw new DomainError(
      "PLACE_OF_SUPPLY_REQUIRED",
      422,
      undefined,
      "Set the company's emirate before recording a standard-rated deposit (VAT 201 Box 1 row)"
    );
  }
  const rate = input.vatTreatment === "standard" ? "0.05" : "0";
  const vatFils = vatInsideFils(input.amountFils, rate);
  const netFils = input.amountFils - vatFils;

  return withLedgerTx(async (tx) => {
    const liability = await accountByCode(tx, input.companyId, DEPOSIT_LIABILITY_CODE);
    const output = vatFils > 0 ? await accountByCode(tx, input.companyId, VAT_OUTPUT_CODE) : null;
    const [{ n }] = (
      await tx.execute(
        sql`SELECT count(*)::int + 1 AS n FROM customer_deposits WHERE company_id = ${input.companyId}`
      )
    ).rows as Array<{ n: number }>;
    const number = `DEP-${input.date.slice(0, 4)}-${String(n).padStart(5, "0")}`;
    const [deposit] = await tx
      .insert(customerDeposits)
      .values({
        companyId: input.companyId,
        contactId: input.contactId ?? null,
        customerName,
        customerTrn,
        number,
        date: input.date,
        amount: Number(fromFils(input.amountFils)),
        netAmount: Number(fromFils(netFils)),
        vatAmount: Number(fromFils(vatFils)),
        vatTreatment: input.vatTreatment,
        vatRate: Number(rate),
        emirate: input.vatTreatment === "out_of_scope" ? null : emirate,
        currency: baseCurrency,
        paymentAccountId: input.paymentAccountId,
        liabilityAccountId: liability,
        reference: input.reference ?? null,
        description: input.description ?? null,
        createdBy: input.userId,
      })
      .returning();
    const label = `Customer deposit ${number} - ${customerName}`;
    const lines: PostJournalLineInput[] = [
      { accountId: input.paymentAccountId, debitFils: input.amountFils, description: label },
      { accountId: liability, creditFils: netFils, description: `${label} (contract liability)` },
    ];
    if (output && vatFils > 0) {
      lines.push({
        accountId: output,
        creditFils: vatFils,
        description: `${label} (VAT on receipt)`,
      });
    }
    const { entry } = await postJournal(
      {
        companyId: input.companyId,
        date: input.date,
        memo: label,
        reference: input.reference ?? number,
        status: "posted",
        source: CUSTOMER_DEPOSIT_SOURCE,
        sourceId: deposit.id,
        idempotencyKey: `customer_deposit:${deposit.id}:receipt`,
        lines,
      },
      { actorId: input.userId, tx }
    );
    const [credit] = await tx
      .insert(customerCredits)
      .values({
        companyId: input.companyId,
        contactId: input.contactId ?? null,
        customerName,
        sourceType: "deposit",
        sourceId: deposit.id,
        currency: baseCurrency,
        exchangeRate: 1,
        liabilityAccountId: liability,
        amount: Number(fromFils(input.amountFils)),
        remaining: Number(fromFils(input.amountFils)),
        createdBy: input.userId,
      })
      .returning();
    const [updated] = await tx
      .update(customerDeposits)
      .set({ journalEntryId: entry.id, creditId: credit.id })
      .where(eq(customerDeposits.id, deposit.id))
      .returning();
    return { deposit: updated, creditId: credit.id, journalEntryId: entry.id };
  });
}

export async function listCustomerDeposits(companyId: string) {
  const rows = await db
    .select({
      deposit: customerDeposits,
      remaining: customerCredits.remaining,
      creditStatus: customerCredits.status,
    })
    .from(customerDeposits)
    .leftJoin(customerCredits, eq(customerCredits.id, customerDeposits.creditId))
    .where(eq(customerDeposits.companyId, companyId))
    .orderBy(sql`${customerDeposits.date} DESC, ${customerDeposits.createdAt} DESC`);
  return rows.map((r) => ({ ...r.deposit, remaining: r.remaining, creditStatus: r.creditStatus }));
}

/**
 * The liability lines for consuming `amountFils` of a deposit credit (apply or refund):
 * Dr 2050 (net share) + Dr 2020 (VAT share). Returns the VAT share to store on the allocation.
 */
export async function depositConsumptionLines(
  tx: LedgerTx,
  credit: CustomerCredit,
  amountFils: number,
  label: string,
  /** Posting date (ISO): the VAT engine reports the consumption on it. */
  dateIso: string
): Promise<{ lines: PostJournalLineInput[]; vatFils: number; deposit: CustomerDeposit }> {
  // A1 (C1) x A4 (M1): applying or refunding an advance changes the VAT 201 of the period it is
  // dated in (even a zero-rated / exempt one that posts no VAT line), so it is refused in a
  // submitted / filed VAT period like any other VAT posting.
  const filed = await findFiledVatPeriod(tx, credit.companyId, dateIso);
  if (filed) throw vatPeriodFiledError(filed, dateIso);
  const [deposit] = await tx
    .select()
    .from(customerDeposits)
    .where(
      and(
        eq(customerDeposits.id, credit.sourceId),
        eq(customerDeposits.companyId, credit.companyId)
      )
    );
  if (!deposit) throw new DomainError("CUSTOMER_DEPOSIT_NOT_FOUND", 404);
  const reversed = await tx.execute(
    sql`SELECT COALESCE(SUM(vat_amount), 0)::text AS v FROM customer_credit_allocations
         WHERE credit_id = ${credit.id}`
  );
  const vatAlready = toFils(String((reversed.rows[0] as { v: string }).v), { rounding: "halfUp" });
  const vatFils = depositVatShareFils({
    depositGrossFils: toFils(String(deposit.amount), { rounding: "halfUp" }),
    depositVatFils: toFils(String(deposit.vatAmount), { rounding: "halfUp" }),
    remainingGrossFils: toFils(String(credit.remaining), { rounding: "halfUp" }),
    vatAlreadyReversedFils: vatAlready,
    amountFils,
  });
  const lines: PostJournalLineInput[] = [
    {
      accountId: credit.liabilityAccountId,
      debitFils: amountFils - vatFils,
      description: `${label} (contract liability)`,
    },
  ];
  if (vatFils > 0) {
    const output = await accountByCode(tx, credit.companyId, VAT_OUTPUT_CODE);
    lines.push({
      accountId: output,
      debitFils: vatFils,
      description: `${label} (advance VAT reversed: charged on the invoice)`,
    });
  }
  return { lines, vatFils, deposit };
}

/** After an apply/refund: mark the deposit applied/refunded once its credit is used up. */
export async function syncDepositStatus(tx: LedgerTx, credit: CustomerCredit): Promise<void> {
  const [c] = await tx.select().from(customerCredits).where(eq(customerCredits.id, credit.id));
  if (!c || c.status !== "closed") return;
  const kinds = await tx
    .select({ kind: customerCreditAllocations.kind })
    .from(customerCreditAllocations)
    .where(eq(customerCreditAllocations.creditId, credit.id));
  const status = kinds.every((k) => k.kind === "refund") ? "refunded" : "applied";
  await tx.update(customerDeposits).set({ status }).where(eq(customerDeposits.id, credit.sourceId));
}
