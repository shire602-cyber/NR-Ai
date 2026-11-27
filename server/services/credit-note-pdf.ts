import { and, eq, sql } from "drizzle-orm";
import { db } from "../db";
import { accounts, journalEntries, journalLines } from "../../shared/schema";
import type {
  Company,
  CreditNote,
  CreditNoteLine,
  Invoice,
  InvoiceLine,
} from "../../shared/schema";
import { fromFils, mulRate, sumFils, toFils } from "../../shared/money";
import { baseCurrencyOf, isForeignCurrency } from "../ledger";
import { storage } from "../storage";
import { generateCreditNotePDF, type CreditNotePdfFx } from "./pdf-credit-note.service";

/** Credit notes live in `invoices` (invoice_type = 'credit_note') with negative amounts. */
export function isCreditNoteRow(invoice: { invoiceType?: string | null }): boolean {
  return invoice.invoiceType === "credit_note";
}

function pdfStatus(status: string): string {
  if (status === "draft") return "draft";
  if (status === "void" || status === "cancelled") return "void";
  return "issued";
}

/**
 * VAT of a foreign-currency credit note in the base currency, as POSTED: the debit on the VAT
 * accounts of its own journal entry. A draft has no journal, so it falls back to the credit
 * note's stored booking rate (never a fresh rate lookup).
 */
async function postedVatBase(creditNote: Invoice): Promise<number> {
  const rows = await db
    .select({ debit: journalLines.debit })
    .from(journalEntries)
    .innerJoin(journalLines, eq(journalLines.entryId, journalEntries.id))
    .innerJoin(accounts, eq(accounts.id, journalLines.accountId))
    .where(
      and(
        eq(journalEntries.companyId, creditNote.companyId),
        eq(journalEntries.source, "invoice"),
        eq(journalEntries.sourceId, creditNote.id),
        eq(journalEntries.status, "posted"),
        eq(journalEntries.entryKind, "standard"),
        eq(accounts.companyId, creditNote.companyId),
        eq(accounts.isVatAccount, true),
        sql`${journalEntries.reversedEntryId} IS NULL`
      )
    );
  if (rows.length) return Number(fromFils(sumFils(rows.map((r) => toFils(r.debit)))));
  const vatFils = toFils(Math.abs(Number(creditNote.vatAmount) || 0));
  return Number(fromFils(mulRate(vatFils, String(creditNote.exchangeRate))));
}

/**
 * The credit note PDF for a credit-note invoice row: the reference invoice (loaded tenant-scoped,
 * another company's invoice never resolves) and, for a foreign-currency credit note, the stored
 * booking rate and the posted VAT in the base currency. The single entry point for every
 * credit-note download or attachment.
 */
export async function renderCreditNotePdf(
  creditNote: Invoice,
  lines: InvoiceLine[],
  company: Company
): Promise<Buffer> {
  const original = creditNote.originalInvoiceId
    ? await storage.getInvoice(creditNote.originalInvoiceId, creditNote.companyId)
    : undefined;
  const base = baseCurrencyOf(company);
  let fx: CreditNotePdfFx | null = null;
  const rate = Number(creditNote.exchangeRate);
  if (isForeignCurrency(creditNote.currency, base) && Number.isFinite(rate) && rate > 0) {
    fx = { baseCurrency: base, exchangeRate: rate, vatBase: await postedVatBase(creditNote) };
  }
  const canonical = {
    id: creditNote.id,
    companyId: creditNote.companyId,
    number: creditNote.number,
    customerName: creditNote.customerName,
    customerTrn: creditNote.customerTrn,
    invoiceId: creditNote.originalInvoiceId,
    invoiceNumber: original?.number ?? null,
    date: creditNote.date,
    currency: creditNote.currency,
    subtotal: Math.abs(Number(creditNote.subtotal) || 0),
    vatAmount: Math.abs(Number(creditNote.vatAmount) || 0),
    total: Math.abs(Number(creditNote.total) || 0),
    status: pdfStatus(creditNote.status),
    reason: creditNote.notes || "Invoice credit note",
  } as unknown as CreditNote;
  const canonicalLines = lines.map((line) => ({
    id: line.id,
    creditNoteId: line.invoiceId,
    description: String(line.description || "").replace(/^\[Credit\]\s*/u, ""),
    quantity: Math.abs(Number(line.quantity) || 0),
    unitPrice: Math.abs(Number(line.unitPrice) || 0),
    vatRate: line.vatRate,
    vatSupplyType: line.vatSupplyType,
  })) as unknown as CreditNoteLine[];
  return generateCreditNotePDF(canonical, canonicalLines, company, original, fx);
}
