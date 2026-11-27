import { and, eq, sql } from "drizzle-orm";
import { db } from "../db";
import { accounts, invoices, journalEntries, journalLines } from "../../shared/schema";
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
import {
  generateCreditNotePDF,
  type CreditNotePdfAdjustment,
  type CreditNotePdfFx,
} from "./pdf-credit-note.service";

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
 * Art. 60(2)(e): original value of the supply, corrected value and difference. "Original" is the
 * original tax invoice's net; "corrected" is that net less every credit note on the invoice up to
 * and including this one (other issued notes created earlier; drafts and voids are ignored, this
 * note always counts). Integer fils; the base-currency figures use the stored booking rate.
 */
async function supplyAdjustment(
  creditNote: Invoice,
  original: Invoice,
  baseCurrency: string,
  rate: number
): Promise<CreditNotePdfAdjustment> {
  const others = await db
    .select({ id: invoices.id, subtotal: invoices.subtotal, createdAt: invoices.createdAt })
    .from(invoices)
    .where(
      and(
        eq(invoices.companyId, creditNote.companyId),
        eq(invoices.originalInvoiceId, original.id),
        eq(invoices.invoiceType, "credit_note"),
        sql`${invoices.status} NOT IN ('draft', 'void', 'cancelled')`
      )
    );
  const own = toFils(Math.abs(Number(creditNote.subtotal) || 0));
  const priorFils = others
    .filter((o) => o.id !== creditNote.id && isEarlier(o, creditNote))
    .map((o) => toFils(Math.abs(Number(o.subtotal) || 0)));
  const originalFils = toFils(Math.abs(Number(original.subtotal) || 0));
  const cumulative = sumFils([...priorFils, own]);
  const num = (fils: number) => Number(fromFils(fils));
  const result: CreditNotePdfAdjustment = {
    currency: creditNote.currency || "AED",
    originalNet: num(originalFils),
    correctedNet: num(originalFils - cumulative),
    differenceNet: num(own),
  };
  if (isForeignCurrency(creditNote.currency, baseCurrency) && Number.isFinite(rate) && rate > 0) {
    const r = String(creditNote.exchangeRate);
    const originalBase = mulRate(originalFils, r);
    result.base = {
      currency: baseCurrency,
      originalNet: num(originalBase),
      correctedNet: num(originalBase - mulRate(cumulative, r)),
      differenceNet: num(mulRate(own, r)),
    };
  }
  return result;
}

function isEarlier(
  a: { id: string; createdAt: Date | string | null },
  b: { id: string; createdAt: Date | string | null }
): boolean {
  const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
  const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
  return ta !== tb ? ta < tb : a.id < b.id;
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
    customerAddress: creditNote.customerAddress,
    invoiceId: creditNote.originalInvoiceId,
    invoiceNumber: original?.number ?? null,
    date: creditNote.date,
    currency: creditNote.currency,
    subtotal: Math.abs(Number(creditNote.subtotal) || 0),
    vatAmount: Math.abs(Number(creditNote.vatAmount) || 0),
    total: Math.abs(Number(creditNote.total) || 0),
    status: pdfStatus(creditNote.status),
    reason: creditNote.notes || "",
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
  const adjustment = original ? await supplyAdjustment(creditNote, original, base, rate) : null;
  return generateCreditNotePDF(canonical, canonicalLines, company, original, fx, adjustment);
}
