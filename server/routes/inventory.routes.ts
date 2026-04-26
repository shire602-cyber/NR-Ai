import type { Express, Request, Response } from 'express';
import { z } from 'zod';
import { storage } from '../storage';
import { authMiddleware, requireCustomer } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';
import { validate } from '../middleware/validate';
import { createLogger } from '../config/logger';
import { assertPeriodNotLocked } from '../services/period-lock.service';

const log = createLogger('inventory');

// =====================================
// Zod schemas
// =====================================

const decimalString = z
  .union([z.string(), z.number()])
  .transform((v) => (typeof v === 'number' ? v.toString() : v))
  .refine((v) => /^-?\d+(\.\d+)?$/.test(v), { message: 'Must be a valid decimal number' });

const productCreateSchema = z.object({
  name: z.string().min(1, 'Name is required').max(255),
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
});

const productUpdateSchema = productCreateSchema.partial();

const inventoryMovementSchema = z.object({
  type: z.enum(['purchase', 'sale', 'adjustment', 'return']),
  quantity: z
    .number({ invalid_type_error: 'Quantity must be a number' })
    .int('Quantity must be an integer')
    .refine((n) => n !== 0, { message: 'Quantity must not be zero' }),
  unitCost: decimalString.optional().nullable(),
  reference: z.string().max(255).optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
});

export function registerInventoryRoutes(app: Express) {
  // =====================================
  // Product Routes
  // =====================================

  // List all products for a company
  app.get("/api/companies/:companyId/products", authMiddleware, requireCustomer, asyncHandler(async (req: Request, res: Response) => {
    const { companyId } = req.params;
    const userId = (req as any).user.id;

    const hasAccess = await storage.hasCompanyAccess(userId, companyId);
    if (!hasAccess) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const productsList = await storage.getProductsByCompanyId(companyId);
    res.json(productsList);
  }));

  // Get single product with recent movements
  app.get("/api/products/:id", authMiddleware, requireCustomer, asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const userId = (req as any).user.id;

    const product = await storage.getProduct(id);
    if (!product) {
      return res.status(404).json({ message: 'Product not found' });
    }

    const hasAccess = await storage.hasCompanyAccess(userId, product.companyId);
    if (!hasAccess) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const movements = await storage.getInventoryMovementsByProductId(id);

    res.json({ ...product, movements });
  }));

  // Create product
  app.post("/api/companies/:companyId/products", authMiddleware, requireCustomer, validate({ body: productCreateSchema }), asyncHandler(async (req: Request, res: Response) => {
    const { companyId } = req.params;
    const userId = (req as any).user.id;

    const hasAccess = await storage.hasCompanyAccess(userId, companyId);
    if (!hasAccess) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const product = await storage.createProduct({
      ...req.body,
      companyId,
    });

    log.info({ productId: product.id, companyId }, 'Product created');
    res.json(product);
  }));

  // Update product
  app.patch("/api/products/:id", authMiddleware, requireCustomer, validate({ body: productUpdateSchema }), asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const userId = (req as any).user.id;

    const product = await storage.getProduct(id);
    if (!product) {
      return res.status(404).json({ message: 'Product not found' });
    }

    const hasAccess = await storage.hasCompanyAccess(userId, product.companyId);
    if (!hasAccess) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const updated = await storage.updateProduct(id, req.body);
    log.info({ productId: id }, 'Product updated');
    res.json(updated);
  }));

  // Delete product
  app.delete("/api/products/:id", authMiddleware, requireCustomer, asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const userId = (req as any).user.id;

    const product = await storage.getProduct(id);
    if (!product) {
      return res.status(404).json({ message: 'Product not found' });
    }

    const hasAccess = await storage.hasCompanyAccess(userId, product.companyId);
    if (!hasAccess) {
      return res.status(403).json({ message: 'Access denied' });
    }

    await storage.deleteProduct(id);
    log.info({ productId: id }, 'Product deleted');
    res.json({ message: 'Product deleted successfully' });
  }));

  // =====================================
  // Inventory Movement Routes
  // =====================================

  // Add inventory movement and update stock
  app.post("/api/products/:id/movements", authMiddleware, requireCustomer, validate({ body: inventoryMovementSchema }), asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const userId = (req as any).user.id;

    const product = await storage.getProduct(id);
    if (!product) {
      return res.status(404).json({ message: 'Product not found' });
    }

    const hasAccess = await storage.hasCompanyAccess(userId, product.companyId);
    if (!hasAccess) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const { type, quantity, unitCost, reference, notes } = req.body;

    // Inventory movements change stock value (and COGS for sales) as of today —
    // refuse if today falls inside a closed period.
    await assertPeriodNotLocked(product.companyId, new Date());


    // Create the movement
    const movement = await storage.createInventoryMovement({
      productId: id,
      companyId: product.companyId,
      type,
      quantity,
      unitCost: unitCost || null,
      reference: reference || null,
      notes: notes || null,
    });

    // Update product stock based on movement type
    let stockChange = 0;
    switch (type) {
      case 'purchase':
      case 'return':
        stockChange = Math.abs(quantity);
        break;
      case 'sale':
        stockChange = -Math.abs(quantity);
        break;
      case 'adjustment':
        stockChange = quantity; // Can be positive or negative
        break;
    }

    const newStock = product.currentStock + stockChange;
    await storage.updateProduct(id, { currentStock: newStock });

    log.info({ productId: id, type, quantity, newStock }, 'Inventory movement recorded');
    res.json({ movement, newStock });
  }));

  // List all movements for a company
  app.get("/api/companies/:companyId/inventory-movements", authMiddleware, requireCustomer, asyncHandler(async (req: Request, res: Response) => {
    const { companyId } = req.params;
    const userId = (req as any).user.id;

    const hasAccess = await storage.hasCompanyAccess(userId, companyId);
    if (!hasAccess) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const movements = await storage.getInventoryMovementsByCompanyId(companyId);
    res.json(movements);
  }));
}
