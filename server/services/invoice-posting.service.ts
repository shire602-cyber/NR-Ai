// Revenue-recognition posting for sales invoices.
//
// An invoice is a draft until it is issued (marked sent/posted). Only issued
// invoices create a revenue journal entry:
//
//   Dr  Accounts Receivable                total
//   Cr  Product/Service Revenue            standard-rated net
//   Cr  Zero-Rated Sales                   zero-rated net (vatRate = 0 lines)
//   Cr  VAT Payable (Output VAT)           vatAmount
//
// Posting is idempotent per invoice — invoices that already carry a posted
// journal entry (e.g. data created before drafts stopped auto-posting) are
// skipped, so re-issuing can never double-recognise revenue.

import { storage } from "../storage";
import { ACCOUNT_CODES } from "../constants";
import { createLogger } from "../config/logger";

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
  const existing = await storage.getJournalEntriesBySource(
    invoice.companyId,
    "invoice",
    invoice.id
  );
  if (existing.some((e) => e.status === "posted")) {
    return false;
  }

  const accounts = await storage.getAccountsByCompanyId(invoice.companyId);
  const accountsReceivable = accounts.find(
    (a) => a.code === ACCOUNT_CODES.AR && a.isSystemAccount
  );
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
  const currency = (invoice.currency || "AED").toUpperCase();
  const rate = Number(invoice.exchangeRate) > 0 ? Number(invoice.exchangeRate) : 1;
  const isForeign = currency !== "AED" && rate !== 1;
  const docSubtotal = Number(invoice.subtotal);
  const docVatAmount = Number(invoice.vatAmount);
  const docTotal = Number(invoice.total);
  const subtotal = round2(docSubtotal * rate);
  const vatAmount = round2(docVatAmount * rate);
  // AR is the sum of the credit legs, not total×rate — independent rounding
  // of subtotal and VAT could otherwise leave the entry unbalanced by a fils.
  const invoiceDate = invoice.date instanceof Date ? invoice.date : new Date(invoice.date);

  // Split zero-rated lines (vatRate = 0) to the dedicated income account so
  // VAT Box 4 can be tied back to the GL. Companies without a 4060 account
  // fall back to the main revenue account.
  let zeroRatedNet = 0;
  if (zeroRatedSales) {
    const lines = await storage.getInvoiceLinesByInvoiceIds([invoice.id]);
    zeroRatedNet = lines
      .filter((l) => Number(l.vatRate) === 0)
      .reduce((sum, l) => sum + Number(l.quantity) * Number(l.unitPrice), 0);
    zeroRatedNet = round2(zeroRatedNet * rate);
    zeroRatedNet = Math.min(zeroRatedNet, subtotal);
  }
  const standardNet = round2(subtotal - zeroRatedNet);
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
  if (standardNet > 0) {
    journalLines.push({
      accountId: salesRevenue.id,
      debit: 0,
      credit: standardNet,
      description: `Sales revenue - Invoice ${invoice.number}`,
    });
  }
  if (zeroRatedNet > 0 && zeroRatedSales) {
    journalLines.push({
      accountId: zeroRatedSales.id,
      debit: 0,
      credit: zeroRatedNet,
      description: `Zero-rated sales - Invoice ${invoice.number}`,
    });
  }
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
