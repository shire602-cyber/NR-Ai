/**
 * Draft sales documents created from outside the invoice screen: the public
 * API (POST /api/v1/invoices), the Shopify order import and the migration
 * import of open invoices. Uses the same building blocks as the invoice route
 * (customer header, line preparation in fils, gap-free number allocation in
 * the insert transaction) and emits `invoice.created` after the commit.
 *
 * Drafts never touch the ledger; issuing them is the normal invoice flow.
 */
import { invoiceLines, invoices, type Invoice } from "../../../shared/schema";
import { fromFils, mulRate } from "../../../shared/money";
import { emitDomainEvent } from "../../platform/domain-events";
import { withLedgerTx, type LedgerTx } from "../../ledger";
import { allocateInvoiceNumber } from "../invoice-numbering.service";
import { assertPeriodNotLocked, lockPeriodPolicy } from "../period-lock.service";
import {
  dueDateFromTerms,
  prepareSalesLines,
  termsFromDays,
  type SalesLineDraft,
} from "../invoice-lifecycle";
import { assertPlaceOfSupply, resolveCustomerHeader } from "../invoice-posting.service";
import { DomainError } from "../../errors";

export interface DraftInvoiceInput {
  contactId?: string | null;
  customerName?: string | null;
  customerTrn?: string | null;
  customerAddress?: string | null;
  date: string; // YYYY-MM-DD
  dueDate?: string | null;
  paymentTerms?: string | null;
  currency?: string;
  exchangeRate?: number | null;
  placeOfSupplyEmirate?: string | null;
  notes?: string | null;
  /** WQ1: where the draft came from (invoices.source; default "app"). */
  source?: "app" | "api" | "import" | "shopify";
  lines: SalesLineDraft[]; // unitPrice in fils
}

function toDate(iso: string): Date {
  return new Date(`${iso.slice(0, 10)}T00:00:00.000Z`);
}

/** Create a draft invoice; returns the inserted row. */
export async function createDraftInvoice(
  companyId: string,
  input: DraftInvoiceInput,
  actorUserId: string | null,
  outer?: LedgerTx
): Promise<Invoice> {
  const header = await resolveCustomerHeader(
    companyId,
    {
      contactId: input.contactId ?? undefined,
      customerName: input.customerName ?? undefined,
      customerTrn: input.customerTrn ?? undefined,
      customerAddress: input.customerAddress ?? undefined,
      paymentTerms: input.paymentTerms ?? undefined,
      placeOfSupplyEmirate: input.placeOfSupplyEmirate ?? undefined,
      dueDate: input.dueDate ?? undefined,
      date: input.date,
    } as Parameters<typeof resolveCustomerHeader>[1],
    { dueDateFromTerms, termsFromDays },
    outer
  );
  const { rows, totals } = prepareSalesLines(input.lines);
  await assertPlaceOfSupply(
    companyId,
    header.placeOfSupplyEmirate,
    rows.map((r) => r.vatSupplyType),
    outer
  );
  const currency = (input.currency ?? "AED").toUpperCase();
  const rate = currency === "AED" ? 1 : Number(input.exchangeRate ?? 0);
  if (!(rate > 0)) {
    throw new DomainError(
      "EXCHANGE_RATE_REQUIRED",
      400,
      { fields: { exchangeRate: ["Required for a foreign-currency invoice"] } },
      "A foreign-currency invoice needs an exchange rate"
    );
  }
  const date = toDate(input.date);
  const notifyCreated = (invoice: Invoice) => {
    emitDomainEvent("invoice.created", {
      companyId,
      entityId: invoice.id,
      number: invoice.number,
      totalFils: totals.totalFils,
      actorUserId,
    });
  };
  const invoice = await withLedgerTx(async (tx, { afterCommit }) => {
    await lockPeriodPolicy(tx, companyId, "shared");
    await assertPeriodNotLocked(companyId, date, tx);
    const number = await allocateInvoiceNumber(companyId, "invoice", date, tx);
    const [inserted] = await tx
      .insert(invoices)
      .values({
        companyId,
        number,
        contactId: header.contactId,
        customerName: header.customerName,
        customerTrn: header.customerTrn,
        customerAddress: header.customerAddress,
        paymentTerms: header.paymentTerms,
        placeOfSupplyEmirate: header.placeOfSupplyEmirate,
        dueDate: header.dueDate ? toDate(header.dueDate) : null,
        date,
        currency,
        exchangeRate: rate,
        baseCurrencyAmount: Number(fromFils(mulRate(totals.totalFils, rate))),
        subtotal: Number(fromFils(totals.subtotalFils)),
        vatAmount: Number(fromFils(totals.vatFils)),
        total: Number(fromFils(totals.totalFils)),
        discountAmount: Number(fromFils(totals.discountFils)),
        notes: input.notes ?? null,
        source: input.source ?? "app",
        status: "draft",
        invoiceType: "invoice",
      } as typeof invoices.$inferInsert)
      .returning();
    for (const r of rows) {
      await tx.insert(invoiceLines).values({
        invoiceId: inserted.id,
        description: r.description,
        quantity: r.quantity,
        unitPrice: r.unitPrice,
        vatRate: r.vatRate,
        vatSupplyType: r.vatSupplyType,
        discountType: r.discountType,
        discountValue: r.discountValue,
        discountAmount: r.discountAmount,
        netAmount: r.netAmount,
        productId: r.productId,
        costCenterId: r.costCenterId,
      } as typeof invoiceLines.$inferInsert);
    }
    if (outer) afterCommit(() => notifyCreated(inserted));
    return inserted as Invoice;
  }, outer);
  if (!outer) notifyCreated(invoice);
  return invoice;
}
