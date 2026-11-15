import type { Express, Request, Response } from "express";
import { storage } from "../storage";
import { authMiddleware, requireCustomer } from "../middleware/auth";
import { asyncHandler } from "../middleware/errorHandler";
import { strictBody } from "../http/strict-body";
import { parsedBody } from "../http/parsed-body";
import { createLogger } from "../config/logger";
import { assertPeriodNotLocked } from "../services/period-lock.service";
import {
  createProductBody,
  inventoryMovementBody,
  updateProductBody,
  type CreateProductBody,
  type InventoryMovementBody,
  type UpdateProductBody,
} from "../../shared/validators/products";

const log = createLogger("inventory");

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
    strictBody(createProductBody),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const userId = (req as any).user.id;

      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: "Access denied" });
      }

      // SKU uniqueness per company is enforced by uq_products_company_sku (23505 -> 409).
      const body = parsedBody<CreateProductBody>(req);
      const product = await storage.createProduct({
        ...body,
        sku: body.sku ?? null,
        companyId,
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
    strictBody(updateProductBody),
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

      const updated = await storage.updateProduct(id, req.body as UpdateProductBody);
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
    strictBody(inventoryMovementBody),
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

      const { type, quantity, unitCost, reference, notes } = req.body as InventoryMovementBody;

      // Inventory movements change stock value (and COGS for sales) as of today —
      // refuse if today falls inside a closed period.
      await assertPeriodNotLocked(product.companyId, new Date());

      // Stock check, movement insert and stock update are ONE transaction on a locked product
      // row (R10-03): a rejected sale (422 INSUFFICIENT_STOCK) writes no movement row, and two
      // concurrent sales cannot both pass the check.
      const { movement, newStock } = await storage.applyInventoryMovement({
        productId: id,
        companyId: product.companyId,
        type,
        quantity,
        unitCost: unitCost ?? null,
        reference: reference ?? null,
        notes: notes ?? null,
      });

      log.info({ productId: id, type, quantity, newStock }, "Inventory movement recorded");
      res.json({ movement, newStock });
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
