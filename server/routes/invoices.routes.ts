import { Router, type Express, type Request, type Response } from "express";
import crypto from "crypto";
import Decimal from "decimal.js";
import { storage } from "../storage";
import { z } from "zod";
import { authMiddleware, requireCustomer } from "../middleware/auth";
import { asyncHandler } from "../middleware/errorHandler";
import { checkUsageLimit } from "../middleware/featureGate";
import {
  insertInvoiceSchema,
  type Invoice,
  type JournalEntry,
  type JournalLine,
} from "../../shared/schema";
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
import {
  invoices as invoicesTable,
  invoiceLines as invoiceLinesTable,
  journalEntries as journalEntriesTable,
  journalLines as journalLinesTable,
} from "../../shared/schema";
import { and, eq, inArray } from "drizzle-orm";
import { assertPeriodNotLocked, assertNotFutureDate } from "../services/period-lock.service";
import { resolveSettlementDate } from "../services/payment-date-guard.service";
import { canTransition, isTerminal, isValidStatus } from "../services/invoice-state-machine";
import {
  evaluateCreditNoteRequest,
  buildReversalLines,
  selectVoidableEntries,
} from "../services/invoice-lifecycle";
import { postInvoiceRevenueJournal } from "../services/invoice-posting.service";
import {
  checkProductsForCompany,
  creditNoteRestockTag,
  postCogsForInvoice,
  restockInvoiceInTx,
  restockRequestFromCreditLines,
} from "../services/inventory-costing.service";
import { syncInvoiceStatusFromBalance } from "../services/invoice-credit-status";
import { getInvoiceBalance, loadInvoiceBalances } from "../services/invoice-outstanding.db";
import { invoiceBalanceFields } from "../services/invoice-outstanding";
import { voidOrCancelInvoice, alreadyTerminalOutcome } from "../services/invoice-void.service";
import { checkRevenueAccountsForCompany } from "../services/revenue-account-guard.service";
import { allocateRevenueCredits } from "../services/revenue-allocation.service";
import { deriveVatSupplyType } from "../services/vat-supply-type";
import { resolveInvoiceFx, toBaseCurrencyAmount } from "../services/invoice-fx";
import { checkPostedInvoiceEdit } from "../services/posted-invoice-lock.service";
import { normalizeUnitPrice } from "../services/document-line-limits";
import {
  bucketLines,
  compareBuckets,
  effectiveRevenueAccountId,
  findBucketExcess,
  remainderBuckets,
  remainingByAccount,
  remainingLines,
  remainingVatBuckets,
  resolveCreditLineAccount,
  reverseToZero,
  type RevenueCtx,
} from "../services/credit-note-remainder.service";
import { requiredQuantity, requiredUnitPrice } from "../services/document-line-limits";
import { recordAudit } from "../services/audit.service";
import { createLogger } from "../config/logger";
import { UAE_VAT_RATE, ACCOUNT_CODES } from "../constants";
import {
  allocateInvoiceNumber,
  peekNextInvoiceNumber,
} from "../services/invoice-numbering.service";
import { assertRetentionExpired } from "../services/retention.service";
import { resolveDocumentExchangeRate } from "../services/document-fx-rate";

const log = createLogger("invoices");

// The issue could not complete after stock was consumed: return it and reverse the COGS journal.
async function undoIssueCogs(invoice: Invoice, userId: string): Promise<void> {
  const now = new Date();
  await withDocumentLock(invoice.id, LOCK_NS.INVOICE_POSTING, (tx: typeof db) =>
    restockInvoiceInTx(tx, {
      invoice,
      userId,
      requested: null,
      reversalDate: invoice.date instanceof Date ? invoice.date : new Date(invoice.date),
      postedAt: now,
      source: { id: invoice.id, label: `Issue of Invoice ${invoice.number} not completed` },
      reason: "Issue not completed",
    })
  );
}

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

// The document total must fit numeric(15,2) (largest value 9,999,999,999,999.99)
// with room for the VAT uplift. Per-line quantity / unit-price limits live in
// document-line-limits (shared with quotes, credit notes, POs, recurring).
const MAX_DOCUMENT_TOTAL = 9_000_000_000_000; // 9 trillion

const invoiceLineObject = z.object({
  description: z.string().trim().min(1, "Line description is required").max(1000),
  quantity: requiredQuantity,
  unitPrice: requiredUnitPrice,
  // UAE has exactly two VAT rates: 0% (zero-rated/exempt lines) and 5%
  // (standard). Accept either decimal (0.05) or percent (5) form — a typo
  // like 0.5 must be rejected, not silently baked into a tax invoice.
  vatRate: z.coerce
    .number()
    .finite()
    .transform((v) => (v === 5 ? UAE_VAT_RATE : v))
    .pipe(
      z.number().refine((v) => v === 0 || v === UAE_VAT_RATE, {
        message: "VAT rate must be 0% or 5% (UAE)",
      })
    )
    .default(UAE_VAT_RATE),
  // Optional: standard_rated | zero_rated | exempt | out_of_scope. Normalised
  // below so a 0% line is never stored as standard-rated by default.
  vatSupplyType: z
    .enum(["standard_rated", "zero_rated", "exempt", "out_of_scope"])
    .optional()
    .nullable(),
  // Optional income account for this line's net amount (null = default account).
  revenueAccountId: z.string().uuid("revenueAccountId must be a valid UUID").optional().nullable(),
  // Optional product sold on this line. With "Post inventory to ledger" on, issuing the invoice
  // consumes its stock and posts cost of goods sold (inventory-costing.service).
  productId: z.string().uuid("productId must be a valid UUID").optional().nullable(),
});

// The RATE decides the supply type (deriveVatSupplyType): a taxed line is
// always standard-rated, whatever type was sent.
const withDerivedSupplyType = <T extends { vatRate: number; vatSupplyType?: string | null }>(
  line: T
) => ({
  ...line,
  vatSupplyType: deriveVatSupplyType(line.vatRate, line.vatSupplyType),
});

const invoiceLineInputSchema = invoiceLineObject.transform(withDerivedSupplyType);

// A credit-note line may name the original invoice line it credits, so the
// revenue account is resolved from that id instead of matching descriptions.
const creditNoteLineInputSchema = invoiceLineObject
  .extend({ originalLineId: z.string().uuid("originalLineId must be a valid UUID").optional().nullable() })
  .transform(withDerivedSupplyType);

const invoiceLinesInputSchema = z
  .array(invoiceLineInputSchema)
  .min(1, "At least one invoice line is required");

type InvoiceLineInput = z.infer<typeof invoiceLineInputSchema>;
type CreditNoteLineInput = z.infer<typeof creditNoteLineInputSchema>;

function calculateInvoiceTotals(lines: InvoiceLineInput[]) {
  let subtotalD = new Decimal(0);
  let vatAmountD = new Decimal(0);

  for (const line of lines) {
    const lineTotal = new Decimal(line.unitPrice).times(line.quantity);
    subtotalD = subtotalD.plus(lineTotal);
    vatAmountD = vatAmountD.plus(lineTotal.times(line.vatRate ?? UAE_VAT_RATE));
  }

  return {
    subtotal: subtotalD.toDecimalPlaces(2).toNumber(),
    vatAmount: vatAmountD.toDecimalPlaces(2).toNumber(),
    total: subtotalD.plus(vatAmountD).toDecimalPlaces(2).toNumber(),
  };
}

function normalizeOptionalInvoiceDateField(
  data: Record<string, any>,
  field: "dueDate"
): { ok: true } | { ok: false; message: string } {
  if (data[field] === undefined) return { ok: true };
  if (data[field] === null || data[field] === "") {
    data[field] = null;
    return { ok: true };
  }

  const parsed = data[field] instanceof Date ? data[field] : new Date(data[field]);
  if (Number.isNaN(parsed.getTime())) {
    return { ok: false, message: `Invalid invoice ${field}` };
  }
  data[field] = parsed;
  return { ok: true };
}

const round2Num = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

type JournalLineLike = Record<string, any> & {
  accountId: string;
  debit: number;
  credit: number;
  description: string;
};

// Default / zero-rated income accounts of a chart: what a line with no revenue
// account of its own posts to (see invoice-posting.service). Undefined when the
// chart has no default revenue account.
function revenueContextOf(
  accounts: Array<{ id: string; type: string; code: string; isSystemAccount?: boolean | null }>
): RevenueCtx | undefined {
  const defaultAccount = accounts.find(
    (a) =>
      a.isSystemAccount &&
      a.type === "income" &&
      (a.code === ACCOUNT_CODES.REVENUE || a.code === ACCOUNT_CODES.REVENUE_ALT)
  );
  if (!defaultAccount) return undefined;
  const zeroRated = accounts.find(
    (a) => a.type === "income" && a.code === ACCOUNT_CODES.ZERO_RATED_SALES
  );
  return { defaultAccountId: defaultAccount.id, zeroRatedAccountId: zeroRated?.id ?? null };
}

// Foreign-currency invoices keep the document-currency amount on the AR leg of
// a reversal, like the original posting did (the ledger amounts stay AED).
function withForeignReceivable(
  lines: JournalLineLike[],
  receivableId: string,
  fx: { currency: string; rate: number; isForeign: boolean },
  docAmount: number
): JournalLineLike[] {
  if (!fx.isForeign) return lines;
  return lines.map((l) =>
    l.accountId === receivableId && l.credit > 0
      ? { ...l, foreignCurrency: fx.currency, exchangeRate: fx.rate, foreignCredit: docAmount }
      : l
  );
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

      res.json({ ...invoice, ...invoiceBalanceFields(invoice, balance), lines });
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
      const { lines, date, ...invoiceData } = req.body;
      // Only the opening-balance flow may mark an invoice as an opening balance.
      delete (invoiceData as any).isOpeningBalance;
      const parsedLines = invoiceLinesInputSchema.parse(lines);

      // Check if user has access to this company
      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: "Access denied" });
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

      // Calculate totals using decimal.js to avoid binary-float drift on
      // NUMERIC(15,2) columns. Sums are kept as Decimal until the very end.
      const { subtotal, vatAmount, total } = calculateInvoiceTotals(parsedLines);

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
      const invoiceDate = typeof date === "string" ? new Date(date) : date;
      if (!(invoiceDate instanceof Date) || Number.isNaN(invoiceDate.getTime())) {
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
          })
          .returning();

        for (const line of parsedLines) {
          await tx.insert(invoiceLinesTable).values({
            invoiceId: insertedInvoice.id,
            ...line,
          });
        }

        return { allocatedNumber: number, invoice: insertedInvoice };
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

      res.json(invoice);
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
      const { lines, date, ...invoiceData } = req.body;
      delete (invoiceData as any).isOpeningBalance;
      const parsedLines = invoiceLinesInputSchema.parse(lines);

      const invoice = await findInvoiceForUser(userId, id);
      if (!invoice) {
        return res.status(404).json({ message: "Invoice not found" });
      }
      if ((invoice as any).isOpeningBalance) {
        return res.status(409).json({
          message: "This invoice was entered as an opening balance and cannot be edited. Reverse the opening balances to change it.",
          code: "OPENING_BALANCE_INVOICE",
        });
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

      // Recompute totals from lines using decimal.js for precise money math.
      const { subtotal, vatAmount, total } = calculateInvoiceTotals(parsedLines);
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
        const storedRate = resolveInvoiceFx(invoice as any).rate;
        const requestedRate = Number(invoiceData.exchangeRate) > 0 ? Number(invoiceData.exchangeRate) : storedRate;
        const verdict = checkPostedInvoiceEdit({
          before: { lines: existingLines as any[], subtotal: Number(invoice.subtotal), rate: storedRate },
          after: { lines: parsedLines, subtotal, rate: requestedRate },
          defaultAccountId: revenueCtx?.defaultAccountId ?? null,
          zeroRatedAccountId: revenueCtx?.zeroRatedAccountId ?? null,
        });
        if (!verdict.ok) {
          return res.status(422).json({ message: verdict.message, code: verdict.code });
        }
      }

      const invoiceDate = typeof date === "string" ? new Date(date) : date;
      if (invoiceDate && (!(invoiceDate instanceof Date) || Number.isNaN(invoiceDate.getTime()))) {
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

      // Update invoice
      const updatedInvoice = await storage.updateInvoice(id, invoice.companyId, {
        ...invoiceData,
        date: invoiceDate,
        subtotal,
        vatAmount,
        total,
        exchangeRate: fxRate,
        baseCurrencyAmount: Math.round(total * fxRate * 100) / 100,
      });

      await storage.deleteInvoiceLinesByInvoiceId(id);
      for (const line of parsedLines) {
        await storage.createInvoiceLine({
          invoiceId: id,
          ...line,
        });
      }

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
      res.json(updatedInvoice);
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

      try {
        await storage.safeDeleteInvoice(id);
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
      // 'credited' is derived from the credit notes; it cannot be set by hand.
      if (status === "credited") {
        return res.status(422).json({
          message: "An invoice becomes 'credited' automatically when credit notes cover its full amount.",
          code: "CREDITED_IS_AUTOMATIC",
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

      // Marking paid records the cash still owed. With nothing outstanding
      // (fully credited or already settled) there is nothing to record: refuse
      // before anything else so a credited invoice cannot be "settled" a second time.
      let outstandingNow = 0;
      if (status === "paid" && oldStatus !== "paid") {
        const balance = await getInvoiceBalance(invoice.companyId, id);
        outstandingNow = balance.outstanding;
        if (
          invoice.status !== "draft" &&
          invoice.status !== "void" &&
          invoice.status !== "cancelled" &&
          balance.outstanding <= 0.005
        ) {
          return res.status(409).json({
            message: balance.isFullyCredited
              ? `Invoice ${invoice.number} is fully credited: nothing is outstanding to mark as paid.`
              : `Invoice ${invoice.number} has nothing outstanding to mark as paid.`,
            code: "INVOICE_NOTHING_OUTSTANDING",
          });
        }
      }

      // No-op transition is fine.
      if (oldStatus !== status && !canTransition(oldStatus, status)) {
        return res.status(422).json({
          message: `Invalid invoice status transition: ${oldStatus} → ${status}`,
          code: "INVALID_TRANSITION",
          allowed: { from: oldStatus, to: status },
        });
      }

      // 'paid' transition through this endpoint records the full payment via
      // the transactional helper so we share the race-safe code path.
      if (status === "paid" && oldStatus !== "paid") {
        if (!paymentAccountId) {
          return res
            .status(400)
            .json({ message: "Payment account is required when marking invoice as paid" });
        }
        const paymentAccount = await storage.getAccount(paymentAccountId, invoice.companyId);
        if (!paymentAccount) {
          return res.status(400).json({ message: "Invalid payment account" });
        }
        if (paymentAccount.type !== "asset") {
          return res
            .status(400)
            .json({ message: "Payment account must be a cash or bank account" });
        }

        const accounts = await storage.getAccountsByCompanyId(invoice.companyId);
        const accountsReceivable = accounts.find(
          (a) => a.code === ACCOUNT_CODES.AR && a.isSystemAccount
        );
        if (!accountsReceivable) {
          return res.status(500).json({ message: "Accounts Receivable account not found" });
        }

        // The settlement journal is posted on the real payment date (optional
        // `paymentDate` / `date` in the body, default today). Validated: not in
        // the future, not before the invoice date, and not in a locked period.
        const { date: paymentDate } = await resolveSettlementDate(invoice.companyId, {
          requested: req.body.paymentDate ?? req.body.date,
        });

        // The unpaid remainder: total - payments - credit notes (shared
        // definition). Never the bare total, or a credited invoice would be
        // settled for cash that is not owed.
        const remaining = outstandingNow;

        try {
          if (remaining > 0.005) {
            await storage.recordInvoicePayment({
              invoiceId: id,
              companyId: invoice.companyId,
              amount: remaining,
              date: paymentDate,
              method: "manual",
              reference: null,
              notes: "Marked paid via status update",
              paymentAccountId,
              paymentAccountCurrency: (paymentAccount as any).currency ?? null,
              receivableAccountId: accountsReceivable.id,
              createdBy: userId,
            });
          } else {
            await storage.updateInvoiceStatus(id, invoice.companyId, "paid");
          }
        } catch (err: any) {
          if (err?.code === "INVOICE_NOTHING_OUTSTANDING") {
            return res.status(409).json({ message: err.message, code: err.code });
          }
          if (err?.code === "INVOICE_TERMINAL") {
            return res.status(422).json({ message: err.message, code: err.code });
          }
          if (err?.code === "CURRENCY_MISMATCH") {
            return res.status(422).json({ message: err.message, code: err.code });
          }
          throw err;
        }
      } else if (oldStatus !== status) {
        // Issuing the invoice (draft → sent/posted) is the revenue-recognition
        // event: post the AR/Revenue/VAT journal entry now. Idempotent — data
        // created before drafts stopped auto-posting is skipped.
        if (oldStatus === "draft" && (status === "sent" || status === "posted")) {
          await assertPeriodNotLocked(invoice.companyId, invoice.date);
          // A-4: do not recognise revenue with a future invoice date.
          assertNotFutureDate(invoice.date);
          // Inventory first: stock is checked and consumed (and COGS posted) in one transaction
          // BEFORE revenue is recognised, so a short-stock invoice is refused with 422
          // INSUFFICIENT_STOCK and nothing has been posted. If revenue then cannot post, the
          // stock effect is undone below.
          const cogs = await postCogsForInvoice(invoice as any, userId);
          let posted: boolean;
          try {
            posted = await postInvoiceRevenueJournal(invoice as any, userId);
          } catch (err) {
            if (cogs.consumed) await undoIssueCogs(invoice as any, userId);
            throw err;
          }
          const existing = await storage.getJournalEntriesBySource(
            invoice.companyId,
            "invoice",
            id
          );
          // postInvoiceRevenueJournal returns false both for "already posted"
          // (fine) and "missing accounts" (NOT fine) — distinguish via the GL.
          if (!posted && !existing.some((e) => e.status === "posted")) {
            if (cogs.consumed) await undoIssueCogs(invoice as any, userId);
            return res.status(422).json({
              message:
                "Cannot issue invoice: revenue accounts are missing from the chart of accounts. Seed the default chart first (POST /api/companies/:id/seed-accounts).",
              code: "CHART_OF_ACCOUNTS_MISSING",
            });
          }
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
          });
          if (!outcome.ok) {
            return res.status(outcome.status).json({ message: outcome.message, code: outcome.code });
          }
        } else {
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

      if (status !== oldStatus && (status === "paid" || status === "void")) {
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
      if (!invoice) {
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

      // Return sanitized data (no internal IDs exposed except what's needed)
      res.json({
        invoice: {
          number: invoice.number,
          customerName: invoice.customerName,
          customerTrn: invoice.customerTrn,
          date: invoice.date,
          currency: invoice.currency,
          subtotal: invoice.subtotal,
          vatAmount: invoice.vatAmount,
          total: invoice.total,
          status: invoice.status,
        },
        lines: lines.map((l) => ({
          description: l.description,
          quantity: l.quantity,
          unitPrice: l.unitPrice,
          vatRate: l.vatRate,
          vatSupplyType: l.vatSupplyType,
        })),
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

      // An opening-balance invoice recognised no revenue or VAT (it is inside the opening
      // balances), so a credit note would reverse amounts that never posted.
      if ((original as any).isOpeningBalance) {
        return res.status(409).json({
          message:
            "This invoice was entered as an opening balance and has no revenue or VAT posting to reverse. Record a customer credit or reverse the opening balances instead.",
          code: "OPENING_BALANCE_INVOICE",
        });
      }

      // A credit note reverses revenue that was RECOGNISED. A draft was never
      // posted, and a void / cancelled invoice was already reversed in full:
      // crediting either would debit revenue and VAT that never stood on the
      // ledger. (A credit note of a credit note keeps its own CN_OF_CN error.)
      if (
        original.invoiceType !== "credit_note" &&
        (original.status === "draft" || original.status === "void" || original.status === "cancelled")
      ) {
        return res.status(409).json({
          message: `Cannot issue a credit note for a ${original.status} invoice: it has no posted journal entry to reverse.`,
          code: "INVOICE_NOT_POSTED",
        });
      }

      // PARTIAL CREDIT NOTES.
      //
      // Previously this endpoint accepted a `lines` payload and silently threw
      // it away, always crediting the FULL original. Asking to credit 400 of a
      // 1,050 invoice returned 201 with a credit note for 1,050 — reversing all
      // the output VAT when only part of the supply was returned, which
      // UNDER-DECLARES VAT to the FTA.
      //
      // Now: supply `lines` to credit exactly those lines; omit them for a full
      // reversal (the UI sends `{}` and keeps that behaviour). The amount is
      // capped against the remaining uncredited balance below.
      const requestedLines = (req.body as any)?.lines;
      let creditLines: CreditNoteLineInput[] | null = null;
      let creditAmounts: { subtotal: number; vatAmount: number; total: number } | null = null;
      if (requestedLines !== undefined && requestedLines !== null) {
        if (!Array.isArray(requestedLines) || requestedLines.length === 0) {
          return res.status(422).json({
            message: "Credit note `lines` must be a non-empty array. Omit it entirely to credit the full invoice.",
            code: "INVALID_CREDIT_LINES",
          });
        }
        creditLines = z.array(creditNoteLineInputSchema).parse(requestedLines);
        const creditRevenueCheck = await checkRevenueAccountsForCompany(
          companyId,
          creditLines.map((l) => l.revenueAccountId)
        );
        if (!creditRevenueCheck.ok) {
          return res
            .status(creditRevenueCheck.status)
            .json({ message: creditRevenueCheck.message, code: creditRevenueCheck.code });
        }
        const creditProductCheck = await checkProductsForCompany(companyId, creditLines.map((l) => l.productId));
        if (!creditProductCheck.ok) {
          return res
            .status(creditProductCheck.status)
            .json({ message: creditProductCheck.message, code: creditProductCheck.code });
        }
        creditAmounts = calculateInvoiceTotals(creditLines);
        if (!Number.isFinite(creditAmounts.total) || Math.abs(creditAmounts.total) > MAX_DOCUMENT_TOTAL) {
          return res.status(422).json({
            message: `Credit note total is too large to record (limit ${MAX_DOCUMENT_TOTAL.toLocaleString()}).`,
            code: "AMOUNT_OUT_OF_RANGE",
          });
        }
      }

      // The invoice's own currency and rate: the credit note is stored in the
      // same currency at the SAME rate, and the reversing journal is posted in
      // AED at that rate (never in document currency).
      const fx = resolveInvoiceFx(original);

      // A-B3: de-duplicate and cap credit notes. Without this, issuing two full
      // credit notes double-reverses AR and drives it negative. We sum the
      // absolute totals of any existing credit notes for this invoice and
      // refuse to credit beyond the original total.
      // Concurrency: the cap below is a check-then-write. Five parallel credit
      // notes each read "nothing credited yet" and all five posted, crediting
      // one invoice 5x and driving A/R negative. Serialise per invoice so the
      // cap is evaluated against committed state.
      // Everything below that does NOT depend on the locked state is read BEFORE
      // the transaction opens (same pattern as invoice-void.service). Inside the
      // lock every read goes through the transaction's own connection: with
      // DB_POOL_MAX connections, N waiting requests each hold one for their
      // transaction, so a lock holder that reached for a second pool connection
      // to read starved the pool and deadlocked the whole app.
      // TD5: honour a caller-supplied credit-note date (previously silently
      // ignored — CNs were always stamped "today", so a CN belonging to the
      // period being filed could never enter that period's VAT 201 or P&L).
      // Future dates are refused like invoices; the period lock is checked
      // against the ACTUAL document date.
      let cnDate = new Date();
      const requestedCnDate = (req.body as any)?.date;
      if (requestedCnDate !== undefined && requestedCnDate !== null) {
        const parsed = new Date(requestedCnDate);
        if (isNaN(parsed.getTime())) {
          return res.status(422).json({
            message: "Credit note `date` is not a valid date.",
            code: "INVALID_CREDIT_NOTE_DATE",
          });
        }
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        if (parsed > tomorrow) {
          return res.status(422).json({
            message: "Credit note `date` cannot be in the future.",
            code: "CREDIT_NOTE_DATE_IN_FUTURE",
          });
        }
        cnDate = parsed;
      }
      await assertPeriodNotLocked(companyId, cnDate);

      // A-B2 / defect 9: EVERYTHING that can reject the credit note (accounts,
      // revenue split, balance) is computed here, BEFORE any row is written.
      // The document and its journal entry are then inserted in one
      // transaction, so a failure can no longer leave an orphan credit note
      // (with a consumed number) and no journal entry.
      const cnAccounts = await storage.getAccountsByCompanyId(companyId);
      const cnReceivable = cnAccounts.find(
        (a) => a.code === ACCOUNT_CODES.AR && a.isSystemAccount
      );
      const cnVatPayable = cnAccounts.find(
        (a) => a.isVatAccount && a.vatType === "output" && a.code === ACCOUNT_CODES.VAT_OUTPUT
      );
      const revenueCtx = revenueContextOf(cnAccounts);
      if (!revenueCtx || !cnReceivable) {
        return res.status(422).json({
          message:
            "Cannot post reversal: Accounts Receivable or Revenue account is missing. Seed the default chart of accounts first.",
          code: "CHART_OF_ACCOUNTS_MISSING",
        });
      }

      const originalLines = await storage.getInvoiceLinesByInvoiceId(invoiceId);

      const outcome = await withDocumentLock(invoiceId, LOCK_NS.CREDIT_NOTE, async (lockTx: typeof db) => {
      const creditNotesOfInvoice: Invoice[] = await lockTx
        .select()
        .from(invoicesTable)
        .where(
          and(
            eq(invoicesTable.companyId, companyId),
            eq(invoicesTable.originalInvoiceId, invoiceId),
            eq(invoicesTable.invoiceType, "credit_note")
          )
        );
      const existingCreditNotes = creditNotesOfInvoice.filter(
        (i) => i.status !== "void" && i.status !== "cancelled"
      );
      const alreadyCreditedTotal = existingCreditNotes.reduce(
        (sum, i) => sum + Math.abs(Number(i.total)),
        0
      );
      const cnDecision = evaluateCreditNoteRequest({
        invoiceType: original.invoiceType ?? "invoice",
        originalTotal: Number(original.total),
        alreadyCreditedTotal,
        // Cap a partial credit at what is still uncreditable. Omitted (full
        // reversal) defaults to the whole remaining balance.
        requestedAmount: creditAmounts ? creditAmounts.total : undefined,
      });
      if (!cnDecision.ok) {
        return res.status(cnDecision.status).json({ message: cnDecision.message, code: cnDecision.code });
      }



      // What is already on the ledger for this invoice (AED, as posted): its
      // own entry plus the entries of the credit notes issued so far.
      const originalEntries: JournalEntry[] = await lockTx
        .select()
        .from(journalEntriesTable)
        .where(
          and(
            eq(journalEntriesTable.companyId, companyId),
            eq(journalEntriesTable.source, "invoice"),
            eq(journalEntriesTable.sourceId, invoiceId)
          )
        );
      const originalEntry = selectVoidableEntries(originalEntries).original;
      if (!originalEntry) {
        // e.g. an invoice created before drafts stopped auto-posting, or one whose
        // entry was voided: there is nothing on the ledger to reverse.
        return res.status(409).json({
          message: "Cannot issue a credit note: this invoice has no posted journal entry to reverse.",
          code: "INVOICE_NOT_POSTED",
        });
      }
      const priorCreditNoteIds = existingCreditNotes.map((c) => c.id);
      const priorEntries: JournalEntry[] =
        priorCreditNoteIds.length > 0
          ? await lockTx
              .select()
              .from(journalEntriesTable)
              .where(
                and(
                  eq(journalEntriesTable.companyId, companyId),
                  eq(journalEntriesTable.source, "invoice"),
                  inArray(journalEntriesTable.sourceId, priorCreditNoteIds)
                )
              )
          : [];
      const priorEntryIds: string[] = priorEntries.filter((e) => e.status === "posted").map((e) => e.id);
      const entryIdsForLedger = [originalEntry.id, ...priorEntryIds];
      const ledgerSourceLines: JournalLine[] = originalEntry
        ? await lockTx
            .select()
            .from(journalLinesTable)
            .where(inArray(journalLinesTable.entryId, entryIdsForLedger))
        : [];
      const ledgerLines = originalEntry
        ? ledgerSourceLines.map((l) => ({
            accountId: l.accountId,
            debit: Number(l.debit) || 0,
            credit: Number(l.credit) || 0,
          }))
        : [];
      const existingCreditLines =
        priorCreditNoteIds.length > 0
          ? await lockTx
              .select()
              .from(invoiceLinesTable)
              .where(inArray(invoiceLinesTable.invoiceId, priorCreditNoteIds))
          : [];

      // The credit note lines, each carrying the revenue account it reverses.
      //
      // INVARIANT: the document lines must always agree with what the journal
      // reverses, per VAT rate / supply type and per revenue account, because
      // the VAT engines read the document lines while the ledger is reversed
      // from the journal. So:
      //  * a credit note that brings the invoice to fully credited (explicit
      //    full credit, omitted lines, or a final partial) gets its lines BUILT
      //    from what is left of each original line; lines the client sent must
      //    match that remainder bucket for bucket (else 422);
      //  * a partial one is capped per VAT bucket, not only per account.
      let creditSubtotal: number;
      let creditVat: number;
      let creditTotal: number;
      let docLines: Array<{
        description: string;
        quantity: number;
        unitPrice: number;
        vatRate: number;
        vatSupplyType: string;
        revenueAccountId: string;
      }>;
      let bringsToFullyCredited: boolean;
      const creditWasCapped = !creditLines && existingCreditNotes.length > 0;

      let resolvedCreditLines: Array<{
        description: string;
        quantity: number;
        unitPrice: number;
        vatRate: number;
        vatSupplyType: string;
        revenueAccountId: string;
      }> | null = null;
      if (creditLines) {
        const resolved: Array<{ accountId: string }> = [];
        for (const l of creditLines) {
          const r = resolveCreditLineAccount(l, originalLines as any[], revenueCtx);
          if (!r.ok) return res.status(400).json({ message: r.message, code: r.code });
          resolved.push({ accountId: r.accountId });
        }
        creditSubtotal = creditAmounts!.subtotal;
        creditVat = creditAmounts!.vatAmount;
        creditTotal = creditAmounts!.total;
        resolvedCreditLines = creditLines.map((l, i) => {
          // A line that names the original line it credits takes that line's
          // supply type (a 0% exempt sale is credited as exempt, not zero-rated).
          const named = l.originalLineId
            ? (originalLines as any[]).find((o) => o.id === l.originalLineId)
            : undefined;
          const supply =
            named && Number(named.vatRate) === Number(l.vatRate)
              ? deriveVatSupplyType(Number(named.vatRate), named.vatSupplyType)
              : l.vatSupplyType;
          return {
            description: `[Credit] ${l.description}`,
            quantity: -l.quantity,
            unitPrice: l.unitPrice,
            vatRate: l.vatRate,
            vatSupplyType: supply,
            revenueAccountId: resolved[i].accountId,
          };
        });
        bringsToFullyCredited =
          round2Num(alreadyCreditedTotal + creditTotal) >= round2Num(Math.abs(Number(original.total))) - 0.005;
      } else {
        bringsToFullyCredited = true;
      }

      if (bringsToFullyCredited) {
        if (resolvedCreditLines) {
          const expected = remainderBuckets({
            originalLines: originalLines as any[],
            creditedLines: existingCreditLines as any[],
            ctx: revenueCtx,
          });
          const supplied = bucketLines(resolvedCreditLines as any[], revenueCtx, { byAccount: true });
          const match = compareBuckets(expected, supplied);
          if (!match.ok) {
            return res.status(422).json({
              message:
                "This credit note takes the invoice to fully credited, but its lines do not match what is left of the invoice per VAT rate, supply type and revenue account. Credit exactly the remaining lines, or omit `lines` to credit the remainder.",
              code: "CREDIT_NOTE_LINES_MISMATCH",
              expectedBuckets: match.expected,
              suppliedBuckets: match.supplied,
            });
          }
        }
        const originalAbs = Math.abs(Number(original.total));
        if (existingCreditNotes.length === 0) {
          // Nothing credited yet: mirror every original line.
          creditSubtotal = Number(original.subtotal);
          creditVat = Number(original.vatAmount);
          creditTotal = Number(original.total);
          docLines = originalLines.map((l) => ({
            description: `[Credit] ${l.description}`,
            quantity: -Number(l.quantity),
            unitPrice: Number(l.unitPrice),
            vatRate: Number(l.vatRate),
            vatSupplyType: deriveVatSupplyType(Number(l.vatRate), l.vatSupplyType),
            revenueAccountId: effectiveRevenueAccountId(l as any, revenueCtx),
          }));
        } else {
          // TD4 / defect 3: credit exactly what is LEFT, per line and per
          // account - not the original scaled by one factor, which reversed
          // the wrong accounts whenever an earlier partial credit note had
          // touched only some of them.
          const left = remainingLines({
            originalLines: originalLines as any[],
            creditedLines: existingCreditLines as any[],
            ctx: revenueCtx,
          });
          creditTotal = round2Num(originalAbs - round2Num(alreadyCreditedTotal));
          const leftAccounts = remainingByAccount({
            originalLines: originalLines as any[],
            creditedLines: existingCreditLines as any[],
            ctx: revenueCtx,
          });
          creditSubtotal = round2Num(leftAccounts.accounts.reduce((s, a) => s + a.net, 0));
          // Derive VAT from the difference so subtotal + VAT = total exactly.
          creditVat = round2Num(creditTotal - creditSubtotal);
          docLines = left.map((l) => ({
            description: `[Credit] ${l.description} (remaining balance)`,
            quantity: -1,
            unitPrice: normalizeUnitPrice(l.net),
            vatRate: l.vatRate,
            vatSupplyType: deriveVatSupplyType(l.vatRate, l.vatSupplyType),
            revenueAccountId: l.revenueAccountId,
          }));
        }
      } else {
        // Partial: cap per VAT bucket (rate + supply type) - "no more at 5%
        // than remains at 5%" - on top of the per-account cap on the ledger.
        docLines = resolvedCreditLines!;
        const excess = findBucketExcess(
          remainingVatBuckets({
            originalLines: originalLines as any[],
            creditedLines: existingCreditLines as any[],
            ctx: revenueCtx,
          }),
          bucketLines(docLines as any[], revenueCtx)
        );
        if (excess) {
          return res.status(409).json({
            message: `This credit note takes back more at ${Math.round(excess.vatRate * 10000) / 100}% (${excess.supplyType.replace("_", " ")}) than remains on the invoice at that VAT rate after the earlier credit notes.`,
            code: "CREDIT_EXCEEDS_VAT_BUCKET",
            bucket: excess,
          });
        }
      }

      // The reversing legs, in AED. The final credit note reverses what is
      // actually standing on the ledger (posted minus already reversed), so
      // AR, revenue and VAT each land on exactly 0.00 whatever the FX rate and
      // rounding. A partial one converts its own amounts at the invoice rate.
      const reversalLabels = (cnNumber: string) => ({
        revenue: `Reverse revenue - ${cnNumber}`,
        vat: `Reverse VAT - ${cnNumber}`,
        ar: `Reduce A/R - ${cnNumber}`,
      });
      const buildLegs = (
        cnNumber: string
      ):
        | { ok: true; lines: JournalLineLike[]; baseSubtotal: number; baseVat: number; baseTotal: number }
        | { ok: false; status: number; code: string; message: string } => {
        const labels = reversalLabels(cnNumber);
        if (bringsToFullyCredited && ledgerLines.length > 0) {
          const legs = reverseToZero(ledgerLines, {
            arAccountId: cnReceivable.id,
            vatAccountId: cnVatPayable?.id ?? null,
            labels,
          });
          if (legs.length === 0) {
            return {
              ok: false,
              status: 409,
              code: "FULLY_CREDITED",
              message: "This invoice has already been fully credited.",
            };
          }
          const baseTotal = legs.filter((l) => l.accountId === cnReceivable.id).reduce((s, l) => s + l.credit, 0);
          const baseVat = legs.filter((l) => l.accountId === cnVatPayable?.id).reduce((s, l) => s + l.debit, 0);
          return {
            ok: true,
            lines: withForeignReceivable(legs, cnReceivable.id, fx, creditTotal),
            baseTotal: round2Num(baseTotal),
            baseVat: round2Num(baseVat),
            baseSubtotal: round2Num(baseTotal - baseVat),
          };
        }

        const baseSubtotal = toBaseCurrencyAmount(creditSubtotal, fx.rate);
        const baseVat = toBaseCurrencyAmount(creditVat, fx.rate);
        const built = buildReversalLines({
          amounts: { subtotal: baseSubtotal, vatAmount: baseVat, total: round2Num(baseSubtotal + baseVat) },
          accounts: {
            accountsReceivableId: cnReceivable.id,
            salesRevenueId: revenueCtx.defaultAccountId,
            vatPayableId: cnVatPayable?.id,
          },
          revenueSplit: allocateRevenueCredits({
            lines: docLines.map((l) => ({
              quantity: Math.abs(l.quantity),
              unitPrice: l.unitPrice,
              vatRate: l.vatRate,
              revenueAccountId: l.revenueAccountId,
            })),
            rate: fx.rate,
            subtotal: baseSubtotal,
            defaultAccountId: revenueCtx.defaultAccountId,
            zeroRatedAccountId: revenueCtx.zeroRatedAccountId ?? null,
          }),
          labels,
        });
        if (!built.ok) return built;

        // A partial credit note cannot take back more from an account (or from
        // VAT) than is still standing on it.
        if (ledgerLines.length > 0) {
          const standing = new Map(
            reverseToZero(ledgerLines, { arAccountId: cnReceivable.id, vatAccountId: cnVatPayable?.id ?? null, labels }).map(
              (l) => [l.accountId, l.debit]
            )
          );
          for (const leg of built.lines) {
            if (leg.debit > 0 && leg.debit > (standing.get(leg.accountId) ?? 0) + 0.01) {
              return {
                ok: false,
                status: 409,
                code: "CREDIT_EXCEEDS_ACCOUNT_BALANCE",
                message:
                  "This credit note would credit more to a revenue account (or to VAT) than is still standing on it after the earlier credit notes.",
              };
            }
          }
        }
        return {
          ok: true,
          lines: withForeignReceivable(built.lines, cnReceivable.id, fx, creditTotal),
          baseSubtotal,
          baseVat,
          baseTotal: round2Num(baseSubtotal + baseVat),
        };
      };

      const preflight = buildLegs("(pending)");
      if (!preflight.ok) {
        return res.status(preflight.status).json({ message: preflight.message, code: preflight.code });
      }

      // Allocate the credit-note number, insert the credit note + its lines
      // AND post its reversing journal entry in ONE transaction: gap-free
      // numbering (FTA) and a document that can never exist without its entry.
      const insertCreditNote = async (tx: typeof db) => {
        const number = await allocateInvoiceNumber(companyId, "credit_note", new Date(), tx);
        const legs = buildLegs(number);
        if (!legs.ok) {
          const e: any = new Error(legs.message);
          e.code = legs.code;
          throw e;
        }

        const [insertedCreditNote] = await tx
          .insert(invoicesTable)
          .values({
            companyId,
            number,
            customerName: original.customerName,
            // The credit note belongs to the same customer contact, so statements and refunds find it.
            contactId: original.contactId ?? null,
            customerTrn: original.customerTrn || undefined,
            date: cnDate,
            currency: original.currency,
            // VAT 201 converts every invoice row (credit notes included) with
            // its own stored rate: a foreign-currency credit note must carry
            // the original invoice's rate or it is counted as if it were AED.
            exchangeRate: fx.rate,
            baseCurrencyAmount: -legs.baseTotal,
            subtotal: -creditSubtotal,
            vatAmount: -creditVat,
            total: -creditTotal,
            status: "sent",
            invoiceType: "credit_note",
            originalInvoiceId: invoiceId,
          } as any)
          .returning();

        for (const line of docLines) {
          await tx.insert(invoiceLinesTable).values({
            invoiceId: insertedCreditNote.id,
            ...line,
          } as any);
        }

        await storage.createJournalEntry(
          {
            companyId,
            date: cnDate,
            memo:
              creditLines || creditWasCapped
                ? `Credit Note ${number} - partial credit of Invoice ${original.number}`
                : `Credit Note ${number} - reversal of Invoice ${original.number}`,
            entryNumber: "PENDING", // assigned inside the transaction
            status: "posted",
            source: "invoice",
            sourceId: insertedCreditNote.id,
            reversedEntryId: originalEntry?.id || null,
            reversalReason: "Credit note issued",
            createdBy: userId,
            postedBy: userId,
            postedAt: cnDate,
          } as any,
          legs.lines as any,
          { tx }
        );

        // The credit note reduces what the customer owes: a fully credited,
        // unpaid invoice becomes 'credited'; credit + payments that settle it
        // make it 'paid'.
        await syncInvoiceStatusFromBalance(tx, companyId, invoiceId);

        // Restocking credit note: only with `restock: true` does the stock come back (and COGS
        // reverse) - the goods are not assumed to be returned otherwise. Explicit credit lines
        // restock the products of the original lines they name (`originalLineId`), whole or
        // part quantities up to what was sold and not yet returned; a full credit note
        // (no `lines`) restocks everything still out.
        if ((req.body as any)?.restock === true) {
          await restockInvoiceInTx(tx, {
            invoice: original as any,
            userId,
            requested: restockRequestFromCreditLines(creditLines, originalLines as any[]),
            reversalDate: cnDate,
            postedAt: cnDate,
            source: { id: insertedCreditNote.id, label: `Credit Note ${number}` },
            reason: "Credit note restock",
            movementNotes: creditNoteRestockTag(insertedCreditNote.id),
          });
        }

        return { cnNumber: number, creditNote: insertedCreditNote };
      };
      const { cnNumber, creditNote } = await insertCreditNote(lockTx);

      return { created: { cnNumber, creditNote } };
      }); // end withDocumentLock

      // Non-success paths already answered the request from inside the lock.
      if (!outcome || !("created" in outcome)) return outcome;

      // Audit AFTER the lock is released: it uses the pool, and doing that while
      // holding the lock's connection is exactly what starved the pool.
      const { cnNumber, creditNote } = outcome.created;
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
