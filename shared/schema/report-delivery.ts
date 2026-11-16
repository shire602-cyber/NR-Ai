// Company report delivery settings, runs and artifacts.
// Part of the shared/schema.ts barrel (R20-09); import from "@shared/schema".

import {
  boolean,
  customType,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "./columns";
import type { z } from "zod";
import { sql } from "drizzle-orm";
import { users } from "./users";
import { companies } from "./companies";

// ===========================
// Company Report Delivery Settings
// ===========================
export const companyReportDeliverySubscriptions = pgTable(
  "company_report_delivery_subscriptions",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    subscriptionId: text("subscription_id").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    cadenceOverride: text("cadence_override"),
    channelOverride: text("channel_override"),
    formatOverride: text("format_override"),
    recipientsOverride: text("recipients_override"),
    deliveryGuardrailOverride: text("delivery_guardrail_override"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    companySubscriptionUnique: unique("company_report_delivery_subscriptions_unique").on(
      table.companyId,
      table.subscriptionId
    ),
    companyIdIdx: index("idx_company_report_delivery_subscriptions_company_id").on(table.companyId),
    subscriptionIdIdx: index("idx_company_report_delivery_subscriptions_subscription_id").on(
      table.subscriptionId
    ),
  })
);

export const insertCompanyReportDeliverySubscriptionSchema = createInsertSchema(
  companyReportDeliverySubscriptions
).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertCompanyReportDeliverySubscription = z.infer<
  typeof insertCompanyReportDeliverySubscriptionSchema
>;
export type CompanyReportDeliverySubscription =
  typeof companyReportDeliverySubscriptions.$inferSelect;

export const companyReportAutomationPreferences = pgTable(
  "company_report_automation_preferences",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    persona: text("persona").notNull(),
    preferredDeliveryAutomationCommand: text("preferred_delivery_automation_command"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    companyUserPersonaUnique: unique("company_report_automation_preferences_unique").on(
      table.companyId,
      table.userId,
      table.persona
    ),
    companyIdIdx: index("idx_company_report_automation_preferences_company_id").on(table.companyId),
    userIdIdx: index("idx_company_report_automation_preferences_user_id").on(table.userId),
  })
);

export const insertCompanyReportAutomationPreferenceSchema = createInsertSchema(
  companyReportAutomationPreferences
).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertCompanyReportAutomationPreference = z.infer<
  typeof insertCompanyReportAutomationPreferenceSchema
>;
export type CompanyReportAutomationPreference =
  typeof companyReportAutomationPreferences.$inferSelect;

export const companyReportDeliveryRuns = pgTable(
  "company_report_delivery_runs",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    subscriptionId: text("subscription_id").notNull(),
    // queued | rendering | sent | failed | blocked | cancelled (W5-A: truthful lifecycle)
    status: text("status").notNull().default("queued"),
    readinessStatus: text("readiness_status").notNull(), // ready | setup | paused
    /** no_email_provider | no_recipients | handoff_review (status = blocked). */
    blockedReason: text("blocked_reason"),
    outboxMessageIds: jsonb("outbox_message_ids")
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    recipientAddresses: jsonb("recipient_addresses")
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    artifactCount: integer("artifact_count").notNull().default(0),
    renderedAt: timestamp("rendered_at"),
    sentAt: timestamp("sent_at"),
    retryScheduledAt: timestamp("retry_scheduled_at"),
    notificationId: uuid("notification_id"),
    retriedFromRunId: uuid("retried_from_run_id"),
    errorMessage: text("error_message"),
    scheduledFor: timestamp("scheduled_for").notNull(),
    queuedBy: uuid("queued_by").references(() => users.id, { onDelete: "set null" }),
    channel: text("channel").notNull(),
    format: text("format").notNull(),
    recipients: text("recipients").notNull(),
    deliveryGuardrail: text("delivery_guardrail").notNull(),
    reportCount: integer("report_count").notNull().default(0),
    readyReportCount: integer("ready_report_count").notNull().default(0),
    triggerRuleCount: integer("trigger_rule_count").notNull().default(0),
    snapshot: jsonb("snapshot")
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    companyIdIdx: index("idx_company_report_delivery_runs_company_id").on(table.companyId),
    subscriptionIdIdx: index("idx_company_report_delivery_runs_subscription_id").on(
      table.subscriptionId
    ),
    companySubscriptionIdx: index("idx_company_report_delivery_runs_company_subscription").on(
      table.companyId,
      table.subscriptionId
    ),
    scheduledForIdx: index("idx_company_report_delivery_runs_scheduled_for").on(table.scheduledFor),
  })
);

export const insertCompanyReportDeliveryRunSchema = createInsertSchema(
  companyReportDeliveryRuns
).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertCompanyReportDeliveryRun = z.infer<typeof insertCompanyReportDeliveryRunSchema>;
export type CompanyReportDeliveryRun = typeof companyReportDeliveryRuns.$inferSelect;

export const companyReportDeliverySchedulerScans = pgTable(
  "company_report_delivery_scheduler_scans",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("success"), // success | error
    startedAt: timestamp("started_at").notNull(),
    finishedAt: timestamp("finished_at").notNull(),
    scannedSubscriptions: integer("scanned_subscriptions").notNull().default(0),
    queuedRuns: integer("queued_runs").notNull().default(0),
    skippedPaused: integer("skipped_paused").notNull().default(0),
    skippedSetup: integer("skipped_setup").notNull().default(0),
    skippedNotDue: integer("skipped_not_due").notNull().default(0),
    skippedNoActor: integer("skipped_no_actor").notNull().default(0),
    errors: integer("errors").notNull().default(0),
    message: text("message"),
    snapshot: jsonb("snapshot")
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    companyIdIdx: index("idx_company_report_delivery_scheduler_scans_company_id").on(
      table.companyId
    ),
    finishedAtIdx: index("idx_company_report_delivery_scheduler_scans_finished_at").on(
      table.finishedAt
    ),
  })
);

export const insertCompanyReportDeliverySchedulerScanSchema = createInsertSchema(
  companyReportDeliverySchedulerScans
).omit({
  id: true,
  createdAt: true,
});

export type InsertCompanyReportDeliverySchedulerScan = z.infer<
  typeof insertCompanyReportDeliverySchedulerScanSchema
>;
export type CompanyReportDeliverySchedulerScan =
  typeof companyReportDeliverySchedulerScans.$inferSelect;

/** bytea column carried as a Buffer (W5-A report artefacts). */
const w5aBytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return "bytea";
  },
});

/** Rendered PDF / XLSX / ZIP files of a report delivery run (W5-A, R12-01). */
export const companyReportDeliveryArtifacts = pgTable(
  "company_report_delivery_artifacts",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    runId: uuid("run_id")
      .notNull()
      .references(() => companyReportDeliveryRuns.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(), // pdf | xlsx | zip
    filename: text("filename").notNull(),
    contentType: text("content_type").notNull(),
    sizeBytes: integer("size_bytes").notNull().default(0),
    sha256: text("sha256").notNull(),
    // S5: NULL when the bytes live in object storage (storage_key); dev/test fallback keeps them here.
    content: w5aBytea("content"),
    storageKey: text("storage_key"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    runIdx: index("idx_company_report_delivery_artifacts_run").on(table.companyId, table.runId),
  })
);

export type CompanyReportDeliveryArtifact = typeof companyReportDeliveryArtifacts.$inferSelect;

// S8: object-storage deletions queued by a trigger when an artifact row with a storage_key is
// deleted (directly or by cascade); drained with retries by the storage.objectDeletionSweep job.
export const objectStorageDeletions = pgTable(
  "object_storage_deletions",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    storageKey: text("storage_key").notNull(),
    source: text("source").notNull(),
    status: text("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    nextAttemptAt: timestamp("next_attempt_at").defaultNow().notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    dueIdx: index("idx_object_storage_deletions_due").on(table.status, table.nextAttemptAt),
  })
);
