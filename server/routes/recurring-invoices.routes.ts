// Recurring invoice templates (W3-A: R03-12, R03-23).
//
// Templates are validated with the same line contract as invoices (supply type
// per line, discounts; 0% lines need an explicit supply type) and stored as a
// canonical linesJson. Generation (scheduler.service → generateFromTemplate)
// re-validates, computes totals with document-totals, carries the FX rate at
// generation, and posts through invoice-posting (supply-type split). Each
// template chooses draft vs auto-issue and optional auto-send.
import { type Express, type Request, type Response } from "express";
import { authMiddleware, requireCustomer } from "../middleware/auth";
import { asyncHandler } from "../middleware/errorHandler";
import { strictBody } from "../http/strict-body";
import { DomainError } from "../errors";
import { storage } from "../storage";
import { createLogger } from "../config/logger";
import {
  createRecurringInvoiceSchema,
  updateRecurringInvoiceSchema,
  type CreateRecurringInvoiceInput,
  type UpdateRecurringInvoiceInput,
} from "../../shared/validators/quotes";
import type { SalesLineInput } from "../../shared/validators/invoices";
import { prepareSalesLines } from "../services/invoice-lifecycle";
import { fromFils } from "../../shared/money";
import type { RecurringInvoice } from "../../shared/schema";

const log = createLogger("recurring-invoices");

const userOf = (req: Request): string => (req as Request & { user: { id: string } }).user.id;

/** The body after `strictBody(schema)` replaced it with the parsed, canonical value. */
function validated<T>(req: Request): T {
  return req.body as T;
}
const toDate = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

/** Validate template lines and store them canonically (unit price in major units). */
export function canonicalTemplateLines(lines: SalesLineInput[]): string {
  const { rows } = prepareSalesLines(
    lines.map((l) => ({
      description: l.description,
      quantity: l.quantity,
      unitPrice: l.unitPrice,
      vatRate: l.vatRate,
      vatSupplyType: l.vatSupplyType ?? null,
      discountType: l.discountType ?? null,
      discountValue: l.discountValue ?? null,
      productId: l.productId ?? null,
      costCenterId: l.costCenterId ?? null,
    }))
  );
  return JSON.stringify(
    rows.map((r) => ({
      description: r.description,
      quantity: r.quantity,
      unitPrice: fromFils(r.unitPriceFils),
      vatRate: r.vatRate,
      vatSupplyType: r.vatSupplyType,
      ...(r.discountType ? { discountType: r.discountType, discountValue: r.discountValue } : {}),
      ...(r.productId ? { productId: r.productId } : {}),
      ...(r.costCenterId ? { costCenterId: r.costCenterId } : {}),
    }))
  );
}

async function templateForUser(userId: string, id: string): Promise<RecurringInvoice> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new DomainError("RECURRING_INVOICE_NOT_FOUND", 404);
  const item = await storage.getRecurringInvoice(id);
  if (!item || !(await storage.hasCompanyAccess(userId, item.companyId))) {
    throw new DomainError(
      "RECURRING_INVOICE_NOT_FOUND",
      404,
      undefined,
      "Recurring invoice not found"
    );
  }
  return item;
}

async function customerNameFor(
  companyId: string,
  contactId: string | null | undefined,
  name: string | undefined
): Promise<string> {
  if (name && name.trim()) return name.trim();
  if (contactId) {
    const contact = await storage.getCustomerContact(contactId);
    if (!contact || contact.companyId !== companyId) {
      throw new DomainError("CONTACT_NOT_FOUND", 404, { contactId });
    }
    return contact.name;
  }
  throw new DomainError(
    "CUSTOMER_REQUIRED",
    400,
    { fields: { customerName: ["Customer name or contactId is required"] } },
    "Customer name or contactId is required"
  );
}

export function registerRecurringInvoiceRoutes(app: Express) {
  app.get(
    "/api/companies/:companyId/recurring-invoices",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      if (!(await storage.hasCompanyAccess(userOf(req), companyId))) {
        return res.status(403).json({ message: "Access denied", code: "COMPANY_ACCESS_DENIED" });
      }
      res.json(await storage.getRecurringInvoicesByCompanyId(companyId));
    })
  );

  app.get(
    "/api/recurring-invoices/:id",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      res.json(await templateForUser(userOf(req), req.params.id));
    })
  );

  app.post(
    "/api/companies/:companyId/recurring-invoices",
    authMiddleware,
    requireCustomer,
    strictBody(createRecurringInvoiceSchema),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      if (!(await storage.hasCompanyAccess(userOf(req), companyId))) {
        return res.status(403).json({ message: "Access denied", code: "COMPANY_ACCESS_DENIED" });
      }
      const body = validated<CreateRecurringInvoiceInput>(req);
      const customerName = await customerNameFor(companyId, body.contactId, body.customerName);
      const item = await storage.createRecurringInvoice({
        companyId,
        customerName,
        customerTrn: body.customerTrn ?? null,
        customerAddress: body.customerAddress ?? null,
        contactId: body.contactId ?? null,
        currency: body.currency ?? "AED",
        frequency: body.frequency,
        startDate: toDate(body.startDate),
        nextRunDate: toDate(body.startDate),
        endDate: body.endDate ? toDate(body.endDate) : null,
        paymentTerms: body.paymentTerms ?? null,
        placeOfSupplyEmirate: body.placeOfSupplyEmirate ?? null,
        autoIssue: body.autoIssue ?? true,
        autoSend: body.autoSend ?? false,
        sendToEmail: body.sendToEmail ?? null,
        linesJson: canonicalTemplateLines(body.lines),
        isActive: true,
        lastGeneratedInvoiceId: null,
        totalGenerated: 0,
      });
      log.info({ id: item.id, companyId }, "Created recurring invoice");
      res.json(item);
    })
  );

  app.patch(
    "/api/recurring-invoices/:id",
    authMiddleware,
    requireCustomer,
    strictBody(updateRecurringInvoiceSchema),
    asyncHandler(async (req: Request, res: Response) => {
      const existing = await templateForUser(userOf(req), req.params.id);
      const body = validated<UpdateRecurringInvoiceInput>(req);
      const patch: Partial<RecurringInvoice> = {};
      if (body.customerName !== undefined || body.contactId !== undefined) {
        patch.customerName = await customerNameFor(
          existing.companyId,
          body.contactId ?? existing.contactId,
          body.customerName
        );
      }
      if (body.contactId !== undefined) patch.contactId = body.contactId;
      if (body.customerTrn !== undefined) patch.customerTrn = body.customerTrn;
      if (body.customerAddress !== undefined) patch.customerAddress = body.customerAddress;
      if (body.currency !== undefined) patch.currency = body.currency;
      if (body.frequency !== undefined) patch.frequency = body.frequency;
      if (body.startDate !== undefined) patch.startDate = toDate(body.startDate);
      if (body.nextRunDate !== undefined) patch.nextRunDate = toDate(body.nextRunDate);
      if (body.endDate !== undefined) patch.endDate = body.endDate ? toDate(body.endDate) : null;
      if (body.paymentTerms !== undefined) patch.paymentTerms = body.paymentTerms;
      if (body.placeOfSupplyEmirate !== undefined)
        patch.placeOfSupplyEmirate = body.placeOfSupplyEmirate;
      if (body.autoIssue !== undefined) patch.autoIssue = body.autoIssue;
      if (body.autoSend !== undefined) patch.autoSend = body.autoSend;
      if (body.sendToEmail !== undefined) patch.sendToEmail = body.sendToEmail;
      if (body.lines !== undefined) patch.linesJson = canonicalTemplateLines(body.lines);
      const autoSend = patch.autoSend ?? existing.autoSend;
      const sendTo = patch.sendToEmail !== undefined ? patch.sendToEmail : existing.sendToEmail;
      if (autoSend && !sendTo) {
        throw new DomainError(
          "VALIDATION_ERROR",
          400,
          { fields: { sendToEmail: ["sendToEmail is required when autoSend is on"] } },
          "sendToEmail is required when autoSend is on"
        );
      }
      const item = await storage.updateRecurringInvoice(existing.id, patch);
      log.info({ id: existing.id }, "Updated recurring invoice");
      res.json(item);
    })
  );

  app.patch(
    "/api/recurring-invoices/:id/toggle",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const existing = await templateForUser(userOf(req), req.params.id);
      const item = await storage.updateRecurringInvoice(existing.id, {
        isActive: !existing.isActive,
      });
      log.info({ id: existing.id, isActive: item.isActive }, "Toggled recurring invoice");
      res.json(item);
    })
  );

  app.delete(
    "/api/recurring-invoices/:id",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const existing = await templateForUser(userOf(req), req.params.id);
      await storage.deleteRecurringInvoice(existing.id);
      log.info({ id: existing.id }, "Deleted recurring invoice");
      res.json({ message: "Recurring invoice deleted successfully" });
    })
  );
}
