// Sales invoices: create / update / issue / void, payments, credit and debit
// notes, customer credits (W3-A).
//
// Contract (server/http/README.md):
//   * every write uses strictBody + shared/validators/invoices.ts — status,
//     number, totals, journal ids and base amounts are never client-settable
//     (R03-02); unknown fields are a 400, never silently dropped (R03-07);
//   * totals come from server/services/document-totals.service (fils, with
//     discounts and per-line supply type, R07-01);
//   * an issued invoice is immutable except notes / payment terms / due date
//     (409 INVOICE_ISSUED_IMMUTABLE, R03-03); currency and rate are fixed at
//     issue;
//   * every journal goes through the ledger kernel (invoice-posting.service,
//     invoice-payment.service); void and credit notes mirror the original
//     entry (R03-01, R03-04);
//   * status moves only through the invoice state machine; "paid" is reached
//     by recording a payment, never by PATCH (R03-13).
import { type Express, type Request, type Response } from "express";
import { z } from "zod";
import { and, eq, sql as sqlTag } from "drizzle-orm";
import { storage } from "../storage";
import { getInvoiceBalances } from "../services/invoice-balances";
import type { InvoiceBalanceFields } from "../../shared/invoice-balance";
import { authMiddleware, requireCustomer } from "../middleware/auth";
import { asyncHandler } from "../middleware/errorHandler";
import { strictBody } from "../http/strict-body";
import { DomainError } from "../errors";
import { db } from "../db";
import {
  invoices as invoicesTable,
  invoiceLines as invoiceLinesTable,
  invoiceTemplates,
  type Invoice,
  type InvoiceTemplate,
} from "../../shared/schema";
import {
  createInvoiceSchema,
  creditNoteRequestSchema,
  debitNoteRequestSchema,
  EDITABLE_AFTER_ISSUE,
  invoiceListQuerySchema,
  invoiceStatusSchema,
  updateInvoiceSchema,
  type CreateInvoiceInput,
  type InvoiceLineInput,
  type SalesLineInput,
  type UpdateInvoiceInput,
} from "../../shared/validators/invoices";
import {
  applyCustomerCreditSchema,
  doubtfulDebtAllowanceSchema,
  invoicePaymentSchema,
  invoiceWriteOffReinstateSchema,
  invoiceWriteOffSchema,
  refundCustomerCreditSchema,
  createCustomerDepositSchema,
} from "../../shared/validators/payments";
import { createCustomerDeposit, listCustomerDeposits } from "../services/customer-deposits.service";
import { fromFils, mulRate, toFils } from "../../shared/money";
import { emitDomainEvent } from "../platform/domain-events";
import { createAndEmitNotification } from "../services/socket.service";
import { notificationCopy } from "../../shared/server-copy";
import {
  assertPeriodNotLocked,
  assertNotFutureDate,
  lockPeriodPolicy,
} from "../services/period-lock.service";
import { todayDubai } from "@shared/accounting-date";
import {
  dueDateFromTerms,
  prepareSalesLines,
  termsFromDays,
  type PreparedSalesLine,
} from "../services/invoice-lifecycle";
import {
  assertPlaceOfSupply,
  createAndIssueCreditNote,
  invoiceSettlement,
  isIssuedStatus,
  issueInvoice,
  issueInvoiceInTx,
  lockInvoice,
  postInvoiceRevenueJournal,
  resolveCustomerHeader,
  voidInvoice,
  type CreditNoteLineInput,
} from "../services/invoice-posting.service";
import {
  applyCustomerCredit,
  getDoubtfulDebtAllowance,
  listCustomerCredits,
  recordInvoicePayment,
  refundCustomerCredit,
  registerInvoicePaymentService,
  reinstateWriteOffs,
  setDoubtfulDebtAllowance,
  writeOffInvoice,
} from "../services/invoice-payment.service";
import {
  generateDeliveryNotePDF,
  type GenerateInvoicePdfOptions,
} from "../services/pdf-invoice.service";
import { recordAudit } from "../services/audit.service";
import { createLogger } from "../config/logger";
import {
  allocateInvoiceNumber,
  peekNextInvoiceNumber,
} from "../services/invoice-numbering.service";
import { removeDraftInvoice } from "../services/invoice-draft-delete.service";
import { assertRetentionExpired } from "../services/retention.service";
import { getRate } from "../services/fx";
import { documentCurrency, loadBaseCurrency, withLedgerTx, type LedgerTx } from "../ledger";
import type { SupplyType } from "../../shared/vat-classification";

const log = createLogger("invoices");

// Resolve the record first, then authorise with the SAME access semantics as
// the rest of the API (hasCompanyAccess covers direct membership, firm owners
// and assigned firm admins). A row the user cannot see is a 404.
export async function findInvoiceForUser(
  userId: string,
  invoiceId: string
): Promise<Invoice | undefined> {
  if (!/^[0-9a-f-]{36}$/i.test(invoiceId)) return undefined;
  const invoice = await storage.getInvoiceById(invoiceId);
  if (!invoice) return undefined;
  const hasAccess = await storage.hasCompanyAccess(userId, invoice.companyId);
  return hasAccess ? invoice : undefined;
}

const userOf = (req: Request): string => (req as Request & { user: { id: string } }).user.id;

/** The body after `strictBody(schema)` replaced it with the parsed, canonical value. */
function validated<T>(req: Request): T {
  return req.body as T;
}

async function assertCompanyAccess(req: Request, companyId: string): Promise<void> {
  if (!(await storage.hasCompanyAccess(userOf(req), companyId))) {
    throw new DomainError("COMPANY_ACCESS_DENIED", 403, undefined, "Access denied");
  }
}

const toDate = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const isoOf = (d: Date | string | null | undefined): string | null =>
  d ? (d instanceof Date ? d : new Date(d)).toISOString().slice(0, 10) : null;

export function lineDraft(
  l: SalesLineInput & Partial<Pick<InvoiceLineInput, "marginScheme" | "marginPurchaseCost">>
) {
  return {
    marginScheme: l.marginScheme ?? false,
    marginPurchaseCost: l.marginScheme ? (l.marginPurchaseCost ?? null) : null,
    description: l.description,
    quantity: l.quantity,
    unitPrice: l.unitPrice,
    vatRate: l.vatRate,
    vatSupplyType: l.vatSupplyType ?? null,
    discountType: l.discountType ?? null,
    discountValue: l.discountValue ?? null,
    productId: l.productId ?? null,
    costCenterId: l.costCenterId ?? null,
    revenueAccountId: (l as { revenueAccountId?: string | null }).revenueAccountId ?? null,
  };
}

export function lineRow(invoiceId: string, r: PreparedSalesLine) {
  return {
    invoiceId,
    description: r.description,
    quantity: r.quantity,
    unitPrice: r.unitPrice,
    vatRate: r.vatRate,
    vatSupplyType: r.vatSupplyType,
    discountType: r.discountType,
    discountValue: r.discountValue,
    discountAmount: r.discountAmount,
    documentDiscountAmount: r.documentDiscountAmount,
    netAmount: r.netAmount,
    productId: r.productId,
    costCenterId: r.costCenterId,
    revenueAccountId: r.revenueAccountId,
    marginScheme: r.marginScheme,
    marginPurchaseCost: r.marginPurchaseCost,
  };
}

/**
 * The rate (company base units per 1 document unit): 1 when the document is in the company's
 * functional currency (W5-C, R14-19), else the explicit rate, else fx.getRate for the company.
 */
export async function resolveDocumentRate(
  companyId: string,
  currency: string,
  dateIso: string,
  supplied?: number | null,
  tx?: LedgerTx
): Promise<number> {
  const base = await loadBaseCurrency(companyId, tx);
  const cur = documentCurrency(currency, base);
  if (cur === base) return 1;
  if (supplied && supplied > 0) return supplied;
  const r = await getRate(companyId, cur, base, dateIso, { tx });
  return r.rate;
}

/** Company-scoped product / cost-centre ids on lines must belong to the company (404 otherwise). */
async function assertLineRefs(
  companyId: string,
  lines: SalesLineInput[],
  q: LedgerTx = db
): Promise<void> {
  const products = [...new Set(lines.map((l) => l.productId).filter(Boolean) as string[])];
  const centres = [...new Set(lines.map((l) => l.costCenterId).filter(Boolean) as string[])];
  for (const id of products) {
    const r: { rows?: unknown[] } = await q.execute(
      sqlTag`SELECT 1 FROM products WHERE id = ${id} AND company_id = ${companyId}`
    );
    if (!(r.rows ?? (r as unknown as unknown[])).length) {
      throw new DomainError("PRODUCT_NOT_FOUND", 404, { productId: id });
    }
  }
  for (const id of centres) {
    const r: { rows?: unknown[] } = await q.execute(
      sqlTag`SELECT 1 FROM cost_centers WHERE id = ${id} AND company_id = ${companyId}`
    );
    if (!(r.rows ?? (r as unknown as unknown[])).length) {
      throw new DomainError("COST_CENTER_NOT_FOUND", 404, { costCenterId: id });
    }
  }
  // E3 (J1-r3): a line's income account is one of this company's active income accounts.
  const incomeAccounts = [
    ...new Set(
      lines
        .map((l) => (l as { revenueAccountId?: string | null }).revenueAccountId)
        .filter(Boolean) as string[]
    ),
  ];
  for (const id of incomeAccounts) {
    const r: { rows?: unknown[] } = await q.execute(
      sqlTag`SELECT 1 FROM accounts WHERE id = ${id} AND company_id = ${companyId}
               AND type = 'income' AND is_active = true AND COALESCE(is_archived, false) = false`
    );
    if (!(r.rows ?? (r as unknown as unknown[])).length) {
      throw new DomainError(
        "REVENUE_ACCOUNT_INVALID",
        422,
        { fields: { revenueAccountId: ["Choose an active income account"] } },
        "Choose an active income account for the line"
      );
    }
  }
}

/**
 * PDF options for an invoice: amount settled (payments + credits) so the PDF
 * shows AMOUNT DUE / PAID correctly (R03-19), contact details as fallback, and
 * the chosen or default invoice template's branding (R03-24).
 */
export async function invoicePdfOptions(invoice: Invoice): Promise<GenerateInvoicePdfOptions> {
  const s = await invoiceSettlement(db, invoice.id);
  const settled = s.paidFils + s.creditedFils + s.appliedFils;
  let customer: GenerateInvoicePdfOptions["customer"];
  // WQ1 (7.21): the document's own language wins over the company locale.
  const locale =
    invoice.documentLanguage === "ar" || invoice.documentLanguage === "en"
      ? invoice.documentLanguage
      : undefined;
  if (invoice.contactId) {
    const contact = await storage.getCustomerContact(invoice.contactId);
    if (contact && contact.companyId === invoice.companyId) {
      customer = {
        name: contact.name,
        trn: contact.trnNumber,
        address: contact.address,
        // WQ1 (14.7): an Arabic document shows the contact's Arabic name when it has one.
        displayName: locale === "ar" && contact.nameAr?.trim() ? contact.nameAr.trim() : null,
      };
    }
  }
  const templates: InvoiceTemplate[] = await db
    .select()
    .from(invoiceTemplates)
    .where(eq(invoiceTemplates.companyId, invoice.companyId));
  const tpl =
    templates.find((t) => t.id === invoice.templateId) ?? templates.find((t) => t.isDefault);
  return {
    ...(locale ? { locale } : {}),
    amountPaid: invoice.invoiceType === "credit_note" ? 0 : Number(fromFils(settled)),
    customer,
    supplyDate: invoice.supplyDate ?? null,
    branding: tpl
      ? {
          primaryColor: tpl.primaryColor,
          headerText: tpl.headerText,
          footerText: tpl.footerText,
          termsText: tpl.termsText,
          bankDetails: tpl.bankDetails,
          logoUrl: tpl.logoUrl,
          showLogo: tpl.showLogo,
        }
      : null,
  };
}

/** Build header + lines + totals for a new sales document (invoice or debit note). */
export async function prepareNewDocument(
  companyId: string,
  body: CreateInvoiceInput,
  tx?: LedgerTx
) {
  const header = await resolveCustomerHeader(
    companyId,
    {
      contactId: body.contactId,
      customerName: body.customerName,
      customerTrn: body.customerTrn,
      customerAddress: body.customerAddress,
      paymentTerms: body.paymentTerms,
      placeOfSupplyEmirate: body.placeOfSupplyEmirate,
      dueDate: body.dueDate,
      date: body.date,
    },
    { dueDateFromTerms, termsFromDays },
    tx
  );
  await assertLineRefs(companyId, body.lines, tx);
  const { rows, totals } = prepareSalesLines(body.lines.map(lineDraft), {
    discountType: body.discountType,
    discountValue: body.discountValue,
    reverseCharge: body.reverseCharge,
  });
  await assertPlaceOfSupply(
    companyId,
    header.placeOfSupplyEmirate,
    rows.map((r) => r.vatSupplyType),
    tx
  );
  const currency = documentCurrency(body.currency, await loadBaseCurrency(companyId, tx));
  const rate = await resolveDocumentRate(companyId, currency, body.date, body.exchangeRate, tx);
  return { header, rows, totals, currency, rate };
}

/** Allocate a draft number and store its header and lines under the company period policy. */
export async function createInvoiceDraft(companyId: string, body: CreateInvoiceInput) {
  const doc = await prepareNewDocument(companyId, body);
  const date = toDate(body.date);
  const invoice = await db.transaction(async (tx: LedgerTx) => {
    await lockPeriodPolicy(tx, companyId, "shared");
    await assertPeriodNotLocked(companyId, date, tx);
    const number = await allocateInvoiceNumber(companyId, "invoice", date, tx);
    const [inserted] = await tx
      .insert(invoicesTable)
      .values({
        companyId,
        number,
        ...doc.header,
        dueDate: doc.header.dueDate ? toDate(doc.header.dueDate) : null,
        date,
        supplyDate: body.supplyDate ? toDate(body.supplyDate) : null,
        currency: doc.currency,
        exchangeRate: doc.rate,
        baseCurrencyAmount: Number(fromFils(mulRate(doc.totals.totalFils || 0, doc.rate) || 0)),
        subtotal: Number(fromFils(doc.totals.subtotalFils)),
        vatAmount: Number(fromFils(doc.totals.vatFils)),
        total: Number(fromFils(doc.totals.totalFils)),
        discountType: body.discountType ?? null,
        discountValue: body.discountValue ?? null,
        discountAmount: Number(fromFils(doc.totals.discountFils)),
        reverseCharge: body.reverseCharge ?? false,
        notes: body.notes ?? null,
        templateId: body.templateId ?? null,
        documentLanguage: body.documentLanguage ?? null,
        source: "app",
        status: "draft",
        invoiceType: "invoice",
      })
      .returning();
    for (const row of doc.rows)
      await tx.insert(invoiceLinesTable).values(lineRow(inserted.id, row));
    return inserted;
  });
  return { invoice, totalFils: doc.totals.totalFils };
}

const NO_BALANCE: InvoiceBalanceFields = {
  amountPaid: 0,
  amountCredited: 0,
  openBalance: 0,
  openBalanceBase: 0,
};
const balanceOf = (m: Map<string, InvoiceBalanceFields>, id: string) => m.get(id) ?? NO_BALANCE;

export function registerInvoiceRoutes(app: Express) {
  registerInvoicePaymentService();

  // ── List (R20-05: cursor pagination by default) ─────────────────────────
  //   (no params) | ?limit=50&cursor=<opaque> → { items, nextCursor, limit } (default 50, max 200)
  //   ?all=true                               → full array (exports, Dashboard/Reports aggregates,
  //                                             credit-note / bank-match pickers)
  app.get(
    "/api/companies/:companyId/invoices",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      await assertCompanyAccess(req, companyId);
      const q = invoiceListQuerySchema.parse(req.query);
      if (q.all === "true") {
        const invoices = await storage.getInvoicesSummaryByCompanyId(companyId, {
          limit: 100_000,
          offset: 0,
        });
        const balances = await getInvoiceBalances(companyId);
        return res.json(invoices.map((inv) => ({ ...inv, ...balanceOf(balances, inv.id) })));
      }
      const limit = q.limit ?? 50;
      const page = await storage.getInvoicesPage(companyId, {
        limit,
        cursor: q.cursor ?? null,
        status: q.status,
        type: q.type,
        source: q.source,
      });
      const balances = await getInvoiceBalances(
        companyId,
        page.items.map((i) => i.id)
      );
      res.json({
        items: page.items.map((inv) => ({ ...inv, ...balanceOf(balances, inv.id) })),
        nextCursor: page.nextCursor,
        limit,
      });
    })
  );

  // ── Detail ───────────────────────────────────────────────────────────────
  app.get(
    "/api/invoices/:id",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const invoice = await findInvoiceForUser(userOf(req), req.params.id);
      if (!invoice)
        return res.status(404).json({ message: "Invoice not found", code: "INVOICE_NOT_FOUND" });
      const lines = await storage.getInvoiceLinesByInvoiceId(invoice.id);
      const s = await invoiceSettlement(db, invoice.id);
      const totalFils = toFils(invoice.total, { rounding: "halfUp" });
      res.json({
        ...invoice,
        lines,
        settlement: {
          amountPaid: fromFils(s.paidFils),
          amountCredited: fromFils(s.creditedFils + s.appliedFils),
          amountDue:
            invoice.invoiceType === "credit_note"
              ? "0.00"
              : fromFils(Math.max(0, totalFils - s.paidFils - s.creditedFils - s.appliedFils)),
        },
      });
    })
  );

  // ── Similar-invoice check (read-only POST) ───────────────────────────────
  const checkSimilarSchema = z
    .object({
      customerName: z.string().max(300).optional().default(""),
      total: z.coerce.number().finite().optional(),
      date: z.string().max(40).optional(),
    })
    .strict();
  app.post(
    "/api/companies/:companyId/invoices/check-similar",
    authMiddleware,
    requireCustomer,
    strictBody(checkSimilarSchema),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      await assertCompanyAccess(req, companyId);
      const { customerName, total, date } = req.body as z.output<typeof checkSimilarSchema>;
      const name = customerName.toLowerCase();
      const all = await storage.getInvoicesByCompanyId(companyId);
      const similar = all.filter((invoice) => {
        const other = (invoice.customerName || "").toLowerCase();
        const customerMatch = !!name && !!other && (other.includes(name) || name.includes(other));
        const amountMatch =
          !!total && !!invoice.total && Math.abs(invoice.total - total) / total < 0.1;
        let dateMatch = false;
        if (date && invoice.date) {
          const diff = Math.abs(new Date(date).getTime() - new Date(invoice.date).getTime());
          dateMatch = diff / 86_400_000 <= 7;
        }
        return [customerMatch, amountMatch, dateMatch].filter(Boolean).length >= 2;
      });
      res.json({
        hasSimilar: similar.length > 0,
        similarInvoices: similar.slice(0, 5).map((invoice) => ({
          id: invoice.id,
          number: invoice.number,
          customerName: invoice.customerName,
          total: invoice.total,
          date: invoice.date,
          status: invoice.status,
        })),
      });
    })
  );

  // Peek next number — for UI display before save. Does not allocate.
  app.get(
    "/api/companies/:companyId/invoices/next-number",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      await assertCompanyAccess(req, companyId);
      const docType =
        req.query.docType === "credit_note"
          ? "credit_note"
          : req.query.docType === "debit_note"
            ? "debit_note"
            : "invoice";
      const number = await peekNextInvoiceNumber(companyId, docType);
      res.json({ number, docType });
    })
  );

  // ── Create (draft) ───────────────────────────────────────────────────────
  app.post(
    "/api/companies/:companyId/invoices",
    authMiddleware,
    requireCustomer,
    strictBody(createInvoiceSchema),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const userId = userOf(req);
      await assertCompanyAccess(req, companyId);
      const body = validated<CreateInvoiceInput>(req);
      const { invoice, totalFils } = await createInvoiceDraft(companyId, body);

      await recordAudit({
        userId,
        companyId,
        action: "invoice.create",
        entityType: "invoice",
        entityId: invoice.id,
        before: null,
        after: {
          number: invoice.number,
          customerName: invoice.customerName,
          total: invoice.total,
          currency: invoice.currency,
          status: invoice.status,
        },
        req,
      });
      emitDomainEvent("invoice.created", {
        companyId,
        entityId: invoice.id,
        number: invoice.number,
        totalFils,
        actorUserId: userId,
      });
      createAndEmitNotification({
        userId,
        companyId,
        type: "invoice_created",
        ...notificationCopy(
          "notification.invoiceCreated.title",
          "notification.invoiceCreated.message",
          {
            number: invoice.number,
            customer: invoice.customerName,
            total: invoice.total,
            currency: documentCurrency(invoice.currency, await loadBaseCurrency(companyId)),
          }
        ),
        priority: "normal",
        relatedEntityType: "invoice",
        relatedEntityId: invoice.id,
        actionUrl: "/invoices",
      }).catch(() => {});
      const lines = await storage.getInvoiceLinesByInvoiceId(invoice.id);
      res.json({ ...invoice, lines });
    })
  );

  // REPAIR ONLY — an issued invoice whose revenue entry is missing (legacy
  // data, or a chart seeded after issue). Issuing is PATCH /status "sent".
  app.post(
    "/api/invoices/:id/post",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const invoice = await findInvoiceForUser(userOf(req), req.params.id);
      if (!invoice)
        return res.status(404).json({ message: "Invoice not found", code: "INVOICE_NOT_FOUND" });
      if (!isIssuedStatus(invoice.status)) {
        return res.status(400).json({ message: "No draft entries to post", code: "NOT_ISSUED" });
      }
      const posted = await postInvoiceRevenueJournal(invoice, userOf(req));
      if (posted) return res.json({ message: "Revenue recognition entry created", count: 1 });
      return res.status(400).json({ message: "No draft entries to post", code: "ALREADY_POSTED" });
    })
  );

  // ── Update ───────────────────────────────────────────────────────────────
  app.put(
    "/api/invoices/:id",
    authMiddleware,
    requireCustomer,
    strictBody(updateInvoiceSchema),
    asyncHandler(async (req: Request, res: Response) => {
      const userId = userOf(req);
      const invoice = await findInvoiceForUser(userId, req.params.id);
      if (!invoice)
        return res.status(404).json({ message: "Invoice not found", code: "INVOICE_NOT_FOUND" });
      const body = validated<UpdateInvoiceInput>(req);

      if (invoice.status !== "draft") {
        // R03-03: an issued tax invoice is immutable. Only fields that do not
        // change the supply or the tax may still be edited; anything else must
        // go through a credit / debit note.
        const changed = await changedIssuedFields(invoice, body);
        if (changed.length) {
          throw new DomainError(
            "INVOICE_ISSUED_IMMUTABLE",
            409,
            {
              fields: changed,
              hint: "Issue a credit note (or debit note) to correct an issued invoice.",
            },
            "An issued invoice cannot be changed. Issue a credit note instead."
          );
        }
        const patch: Partial<Invoice> = {};
        if (body.notes !== undefined) patch.notes = body.notes;
        if (body.paymentTerms !== undefined) patch.paymentTerms = body.paymentTerms;
        if (body.dueDate !== undefined) patch.dueDate = body.dueDate ? toDate(body.dueDate) : null;
        if (body.documentLanguage !== undefined) patch.documentLanguage = body.documentLanguage;
        const updated = Object.keys(patch).length
          ? await storage.updateInvoice(invoice.id, invoice.companyId, patch)
          : invoice;
        await recordAudit({
          userId,
          companyId: invoice.companyId,
          action: "invoice.update",
          entityType: "invoice",
          entityId: invoice.id,
          before: {
            notes: invoice.notes,
            paymentTerms: invoice.paymentTerms,
            dueDate: invoice.dueDate,
            documentLanguage: invoice.documentLanguage,
          },
          after: patch,
          req,
        });
        return res.json(updated);
      }

      // Draft: merge with the latest locked row and keep the close policy stable until commit.
      const { draft, updated } = await db.transaction(async (tx: typeof db) => {
        // Match issuance's lock order: invoice row, then shared period policy.
        const draft = await lockInvoice(tx, invoice.id, invoice.companyId);
        if (draft.status !== "draft")
          throw new DomainError("INVOICE_ISSUED_IMMUTABLE", 409, { hint: "Issued meanwhile" });
        await lockPeriodPolicy(tx, draft.companyId, "shared");
        const currentDate = isoOf(draft.date)!;
        const dateIso = body.date ?? currentDate;
        await assertPeriodNotLocked(draft.companyId, currentDate, tx);
        if (dateIso !== currentDate) await assertPeriodNotLocked(draft.companyId, dateIso, tx);
        const merged: CreateInvoiceInput = {
          contactId: body.contactId !== undefined ? body.contactId : draft.contactId,
          customerName: body.customerName ?? (body.contactId ? undefined : draft.customerName),
          customerTrn: body.customerTrn !== undefined ? body.customerTrn : draft.customerTrn,
          customerAddress:
            body.customerAddress !== undefined ? body.customerAddress : draft.customerAddress,
          date: dateIso,
          dueDate: body.dueDate !== undefined ? body.dueDate : isoOf(draft.dueDate),
          supplyDate: body.supplyDate !== undefined ? body.supplyDate : isoOf(draft.supplyDate),
          paymentTerms: body.paymentTerms !== undefined ? body.paymentTerms : draft.paymentTerms,
          currency: body.currency ?? draft.currency,
          exchangeRate:
            body.exchangeRate !== undefined
              ? body.exchangeRate
              : (body.currency ?? draft.currency) === draft.currency
                ? Number(draft.exchangeRate)
                : null,
          reverseCharge: body.reverseCharge ?? draft.reverseCharge,
          placeOfSupplyEmirate:
            body.placeOfSupplyEmirate !== undefined
              ? body.placeOfSupplyEmirate
              : draft.placeOfSupplyEmirate,
          discountType: body.discountType !== undefined ? body.discountType : draft.discountType,
          discountValue:
            body.discountValue !== undefined ? body.discountValue : draft.discountValue,
          notes: body.notes !== undefined ? body.notes : draft.notes,
          templateId: body.templateId !== undefined ? body.templateId : draft.templateId,
          documentLanguage:
            body.documentLanguage !== undefined
              ? body.documentLanguage
              : ((draft.documentLanguage as "en" | "ar" | null) ?? null),
          lines:
            body.lines ??
            (
              await tx
                .select()
                .from(invoiceLinesTable)
                .where(eq(invoiceLinesTable.invoiceId, draft.id))
            ).map((l) => ({
              description: l.description,
              quantity: Number(l.quantity),
              unitPrice: toFils(l.unitPrice, { rounding: "halfUp" }),
              vatRate: Number(l.vatRate),
              vatSupplyType: (l.vatSupplyType as SupplyType | null) ?? null,
              discountType: (l.discountType as "amount" | "percent" | null) ?? null,
              discountValue: l.discountValue ?? null,
              productId: l.productId ?? null,
              costCenterId: l.costCenterId ?? null,
              revenueAccountId: l.revenueAccountId ?? null,
              marginScheme: l.marginScheme ?? false,
              marginPurchaseCost: l.marginScheme
                ? toFils(l.marginPurchaseCost ?? 0, { rounding: "halfUp" })
                : null,
            })),
        } as CreateInvoiceInput;
        const doc = await prepareNewDocument(draft.companyId, merged, tx);
        const [row] = await tx
          .update(invoicesTable)
          .set({
            ...doc.header,
            dueDate: doc.header.dueDate ? toDate(doc.header.dueDate) : null,
            date: toDate(dateIso),
            supplyDate: merged.supplyDate ? toDate(merged.supplyDate) : null,
            currency: doc.currency,
            exchangeRate: doc.rate,
            baseCurrencyAmount: Number(fromFils(mulRate(doc.totals.totalFils || 0, doc.rate) || 0)),
            subtotal: Number(fromFils(doc.totals.subtotalFils)),
            vatAmount: Number(fromFils(doc.totals.vatFils)),
            total: Number(fromFils(doc.totals.totalFils)),
            discountType: merged.discountType ?? null,
            discountValue: merged.discountValue ?? null,
            discountAmount: Number(fromFils(doc.totals.discountFils)),
            reverseCharge: merged.reverseCharge ?? false,
            notes: merged.notes ?? null,
            templateId: merged.templateId ?? null,
            documentLanguage: merged.documentLanguage ?? null,
          })
          .where(
            and(
              eq(invoicesTable.id, draft.id),
              eq(invoicesTable.companyId, draft.companyId),
              eq(invoicesTable.status, "draft")
            )
          )
          .returning();
        if (!row)
          throw new DomainError("INVOICE_ISSUED_IMMUTABLE", 409, { hint: "Issued meanwhile" });
        await tx.delete(invoiceLinesTable).where(eq(invoiceLinesTable.invoiceId, draft.id));
        for (const r of doc.rows) await tx.insert(invoiceLinesTable).values(lineRow(draft.id, r));
        return { draft, updated: row };
      });

      await recordAudit({
        userId,
        companyId: invoice.companyId,
        action: "invoice.update",
        entityType: "invoice",
        entityId: invoice.id,
        before: {
          subtotal: draft.subtotal,
          vatAmount: draft.vatAmount,
          total: draft.total,
          date: draft.date,
        },
        after: {
          subtotal: updated.subtotal,
          vatAmount: updated.vatAmount,
          total: updated.total,
          date: updated.date,
        },
        req,
      });
      log.info({ id: invoice.id }, "Invoice updated");
      const lines = await storage.getInvoiceLinesByInvoiceId(invoice.id);
      res.json({ ...updated, lines });
    })
  );

  // ── Delete (drafts / unposted only) ──────────────────────────────────────
  app.delete(
    "/api/invoices/:id",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const userId = userOf(req);
      const invoice = await findInvoiceForUser(userId, req.params.id);
      if (!invoice)
        return res.status(404).json({ message: "Invoice not found", code: "INVOICE_NOT_FOUND" });
      if (invoice.status !== "draft") {
        // Issued tax invoices keep the five-year retention rule and are voided, never deleted.
        assertRetentionExpired(
          invoice as { createdAt: Date | string; retentionExpiresAt?: Date | string | null },
          "Invoice"
        );
        throw new DomainError(
          "INVOICE_HAS_POSTED_JE",
          422,
          undefined,
          "An issued invoice cannot be deleted. Void it or issue a credit note instead."
        );
      }
      // X5 (J1 L4): a never-issued draft is not a tax record. It is deleted when that leaves
      // no gap in the number sequence, else cancelled (its number kept as cancelled).
      const removal = await removeDraftInvoice({
        invoiceId: invoice.id,
        companyId: invoice.companyId,
        userId,
      });
      await recordAudit({
        userId,
        companyId: invoice.companyId,
        action: removal.outcome === "deleted" ? "invoice.delete" : "invoice.draft_cancelled",
        entityType: "invoice",
        entityId: invoice.id,
        before: { number: invoice.number, status: invoice.status, total: invoice.total },
        after: removal.outcome === "deleted" ? null : { status: "cancelled" },
        req,
      });
      res.json({
        outcome: removal.outcome,
        message:
          removal.outcome === "deleted"
            ? "Draft invoice deleted"
            : "Draft invoice cancelled: later invoices already use the next numbers, so its number is kept as cancelled to avoid a gap.",
      });
    })
  );

  // ── Status: issue / void / cancel (state machine) ────────────────────────
  app.patch(
    "/api/invoices/:id/status",
    authMiddleware,
    requireCustomer,
    strictBody(invoiceStatusSchema, { allowServerOwned: ["status"] }),
    asyncHandler(async (req: Request, res: Response) => {
      const userId = userOf(req);
      const { status, reason } = req.body as z.output<typeof invoiceStatusSchema>;
      const invoice = await findInvoiceForUser(userId, req.params.id);
      if (!invoice)
        return res.status(404).json({ message: "Invoice not found", code: "INVOICE_NOT_FOUND" });
      const oldStatus = invoice.status;

      if (status === "paid" || status === "partial") {
        throw new DomainError(
          "USE_PAYMENT_ENDPOINT",
          422,
          { endpoint: "POST /api/companies/:companyId/invoices/:invoiceId/payments" },
          "An invoice becomes paid by recording a payment against a cash or bank account, not by changing its status."
        );
      }
      if (!["sent", "posted", "void", "cancelled", "draft"].includes(status)) {
        return res.status(400).json({
          message: "Invalid status. Must be one of: sent, posted, void, cancelled",
          code: "INVALID_STATUS",
        });
      }
      if (invoice.invoiceType === "credit_note") {
        throw new DomainError(
          "USE_CREDIT_NOTE_ENDPOINT",
          422,
          undefined,
          "Void a credit note through POST /api/credit-notes/:id/void."
        );
      }

      let updated: Invoice = invoice;
      if (status === oldStatus) {
        // No-op transition.
      } else if (status === "sent" || status === "posted") {
        if (oldStatus !== "draft") {
          return res.status(422).json({
            message: `Invalid invoice status transition: ${oldStatus} → ${status}`,
            code: "INVALID_TRANSITION",
            allowed: { from: oldStatus, to: status },
          });
        }
        await assertPeriodNotLocked(invoice.companyId, invoice.date);
        assertNotFutureDate(invoice.date);
        const result = await issueInvoice(invoice.id, invoice.companyId, userId, status);
        updated = result.invoice;
        if (!result.alreadyIssued) {
          emitDomainEvent("invoice.issued", {
            companyId: invoice.companyId,
            entityId: invoice.id,
            number: invoice.number,
            totalFils: toFils(invoice.total, { rounding: "halfUp" }),
            actorUserId: userId,
          });
        }
      } else if (status === "void" || status === "cancelled") {
        const result = await voidInvoice(invoice.id, invoice.companyId, userId, status, reason);
        updated = result.invoice;
        emitDomainEvent("invoice.voided", {
          companyId: invoice.companyId,
          entityId: invoice.id,
          reason: reason ?? status,
          actorUserId: userId,
        });
      } else {
        return res.status(422).json({
          message: `Invalid invoice status transition: ${oldStatus} → ${status}`,
          code: "INVALID_TRANSITION",
          allowed: { from: oldStatus, to: status },
        });
      }

      await recordAudit({
        userId,
        companyId: invoice.companyId,
        action: "invoice.status_change",
        entityType: "invoice",
        entityId: invoice.id,
        before: { status: oldStatus },
        after: { status: updated.status },
        req,
      });
      if (updated.status !== oldStatus && updated.status === "void") {
        createAndEmitNotification({
          userId,
          companyId: invoice.companyId,
          type: "invoice_status_change",
          ...notificationCopy(
            "notification.invoiceVoid.title",
            "notification.invoiceVoid.message",
            {
              number: invoice.number,
              customer: invoice.customerName,
            }
          ),
          priority: "normal",
          relatedEntityType: "invoice",
          relatedEntityId: invoice.id,
          actionUrl: "/invoices",
        }).catch(() => {});
      }
      res.json(updated);
    })
  );

  // ── Payments ─────────────────────────────────────────────────────────────
  app.get(
    "/api/companies/:companyId/invoices/:invoiceId/payments",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId, invoiceId } = req.params;
      await assertCompanyAccess(req, companyId);
      const invoice = await storage.getInvoice(invoiceId, companyId);
      if (!invoice)
        return res.status(404).json({ message: "Invoice not found", code: "INVOICE_NOT_FOUND" });
      res.json(await storage.getInvoicePaymentsByInvoiceId(invoiceId));
    })
  );

  app.post(
    "/api/companies/:companyId/invoices/:invoiceId/payments",
    authMiddleware,
    requireCustomer,
    strictBody(invoicePaymentSchema),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId, invoiceId } = req.params;
      const userId = userOf(req);
      await assertCompanyAccess(req, companyId);
      const body = validated<z.output<typeof invoicePaymentSchema>>(req);
      const paymentDate = body.date
        ? toDate(body.date)
        : toDate(todayDubai());
      const invoice = await storage.getInvoice(invoiceId, companyId);
      if (!invoice)
        return res.status(404).json({ message: "Invoice not found", code: "INVOICE_NOT_FOUND" });
      await assertPeriodNotLocked(companyId, paymentDate);
      const amount = Number(fromFils(body.amount));
      const result = await recordInvoicePayment({
        invoiceId,
        companyId,
        amount,
        date: paymentDate,
        method: body.method || "bank",
        reference: body.reference ?? null,
        notes: body.notes ?? null,
        paymentAccountId: body.paymentAccountId,
        paymentExchangeRate: body.exchangeRate ?? null,
        createdBy: userId,
        allowCredit: body.allowCredit === true,
      });
      await recordAudit({
        userId,
        companyId,
        action: "invoice.payment",
        entityType: "invoice",
        entityId: invoiceId,
        before: { status: invoice.status, totalPaid: result.totalPaid - amount },
        after: { status: result.invoice.status, totalPaid: result.totalPaid },
        req,
        extra: {
          paymentId: result.payment.id,
          amount,
          method: body.method || "bank",
          journalEntryId: result.journalEntryId,
        },
      });
      res.status(201).json({
        payment: result.payment,
        totalPaid: result.totalPaid,
        status: result.invoice.status,
        // C2 (NL8): the Art. 64(3) reversal of any bad-debt relief on this invoice.
        ...("badDebtReliefReversal" in result
          ? { badDebtReliefReversal: result.badDebtReliefReversal }
          : {}),
      });
    })
  );

  // ── Bad-debt write-off and allowance for doubtful debts (A3: H1, M5) ─────
  app.post(
    "/api/companies/:companyId/invoices/:invoiceId/write-off",
    authMiddleware,
    requireCustomer,
    strictBody(invoiceWriteOffSchema),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId, invoiceId } = req.params;
      const userId = userOf(req);
      await assertCompanyAccess(req, companyId);
      const body = validated<z.output<typeof invoiceWriteOffSchema>>(req);
      const invoice = await storage.getInvoice(invoiceId, companyId);
      if (!invoice)
        return res.status(404).json({ message: "Invoice not found", code: "INVOICE_NOT_FOUND" });
      await assertPeriodNotLocked(companyId, toDate(body.date));
      assertNotFutureDate(toDate(body.date));
      const result = await writeOffInvoice({
        companyId,
        invoiceId,
        date: body.date,
        amountFils: body.amount ?? null,
        against: body.against ?? "expense",
        reason: body.reason,
        userId,
      });
      await recordAudit({
        userId,
        companyId,
        action: "invoice.write_off",
        entityType: "invoice",
        entityId: invoiceId,
        before: { status: invoice.status },
        after: { status: result.invoice?.status },
        req,
        extra: {
          writeOffId: result.writeOff.id,
          amount: result.amount,
          journalEntryId: result.journalEntryId,
          reason: body.reason,
        },
      });
      res.status(201).json(result);
    })
  );

  app.post(
    "/api/companies/:companyId/invoices/:invoiceId/write-off/reinstate",
    authMiddleware,
    requireCustomer,
    strictBody(invoiceWriteOffReinstateSchema),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId, invoiceId } = req.params;
      const userId = userOf(req);
      await assertCompanyAccess(req, companyId);
      const body = validated<z.output<typeof invoiceWriteOffReinstateSchema>>(req);
      const invoice = await storage.getInvoice(invoiceId, companyId);
      if (!invoice)
        return res.status(404).json({ message: "Invoice not found", code: "INVOICE_NOT_FOUND" });
      await assertPeriodNotLocked(companyId, toDate(body.date));
      const result = await reinstateWriteOffs({
        companyId,
        invoiceId,
        date: body.date,
        reason: body.reason,
        userId,
      });
      if (result.reinstatedFils === 0) {
        throw new DomainError("NO_WRITE_OFF", 409, undefined, "This invoice has no write-off.");
      }
      await recordAudit({
        userId,
        companyId,
        action: "invoice.write_off_reinstate",
        entityType: "invoice",
        entityId: invoiceId,
        before: { status: invoice.status },
        after: { status: result.invoice?.status },
        req,
        extra: { amount: Number(fromFils(result.reinstatedFils)), reason: body.reason },
      });
      res.json({
        reinstated: Number(fromFils(result.reinstatedFils)),
        status: result.invoice?.status ?? invoice.status,
      });
    })
  );

  app.get(
    "/api/companies/:companyId/receivables/allowance",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      await assertCompanyAccess(req, companyId);
      const asOf =
        typeof req.query.asOf === "string" && /^\d{4}-\d{2}-\d{2}$/.test(req.query.asOf)
          ? req.query.asOf
          : null;
      res.json(await getDoubtfulDebtAllowance(companyId, asOf));
    })
  );

  app.post(
    "/api/companies/:companyId/receivables/allowance",
    authMiddleware,
    requireCustomer,
    strictBody(doubtfulDebtAllowanceSchema),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const userId = userOf(req);
      await assertCompanyAccess(req, companyId);
      const body = validated<z.output<typeof doubtfulDebtAllowanceSchema>>(req);
      await assertPeriodNotLocked(companyId, toDate(body.date));
      assertNotFutureDate(toDate(body.date));
      const result = await setDoubtfulDebtAllowance({
        companyId,
        date: body.date,
        targetFils: body.targetBalance,
        memo: body.memo ?? null,
        userId,
      });
      await recordAudit({
        userId,
        companyId,
        action: "receivables.allowance",
        entityType: "account",
        entityId: result.journalEntryId,
        after: result,
        req,
      });
      res.status(201).json(result);
    })
  );

  // ── Credit notes (R03-01, R03-04, R03-08, R03-22) ────────────────────────
  app.post(
    "/api/companies/:companyId/invoices/:invoiceId/credit-note",
    authMiddleware,
    requireCustomer,
    strictBody(creditNoteRequestSchema),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId, invoiceId } = req.params;
      const userId = userOf(req);
      await assertCompanyAccess(req, companyId);
      const body = validated<z.output<typeof creditNoteRequestSchema>>(req);
      const original = await storage.getInvoice(invoiceId, companyId);
      if (!original)
        return res.status(404).json({ message: "Invoice not found", code: "INVOICE_NOT_FOUND" });
      const cnDate = body.date ?? todayDubai();
      await assertPeriodNotLocked(companyId, toDate(cnDate));
      const lines = body.lines ? toCreditLines(body.lines, original) : undefined;
      const result = await createAndIssueCreditNote({
        invoiceId,
        companyId,
        userId,
        lines,
        restock: body.restock,
        date: cnDate,
        reason: body.reason,
      });
      await recordAudit({
        userId,
        companyId,
        action: "invoice.credit_note",
        entityType: "invoice",
        entityId: result.creditNote.id,
        before: { originalInvoiceId: invoiceId, originalNumber: original.number },
        after: {
          creditNoteNumber: result.creditNote.number,
          total: result.creditNote.total,
          currency: result.creditNote.currency,
          customerCreditId: result.customerCreditId,
        },
        req,
      });
      emitDomainEvent("credit_note.issued", {
        companyId,
        entityId: result.creditNote.id,
        invoiceId,
        totalFils: toFils(-result.creditNote.total, { rounding: "halfUp" }),
        actorUserId: userId,
      });
      res.status(201).json({
        ...result.creditNote,
        journalEntryId: result.journalEntryId,
        customerCredit: result.customerCreditId
          ? { id: result.customerCreditId, amount: fromFils(result.customerCreditFils) }
          : null,
      });
    })
  );

  // ── Debit notes (R03-21): an additional charge on an issued invoice ──────
  app.post(
    "/api/companies/:companyId/invoices/:invoiceId/debit-note",
    authMiddleware,
    requireCustomer,
    strictBody(debitNoteRequestSchema),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId, invoiceId } = req.params;
      const userId = userOf(req);
      await assertCompanyAccess(req, companyId);
      const body = validated<z.output<typeof debitNoteRequestSchema>>(req);
      const dnDate = toDate(body.date ?? todayDubai());
      const { invoice: dn, totalFils } = await withLedgerTx(async (tx) => {
        const original = await lockInvoice(tx, invoiceId, companyId);
        if (original.invoiceType !== "invoice" || !isIssuedStatus(original.status)) {
          throw new DomainError(
            "INVOICE_NOT_ISSUED",
            409,
            undefined,
            "A debit note needs an issued invoice."
          );
        }
        await lockPeriodPolicy(tx, companyId, "shared");
        await assertPeriodNotLocked(companyId, dnDate, tx);
        const { rows, totals } = prepareSalesLines(body.lines.map(lineDraft), {
          reverseCharge: original.reverseCharge,
        });
        const rate = Number(original.exchangeRate) || 1;
        const number = await allocateInvoiceNumber(companyId, "debit_note", dnDate, tx);
        const [inserted] = await tx
          .insert(invoicesTable)
          .values({
            companyId,
            number,
            customerName: original.customerName,
            customerTrn: original.customerTrn,
            customerAddress: original.customerAddress,
            contactId: original.contactId,
            date: dnDate,
            dueDate: original.dueDate,
            paymentTerms: original.paymentTerms,
            currency: original.currency,
            exchangeRate: rate,
            baseCurrencyAmount: Number(fromFils(mulRate(totals.totalFils || 0, rate) || 0)),
            subtotal: Number(fromFils(totals.subtotalFils)),
            vatAmount: Number(fromFils(totals.vatFils)),
            total: Number(fromFils(totals.totalFils)),
            discountAmount: Number(fromFils(totals.discountFils)),
            reverseCharge: original.reverseCharge,
            placeOfSupplyEmirate: original.placeOfSupplyEmirate,
            notes: body.reason ?? null,
            status: "draft",
            invoiceType: "debit_note",
            originalInvoiceId: original.id,
          })
          .returning();
        for (const r of rows) await tx.insert(invoiceLinesTable).values(lineRow(inserted.id, r));
        // A debit note is a tax document. Commit its issuance and revenue with the draft and number.
        const issued = await issueInvoiceInTx(tx, inserted.id, companyId, userId, "sent");
        return { invoice: issued.invoice, totalFils: totals.totalFils };
      });
      await recordAudit({
        userId,
        companyId,
        action: "invoice.debit_note",
        entityType: "invoice",
        entityId: dn.id,
        before: { originalInvoiceId: invoiceId },
        after: { number: dn.number, total: dn.total },
        req,
      });
      emitDomainEvent("invoice.issued", {
        companyId,
        entityId: dn.id,
        number: dn.number,
        totalFils,
        actorUserId: userId,
      });
      res.status(201).json(dn);
    })
  );

  // ── Delivery note PDF (R03-24) ───────────────────────────────────────────
  app.get(
    "/api/invoices/:id/delivery-note",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const invoice = await findInvoiceForUser(userOf(req), req.params.id);
      if (!invoice || invoice.invoiceType === "credit_note") {
        return res.status(404).json({ message: "Invoice not found", code: "INVOICE_NOT_FOUND" });
      }
      const lines = await storage.getInvoiceLinesByInvoiceId(invoice.id);
      const company = await storage.getCompany(invoice.companyId);
      if (!company)
        return res.status(404).json({ message: "Company not found", code: "COMPANY_NOT_FOUND" });
      const pdf = await generateDeliveryNotePDF(invoice, lines, company);
      res.set({
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="delivery-note-${invoice.number}.pdf"`,
        "Content-Length": pdf.length.toString(),
      });
      res.send(pdf);
    })
  );

  // ── Customer credits (R03-08, R03-21) ────────────────────────────────────
  app.get(
    "/api/companies/:companyId/customer-credits",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      await assertCompanyAccess(req, companyId);
      const status = typeof req.query.status === "string" ? req.query.status : undefined;
      res.json(await listCustomerCredits(companyId, status));
    })
  );

  app.post(
    "/api/companies/:companyId/customer-credits/:creditId/apply",
    authMiddleware,
    requireCustomer,
    strictBody(applyCustomerCreditSchema),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId, creditId } = req.params;
      const userId = userOf(req);
      await assertCompanyAccess(req, companyId);
      const body = validated<z.output<typeof applyCustomerCreditSchema>>(req);
      const date = body.date ?? todayDubai();
      await assertPeriodNotLocked(companyId, toDate(date));
      const result = await applyCustomerCredit({
        companyId,
        creditId,
        invoiceId: body.invoiceId,
        amountFils: body.amount,
        date,
        userId,
      });
      await recordAudit({
        userId,
        companyId,
        action: "customer_credit.apply",
        entityType: "customer_credit",
        entityId: creditId,
        before: null,
        after: { invoiceId: body.invoiceId, amount: fromFils(body.amount) },
        req,
      });
      res.status(201).json({ ...result, status: result.invoice?.status });
    })
  );

  app.post(
    "/api/companies/:companyId/customer-credits/:creditId/refund",
    authMiddleware,
    requireCustomer,
    strictBody(refundCustomerCreditSchema),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId, creditId } = req.params;
      const userId = userOf(req);
      await assertCompanyAccess(req, companyId);
      const body = validated<z.output<typeof refundCustomerCreditSchema>>(req);
      const date = body.date ?? todayDubai();
      await assertPeriodNotLocked(companyId, toDate(date));
      const result = await refundCustomerCredit({
        companyId,
        creditId,
        amountFils: body.amount,
        date,
        paymentAccountId: body.paymentAccountId,
        exchangeRate: body.exchangeRate ?? null,
        reference: body.reference ?? null,
        userId,
      });
      await recordAudit({
        userId,
        companyId,
        action: "customer_credit.refund",
        entityType: "customer_credit",
        entityId: creditId,
        before: null,
        after: { amount: fromFils(body.amount), paymentAccountId: body.paymentAccountId },
        req,
      });
      res.status(201).json(result);
    })
  );

  // ── Customer deposits / advances (A4: M1, FDL 8/2017 Art. 25-26) ─────────
  // VAT is due on receipt; the deposit becomes a customer credit applied to the final invoice
  // (POST customer-credits/:creditId/apply) or refunded, reversing its VAT share.
  app.get(
    "/api/companies/:companyId/customer-deposits",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      await assertCompanyAccess(req, companyId);
      res.json(await listCustomerDeposits(companyId));
    })
  );

  app.post(
    "/api/companies/:companyId/customer-deposits",
    authMiddleware,
    requireCustomer,
    strictBody(createCustomerDepositSchema),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const userId = userOf(req);
      await assertCompanyAccess(req, companyId);
      const body = validated<z.output<typeof createCustomerDepositSchema>>(req);
      await assertPeriodNotLocked(companyId, toDate(body.date));
      const result = await createCustomerDeposit({
        companyId,
        userId,
        contactId: body.contactId ?? null,
        customerName: body.customerName ?? null,
        customerTrn: body.customerTrn ?? null,
        date: body.date,
        amountFils: body.amount,
        vatTreatment: body.vatTreatment,
        paymentAccountId: body.paymentAccountId,
        reference: body.reference ?? null,
        description: body.description ?? null,
      });
      await recordAudit({
        userId,
        companyId,
        action: "customer_deposit.create",
        entityType: "customer_deposit",
        entityId: result.deposit.id,
        before: null,
        after: {
          amount: fromFils(body.amount),
          vatTreatment: body.vatTreatment,
          journalEntryId: result.journalEntryId,
        },
        req,
      });
      res.status(201).json(result);
    })
  );
}

/** Validated credit-note lines → posting input (supply types resolved, R07-01). */
export function toCreditLines(
  lines: SalesLineInput[],
  original: Pick<Invoice, "reverseCharge">
): CreditNoteLineInput[] {
  const { rows } = prepareSalesLines(lines.map(lineDraft), {
    reverseCharge: original.reverseCharge,
  });
  return rows.map((r) => ({
    description: r.description,
    quantity: r.quantity,
    unitPriceFils: r.unitPriceFils,
    vatRate: r.vatRate,
    vatSupplyType: r.vatSupplyType,
    discountType: r.discountType,
    discountValue: r.discountValue,
    productId: r.productId,
    costCenterId: r.costCenterId,
  }));
}

/**
 * Fields of an UPDATE body that would change an issued invoice. A field sent
 * with its stored value is not a change, so a client re-sending the full form
 * to edit the notes is accepted.
 */
async function changedIssuedFields(invoice: Invoice, body: UpdateInvoiceInput): Promise<string[]> {
  const allowed = new Set<string>(EDITABLE_AFTER_ISSUE);
  const changed: string[] = [];
  const same = (a: unknown, b: unknown) =>
    (a ?? null) === (b ?? null) || String(a ?? "") === String(b ?? "");
  const compare: Record<string, unknown> = {
    contactId: invoice.contactId,
    customerName: invoice.customerName,
    customerTrn: invoice.customerTrn,
    customerAddress: invoice.customerAddress,
    date: isoOf(invoice.date),
    supplyDate: isoOf(invoice.supplyDate),
    currency: invoice.currency,
    exchangeRate: Number(invoice.exchangeRate),
    reverseCharge: invoice.reverseCharge,
    placeOfSupplyEmirate: invoice.placeOfSupplyEmirate,
    discountType: invoice.discountType,
    discountValue: invoice.discountValue,
    templateId: invoice.templateId,
  };
  for (const [key, value] of Object.entries(body)) {
    if (value === undefined || allowed.has(key)) continue;
    if (key === "lines") {
      const stored = await storage.getInvoiceLinesByInvoiceId(invoice.id);
      const sig = (l: {
        description: string;
        quantity: number;
        unitPriceFils: number;
        vatRate: number;
        vatSupplyType: string | null;
        discountType: string | null;
        discountValue: number | null;
      }) =>
        [
          l.description,
          Number(l.quantity),
          l.unitPriceFils,
          Number(l.vatRate),
          l.vatSupplyType ?? "",
          l.discountType ?? "",
          l.discountValue ?? "",
        ].join("|");
      const a = stored.map((l) =>
        sig({
          description: l.description,
          quantity: Number(l.quantity),
          unitPriceFils: toFils(l.unitPrice, { rounding: "halfUp" }),
          vatRate: Number(l.vatRate),
          vatSupplyType: l.vatSupplyType ?? null,
          discountType: l.discountType ?? null,
          discountValue: l.discountValue ?? null,
        })
      );
      const b = (value as SalesLineInput[]).map((l) =>
        sig({
          description: l.description,
          quantity: l.quantity,
          unitPriceFils: l.unitPrice,
          vatRate: l.vatRate ?? 0.05,
          vatSupplyType:
            l.vatSupplyType ?? (Number(l.vatRate ?? 0.05) > 0 ? "standard_rated" : null),
          discountType: l.discountType ?? null,
          discountValue: l.discountValue ?? null,
        })
      );
      if (a.join("\n") !== b.join("\n")) changed.push("lines");
      continue;
    }
    if (!(key in compare) || !same(value, compare[key])) changed.push(key);
  }
  return changed;
}
