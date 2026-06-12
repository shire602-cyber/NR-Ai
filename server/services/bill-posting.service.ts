// GL posting for the vendor-bills (bill-pay) module.
//
// Bills live in raw-SQL tables (vendor_bills / bill_line_items / bill_payments)
// outside Drizzle, but their financial effect must land in the journal like
// every other subledger:
//
//   Approval (on bill_date):
//     Dr  expense/asset account per line (resolved below)   line amount
//     Dr  VAT Receivable (Input VAT)                        vat_amount
//     Cr  Accounts Payable                                  total_amount
//   Reverse-charge approval additionally self-assesses output VAT:
//     Cr  VAT Payable (Output VAT)                          vat_amount
//     (cash payable to the vendor is just the subtotal)
//
//   Payment (on payment_date):
//     Dr  Accounts Payable                                  amount
//     Cr  Bank / Cash                                       amount
//
// Posting is idempotent per source — if a journal entry already exists for
// (source, sourceId) the helper is a no-op, so retried approvals cannot
// double-post.

import { storage } from "../storage";
import { ACCOUNT_CODES } from "../constants";
import { createLogger } from "../config/logger";

const log = createLogger("bill-posting");

export const BILL_JE_SOURCE = "bill";
export const BILL_PAYMENT_JE_SOURCE = "bill_payment";

/** Fallback expense account for uncategorised bill lines. Created on demand
 * for companies whose chart predates it. */
const GENERAL_EXPENSE_CODE = "5130";

/** Map bill-pay category strings to chart-of-accounts codes. */
const CATEGORY_ACCOUNT_CODES: Record<string, string> = {
  inventory: ACCOUNT_CODES.INVENTORY,
  stock: ACCOUNT_CODES.INVENTORY,
  goods: ACCOUNT_CODES.INVENTORY,
  equipment: ACCOUNT_CODES.EQUIPMENT,
  rent: "5010",
  salaries: "5020",
  payroll: "5020",
  utilities: "5030",
  telecom: "5040",
  phone: "5040",
  internet: "5040",
  supplies: "5050",
  office: "5050",
  marketing: "5060",
  advertising: "5060",
  professional: "5070",
  legal: "5070",
  audit: "5070",
  insurance: "5070",
  software: "5080",
  travel: "5090",
  fuel: "5090",
  meals: "5090",
  freight: GENERAL_EXPENSE_CODE,
  shipping: GENERAL_EXPENSE_CODE,
};

interface BillRow {
  id: string;
  company_id: string;
  vendor_name: string;
  bill_number: string | null;
  bill_date: string | Date;
  subtotal: string | number;
  vat_amount: string | number;
  total_amount: string | number;
  reverse_charge: boolean;
  exchange_rate?: string | number | null;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const rateOf = (bill: { exchange_rate?: string | number | null }) =>
  Number(bill.exchange_rate) > 0 ? Number(bill.exchange_rate) : 1;

interface BillLineRow {
  description: string;
  amount: string | number;
  account_id: string | null;
}

function toDate(value: string | Date): Date {
  return value instanceof Date ? value : new Date(value);
}

async function resolveLineAccount(
  accounts: Awaited<ReturnType<typeof storage.getAccountsByCompanyId>>,
  companyId: string,
  line: BillLineRow,
  category: string | null
): Promise<string> {
  if (line.account_id) {
    const explicit = accounts.find((a) => a.id === line.account_id);
    if (explicit) return explicit.id;
  }

  const code = category ? CATEGORY_ACCOUNT_CODES[category.toLowerCase().trim()] : undefined;
  if (code) {
    const mapped = accounts.find((a) => a.code === code && a.isActive !== false);
    if (mapped) return mapped.id;
  }

  const fallback = accounts.find((a) => a.code === GENERAL_EXPENSE_CODE);
  if (fallback) return fallback.id;

  // Older companies don't have 5130 — create it once.
  const created = await storage.createAccount({
    companyId,
    code: GENERAL_EXPENSE_CODE,
    nameEn: "General & Administrative Expenses",
    nameAr: "مصاريف عمومية وإدارية",
    description: "Uncategorised operating expenses (auto-created by bill posting)",
    type: "expense",
    subType: "operating_expense",
    isVatAccount: false,
    vatType: null,
    isSystemAccount: false,
  } as any);
  return created.id;
}

/**
 * Post the AP journal entry for an approved bill. No-op when an entry for this
 * bill already exists. Throws when the company chart is missing the AP account
 * — approving a bill that can never reach the ledger would silently recreate
 * the subledger-island bug this service exists to fix.
 */
export async function postBillApprovalJournal(
  bill: BillRow,
  lineItems: BillLineRow[],
  category: string | null,
  userId: string
): Promise<void> {
  const companyId = bill.company_id;

  const existing = await storage.getJournalEntriesBySource(companyId, BILL_JE_SOURCE, bill.id);
  if (existing.some((e) => e.status === "posted")) {
    log.info({ billId: bill.id }, "Bill already posted to GL — skipping");
    return;
  }

  const accounts = await storage.getAccountsByCompanyId(companyId);
  const ap = accounts.find((a) => a.code === ACCOUNT_CODES.AP && a.type === "liability");
  if (!ap) {
    throw new Error("Accounts Payable account (2010) not found in chart of accounts");
  }
  const inputVat = accounts.find(
    (a) => a.isVatAccount && a.vatType === "input" && a.code === ACCOUNT_CODES.VAT_INPUT
  );
  const outputVat = accounts.find(
    (a) => a.isVatAccount && a.vatType === "output" && a.code === ACCOUNT_CODES.VAT_OUTPUT
  );

  // The ledger is AED — convert document-currency bills at the stored rate.
  const fxRate = rateOf(bill);
  const subtotal = round2(Number(bill.subtotal) * fxRate);
  const vatAmount = round2(Number(bill.vat_amount) * fxRate);
  const billDate = toDate(bill.bill_date);
  const billRef = bill.bill_number || bill.id.slice(0, 8);

  const lines: Array<{ accountId: string; debit: number; credit: number; description: string }> =
    [];

  for (const line of lineItems) {
    const accountId = await resolveLineAccount(accounts, companyId, line, category);
    lines.push({
      accountId,
      debit: round2(Number(line.amount) * fxRate),
      credit: 0,
      description: `Bill ${billRef} - ${line.description}`.slice(0, 255),
    });
  }

  // Per-line rounding can drift a fils from subtotal×rate — rebalance off the
  // actual expense debits (BEFORE the VAT leg) so the entry always balances.
  const expenseDebits = round2(lines.reduce((sum, l) => sum + l.debit, 0));

  if (vatAmount > 0 && inputVat) {
    lines.push({
      accountId: inputVat.id,
      debit: vatAmount,
      credit: 0,
      description: `Input VAT - Bill ${billRef}`,
    });
  }

  if (bill.reverse_charge) {
    // Self-assessed output VAT leg; vendor is owed the subtotal only.
    if (vatAmount > 0 && outputVat) {
      lines.push({
        accountId: outputVat.id,
        debit: 0,
        credit: vatAmount,
        description: `Reverse-charge output VAT - Bill ${billRef}`,
      });
    }
    lines.push({
      accountId: ap.id,
      debit: 0,
      credit: expenseDebits,
      description: `A/P - ${bill.vendor_name} - Bill ${billRef}`,
    });
  } else {
    // If the input VAT account is missing the debit side is short — fall back
    // to crediting AP for the subtotal+VAT only when VAT was debited.
    const apCredit = round2(vatAmount > 0 && inputVat ? expenseDebits + vatAmount : expenseDebits);
    lines.push({
      accountId: ap.id,
      debit: 0,
      credit: apCredit,
      description: `A/P - ${bill.vendor_name} - Bill ${billRef}`,
    });
  }

  const entryNumber = await storage.generateEntryNumber(companyId, billDate);
  await storage.createJournalEntry(
    {
      companyId,
      date: billDate,
      memo: `Vendor Bill ${billRef} - ${bill.vendor_name}`,
      entryNumber,
      status: "posted",
      source: BILL_JE_SOURCE,
      sourceId: bill.id,
      createdBy: userId,
      postedBy: userId,
      postedAt: billDate,
    } as any,
    lines
  );

  log.info({ billId: bill.id, entryNumber }, "Bill approval journal entry created");
}

/**
 * Post the payment journal entry for a bill payment (Dr AP / Cr bank or cash).
 */
export async function postBillPaymentJournal(
  bill: Pick<BillRow, "id" | "company_id" | "vendor_name" | "bill_number" | "exchange_rate">,
  payment: {
    id: string;
    payment_date: string | Date;
    amount: string | number;
    payment_method?: string | null;
  },
  userId: string
): Promise<void> {
  const companyId = bill.company_id;

  const existing = await storage.getJournalEntriesBySource(
    companyId,
    BILL_PAYMENT_JE_SOURCE,
    payment.id
  );
  if (existing.some((e) => e.status === "posted")) {
    log.info({ paymentId: payment.id }, "Bill payment already posted to GL — skipping");
    return;
  }

  const accounts = await storage.getAccountsByCompanyId(companyId);
  const ap = accounts.find((a) => a.code === ACCOUNT_CODES.AP && a.type === "liability");
  const cashCode = payment.payment_method === "cash" ? ACCOUNT_CODES.CASH : ACCOUNT_CODES.BANK;
  const cash =
    accounts.find((a) => a.code === cashCode && a.type === "asset") ||
    accounts.find((a) => a.code === ACCOUNT_CODES.BANK && a.type === "asset");
  if (!ap || !cash) {
    throw new Error("Accounts Payable or Bank account not found in chart of accounts");
  }

  const amount = round2(Number(payment.amount) * rateOf(bill as BillRow));
  const payDate = toDate(payment.payment_date);
  const billRef = bill.bill_number || bill.id.slice(0, 8);

  const entryNumber = await storage.generateEntryNumber(companyId, payDate);
  await storage.createJournalEntry(
    {
      companyId,
      date: payDate,
      memo: `Payment - Bill ${billRef} - ${bill.vendor_name}`,
      entryNumber,
      status: "posted",
      source: BILL_PAYMENT_JE_SOURCE,
      sourceId: payment.id,
      createdBy: userId,
      postedBy: userId,
      postedAt: payDate,
    } as any,
    [
      {
        accountId: ap.id,
        debit: amount,
        credit: 0,
        description: `Settle A/P - Bill ${billRef} - ${bill.vendor_name}`,
      },
      {
        accountId: cash.id,
        debit: 0,
        credit: amount,
        description: `Payment to ${bill.vendor_name} - Bill ${billRef}`,
      },
    ]
  );

  log.info({ paymentId: payment.id, entryNumber }, "Bill payment journal entry created");
}
