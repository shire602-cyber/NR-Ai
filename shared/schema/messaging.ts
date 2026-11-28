// Waitlist, integration syncs and WhatsApp.
// Part of the shared/schema.ts barrel (R20-09); import from "@shared/schema".

import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "./columns";
import type { z } from "zod";
import { sql } from "drizzle-orm";
import { users } from "./users";
import { companies } from "./companies";
import { receipts } from "./receipts";

// ===========================
// Waitlist / Email Collection
// ===========================
export const waitlist = pgTable("waitlist", {
  id: uuid("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  email: text("email").notNull().unique(),
  source: text("source").notNull().default("landing_page"), // landing_page | popup | other
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertWaitlistSchema = createInsertSchema(waitlist).omit({
  id: true,
  createdAt: true,
});

export type InsertWaitlist = z.infer<typeof insertWaitlistSchema>;
export type Waitlist = typeof waitlist.$inferSelect;

// ===========================
// Integration Sync History
// ===========================
export const integrationSyncs = pgTable(
  "integration_syncs",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    integrationType: text("integration_type").notNull(), // google_sheets | xero | quickbooks | whatsapp
    syncType: text("sync_type").notNull(), // export | import
    dataType: text("data_type").notNull(), // invoices | expenses | journal_entries | chart_of_accounts
    status: text("status").notNull().default("completed"), // pending | in_progress | completed | failed
    recordCount: integer("record_count"),
    externalId: text("external_id"), // Spreadsheet ID, etc.
    externalUrl: text("external_url"), // Link to the spreadsheet, etc.
    errorMessage: text("error_message"),
    syncedAt: timestamp("synced_at").defaultNow().notNull(),
  },
  (table) => ({
    companyIdIdx: index("idx_integration_syncs_company_id").on(table.companyId),
  })
);

export const insertIntegrationSyncSchema = createInsertSchema(integrationSyncs).omit({
  id: true,
  syncedAt: true,
});

export type InsertIntegrationSync = z.infer<typeof insertIntegrationSyncSchema>;
export type IntegrationSync = typeof integrationSyncs.$inferSelect;

// ===========================
// WhatsApp Integration
// ===========================
export const whatsappConfigs = pgTable(
  "whatsapp_configs",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    phoneNumberId: text("phone_number_id"),
    accessToken: text("access_token"),
    webhookVerifyToken: text("webhook_verify_token"),
    businessAccountId: text("business_account_id"),
    isActive: boolean("is_active").notNull().default(false),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    companyIdIdx: index("idx_whatsapp_configs_company_id").on(table.companyId),
  })
);

export const insertWhatsappConfigSchema = createInsertSchema(whatsappConfigs).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertWhatsappConfig = z.infer<typeof insertWhatsappConfigSchema>;
export type WhatsappConfig = typeof whatsappConfigs.$inferSelect;

// WhatsApp Message Logs
export const whatsappMessages = pgTable(
  "whatsapp_messages",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    waMessageId: text("wa_message_id").notNull(),
    from: text("from_number").notNull(),
    to: text("to_number"),
    messageType: text("message_type").notNull(), // text | image | document
    content: text("content"),
    mediaUrl: text("media_url"),
    mediaId: text("media_id"),
    direction: text("direction").notNull().default("inbound"), // inbound | outbound
    status: text("status").notNull().default("received"), // received | logged | processing | processed | failed | delivered
    receiptId: uuid("receipt_id").references(() => receipts.id), // Link to created receipt
    errorMessage: text("error_message"),
    processedAt: timestamp("processed_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    companyIdIdx: index("idx_whatsapp_messages_company_id").on(table.companyId),
  })
);

export const insertWhatsappMessageSchema = createInsertSchema(whatsappMessages).omit({
  id: true,
  createdAt: true,
});

export type InsertWhatsappMessage = z.infer<typeof insertWhatsappMessageSchema>;
export type WhatsappMessage = typeof whatsappMessages.$inferSelect;

// WhatsApp Web Bridge sessions created by the Chrome extension. These do not
// prove delivery; they only show a staff browser can draft messages in
// WhatsApp Web for human review.
export const whatsappBridgeSessions = pgTable(
  "whatsapp_bridge_sessions",
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
    extensionId: text("extension_id").notNull(),
    extensionVersion: text("extension_version"),
    status: text("status").notNull().default("active"), // active | expired | revoked
    userAgent: text("user_agent"),
    lastSeenAt: timestamp("last_seen_at").defaultNow().notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    companyIdIdx: index("idx_whatsapp_bridge_sessions_company_id").on(table.companyId),
    userIdIdx: index("idx_whatsapp_bridge_sessions_user_id").on(table.userId),
    statusIdx: index("idx_whatsapp_bridge_sessions_status").on(table.status),
  })
);

export const insertWhatsappBridgeSessionSchema = createInsertSchema(whatsappBridgeSessions).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertWhatsappBridgeSession = z.infer<typeof insertWhatsappBridgeSessionSchema>;
export type WhatsappBridgeSession = typeof whatsappBridgeSessions.$inferSelect;

// Audited WhatsApp work queue. Jobs can be drafted by the extension, logged by
// the current wa.me/Desktop fallback, or later sent by an official provider.
export const whatsappBridgeJobs = pgTable(
  "whatsapp_bridge_jobs",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    sessionId: uuid("session_id").references(() => whatsappBridgeSessions.id, {
      onDelete: "set null",
    }),
    whatsappMessageId: uuid("whatsapp_message_id").references(() => whatsappMessages.id, {
      onDelete: "set null",
    }),
    provider: text("provider").notNull().default("whatsapp_web_extension"),
    kind: text("kind").notNull().default("direct_message"),
    recipientPhone: text("recipient_phone").notNull(),
    normalizedRecipientPhone: text("normalized_recipient_phone").notNull(),
    recipientName: text("recipient_name"),
    messageBody: text("message_body").notNull(),
    attachmentUrl: text("attachment_url"),
    attachmentLabel: text("attachment_label"),
    sourceType: text("source_type"),
    sourceId: uuid("source_id"),
    status: text("status").notNull().default("queued"), // queued | drafted | sent_unverified | failed | cancelled | expired
    deliveryStatus: text("delivery_status").notNull().default("logged"), // logged | drafted | sent_unverified | failed
    errorMessage: text("error_message"),
    metadata: jsonb("metadata")
      .notNull()
      .default(sql`'{}'::jsonb`),
    draftedAt: timestamp("drafted_at"),
    completedAt: timestamp("completed_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    companyIdIdx: index("idx_whatsapp_bridge_jobs_company_id").on(table.companyId),
    createdByIdx: index("idx_whatsapp_bridge_jobs_created_by").on(table.createdBy),
    statusIdx: index("idx_whatsapp_bridge_jobs_status").on(table.status),
    recipientIdx: index("idx_whatsapp_bridge_jobs_recipient").on(table.normalizedRecipientPhone),
    sourceIdx: index("idx_whatsapp_bridge_jobs_source").on(table.sourceType, table.sourceId),
  })
);

export const insertWhatsappBridgeJobSchema = createInsertSchema(whatsappBridgeJobs).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertWhatsappBridgeJob = z.infer<typeof insertWhatsappBridgeJobSchema>;
export type WhatsappBridgeJob = typeof whatsappBridgeJobs.$inferSelect;
