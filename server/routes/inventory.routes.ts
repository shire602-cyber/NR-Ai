import type { Express, Request, Response } from "express";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { storage } from "../storage";
import { authMiddleware, requireCustomer } from "../middleware/auth";
import { asyncHandler } from "../middleware/errorHandler";
import { assertUaeVatRate } from "../http/vat-rate-guard";
import { strictBody } from "../http/strict-body";
import { parsedBody } from "../http/parsed-body";
import { createLogger } from "../config/logger";
import { DomainError } from "../errors";
import { pool } from "../db";
import { withLedgerTx } from "../ledger";
import { assertChosenAccountsNotControl } from "../ledger/control-accounts";
import { assertPeriodNotLocked } from "../services/period-lock.service";
import { actorFromRequest, assertCompanyPermission } from "../services/approval-rules.service";
import { fromFils, toFils } from "../../shared/money";
import {
  bundleComponentsBody,
  createInventoryProductBody,
  inventorySettingsBody,
  stockMovementBody,
  stocktakeBody,
  transferBody,
  updateInventoryProductBody,
  updateWarehouseBody,
  warehouseBody,
  writeDownBody,
  type BundleComponentsBody,
  type CreateInventoryProductBody,
  type InventorySettingsBody,
  type StockMovementBody,
  type StocktakeBody,
  type TransferBody,
  type UpdateInventoryProductBody,
  type UpdateWarehouseBody,
  type WarehouseBody,
  type WriteDownBody,
} from "../../shared/validators/inventory";
import { recordAudit } from "../services/audit.service";
import { zDate, zMoneyFils, zUuid } from "../../shared/validators/primitives";
import {
  applyOpeningBackfill,
  openingBackfillProposal,
  createStocktake,
  inventoryAgeing,
  inventoryMovementReport,
  inventoryValuation,
  postStocktake,
  recordManualMovement,
  recordOpeningStock,
  registerInventoryServices,
  reorderList,
  transferStock,
  writeDownStock,
  reverseWriteDown,
} from "../services/inventory";
import { assertAccount, assertWarehouse, defaultWarehouse, q } from "../services/inventory/store";

const log = createLogger("inventory");
const today = () => new Date().toISOString().slice(0, 10);

/** S2: reviewed opening-stock valuation rows (unitCost in fils overrides the cost price). */
const openingBackfillBody = z
  .object({
    date: zDate,
    items: z
      .array(
        z
          .object({
            productId: zUuid,
            unitCost: zMoneyFils
              .refine((f) => f > 0, "Unit cost must be greater than zero")
              .optional()
              .nullable(),
          })
          .strict()
      )
      .min(1)
      .max(500),
  })
  .strict();

async function assertAccess(req: Request, companyId: string): Promise<void> {
  const ok = await storage.hasCompanyAccess(req.user!.id, companyId);
  if (!ok) throw new DomainError("COMPANY_ACCESS_DENIED", 403, undefined, "Access denied");
}

async function loadProduct(req: Request) {
  const product = await storage.getProduct(req.params.id);
  if (!product) throw new DomainError("PRODUCT_NOT_FOUND", 404, undefined, "Product not found");
  await assertAccess(req, product.companyId);
  return product;
}

async function validateProductAccounts(
  companyId: string,
  body: { inventoryAccountId?: string | null; cogsAccountId?: string | null }
) {
  await withLedgerTx(async (tx) => {
    if (body.inventoryAccountId)
      await assertAccount(tx, companyId, body.inventoryAccountId, ["asset"]);
    if (body.cogsAccountId) await assertAccount(tx, companyId, body.cogsAccountId, ["expense"]);
    // C1: a product's inventory account is its stock control account (1070 or an inventory
    // account of its own); it may not be another sub-ledger's control account (1040, 1050, ...).
    await assertChosenAccountsNotControl(
      companyId,
      [
        { field: "inventoryAccountId", accountId: body.inventoryAccountId },
        { field: "cogsAccountId", accountId: body.cogsAccountId },
      ],
      { tx, allow: ["inventory"] }
    );
  });
}

export function registerInventoryRoutes(app: Express) {
  registerInventoryServices();

  // =====================================
  // Products
  // =====================================

  app.get(
    "/api/companies/:companyId/products",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      await assertAccess(req, req.params.companyId);
      res.json(await storage.getProductsByCompanyId(req.params.companyId));
    })
  );

  app.get(
    "/api/products/:id",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const product = await loadProduct(req);
      const movements = await storage.getInventoryMovementsByProductId(product.id);
      const levels = await pool.query(
        `SELECT l.warehouse_id, w.code, w.name, w.name_ar, l.quantity
           FROM inventory_stock_levels l JOIN warehouses w ON w.id = l.warehouse_id
          WHERE l.product_id = $1 ORDER BY w.code`,
        [product.id]
      );
      const components = await pool.query(
        `SELECT c.component_product_id AS "productId", c.quantity, p.name, p.sku
           FROM product_components c JOIN products p ON p.id = c.component_product_id
          WHERE c.bundle_product_id = $1 ORDER BY p.name`,
        [product.id]
      );
      res.json({ ...product, movements, stockLevels: levels.rows, components: components.rows });
    })
  );

  // Create product (opening stock is valued at cost price and posted to Opening Balance Equity).
  app.post(
    "/api/companies/:companyId/products",
    authMiddleware,
    requireCustomer,
    strictBody(createInventoryProductBody),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      await assertAccess(req, companyId);
      const body = parsedBody<CreateInventoryProductBody>(req);
      if (body.vatRate !== undefined) assertUaeVatRate(body.vatRate, "vatRate", "VAT rate");
      await validateProductAccounts(companyId, body);
      const { currentStock, openingStockDate, ...fields } = body;
      const opening = currentStock ?? 0;
      const stocked =
        (fields.productType ?? "inventory") === "inventory" && fields.trackInventory !== false;
      if (opening > 0 && !stocked) {
        throw new DomainError(
          "PRODUCT_NOT_STOCKED",
          422,
          undefined,
          "Only stock items carry opening stock"
        );
      }
      const date = openingStockDate ?? today();
      if (opening > 0) await assertPeriodNotLocked(companyId, date);
      // SKU uniqueness per company is enforced by uq_products_company_sku (23505 -> 409).
      const product = await storage.createProduct({
        ...fields,
        sku: fields.sku ?? null,
        currentStock: 0,
        companyId,
      });
      if (opening > 0) {
        try {
          await withLedgerTx((tx) =>
            recordOpeningStock(tx, {
              companyId,
              productId: product.id,
              quantity: opening,
              unitCostFils: toFils(String(fields.costPrice ?? 0), { rounding: "halfUp" }),
              date,
              actorId: req.user!.id,
            })
          );
        } catch (err) {
          await storage.deleteProduct(product.id);
          throw err;
        }
      }
      log.info({ productId: product.id, companyId }, "Product created");
      res.json(await storage.getProduct(product.id));
    })
  );

  app.patch(
    "/api/products/:id",
    authMiddleware,
    requireCustomer,
    strictBody(updateInventoryProductBody),
    asyncHandler(async (req: Request, res: Response) => {
      const product = await loadProduct(req);
      const body = parsedBody<UpdateInventoryProductBody>(req);
      if (body.vatRate !== undefined) assertUaeVatRate(body.vatRate, "vatRate", "VAT rate");
      await validateProductAccounts(product.companyId, body);
      const typeChanges =
        (body.productType && body.productType !== product.productType) ||
        (body.trackInventory !== undefined && body.trackInventory !== product.trackInventory) ||
        (body.inventoryAccountId !== undefined &&
          body.inventoryAccountId !== product.inventoryAccountId);
      if (typeChanges && (Number(product.currentStock) !== 0 || Number(product.stockValue) !== 0)) {
        throw new DomainError(
          "PRODUCT_HAS_STOCK",
          409,
          { currentStock: product.currentStock },
          "Bring stock to zero before changing the product type, tracking or inventory account"
        );
      }
      const updated = await storage.updateProduct(product.id, body);
      log.info({ productId: product.id }, "Product updated");
      res.json(updated);
    })
  );

  app.delete(
    "/api/products/:id",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const product = await loadProduct(req);
      const used = await pool.query(
        `SELECT 1 FROM inventory_movements WHERE product_id = $1 AND journal_entry_id IS NOT NULL LIMIT 1`,
        [product.id]
      );
      if (used.rows.length) {
        throw new DomainError(
          "PRODUCT_HAS_POSTED_MOVEMENTS",
          409,
          undefined,
          "This product has posted stock movements. Deactivate it instead of deleting it."
        );
      }
      await storage.deleteProduct(product.id);
      log.info({ productId: product.id }, "Product deleted");
      res.json({ message: "Product deleted successfully" });
    })
  );

  // Bundle / kit components (R10-16).
  app.put(
    "/api/products/:id/components",
    authMiddleware,
    requireCustomer,
    strictBody(bundleComponentsBody),
    asyncHandler(async (req: Request, res: Response) => {
      const product = await loadProduct(req);
      if (product.productType !== "bundle") {
        throw new DomainError(
          "PRODUCT_NOT_BUNDLE",
          422,
          undefined,
          "Only bundle products have components"
        );
      }
      const { components } = parsedBody<BundleComponentsBody>(req);
      await withLedgerTx(async (tx) => {
        await tx.execute(
          sql`DELETE FROM product_components WHERE bundle_product_id = ${product.id}`
        );
        for (const c of components) {
          if (c.productId === product.id) throw new DomainError("BUNDLE_SELF_REFERENCE", 422);
          const comp = await q<{ product_type: string }>(
            tx,
            sql`SELECT product_type FROM products WHERE id = ${c.productId} AND company_id = ${product.companyId}`
          );
          if (!comp[0]) throw new DomainError("PRODUCT_NOT_FOUND", 404, { productId: c.productId });
          if (comp[0].product_type !== "inventory") {
            throw new DomainError("BUNDLE_COMPONENT_NOT_STOCKED", 422, { productId: c.productId });
          }
          await tx.execute(
            sql`INSERT INTO product_components (company_id, bundle_product_id, component_product_id, quantity)
                VALUES (${product.companyId}, ${product.id}, ${c.productId}, ${c.quantity})`
          );
        }
      });
      res.json({ productId: product.id, components });
    })
  );

  // =====================================
  // Stock movements (R10-01, R10-09)
  // =====================================

  app.post(
    "/api/products/:id/movements",
    authMiddleware,
    requireCustomer,
    strictBody(stockMovementBody),
    asyncHandler(async (req: Request, res: Response) => {
      const product = await loadProduct(req);
      const body = parsedBody<StockMovementBody>(req);
      const date = body.date ?? today();
      // Movements change stock value (and COGS) on `date` — refuse a closed period.
      await assertPeriodNotLocked(product.companyId, date);
      const result = await withLedgerTx((tx, { afterCommit }) =>
        recordManualMovement(tx, {
          companyId: product.companyId,
          productId: product.id,
          type: body.type,
          quantity: body.quantity,
          unitCostFils: body.unitCost ?? null,
          date,
          counterAccountId: body.counterAccountId ?? null,
          warehouseId: body.warehouseId ?? null,
          lotNumber: body.lotNumber ?? null,
          serialNumber: body.serialNumber ?? null,
          reference: body.reference ?? null,
          notes: body.notes ?? null,
          actorId: req.user!.id,
          afterCommit,
        })
      );
      const movement = (
        await pool.query(`SELECT * FROM inventory_movements WHERE id = $1`, [result.movementId])
      ).rows[0];
      log.info(
        { productId: product.id, type: body.type, newStock: result.newStock },
        "Stock movement"
      );
      res.json({
        movement,
        newStock: result.newStock,
        journalEntryId: result.journalEntryId,
        value: fromFils(result.valueFils),
        warnings: result.warning ? [result.warning] : [],
      });
    })
  );

  app.post(
    "/api/products/:id/write-down",
    authMiddleware,
    requireCustomer,
    strictBody(writeDownBody),
    asyncHandler(async (req: Request, res: Response) => {
      const product = await loadProduct(req);
      await assertCompanyPermission(actorFromRequest(req), product.companyId, ["ledger.post"]);
      const body = parsedBody<WriteDownBody>(req);
      const date = body.date ?? today();
      await assertPeriodNotLocked(product.companyId, date);
      const r = await withLedgerTx((tx) =>
        writeDownStock(tx, {
          companyId: product.companyId,
          productId: product.id,
          amountFils: body.amount,
          date,
          reason: body.reason,
          actorId: req.user!.id,
        })
      );
      res.status(201).json({ ...r, value: fromFils(r.valueFils) });
    })
  );

  // L8 (A4, IAS 2.33): reverse an earlier NRV write-down (capped at write-downs not reversed).
  app.post(
    "/api/products/:id/write-down-reversal",
    authMiddleware,
    requireCustomer,
    strictBody(writeDownBody),
    asyncHandler(async (req: Request, res: Response) => {
      const product = await loadProduct(req);
      await assertCompanyPermission(actorFromRequest(req), product.companyId, ["ledger.post"]);
      const body = parsedBody<WriteDownBody>(req);
      const date = body.date ?? today();
      await assertPeriodNotLocked(product.companyId, date);
      const r = await withLedgerTx((tx) =>
        reverseWriteDown(tx, {
          companyId: product.companyId,
          productId: product.id,
          amountFils: body.amount,
          date,
          reason: body.reason,
          actorId: req.user!.id,
        })
      );
      res
        .status(201)
        .json({ ...r, value: fromFils(r.valueFils), reversible: fromFils(r.reversibleFils) });
    })
  );

  // ── Opening-stock valuation backfill (S2, W4-B residual) ────────────────
  // Products holding stock with no value get a reviewable proposal (GET); the reviewer posts the
  // rows they accept (POST): Dr Inventory / Cr 3040 Opening Balance Equity through the ledger.
  app.get(
    "/api/companies/:companyId/inventory/opening-backfill",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      await assertAccess(req, companyId);
      const rows = await withLedgerTx((tx) => openingBackfillProposal(tx, companyId));
      res.json({
        items: rows.map((r) => ({
          ...r,
          unitCost: r.unitCostFils === null ? null : fromFils(r.unitCostFils),
          proposedValue: fromFils(r.proposedValueFils),
        })),
        totalValue: fromFils(rows.reduce((s, r) => s + r.proposedValueFils, 0)),
      });
    })
  );

  app.post(
    "/api/companies/:companyId/inventory/opening-backfill",
    authMiddleware,
    requireCustomer,
    strictBody(openingBackfillBody),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      await assertAccess(req, companyId);
      await assertCompanyPermission(actorFromRequest(req), companyId, ["ledger.post"]);
      const body = parsedBody<z.output<typeof openingBackfillBody>>(req);
      await assertPeriodNotLocked(companyId, body.date);
      const posted = await withLedgerTx((tx) =>
        applyOpeningBackfill(tx, {
          companyId,
          date: body.date,
          actorId: req.user!.id,
          items: body.items.map((i) => ({
            productId: i.productId,
            unitCostFils: i.unitCost ?? null,
          })),
        })
      );
      await recordAudit({
        userId: req.user!.id,
        companyId,
        action: "inventory.opening_backfill",
        entityType: "company",
        entityId: companyId,
        after: { date: body.date, products: posted.length, items: posted },
        req,
      });
      res.status(201).json({
        items: posted.map((p) => ({ ...p, value: fromFils(p.valueFils) })),
      });
    })
  );

  app.get(
    "/api/companies/:companyId/inventory-movements",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      await assertAccess(req, req.params.companyId);
      res.json(await storage.getInventoryMovementsByCompanyId(req.params.companyId));
    })
  );

  // =====================================
  // Settings (costing method, negative-stock policy)
  // =====================================

  app.get(
    "/api/companies/:companyId/inventory/settings",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      await assertAccess(req, req.params.companyId);
      const r = await pool.query(
        `SELECT costing_method, allow_negative_stock FROM inventory_settings WHERE company_id = $1`,
        [req.params.companyId]
      );
      res.json({
        costingMethod: r.rows[0]?.costing_method ?? "weighted_average",
        allowNegativeStock: r.rows[0]?.allow_negative_stock === true,
      });
    })
  );

  app.put(
    "/api/companies/:companyId/inventory/settings",
    authMiddleware,
    requireCustomer,
    strictBody(inventorySettingsBody),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      await assertAccess(req, companyId);
      await assertCompanyPermission(actorFromRequest(req), companyId, ["settings.company"]);
      const body = parsedBody<InventorySettingsBody>(req);
      const r = await pool.query(
        `INSERT INTO inventory_settings (company_id, costing_method, allow_negative_stock)
         VALUES ($1, COALESCE($2, 'weighted_average'), COALESCE($3, false))
         ON CONFLICT (company_id) DO UPDATE SET
           costing_method = COALESCE($2, inventory_settings.costing_method),
           allow_negative_stock = COALESCE($3, inventory_settings.allow_negative_stock),
           updated_at = now()
         RETURNING costing_method, allow_negative_stock`,
        [companyId, body.costingMethod ?? null, body.allowNegativeStock ?? null]
      );
      res.json({
        costingMethod: r.rows[0].costing_method,
        allowNegativeStock: r.rows[0].allow_negative_stock,
      });
    })
  );

  // =====================================
  // Warehouses + transfers (R10-16)
  // =====================================

  app.get(
    "/api/companies/:companyId/warehouses",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      await assertAccess(req, companyId);
      await withLedgerTx((tx) => defaultWarehouse(tx, companyId));
      const r = await pool.query(
        `SELECT w.*, COALESCE((SELECT SUM(quantity) FROM inventory_stock_levels l WHERE l.warehouse_id = w.id), 0)::int AS "totalUnits"
           FROM warehouses w WHERE w.company_id = $1 ORDER BY w.is_default DESC, w.code`,
        [companyId]
      );
      res.json(r.rows);
    })
  );

  app.post(
    "/api/companies/:companyId/warehouses",
    authMiddleware,
    requireCustomer,
    strictBody(warehouseBody),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      await assertAccess(req, companyId);
      const body = parsedBody<WarehouseBody>(req);
      const row = await withLedgerTx(async (tx) => {
        await defaultWarehouse(tx, companyId);
        if (body.isDefault) {
          await tx.execute(
            sql`UPDATE warehouses SET is_default = false WHERE company_id = ${companyId}`
          );
        }
        const r = await q(
          tx,
          sql`INSERT INTO warehouses (company_id, code, name, name_ar, is_default)
              VALUES (${companyId}, ${body.code}, ${body.name}, ${body.nameAr ?? null}, ${body.isDefault === true})
              RETURNING *`
        );
        return r[0];
      });
      res.status(201).json(row);
    })
  );

  app.patch(
    "/api/companies/:companyId/warehouses/:warehouseId",
    authMiddleware,
    requireCustomer,
    strictBody(updateWarehouseBody),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId, warehouseId } = req.params;
      await assertAccess(req, companyId);
      const body = parsedBody<UpdateWarehouseBody>(req);
      const row = await withLedgerTx(async (tx) => {
        const found = await q<{ is_default: boolean }>(
          tx,
          sql`SELECT is_default FROM warehouses WHERE id = ${warehouseId} AND company_id = ${companyId} FOR UPDATE`
        );
        if (!found[0]) throw new DomainError("WAREHOUSE_NOT_FOUND", 404);
        if (body.isActive === false) {
          const stock = await q(
            tx,
            sql`SELECT 1 FROM inventory_stock_levels WHERE warehouse_id = ${warehouseId} AND quantity <> 0 LIMIT 1`
          );
          if (stock[0] || found[0].is_default) {
            throw new DomainError(
              "WAREHOUSE_IN_USE",
              409,
              undefined,
              "Move the stock out first; the default warehouse stays active"
            );
          }
        }
        if (body.isDefault) {
          await tx.execute(
            sql`UPDATE warehouses SET is_default = false WHERE company_id = ${companyId}`
          );
        }
        const r = await q(
          tx,
          sql`UPDATE warehouses SET
                code = COALESCE(${body.code ?? null}, code),
                name = COALESCE(${body.name ?? null}, name),
                name_ar = COALESCE(${body.nameAr ?? null}, name_ar),
                is_default = COALESCE(${body.isDefault ?? null}, is_default),
                is_active = COALESCE(${body.isActive ?? null}, is_active)
              WHERE id = ${warehouseId} AND company_id = ${companyId} RETURNING *`
        );
        return r[0];
      });
      res.json(row);
    })
  );

  app.post(
    "/api/companies/:companyId/inventory/transfers",
    authMiddleware,
    requireCustomer,
    strictBody(transferBody),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      await assertAccess(req, companyId);
      const body = parsedBody<TransferBody>(req);
      const out = await withLedgerTx(async (tx) => {
        await assertWarehouse(tx, companyId, body.fromWarehouseId);
        await assertWarehouse(tx, companyId, body.toWarehouseId);
        return transferStock(tx, {
          companyId,
          productId: body.productId,
          fromWarehouseId: body.fromWarehouseId,
          toWarehouseId: body.toWarehouseId,
          quantity: body.quantity,
          date: body.date ?? today(),
          actorId: req.user!.id,
          notes: body.notes ?? null,
          lotNumber: body.lotNumber ?? null,
        });
      });
      res.status(201).json(out);
    })
  );

  // =====================================
  // Stocktakes (R10-16)
  // =====================================

  app.get(
    "/api/companies/:companyId/stocktakes",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      await assertAccess(req, req.params.companyId);
      const r = await pool.query(
        `SELECT s.*, to_char(s.count_date, 'YYYY-MM-DD') AS count_date,
                (SELECT COUNT(*) FROM stocktake_lines l WHERE l.stocktake_id = s.id)::int AS "lineCount"
           FROM stocktakes s WHERE s.company_id = $1 ORDER BY s.created_at DESC`,
        [req.params.companyId]
      );
      res.json(r.rows);
    })
  );

  app.get(
    "/api/companies/:companyId/stocktakes/:stocktakeId",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId, stocktakeId } = req.params;
      await assertAccess(req, companyId);
      const s = await pool.query(`SELECT * FROM stocktakes WHERE id = $1 AND company_id = $2`, [
        stocktakeId,
        companyId,
      ]);
      if (!s.rows[0]) throw new DomainError("STOCKTAKE_NOT_FOUND", 404);
      const lines = await pool.query(
        `SELECT l.*, p.name, p.sku FROM stocktake_lines l JOIN products p ON p.id = l.product_id
          WHERE l.stocktake_id = $1 ORDER BY p.name`,
        [stocktakeId]
      );
      res.json({ ...s.rows[0], lines: lines.rows });
    })
  );

  app.post(
    "/api/companies/:companyId/stocktakes",
    authMiddleware,
    requireCustomer,
    strictBody(stocktakeBody),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      await assertAccess(req, companyId);
      const body = parsedBody<StocktakeBody>(req);
      const st = await withLedgerTx((tx) =>
        createStocktake(tx, {
          companyId,
          warehouseId: body.warehouseId ?? null,
          countDate: body.countDate,
          notes: body.notes ?? null,
          lines: body.lines,
          actorId: req.user!.id,
        })
      );
      res.status(201).json(st);
    })
  );

  app.post(
    "/api/companies/:companyId/stocktakes/:stocktakeId/post",
    authMiddleware,
    requireCustomer,
    strictBody(z.object({})),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId, stocktakeId } = req.params;
      await assertAccess(req, companyId);
      await assertCompanyPermission(actorFromRequest(req), companyId, ["ledger.post"]);
      const st = await pool.query(
        `SELECT count_date FROM stocktakes WHERE id = $1 AND company_id = $2`,
        [stocktakeId, companyId]
      );
      if (!st.rows[0]) throw new DomainError("STOCKTAKE_NOT_FOUND", 404);
      await assertPeriodNotLocked(companyId, st.rows[0].count_date);
      const out = await withLedgerTx((tx) =>
        postStocktake(tx, { companyId, stocktakeId, actorId: req.user!.id })
      );
      res.json(out);
    })
  );

  // =====================================
  // Reports (R10-15)
  // =====================================

  app.get(
    "/api/companies/:companyId/inventory/valuation",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      await assertAccess(req, req.params.companyId);
      res.json(await inventoryValuation(req.params.companyId));
    })
  );

  app.get(
    "/api/companies/:companyId/inventory/ageing",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      await assertAccess(req, req.params.companyId);
      const asOf =
        typeof req.query.asOf === "string" && /^\d{4}-\d{2}-\d{2}$/.test(req.query.asOf)
          ? req.query.asOf
          : undefined;
      res.json(await inventoryAgeing(req.params.companyId, asOf));
    })
  );

  app.get(
    "/api/companies/:companyId/inventory/movement-report",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      await assertAccess(req, req.params.companyId);
      const iso = /^\d{4}-\d{2}-\d{2}$/;
      const from = String(req.query.from ?? "");
      const to = String(req.query.to ?? "");
      if (!iso.test(from) || !iso.test(to) || from > to) {
        throw new DomainError(
          "INVALID_REPORT_DATE",
          400,
          undefined,
          "from and to (YYYY-MM-DD) are required"
        );
      }
      res.json(await inventoryMovementReport(req.params.companyId, from, to));
    })
  );

  app.get(
    "/api/companies/:companyId/inventory/reorder",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      await assertAccess(req, req.params.companyId);
      res.json(await reorderList(req.params.companyId));
    })
  );
}
