// Cash flow forecasts, AI transaction classifications and AI usage metering.
// Part of the shared/schema.ts barrel (R20-09); import from "@shared/schema".

import { boolean, index, integer, pgTable, real, text, timestamp, uuid } from "drizzle-orm/pg-core";
import type { z } from "zod";
import { sql } from "drizzle-orm";
import { createInsertSchema, money } from "./columns";
import { users } from "./users";
import { companies } from "./companies";
import { accounts } from "./ledger";

// ===========================
// Cash Flow Forecasts
// ===========================
export const cashFlowForecasts = pgTable(
  "cash_flow_forecasts",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    forecastDate: timestamp("forecast_date").notNull(),
    forecastType: text("forecast_type").notNull(), // daily | weekly | monthly
    predictedInflow: money("predicted_inflow").notNull().default(0),
    predictedOutflow: money("predicted_outflow").notNull().default(0),
    predictedBalance: money("predicted_balance").notNull().default(0),
    confidenceLevel: real("confidence_level"), // 0-1
    factors: text("factors"), // JSON string of contributing factors
    // documents_and_scheduled_items (current generator) | legacy_model (pre-0112 fabricated
    // model rows; readers discard and regenerate them).
    basis: text("basis"),
    generatedAt: timestamp("generated_at").defaultNow().notNull(),
  },
  (table) => ({
    companyIdIdx: index("idx_cash_flow_forecasts_company_id").on(table.companyId),
  })
);

export const insertCashFlowForecastSchema = createInsertSchema(cashFlowForecasts).omit({
  id: true,
  generatedAt: true,
});

export type InsertCashFlowForecast = z.infer<typeof insertCashFlowForecastSchema>;
export type CashFlowForecast = typeof cashFlowForecasts.$inferSelect;

// ===========================
// AI Transaction Classifications (for ML-style learning)
// ===========================
export const transactionClassifications = pgTable(
  "transaction_classifications",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    description: text("description").notNull(),
    merchant: text("merchant"),
    amount: money("amount"),
    suggestedAccountId: uuid("suggested_account_id").references(() => accounts.id),
    suggestedCategory: text("suggested_category"),
    aiConfidence: real("ai_confidence"), // 0-1
    aiReason: text("ai_reason"),
    wasAccepted: boolean("was_accepted"), // User feedback for ML improvement
    userSelectedAccountId: uuid("user_selected_account_id").references(() => accounts.id),
    // Phase 2: Receipt Autopilot — which classifier produced this suggestion.
    // 'rule' = ai_company_rules match, 'keyword' = UAE keyword pattern, 'statistical' = Naive Bayes,
    // 'openai' = LLM fallback. Used to compute per-method accuracy and trip the openai_only failsafe.
    classifierMethod: text("classifier_method"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    companyIdIdx: index("idx_transaction_classifications_company_id").on(table.companyId),
  })
);

export const insertTransactionClassificationSchema = createInsertSchema(
  transactionClassifications
).omit({
  id: true,
  createdAt: true,
});

export type InsertTransactionClassification = z.infer<typeof insertTransactionClassificationSchema>;
export type TransactionClassification = typeof transactionClassifications.$inferSelect;

// ===========================
// AI usage metering (W1-D; created by migration 0089)
// ===========================
export const aiUsageEvents = pgTable(
  "ai_usage_events",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    companyId: uuid("company_id").references(() => companies.id, { onDelete: "cascade" }),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    task: text("task").notNull(),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    costUsd: real("cost_usd").notNull().default(0),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    companyCreatedIdx: index("idx_ai_usage_events_company_created").on(
      table.companyId,
      table.createdAt
    ),
  })
);

export const aiUsageLimits = pgTable("ai_usage_limits", {
  companyId: uuid("company_id")
    .primaryKey()
    .references(() => companies.id, { onDelete: "cascade" }),
  monthlyTokenCap: integer("monthly_token_cap"),
  monthlyCostCapUsd: real("monthly_cost_cap_usd"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type AiUsageEvent = typeof aiUsageEvents.$inferSelect;
export type AiUsageLimit = typeof aiUsageLimits.$inferSelect;

export type ClassifierMethod = "rule" | "keyword" | "statistical" | "openai";
export type ClassifierMode = "hybrid" | "openai_only";

export interface ClassifierConfig {
  mode: ClassifierMode;
  accuracyThreshold: number;
  autopilotEnabled: boolean;
  /**
   * Minimum classification confidence before the autopilot may post a
   * journal entry without review. Stricter floor than accuracyThreshold
   * because crossing it mutates the books.
   */
  autopostThreshold: number;
}

export const DEFAULT_CLASSIFIER_CONFIG: ClassifierConfig = {
  mode: "hybrid",
  accuracyThreshold: 0.8,
  autopilotEnabled: false,
  autopostThreshold: 0.9,
};
