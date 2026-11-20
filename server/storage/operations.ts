// DatabaseStorage part: Cost centers, purchase orders, products and inventory movements.
// Domain classes are chained with `extends` and composed into DatabaseStorage in
// server/storage.ts (R20-09); import `storage` from "./storage", not these classes.

import {
  costCenters,
  inventoryMovements,
  products,
  purchaseOrderLines,
  purchaseOrders,
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
import { desc, eq } from "drizzle-orm";
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
    await db.delete(products).where(eq(products.id, id));
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
