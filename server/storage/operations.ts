// DatabaseStorage part: Cost centers, purchase orders, products and inventory movements.
// Domain classes are chained with `extends` and composed into DatabaseStorage in
// server/storage.ts (R20-09); import `storage` from "./storage", not these classes.

import {
  costCenters,
  inventoryMovements,
  products,
  purchaseOrderLines,
  purchaseOrders,
  stocktakeLines,
  stocktakes,
  type CostCenter,
  type InsertCostCenter,
  type InsertProduct,
  type InsertPurchaseOrder,
  type InsertPurchaseOrderLine,
  type InventoryMovement,
  type Product,
  type PurchaseOrder,
  type PurchaseOrderLine,
} from "@shared/schema";
import { db } from "../db";
import { and, desc, eq } from "drizzle-orm";
import { DomainError } from "../errors";
import { BankingStorage } from "./banking";

export class OperationsStorage extends BankingStorage {
  // Cost centers
  async getCostCentersByCompanyId(companyId: string): Promise<CostCenter[]> {
    return await db
      .select()
      .from(costCenters)
      .where(eq(costCenters.companyId, companyId))
      .orderBy(costCenters.code);
  }

  async getCostCenter(id: string): Promise<CostCenter | undefined> {
    const [center] = await db.select().from(costCenters).where(eq(costCenters.id, id)).limit(1);
    return center;
  }

  async createCostCenter(data: InsertCostCenter): Promise<CostCenter> {
    const [center] = await db.insert(costCenters).values(data).returning();
    return center;
  }

  async updateCostCenter(
    id: string,
    data: Partial<InsertCostCenter>
  ): Promise<CostCenter | undefined> {
    const [center] = await db
      .update(costCenters)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(costCenters.id, id))
      .returning();
    return center;
  }

  async deleteCostCenter(id: string): Promise<void> {
    await db.delete(costCenters).where(eq(costCenters.id, id));
  }

  // Purchase orders
  async getPurchaseOrdersByCompanyId(companyId: string): Promise<PurchaseOrder[]> {
    return await db
      .select()
      .from(purchaseOrders)
      .where(eq(purchaseOrders.companyId, companyId))
      .orderBy(desc(purchaseOrders.createdAt));
  }

  async getPurchaseOrder(id: string): Promise<PurchaseOrder | undefined> {
    const [po] = await db.select().from(purchaseOrders).where(eq(purchaseOrders.id, id)).limit(1);
    return po;
  }

  async createPurchaseOrder(data: InsertPurchaseOrder): Promise<PurchaseOrder> {
    const [po] = await db.insert(purchaseOrders).values(data).returning();
    return po;
  }

  async updatePurchaseOrder(
    id: string,
    data: Partial<InsertPurchaseOrder>
  ): Promise<PurchaseOrder | undefined> {
    const [po] = await db
      .update(purchaseOrders)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(purchaseOrders.id, id))
      .returning();
    return po;
  }

  async deletePurchaseOrder(id: string): Promise<void> {
    await db.delete(purchaseOrders).where(eq(purchaseOrders.id, id));
  }

  async getPurchaseOrderLinesByPurchaseOrderId(
    purchaseOrderId: string
  ): Promise<PurchaseOrderLine[]> {
    return await db
      .select()
      .from(purchaseOrderLines)
      .where(eq(purchaseOrderLines.purchaseOrderId, purchaseOrderId));
  }

  async createPurchaseOrderLine(data: InsertPurchaseOrderLine): Promise<PurchaseOrderLine> {
    const [line] = await db.insert(purchaseOrderLines).values(data).returning();
    return line;
  }

  async deletePurchaseOrderLinesByPurchaseOrderId(purchaseOrderId: string): Promise<void> {
    await db
      .delete(purchaseOrderLines)
      .where(eq(purchaseOrderLines.purchaseOrderId, purchaseOrderId));
  }

  // Products / Inventory
  async getProductsByCompanyId(companyId: string): Promise<Product[]> {
    return await db
      .select()
      .from(products)
      .where(eq(products.companyId, companyId))
      .orderBy(desc(products.createdAt));
  }

  async getProduct(id: string): Promise<Product | undefined> {
    const [product] = await db.select().from(products).where(eq(products.id, id));
    return product || undefined;
  }

  async createProduct(data: InsertProduct): Promise<Product> {
    const [product] = await db.insert(products).values(data).returning();
    return product;
  }

  async updateProduct(id: string, data: Partial<Product>): Promise<Product> {
    const [product] = await db.update(products).set(data).where(eq(products.id, id)).returning();
    if (!product) {
      throw new Error("Product not found");
    }
    return product;
  }

  async deleteProduct(id: string): Promise<void> {
    await db.transaction(async (tx) => {
      // Lock the product first so a concurrent postStocktake (which locks every line's product)
      // serializes with this delete. stocktake_lines.product_id cascades, so a posted stocktake
      // line (including a zero-variance one with no stock movement) must block the delete.
      const [product] = await tx
        .select({ id: products.id, companyId: products.companyId })
        .from(products)
        .where(eq(products.id, id))
        .for("update");
      if (!product) return;
      const [posted] = await tx
        .select({ id: stocktakeLines.id })
        .from(stocktakeLines)
        .innerJoin(stocktakes, eq(stocktakes.id, stocktakeLines.stocktakeId))
        .where(
          and(
            eq(stocktakeLines.productId, product.id),
            eq(stocktakes.companyId, product.companyId),
            eq(stocktakes.status, "posted")
          )
        )
        .limit(1);
      if (posted) {
        throw new DomainError(
          "PRODUCT_HAS_POSTED_STOCKTAKE",
          409,
          { productId: product.id },
          "This product is on a posted stocktake. Deactivate it instead of deleting it."
        );
      }
      await tx.delete(products).where(eq(products.id, product.id));
    });
  }

  // Inventory Movements
  async getInventoryMovementsByProductId(productId: string): Promise<InventoryMovement[]> {
    return await db
      .select()
      .from(inventoryMovements)
      .where(eq(inventoryMovements.productId, productId))
      .orderBy(desc(inventoryMovements.createdAt));
  }

  async getInventoryMovementsByCompanyId(companyId: string): Promise<InventoryMovement[]> {
    return await db
      .select()
      .from(inventoryMovements)
      .where(eq(inventoryMovements.companyId, companyId))
      .orderBy(desc(inventoryMovements.createdAt));
  }
}
