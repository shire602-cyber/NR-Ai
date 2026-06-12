import type { Express, Request, Response } from "express";
import { authMiddleware, requireCustomer } from "../middleware/auth";
import { asyncHandler } from "../middleware/errorHandler";
import { requireFeature } from "../middleware/featureGate";
import { storage } from "../storage";
import { generatePurchaseOrderPDF } from "../services/pdf-purchase-order.service";
import { createLogger } from "../config/logger";
import { calculateDocumentTotals } from "../services/document-totals.service";

const logger = createLogger("purchase-orders-routes");

// Client payloads carry ISO strings; Drizzle timestamp columns want Dates.
function normalizePoDates<T extends { date?: unknown; expectedDeliveryDate?: unknown }>(
  data: T
): T {
  const out: any = { ...data };
  if (out.date) out.date = new Date(out.date);
  if (out.expectedDeliveryDate) out.expectedDeliveryDate = new Date(out.expectedDeliveryDate);
  return out;
}

export function registerPurchaseOrderRoutes(app: Express) {
  // =====================================
  // Purchase Order Routes
  // =====================================

  // Customer-only: List purchase orders by company
  app.get(
    "/api/companies/:companyId/purchase-orders",
    authMiddleware,
    requireCustomer,
    requireFeature("purchaseOrders"),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const userId = (req as any).user.id;

      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: "Access denied" });
      }

      const purchaseOrders = await storage.getPurchaseOrdersByCompanyId(companyId);
      res.json(purchaseOrders);
    })
  );

  // Customer-only: Get single purchase order with lines
  app.get(
    "/api/purchase-orders/:id",
    authMiddleware,
    requireCustomer,
    requireFeature("purchaseOrders"),
    asyncHandler(async (req: Request, res: Response) => {
      const { id } = req.params;
      const userId = (req as any).user.id;

      const po = await storage.getPurchaseOrder(id);
      if (!po) {
        return res.status(404).json({ message: "Purchase order not found" });
      }

      const hasAccess = await storage.hasCompanyAccess(userId, po.companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: "Access denied" });
      }

      const lines = await storage.getPurchaseOrderLinesByPurchaseOrderId(id);
      res.json({ ...po, lines });
    })
  );

  // Customer-only: Create purchase order with lines
  app.post(
    "/api/companies/:companyId/purchase-orders",
    authMiddleware,
    requireCustomer,
    requireFeature("purchaseOrders"),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const userId = (req as any).user.id;
      const { lines, ...poData } = req.body;

      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: "Access denied" });
      }

      const po = await storage.createPurchaseOrder(
        normalizePoDates({ ...poData, ...calculateDocumentTotals(lines), companyId })
      );

      if (lines && Array.isArray(lines)) {
        for (const line of lines) {
          await storage.createPurchaseOrderLine({ ...line, purchaseOrderId: po.id });
        }
      }

      const poLines = await storage.getPurchaseOrderLinesByPurchaseOrderId(po.id);
      logger.info({ purchaseOrderId: po.id, companyId }, "Purchase order created");
      res.status(201).json({ ...po, lines: poLines });
    })
  );

  // Customer-only: Update purchase order
  app.put(
    "/api/purchase-orders/:id",
    authMiddleware,
    requireCustomer,
    requireFeature("purchaseOrders"),
    asyncHandler(async (req: Request, res: Response) => {
      const { id } = req.params;
      const userId = (req as any).user.id;
      const { lines, ...updateData } = req.body;

      const po = await storage.getPurchaseOrder(id);
      if (!po) {
        return res.status(404).json({ message: "Purchase order not found" });
      }

      const hasAccess = await storage.hasCompanyAccess(userId, po.companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: "Access denied" });
      }

      if (po.status === "received") {
        return res.status(400).json({ message: "Cannot update a received purchase order" });
      }

      const updated = await storage.updatePurchaseOrder(
        id,
        normalizePoDates(
          lines && Array.isArray(lines)
            ? { ...updateData, ...calculateDocumentTotals(lines) }
            : updateData
        )
      );

      if (lines && Array.isArray(lines)) {
        await storage.deletePurchaseOrderLinesByPurchaseOrderId(id);
        for (const line of lines) {
          await storage.createPurchaseOrderLine({ ...line, purchaseOrderId: id });
        }
      }

      const poLines = await storage.getPurchaseOrderLinesByPurchaseOrderId(id);
      res.json({ ...updated, lines: poLines });
    })
  );

  // Customer-only: Delete purchase order
  app.delete(
    "/api/purchase-orders/:id",
    authMiddleware,
    requireCustomer,
    requireFeature("purchaseOrders"),
    asyncHandler(async (req: Request, res: Response) => {
      const { id } = req.params;
      const userId = (req as any).user.id;

      const po = await storage.getPurchaseOrder(id);
      if (!po) {
        return res.status(404).json({ message: "Purchase order not found" });
      }

      const hasAccess = await storage.hasCompanyAccess(userId, po.companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: "Access denied" });
      }

      if (po.status === "received") {
        return res.status(400).json({ message: "Cannot delete a received purchase order" });
      }

      await storage.deletePurchaseOrder(id);
      res.json({ message: "Purchase order deleted" });
    })
  );

  // Customer-only: Send purchase order
  app.post(
    "/api/purchase-orders/:id/send",
    authMiddleware,
    requireCustomer,
    requireFeature("purchaseOrders"),
    asyncHandler(async (req: Request, res: Response) => {
      const { id } = req.params;
      const userId = (req as any).user.id;

      const po = await storage.getPurchaseOrder(id);
      if (!po) {
        return res.status(404).json({ message: "Purchase order not found" });
      }

      const hasAccess = await storage.hasCompanyAccess(userId, po.companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: "Access denied" });
      }

      if (po.status !== "draft") {
        return res.status(400).json({ message: "Only draft purchase orders can be sent" });
      }

      const updated = await storage.updatePurchaseOrder(id, {
        status: "sent",
      });

      logger.info({ purchaseOrderId: id }, "Purchase order sent");
      res.json({ ...updated, message: "Purchase order sent" });
    })
  );

  // Customer-only: Approve purchase order
  app.post(
    "/api/purchase-orders/:id/approve",
    authMiddleware,
    requireCustomer,
    requireFeature("purchaseOrders"),
    asyncHandler(async (req: Request, res: Response) => {
      const { id } = req.params;
      const userId = (req as any).user.id;

      const po = await storage.getPurchaseOrder(id);
      if (!po) {
        return res.status(404).json({ message: "Purchase order not found" });
      }

      const hasAccess = await storage.hasCompanyAccess(userId, po.companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: "Access denied" });
      }

      if (po.status !== "sent" && po.status !== "draft") {
        return res
          .status(400)
          .json({ message: "Purchase order cannot be approved in current status" });
      }

      const updated = await storage.updatePurchaseOrder(id, {
        status: "approved",
      });

      logger.info({ purchaseOrderId: id }, "Purchase order approved");
      res.json({ ...updated, message: "Purchase order approved" });
    })
  );

  // Customer-only: Receive purchase order (mark as received)
  app.post(
    "/api/purchase-orders/:id/receive",
    authMiddleware,
    requireCustomer,
    requireFeature("purchaseOrders"),
    asyncHandler(async (req: Request, res: Response) => {
      const { id } = req.params;
      const userId = (req as any).user.id;

      const po = await storage.getPurchaseOrder(id);
      if (!po) {
        return res.status(404).json({ message: "Purchase order not found" });
      }

      const hasAccess = await storage.hasCompanyAccess(userId, po.companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: "Access denied" });
      }

      if (po.status !== "approved" && po.status !== "sent") {
        return res
          .status(400)
          .json({ message: "Purchase order must be approved or sent before receiving" });
      }

      const updated = await storage.updatePurchaseOrder(id, {
        status: "received",
      });

      logger.info({ purchaseOrderId: id }, "Purchase order received");
      res.json({ ...updated, message: "Purchase order received" });
    })
  );

  // Customer-only: Generate PDF
  app.get(
    "/api/purchase-orders/:id/pdf",
    authMiddleware,
    requireCustomer,
    requireFeature("purchaseOrders"),
    asyncHandler(async (req: Request, res: Response) => {
      const { id } = req.params;
      const userId = (req as any).user.id;

      const po = await storage.getPurchaseOrder(id);
      if (!po) {
        return res.status(404).json({ message: "Purchase order not found" });
      }

      const hasAccess = await storage.hasCompanyAccess(userId, po.companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: "Access denied" });
      }

      const lines = await storage.getPurchaseOrderLinesByPurchaseOrderId(id);
      const company = await storage.getCompany(po.companyId);
      if (!company) {
        return res.status(404).json({ message: "Company not found" });
      }

      const pdfBuffer = await generatePurchaseOrderPDF(po, lines, company);

      res.set({
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="purchase-order-${po.number}.pdf"`,
        "Content-Length": pdfBuffer.length.toString(),
      });
      res.send(pdfBuffer);
    })
  );
}
