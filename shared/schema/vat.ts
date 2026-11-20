// VAT returns, VAT periods, firm VAT workpapers and VAT engine tables (W4-E).
// Part of the shared/schema.ts barrel (R20-09); import from "@shared/schema".

import {
  boolean,
  index,
  jsonb,
  date as pgDate,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type { z } from "zod";
import { sql } from "drizzle-orm";
import { createInsertSchema, money, rate } from "./columns";
import { users } from "./users";
import { companies } from "./companies";
import { journalEntries } from "./ledger";
import { invoices } from "./sales";
import { receipts } from "./receipts";

// ===========================
// VAT Returns (for FTA VAT 201 compliance)
// Matches official FTA VAT 201 Return format
// ===========================
export const vatReturns = pgTable(
  "vat_returns",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),

    // Period information
    periodStart: timestamp("period_start").notNull(),
    periodEnd: timestamp("period_end").notNull(),
    dueDate: timestamp("due_date").notNull(),
    taxYearEnd: timestamp("tax_year_end"),
    vatStagger: text("vat_stagger").default("quarterly"), // quarterly | monthly
    status: text("status").notNull().default("draft"), // draft | pending_review | submitted | filed | amended

    // ===== VAT ON SALES AND ALL OTHER OUTPUTS =====
    // Box 1a-1g: Standard Rated Supplies by Emirate (Amount, VAT, Adjustment)
    box1aAbuDhabiAmount: money("box1a_abu_dhabi_amount").notNull().default(0),
    box1aAbuDhabiVat: money("box1a_abu_dhabi_vat").notNull().default(0),
    box1aAbuDhabiAdj: money("box1a_abu_dhabi_adj").notNull().default(0),

    box1bDubaiAmount: money("box1b_dubai_amount").notNull().default(0),
    box1bDubaiVat: money("box1b_dubai_vat").notNull().default(0),
    box1bDubaiAdj: money("box1b_dubai_adj").notNull().default(0),

    box1cSharjahAmount: money("box1c_sharjah_amount").notNull().default(0),
    box1cSharjahVat: money("box1c_sharjah_vat").notNull().default(0),
    box1cSharjahAdj: money("box1c_sharjah_adj").notNull().default(0),

    box1dAjmanAmount: money("box1d_ajman_amount").notNull().default(0),
    box1dAjmanVat: money("box1d_ajman_vat").notNull().default(0),
    box1dAjmanAdj: money("box1d_ajman_adj").notNull().default(0),

    box1eUmmAlQuwainAmount: money("box1e_umm_al_quwain_amount").notNull().default(0),
    box1eUmmAlQuwainVat: money("box1e_umm_al_quwain_vat").notNull().default(0),
    box1eUmmAlQuwainAdj: money("box1e_umm_al_quwain_adj").notNull().default(0),

    box1fRasAlKhaimahAmount: money("box1f_ras_al_khaimah_amount").notNull().default(0),
    box1fRasAlKhaimahVat: money("box1f_ras_al_khaimah_vat").notNull().default(0),
    box1fRasAlKhaimahAdj: money("box1f_ras_al_khaimah_adj").notNull().default(0),

    box1gFujairahAmount: money("box1g_fujairah_amount").notNull().default(0),
    box1gFujairahVat: money("box1g_fujairah_vat").notNull().default(0),
    box1gFujairahAdj: money("box1g_fujairah_adj").notNull().default(0),

    // Box 2: Tax Refunds to Tourists
    box2TouristRefundAmount: money("box2_tourist_refund_amount").notNull().default(0),
    box2TouristRefundVat: money("box2_tourist_refund_vat").notNull().default(0),

    // Box 3: Supplies subject to reverse charge
    box3ReverseChargeAmount: money("box3_reverse_charge_amount").notNull().default(0),
    box3ReverseChargeVat: money("box3_reverse_charge_vat").notNull().default(0),

    // Box 4: Zero Rated Supplies
    box4ZeroRatedAmount: money("box4_zero_rated_amount").notNull().default(0),

    // Box 5: Exempt Supplies
    box5ExemptAmount: money("box5_exempt_amount").notNull().default(0),

    // Box 6: Goods imported into UAE
    box6ImportsAmount: money("box6_imports_amount").notNull().default(0),
    box6ImportsVat: money("box6_imports_vat").notNull().default(0),

    // Box 7: Adjustments to goods imported
    box7ImportsAdjAmount: money("box7_imports_adj_amount").notNull().default(0),
    box7ImportsAdjVat: money("box7_imports_adj_vat").notNull().default(0),

    // Box 8: Totals for Output VAT
    box8TotalAmount: money("box8_total_amount").notNull().default(0),
    box8TotalVat: money("box8_total_vat").notNull().default(0),
    box8TotalAdj: money("box8_total_adj").notNull().default(0),

    // ===== VAT ON EXPENSES AND ALL OTHER INPUTS =====
    // Box 9: Standard Rated Expenses
    box9ExpensesAmount: money("box9_expenses_amount").notNull().default(0),
    box9ExpensesVat: money("box9_expenses_vat").notNull().default(0),
    box9ExpensesAdj: money("box9_expenses_adj").notNull().default(0),

    // Box 10: Supplies subject to reverse charge (input)
    box10ReverseChargeAmount: money("box10_reverse_charge_amount").notNull().default(0),
    box10ReverseChargeVat: money("box10_reverse_charge_vat").notNull().default(0),

    // Box 11: Totals for Input VAT
    box11TotalAmount: money("box11_total_amount").notNull().default(0),
    box11TotalVat: money("box11_total_vat").notNull().default(0),
    box11TotalAdj: money("box11_total_adj").notNull().default(0),

    // ===== NET VAT DUE =====
    // Box 12: Total value of due tax for the period
    box12TotalDueTax: money("box12_total_due_tax").notNull().default(0),

    // Box 13: Total value of recoverable tax for the period
    box13RecoverableTax: money("box13_recoverable_tax").notNull().default(0),

    // Box 14: Payable tax for the period (Box 12 - Box 13)
    box14PayableTax: money("box14_payable_tax").notNull().default(0),

    // Legacy fields for backward compatibility
    box1SalesStandard: money("box1_sales_standard").notNull().default(0),
    box2SalesOtherEmirates: money("box2_sales_other_emirates").notNull().default(0),
    box3SalesTaxExempt: money("box3_sales_tax_exempt").notNull().default(0),
    box4SalesExempt: money("box4_sales_exempt").notNull().default(0),
    box5TotalOutputTax: money("box5_total_output_tax").notNull().default(0),
    box6ExpensesStandard: money("box6_expenses_standard").notNull().default(0),
    box7ExpensesTouristRefund: money("box7_expenses_tourist_refund").notNull().default(0),
    box8TotalInputTax: money("box8_total_input_tax").notNull().default(0),
    box9NetTax: money("box9_net_tax").notNull().default(0),
    adjustmentAmount: money("adjustment_amount").default(0),
    adjustmentReason: text("adjustment_reason"),

    // Filing info
    submittedBy: uuid("submitted_by").references(() => users.id),
    submittedAt: timestamp("submitted_at"),
    ftaReferenceNumber: text("fta_reference_number"),
    paymentStatus: text("payment_status").default("unpaid"), // unpaid | paid | partial
    paymentAmount: money("payment_amount"),
    paymentDate: timestamp("payment_date"),
    notes: text("notes"),

    // Declaration
    declarantName: text("declarant_name"),
    declarantPosition: text("declarant_position"),
    declarationDate: timestamp("declaration_date"),

    // W4-E (migration 0104): amended returns, VAT-to-GL reconciliation, readiness gate.
    amendsReturnId: uuid("amends_return_id"),
    amendmentDiff: jsonb("amendment_diff"),
    reconciliationSnapshot: jsonb("reconciliation_snapshot"),
    reconciliationOverrideReason: text("reconciliation_override_reason"),
    reconciliationOverrideBy: uuid("reconciliation_override_by"),
    reconciliationOverrideAt: timestamp("reconciliation_override_at"),
    readyBy: uuid("ready_by"),
    readyAt: timestamp("ready_at"),
    engineVersion: text("engine_version"),
    vatGroupId: uuid("vat_group_id"),
    partialExemptionRatio: rate("partial_exemption_ratio"),

    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    companyIdIdx: index("idx_vat_returns_company_id").on(table.companyId),
    companyPeriodIdx: index("idx_vat_returns_company_period").on(
      table.companyId,
      table.periodStart
    ),
  })
);

export const insertVatReturnSchema = createInsertSchema(vatReturns).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertVatReturn = z.infer<typeof insertVatReturnSchema>;
export type VatReturn = typeof vatReturns.$inferSelect;

// ===========================
// VAT Return Periods (Phase 3: VAT Autopilot)
// Tracks each filing window per company so deadlines, calculation snapshots,
// and adjustments can be reasoned about independently of the immutable
// `vat_returns` row. A period progresses through draft → ready → submitted →
// accepted; an `adjustments` JSONB column carries an audit-trailed list of
// manual overrides applied on top of the auto-calculated boxes.
// ===========================
export const vatReturnPeriods = pgTable(
  "vat_return_periods",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    periodStart: timestamp("period_start").notNull(),
    periodEnd: timestamp("period_end").notNull(),
    dueDate: timestamp("due_date").notNull(),
    frequency: text("frequency").notNull().default("quarterly"), // quarterly | monthly
    status: text("status").notNull().default("draft"), // draft | ready | submitted | accepted
    // Snapshot of the most recent auto-calculation. Stored so the UI can show
    // last-calculated totals without re-running the full aggregation.
    outputVat: money("output_vat").notNull().default(0),
    inputVat: money("input_vat").notNull().default(0),
    netVatPayable: money("net_vat_payable").notNull().default(0),
    calculatedAt: timestamp("calculated_at"),
    // adjustments: array of { id, box, amount, reason, userId, createdAt } items.
    // Applied additively to the auto-calculated baseline.
    adjustments: jsonb("adjustments")
      .notNull()
      .default(sql`'[]'::jsonb`),
    // Link to the formal vat_returns row once one has been generated/submitted.
    vatReturnId: uuid("vat_return_id").references(() => vatReturns.id),
    submittedAt: timestamp("submitted_at"),
    submittedBy: uuid("submitted_by").references(() => users.id),
    ftaReferenceNumber: text("fta_reference_number"),
    notes: text("notes"),
    // W4-E (migration 0104)
    reconciliationSnapshot: jsonb("reconciliation_snapshot"),
    reconciliationOverrideReason: text("reconciliation_override_reason"),
    reconciliationOverrideBy: uuid("reconciliation_override_by"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    companyPeriodUnique: unique("vat_return_periods_company_period_unique").on(
      table.companyId,
      table.periodStart,
      table.periodEnd
    ),
    companyIdIdx: index("idx_vat_return_periods_company_id").on(table.companyId),
    dueDateIdx: index("idx_vat_return_periods_due_date").on(table.dueDate),
    statusIdx: index("idx_vat_return_periods_status").on(table.status),
  })
);

export const insertVatReturnPeriodSchema = createInsertSchema(vatReturnPeriods).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertVatReturnPeriod = z.infer<typeof insertVatReturnPeriodSchema>;
export type VatReturnPeriod = typeof vatReturnPeriods.$inferSelect;

export interface VatReturnAdjustment {
  id: string;
  box: string; // e.g. "box1bDubaiVat", "box9ExpensesVat"
  amount: number; // positive or negative AED delta
  reason: string;
  userId: string;
  createdAt: string; // ISO timestamp
}

// ===========================
// Firm VAT Submission Workspace
// ===========================
// Bookkeeper-owned VAT workpapers. Rows are VAT evidence only; they do not post
// accounting invoices, receipts, bills, or journals.
export const vatWorkpapers = pgTable(
  "vat_workpapers",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    periodStart: timestamp("period_start").notNull(),
    periodEnd: timestamp("period_end").notNull(),
    dueDate: timestamp("due_date").notNull(),
    status: text("status").notNull().default("draft"), // draft | prepared | reviewed | filed | locked (W4-E)
    reviewerUserId: uuid("reviewer_user_id").references(() => users.id, { onDelete: "set null" }),
    // W4-E (migration 0104): maker-checker trail.
    preparedBy: uuid("prepared_by"),
    preparedAt: timestamp("prepared_at"),
    reviewedBy: uuid("reviewed_by"),
    reviewedAt: timestamp("reviewed_at"),
    filedBy: uuid("filed_by"),
    filedAt: timestamp("filed_at"),
    lockedBy: uuid("locked_by"),
    lockedAt: timestamp("locked_at"),
    returnGeneratedAt: timestamp("return_generated_at"),
    generatedVatReturnId: uuid("generated_vat_return_id").references(() => vatReturns.id, {
      onDelete: "set null",
    }),
    totalsSnapshot: jsonb("totals_snapshot")
      .notNull()
      .default(sql`'{}'::jsonb`),
    notes: text("notes"),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    companyPeriodUnique: unique("vat_workpapers_company_period_unique").on(
      table.companyId,
      table.periodStart,
      table.periodEnd
    ),
    companyIdIdx: index("idx_vat_workpapers_company_id").on(table.companyId),
    statusIdx: index("idx_vat_workpapers_status").on(table.status),
    dueDateIdx: index("idx_vat_workpapers_due_date").on(table.dueDate),
  })
);

export const vatWorkpaperRows = pgTable(
  "vat_workpaper_rows",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    workpaperId: uuid("workpaper_id")
      .notNull()
      .references(() => vatWorkpapers.id, { onDelete: "cascade" }),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    rowCategory: text("row_category").notNull(), // standard_sale | tourist_refund | reverse_charge_output | zero_rated_sale | exempt_sale | import | import_adjustment | standard_expense | reverse_charge_input | manual_adjustment
    vat201Box: text("vat201_box").notNull(),
    invoiceNumber: text("invoice_number"),
    documentDate: timestamp("document_date"),
    counterpartyName: text("counterparty_name"),
    counterpartyTrn: text("counterparty_trn"),
    emirate: text("emirate"),
    taxableAmount: money("taxable_amount").notNull().default(0),
    vatAmount: money("vat_amount").notNull().default(0),
    adjustmentAmount: money("adjustment_amount").notNull().default(0),
    grossAmount: money("gross_amount").notNull().default(0),
    status: text("status").notNull().default("draft"), // draft | approved | excluded
    sourceMethod: text("source_method").notNull().default("manual"), // manual | ocr | import | generated
    sourceDocumentType: text("source_document_type"),
    sourceDocumentId: uuid("source_document_id"),
    notes: text("notes"),
    auditReason: text("audit_reason"),
    // W4-E: reason required when VAT is not 5% / 0% of the taxable amount.
    vatOverrideReason: text("vat_override_reason"),
    reviewedBy: uuid("reviewed_by").references(() => users.id, { onDelete: "set null" }),
    reviewedAt: timestamp("reviewed_at"),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    // Set when a manual row has been posted to the general ledger so it shows up
    // across the books (journal, P&L, balance sheet). Null = not posted.
    journalEntryId: uuid("journal_entry_id").references(() => journalEntries.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    workpaperIdIdx: index("idx_vat_workpaper_rows_workpaper_id").on(table.workpaperId),
    companyIdIdx: index("idx_vat_workpaper_rows_company_id").on(table.companyId),
    statusIdx: index("idx_vat_workpaper_rows_status").on(table.status),
    categoryIdx: index("idx_vat_workpaper_rows_category").on(table.rowCategory),
  })
);

export const vatWorkpaperAttachments = pgTable(
  "vat_workpaper_attachments",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    workpaperId: uuid("workpaper_id")
      .notNull()
      .references(() => vatWorkpapers.id, { onDelete: "cascade" }),
    rowId: uuid("row_id").references(() => vatWorkpaperRows.id, { onDelete: "cascade" }),
    fileName: text("file_name").notNull(),
    mimeType: text("mime_type").notNull(),
    filePath: text("file_path"),
    extractedText: text("extracted_text"),
    extractionJson: jsonb("extraction_json")
      .notNull()
      .default(sql`'{}'::jsonb`),
    uploadedBy: uuid("uploaded_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    workpaperIdIdx: index("idx_vat_workpaper_attachments_workpaper_id").on(table.workpaperId),
    rowIdIdx: index("idx_vat_workpaper_attachments_row_id").on(table.rowId),
  })
);

export const insertVatWorkpaperSchema = createInsertSchema(vatWorkpapers).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export const insertVatWorkpaperRowSchema = createInsertSchema(vatWorkpaperRows).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export const insertVatWorkpaperAttachmentSchema = createInsertSchema(vatWorkpaperAttachments).omit({
  id: true,
  createdAt: true,
});

export type InsertVatWorkpaper = z.infer<typeof insertVatWorkpaperSchema>;
export type VatWorkpaper = typeof vatWorkpapers.$inferSelect;
export type InsertVatWorkpaperRow = z.infer<typeof insertVatWorkpaperRowSchema>;
export type VatWorkpaperRow = typeof vatWorkpaperRows.$inferSelect;
export type InsertVatWorkpaperAttachment = z.infer<typeof insertVatWorkpaperAttachmentSchema>;
export type VatWorkpaperAttachment = typeof vatWorkpaperAttachments.$inferSelect;

// ===========================
// W4-E VAT engine tables (migration 0104)
// ===========================
export const badDebtReliefClaims = pgTable(
  "bad_debt_relief_claims",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    invoiceId: uuid("invoice_id")
      .notNull()
      .references(() => invoices.id, { onDelete: "cascade" }),
    claimDate: pgDate("claim_date").notNull(),
    emirate: text("emirate").notNull(),
    outstandingAmount: money("outstanding_amount").notNull(),
    taxableAmount: money("taxable_amount").notNull(),
    vatAmount: money("vat_amount").notNull(),
    writtenOff: boolean("written_off").notNull().default(false),
    customerNotified: boolean("customer_notified").notNull().default(false),
    customerNotifiedAt: pgDate("customer_notified_at"),
    status: text("status").notNull().default("claimed"), // claimed | reversed
    journalEntryId: uuid("journal_entry_id"),
    reversalEntryId: uuid("reversal_entry_id"),
    reversedAt: pgDate("reversed_at"),
    reversalReason: text("reversal_reason"),
    notes: text("notes"),
    createdBy: uuid("created_by"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    companyIdx: index("idx_bad_debt_relief_company").on(table.companyId, table.claimDate),
  })
);
export type BadDebtReliefClaim = typeof badDebtReliefClaims.$inferSelect;

export const vatReturnAdjustments = pgTable(
  "vat_return_adjustments",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    periodStart: pgDate("period_start").notNull(),
    periodEnd: pgDate("period_end").notNull(),
    kind: text("kind").notNull(),
    emirate: text("emirate"),
    amount: money("amount").notNull().default(0),
    vatAmount: money("vat_amount").notNull().default(0),
    reason: text("reason").notNull(),
    reference: text("reference"),
    correctsPeriodStart: pgDate("corrects_period_start"),
    correctsPeriodEnd: pgDate("corrects_period_end"),
    createdBy: uuid("created_by"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    companyPeriodIdx: index("idx_vat_return_adjustments_company_period").on(
      table.companyId,
      table.periodStart,
      table.periodEnd
    ),
  })
);
export type VatReturnAdjustmentRow = typeof vatReturnAdjustments.$inferSelect;

export const vatRecoveryRules = pgTable("vat_recovery_rules", {
  id: uuid("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  companyId: uuid("company_id")
    .notNull()
    .references(() => companies.id, { onDelete: "cascade" }),
  matchType: text("match_type").notNull(), // category | account_code | account_id
  matchValue: text("match_value").notNull(),
  recoverablePercent: money("recoverable_percent").notNull(),
  label: text("label").notNull(),
  createdBy: uuid("created_by"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export type VatRecoveryRule = typeof vatRecoveryRules.$inferSelect;

export const receiptVatTreatments = pgTable("receipt_vat_treatments", {
  receiptId: uuid("receipt_id")
    .primaryKey()
    .references(() => receipts.id, { onDelete: "cascade" }),
  companyId: uuid("company_id")
    .notNull()
    .references(() => companies.id, { onDelete: "cascade" }),
  supplyType: text("supply_type").notNull().default("standard_rated"),
  vatBase: money("vat_base").notNull().default(0),
  recoverableVat: money("recoverable_vat").notNull().default(0),
  nonRecoverableVat: money("non_recoverable_vat").notNull().default(0),
  netBase: money("net_base").notNull().default(0),
  ruleLabel: text("rule_label"),
  lines: jsonb("lines")
    .notNull()
    .default(sql`'[]'::jsonb`),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const vatGroups = pgTable("vat_groups", {
  id: uuid("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  representativeCompanyId: uuid("representative_company_id")
    .notNull()
    .unique("vat_groups_representative_unique")
    .references(() => companies.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  groupTrn: text("group_trn").notNull(),
  createdBy: uuid("created_by"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const vatGroupMembers = pgTable(
  "vat_group_members",
  {
    groupId: uuid("group_id")
      .notNull()
      .references(() => vatGroups.id, { onDelete: "cascade" }),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    joinedAt: timestamp("joined_at").defaultNow().notNull(),
  },
  (table) => ({
    companyUnique: uniqueIndex("uniq_vat_group_members_company").on(table.companyId),
  })
);
