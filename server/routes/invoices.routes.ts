import { Router, type Express, type Request, type Response } from "express";
import crypto from "crypto";
import { storage } from "../storage";
import { z } from "zod";
import { authMiddleware, requireCustomer } from "../middleware/auth";
import { asyncHandler } from "../middleware/errorHandler";
import { checkUsageLimit } from "../middleware/featureGate";
import { insertInvoiceSchema, type Invoice } from "../../shared/schema";
import { generateInvoicePDF } from "../services/pdf-invoice.service";
import { generateDeliveryNotePDF } from "../services/pdf-delivery-note.service";
import { generateEInvoiceXML, validateForEInvoicing } from "../services/einvoice.service";
import { resolveEInvoiceContext } from "../services/einvoice-context";
import { getEInvoiceProvider } from "../services/einvoice-provider";
import { withDocumentLock, LOCK_NS } from "../services/document-lock";
import { submitEInvoice, refreshEInvoiceStatus } from "../services/einvoice-submit.service";
import {
  assertEmailSent,
  emailStatus,
  EMAIL_NOT_CONFIGURED_MESSAGE,
  sendInvoiceEmail,
  sendPaymentReminderEmail,
} from "../services/email.service";
import { createAndEmitNotification } from "../services/socket.service";
import { db } from "../db";
import { invoices as invoicesTable, journalEntries as journalEntriesTable } from "../../shared/schema";
import { and, eq } from "drizzle-orm";
import { assertPeriodNotLocked } from "../services/period-lock.service";
import { resolveSettlementDate } from "../services/payment-date-guard.service";
import { canTransition, isTerminal, isValidStatus } from "../services/invoice-state-machine";
import { postInvoiceRevenueJournal } from "../services/invoice-posting.service";
import { issueInvoice } from "../services/invoice-issue.service";
import {
  checkProductsForCompany,
  postCogsForInvoice,
} from "../services/inventory-costing.service";
import { getInvoiceBalance, loadInvoiceBalances } from "../services/invoice-outstanding.db";
import { invoiceBalanceFields } from "../services/invoice-outstanding";
import { voidOrCancelInvoice, alreadyTerminalOutcome } from "../services/invoice-void.service";
import { checkRevenueAccountsForCompany } from "../services/revenue-account-guard.service";
import { resolveInvoiceFx } from "../services/invoice-fx";
import { checkPostedInvoiceEdit } from "../services/posted-invoice-lock.service";
import { recordAudit } from "../services/audit.service";
import { createLogger } from "../config/logger";
import { ACCOUNT_CODES } from "../constants";
import { allocateInvoiceNumber, peekNextInvoiceNumber } from "../services/invoice-numbering.service";
import { assertRetentionExpired } from "../services/retention.service";
import { resolveDocumentExchangeRate } from "../services/document-fx-rate";
import {
  INVOICE_WRITABLE_FIELDS,
  documentDiscountSchema,
  pickWritable,
} from "../services/sales-input";
import {
  accountIdForDerived,
  checkContactForCompany,
  itemsSubtotalOf,
  loadAdvanceDeductions,
  replaceInvoiceLines,
  resolveSalesAccounts,
  type SalesLineSource,
} from "../services/sales-lines.service";
import { deriveSalesLines } from "../../shared/sales-line-math";
import { AppError } from "../errors";
import { parseCalendarDay } from "../utils/date";
import { parseEmirateInput } from "../utils/emirate";
import { checkPriceListsForCompany } from "../services/price-list.service";
import { projectsBelongToCompany } from "../services/project.service";
import { loadAdvanceApplicationsForInvoice } from "../services/customer-advance.service";
import { refreshAdvanceStatus } from "../services/advance-ledger.service";
import { assertSalesOrderQuantitiesForEdit } from "../services/sales-order.service";
import { pdfFieldsFor } from "../services/custom-fields.service";
import { onlinePaymentView } from "../services/payment-gateway/checkout.service";
import { issueCreditNote, revenueContextOf } from "../services/credit-note-issue.service";
import { creditedQuantityByLine } from "../services/credit-note-remainder.service";
import {
  MAX_DOCUMENT_TOTAL,
  invoiceLinesInputSchema,
  type InvoiceLineInput,
} from "../services/invoice-line-schemas";

const log = createLogger("invoices");

// Walk the user's companies to find the invoice. Storage queries are
// tenant-scoped, so a hit also proves the user has access.
async function findInvoiceForUser(userId: string, invoiceId: string): Promise<Invoice | undefined> {
  // Resolve the record first, then authorise with the SAME access semantics
  // as the rest of the API (hasCompanyAccess covers direct membership, firm
  // owners, and assigned firm admins). The old membership-only walk let firm
  // owners create invoices in client companies they could never update.
  const invoice = await storage.getInvoiceById(invoiceId);
  if (!invoice) return undefined;
  const hasAccess = await storage.hasCompanyAccess(userId, invoice.companyId);
  return hasAccess ? invoice : undefined;
}

// Client lines -> the input of the line derivation (shared/sales-line-math.ts). A shipping line that names no
// VAT rate takes the dominant item rate, so the zod default (5%) must not be mistaken for a choice.
function toSalesInputs(parsed: InvoiceLineInput[], raw?: unknown): SalesLineSource[] {
  const rawLines: any[] = Array.isArray(raw) ? raw : [];
  return parsed.map((l, i) => {
    const rawRate = rawLines[i]?.vatRate;
    const noRate = l.lineKind === "shipping" && (rawRate === undefined || rawRate === null || rawRate === "");
    return {
      kind: l.lineKind === "shipping" ? "shipping" : "item",
      description: l.description,
      quantity: l.quantity,
      unitPrice: l.unitPrice,
      vatRate: (noRate ? undefined : l.vatRate) as number,
      vatSupplyType: l.vatSupplyType,
      discountType: l.lineKind === "shipping" ? null : (l.discountType ?? null),
      discountValue: l.lineKind === "shipping" ? null : (l.discountValue ?? null),
      revenueAccountId: l.revenueAccountId ?? null,
      productId: l.productId ?? null,
      priceListId: l.lineKind === "shipping" ? null : ((l as any).priceListId ?? null),
      salesOrderLineId: (l as any).salesOrderLineId ?? null,
      // undefined (not sent) is kept distinct from null (cleared): an update carries the old line's project over.
      projectId: (l as any).projectId,
    };
  });
}

// What the Phase 8 lines store besides the derived columns: the price list a unit price came from, and the sales
// order line a line bills (the latter only on an invoice that was made from that order).
// `previousProjects` (an update) holds the project of each old client line by position, used when a line sends none.
const lineExtras = (allowSalesOrderLine: boolean, previousProjects: Array<string | null> = []) => (source: SalesLineSource, index = 0) => ({
  priceListId: source.priceListId ?? null,
  salesOrderLineId: allowSalesOrderLine ? (source.salesOrderLineId ?? null) : null,
  projectId: (source as any).projectId !== undefined ? ((source as any).projectId ?? null) : (previousProjects[index] ?? null),
});

function normalizeOptionalInvoiceDateField(
  data: Record<string, any>,
  field: "dueDate"
): { ok: true } | { ok: false; message: string } {
  if (data[field] === undefined) return { ok: true };
  if (data[field] === null || data[field] === "") {
    data[field] = null;
    return { ok: true };
  }

  const parsed = parseCalendarDay(data[field]);
  if (!parsed) {
    return { ok: false, message: `Invalid invoice ${field}` };
  }
  data[field] = parsed;
  return { ok: true };
}

export function registerInvoiceRoutes(app: Express) {
  // =====================================
  // Invoice Routes
  // =====================================

  // Customer-only: Full bookkeeping invoices (clients use simplified portal)
  app.get(
    "/api/companies/:companyId/invoices",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const userId = (req as any).user.id;

      // Verify company access
      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: "Access denied" });
      }

      // Use the trimmed projection so list responses don't carry full UBL XML
      // (einvoice_xml can be 10-50KB per row). The detail endpoint pulls the
      // full record on demand. limit/offset accept optional pagination.
      const limit = Math.min(Number(req.query.limit) || 1000, 1000);
      const offset = Math.max(Number(req.query.offset) || 0, 0);
      const invoices = await storage.getInvoicesSummaryByCompanyId(companyId, { limit, offset });
      // Outstanding amount and credited flag come from the one shared
      // definition (total - payments - credit notes), never from status alone.
      const balances = await loadInvoiceBalances(companyId);
      res.json(invoices.map((inv) => ({ ...inv, ...invoiceBalanceFields(inv, balances.get(inv.id)) })));
    })
  );

  // Customer-only: Get single invoice
  app.get(
    "/api/invoices/:id",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { id } = req.params;
      const userId = (req as any).user.id;

      const invoice = await findInvoiceForUser(userId, id);

      if (!invoice) {
        return res.status(404).json({ message: "Invoice not found" });
      }

      // Fetch invoice lines
      const lines = await storage.getInvoiceLinesByInvoiceId(id);
      const balance = await getInvoiceBalance(invoice.companyId, id);

      const advanceApplications = await loadAdvanceApplicationsForInvoice(invoice.companyId, id);
      // Quantity already credited per line by LIVE credit notes only (a voided credit note credits nothing).
      let creditedByLine: Record<string, number> = {};
      if (invoice.invoiceType !== "credit_note") {
        const notes = (
          await db
            .select()
            .from(invoicesTable)
            .where(and(eq(invoicesTable.companyId, invoice.companyId), eq(invoicesTable.originalInvoiceId, id), eq(invoicesTable.invoiceType, "credit_note")))
        ).filter((c: any) => c.status !== "void" && c.status !== "cancelled");
        if (notes.length > 0) {
          const ctx = revenueContextOf(await storage.getAccountsByCompanyId(invoice.companyId));
          if (ctx) {
            const creditedLines = (await Promise.all(notes.map((c: any) => storage.getInvoiceLinesByInvoiceId(c.id)))).flat();
            creditedByLine = creditedQuantityByLine({ originalLines: lines as any[], creditedLines: creditedLines as any[], ctx });
          }
        }
      }
      res.json({
        ...invoice,
        ...invoiceBalanceFields(invoice, balance),
        itemsSubtotal: itemsSubtotalOf(lines),
        advanceApplications,
        creditedByLine,
        lines,
      });
    })
  );

  // Check for similar invoices
  // Customer-only: Check for similar invoices
  app.post(
    "/api/companies/:companyId/invoices/check-similar",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const userId = (req as any).user.id;
      const { customerName, total, date } = req.body;

      // Check if user has access to this company
      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: "Access denied" });
      }

      const invoices = await storage.getInvoicesByCompanyId(companyId);

      // Find similar invoices
      const similarInvoices = invoices.filter((invoice) => {
        // Check if customer name is similar (case-insensitive partial match)
        const customerMatch =
          (customerName &&
            invoice.customerName &&
            invoice.customerName.toLowerCase().includes(customerName.toLowerCase())) ||
          customerName.toLowerCase().includes(invoice.customerName?.toLowerCase() || "");

        // Check if total is within 10% range
        const amountMatch = total && invoice.total && Math.abs(invoice.total - total) / total < 0.1;

        // Check if date is within 7 days
        let dateMatch = false;
        if (date && invoice.date) {
          const checkDate = new Date(date);
          const invoiceDate = new Date(invoice.date);
          const daysDiff = Math.abs(
            (checkDate.getTime() - invoiceDate.getTime()) / (1000 * 60 * 60 * 24)
          );
          dateMatch = daysDiff <= 7;
        }

        // Return if at least 2 criteria match
        const matchCount = [customerMatch, amountMatch, dateMatch].filter(Boolean).length;
        return matchCount >= 2;
      });

      res.json({
        hasSimilar: similarInvoices.length > 0,
        similarInvoices: similarInvoices.slice(0, 5).map((invoice) => ({
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

  // Peek next invoice/credit-note number — for UI display before save. Does
  // not allocate, so it is safe to call from a draft form.
  app.get(
    "/api/companies/:companyId/invoices/next-number",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const userId = (req as any).user.id;
      const docType = (req.query.docType === "credit_note" ? "credit_note" : "invoice") as
        | "invoice"
        | "credit_note";

      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) return res.status(403).json({ message: "Access denied" });

      const number = await peekNextInvoiceNumber(companyId, docType);
      res.json({ number, docType });
    })
  );

  // Customer-only: Create invoices
  app.post(
    "/api/companies/:companyId/invoices",
    authMiddleware,
    requireCustomer,
    checkUsageLimit("invoices"),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const userId = (req as any).user.id;
      const { lines, date } = req.body;
      // Allow-list: invoiceType, status, isOpeningBalance, salesOrderId, lateFeeForInvoiceId, totals and
      // every other server-owned column can never be set from a request body (mass assignment).
      const invoiceData: Record<string, any> = pickWritable(req.body, INVOICE_WRITABLE_FIELDS);
      const parsedLines = invoiceLinesInputSchema.parse(lines);
      const documentDiscount = documentDiscountSchema.parse(req.body);

      // Check if user has access to this company
      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: "Access denied" });
      }
      const contactCheck = await checkContactForCompany(companyId, invoiceData.contactId);
      if (!contactCheck.ok) {
        return res.status(422).json({ message: contactCheck.message, code: contactCheck.code });
      }
      // The recipient's TRN and address are part of a tax invoice (Art. 59): take them from the contact when the caller
      // sent none, so every invoice carries them whichever screen made it.
      if (invoiceData.contactId && (!invoiceData.customerTrn || !invoiceData.customerAddress)) {
        const contactRow = await storage.getCustomerContact(invoiceData.contactId);
        if (contactRow && contactRow.companyId === companyId) {
          if (!invoiceData.customerTrn && contactRow.trnNumber) invoiceData.customerTrn = contactRow.trnNumber;
          const parts = [contactRow.address, contactRow.city, contactRow.country].map((x) => (x ?? "").trim()).filter(Boolean);
          if (!invoiceData.customerAddress && parts.length) invoiceData.customerAddress = parts.join(", ");
        }
      }

      // Place of supply (VAT 201 box 1): the body's emirate, else the contact's; none = the company's own emirate.
      {
        const em = parseEmirateInput(invoiceData.emirate);
        if (!em.ok) return res.status(422).json({ message: em.message, code: em.code });
        let emirate = em.value ?? null;
        if (emirate === null && em.value === undefined && invoiceData.contactId) {
          const contactRow = await storage.getCustomerContact(invoiceData.contactId);
          if (contactRow && contactRow.companyId === companyId) emirate = (contactRow as any).emirate ?? null;
        }
        invoiceData.emirate = emirate;
      }

      // Chosen revenue accounts must be income accounts of THIS company.
      const revenueCheck = await checkRevenueAccountsForCompany(
        companyId,
        parsedLines.map((l) => l.revenueAccountId)
      );
      if (!revenueCheck.ok) {
        return res.status(revenueCheck.status).json({ message: revenueCheck.message, code: revenueCheck.code });
      }
      const productCheck = await checkProductsForCompany(companyId, parsedLines.map((l) => l.productId));
      if (!productCheck.ok) {
        return res.status(productCheck.status).json({ message: productCheck.message, code: productCheck.code });
      }
      if (!(await projectsBelongToCompany(companyId, parsedLines.map((l) => (l as any).projectId)))) {
        return res.status(400).json({ message: "A line names a project that does not belong to this company.", code: "INVALID_PROJECT" });
      }
      const priceListCheck = await checkPriceListsForCompany(companyId, parsedLines.map((l) => (l as any).priceListId));
      if (!priceListCheck.ok) {
        return res.status(422).json({ message: priceListCheck.message, code: priceListCheck.code });
      }

      // Item and shipping lines come from the client; discounts are DERIVED by the server as signed lines
      // (shared/sales-line-math.ts), so the stored lines, the totals and every VAT engine agree.
      const salesInputs = toSalesInputs(parsedLines, lines);
      if (!salesInputs.some((l) => l.kind === "item")) {
        return res.status(400).json({ message: "At least one invoice line is required" });
      }
      const derived = deriveSalesLines({
        lines: salesInputs,
        discountType: documentDiscount.discountType,
        discountValue: documentDiscount.discountValue,
      });
      if (!derived.ok) {
        return res.status(422).json({ message: derived.message, code: derived.code });
      }
      const { subtotal, vatAmount, total } = derived;

      // The per-line caps above bound each factor; this bounds their product,
      // which is what actually has to fit numeric(15,2). Without it, a large
      // quantity x price overflowed the column and surfaced as an HTTP 500.
      if (!Number.isFinite(total) || Math.abs(total) > MAX_DOCUMENT_TOTAL) {
        return res.status(422).json({
          message: `Invoice total is too large to record (limit ${MAX_DOCUMENT_TOTAL.toLocaleString()}).`,
          code: "AMOUNT_OUT_OF_RANGE",
        });
      }

      // Convert date string to Date object if it's a string
      // The document-date contract (utils/date.ts parseCalendarDay): "YYYY-MM-DD" or an ISO instant, stored as the UAE day.
      const invoiceDate = parseCalendarDay(date);
      if (!invoiceDate) {
        return res.status(400).json({ message: "Invalid invoice date" });
      }
      // A tax invoice records a supply that has happened. Forward-dating pushes
      // revenue and output VAT into a period that has not occurred, so the
      // figure lands in a future VAT return and silently disappears from the
      // current one. Backdating into a locked period was already blocked; this
      // closes the other end. One day of tolerance covers timezone skew between
      // the client's clock and the server.
      const invoiceDayEnd = new Date();
      invoiceDayEnd.setUTCHours(23, 59, 59, 999);
      invoiceDayEnd.setUTCDate(invoiceDayEnd.getUTCDate() + 1);
      if (invoiceDate.getTime() > invoiceDayEnd.getTime()) {
        return res.status(422).json({
          message: "An invoice cannot be dated in the future — it would report a supply that has not happened yet.",
          code: "INVOICE_DATE_IN_FUTURE",
        });
      }
      const dueDateResult = normalizeOptionalInvoiceDateField(invoiceData, "dueDate");
      if (!dueDateResult.ok) {
        return res.status(400).json({ message: dueDateResult.message });
      }

      // Foreign-currency invoices must carry a rate to AED at transaction
      // date — the GL, VAT return, and FTA reporting are all AED. Accept an
      // explicit exchangeRate from the caller or fall back to the stored
      // rates; refuse to book a foreign invoice with no rate at all.
      const fxResult = await resolveDocumentExchangeRate({
        currency: invoiceData.currency,
        date: invoiceDate,
        companyId,
        suppliedRate: invoiceData.exchangeRate,
      });
      if (!fxResult.ok) {
        return res.status(422).json({ message: fxResult.message, code: fxResult.code });
      }
      const exchangeRate = fxResult.rate;
      invoiceData.exchangeRate = exchangeRate;
      invoiceData.baseCurrencyAmount = Math.round(total * exchangeRate * 100) / 100;

      // Block invoice creation in a locked period — invoice creation immediately
      // posts a revenue-recognition journal entry on this date.
      await assertPeriodNotLocked(companyId, invoiceDate);

      // FTA requires sequential, gap-free invoice numbering. We MUST allocate
      // and insert the invoice in a single transaction — otherwise a failed
      // insert after a successful allocation burns the number permanently and
      // the next allocation produces a gap (FTA Article 78 violation).
      const { allocatedNumber, invoice } = await db.transaction(async (tx: typeof db) => {
        const number = await allocateInvoiceNumber(companyId, "invoice", invoiceDate, tx);

        log.info(
          {
            companyId,
            userId,
            number,
            clientSuppliedNumber: invoiceData.number,
            date: invoiceDate,
            subtotal,
            vatAmount,
            total,
            linesCount: parsedLines.length,
          },
          "Creating invoice"
        );

        const [insertedInvoice] = await tx
          .insert(invoicesTable)
          .values({
            ...invoiceData,
            number,
            date: invoiceDate,
            companyId,
            subtotal,
            vatAmount,
            total,
          } as any)
          .returning();

        await replaceInvoiceLines(tx, {
          companyId,
          invoiceId: insertedInvoice.id,
          lines: salesInputs,
          discountType: documentDiscount.discountType,
          discountValue: documentDiscount.discountValue,
          exchangeRate,
          itemExtras: lineExtras(false),
        });
        const [withLines] = await tx.select().from(invoicesTable).where(eq(invoicesTable.id, insertedInvoice.id));

        return { allocatedNumber: number, invoice: withLines ?? insertedInvoice };
      });

      // Revenue recognition happens when the invoice is ISSUED (marked
      // sent/posted) — a draft is a working document, not a supply, so it must
      // not touch the GL or the VAT position. See invoice-posting.service.
      log.info({ invoiceId: invoice.id }, "Invoice created successfully");

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

      createAndEmitNotification({
        userId,
        companyId,
        type: "invoice_created",
        title: "Invoice created",
        message: `Invoice ${invoice.number} for ${invoice.customerName} — ${invoice.total} ${invoice.currency || "AED"}`,
        priority: "normal",
        relatedEntityType: "invoice",
        relatedEntityId: invoice.id,
        actionUrl: "/invoices",
      }).catch(() => {});

      res.json({ ...invoice, itemsSubtotal: derived.itemsSubtotal });
    })
  );

  // REPAIR ONLY — not the issue path.
  //
  // The normal way to recognise revenue is PATCH /api/invoices/:id/status with
  // status "sent", which posts the revenue journal entry. This endpoint exists
  // to repair an *already issued* invoice whose journal entry is missing (e.g.
  // legacy data, or a chart of accounts that was incomplete at issue time).
  //
  // It deliberately returns 400 "No draft entries to post" when there is
  // nothing to repair — that is success-by-no-op, not a failure. Do not call it
  // to issue an invoice.
  //
  // Customer-only.
  app.post(
    "/api/invoices/:id/post",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { id } = req.params;
      const userId = (req as any).user.id;

      // Tenant-scoped lookup also enforces access.
      const invoice = await findInvoiceForUser(userId, id);
      if (!invoice) {
        return res.status(404).json({ message: "Invoice not found" });
      }

      // Get all draft entries for this invoice
      const entries = await storage.getJournalEntriesByCompanyId(invoice.companyId);
      const invoiceEntries = entries.filter((e) => e.sourceId === id && e.status === "draft");

      if (invoiceEntries.length === 0) {
        // Repair path: an ISSUED invoice with no journal entry at all (e.g.
        // issued while the chart of accounts was missing) gets its revenue
        // recognition created now.
        const hasAny = entries.some((e) => e.sourceId === id);
        const issued = ["sent", "posted", "partial", "paid", "credited"].includes(invoice.status);
        if (!hasAny && issued) {
          await assertPeriodNotLocked(invoice.companyId, invoice.date);
          const posted = await postInvoiceRevenueJournal(invoice as any, userId);
          if (posted) {
            // Idempotent: consumes stock / posts COGS only if the issue never did.
            await postCogsForInvoice(invoice as any, userId);
            return res.json({ message: "Revenue recognition entry created", count: 1 });
          }
          return res.status(422).json({
            message:
              "Cannot post invoice: revenue accounts are missing from the chart of accounts.",
            code: "CHART_OF_ACCOUNTS_MISSING",
          });
        }
        return res.status(400).json({ message: "No draft entries to post" });
      }

      // Block posting any draft entry into a locked period.
      for (const entry of invoiceEntries) {
        await assertPeriodNotLocked(invoice.companyId, entry.date);
      }

      // Post all draft entries
      for (const entry of invoiceEntries) {
        await storage.updateJournalEntry(entry.id, invoice.companyId, {
          status: "posted",
          postedBy: userId,
          postedAt: new Date(),
        });
      }

      res.json({ message: "Invoice entries posted successfully", count: invoiceEntries.length });
    })
  );

  // Customer-only: Update invoice
  app.put(
    "/api/invoices/:id",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { id } = req.params;
      const userId = (req as any).user.id;
      const { lines, date } = req.body;
      // Allow-list (see POST): status, invoiceType and the other server-owned columns are never taken from the body.
      const invoiceData: Record<string, any> = pickWritable(req.body, INVOICE_WRITABLE_FIELDS);
      const parsedLines = invoiceLinesInputSchema.parse(lines);
      const documentDiscount = documentDiscountSchema.parse(req.body);

      const invoice = await findInvoiceForUser(userId, id);
      if (!invoice) {
        return res.status(404).json({ message: "Invoice not found" });
      }
      const contactCheck = await checkContactForCompany(invoice.companyId, invoiceData.contactId);
      if (!contactCheck.ok) {
        return res.status(422).json({ message: contactCheck.message, code: contactCheck.code });
      }
      if ((invoice as any).isOpeningBalance) {
        return res.status(409).json({
          message: "This invoice was entered as an opening balance and cannot be edited. Reverse the opening balances to change it.",
          code: "OPENING_BALANCE_INVOICE",
        });
      }
      // The emirate of the supply is editable until the invoice is issued (it decides the VAT return box).
      {
        const em = parseEmirateInput(invoiceData.emirate);
        if (!em.ok) return res.status(422).json({ message: em.message, code: em.code });
        if (em.value === undefined) {
          delete invoiceData.emirate;
        } else if (invoice.status !== "draft") {
          if (em.value !== ((invoice as any).emirate ?? null)) {
            return res.status(409).json({ message: "The emirate of an issued invoice cannot be changed.", code: "EMIRATE_LOCKED" });
          }
          delete invoiceData.emirate;
        } else {
          invoiceData.emirate = em.value;
        }
      }

      if (isTerminal(invoice.status) || invoice.status === "credited") {
        return res.status(422).json({
          message: `Cannot edit ${invoice.status} invoice`,
          code: "INVOICE_TERMINAL",
        });
      }

      const revenueCheck = await checkRevenueAccountsForCompany(
        invoice.companyId,
        parsedLines.map((l) => l.revenueAccountId)
      );
      if (!revenueCheck.ok) {
        return res.status(revenueCheck.status).json({ message: revenueCheck.message, code: revenueCheck.code });
      }
      const productCheck = await checkProductsForCompany(invoice.companyId, parsedLines.map((l) => l.productId));
      if (!productCheck.ok) {
        return res.status(productCheck.status).json({ message: productCheck.message, code: productCheck.code });
      }
      if (!(await projectsBelongToCompany(invoice.companyId, parsedLines.map((l) => (l as any).projectId)))) {
        return res.status(400).json({ message: "A line names a project that does not belong to this company.", code: "INVALID_PROJECT" });
      }
      const previousProjects = ((await storage.getInvoiceLinesByInvoiceId(id)) as any[])
        .filter((l) => (l.lineKind ?? "item") === "item" || l.lineKind === "shipping")
        .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
        .map((l) => (l.projectId ?? null) as string | null);
      const priceListCheck = await checkPriceListsForCompany(invoice.companyId, parsedLines.map((l) => (l as any).priceListId));
      if (!priceListCheck.ok) {
        return res.status(422).json({ message: priceListCheck.message, code: priceListCheck.code });
      }

      // The invoice type decides what may be edited: an advance tax invoice and a late fee are server-made.
      if (invoice.invoiceType === "credit_note" || invoice.invoiceType === "late_fee" || invoice.invoiceType === "advance") {
        return res.status(422).json({
          message: `A ${invoice.invoiceType.replace("_", " ")} cannot be edited.`,
          code: "INVOICE_TYPE_NOT_EDITABLE",
        });
      }

      // Rebuild the signed lines (discounts, shipping, the advance deductions already applied) and the totals.
      const salesInputs = toSalesInputs(parsedLines, lines);
      if (!salesInputs.some((l) => l.kind === "item")) {
        return res.status(400).json({ message: "At least one invoice line is required" });
      }
      const appliedAdvances = await loadAdvanceDeductions(db, invoice.companyId, id);
      // An advance belongs to one customer and is AED only: while a deduction is applied, the customer and the currency
      // of the draft cannot change (the application would silently stop matching its invoice).
      if (appliedAdvances.length > 0) {
        const newContact = invoiceData.contactId === undefined ? undefined : invoiceData.contactId || null;
        const contactChanged = newContact !== undefined && newContact !== (invoice.contactId ?? null);
        const currencyChanged = invoiceData.currency !== undefined && String(invoiceData.currency).toUpperCase() !== String(invoice.currency).toUpperCase();
        if (contactChanged || currencyChanged) {
          return res.status(409).json({
            message: "An advance is applied to this invoice. Remove it before changing the customer or the currency.",
            code: "ADVANCE_APPLIED",
          });
        }
      }
      const derived = deriveSalesLines({
        lines: salesInputs,
        discountType: documentDiscount.discountType,
        discountValue: documentDiscount.discountValue,
        advances: appliedAdvances,
      });
      if (!derived.ok) {
        return res.status(422).json({ message: derived.message, code: derived.code });
      }
      const { subtotal, vatAmount, total } = derived;
      if (!Number.isFinite(total) || Math.abs(total) > MAX_DOCUMENT_TOTAL) {
        return res.status(422).json({
          message: `Invoice total is too large to record (limit ${MAX_DOCUMENT_TOTAL.toLocaleString()}).`,
          code: "AMOUNT_OUT_OF_RANGE",
        });
      }

      // If a posted journal entry exists for this invoice and the amount is
      // changing, refuse. The user must void & reissue (or issue a credit
      // note) instead — silently re-posting the GL would break period-locked
      // ledgers and audit trails.
      const existingEntries = await storage.getJournalEntriesBySource(
        invoice.companyId,
        "invoice",
        id
      );
      const postedEntry = existingEntries.find((e) => e.status === "posted");
      const totalsChanged =
        Math.abs(Number(invoice.total) - total) > 0.005 ||
        Math.abs(Number(invoice.subtotal) - subtotal) > 0.005 ||
        Math.abs(Number(invoice.vatAmount) - vatAmount) > 0.005;
      if (postedEntry && totalsChanged) {
        return res.status(422).json({
          message:
            "Invoice amount cannot be changed while a posted journal entry exists. Void this invoice and issue a credit note or new invoice instead.",
          code: "INVOICE_POSTED_AMOUNT_LOCKED",
        });
      }

      // The journal was posted from the per-account allocation of the lines and
      // the VAT return reads the lines' rate / supply type. Locking only the
      // totals let amounts move between revenue accounts (or between a 5% and a
      // 0% line) at unchanged totals, so a later void / credit note reversed the
      // wrong accounts. Compare what the ledger and the VAT return derive from
      // the lines, before and after, and refuse any difference.
      if (postedEntry) {
        const existingLines = await storage.getInvoiceLinesByInvoiceId(id);
        const chart = await storage.getAccountsByCompanyId(invoice.companyId);
        const revenueCtx = revenueContextOf(chart);
        const salesAccounts = await resolveSalesAccounts(db, invoice.companyId);
        const storedRate = resolveInvoiceFx(invoice as any).rate;
        const requestedRate = Number(invoiceData.exchangeRate) > 0 ? Number(invoiceData.exchangeRate) : storedRate;
        const verdict = checkPostedInvoiceEdit({
          before: { lines: existingLines as any[], subtotal: Number(invoice.subtotal), rate: storedRate },
          // The derived lines carry the accounts they will post to, so an edit that changes nothing on the ledger
          // (a customer name) is not mistaken for moving amounts between accounts.
          after: {
            lines: derived.lines.map((d) => ({
              ...d,
              revenueAccountId: accountIdForDerived(d, d.sourceIndex !== undefined ? salesInputs[d.sourceIndex] : undefined, salesAccounts),
            })),
            subtotal,
            rate: requestedRate,
          },
          defaultAccountId: revenueCtx?.defaultAccountId ?? null,
          zeroRatedAccountId: revenueCtx?.zeroRatedAccountId ?? null,
        });
        if (!verdict.ok) {
          return res.status(422).json({ message: verdict.message, code: verdict.code });
        }
      }

      const invoiceDate = date === undefined || date === null ? undefined : parseCalendarDay(date);
      if (invoiceDate === null) {
        return res.status(400).json({ message: "Invalid invoice date" });
      }
      const dueDateResult = normalizeOptionalInvoiceDateField(invoiceData, "dueDate");
      if (!dueDateResult.ok) {
        return res.status(400).json({ message: dueDateResult.message });
      }

      // Block updates that would touch a locked period (either the invoice's
      // existing date or the requested new date).
      await assertPeriodNotLocked(invoice.companyId, invoice.date);
      if (invoiceDate) {
        await assertPeriodNotLocked(invoice.companyId, invoiceDate);
      }

      // Keep the AED base amount in sync with the recomputed totals. The
      // stored transaction-date rate is reused unless the caller supplies one.
      const fxRate =
        Number(invoiceData.exchangeRate) > 0
          ? Number(invoiceData.exchangeRate)
          : Number((invoice as any).exchangeRate) || 1;

      // A posted invoice keeps its currency; only a draft may change it.
      if (postedEntry) delete invoiceData.currency;

      // Write under the posting lock: an issue (revenue journal) or an advance application running at the
      // same time must see either all of this edit or none of it.
      const updatedInvoice = await withDocumentLock(id, LOCK_NS.INVOICE_POSTING, async (tx: typeof db) => {
        const [fresh] = await tx.select().from(invoicesTable).where(eq(invoicesTable.id, id));
        if (!fresh || isTerminal(fresh.status) || fresh.status === "credited") {
          throw new AppError({ message: `Cannot edit ${fresh?.status ?? "missing"} invoice`, statusCode: 422, code: "INVOICE_TERMINAL" });
        }
        const lockedPosted = (
          await tx
            .select({ id: journalEntriesTable.id })
            .from(journalEntriesTable)
            .where(
              and(
                eq(journalEntriesTable.companyId, invoice.companyId),
                eq(journalEntriesTable.source, "invoice"),
                eq(journalEntriesTable.sourceId, id),
                eq(journalEntriesTable.status, "posted")
              )
            )
        ).length > 0;
        if (lockedPosted && !postedEntry && totalsChanged) {
          throw new AppError({
            message:
              "Invoice amount cannot be changed while a posted journal entry exists. Void this invoice and issue a credit note or new invoice instead.",
            statusCode: 422,
            code: "INVOICE_POSTED_AMOUNT_LOCKED",
          });
        }
        // An invoice made from a sales order re-checks its quantities against the order under the order's row lock.
        if ((fresh as any).salesOrderId) {
          await assertSalesOrderQuantitiesForEdit(tx, {
            companyId: invoice.companyId,
            invoiceId: id,
            salesOrderId: (fresh as any).salesOrderId,
            lines: salesInputs.map((l) => ({ salesOrderLineId: l.salesOrderLineId, quantity: l.quantity })),
          });
        }
        await tx
          .update(invoicesTable)
          .set({ ...invoiceData, date: invoiceDate, exchangeRate: fxRate } as any)
          .where(and(eq(invoicesTable.id, id), eq(invoicesTable.companyId, invoice.companyId)));
        await replaceInvoiceLines(tx, {
          companyId: invoice.companyId,
          invoiceId: id,
          lines: salesInputs,
          discountType: documentDiscount.discountType,
          discountValue: documentDiscount.discountValue,
          exchangeRate: fxRate,
          itemExtras: lineExtras(!!(fresh as any).salesOrderId, previousProjects),
        });
        const [row] = await tx.select().from(invoicesTable).where(eq(invoicesTable.id, id));
        return row;
      });

      await recordAudit({
        userId,
        companyId: invoice.companyId,
        action: "invoice.update",
        entityType: "invoice",
        entityId: id,
        before: {
          subtotal: invoice.subtotal,
          vatAmount: invoice.vatAmount,
          total: invoice.total,
          date: invoice.date,
        },
        after: { subtotal, vatAmount, total, date: invoiceDate },
        req,
      });

      log.info({ id }, "Invoice updated successfully");
      res.json({ ...updatedInvoice, itemsSubtotal: derived.itemsSubtotal });
    })
  );

  // Customer-only: Delete invoice
  app.delete(
    "/api/invoices/:id",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { id } = req.params;
      const userId = (req as any).user.id;

      const invoice = await findInvoiceForUser(userId, id);
      if (!invoice) {
        return res.status(404).json({ message: "Invoice not found" });
      }

      // FTA: 5-year retention. Throws RetentionViolationError → 409 via global handler.
      assertRetentionExpired(
        invoice as { createdAt: Date | string; retentionExpiresAt?: Date | string | null },
        "Invoice"
      );

      // A draft that deducted advances gives them back when it goes (the application rows cascade); remember which.
      const heldAdvances = await loadAdvanceApplicationsForInvoice(invoice.companyId, id);
      try {
        await storage.safeDeleteInvoice(id);
        for (const advanceId of new Set(heldAdvances.map((a) => a.advanceId))) {
          await refreshAdvanceStatus(db, advanceId);
        }
      } catch (err: any) {
        if (err?.code === "INVOICE_HAS_POSTED_JE") {
          return res.status(422).json({
            message: err.message,
            code: err.code,
          });
        }
        if (err?.code === "INVOICE_NOT_FOUND") {
          return res.status(404).json({ message: err.message });
        }
        throw err;
      }

      await recordAudit({
        userId,
        companyId: invoice.companyId,
        action: "invoice.delete",
        entityType: "invoice",
        entityId: id,
        before: { number: invoice.number, status: invoice.status, total: invoice.total },
        after: null,
        req,
      });

      res.json({ message: "Invoice deleted successfully" });
    })
  );

  // Customer-only: Update invoice status (state-machine enforced)
  app.patch(
    "/api/invoices/:id/status",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { id } = req.params;
      const { status, paymentAccountId } = req.body;
      const userId = (req as any).user.id;

      if (!status || !isValidStatus(status)) {
        return res.status(400).json({
          message:
            "Invalid status. Must be one of: draft, sent, posted, partial, paid, void, cancelled",
        });
      }
      // 'paid', 'partial' and 'credited' are derived (from the payments and the credit notes): nobody can set them by
      // hand. The status endpoint only issues (draft -> sent/posted) and voids or cancels.
      if (status === "paid" || status === "partial" || status === "credited") {
        return res.status(400).json({
          message:
            status === "credited"
              ? "An invoice becomes 'credited' by itself when a credit note is issued against it for its full amount. Issue a credit note instead of setting the status."
              : `An invoice becomes '${status}' by itself when payments are recorded against it. Record the payment instead of setting the status.`,
          code: "STATUS_DERIVED",
        });
      }

      const invoice = await findInvoiceForUser(userId, id);
      if (!invoice) {
        return res.status(404).json({ message: "Invoice not found" });
      }

      const oldStatus = invoice.status;

      // A credited invoice reopens only when its credit note is voided (the
      // system sync does that). It cannot be moved by hand; voiding it is
      // handled below and refused while credit notes exist.
      if (oldStatus === "credited" && status !== "void") {
        return res.status(422).json({
          message: "A credited invoice cannot be changed by hand. Void the credit note to reopen the invoice.",
          code: "INVOICE_CREDITED_LOCKED",
        });
      }

      // Voiding / cancelling a document that is already void or cancelled is
      // not a silent no-op: it was reversed once and must not look as if it
      // had just been reversed again (the locked transaction re-checks this).
      if ((status === "void" || status === "cancelled") && (oldStatus === "void" || oldStatus === "cancelled")) {
        const already = alreadyTerminalOutcome(oldStatus);
        if (!already.ok) return res.status(already.status).json({ message: already.message, code: already.code });
      }

      // No-op transition is fine.
      if (oldStatus !== status && !canTransition(oldStatus, status)) {
        return res.status(422).json({
          message: `Invalid invoice status transition: ${oldStatus} → ${status}`,
          code: "INVALID_TRANSITION",
          allowed: { from: oldStatus, to: status },
        });
      }

      if (oldStatus !== status) {
        // Issuing the invoice (draft → sent/posted) is the revenue-recognition
        // event: post the AR/Revenue/VAT journal entry now. Idempotent — data
        // created before drafts stopped auto-posting is skipped.
        if (oldStatus === "draft" && (status === "sent" || status === "posted")) {
          // Posts the journal(s) AND sets the status in one transaction (invoice-issue.service).
          const issued = await issueInvoice(invoice, userId, status);
          if (!issued.ok) return res.status(issued.status).json(issued.body);
        }

        // Void/cancel must reverse the original revenue-recognition JE so the
        // GL doesn't keep recognising sales that were never realised. It runs
        // in ONE locked transaction (see invoice-void.service): a repeated or
        // parallel request can never post a second reversal.
        if (status === "void" || status === "cancelled") {
          const outcome = await voidOrCancelInvoice({
            invoiceId: id,
            companyId: invoice.companyId,
            targetStatus: status,
            userId,
            date: req.body.date,
          });
          if (!outcome.ok) {
            return res.status(outcome.status).json({ message: outcome.message, code: outcome.code });
          }
        } else if (!(oldStatus === "draft" && (status === "sent" || status === "posted"))) {
          await storage.updateInvoiceStatus(id, invoice.companyId, status);
        }
      }

      const updatedInvoice = await storage.getInvoice(id, invoice.companyId);
      log.info({ id, oldStatus, status }, "Status transition");

      await recordAudit({
        userId,
        companyId: invoice.companyId,
        action: "invoice.status_change",
        entityType: "invoice",
        entityId: id,
        before: { status: oldStatus },
        after: { status },
        req,
      });

      if (status !== oldStatus && status === "void") {
        createAndEmitNotification({
          userId,
          companyId: invoice.companyId,
          type: "invoice_status_change",
          title: `Invoice ${status}`,
          message: `Invoice ${invoice.number} for ${invoice.customerName} marked as ${status}`,
          priority: "normal",
          relatedEntityType: "invoice",
          relatedEntityId: id,
          actionUrl: "/invoices",
        }).catch(() => {});
      }

      res.json(updatedInvoice);
    })
  );

  // =====================================
  // E-Invoicing (PINT AE / UBL 2.1)
  // =====================================

  // Customer-only: Generate e-invoice XML for an invoice
  // Pre-submission validation: returns the fix-it list without generating.
  app.get(
    "/api/invoices/:id/einvoice/validate",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { id } = req.params;
      const userId = (req as any).user.id;

      const invoice = await findInvoiceForUser(userId, id);
      if (!invoice) {
        return res.status(404).json({ message: "Invoice not found" });
      }
      const lines = await storage.getInvoiceLinesByInvoiceId(id);
      const company = await storage.getCompany(invoice.companyId);
      if (!company) {
        return res.status(404).json({ message: "Company not found" });
      }
      const context = await resolveEInvoiceContext(invoice, company);
      const issues = validateForEInvoicing(invoice, lines, company, context.validation);
      res.json({ valid: issues.length === 0, issues });
    })
  );

  app.post(
    "/api/invoices/:id/generate-einvoice",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { id } = req.params;
      const userId = (req as any).user.id;

      const invoice = await findInvoiceForUser(userId, id);
      if (!invoice) {
        return res.status(404).json({ message: "Invoice not found" });
      }

      const lines = await storage.getInvoiceLinesByInvoiceId(id);
      const company = await storage.getCompany(invoice.companyId);
      if (!company) {
        return res.status(404).json({ message: "Company not found" });
      }

      // A payload an ASP/FTA would reject must never be generated and stored.
      const context = await resolveEInvoiceContext(invoice, company);
      const issues = validateForEInvoicing(invoice, lines, company, context.validation);
      if (issues.length > 0) {
        return res.status(422).json({
          message: "Invoice is not e-invoicing ready",
          code: "EINVOICE_VALIDATION_FAILED",
          issues,
        });
      }

      const customer = invoice.customerName
        ? { name: invoice.customerName, trn: invoice.customerTrn || undefined }
        : undefined;

      const { xml, uuid, hash } = generateEInvoiceXML(invoice, lines, company, customer, context.xml);

      // Save e-invoice data to the invoice record
      await storage.updateInvoice(id, invoice.companyId, {
        einvoiceUuid: uuid,
        einvoiceXml: xml,
        einvoiceHash: hash,
        einvoiceStatus: "generated",
      });

      log.info({ id, uuid }, "Generated e-invoice");

      res.json({ uuid, hash, status: "generated" });
    })
  );

  // Customer-only: Get e-invoice XML for an invoice
  app.get(
    "/api/invoices/:id/einvoice-xml",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { id } = req.params;
      const userId = (req as any).user.id;

      const invoice = await findInvoiceForUser(userId, id);
      if (!invoice) {
        return res.status(404).json({ message: "Invoice not found" });
      }

      if (!invoice.einvoiceXml) {
        return res
          .status(404)
          .json({ message: "E-invoice has not been generated for this invoice" });
      }

      res.set("Content-Type", "application/xml");
      res.set("Content-Disposition", `attachment; filename="einvoice-${invoice.number}.xml"`);
      res.send(invoice.einvoiceXml);
    })
  );

  // Customer-only: submit the e-invoice to the active ASP (provider-agnostic).
  app.post(
    "/api/invoices/:id/einvoice/submit",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { id } = req.params;
      const userId = (req as any).user.id;

      const invoice = await findInvoiceForUser(userId, id);
      if (!invoice) return res.status(404).json({ message: "Invoice not found" });
      const lines = await storage.getInvoiceLinesByInvoiceId(id);
      const company = await storage.getCompany(invoice.companyId);
      if (!company) return res.status(404).json({ message: "Company not found" });

      let provider;
      try {
        provider = getEInvoiceProvider();
      } catch (err: any) {
        // No accredited provider configured. Report this honestly as
        // "not available" rather than letting a mock fabricate an acceptance.
        return res.status(503).json({
          message: err?.message || "E-invoicing is not configured.",
          code: "EINVOICE_PROVIDER_NOT_CONFIGURED",
        });
      }
      const context = await resolveEInvoiceContext(invoice, company);
      const result = await submitEInvoice({ invoice, lines, company, provider, context });
      if (!result.ok) {
        return res
          .status(result.status)
          .json({ message: result.message, code: result.code, issues: result.issues });
      }

      await storage.updateInvoice(id, invoice.companyId, result.update as any);
      await recordAudit({
        userId,
        companyId: invoice.companyId,
        action: "invoice.einvoice_submit",
        entityType: "invoice",
        entityId: id,
        after: {
          provider: provider.name,
          providerMessageId: result.providerMessageId,
          status: result.update.einvoiceStatus,
        },
        req,
      });
      res.json({
        status: result.update.einvoiceStatus,
        provider: provider.name,
        providerMessageId: result.providerMessageId,
      });
    })
  );

  // Customer-only: poll the ASP for the latest clearance status.
  app.post(
    "/api/invoices/:id/einvoice/refresh-status",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { id } = req.params;
      const userId = (req as any).user.id;

      const invoice = await findInvoiceForUser(userId, id);
      if (!invoice) return res.status(404).json({ message: "Invoice not found" });

      let provider;
      try {
        provider = getEInvoiceProvider();
      } catch (err: any) {
        // No accredited provider configured. Report this honestly as
        // "not available" rather than letting a mock fabricate an acceptance.
        return res.status(503).json({
          message: err?.message || "E-invoicing is not configured.",
          code: "EINVOICE_PROVIDER_NOT_CONFIGURED",
        });
      }
      const result = await refreshEInvoiceStatus({ invoice, provider });
      if (!result.ok) {
        return res.status(result.status).json({ message: result.message, code: result.code });
      }

      await storage.updateInvoice(id, invoice.companyId, result.update as any);
      res.json({
        status: result.update.einvoiceStatus,
        detail: result.update.einvoiceStatusDetail ?? null,
      });
    })
  );

  // =====================================
  // Invoice Sharing & PDF
  // =====================================

  // Customer-only: Generate share link for invoice
  app.post(
    "/api/invoices/:id/share",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { id } = req.params;
      const userId = (req as any).user.id;

      const invoice = await findInvoiceForUser(userId, id);
      if (!invoice) {
        return res.status(404).json({ message: "Invoice not found" });
      }

      // Generate a random token
      const token = crypto.randomBytes(16).toString("hex");
      // 90-day expiry
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 90);

      await storage.setInvoiceShareToken(id, token, expiresAt);

      res.json({
        shareUrl: `/view/invoice/${token}`,
        token,
      });
    })
  );

  // Customer-only: Download invoice as PDF
  app.get(
    "/api/invoices/:id/pdf",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { id } = req.params;
      const userId = (req as any).user.id;

      const invoice = await findInvoiceForUser(userId, id);
      if (!invoice) {
        return res.status(404).json({ message: "Invoice not found" });
      }

      const lines = await storage.getInvoiceLinesByInvoiceId(id);
      const company = await storage.getCompany(invoice.companyId);
      if (!company) {
        return res.status(404).json({ message: "Company not found" });
      }

      const isDeliveryNote = req.query.variant === "delivery";
      if (isDeliveryNote && invoice.invoiceType === "credit_note") {
        return res.status(400).json({ message: "A delivery note cannot be created from a credit note" });
      }
      const pdfBuffer = isDeliveryNote
        ? await generateDeliveryNotePDF(invoice, lines, company)
        : await generateInvoicePDF(invoice, lines, company);

      res.set({
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${isDeliveryNote ? "delivery-note" : "invoice"}-${invoice.number}.pdf"`,
        "Content-Length": pdfBuffer.length.toString(),
      });
      res.send(pdfBuffer);
    })
  );

  // Public: View invoice by share token (NO auth required)
  app.get(
    "/api/public/invoices/:token",
    asyncHandler(async (req: Request, res: Response) => {
      const { token } = req.params;

      const invoice = await storage.getInvoiceByShareToken(token);
      // A draft is not yet issued to the customer: its link shows nothing.
      if (!invoice || invoice.status === "draft") {
        return res.status(404).json({ message: "Invoice not found or link is invalid" });
      }

      // Check expiry
      if (invoice.shareTokenExpiresAt && new Date(invoice.shareTokenExpiresAt) < new Date()) {
        return res.status(410).json({ message: "This invoice link has expired" });
      }

      const lines = await storage.getInvoiceLinesByInvoiceId(invoice.id);
      const company = await storage.getCompany(invoice.companyId);
      if (!company) {
        return res.status(404).json({ message: "Company not found" });
      }

      // What is still owed (payments and credit notes taken off) and the custom fields flagged for display.
      const balance = await getInvoiceBalance(invoice.companyId, invoice.id);
      const customFields = await pdfFieldsFor(invoice.companyId, "invoice", invoice.id);
      // Pay now is offered only when the company can really take payment (provider keys set AND a connected account).
      const onlinePayment = await onlinePaymentView(invoice);

      // Return sanitized data (no internal IDs exposed except what's needed)
      res.json({
        invoice: {
          number: invoice.number,
          invoiceType: invoice.invoiceType,
          customerName: invoice.customerName,
          customerTrn: invoice.customerTrn,
          date: invoice.date,
          dueDate: invoice.dueDate,
          currency: invoice.currency,
          subtotal: invoice.subtotal,
          vatAmount: invoice.vatAmount,
          total: invoice.total,
          discountAmount: invoice.discountAmount,
          shippingAmount: invoice.shippingAmount,
          itemsSubtotal: itemsSubtotalOf(lines),
          status: invoice.status,
          paid: balance.paid,
          outstanding: balance.outstanding,
        },
        lines: lines.map((l) => ({
          description: l.description,
          quantity: l.quantity,
          unitPrice: l.unitPrice,
          vatRate: l.vatRate,
          vatSupplyType: l.vatSupplyType,
          lineKind: l.lineKind,
          discountType: l.discountType,
          discountValue: l.discountValue,
          hasParent: !!l.parentLineId,
        })),
        customFields,
        onlinePayment,
        company: {
          name: company.name,
          trnVatNumber: company.trnVatNumber,
          businessAddress: company.businessAddress,
          contactPhone: company.contactPhone,
          contactEmail: company.contactEmail,
          websiteUrl: company.websiteUrl,
          logoUrl: company.logoUrl,
        },
      });
    })
  );

  // =====================================
  // Recurring Invoice Control
  // =====================================

  // POST /api/companies/:companyId/invoices/:invoiceId/set-recurring
  // DEPRECATED — returns 410 Gone. The scheduler reads recurring_invoices
  // template rows (created via /api/companies/:companyId/recurring-invoices),
  // NOT invoices.is_recurring + invoices.next_recurring_date. Setting those
  // legacy invoice-level fields had no effect on scheduling — invoices
  // marked recurring this way were never picked up by the cron. Migrate
  // callers to POST /api/companies/:companyId/recurring-invoices.
  app.post(
    "/api/companies/:companyId/invoices/:invoiceId/set-recurring",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (_req: Request, res: Response) => {
      return res.status(410).json({
        message:
          "This endpoint is deprecated and no longer schedules invoices. Use POST /api/companies/:companyId/recurring-invoices instead.",
        code: "ENDPOINT_DEPRECATED",
        replacement: "/api/companies/:companyId/recurring-invoices",
      });
    })
  );

  // =====================================
  // Invoice Payments
  // =====================================

  // GET /api/companies/:companyId/invoices/:invoiceId/payments
  app.get(
    "/api/companies/:companyId/invoices/:invoiceId/payments",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId, invoiceId } = req.params;
      const userId = (req as any).user.id;

      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) return res.status(403).json({ message: "Access denied" });

      const invoice = await storage.getInvoice(invoiceId, companyId);
      if (!invoice) {
        return res.status(404).json({ message: "Invoice not found" });
      }

      const payments = await storage.getInvoicePaymentsByInvoiceId(invoiceId);
      res.json(payments);
    })
  );

  // POST /api/companies/:companyId/invoices/:invoiceId/payments
  app.post(
    "/api/companies/:companyId/invoices/:invoiceId/payments",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId, invoiceId } = req.params;
      const userId = (req as any).user.id;
      const { amount, date, method, reference, notes, paymentAccountId } = req.body;
      // A-B5: optional payment-date FX rate (AED per unit of the invoice
      // currency). Enables realised FX + cross-currency settlement.
      const rawPaymentRate = Number(req.body.exchangeRate ?? req.body.paymentExchangeRate);
      const paymentExchangeRate =
        Number.isFinite(rawPaymentRate) && rawPaymentRate > 0 ? rawPaymentRate : null;

      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) return res.status(403).json({ message: "Access denied" });

      // Validate first — cheap rejects before we touch the DB.
      const numericAmount = Number(amount);
      if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
        return res.status(422).json({ message: "Payment amount must be a positive number" });
      }
      if (!paymentAccountId) {
        return res.status(400).json({ message: "paymentAccountId is required" });
      }

      const invoice = await storage.getInvoice(invoiceId, companyId);
      if (!invoice) {
        return res.status(404).json({ message: "Invoice not found" });
      }

      // Reject voided/cancelled invoices up front (the storage layer also
      // re-checks under FOR UPDATE; this is a fast-path 422).
      if (invoice.status === "void" || invoice.status === "cancelled") {
        return res.status(422).json({
          message: `Cannot record payment on ${invoice.status} invoice`,
          code: "INVOICE_TERMINAL",
        });
      }

      const paymentAccount = await storage.getAccount(paymentAccountId, companyId);
      if (!paymentAccount || paymentAccount.type !== "asset") {
        return res
          .status(400)
          .json({ message: "Invalid payment account — must be an asset (cash/bank) account" });
      }
      // Currency validation: bank-account currency (if present) must match the invoice.
      const acctCurrency = (paymentAccount as any).currency as string | null | undefined;
      // A-B5: allow a currency mismatch when a payment-date rate is supplied
      // (cross-currency settlement with realised FX); otherwise keep the guard.
      if (acctCurrency && acctCurrency !== invoice.currency && !paymentExchangeRate) {
        return res.status(422).json({
          message: `Payment account currency (${acctCurrency}) does not match invoice currency (${invoice.currency}). Provide a payment-date exchange rate to settle across currencies.`,
          code: "CURRENCY_MISMATCH",
        });
      }

      const accounts = await storage.getAccountsByCompanyId(companyId);
      const accountsReceivable = accounts.find(
        (a) => a.code === ACCOUNT_CODES.AR && a.isSystemAccount
      );
      if (!accountsReceivable) {
        return res.status(500).json({ message: "Accounts Receivable account not found" });
      }

      // Validate the payment date (default today): not in the future, not
      // before the invoice date, and outside any locked period.
      const { date: paymentDate } = await resolveSettlementDate(companyId, {
        requested: date,
      });

      let result;
      try {
        result = await storage.recordInvoicePayment({
          invoiceId,
          companyId,
          amount: numericAmount,
          date: paymentDate,
          method: method || "bank",
          reference: reference || null,
          notes: notes || null,
          paymentAccountId,
          paymentAccountCurrency: acctCurrency ?? null,
          paymentExchangeRate,
          receivableAccountId: accountsReceivable.id,
          createdBy: userId,
          allowCredit: req.body.allowCredit === true,
        });
      } catch (err: any) {
        const code = err?.code;
        if (code === "PAYMENT_EXCEEDS_BALANCE") {
          return res.status(422).json({ message: err.message, code, details: err.details });
        }
        if (code === "INVOICE_NOTHING_OUTSTANDING") {
          return res.status(409).json({ message: err.message, code, details: err.details });
        }
        if (code === "OVERPAYMENT" || code === "INVOICE_TERMINAL" || code === "CURRENCY_MISMATCH") {
          return res.status(422).json({ message: err.message, code });
        }
        if (code === "INVOICE_NOT_FOUND") {
          return res.status(404).json({ message: err.message });
        }
        if (code === "INVOICE_COMPANY_MISMATCH") {
          return res.status(403).json({ message: err.message });
        }
        throw err;
      }

      await recordAudit({
        userId,
        companyId,
        action: "invoice.payment",
        entityType: "invoice",
        entityId: invoiceId,
        before: { status: invoice.status, totalPaid: result.totalPaid - numericAmount },
        after: { status: result.invoice.status, totalPaid: result.totalPaid },
        req,
        extra: {
          paymentId: result.payment.id,
          amount: numericAmount,
          method: method || "bank",
          journalEntryId: result.journalEntryId,
        },
      });

      res.status(201).json({
        payment: result.payment,
        totalPaid: result.totalPaid,
        status: result.invoice.status,
      });
    })
  );

  // =====================================
  // Credit Notes
  // =====================================

  // POST /api/companies/:companyId/invoices/:invoiceId/credit-note
  app.post(
    "/api/companies/:companyId/invoices/:invoiceId/credit-note",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId, invoiceId } = req.params;
      const userId = (req as any).user.id;

      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) return res.status(403).json({ message: "Access denied" });

      const original = await storage.getInvoice(invoiceId, companyId);
      if (!original) {
        return res.status(404).json({ message: "Invoice not found" });
      }

      const result = await issueCreditNote({ companyId, invoiceId, original, userId, body: req.body });
      if (!result.ok) return res.status(result.status).json(result.body);

      // Audit AFTER the lock is released: it uses the pool, and doing that while
      // holding the lock's connection is exactly what starved the pool.
      const { cnNumber, creditNote } = result;
      await recordAudit({
        userId,
        companyId,
        action: "invoice.credit_note",
        entityType: "invoice",
        entityId: creditNote.id,
        before: { originalInvoiceId: invoiceId, originalNumber: original.number },
        after: {
          creditNoteNumber: cnNumber,
          total: creditNote.total,
          currency: creditNote.currency,
        },
        req,
      });

      return res.status(201).json(creditNote);
    })
  );

  // Public: Download PDF by share token (NO auth required)
  app.get(
    "/api/public/invoices/:token/pdf",
    asyncHandler(async (req: Request, res: Response) => {
      const { token } = req.params;

      const invoice = await storage.getInvoiceByShareToken(token);
      if (!invoice) {
        return res.status(404).json({ message: "Invoice not found or link is invalid" });
      }

      if (invoice.shareTokenExpiresAt && new Date(invoice.shareTokenExpiresAt) < new Date()) {
        return res.status(410).json({ message: "This invoice link has expired" });
      }

      const lines = await storage.getInvoiceLinesByInvoiceId(invoice.id);
      const company = await storage.getCompany(invoice.companyId);
      if (!company) {
        return res.status(404).json({ message: "Company not found" });
      }

      const pdfBuffer = await generateInvoicePDF(invoice, lines, company);

      res.set({
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="invoice-${invoice.number}.pdf"`,
        "Content-Length": pdfBuffer.length.toString(),
      });
      res.send(pdfBuffer);
    })
  );

  // Customer-only: Send invoice by email
  app.post(
    "/api/companies/:companyId/invoices/:invoiceId/send-email",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId, invoiceId } = req.params;
      const userId = (req as any).user.id;

      const bodySchema = z.object({
        to: z.string().email("Invalid email address"),
        subject: z.string().optional(),
        message: z.string().optional(),
      });
      const parsed = bodySchema.safeParse(req.body);
      if (!parsed.success) {
        return res
          .status(400)
          .json({ message: parsed.error.errors[0]?.message || "Invalid request" });
      }
      const { to, subject, message } = parsed.data;

      if (!emailStatus().configured) {
        return res
          .status(503)
          .json({ message: EMAIL_NOT_CONFIGURED_MESSAGE, code: "EMAIL_NOT_CONFIGURED" });
      }

      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: "Access denied" });
      }

      const invoice = await storage.getInvoice(invoiceId, companyId);
      if (!invoice) {
        return res.status(404).json({ message: "Invoice not found" });
      }

      const company = await storage.getCompany(companyId);
      if (!company) {
        return res.status(404).json({ message: "Company not found" });
      }

      const lines = await storage.getInvoiceLinesByInvoiceId(invoiceId);
      const pdfBuffer = await generateInvoicePDF(invoice, lines, company);

      assertEmailSent(await sendInvoiceEmail(to, invoice, company, pdfBuffer, subject, message));

      await storage.createActivityLog({
        userId,
        companyId,
        action: "send",
        entityType: "invoice",
        entityId: invoiceId,
        description: `Invoice ${invoice.number} sent by email to ${to}`,
        metadata: JSON.stringify({ to, invoiceNumber: invoice.number }),
      });

      res.json({ message: `Invoice ${invoice.number} sent to ${to}` });
    })
  );

  // Customer-only: Send payment reminder email
  app.post(
    "/api/companies/:companyId/invoices/:invoiceId/send-reminder",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId, invoiceId } = req.params;
      const userId = (req as any).user.id;

      const bodySchema = z.object({
        to: z.string().email("Invalid email address"),
      });
      const parsed = bodySchema.safeParse(req.body);
      if (!parsed.success) {
        return res
          .status(400)
          .json({ message: parsed.error.errors[0]?.message || "Invalid request" });
      }
      const { to } = parsed.data;

      if (!emailStatus().configured) {
        return res
          .status(503)
          .json({ message: EMAIL_NOT_CONFIGURED_MESSAGE, code: "EMAIL_NOT_CONFIGURED" });
      }

      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: "Access denied" });
      }

      const invoice = await storage.getInvoice(invoiceId, companyId);
      if (!invoice) {
        return res.status(404).json({ message: "Invoice not found" });
      }

      if (invoice.status === "paid" || invoice.status === "void" || invoice.status === "credited") {
        return res
          .status(400)
          .json({ message: `Cannot send reminder for a ${invoice.status} invoice` });
      }
      // Nothing owed (credit notes and payments cover the invoice): nothing to chase.
      const reminderBalance = await getInvoiceBalance(companyId, invoiceId);
      if (reminderBalance.outstanding <= 0.005) {
        return res.status(409).json({
          message: "This invoice has nothing outstanding, so no payment reminder is needed.",
          code: "INVOICE_NOTHING_OUTSTANDING",
        });
      }

      const company = await storage.getCompany(companyId);
      if (!company) {
        return res.status(404).json({ message: "Company not found" });
      }

      const newReminderCount = (invoice.reminderCount || 0) + 1;
      const lines = await storage.getInvoiceLinesByInvoiceId(invoiceId);
      const pdfBuffer = await generateInvoicePDF(invoice, lines, company);

      assertEmailSent(
        await sendPaymentReminderEmail(to, invoice, company, pdfBuffer, newReminderCount)
      );

      await storage.updateInvoice(invoiceId, companyId, {
        reminderCount: newReminderCount,
        lastReminderSentAt: new Date(),
      });

      await storage.createActivityLog({
        userId,
        companyId,
        action: "send",
        entityType: "invoice",
        entityId: invoiceId,
        description: `Payment reminder #${newReminderCount} sent for invoice ${invoice.number} to ${to}`,
        metadata: JSON.stringify({
          to,
          reminderCount: newReminderCount,
          invoiceNumber: invoice.number,
        }),
      });

      res.json({
        message: `Payment reminder #${newReminderCount} sent to ${to}`,
        reminderCount: newReminderCount,
      });
    })
  );
}
