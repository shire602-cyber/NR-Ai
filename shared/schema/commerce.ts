// Budgets, e-commerce integrations/transactions and financial KPIs.
// Part of the shared/schema.ts barrel (R20-09); import from "@shared/schema".

import {
  boolean,
  index,
  integer,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import type { z } from "zod";
import { sql } from "drizzle-orm";
import { money } from "./columns";
import { users } from "./users";
import { companies } from "./companies";
import { accounts, journalEntries } from "./ledger";
import { invoices } from "./sales";

// ===========================
// Budgets (for Budget vs Actual)
// ===========================
export const budgets = pgTable(
  "budgets",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    year: integer("year").notNull(),
    month: integer("month").notNull(), // 1-12
    budgetAmount: money("budget_amount").notNull().default(0),
    notes: text("notes"),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    companyPeriodIdx: index("idx_budgets_company_period").on(
      table.companyId,
      table.year,
      table.month
    ),
  })
);

export const insertBudgetSchema = createInsertSchema(budgets).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertBudget = z.infer<typeof insertBudgetSchema>;
export type Budget = typeof budgets.$inferSelect;

// ===========================
// E-Commerce Integrations (Stripe, Shopify, Salesforce)
// ===========================
export const ecommerceIntegrations = pgTable(
  "ecommerce_integrations",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    platform: text("platform").notNull(), // stripe | shopify | salesforce
    isActive: boolean("is_active").notNull().default(false),
    accessToken: text("access_token"), // Encrypted OAuth token
    refreshToken: text("refresh_token"),
    tokenExpiresAt: timestamp("token_expires_at"),
    shopDomain: text("shop_domain"), // Shopify shop domain
    apiKey: text("api_key"), // API key if needed
    webhookSecret: text("webhook_secret"),
    lastSyncAt: timestamp("last_sync_at"),
    syncStatus: text("sync_status").default("never"), // never | syncing | success | failed
    syncError: text("sync_error"),
    settings: text("settings"), // JSON config for mapping
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
    // W5-B (0106, R19-03): set only after the platform API accepted the credentials.
    connectionStatus: text("connection_status").notNull().default("not_connected"), // not_connected | connected | error
    verifiedAt: timestamp("verified_at"),
    externalAccountName: text("external_account_name"),
  },
  (table) => ({
    companyIdIdx: index("idx_ecommerce_integrations_company_id").on(table.companyId),
  })
);

export const insertEcommerceIntegrationSchema = createInsertSchema(ecommerceIntegrations).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertEcommerceIntegration = z.infer<typeof insertEcommerceIntegrationSchema>;
export type EcommerceIntegration = typeof ecommerceIntegrations.$inferSelect;

// ===========================
// E-Commerce Transactions (imported from platforms)
// ===========================
export const ecommerceTransactions = pgTable(
  "ecommerce_transactions",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    integrationId: uuid("integration_id")
      .notNull()
      .references(() => ecommerceIntegrations.id, { onDelete: "cascade" }),
    platform: text("platform").notNull(), // stripe | shopify | salesforce
    externalId: text("external_id").notNull(), // Platform's transaction ID
    transactionType: text("transaction_type").notNull(), // payment | refund | order | invoice
    amount: money("amount").notNull(),
    currency: text("currency").notNull().default("AED"),
    customerName: text("customer_name"),
    customerEmail: text("customer_email"),
    description: text("description"),
    status: text("status").notNull(), // succeeded | pending | failed | refunded
    platformFees: money("platform_fees"), // Stripe/Shopify fees
    netAmount: money("net_amount"), // Amount after fees
    transactionDate: timestamp("transaction_date").notNull(),
    metadata: text("metadata"), // JSON with platform-specific data
    isReconciled: boolean("is_reconciled").notNull().default(false),
    journalEntryId: uuid("journal_entry_id").references(() => journalEntries.id),
    invoiceId: uuid("invoice_id").references(() => invoices.id),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    bankTransactionId: uuid("bank_transaction_id"), // W5-B: Stripe payout -> bank-style row
  },
  (table) => ({
    companyIdIdx: index("idx_ecommerce_transactions_company_id").on(table.companyId),
    integrationIdIdx: index("idx_ecommerce_transactions_integration_id").on(table.integrationId),
    externalUnique: uniqueIndex("uq_ecommerce_transactions_integration_external").on(
      table.integrationId,
      table.externalId
    ),
  })
);

export const insertEcommerceTransactionSchema = createInsertSchema(ecommerceTransactions).omit({
  id: true,
  createdAt: true,
});

export type InsertEcommerceTransaction = z.infer<typeof insertEcommerceTransactionSchema>;
export type EcommerceTransaction = typeof ecommerceTransactions.$inferSelect;

// ===========================
// Financial KPIs (for real-time indicators)
// ===========================
export const financialKpis = pgTable(
  "financial_kpis",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    kpiType: text("kpi_type").notNull(), // profit_margin | expense_ratio | revenue_growth | cash_runway | dso | current_ratio
    period: text("period").notNull(), // daily | weekly | monthly | quarterly
    periodStart: timestamp("period_start").notNull(),
    periodEnd: timestamp("period_end").notNull(),
    value: real("value").notNull(),
    previousValue: real("previous_value"),
    changePercent: real("change_percent"),
    trend: text("trend"), // up | down | stable
    benchmark: real("benchmark"), // Industry benchmark
    calculatedAt: timestamp("calculated_at").defaultNow().notNull(),
  },
  (table) => ({
    companyIdIdx: index("idx_financial_kpis_company_id").on(table.companyId),
  })
);

export const insertFinancialKpiSchema = createInsertSchema(financialKpis).omit({
  id: true,
  calculatedAt: true,
});

export type InsertFinancialKpi = z.infer<typeof insertFinancialKpiSchema>;
export type FinancialKpi = typeof financialKpis.$inferSelect;
