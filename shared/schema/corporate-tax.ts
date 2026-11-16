// Corporate tax returns (W4-A).
// Part of the shared/schema.ts barrel (R20-09); import from "@shared/schema".

import {
  boolean,
  customType,
  index,
  integer,
  jsonb,
  date as pgDate,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import type { z } from "zod";
import { sql } from "drizzle-orm";
import { createInsertSchema, money } from "./columns";
import { companies } from "./companies";

// ===========================
// Corporate Tax Returns (9% UAE CT)
// ===========================
// CT rate stored as numeric(6,4) (migrations 0086/0100); never client-set.
const ctRateType = customType<{ data: number; driverData: string }>({
  dataType() {
    return "numeric(6,4)";
  },
  fromDriver(value: string): number {
    return parseFloat(value);
  },
  toDriver(value: number) {
    return String(value);
  },
});

export const corporateTaxReturns = pgTable(
  "corporate_tax_returns",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    taxPeriodStart: timestamp("tax_period_start").notNull(),
    taxPeriodEnd: timestamp("tax_period_end").notNull(),
    totalRevenue: money("total_revenue").notNull().default(0),
    totalExpenses: money("total_expenses").notNull().default(0),
    totalDeductions: money("total_deductions").notNull().default(0),
    taxableIncome: money("taxable_income").notNull().default(0),
    exemptionThreshold: money("exemption_threshold").notNull().default(375000),
    taxRate: ctRateType("tax_rate").notNull().default(0.09),
    taxPayable: money("tax_payable").notNull().default(0),
    // Taxable-profit bridge (FDL 47/2022): loss pool in/out, Art. 21 small
    // business relief election, and related-party/TP disclosure notes.
    lossBroughtForward: money("loss_brought_forward").notNull().default(0),
    lossCarriedForward: money("loss_carried_forward").notNull().default(0),
    smallBusinessRelief: boolean("small_business_relief").notNull().default(false),
    relatedPartyNotes: text("related_party_notes"),
    // W4-A lifecycle (migration 0100): draft | computed | reviewed | filed |
    // paid | amended | void. Filed returns are immutable; amend by copy.
    status: text("status").notNull().default("draft"),
    filedAt: timestamp("filed_at"),
    filedBy: uuid("filed_by"),
    filingReference: text("filing_reference"),
    preparedBy: uuid("prepared_by"),
    computedAt: timestamp("computed_at"),
    reviewedBy: uuid("reviewed_by"),
    reviewedAt: timestamp("reviewed_at"),
    amendsReturnId: uuid("amends_return_id"),
    supersededById: uuid("superseded_by_id"),
    amendmentNumber: integer("amendment_number").notNull().default(0),
    provisionEntryId: uuid("provision_entry_id"),
    provisionReversalEntryId: uuid("provision_reversal_entry_id"),
    interestCarriedForward: money("interest_carried_forward").notNull().default(0),
    workpaper: jsonb("workpaper"),
    notes: text("notes"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at"),
  },
  (table) => ({
    companyIdIdx: index("idx_corporate_tax_returns_company_id").on(table.companyId),
  })
);

// CT / compliance profile per company (W4-A, migration 0100): QFZP status,
// MNE group revenue for TP thresholds, adviser confirmation, and the settings
// the compliance-obligation generator reads.
export const ctCompanyProfiles = pgTable("ct_company_profiles", {
  companyId: uuid("company_id")
    .primaryKey()
    .references(() => companies.id, { onDelete: "cascade" }),
  isQfzp: boolean("is_qfzp").notNull().default(false),
  freeZone: text("free_zone"),
  mneGroupRevenue: money("mne_group_revenue"),
  incorporationDate: pgDate("incorporation_date", { mode: "string" }),
  tradeLicenceExpiry: pgDate("trade_licence_expiry", { mode: "string" }),
  exciseRegistered: boolean("excise_registered").notNull().default(false),
  uboLastConfirmed: pgDate("ubo_last_confirmed", { mode: "string" }),
  einvoicingRevenueBand: text("einvoicing_revenue_band"), // ge_50m | lt_50m
  adviserConfirmedAt: timestamp("adviser_confirmed_at"),
  adviserConfirmedBy: uuid("adviser_confirmed_by"),
  adviserName: text("adviser_name"),
  adviserNote: text("adviser_note"),
  updatedBy: uuid("updated_by"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export type CtCompanyProfile = typeof ctCompanyProfiles.$inferSelect;

// Related-party / connected-person register for TP disclosure (W4-A).
export const ctRelatedParties = pgTable(
  "ct_related_parties",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    relationship: text("relationship").notNull(), // related_party | connected_person
    jurisdiction: text("jurisdiction"),
    nature: text("nature"),
    periodYear: integer("period_year"),
    transactionValue: money("transaction_value").notNull().default(0),
    notes: text("notes"),
    createdBy: uuid("created_by"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    companyIdx: index("idx_ct_related_parties_company").on(table.companyId),
  })
);
export type CtRelatedParty = typeof ctRelatedParties.$inferSelect;

// Month-end close depth (W4-A, migration 0100): per-step sign-off and the
// reopen workflow (request with reason, approval by a different user).
export const monthEndStepSignoffs = pgTable(
  "month_end_step_signoffs",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    periodEnd: pgDate("period_end", { mode: "string" }).notNull(),
    stepKey: text("step_key").notNull(),
    signedOffBy: uuid("signed_off_by").notNull(),
    signedOffAt: timestamp("signed_off_at").defaultNow().notNull(),
    note: text("note"),
  },
  (table) => ({
    uniqueStep: unique("month_end_step_signoffs_unique").on(
      table.companyId,
      table.periodEnd,
      table.stepKey
    ),
  })
);

export const monthEndReopenRequests = pgTable(
  "month_end_reopen_requests",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    periodEnd: pgDate("period_end", { mode: "string" }).notNull(),
    reason: text("reason").notNull(),
    status: text("status").notNull().default("pending"), // pending | approved | rejected
    requestedBy: uuid("requested_by").notNull(),
    requestedAt: timestamp("requested_at").defaultNow().notNull(),
    decidedBy: uuid("decided_by"),
    decidedAt: timestamp("decided_at"),
    decisionNote: text("decision_note"),
  },
  (table) => ({
    companyStatusIdx: index("idx_month_end_reopen_requests_company").on(
      table.companyId,
      table.status
    ),
  })
);

export const insertCorporateTaxReturnSchema = createInsertSchema(corporateTaxReturns).omit({
  id: true,
  createdAt: true,
});

export type InsertCorporateTaxReturn = z.infer<typeof insertCorporateTaxReturnSchema>;
export type CorporateTaxReturn = typeof corporateTaxReturns.$inferSelect;
