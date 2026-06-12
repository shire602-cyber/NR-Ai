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
  subtotal: string | number;
  vatAmount: string | number;
  total: string | number;
}

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

  const subtotal = Number(invoice.subtotal);
  const vatAmount = Number(invoice.vatAmount);
  const total = Number(invoice.total);
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
    zeroRatedNet = Math.min(zeroRatedNet, subtotal);
  }
  const standardNet = subtotal - zeroRatedNet;

  const journalLines: Array<{
    accountId: string;
    debit: number;
    credit: number;
    description: string;
  }> = [
    {
      accountId: accountsReceivable.id,
      debit: total,
      credit: 0,
      description: `Invoice ${invoice.number} - ${invoice.customerName}`,
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
    journalLines
  );

  log.info({ entryNumber, invoiceId: invoice.id }, "Revenue recognition journal entry created");
  return true;
}
