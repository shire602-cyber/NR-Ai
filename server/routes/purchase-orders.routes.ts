/**
 * Purchase orders (W3-B: R04-06, R04-09, R04-10, R04-11, R04-17).
 *
 * draft → sent → approved → partially_received → received, or cancelled. Status is never
 * accepted in a body (strictBody rejects it); every transition is one conditional update.
 * Goods receipts are partial and line based; convert-to-bill creates a pending bill for the
 * outstanding quantities, and /match reports the 3-way match (ordered vs received vs billed).
 */
import type { Express, Request, Response } from "express";
import { and, eq, sql } from "drizzle-orm";
import { authMiddleware, requireCustomer } from "../middleware/auth";
import { asyncHandler } from "../middleware/errorHandler";
import { requireFeature } from "../middleware/featureGate";
import { strictBody } from "../http/strict-body";
import { parsedBody } from "../http/parsed-body";
import { storage } from "../storage";
import { db, pool } from "../db";
import { generatePurchaseOrderPDF } from "../services/pdf-purchase-order.service";
import { createLogger } from "../config/logger";
import { DomainError } from "../errors";
import { recordAudit } from "../services/audit.service";
import { sendEmail, escapeHtml } from "../services/email.service";
import { has, resolve } from "../platform/service-registry";
import { defineMachine, transitionRow, withLedgerTx, type LedgerTx } from "../ledger";
import {
  purchaseOrderLines,
  purchaseOrderReceiptLines,
  purchaseOrderReceipts,
  purchaseOrders,
  type PurchaseOrder,
  type PurchaseOrderLine,
} from "../../shared/schema";
import {
  poCancelSchema,
  poConvertSchema,
  poCreateSchema,
  poReceiveSchema,
  poSendSchema,
  poUpdateSchema,
  type PoConvertInput,
  type PoCreateInput,
  type PoLineInput,
  type PoReceiveInput,
  type PoUpdateInput,
} from "../../shared/validators/purchase-orders";
import { zUuid } from "../../shared/validators/primitives";
import { fromFils, mulRate, sumFils, toFils } from "../../shared/money";
import { nextDocNumber, createBill, resolveDocRate } from "../services/bill-payment.service";
import { txRows } from "../services/bill-posting.service";
import { resolveVendor } from "../services/vendor.service";
import {
  actorFromRequest,
  assertCompanyPermission,
  evaluateApproval,
} from "../services/approval-rules.service";
import type { BillCreateInput } from "../../shared/validators/bills";

const logger = createLogger("purchase-orders-routes");

const PO_STATES = [
  "draft",
  "sent",
  "approved",
  "partially_received",
  "received",
  "cancelled",
] as const;
type PoState = (typeof PO_STATES)[number];
export const poMachine = defineMachine<PoState>({
  states: PO_STATES,
  transitions: {
    draft: ["sent", "approved", "cancelled"],
    sent: ["approved", "cancelled"],
    approved: ["partially_received", "received", "cancelled"],
    partially_received: ["received"],
  },
});

const EDITABLE: readonly PoState[] = ["draft", "sent"];

/** Line totals in fils (VAT 0 or 5 only; rounded once at document level per A-B13). */
function poTotals(lines: Array<{ quantity: number; unitPrice: string | number; vatRate: number }>) {
  const nets = lines.map((l) => {
    const unit = toFils(String(l.unitPrice), { rounding: "halfUp" });
    return unit === 0 ? 0 : mulRate(unit, l.quantity);
  });
  const vat = lines.reduce((s, l, i) => s + (l.vatRate > 0 ? nets[i] * 0.05 : 0), 0);
  const subtotal = sumFils(nets);
  const vatFils = Math.round(vat);
  return {
    subtotal: fromFils(subtotal),
    vatAmount: fromFils(vatFils),
    total: fromFils(subtotal + vatFils),
  };
}

const vatDecimal = (rate: number | null | undefined) => (rate === 0 ? 0 : 0.05);

async function loadPo(req: Request): Promise<PurchaseOrder> {
  const { id } = req.params;
  if (!zUuid.safeParse(id).success)
    throw new DomainError("PURCHASE_ORDER_NOT_FOUND", 404, undefined, "Purchase order not found");
  const po = await storage.getPurchaseOrder(id);
  if (!po || !(await storage.hasCompanyAccess(req.user!.id, po.companyId))) {
    throw new DomainError("PURCHASE_ORDER_NOT_FOUND", 404, undefined, "Purchase order not found");
  }
  return po;
}

async function linesOf(poId: string): Promise<PurchaseOrderLine[]> {
  return storage.getPurchaseOrderLinesByPurchaseOrderId(poId);
}

function toLineRows(poId: string, lines: PoLineInput[]) {
  return lines.map((l) => ({
    purchaseOrderId: poId,
    description: l.description,
    quantity: l.quantity,
    unitPrice: Number(l.unitPrice),
    vatRate: vatDecimal(l.vatRate),
    vatSupplyType: l.vatSupplyType ?? (l.vatRate === 0 ? "zero_rated" : "standard_rated"),
    productId: l.productId ?? null,
    accountId: l.accountId ?? null,
  }));
}

async function allocatePoNumber(tx: LedgerTx, companyId: string): Promise<string> {
  for (let attempt = 0; attempt < 100; attempt++) {
    const n = await nextDocNumber(tx, companyId, "purchase_order", async () => {
      const c = await pool.query(
        `SELECT COUNT(*)::int AS n FROM purchase_orders WHERE company_id = $1`,
        [companyId]
      );
      return Number(c.rows[0]?.n ?? 0) + 1;
    });
    const number = `PO-${String(n).padStart(4, "0")}`;
    const clash = await txRows(
      tx,
      `SELECT 1 FROM purchase_orders WHERE company_id = $1 AND number = $2`,
      [companyId, number]
    );
    if (clash.length === 0) return number;
  }
  throw new DomainError("PO_NUMBER_EXHAUSTED", 409);
}

interface MatchLine {
  lineId: string;
  description: string;
  ordered: number;
  received: number;
  billed: number;
  outstandingToReceive: number;
  outstandingToBill: number;
  status: "matched" | "awaiting_receipt" | "awaiting_bill" | "billed_exceeds_received";
}

function matchOf(lines: PurchaseOrderLine[]) {
  const out: MatchLine[] = lines.map((l) => {
    const ordered = Number(l.quantity);
    const received = Number(l.quantityReceived ?? 0);
    const billed = Number(l.quantityBilled ?? 0);
    const status: MatchLine["status"] =
      billed > received && received > 0
        ? "billed_exceeds_received"
        : received < ordered
          ? "awaiting_receipt"
          : billed < received
            ? "awaiting_bill"
            : "matched";
    return {
      lineId: l.id,
      description: l.description,
      ordered,
      received,
      billed,
      outstandingToReceive: Math.max(0, ordered - received),
      outstandingToBill: Math.max(0, ordered - billed),
      status,
    };
  });
  const overall = out.every((l) => l.status === "matched")
    ? "matched"
    : out.some((l) => l.status === "billed_exceeds_received")
      ? "billed_exceeds_received"
      : out.some((l) => l.status === "awaiting_receipt")
        ? "awaiting_receipt"
        : "awaiting_bill";
  return { overall, lines: out };
}

export function registerPurchaseOrderRoutes(app: Express) {
  const gate = [authMiddleware, requireCustomer, requireFeature("purchaseOrders")];

  app.get(
    "/api/companies/:companyId/purchase-orders",
    ...gate,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      if (!(await storage.hasCompanyAccess(req.user!.id, companyId))) {
        throw new DomainError("COMPANY_ACCESS_DENIED", 403, undefined, "Access denied");
      }
      res.json(await storage.getPurchaseOrdersByCompanyId(companyId));
    })
  );

  app.get(
    "/api/purchase-orders/:id",
    ...gate,
    asyncHandler(async (req: Request, res: Response) => {
      const po = await loadPo(req);
      const lines = await linesOf(po.id);
      res.json({ ...po, lines, match: matchOf(lines) });
    })
  );

  app.get(
    "/api/purchase-orders/:id/match",
    ...gate,
    asyncHandler(async (req: Request, res: Response) => {
      const po = await loadPo(req);
      const lines = await linesOf(po.id);
      const bills = await pool.query(
        `SELECT id, bill_number, status, total_amount FROM vendor_bills WHERE company_id = $1 AND purchase_order_id = $2 ORDER BY created_at`,
        [po.companyId, po.id]
      );
      res.json({ purchaseOrderId: po.id, status: po.status, ...matchOf(lines), bills: bills.rows });
    })
  );

  // ── Create (number + totals server-owned) ───────────────────────────────
  app.post(
    "/api/companies/:companyId/purchase-orders",
    ...gate,
    strictBody(poCreateSchema),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      if (!(await storage.hasCompanyAccess(req.user!.id, companyId))) {
        throw new DomainError("COMPANY_ACCESS_DENIED", 403, undefined, "Access denied");
      }
      const body = parsedBody<PoCreateInput>(req);
      const vendor = await resolveVendor(companyId, {
        vendor_id: body.vendorId ?? null,
        vendor_name: body.vendorName,
        vendor_trn: body.vendorTrn ?? null,
      });
      const totals = poTotals(body.lines.map((l) => ({ ...l, vatRate: l.vatRate ?? 5 })));
      const po = await withLedgerTx(async (tx) => {
        const number = await allocatePoNumber(tx, companyId);
        const [row] = await tx
          .insert(purchaseOrders)
          .values({
            companyId,
            number,
            vendorId: vendor?.vendorId ?? null,
            vendorName: vendor?.vendorName || body.vendorName,
            vendorTrn: vendor?.vendorTrn ?? body.vendorTrn ?? null,
            date: new Date(`${body.date}T00:00:00.000Z`),
            expectedDeliveryDate: body.expectedDeliveryDate
              ? new Date(`${body.expectedDeliveryDate}T00:00:00.000Z`)
              : null,
            currency: body.currency ?? "AED",
            notes: body.notes ?? null,
            subtotal: Number(totals.subtotal),
            vatAmount: Number(totals.vatAmount),
            total: Number(totals.total),
            createdBy: req.user!.id,
          })
          .returning();
        await tx.insert(purchaseOrderLines).values(toLineRows(row.id, body.lines));
        return row;
      });
      const lines = await linesOf(po.id);
      logger.info({ purchaseOrderId: po.id, companyId }, "Purchase order created");
      res.status(201).json({ ...po, lines });
    })
  );

  // ── Update (draft / sent only; never status) ────────────────────────────
  app.put(
    "/api/purchase-orders/:id",
    ...gate,
    strictBody(poUpdateSchema),
    asyncHandler(async (req: Request, res: Response) => {
      const po = await loadPo(req);
      if (!EDITABLE.includes(po.status as PoState)) {
        throw new DomainError(
          "PO_LOCKED",
          409,
          { status: po.status },
          "Only draft or sent purchase orders can be edited"
        );
      }
      const body = parsedBody<PoUpdateInput>(req);
      const patch: Partial<typeof purchaseOrders.$inferInsert> = { updatedAt: new Date() };
      if (
        body.vendorId !== undefined ||
        body.vendorName !== undefined ||
        body.vendorTrn !== undefined
      ) {
        const v = await resolveVendor(po.companyId, {
          vendor_id: body.vendorId ?? null,
          vendor_name: body.vendorName ?? po.vendorName,
          vendor_trn: body.vendorTrn ?? null,
        });
        if (v) {
          patch.vendorId = v.vendorId;
          patch.vendorName = v.vendorName;
          patch.vendorTrn = v.vendorTrn;
        }
      }
      if (body.date) patch.date = new Date(`${body.date}T00:00:00.000Z`);
      if (body.expectedDeliveryDate !== undefined)
        patch.expectedDeliveryDate = body.expectedDeliveryDate
          ? new Date(`${body.expectedDeliveryDate}T00:00:00.000Z`)
          : null;
      if (body.currency) patch.currency = body.currency;
      if (body.notes !== undefined) patch.notes = body.notes;
      if (body.lines) {
        const t = poTotals(body.lines.map((l) => ({ ...l, vatRate: l.vatRate ?? 5 })));
        patch.subtotal = Number(t.subtotal);
        patch.vatAmount = Number(t.vatAmount);
        patch.total = Number(t.total);
      }
      const updated = await withLedgerTx(async (tx) => {
        const [row] = await tx
          .update(purchaseOrders)
          .set(patch)
          .where(
            and(
              eq(purchaseOrders.id, po.id),
              eq(purchaseOrders.companyId, po.companyId),
              sql`${purchaseOrders.status} IN ('draft','sent')`
            )
          )
          .returning();
        if (!row) throw new DomainError("PO_LOCKED", 409);
        if (body.lines) {
          await tx.delete(purchaseOrderLines).where(eq(purchaseOrderLines.purchaseOrderId, po.id));
          await tx.insert(purchaseOrderLines).values(toLineRows(po.id, body.lines));
        }
        return row;
      });
      const lines = await linesOf(po.id);
      res.json({ ...updated, lines });
    })
  );

  app.delete(
    "/api/purchase-orders/:id",
    ...gate,
    asyncHandler(async (req: Request, res: Response) => {
      const po = await loadPo(req);
      if (!EDITABLE.includes(po.status as PoState) && po.status !== "cancelled") {
        throw new DomainError(
          "PO_LOCKED",
          409,
          { status: po.status },
          "Cancel the purchase order instead of deleting it"
        );
      }
      const billed = await pool.query(
        `SELECT 1 FROM vendor_bills WHERE purchase_order_id = $1 LIMIT 1`,
        [po.id]
      );
      if (billed.rows.length) throw new DomainError("PO_HAS_BILLS", 409);
      await db
        .delete(purchaseOrders)
        .where(and(eq(purchaseOrders.id, po.id), eq(purchaseOrders.companyId, po.companyId)));
      res.json({ message: "Purchase order deleted" });
    })
  );

  // ── Send (email through the email service; honest result) ───────────────
  app.post(
    "/api/purchase-orders/:id/send",
    ...gate,
    strictBody(poSendSchema),
    asyncHandler(async (req: Request, res: Response) => {
      const po = await loadPo(req);
      if (po.status !== "draft") {
        throw new DomainError(
          "PO_NOT_DRAFT",
          409,
          { status: po.status },
          "Only draft purchase orders can be sent"
        );
      }
      const { to, message } = req.body as { to?: string | null; message?: string | null };
      let email: { sent: boolean; provider?: string; error?: string } | null = null;
      if (to) {
        const company = await storage.getCompany(po.companyId);
        const lines = await linesOf(po.id);
        const text =
          `${message ? `${message}\n\n` : ""}Purchase order ${po.number} from ${company?.name ?? ""}\n` +
          lines.map((l) => `- ${l.description}: ${l.quantity} × ${l.unitPrice}`).join("\n") +
          `\nTotal: ${po.currency} ${po.total}`;
        email = await sendEmail(to, `Purchase order ${po.number}`, text, {
          fromName: company?.name,
          html: `<p>${escapeHtml(text).replace(/\n/g, "<br>")}</p>`,
        });
        if (!email.sent) {
          throw new DomainError(
            "EMAIL_NOT_SENT",
            502,
            { provider: email.provider ?? null, error: email.error ?? null },
            `The purchase order was not emailed: ${email.error ?? "email provider unavailable"}`
          );
        }
      }
      const row = await withLedgerTx((tx) =>
        transitionRow(
          tx,
          purchaseOrders,
          po.id,
          "draft",
          "sent",
          { sentAt: new Date(), sentTo: to ?? null, updatedAt: new Date() },
          {
            machine: poMachine,
            where: eq(purchaseOrders.companyId, po.companyId),
          }
        )
      );
      if (!row) throw new DomainError("PO_NOT_DRAFT", 409);
      logger.info({ purchaseOrderId: po.id, emailed: !!email?.sent }, "Purchase order sent");
      res.json({
        ...row,
        emailed: email?.sent === true,
        delivery: to ? "email" : "manual",
        message: to
          ? `Purchase order emailed to ${to}`
          : "Purchase order marked as sent (not emailed)",
      });
    })
  );

  // ── Approve (maker-checker + approval rules) ────────────────────────────
  app.post(
    "/api/purchase-orders/:id/approve",
    ...gate,
    asyncHandler(async (req: Request, res: Response) => {
      const po = await loadPo(req);
      if (po.status !== "sent" && po.status !== "draft") {
        throw new DomainError(
          "PO_NOT_APPROVABLE",
          409,
          { status: po.status },
          "Purchase order cannot be approved in current status"
        );
      }
      const actor = actorFromRequest(req);
      await assertCompanyPermission(actor, po.companyId, ["documents.approve"]);
      let amountFils = toFils(String(po.total), { rounding: "halfUp" });
      if ((po.currency || "AED") !== "AED") {
        try {
          const rate = await resolveDocRate(
            po.companyId,
            po.currency,
            new Date(po.date).toISOString().slice(0, 10)
          );
          amountFils = mulRate(amountFils, rate);
        } catch {
          /* no rate: rules evaluate the document amount */
        }
      }
      const out = await withLedgerTx(async (tx) => {
        const g = await evaluateApproval(tx, {
          companyId: po.companyId,
          documentType: "purchase_order",
          documentId: po.id,
          amountFils,
          makerId: po.createdBy ?? null,
          actor,
        });
        if (!g.final) return { gate: g, row: null };
        const row = await transitionRow(
          tx,
          purchaseOrders,
          po.id,
          ["draft", "sent"],
          "approved",
          { approvedBy: actor.id, approvedAt: new Date(), updatedAt: new Date() },
          { machine: poMachine, where: eq(purchaseOrders.companyId, po.companyId) }
        );
        if (!row) throw new DomainError("PO_STATE_CHANGED", 409);
        return { gate: g, row };
      });
      logger.info({ purchaseOrderId: po.id }, "Purchase order approved");
      res.json({
        ...(out.row ?? (await storage.getPurchaseOrder(po.id))),
        approval: {
          final: out.gate.final,
          step: out.gate.stepOrder,
          remainingSteps: out.gate.remainingSteps,
        },
        message: out.gate.final ? "Purchase order approved" : "Approval step recorded",
      });
    })
  );

  // ── Cancel ──────────────────────────────────────────────────────────────
  app.post(
    "/api/purchase-orders/:id/cancel",
    ...gate,
    strictBody(poCancelSchema),
    asyncHandler(async (req: Request, res: Response) => {
      const po = await loadPo(req);
      const lines = await linesOf(po.id);
      if (lines.some((l) => Number(l.quantityReceived) > 0 || Number(l.quantityBilled) > 0)) {
        throw new DomainError(
          "PO_HAS_ACTIVITY",
          409,
          undefined,
          "Goods were received or billed against this purchase order"
        );
      }
      const reason = (req.body as { reason?: string | null }).reason ?? null;
      const row = await withLedgerTx((tx) =>
        transitionRow(
          tx,
          purchaseOrders,
          po.id,
          ["draft", "sent", "approved"],
          "cancelled",
          { cancelledAt: new Date(), cancelReason: reason, updatedAt: new Date() },
          { machine: poMachine, where: eq(purchaseOrders.companyId, po.companyId) }
        )
      );
      if (!row)
        throw new DomainError(
          "PO_NOT_CANCELLABLE",
          409,
          { status: po.status },
          "Purchase order cannot be cancelled in current status"
        );
      await recordAudit({
        userId: req.user!.id,
        companyId: po.companyId,
        action: "purchase_order.cancel",
        entityType: "purchase_order",
        entityId: po.id,
        after: { reason },
        req,
      });
      res.json(row);
    })
  );

  // ── Receive (partial, line based) ───────────────────────────────────────
  app.post(
    "/api/purchase-orders/:id/receive",
    ...gate,
    strictBody(poReceiveSchema),
    asyncHandler(async (req: Request, res: Response) => {
      const po = await loadPo(req);
      if (po.status !== "approved" && po.status !== "partially_received") {
        throw new DomainError(
          "PO_NOT_RECEIVABLE",
          409,
          { status: po.status },
          "Purchase order must be approved before receiving"
        );
      }
      const body = parsedBody<PoReceiveInput>(req);
      const lines = await linesOf(po.id);
      const wanted = body.lines
        ? body.lines
        : lines
            .map((l) => ({
              lineId: l.id,
              quantity: Number(l.quantity) - Number(l.quantityReceived ?? 0),
            }))
            .filter((l) => l.quantity > 0);
      for (const w of wanted) {
        const l = lines.find((x) => x.id === w.lineId);
        if (!l) throw new DomainError("PO_LINE_NOT_FOUND", 404, { lineId: w.lineId });
        if (Number(l.quantityReceived ?? 0) + w.quantity > Number(l.quantity) + 1e-9) {
          throw new DomainError(
            "PO_OVER_RECEIVED",
            409,
            { lineId: l.id, outstanding: Number(l.quantity) - Number(l.quantityReceived ?? 0) },
            "Received quantity exceeds the ordered quantity"
          );
        }
      }
      if (wanted.length === 0) throw new DomainError("PO_NOTHING_TO_RECEIVE", 409);
      const receivedDate = body.receivedDate ?? new Date().toISOString().slice(0, 10);
      const result = await withLedgerTx(async (tx, { afterCommit }) => {
        const [receipt] = await tx
          .insert(purchaseOrderReceipts)
          .values({
            companyId: po.companyId,
            purchaseOrderId: po.id,
            receivedDate: new Date(`${receivedDate}T00:00:00.000Z`),
            notes: body.notes ?? null,
            createdBy: req.user!.id,
          })
          .returning();
        for (const w of wanted) {
          const upd = await tx
            .update(purchaseOrderLines)
            .set({ quantityReceived: sql`${purchaseOrderLines.quantityReceived} + ${w.quantity}` })
            .where(
              and(
                eq(purchaseOrderLines.id, w.lineId),
                eq(purchaseOrderLines.purchaseOrderId, po.id),
                sql`${purchaseOrderLines.quantityReceived} + ${w.quantity} <= ${purchaseOrderLines.quantity} + 0.000001`
              )
            )
            .returning();
          if (!upd[0]) throw new DomainError("PO_OVER_RECEIVED", 409, { lineId: w.lineId });
          await tx.insert(purchaseOrderReceiptLines).values({
            receiptId: receipt.id,
            purchaseOrderLineId: w.lineId,
            quantity: w.quantity,
          });
        }
        const after = (await tx
          .select()
          .from(purchaseOrderLines)
          .where(eq(purchaseOrderLines.purchaseOrderId, po.id))) as PurchaseOrderLine[];
        const complete = after.every(
          (l) => Number(l.quantityReceived) >= Number(l.quantity) - 1e-9
        );
        const target: PoState = complete ? "received" : "partially_received";
        if (target !== po.status) {
          const row = await transitionRow(
            tx,
            purchaseOrders,
            po.id,
            po.status as PoState,
            target,
            { updatedAt: new Date() },
            {
              machine: poMachine,
              where: eq(purchaseOrders.companyId, po.companyId),
            }
          );
          if (!row) throw new DomainError("PO_STATE_CHANGED", 409);
        }
        afterCommit(async () => {
          // Inventory hand-off for a later workstream; a no-op until it is registered.
          if (has("inventory.onGoodsReceived")) {
            const fn = resolve<(e: unknown) => Promise<void> | void>("inventory.onGoodsReceived");
            await fn({
              companyId: po.companyId,
              purchaseOrderId: po.id,
              receiptId: receipt.id,
              receivedDate,
              lines: wanted.map((w) => {
                const l = after.find((x) => x.id === w.lineId)!;
                return {
                  lineId: w.lineId,
                  productId: l.productId ?? null,
                  quantity: w.quantity,
                  unitPrice: l.unitPrice,
                };
              }),
            });
          }
        });
        return { receiptId: receipt.id, status: target, lines: after };
      });
      res.json({
        ...(await storage.getPurchaseOrder(po.id)),
        receiptId: result.receiptId,
        lines: result.lines,
        match: matchOf(result.lines),
        inventoryUpdated: has("inventory.onGoodsReceived"),
        message:
          result.status === "received" ? "Purchase order received" : "Partial receipt recorded",
      });
    })
  );

  // ── Convert to bill (outstanding quantities → pending bill) ─────────────
  app.post(
    "/api/purchase-orders/:id/convert-to-bill",
    ...gate,
    strictBody(poConvertSchema),
    asyncHandler(async (req: Request, res: Response) => {
      const po = await loadPo(req);
      if (!["approved", "partially_received", "received"].includes(po.status)) {
        throw new DomainError(
          "PO_NOT_APPROVED",
          409,
          { status: po.status },
          "Only approved purchase orders can be billed"
        );
      }
      const body = parsedBody<PoConvertInput>(req);
      const lines = await linesOf(po.id);
      const tracksReceipts = lines.some((l) => Number(l.quantityReceived) > 0);
      const wanted = body.lines
        ? body.lines
        : lines
            .map((l) => ({
              lineId: l.id,
              quantity:
                (tracksReceipts ? Number(l.quantityReceived) : Number(l.quantity)) -
                Number(l.quantityBilled ?? 0),
            }))
            .filter((l) => l.quantity > 1e-9);
      if (wanted.length === 0)
        throw new DomainError("PO_NOTHING_TO_BILL", 409, undefined, "Nothing outstanding to bill");
      const billLines = wanted.map((w) => {
        const l = lines.find((x) => x.id === w.lineId);
        if (!l) throw new DomainError("PO_LINE_NOT_FOUND", 404, { lineId: w.lineId });
        if (Number(l.quantityBilled ?? 0) + w.quantity > Number(l.quantity) + 1e-9) {
          throw new DomainError(
            "PO_OVER_BILLED",
            409,
            { lineId: l.id },
            "Billed quantity exceeds the ordered quantity"
          );
        }
        return { l, quantity: w.quantity };
      });
      const billDate = body.billDate ?? new Date().toISOString().slice(0, 10);
      const input = {
        vendor_id: po.vendorId ?? null,
        vendor_name: po.vendorName,
        vendor_trn: po.vendorTrn && /^\d{15}$/.test(po.vendorTrn) ? po.vendorTrn : null,
        bill_number: body.billNumber ?? null,
        bill_date: billDate,
        due_date: body.dueDate ?? null,
        currency: po.currency,
        exchange_rate: body.exchangeRate ?? null,
        notes: `From purchase order ${po.number}`,
        line_items: billLines.map(({ l, quantity }) => ({
          description: l.description,
          quantity,
          unit_price: toFils(String(l.unitPrice), { rounding: "halfUp" }),
          vat_rate: Number(l.vatRate) > 0 ? 5 : 0,
          vat_supply_type: (l.vatSupplyType as never) ?? undefined,
          account_id: l.accountId ?? null,
          product_id: l.productId ?? null,
        })),
      } as BillCreateInput;
      const out = await withLedgerTx(async (tx) => {
        for (const { l, quantity } of billLines) {
          const upd = await tx
            .update(purchaseOrderLines)
            .set({ quantityBilled: sql`${purchaseOrderLines.quantityBilled} + ${quantity}` })
            .where(
              and(
                eq(purchaseOrderLines.id, l.id),
                sql`${purchaseOrderLines.quantityBilled} + ${quantity} <= ${purchaseOrderLines.quantity} + 0.000001`
              )
            )
            .returning();
          if (!upd[0]) throw new DomainError("PO_OVER_BILLED", 409, { lineId: l.id });
        }
        return createBill({
          companyId: po.companyId,
          actorId: req.user!.id,
          input,
          status: "pending",
          origin: "purchase_order",
          originRef: po.id,
          purchaseOrderId: po.id,
          poLineIds: billLines.map(({ l }) => l.id),
          tx,
        });
      });
      const after = await linesOf(po.id);
      res
        .status(201)
        .json({
          bill: { ...out.bill, line_items: out.lines },
          match: matchOf(after),
          warnings: out.warnings,
        });
    })
  );

  // ── PDF ─────────────────────────────────────────────────────────────────
  app.get(
    "/api/purchase-orders/:id/pdf",
    ...gate,
    asyncHandler(async (req: Request, res: Response) => {
      const po = await loadPo(req);
      const lines = await linesOf(po.id);
      const company = await storage.getCompany(po.companyId);
      if (!company) throw new DomainError("COMPANY_NOT_FOUND", 404);
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
