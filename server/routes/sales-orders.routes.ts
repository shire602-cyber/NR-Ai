import type { Express, Request, Response } from "express";
import { z } from "zod";
import { authMiddleware, requireCompanyAccess, requireCustomer } from "../middleware/auth";
import { asyncHandler } from "../middleware/errorHandler";
import { storage } from "../storage";
import { recordAudit } from "../services/audit.service";
import {
  cancelSalesOrder,
  closeSalesOrder,
  createDelivery,
  createSalesOrder,
  deleteSalesOrder,
  getDelivery,
  getSalesOrder,
  invoiceSalesOrder,
  listSalesOrders,
  productAvailability,
  updateSalesOrder,
  type SalesOrderInput,
} from "../services/sales-order.service";
import { invoiceLineObject, withDerivedSupplyType } from "../services/invoice-line-schemas";
import { documentDiscountSchema } from "../services/sales-input";
import type { SalesLineSource } from "../services/sales-lines.service";
import { generateSalesOrderPDF } from "../services/pdf-sales-order.service";
import { generateSalesOrderDeliveryPDF } from "../services/pdf-delivery-note.service";
import { pdfFieldsFor } from "../services/custom-fields.service";
import { db } from "../db";
import { salesOrderLines } from "../../shared/schema";
import { asc, eq } from "drizzle-orm";

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD");
const dayToDate = (v: string) => new Date(`${v}T00:00:00.000Z`);

const lineSchema = invoiceLineObject.transform(withDerivedSupplyType);
const orderSchema = z
  .object({
    contactId: z.string().uuid(),
    date: ymd,
    expectedDate: ymd.optional().nullable(),
    currency: z.string().trim().length(3).optional(),
    exchangeRate: z.coerce.number().finite().positive().optional().nullable(),
    notes: z.string().trim().max(2000).optional().nullable(),
    lines: z.array(lineSchema).min(1, "At least one line is required"),
  })
  .merge(documentDiscountSchema);

const requestLines = z
  .array(z.object({ salesOrderLineId: z.string().uuid(), quantity: z.coerce.number().finite().positive().max(9_999_999_999) }))
  .min(1);
const invoiceSchema = z.object({ date: ymd.optional(), lines: requestLines });
const deliverySchema = z.object({ date: ymd.optional(), notes: z.string().trim().max(1000).optional().nullable(), lines: requestLines });

function toInput(body: z.infer<typeof orderSchema>, rawLines: any[]): SalesOrderInput {
  const lines: SalesLineSource[] = body.lines.map((l, i) => {
    const rawRate = rawLines?.[i]?.vatRate;
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
      priceListId: l.lineKind === "shipping" ? null : (l.priceListId ?? null),
    };
  });
  return {
    contactId: body.contactId,
    date: dayToDate(body.date),
    expectedDate: body.expectedDate ? dayToDate(body.expectedDate) : null,
    currency: body.currency,
    exchangeRate: body.exchangeRate ?? null,
    notes: body.notes ?? null,
    lines,
    discountType: body.discountType ?? null,
    discountValue: body.discountValue ?? null,
  };
}

export function registerSalesOrderRoutes(app: Express) {
  const guards = [authMiddleware, requireCustomer, requireCompanyAccess("params")];
  const base = "/api/companies/:companyId/sales-orders";

  // Registered here, before the inventory routes, so "availability" is never read as a product id.
  app.get(
    "/api/companies/:companyId/products/availability",
    ...guards,
    asyncHandler(async (req: Request, res: Response) => {
      const ids = String(req.query.ids ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter((s) => /^[0-9a-f-]{36}$/i.test(s))
        .slice(0, 200);
      res.json(await productAvailability(req.params.companyId, ids));
    })
  );

  app.get(
    base,
    ...guards,
    asyncHandler(async (req: Request, res: Response) => {
      const status = typeof req.query.status === "string" ? req.query.status : undefined;
      const contactId = typeof req.query.contactId === "string" ? req.query.contactId : undefined;
      res.json(await listSalesOrders(req.params.companyId, { status, contactId }));
    })
  );

  app.post(
    base,
    ...guards,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const userId = (req as any).user.id;
      const input = toInput(orderSchema.parse(req.body ?? {}), req.body?.lines);
      const order = await createSalesOrder({ companyId, userId, input });
      await recordAudit({ userId, companyId, action: "sales_order.create", entityType: "sales_order", entityId: order.id, before: null, after: { number: order.number, total: order.total }, req });
      res.status(201).json(await getSalesOrder(companyId, order.id));
    })
  );

  app.get(
    `${base}/:id`,
    ...guards,
    asyncHandler(async (req: Request, res: Response) => {
      const order = await getSalesOrder(req.params.companyId, req.params.id);
      if (!order) return res.status(404).json({ message: "Sales order not found", code: "SALES_ORDER_NOT_FOUND" });
      res.json(order);
    })
  );

  app.put(
    `${base}/:id`,
    ...guards,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId, id } = req.params;
      const input = toInput(orderSchema.parse(req.body ?? {}), req.body?.lines);
      await updateSalesOrder({ companyId, id, input });
      res.json(await getSalesOrder(companyId, id));
    })
  );

  app.delete(
    `${base}/:id`,
    ...guards,
    asyncHandler(async (req: Request, res: Response) => {
      await deleteSalesOrder(req.params.companyId, req.params.id);
      res.json({ message: "Sales order deleted" });
    })
  );

  app.post(
    `${base}/:id/close`,
    ...guards,
    asyncHandler(async (req: Request, res: Response) => {
      await closeSalesOrder(req.params.companyId, req.params.id);
      res.json(await getSalesOrder(req.params.companyId, req.params.id));
    })
  );

  app.post(
    `${base}/:id/cancel`,
    ...guards,
    asyncHandler(async (req: Request, res: Response) => {
      await cancelSalesOrder(req.params.companyId, req.params.id);
      res.json(await getSalesOrder(req.params.companyId, req.params.id));
    })
  );

  app.post(
    `${base}/:id/invoices`,
    ...guards,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId, id } = req.params;
      const userId = (req as any).user.id;
      const input = invoiceSchema.parse(req.body ?? {});
      const invoice = await invoiceSalesOrder({
        companyId,
        salesOrderId: id,
        userId,
        date: input.date ? dayToDate(input.date) : undefined,
        lines: input.lines,
      });
      await recordAudit({ userId, companyId, action: "sales_order.invoice", entityType: "sales_order", entityId: id, before: null, after: { invoiceId: invoice.id, invoiceNumber: invoice.number }, req });
      res.status(201).json(invoice);
    })
  );

  app.post(
    `${base}/:id/deliveries`,
    ...guards,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId, id } = req.params;
      const userId = (req as any).user.id;
      const input = deliverySchema.parse(req.body ?? {});
      const delivery = await createDelivery({
        companyId,
        salesOrderId: id,
        userId,
        date: input.date ? dayToDate(input.date) : new Date(),
        notes: input.notes,
        lines: input.lines,
      });
      res.status(201).json(delivery);
    })
  );

  app.get(
    `${base}/:id/deliveries/:deliveryId/pdf`,
    ...guards,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId, id, deliveryId } = req.params;
      const found = await getDelivery(companyId, id, deliveryId);
      const order = await getSalesOrder(companyId, id);
      const company = await storage.getCompany(companyId);
      if (!found || !order || !company) return res.status(404).json({ message: "Delivery not found" });
      const byId = new Map<string, string>(order.lines.map((l: any) => [l.id, l.description]));
      const pdf = await generateSalesOrderDeliveryPDF({
        delivery: found.delivery,
        salesOrder: order,
        lines: found.lines.map((l: any) => ({ description: byId.get(l.salesOrderLineId) ?? "", quantity: l.quantity })),
        company,
      });
      res.set({
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="delivery-note-${found.delivery.number}.pdf"`,
        "Content-Length": pdf.length.toString(),
      });
      res.send(pdf);
    })
  );

  app.get(
    `${base}/:id/pdf`,
    ...guards,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId, id } = req.params;
      const order = await getSalesOrder(companyId, id);
      const company = await storage.getCompany(companyId);
      if (!order || !company) return res.status(404).json({ message: "Sales order not found" });
      const lines = await db.select().from(salesOrderLines).where(eq(salesOrderLines.salesOrderId, id)).orderBy(asc(salesOrderLines.sortOrder), asc(salesOrderLines.id));
      const customFields = await pdfFieldsFor(companyId, "sales_order", id);
      const pdf = await generateSalesOrderPDF(order, lines, company, { customFields });
      res.set({
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="sales-order-${order.number}.pdf"`,
        "Content-Length": pdf.length.toString(),
      });
      res.send(pdf);
    })
  );
}
