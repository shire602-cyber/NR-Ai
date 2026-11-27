import { and, eq, inArray, notInArray, sql } from "drizzle-orm";
import { db } from "../db";
import { accounts, invoices, journalEntries, journalLines } from "../../shared/schema";
import type { Company, CreditNoteLine, Invoice, InvoiceLine } from "../../shared/schema";
import { fromFils, mulRate, sumFils, toFils } from "../../shared/money";
import { baseCurrencyOf, isForeignCurrency } from "../ledger";
import { storage } from "../storage";
import {
  generateCreditNotePDF,
  type CreditNotePdfAdjustment,
  type CreditNotePdfSource,
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

/** Ledger legs that are never part of the supply value: receivable, customer credit/advance. */
const NON_SUPPLY_CODES = ["1040", "2055", "2050"];

/**
 * Art. 60(2)(e) base-currency net of posted document entries, AS POSTED: per source document,
 * the revenue legs of its live standard entry (VAT, receivable and customer-credit legs
 * excluded; reversal entries and reversed entries ignored). `side` picks the posted direction:
 * an invoice credits revenue, a credit note debits it. Documents with no posted entry (drafts)
 * are absent from the result.
 */
async function postedNetBase(
  companyId: string,
  sourceIds: string[],
  side: "credit" | "debit"
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!sourceIds.length) return out;
  const rows = await db
    .select({
      sourceId: journalEntries.sourceId,
      debit: journalLines.debit,
      credit: journalLines.credit,
    })
    .from(journalEntries)
    .innerJoin(journalLines, eq(journalLines.entryId, journalEntries.id))
    .innerJoin(accounts, eq(accounts.id, journalLines.accountId))
    .where(
      and(
        eq(journalEntries.companyId, companyId),
        eq(journalEntries.source, "invoice"),
        inArray(journalEntries.sourceId, sourceIds),
        eq(journalEntries.status, "posted"),
        eq(journalEntries.entryKind, "standard"),
        sql`${journalEntries.reversedEntryId} IS NULL`,
        sql`${journalEntries.reversedByEntryId} IS NULL`,
        eq(accounts.companyId, companyId),
        eq(accounts.isVatAccount, false),
        notInArray(accounts.code, NON_SUPPLY_CODES)
      )
    );
  for (const r of rows) {
    if (!r.sourceId) continue;
    const fils =
      side === "credit" ? toFils(r.credit) - toFils(r.debit) : toFils(r.debit) - toFils(r.credit);
    out.set(r.sourceId, (out.get(r.sourceId) ?? 0) + fils);
  }
  return out;
}

/**
 * Art. 60(2)(e): original value of the supply, corrected value and difference. "Original" is the
 * original tax invoice's net; "corrected" is that net less every credit note on the invoice up to
 * and including this one (other issued notes created earlier; drafts and voids are ignored, this
 * note always counts). Integer fils. Document-currency figures are exact; the base-currency
 * figures are the amounts POSTED to the ledger (the original's revenue credits, each counted
 * note's revenue debits), so they tie to the books to the fil; only a document with no posted
 * entry (a draft preview) falls back to the stored booking rate.
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
  const prior = others
    .filter((o) => o.id !== creditNote.id && isEarlier(o, creditNote))
    .map((o) => ({ id: o.id, fils: toFils(Math.abs(Number(o.subtotal) || 0)) }));
  const originalFils = toFils(Math.abs(Number(original.subtotal) || 0));
  const cumulative = sumFils([...prior.map((p) => p.fils), own]);
  const num = (fils: number) => Number(fromFils(fils));
  const result: CreditNotePdfAdjustment = {
    currency: creditNote.currency || "AED",
    originalNet: num(originalFils),
    correctedNet: num(originalFils - cumulative),
    differenceNet: num(own),
  };
  if (isForeignCurrency(creditNote.currency, baseCurrency) && Number.isFinite(rate) && rate > 0) {
    const r = String(creditNote.exchangeRate);
    const companyId = creditNote.companyId;
    const [postedOriginal, postedNotes] = await Promise.all([
      postedNetBase(companyId, [original.id], "credit"),
      postedNetBase(companyId, [creditNote.id, ...prior.map((p) => p.id)], "debit"),
    ]);
    const originalBase = postedOriginal.get(original.id) ?? mulRate(originalFils, r);
    const ownBase = postedNotes.get(creditNote.id) ?? mulRate(own, r);
    const priorBase = prior.map((p) => postedNotes.get(p.id) ?? mulRate(p.fils, r));
    result.base = {
      currency: baseCurrency,
      originalNet: num(originalBase),
      correctedNet: num(originalBase - sumFils([...priorBase, ownBase])),
      differenceNet: num(ownBase),
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
  } as unknown as CreditNotePdfSource;
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
