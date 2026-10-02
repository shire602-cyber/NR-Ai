import { type Express, type Request, type Response } from "express";
import { storage } from "../storage";
import { authMiddleware, requireCustomer } from "../middleware/auth";
import { asyncHandler } from "../middleware/errorHandler";
import { createLogger } from "../config/logger";
import { checkRevenueAccountsForCompany } from "../services/revenue-account-guard.service";
import { normalizeDocumentLines } from "../services/document-line-limits";
import { normaliseVatRate } from "../services/document-totals.service";
import { deriveVatSupplyType } from "../services/vat-supply-type";
import { deriveSalesLines } from "../../shared/sales-line-math";
import { db } from "../db";
import { customerContacts } from "../../shared/schema";
import { and, eq } from "drizzle-orm";

const MAX_TERMS_DAYS = 365;

/** The contact a template bills (must be this company's) and whether it has an email to auto-send to. */
async function loadTemplateContact(companyId: string, contactId: unknown) {
  if (contactId === undefined || contactId === null || contactId === "") return { ok: true as const, contact: null };
  if (typeof contactId !== "string" || !/^[0-9a-f-]{36}$/i.test(contactId)) {
    return { ok: false as const, code: "CONTACT_NOT_FOUND", message: "contactId is not a contact of this company." };
  }
  const [contact] = await db
    .select()
    .from(customerContacts)
    .where(and(eq(customerContacts.id, contactId), eq(customerContacts.companyId, companyId)));
  if (!contact) return { ok: false as const, code: "CONTACT_NOT_FOUND", message: "contactId is not a contact of this company." };
  return { ok: true as const, contact };
}

function parseTermsDays(value: unknown): { ok: true; value: number | null } | { ok: false } {
  if (value === undefined || value === null || value === "") return { ok: true, value: null };
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 && n <= MAX_TERMS_DAYS ? { ok: true, value: n } : { ok: false };
}

// A template whose lines cannot be derived (a discount above its line, two shipping lines) would fail every run.
function derivationProblem(linesJson: unknown): { code: string; message: string } | null {
  try {
    const lines = JSON.parse(typeof linesJson === "string" ? linesJson : JSON.stringify(linesJson));
    if (!Array.isArray(lines)) return null;
    const res = deriveSalesLines({
      lines: lines.map((l: any) => ({
        kind: l?.lineKind === "shipping" ? "shipping" : "item",
        description: String(l?.description ?? ""),
        quantity: Number(l?.quantity),
        unitPrice: Number(l?.unitPrice),
        vatRate: normaliseVatRate(l?.vatRate),
        discountType: l?.lineKind === "shipping" ? null : (l?.discountType ?? null),
        discountValue: l?.lineKind === "shipping" ? null : (l?.discountValue ?? null),
      })),
    });
    return res.ok ? null : { code: res.code, message: res.message };
  } catch {
    return null;
  }
}

// Lines live as JSON on the template; pull out the revenue accounts the lines
// chose so they can be validated against the company chart.
function revenueAccountIdsOf(linesJson: unknown): string[] {
  try {
    const lines = JSON.parse(typeof linesJson === "string" ? linesJson : JSON.stringify(linesJson));
    return Array.isArray(lines)
      ? lines.map((l: any) => l?.revenueAccountId).filter((id: unknown): id is string => !!id)
      : [];
  } catch {
    return [];
  }
}

// Template lines are stored as JSON exactly as sent. Cap / round the amounts to
// what an invoice line can store (an oversized value is a clean 400 here rather
// than a failed run later) and let the RATE decide the supply type, so a stale
// exempt tag on a taxed line never reaches the generated invoices. Unparseable
// input is returned unchanged — the callers / scheduler already deal with it.
function normalizeTemplateLines(linesJson: unknown): string {
  const raw = typeof linesJson === "string" ? linesJson : JSON.stringify(linesJson);
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return raw;
  }
  if (!Array.isArray(parsed)) return raw;
  const lines = normalizeDocumentLines(parsed as Array<Record<string, any>>).map((line) => {
    const vatRate = normaliseVatRate(line?.vatRate);
    return { ...line, vatRate, vatSupplyType: deriveVatSupplyType(vatRate, line?.vatSupplyType) };
  });
  return JSON.stringify(lines);
}

const log = createLogger("recurring-invoices");

export function registerRecurringInvoiceRoutes(app: Express) {
  // =====================================
  // Recurring Invoice Routes
  // =====================================

  // List all recurring invoices for a company
  app.get(
    "/api/companies/:companyId/recurring-invoices",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const userId = (req as any).user.id;

      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: "Access denied" });
      }

      const items = await storage.getRecurringInvoicesByCompanyId(companyId);
      res.json(items);
    })
  );

  // Get a single recurring invoice
  app.get(
    "/api/recurring-invoices/:id",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { id } = req.params;
      const userId = (req as any).user.id;

      const item = await storage.getRecurringInvoice(id);
      if (!item) {
        return res.status(404).json({ message: "Recurring invoice not found" });
      }

      const hasAccess = await storage.hasCompanyAccess(userId, item.companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: "Access denied" });
      }

      res.json(item);
    })
  );

  // Create a recurring invoice
  app.post(
    "/api/companies/:companyId/recurring-invoices",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const userId = (req as any).user.id;

      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: "Access denied" });
      }

      const { customerTrn, currency, frequency, startDate, endDate } = req.body;
      let customerName = req.body.customerName;
      const autoSend = req.body.autoSend === true;
      const terms = parseTermsDays(req.body.paymentTermsDays);
      if (!terms.ok) {
        return res.status(422).json({ message: `paymentTermsDays must be a whole number from 0 to ${MAX_TERMS_DAYS}`, code: "INVALID_PAYMENT_TERMS" });
      }
      const contactResult = await loadTemplateContact(companyId, req.body.contactId);
      if (!contactResult.ok) return res.status(422).json({ message: contactResult.message, code: contactResult.code });
      if (contactResult.contact && !customerName) customerName = contactResult.contact.name;
      if (autoSend && !contactResult.contact?.email?.trim()) {
        return res.status(422).json({
          message: "Auto-send needs a customer contact with an email address.",
          code: "CONTACT_EMAIL_REQUIRED",
        });
      }

      // `linesJson` is the storage column name. Every other document endpoint in
      // this API takes `lines`, so accept that too rather than making callers
      // know the database schema.
      const linesJson = req.body.linesJson ?? req.body.lines;

      // Validate required fields
      if (!customerName || !frequency || !startDate || !linesJson) {
        return res.status(400).json({
          message: "customerName, frequency, startDate, and lines are required",
        });
      }

      // Validate frequency
      const validFrequencies = ["weekly", "monthly", "quarterly", "yearly"];
      if (!validFrequencies.includes(frequency)) {
        return res
          .status(400)
          .json({ message: "frequency must be one of: weekly, monthly, quarterly, yearly" });
      }

      // Validate linesJson is valid JSON with at least one line
      try {
        const lines = JSON.parse(
          typeof linesJson === "string" ? linesJson : JSON.stringify(linesJson)
        );
        if (!Array.isArray(lines) || lines.length === 0) {
          return res.status(400).json({ message: "linesJson must contain at least one line item" });
        }
      } catch {
        return res.status(400).json({ message: "linesJson must be valid JSON" });
      }

      const revenueCheck = await checkRevenueAccountsForCompany(
        companyId,
        revenueAccountIdsOf(linesJson)
      );
      if (!revenueCheck.ok) {
        return res.status(revenueCheck.status).json({ message: revenueCheck.message, code: revenueCheck.code });
      }
      const problem = derivationProblem(linesJson);
      if (problem) return res.status(422).json(problem);

      const parsedStartDate = new Date(startDate);
      const parsedEndDate = endDate ? new Date(endDate) : null;

      const item = await storage.createRecurringInvoice({
        companyId,
        customerName,
        customerTrn: customerTrn || null,
        currency: currency || "AED",
        frequency,
        startDate: parsedStartDate,
        nextRunDate: parsedStartDate,
        endDate: parsedEndDate,
        linesJson: normalizeTemplateLines(linesJson),
        isActive: true,
        lastGeneratedInvoiceId: null,
        totalGenerated: 0,
        contactId: contactResult.contact?.id ?? null,
        autoSend,
        paymentTermsDays: terms.value,
      } as any);

      log.info({ id: item.id, companyId }, "Created recurring invoice");
      res.json(item);
    })
  );

  // Update a recurring invoice
  app.patch(
    "/api/recurring-invoices/:id",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { id } = req.params;
      const userId = (req as any).user.id;

      const existing = await storage.getRecurringInvoice(id);
      if (!existing) {
        return res.status(404).json({ message: "Recurring invoice not found" });
      }

      const hasAccess = await storage.hasCompanyAccess(userId, existing.companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: "Access denied" });
      }

      const {
        customerName,
        customerTrn,
        currency,
        frequency,
        startDate,
        nextRunDate,
        endDate,
        linesJson,
      } = req.body;
      const patchTerms = parseTermsDays(req.body.paymentTermsDays);
      if (!patchTerms.ok) {
        return res.status(422).json({ message: `paymentTermsDays must be a whole number from 0 to ${MAX_TERMS_DAYS}`, code: "INVALID_PAYMENT_TERMS" });
      }
      const nextContactId = req.body.contactId !== undefined ? (req.body.contactId || null) : existing.contactId;
      const patchContact = await loadTemplateContact(existing.companyId, nextContactId);
      if (!patchContact.ok) return res.status(422).json({ message: patchContact.message, code: patchContact.code });
      const nextAutoSend = req.body.autoSend !== undefined ? req.body.autoSend === true : existing.autoSend;
      if (nextAutoSend && !patchContact.contact?.email?.trim()) {
        return res.status(422).json({
          message: "Auto-send needs a customer contact with an email address.",
          code: "CONTACT_EMAIL_REQUIRED",
        });
      }

      // Validate frequency if provided
      if (frequency) {
        const validFrequencies = ["weekly", "monthly", "quarterly", "yearly"];
        if (!validFrequencies.includes(frequency)) {
          return res
            .status(400)
            .json({ message: "frequency must be one of: weekly, monthly, quarterly, yearly" });
        }
      }

      if (linesJson !== undefined) {
        const revenueCheck = await checkRevenueAccountsForCompany(
          existing.companyId,
          revenueAccountIdsOf(linesJson)
        );
        if (!revenueCheck.ok) {
          return res.status(revenueCheck.status).json({ message: revenueCheck.message, code: revenueCheck.code });
        }
      }

      const updateData: any = {};
      if (customerName !== undefined) updateData.customerName = customerName;
      if (customerTrn !== undefined) updateData.customerTrn = customerTrn;
      if (currency !== undefined) updateData.currency = currency;
      if (frequency !== undefined) updateData.frequency = frequency;
      if (startDate !== undefined) updateData.startDate = new Date(startDate);
      if (nextRunDate !== undefined) updateData.nextRunDate = new Date(nextRunDate);
      if (endDate !== undefined) updateData.endDate = endDate ? new Date(endDate) : null;
      if (linesJson !== undefined) {
        const problem = derivationProblem(linesJson);
        if (problem) return res.status(422).json(problem);
        updateData.linesJson = normalizeTemplateLines(linesJson);
      }
      if (req.body.contactId !== undefined) updateData.contactId = patchContact.contact?.id ?? null;
      if (req.body.autoSend !== undefined) updateData.autoSend = nextAutoSend;
      if (req.body.paymentTermsDays !== undefined) updateData.paymentTermsDays = patchTerms.value;

      const item = await storage.updateRecurringInvoice(id, updateData);
      log.info({ id }, "Updated recurring invoice");
      res.json(item);
    })
  );

  // Toggle active status
  app.patch(
    "/api/recurring-invoices/:id/toggle",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { id } = req.params;
      const userId = (req as any).user.id;

      const existing = await storage.getRecurringInvoice(id);
      if (!existing) {
        return res.status(404).json({ message: "Recurring invoice not found" });
      }

      const hasAccess = await storage.hasCompanyAccess(userId, existing.companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: "Access denied" });
      }

      const item = await storage.updateRecurringInvoice(id, {
        isActive: !existing.isActive,
      });

      log.info({ id, isActive: item.isActive }, "Toggled recurring invoice");
      res.json(item);
    })
  );

  // Delete a recurring invoice
  app.delete(
    "/api/recurring-invoices/:id",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { id } = req.params;
      const userId = (req as any).user.id;

      const existing = await storage.getRecurringInvoice(id);
      if (!existing) {
        return res.status(404).json({ message: "Recurring invoice not found" });
      }

      const hasAccess = await storage.hasCompanyAccess(userId, existing.companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: "Access denied" });
      }

      await storage.deleteRecurringInvoice(id);
      log.info({ id }, "Deleted recurring invoice");
      res.json({ message: "Recurring invoice deleted successfully" });
    })
  );
}
