// Purchase orders, goods receipts, vendors and approval rules.
// Part of the shared/schema.ts barrel (R20-09); import from "@shared/schema".

import {
  boolean,
  index,
  integer,
  pgTable,
  real,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import type { z } from "zod";
import { sql } from "drizzle-orm";
import { money, vatRateType } from "./columns";
import { companies } from "./companies";
import { accounts } from "./ledger";

// ===========================
// Purchase Orders
// ===========================
export const purchaseOrders = pgTable(
  "purchase_orders",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    number: text("number").notNull(),
    vendorName: text("vendor_name").notNull(),
    vendorTrn: text("vendor_trn"),
    date: timestamp("date").notNull(),
    expectedDeliveryDate: timestamp("expected_delivery_date"),
    currency: text("currency").notNull().default("AED"),
    subtotal: money("subtotal").notNull().default(0),
    vatAmount: money("vat_amount").notNull().default(0),
    total: money("total").notNull().default(0),
    // draft | sent | approved | partially_received | received | cancelled (W3-B: never set by PUT)
    status: text("status").notNull().default("draft"),
    notes: text("notes"),
    // W3-B (0096): vendor master link, maker-checker, delivery and cancellation stamps.
    vendorId: uuid("vendor_id").references(() => vendors.id, { onDelete: "set null" }),
    createdBy: uuid("created_by"),
    approvedBy: uuid("approved_by"),
    approvedAt: timestamp("approved_at"),
    sentAt: timestamp("sent_at"),
    sentTo: text("sent_to"),
    cancelledAt: timestamp("cancelled_at"),
    cancelReason: text("cancel_reason"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    companyNumberUnique: unique("purchase_orders_company_number_unique").on(
      table.companyId,
      table.number
    ),
    companyIdIdx: index("idx_purchase_orders_company_id").on(table.companyId),
    companyStatusIdx: index("idx_purchase_orders_company_status").on(table.companyId, table.status),
  })
);

export const insertPurchaseOrderSchema = createInsertSchema(purchaseOrders).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertPurchaseOrder = z.infer<typeof insertPurchaseOrderSchema>;
export type PurchaseOrder = typeof purchaseOrders.$inferSelect;

export const purchaseOrderLines = pgTable(
  "purchase_order_lines",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    purchaseOrderId: uuid("purchase_order_id")
      .notNull()
      .references(() => purchaseOrders.id, { onDelete: "cascade" }),
    description: text("description").notNull(),
    quantity: real("quantity").notNull(),
    unitPrice: money("unit_price").notNull(),
    vatRate: vatRateType("vat_rate").notNull().default(0.05),
    vatSupplyType: text("vat_supply_type").default("standard_rated"),
    // W3-B (0096): inventory link, expense account, and 3-way match quantities.
    productId: uuid("product_id"),
    accountId: uuid("account_id").references(() => accounts.id, { onDelete: "set null" }),
    quantityReceived: real("quantity_received").notNull().default(0),
    quantityBilled: real("quantity_billed").notNull().default(0),
  },
  (table) => ({
    purchaseOrderIdIdx: index("idx_purchase_order_lines_po_id").on(table.purchaseOrderId),
  })
);

export const insertPurchaseOrderLineSchema = createInsertSchema(purchaseOrderLines).omit({
  id: true,
});

export type InsertPurchaseOrderLine = z.infer<typeof insertPurchaseOrderLineSchema>;
export type PurchaseOrderLine = typeof purchaseOrderLines.$inferSelect;

// ===========================
// W3-B (0096): goods receipts against purchase orders (partial receipts / 3-way match)
// ===========================
export const purchaseOrderReceipts = pgTable(
  "purchase_order_receipts",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    purchaseOrderId: uuid("purchase_order_id")
      .notNull()
      .references(() => purchaseOrders.id, { onDelete: "cascade" }),
    receivedDate: timestamp("received_date").notNull(),
    notes: text("notes"),
    createdBy: uuid("created_by"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    poIdx: index("idx_po_receipts_po").on(table.purchaseOrderId),
  })
);
export type PurchaseOrderReceipt = typeof purchaseOrderReceipts.$inferSelect;

export const purchaseOrderReceiptLines = pgTable(
  "purchase_order_receipt_lines",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    receiptId: uuid("receipt_id")
      .notNull()
      .references(() => purchaseOrderReceipts.id, { onDelete: "cascade" }),
    purchaseOrderLineId: uuid("purchase_order_line_id")
      .notNull()
      .references(() => purchaseOrderLines.id, { onDelete: "cascade" }),
    quantity: real("quantity").notNull(),
  },
  (table) => ({
    receiptIdx: index("idx_po_receipt_lines_receipt").on(table.receiptId),
  })
);
export type PurchaseOrderReceiptLine = typeof purchaseOrderReceiptLines.$inferSelect;

// ===========================
// W3-B (0096): vendor master (R04-16). Unique per company by TRN and by lower(name)
// (expression/partial indexes live in the migration).
// ===========================
export const vendors = pgTable(
  "vendors",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    nameAr: text("name_ar"),
    trn: text("trn"),
    email: text("email"),
    phone: text("phone"),
    address: text("address"),
    emirate: text("emirate"),
    country: text("country").notNull().default("AE"),
    paymentTermsDays: integer("payment_terms_days").notNull().default(30),
    currency: text("currency").notNull().default("AED"),
    defaultExpenseAccountId: uuid("default_expense_account_id").references(() => accounts.id, {
      onDelete: "set null",
    }),
    iban: text("iban"),
    bankName: text("bank_name"),
    isActive: boolean("is_active").notNull().default(true),
    notes: text("notes"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    companyIdx: index("idx_vendors_company_id").on(table.companyId),
  })
);
export type Vendor = typeof vendors.$inferSelect;
export type InsertVendor = typeof vendors.$inferInsert;

// ===========================
// W3-B (0096): approval rules (R04-19) — by document type, amount band, permission/role, step.
// ===========================
export const approvalRules = pgTable(
  "approval_rules",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    documentType: text("document_type").notNull(),
    minAmount: money("min_amount").notNull().default(0),
    maxAmount: money("max_amount"),
    stepOrder: integer("step_order").notNull().default(1),
    requiredPermission: text("required_permission").notNull().default("documents.approve"),
    requiredRole: text("required_role"),
    isActive: boolean("is_active").notNull().default(true),
    createdBy: uuid("created_by"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    companyDocIdx: index("idx_approval_rules_company_doc").on(table.companyId, table.documentType),
  })
);
export type ApprovalRule = typeof approvalRules.$inferSelect;

export const approvalDecisions = pgTable(
  "approval_decisions",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    documentType: text("document_type").notNull(),
    documentId: uuid("document_id").notNull(),
    ruleId: uuid("rule_id").references(() => approvalRules.id, { onDelete: "set null" }),
    stepOrder: integer("step_order").notNull().default(1),
    decision: text("decision").notNull().default("approved"),
    decidedBy: uuid("decided_by").notNull(),
    comment: text("comment"),
    decidedAt: timestamp("decided_at").defaultNow().notNull(),
  },
  (table) => ({
    documentIdx: index("idx_approval_decisions_document").on(
      table.companyId,
      table.documentType,
      table.documentId
    ),
  })
);
export type ApprovalDecision = typeof approvalDecisions.$inferSelect;

export const approvalSettings = pgTable("approval_settings", {
  companyId: uuid("company_id")
    .primaryKey()
    .references(() => companies.id, { onDelete: "cascade" }),
  allowSingleMemberSelfApproval: boolean("allow_single_member_self_approval")
    .notNull()
    .default(true),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
export type ApprovalSettings = typeof approvalSettings.$inferSelect;
