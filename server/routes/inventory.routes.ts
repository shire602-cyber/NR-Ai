import type { Express, Request, Response } from "express";
import { z } from "zod";
import { storage } from "../storage";
import { authMiddleware, requireCustomer } from "../middleware/auth";
import { asyncHandler } from "../middleware/errorHandler";
import { validate } from "../middleware/validate";
import { createLogger } from "../config/logger";
import { assertPeriodNotLocked } from "../services/period-lock.service";
import { insertProductSchema } from "../../shared/schema";
import { pickAllowed } from "../utils/pick-allowed";
import { db } from "../db";
import { and, eq, sql } from "drizzle-orm";
import { products, inventoryMovements } from "../../shared/schema";
import { AppError } from "../errors";
import { calendarDaySchema } from "../utils/calendar-day-schema";
import { parseCalendarDay, uaeCalendarDate } from "../utils/date";
import {
  applyMovementInTx,
  isCostingEnabled,
  postInventoryOpeningInTx,
  resetProductValueInTx,
} from "../services/inventory-costing.service";

const log = createLogger("inventory");

// =====================================
// Zod schemas
// =====================================

const decimalString = z
  .union([z.string(), z.number()])
  .transform((v) => (typeof v === "number" ? v.toString() : v))
  .refine((v) => /^-?\d+(\.\d+)?$/.test(v), { message: "Must be a valid decimal number" });

const productCreateSchema = z.object({
  name: z.string().min(1, "Name is required").max(255),
  nameAr: z.string().max(255).optional().nullable(),
  sku: z.string().max(64).optional().nullable(),
  description: z.string().max(2000).optional().nullable(),
  unitPrice: decimalString,
  costPrice: decimalString.optional().nullable(),
  vatRate: decimalString.optional(),
  unit: z.string().min(1).max(32).optional(),
  currentStock: z.number().int().optional(),
  lowStockThreshold: z.number().int().nonnegative().optional().nullable(),
  isActive: z.boolean().optional(),
  // Only tracked products consume stock and post cost of goods sold when an invoice is issued.
  trackInventory: z.boolean().optional(),
});

const productUpdateSchema = productCreateSchema.partial();

const inventoryMovementSchema = z.object({
  type: z.enum(["purchase", "sale", "adjustment", "return"]),
  quantity: z
    .number({ invalid_type_error: "Quantity must be a number" })
    .int("Quantity must be an integer")
    .refine((n) => n !== 0, { message: "Quantity must not be zero" }),
  unitCost: decimalString.optional().nullable(),
  reference: z.string().max(255).optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
  // The day the stock moved (a calendar day, default today): it dates the movement, the valuation report and the journal.
  date: calendarDaySchema.optional(),
})
  // Direction is carried by `type`, not by the sign of the quantity: the handler
  // applies Math.abs() for purchase/sale/return, so a negative quantity there was
  // silently accepted and then ignored — "purchase -50" increased stock by 50.
  // Only an explicit stock adjustment may be signed.
  .refine((v) => v.type === "adjustment" || v.quantity > 0, {
    message:
      "Quantity must be positive — the movement type sets the direction. Use type 'adjustment' for a signed stock-take correction.",
    path: ["quantity"],
  });

export function registerInventoryRoutes(app: Express) {
  // =====================================
  // Product Routes
  // =====================================

  // List all products for a company
  app.get(
    "/api/companies/:companyId/products",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const userId = (req as any).user.id;

      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: "Access denied" });
      }

      const productsList = await storage.getProductsByCompanyId(companyId);
      res.json(productsList);
    })
  );

  // Get single product with recent movements
  app.get(
    "/api/products/:id",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { id } = req.params;
      const userId = (req as any).user.id;

      const product = await storage.getProduct(id);
      if (!product) {
        return res.status(404).json({ message: "Product not found" });
      }

      const hasAccess = await storage.hasCompanyAccess(userId, product.companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: "Access denied" });
      }

      const movements = await storage.getInventoryMovementsByProductId(id);

      res.json({ ...product, movements });
    })
  );

  // Create product
  app.post(
    "/api/companies/:companyId/products",
    authMiddleware,
    requireCustomer,
    validate({ body: productCreateSchema }),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const userId = (req as any).user.id;

      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: "Access denied" });
      }

      // S-M1: allowlist body fields, then pin the tenant scope. The running average cost is
      // derived, never client-supplied: it starts at the cost price (if any) and then follows
      // the purchase movements (inventory-costing.service).
      // A tracked product created with stock on hand brings that stock in at its cost price; with
      // costing on, the opening stock is journalled (Dr 1070 / Cr Opening Balance Equity).
      const product = await db.transaction(async (tx: typeof db) => {
        const [created] = await tx
          .insert(products)
          .values({
            ...pickAllowed(req.body, insertProductSchema, ["companyId", "averageCost", "inventoryValue"]),
            averageCost: Number(req.body.costPrice) > 0 ? Number(req.body.costPrice) : 0,
            companyId,
          } as any)
          .returning();
        if (!created.trackInventory) return created;
        await resetProductValueInTx(tx, companyId, created.id);
        if (await isCostingEnabled(tx, companyId)) await postInventoryOpeningInTx(tx, companyId, userId);
        const [fresh] = await tx.select().from(products).where(eq(products.id, created.id));
        return fresh;
      });

      log.info({ productId: product.id, companyId }, "Product created");
      res.json(product);
    })
  );

  // Update product
  app.patch(
    "/api/products/:id",
    authMiddleware,
    requireCustomer,
    validate({ body: productUpdateSchema }),
    asyncHandler(async (req: Request, res: Response) => {
      const { id } = req.params;
      const userId = (req as any).user.id;

      const product = await storage.getProduct(id);
      if (!product) {
        return res.status(404).json({ message: "Product not found" });
      }

      const hasAccess = await storage.hasCompanyAccess(userId, product.companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: "Access denied" });
      }

      // Stock figure or tracking changed outside a movement: re-derive the stock value and, with
      // costing on, journal the difference so Inventory (1070) keeps equal to the stock values.
      const stockOrTrackingChanged =
        (req.body.currentStock !== undefined && req.body.currentStock !== product.currentStock) ||
        (req.body.trackInventory !== undefined && req.body.trackInventory !== product.trackInventory);
      const updated = await db.transaction(async (tx: typeof db) => {
        const [row] = await tx.update(products).set(req.body).where(eq(products.id, id)).returning();
        if (!stockOrTrackingChanged) return row;
        // Opening stock sets the quantity AND the cost: stock that starts from nothing comes in at the cost price
        // (otherwise the quantity would carry a zero average and no value).
        if (Number(row.currentStock) > 0 && (Number(product.currentStock) <= 0 || !(Number(row.averageCost) > 0)) && Number(row.costPrice) > 0) {
          await tx.update(products).set({ averageCost: Number(row.costPrice) }).where(eq(products.id, id));
        }
        await resetProductValueInTx(tx, product.companyId, id);
        if (await isCostingEnabled(tx, product.companyId)) await postInventoryOpeningInTx(tx, product.companyId, userId);
        const [fresh] = await tx.select().from(products).where(eq(products.id, id));
        return fresh;
      });
      log.info({ productId: id }, "Product updated");
      res.json(updated);
    })
  );

  // Delete product
  app.delete(
    "/api/products/:id",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { id } = req.params;
      const userId = (req as any).user.id;

      const product = await storage.getProduct(id);
      if (!product) {
        return res.status(404).json({ message: "Product not found" });
      }

      const hasAccess = await storage.hasCompanyAccess(userId, product.companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: "Access denied" });
      }

      // A product with stock history is part of the books (its movements, and the value that sits in
      // Inventory 1070): deactivate it instead, so voiding an invoice can still return its stock.
      const [{ n }] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(inventoryMovements)
        .where(and(eq(inventoryMovements.productId, id), eq(inventoryMovements.companyId, product.companyId)));
      if (n > 0 || Number(product.inventoryValue) !== 0) {
        throw new AppError({
          message: "This product has stock movements and cannot be deleted. Deactivate it instead.",
          statusCode: 409,
          code: "PRODUCT_HAS_MOVEMENTS",
        });
      }

      await storage.deleteProduct(id);
      log.info({ productId: id }, "Product deleted");
      res.json({ message: "Product deleted successfully" });
    })
  );

  // =====================================
  // Inventory Movement Routes
  // =====================================

  // Add inventory movement and update stock
  app.post(
    "/api/products/:id/movements",
    authMiddleware,
    requireCustomer,
    validate({ body: inventoryMovementSchema }),
    asyncHandler(async (req: Request, res: Response) => {
      const { id } = req.params;
      const userId = (req as any).user.id;

      const product = await storage.getProduct(id);
      if (!product) {
        return res.status(404).json({ message: "Product not found" });
      }

      const hasAccess = await storage.hasCompanyAccess(userId, product.companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: "Access denied" });
      }

      const { type, quantity, unitCost, reference, notes } = req.body;

      // A movement is dated the day the stock moved (not the day it was typed in). Not in the future, and
      // not inside a closed period.
      const today = uaeCalendarDate();
      const movementDay = req.body.date ? parseCalendarDay(req.body.date) ?? today : today;
      if (movementDay.getTime() > today.getTime()) {
        return res.status(422).json({ message: "A stock movement cannot be dated in the future.", code: "FUTURE_DATE" });
      }
      await assertPeriodNotLocked(product.companyId, movementDay);

      // One transaction: lock the product row, check stock, record the movement, re-average the
      // cost and update stock together (no movement is left behind by a refused sale).
      const outcome = await db.transaction((tx: typeof db) =>
        applyMovementInTx(tx, {
          productId: id,
          companyId: product.companyId,
          type,
          quantity,
          unitCost: unitCost || null,
          reference: reference || null,
          notes: notes || null,
          userId,
          date: movementDay,
        })
      );
      if (!outcome.productFound) {
        return res.status(404).json({ message: "Product not found" });
      }

      // You cannot sell stock you do not hold. Selling 999 units of a product
      // with 10 on hand used to return 200 and leave currentStock at -989 —
      // which then flows into inventory valuation and cost of goods sold as a
      // negative asset. An explicit stock-take correction is what `adjustment`
      // is for, so only that type may drive the balance negative.
      if (!outcome.ok) {
        return res.status(422).json({
          message: `Insufficient stock: ${outcome.onHand} on hand, ${outcome.requested} requested. Record a stock adjustment if the on-hand figure is wrong.`,
          code: "INSUFFICIENT_STOCK",
          details: { onHand: outcome.onHand, requested: outcome.requested },
        });
      }
      const { newStock } = outcome;
      const movement = { id: outcome.movementId, productId: id, type, quantity, unitCost: unitCost || null };

      log.info({ productId: id, type, quantity, newStock }, "Inventory movement recorded");
      res.json({ movement, newStock, averageCost: outcome.averageCost });
    })
  );

  // List all movements for a company
  app.get(
    "/api/companies/:companyId/inventory-movements",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const userId = (req as any).user.id;

      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: "Access denied" });
      }

      const movements = await storage.getInventoryMovementsByCompanyId(companyId);
      res.json(movements);
    })
  );
}
