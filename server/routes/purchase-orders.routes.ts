import type { Express, Request, Response } from "express";
import { authMiddleware, requireCustomer } from "../middleware/auth";
import { asyncHandler } from "../middleware/errorHandler";
import { requireFeature } from "../middleware/featureGate";
import { storage } from "../storage";
import { generatePurchaseOrderPDF } from "../services/pdf-purchase-order.service";
import { createLogger } from "../config/logger";
import { calculateDocumentTotals } from "../services/document-totals.service";
import { normalizeDocumentLines } from "../services/document-line-limits";
import { resolveVendor } from "../services/vendor-contact.service";
import { LOCK_NS, withDocumentLock } from "../services/document-lock";
import { loadApprovalDocument } from "../services/approval-queue.service";
import {
  auditApprovalStep,
  beginApprovalStep,
  hasActiveRuleFor,
  notifyApprovalProgress,
  pendingApprovalBody,
  recordApprovalStep,
  resolveActor,
} from "../services/approval-gate.service";
import { parseCalendarDay } from "../utils/date";
import { db } from "../db";
import { eq, sql } from "drizzle-orm";
import { purchaseOrders } from "../../shared/schema";
import { assertProductsOfCompany, receivePurchaseOrderStockInTx } from "../services/purchase-stock.service";

const logger = createLogger("purchase-orders-routes");

// Client payloads carry ISO strings; Drizzle timestamp columns want Dates.
function normalizePoDates<T extends { date?: unknown; expectedDeliveryDate?: unknown }>(
  data: T
): T {
  const out: any = { ...data };
  if (out.date) out.date = parseCalendarDay(out.date) ?? new Date(out.date);
  if (out.expectedDeliveryDate) out.expectedDeliveryDate = parseCalendarDay(out.expectedDeliveryDate) ?? new Date(out.expectedDeliveryDate);
  return out;
}

// Fields a purchase-order write may never set from a request body: ownership, state and the
// vendor snapshot (resolved from the contacts table below). Status moves only through the
// send / approve / receive actions, which is what the approval gate relies on.
const PO_PROTECTED_FIELDS = ["id", "companyId", "status", "createdAt", "updatedAt", "vendorId", "createdBy"] as const;

function withoutProtectedPoFields(body: Record<string, any>): Record<string, any> {
  const out = { ...body };
  for (const key of PO_PROTECTED_FIELDS) delete out[key];
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
      const { lines: rawLines, ...bodyData } = req.body;
      const poData = withoutProtectedPoFields(bodyData);

      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: "Access denied" });
      }

      // Link the order to a vendor contact (validated, found by name, or created).
      const vendor = await resolveVendor(companyId, {
        vendorId: req.body.vendorId,
        vendorName: poData.vendorName,
        vendorTrn: poData.vendorTrn,
      });
      poData.vendorName = vendor.vendorName;
      poData.vendorTrn = vendor.vendorTrn;

      // Cap and round quantity / unit price to what the columns can store, so
      // totals are computed from exactly what is persisted (and an oversized
      // value is a clean 400, not a Postgres overflow).
      const lines = Array.isArray(rawLines) ? normalizeDocumentLines(rawLines) : rawLines;
      if (Array.isArray(lines)) await assertProductsOfCompany(companyId, lines.map((l: any) => l.productId));

      const po = await storage.createPurchaseOrder(
        normalizePoDates({ ...poData, ...calculateDocumentTotals(lines), companyId, vendorId: vendor.vendorId, status: "draft", createdBy: userId } as any)
      );

      if (lines && Array.isArray(lines)) {
        for (const line of lines) {
          await storage.createPurchaseOrderLine({ ...line, purchaseOrderId: po.id });
        }
      }

      const poLines = await storage.getPurchaseOrderLinesByPurchaseOrderId(po.id);
      logger.info({ purchaseOrderId: po.id, companyId }, "Purchase order created");
      res.status(201).json({ ...po, lines: poLines, ...(vendor.warnings.length > 0 ? { warnings: vendor.warnings } : {}) });
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
      const { lines: rawLines, ...bodyData } = req.body;
      const updateData = withoutProtectedPoFields(bodyData);

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
      if (po.status === "pending_approval") {
        return res.status(409).json({
          message: "This purchase order is waiting for approval and cannot be edited. Reject it first.",
          code: "APPROVAL_IN_PROGRESS",
        });
      }

      // Re-link the vendor when the vendor (by id or by name) changes.
      let vendorWarnings: Array<{ code: string; message: string }> = [];
      if (req.body.vendorId !== undefined || updateData.vendorName !== undefined) {
        const vendor = await resolveVendor(po.companyId, {
          vendorId: req.body.vendorId,
          vendorName: req.body.vendorId ? undefined : updateData.vendorName,
          vendorTrn: updateData.vendorTrn,
        });
        updateData.vendorName = vendor.vendorName;
        updateData.vendorTrn = vendor.vendorTrn;
        updateData.vendorId = vendor.vendorId;
        vendorWarnings = vendor.warnings;
      }

      const lines = Array.isArray(rawLines) ? normalizeDocumentLines(rawLines) : rawLines;
      if (Array.isArray(lines)) await assertProductsOfCompany(po.companyId, lines.map((l: any) => l.productId));

      // An approved order whose lines or amounts change is no longer what was approved: it goes back to draft
      // and needs approving (and, under a rule, the approval steps) again before it can be received.
      const amountsChange =
        Array.isArray(lines) || ["subtotal", "vatAmount", "total"].some((k) => updateData[k] !== undefined);
      const reopened = po.status === "approved" && amountsChange;
      if (reopened) updateData.status = "draft";

      const updated = await storage.updatePurchaseOrder(
        id,
        normalizePoDates(
          lines && Array.isArray(lines)
            ? { ...updateData, ...calculateDocumentTotals(lines) }
            : updateData
        )
      );
      if (reopened) {
        await storage.createActivityLog({
          userId,
          companyId: po.companyId,
          action: "update",
          entityType: "purchase_order",
          entityId: id,
          description: `Purchase order ${po.number} was changed after approval and returned to draft`,
          metadata: JSON.stringify({ from: "approved", to: "draft", previousTotal: po.total }),
        } as any);
      }

      if (lines && Array.isArray(lines)) {
        await storage.deletePurchaseOrderLinesByPurchaseOrderId(id);
        for (const line of lines) {
          await storage.createPurchaseOrderLine({ ...line, purchaseOrderId: id });
        }
      }

      const poLines = await storage.getPurchaseOrderLinesByPurchaseOrderId(id);
      res.json({ ...updated, lines: poLines, ...(vendorWarnings.length > 0 ? { warnings: vendorWarnings } : {}) });
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
      if (po.status === "pending_approval") {
        return res.status(409).json({
          message: "This purchase order is waiting for approval and cannot be deleted. Reject it first.",
          code: "APPROVAL_IN_PROGRESS",
        });
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

      if (po.status === "pending_approval") {
        return res.status(409).json({
          message: "This purchase order is waiting for approval.",
          code: "APPROVAL_IN_PROGRESS",
        });
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

      // Under the approval lock with the order re-read: parallel approvals count once each.
      const outcome = await withDocumentLock(id, LOCK_NS.APPROVAL, async (tx) => {
        const current = await storage.getPurchaseOrder(id);
        if (!current) return { status: 404, body: { message: "Purchase order not found" } };
        if (current.status !== "sent" && current.status !== "draft" && current.status !== "pending_approval") {
          return { status: 400, body: { message: "Purchase order cannot be approved in current status" } };
        }

        const doc = await loadApprovalDocument("purchase_order", id);
        const actor = await resolveActor((req as any).user, current.companyId);
        const step = doc ? await beginApprovalStep(tx, doc, actor, { previousStatus: current.status, acknowledgeSoleApprover: req.body?.acknowledgeSoleApprover === true }) : ({ kind: "none" } as const);

        if (step.kind === "step" && !step.isFinal) {
          const request = await recordApprovalStep(tx, step, actor);
          const updated = await storage.updatePurchaseOrder(id, { status: "pending_approval" });
          await auditApprovalStep({ req, actor, doc: doc!, request, stepNumber: step.stepNumber, decision: "approved" });
          void notifyApprovalProgress({ doc: doc!, request, actor, outcome: "needs_next_step" });
          return { status: 200, body: { ...updated, ...pendingApprovalBody(step), message: "Purchase order approval recorded" } };
        }

        const updated = await storage.updatePurchaseOrder(id, {
          status: "approved",
        });
        if (step.kind === "step") {
          const request = await recordApprovalStep(tx, step, actor);
          await auditApprovalStep({ req, actor, doc: doc!, request, stepNumber: step.stepNumber, decision: "approved" });
          void notifyApprovalProgress({ doc: doc!, request, actor, outcome: "approved" });
        }

        logger.info({ purchaseOrderId: id }, "Purchase order approved");
        return { status: 200, body: { ...updated, message: "Purchase order approved" } };
      });
      res.status(outcome.status).json(outcome.body);
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

      if (po.status === "pending_approval") {
        return res.status(409).json({
          message: "This purchase order is waiting for approval and cannot be received yet.",
          code: "APPROVAL_IN_PROGRESS",
        });
      }
      // With an approval rule for purchase orders, only an approved order is received (a sent order skipped the approvals).
      const needsApproval = await hasActiveRuleFor(po.companyId, "purchase_order");
      if (po.status !== "approved" && !(po.status === "sent" && !needsApproval)) {
        return res.status(400).json({
          message: needsApproval
            ? "Purchase order must be approved before receiving"
            : "Purchase order must be approved or sent before receiving",
          ...(needsApproval ? { code: "APPROVAL_REQUIRED_BEFORE_RECEIVE" } : {}),
        });
      }

      // The goods come into stock (Dr 1070 / Cr 2015 GRNI with costing on) in the same transaction that marks the
      // order received, so a refused receipt leaves the order open and an order is never received twice.
      const received = await db.transaction(async (tx: any) => {
        const locked = (await tx.execute(sql`SELECT status FROM purchase_orders WHERE id = ${id} FOR UPDATE`)) as any;
        const current = (locked.rows ?? locked)[0]?.status;
        if (current === "received") return { already: true as const };
        const movements = await receivePurchaseOrderStockInTx(tx, po, userId, req.body?.date);
        const [row] = await tx
          .update(purchaseOrders)
          .set({ status: "received", updatedAt: new Date() })
          .where(eq(purchaseOrders.id, id))
          .returning();
        return { already: false as const, row, movements };
      });
      if (received.already) {
        return res.status(400).json({ message: "Purchase order is already received", code: "ALREADY_RECEIVED" });
      }

      logger.info({ purchaseOrderId: id, stockMovements: received.movements }, "Purchase order received");
      res.json({ ...received.row, stockMovements: received.movements, message: "Purchase order received" });
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
