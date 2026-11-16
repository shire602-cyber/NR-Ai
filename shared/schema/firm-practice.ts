// Firm engagement letters, time entries, filing records and growth opportunities.
// Part of the shared/schema.ts barrel (R20-09); import from "@shared/schema".

import {
  boolean,
  index,
  integer,
  jsonb,
  date as pgDate,
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
import { firmEngagementTemplates, firmTasks, firms } from "./firms";
import { engagements, serviceInvoices } from "./firm-clients";

export const firmEngagementLetters = pgTable(
  "firm_engagement_letters",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    firmId: uuid("firm_id")
      .notNull()
      .references(() => firms.id, { onDelete: "cascade" }),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    templateId: uuid("template_id").references(() => firmEngagementTemplates.id, {
      onDelete: "set null",
    }),
    engagementId: uuid("engagement_id").references(() => engagements.id, { onDelete: "set null" }),
    kind: text("kind").notNull().default("engagement"), // engagement | proposal
    title: text("title").notNull(),
    body: text("body").notNull(),
    feeAmount: money("fee_amount"),
    billingCycle: text("billing_cycle"),
    status: text("status").notNull().default("draft"), // draft | sent | accepted | declined | withdrawn
    sentAt: timestamp("sent_at"),
    respondedAt: timestamp("responded_at"),
    acceptedByUserId: uuid("accepted_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    acceptedName: text("accepted_name"),
    acceptedIp: text("accepted_ip"),
    acceptedUserAgent: text("accepted_user_agent"),
    esignProvider: text("esign_provider"),
    esignStatus: text("esign_status").notNull().default("requires_external"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    companyIdx: index("idx_firm_engagement_letters_company").on(table.companyId, table.status),
    firmIdx: index("idx_firm_engagement_letters_firm").on(table.firmId),
  })
);
export type FirmEngagementLetter = typeof firmEngagementLetters.$inferSelect;

export const firmTimeEntries = pgTable(
  "firm_time_entries",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    firmId: uuid("firm_id")
      .notNull()
      .references(() => firms.id, { onDelete: "cascade" }),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    taskId: uuid("task_id").references(() => firmTasks.id, { onDelete: "set null" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    entryDate: pgDate("entry_date", { mode: "string" }).notNull(),
    minutes: integer("minutes").notNull().default(0),
    description: text("description"),
    billable: boolean("billable").notNull().default(true),
    hourlyRate: money("hourly_rate").notNull().default(0),
    status: text("status").notNull().default("logged"), // running | logged | billed | written_off
    startedAt: timestamp("started_at"),
    stoppedAt: timestamp("stopped_at"),
    serviceInvoiceId: uuid("service_invoice_id").references(() => serviceInvoices.id, {
      onDelete: "set null",
    }),
    billedAmount: money("billed_amount"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    companyIdx: index("idx_firm_time_entries_company").on(table.companyId, table.status),
    firmIdx: index("idx_firm_time_entries_firm").on(table.firmId, table.entryDate),
  })
);
export type FirmTimeEntry = typeof firmTimeEntries.$inferSelect;

export const firmFilingRecords = pgTable(
  "firm_filing_records",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    firmId: uuid("firm_id")
      .notNull()
      .references(() => firms.id, { onDelete: "cascade" }),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    filingType: text("filing_type").notNull(), // vat201 | ct | faf
    periodStart: pgDate("period_start", { mode: "string" }).notNull(),
    periodEnd: pgDate("period_end", { mode: "string" }).notNull(),
    filedOn: pgDate("filed_on", { mode: "string" }).notNull(),
    referenceNumber: text("reference_number").notNull(),
    checklist: jsonb("checklist")
      .notNull()
      .default(sql`'{}'::jsonb`),
    notes: text("notes"),
    recordedBy: uuid("recorded_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    periodUnique: uniqueIndex("uniq_firm_filing_records_period").on(
      table.companyId,
      table.filingType,
      table.periodStart,
      table.periodEnd
    ),
  })
);
export type FirmFilingRecord = typeof firmFilingRecords.$inferSelect;

// ===========================
// Firm Growth Opportunities
// ===========================
// Internal revenue-ops opportunities surfaced to NRA bookkeepers. These records
// are intentionally internal; action rows log scripts/notes and do not imply
// a client message was delivered unless a real provider is added later.
export const firmGrowthOpportunities = pgTable(
  "firm_growth_opportunities",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    companyId: uuid("company_id").references(() => companies.id, { onDelete: "cascade" }),
    prospectUserId: uuid("prospect_user_id").references(() => users.id, { onDelete: "set null" }),
    sourceKey: text("source_key").notNull().unique(),
    opportunityType: text("opportunity_type").notNull(), // service_ar | cleanup | advisory_pack | audit_pack | cfo_pack | saas_conversion | compliance_extra
    sourceSignal: text("source_signal").notNull(),
    title: text("title").notNull(),
    reason: text("reason").notNull(),
    estimatedValue: money("estimated_value").notNull().default(0),
    confidence: real("confidence").notNull().default(0.5),
    priority: text("priority").notNull().default("medium"), // critical | high | medium | low
    status: text("status").notNull().default("open"), // open | accepted | snoozed | dismissed | completed
    ownerUserId: uuid("owner_user_id").references(() => users.id, { onDelete: "set null" }),
    dueDate: timestamp("due_date"),
    snoozedUntil: timestamp("snoozed_until"),
    resolvedAt: timestamp("resolved_at"),
    resolutionNote: text("resolution_note"),
    metadata: jsonb("metadata")
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    companyIdIdx: index("idx_firm_growth_opportunities_company_id").on(table.companyId),
    statusIdx: index("idx_firm_growth_opportunities_status").on(table.status),
    priorityIdx: index("idx_firm_growth_opportunities_priority").on(table.priority),
    ownerIdx: index("idx_firm_growth_opportunities_owner").on(table.ownerUserId),
  })
);

export const firmGrowthActions = pgTable(
  "firm_growth_actions",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    opportunityId: uuid("opportunity_id")
      .notNull()
      .references(() => firmGrowthOpportunities.id, { onDelete: "cascade" }),
    actionType: text("action_type").notNull(), // accept | assign | snooze | dismiss | complete | note | script
    actorUserId: uuid("actor_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    channel: text("channel").notNull().default("internal"),
    deliveryState: text("delivery_state").notNull().default("logged"),
    note: text("note"),
    metadata: jsonb("metadata")
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    opportunityIdIdx: index("idx_firm_growth_actions_opportunity_id").on(table.opportunityId),
    actorIdx: index("idx_firm_growth_actions_actor").on(table.actorUserId),
  })
);

export const insertFirmGrowthOpportunitySchema = createInsertSchema(firmGrowthOpportunities).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export const insertFirmGrowthActionSchema = createInsertSchema(firmGrowthActions).omit({
  id: true,
  createdAt: true,
});

export type InsertFirmGrowthOpportunity = z.infer<typeof insertFirmGrowthOpportunitySchema>;
export type FirmGrowthOpportunity = typeof firmGrowthOpportunities.$inferSelect;
export type InsertFirmGrowthAction = z.infer<typeof insertFirmGrowthActionSchema>;
export type FirmGrowthAction = typeof firmGrowthActions.$inferSelect;
