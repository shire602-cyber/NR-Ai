// Revenue-recognition posting for sales invoices.
//
// An invoice is a draft until it is issued (marked sent/posted). Only issued
// invoices create a revenue journal entry:
//
//   Dr  Accounts Receivable                total
//   Cr  Product/Service Revenue            standard-rated net
//   Cr  Zero-Rated Sales                   zero-rated net (vatRate = 0 lines)
//   Cr  <line revenue account>             net of lines that chose one
//   Cr  VAT Payable (Output VAT)           vatAmount
//
// Posting is idempotent per invoice — invoices that already carry a posted
// journal entry (e.g. data created before drafts stopped auto-posting) are
// skipped, so re-issuing can never double-recognise revenue.

import { storage } from "../storage";
import { ACCOUNT_CODES } from "../constants";
import { createLogger } from "../config/logger";
import { withDocumentLock, LOCK_NS } from "./document-lock";
import { allocateRevenueCredits, buildRevenueCreditLines } from "./revenue-allocation.service";
import { resolveInvoiceFx, toBaseCurrencyAmount } from "./invoice-fx";

const log = createLogger("invoice-posting");

interface InvoiceLike {
  id: string;
  companyId: string;
  number: string;
  customerName: string;
  date: string | Date;
  currency?: string | null;
  exchangeRate?: string | number | null;
  subtotal: string | number;
  vatAmount: string | number;
  total: string | number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Create the revenue-recognition JE for an issued invoice. Returns true when
 * an entry was created, false when one already existed (no-op).
 */
export async function postInvoiceRevenueJournal(
  invoice: InvoiceLike,
  userId: string
): Promise<boolean> {
  // Concurrency: this is a check-then-write. Without serialisation, N parallel
  // "mark as sent" calls each read "not yet posted" and each post a revenue
  // entry — measured at 10 duplicate entries for 10 parallel requests, i.e.
  // revenue and output VAT overstated 10x. Hold an advisory lock on the invoice
  // so exactly one caller can pass the idempotency check.
  return await withDocumentLock(invoice.id, LOCK_NS.INVOICE_POSTING, async () =>
    postInvoiceRevenueJournalLocked(invoice, userId)
  );
}

async function postInvoiceRevenueJournalLocked(
  invoice: InvoiceLike,
  userId: string
): Promise<boolean> {
  const existing = await storage.getJournalEntriesBySource(
    invoice.companyId,
    "invoice",
    invoice.id
  );
  if (existing.some((e) => e.status === "posted")) {
    return false;
  }

  const accounts = await storage.getAccountsByCompanyId(invoice.companyId);
  const accountsReceivable = accounts.find((a) => a.code === ACCOUNT_CODES.AR && a.isSystemAccount);
  const salesRevenue = accounts.find(
    (a) =>
      a.isSystemAccount &&
      a.type === "income" &&
      (a.code === ACCOUNT_CODES.REVENUE || a.code === ACCOUNT_CODES.REVENUE_ALT)
  );
  const zeroRatedSales = accounts.find(
    (a) => a.type === "income" && a.code === ACCOUNT_CODES.ZERO_RATED_SALES
  );
  const vatPayable = accounts.find(
    (a) => a.isVatAccount && a.vatType === "output" && a.code === ACCOUNT_CODES.VAT_OUTPUT
  );

  if (!accountsReceivable || !salesRevenue) {
    log.warn(
      { invoiceId: invoice.id },
      "Could not create revenue recognition entry - missing accounts"
    );
    return false;
  }

  // The ledger is AED. Foreign-currency invoices post at the stored
  // transaction-date rate, with the original amounts preserved on the lines.
  const { currency, rate, isForeign } = resolveInvoiceFx(invoice);
  const docSubtotal = Number(invoice.subtotal);
  const docVatAmount = Number(invoice.vatAmount);
  const docTotal = Number(invoice.total);
  const subtotal = toBaseCurrencyAmount(docSubtotal, rate);
  const vatAmount = toBaseCurrencyAmount(docVatAmount, rate);
  // AR is the sum of the credit legs, not total×rate — independent rounding
  // of subtotal and VAT could otherwise leave the entry unbalanced by a fils.
  const invoiceDate = invoice.date instanceof Date ? invoice.date : new Date(invoice.date);

  // Credit legs per revenue account. Lines that chose a revenue account post
  // there; the rest keep the old split — zero-rated lines (vatRate = 0) to the
  // dedicated 4060 account so VAT Box 4 ties back to the GL (companies without
  // it fall back to the main revenue account), everything else to the default.
  const invoiceLines = await storage.getInvoiceLinesByInvoiceIds([invoice.id]);
  const allocation = allocateRevenueCredits({
    lines: invoiceLines.map((l) => ({
      quantity: l.quantity,
      unitPrice: l.unitPrice,
      vatRate: l.vatRate,
      revenueAccountId: l.revenueAccountId,
    })),
    rate,
    subtotal,
    defaultAccountId: salesRevenue.id,
    zeroRatedAccountId: zeroRatedSales?.id ?? null,
  });
  const arDebit = round2(subtotal + vatAmount);

  const fx = (docAmount: number, side: "debit" | "credit") =>
    isForeign
      ? {
          foreignCurrency: currency,
          exchangeRate: rate,
          ...(side === "debit" ? { foreignDebit: docAmount } : { foreignCredit: docAmount }),
        }
      : {};

  const journalLines: Array<Record<string, unknown>> = [
    {
      accountId: accountsReceivable.id,
      debit: arDebit,
      credit: 0,
      description: `Invoice ${invoice.number} - ${invoice.customerName}${isForeign ? ` (${currency} ${docTotal} @ ${rate})` : ""}`,
      ...fx(docTotal, "debit"),
    },
  ];
  journalLines.push(
    ...buildRevenueCreditLines(allocation, {
      defaultAccountId: salesRevenue.id,
      zeroRatedAccountId: zeroRatedSales?.id ?? null,
      invoiceNumber: invoice.number,
    })
  );
  if (vatAmount > 0 && vatPayable) {
    journalLines.push({
      accountId: vatPayable.id,
      debit: 0,
      credit: vatAmount,
      description: `VAT output - Invoice ${invoice.number}`,
    });
  }

  const entryNumber = await storage.generateEntryNumber(invoice.companyId, invoiceDate);
  await storage.createJournalEntry(
    {
      companyId: invoice.companyId,
      date: invoiceDate,
      memo: `Sales Invoice ${invoice.number} - ${invoice.customerName}`,
      entryNumber,
      status: "posted",
      source: "invoice",
      sourceId: invoice.id,
      createdBy: userId,
      postedBy: userId,
      postedAt: invoiceDate,
    } as any,
    journalLines as any
  );

  log.info({ entryNumber, invoiceId: invoice.id }, "Revenue recognition journal entry created");
  return true;
}
