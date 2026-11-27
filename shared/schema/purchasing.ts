// Purchase orders, goods receipts, vendors and approval rules.
// Part of the shared/schema.ts barrel (R20-09); import from "@shared/schema".

import {
  boolean,
  index,
  integer,
  numeric,
  pgTable,
  real,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import type { z } from "zod";
import { sql } from "drizzle-orm";
import { createInsertSchema, money, vatRateType } from "./columns";
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
// WQ2 (8.8): vendor bills, bill lines and bill payments. These tables were created by raw SQL
// migrations (0010, 0032, 0036, 0069, 0072, 0096, 0111, 0121); the definitions below describe the
// existing columns exactly (no column change; tests/db/wq2-purchases.test.ts compares them with
// information_schema). Writes still go through server/services/bill-payment.service.ts and
// bill-posting.service.ts, settlement through server/reporting/settlement.ts.
// ===========================
const amount12 = (name: string) => numeric(name, { precision: 12, scale: 2 });
const amount15 = (name: string) => numeric(name, { precision: 15, scale: 2 });
const retentionFiveYears = sql`(created_at + '5 years'::interval)`;

export const vendorBills = pgTable(
  "vendor_bills",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    vendorName: text("vendor_name").notNull(),
    vendorTrn: text("vendor_trn"),
    billNumber: text("bill_number"),
    billDate: timestamp("bill_date").notNull(),
    dueDate: timestamp("due_date"),
    currency: text("currency").default("AED"),
    subtotal: amount12("subtotal").default("0"),
    vatAmount: amount12("vat_amount").default("0"),
    totalAmount: amount12("total_amount").default("0"),
    amountPaid: amount12("amount_paid").default("0"),
    // draft | pending | approved | partial | paid | rejected | void (billMachine)
    status: text("status").default("pending"),
    category: text("category"),
    notes: text("notes"),
    attachmentUrl: text("attachment_url"),
    approvedBy: uuid("approved_by"),
    approvedAt: timestamp("approved_at"),
    paidAt: timestamp("paid_at"),
    createdAt: timestamp("created_at").defaultNow(),
    reverseCharge: boolean("reverse_charge").notNull().default(false),
    retentionExpiresAt: timestamp("retention_expires_at").generatedAlwaysAs(retentionFiveYears),
    exchangeRate: numeric("exchange_rate", { precision: 12, scale: 6 }).notNull().default("1"),
    vendorId: uuid("vendor_id").references(() => vendors.id, { onDelete: "set null" }),
    createdBy: uuid("created_by"),
    revision: integer("revision").notNull().default(0),
    placeOfSupply: text("place_of_supply"),
    isImport: boolean("is_import").notNull().default(false),
    customsDeclarationNo: text("customs_declaration_no"),
    importVatAmount: amount15("import_vat_amount").notNull().default("0"),
    designatedZone: boolean("designated_zone").notNull().default(false),
    recoverableVatPercent: numeric("recoverable_vat_percent", { precision: 5, scale: 2 })
      .notNull()
      .default("100"),
    withholdingAmount: amount15("withholding_amount").notNull().default("0"),
    purchaseOrderId: uuid("purchase_order_id").references(() => purchaseOrders.id, {
      onDelete: "set null",
    }),
    origin: text("origin").notNull().default("manual"),
    originRef: text("origin_ref"),
    attachmentPath: text("attachment_path"),
    attachmentName: text("attachment_name"),
    rejectedBy: uuid("rejected_by"),
    rejectedAt: timestamp("rejected_at"),
    voidedBy: uuid("voided_by"),
    voidedAt: timestamp("voided_at"),
    statusReason: text("status_reason"),
    recoverableVatBase: amount15("recoverable_vat_base"),
    customsValue: amount15("customs_value"),
    customsDutyAmount: amount15("customs_duty_amount"),
    inputVatAttribution: text("input_vat_attribution"),
  },
  (table) => ({
    companyIdx: index("idx_vendor_bills_company_id").on(table.companyId),
    dueDateIdx: index("idx_vendor_bills_due_date").on(table.dueDate),
    statusIdx: index("idx_vendor_bills_status").on(table.status),
    vendorIdx: index("idx_vendor_bills_vendor_id").on(table.vendorId),
  })
);
export type VendorBillRow = typeof vendorBills.$inferSelect;

export const billLineItems = pgTable(
  "bill_line_items",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    billId: uuid("bill_id")
      .notNull()
      .references(() => vendorBills.id, { onDelete: "cascade" }),
    description: text("description").notNull(),
    quantity: numeric("quantity", { precision: 16, scale: 4 }).default("1"),
    unitPrice: amount12("unit_price").notNull(),
    vatRate: numeric("vat_rate", { precision: 5, scale: 2 }).default("5"),
    amount: amount12("amount"),
    accountId: uuid("account_id").references(() => accounts.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").defaultNow(),
    reverseCharge: boolean("reverse_charge").notNull().default(false),
    vatSupplyType: text("vat_supply_type").notNull().default("standard_rated"),
    vatAmount: amount15("vat_amount").notNull().default("0"),
    productId: uuid("product_id"),
    purchaseOrderLineId: uuid("purchase_order_line_id").references(() => purchaseOrderLines.id, {
      onDelete: "set null",
    }),
    costCenterId: uuid("cost_center_id"),
  },
  (table) => ({
    billIdx: index("idx_bill_line_items_bill_id").on(table.billId),
  })
);
export type BillLineItemRow = typeof billLineItems.$inferSelect;

export const billPayments = pgTable(
  "bill_payments",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    billId: uuid("bill_id")
      .notNull()
      .references(() => vendorBills.id, { onDelete: "cascade" }),
    paymentDate: timestamp("payment_date").notNull(),
    amount: amount12("amount").notNull(),
    paymentMethod: text("payment_method").default("bank_transfer"),
    reference: text("reference"),
    notes: text("notes"),
    createdAt: timestamp("created_at").defaultNow(),
    retentionExpiresAt: timestamp("retention_expires_at").generatedAlwaysAs(retentionFiveYears),
    // payment | prepayment | vendor_credit | reversal (one settlement rule: reporting/settlement.ts)
    kind: text("kind").notNull().default("payment"),
    status: text("status").notNull().default("active"),
    paymentAccountId: uuid("payment_account_id").references(() => accounts.id, {
      onDelete: "set null",
    }),
    exchangeRate: numeric("exchange_rate", { precision: 12, scale: 6 }),
    apAmountBase: amount15("ap_amount_base"),
    cashAmountBase: amount15("cash_amount_base"),
    fxDifference: amount15("fx_difference").notNull().default("0"),
    sourceDocumentId: uuid("source_document_id"),
    reversesPaymentId: uuid("reverses_payment_id"),
    createdBy: uuid("created_by"),
    voidedAt: timestamp("voided_at"),
    voidedBy: uuid("voided_by"),
  },
  (table) => ({
    billIdx: index("idx_bill_payments_bill_id").on(table.billId),
  })
);
export type BillPaymentRow = typeof billPayments.$inferSelect;

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
