// Cost centers, reconciliation rules, templates, bank connections, API keys, webhooks, push.
// Part of the shared/schema.ts barrel (R20-09); import from "@shared/schema".

import {
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import type { z } from "zod";
import { sql } from "drizzle-orm";
import { users } from "./users";
import { companies } from "./companies";

// ===========================
// Cost Centers (departmental P&L allocation on journal lines)
// ===========================
export const costCenters = pgTable(
  "cost_centers",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    name: text("name").notNull(),
    // W4-B (migration 0101): Arabic name and type (R10-18, R10-19).
    nameAr: text("name_ar"),
    type: text("type").notNull().default("cost_centre"), // cost_centre | project | job
    description: text("description"),
    parentId: uuid("parent_id"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    companyCodeUnique: unique("cost_centers_company_code_unique").on(table.companyId, table.code),
    companyIdIdx: index("idx_cost_centers_company_id").on(table.companyId),
  })
);

export const insertCostCenterSchema = createInsertSchema(costCenters).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertCostCenter = z.infer<typeof insertCostCenterSchema>;
export type CostCenter = typeof costCenters.$inferSelect;

// ===========================
// Reconciliation Rules (auto-categorize bank transactions)
// ===========================
export const reconciliationRules = pgTable(
  "reconciliation_rules",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    matchField: text("match_field").notNull().default("description"), // description | reference | amount
    matchType: text("match_type").notNull().default("contains"), // exact | contains | starts_with | regex (R06-15)
    matchValue: text("match_value").notNull(),
    category: text("category"),
    memo: text("memo"),
    priority: integer("priority").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
    timesApplied: integer("times_applied").notNull().default(0),
    // W3-C (migration 0097, R06-04): a rule posts a real entry to this GL account.
    accountId: uuid("account_id"),
    vatTreatment: text("vat_treatment").notNull().default("none"), // none | standard | zero_rated | exempt
    requireReview: boolean("require_review").notNull().default(false), // true = draft entry for review
    direction: text("direction").notNull().default("any"), // any | inflow | outflow
    createdBy: uuid("created_by"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    companyIdIdx: index("idx_reconciliation_rules_company_id").on(table.companyId),
  })
);

export const insertReconciliationRuleSchema = createInsertSchema(reconciliationRules).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertReconciliationRule = z.infer<typeof insertReconciliationRuleSchema>;
export type ReconciliationRule = typeof reconciliationRules.$inferSelect;

// ===========================
// Invoice Templates (branding presets for invoice PDFs)
// ===========================
export const invoiceTemplates = pgTable(
  "invoice_templates",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    layout: text("layout").notNull().default("classic"), // classic | modern | minimal
    primaryColor: text("primary_color").default("#0D5C3D"),
    accentColor: text("accent_color").default("#C19E50"),
    headerText: text("header_text"),
    footerText: text("footer_text"),
    showLogo: boolean("show_logo").notNull().default(true),
    showStamp: boolean("show_stamp").notNull().default(false),
    isDefault: boolean("is_default").notNull().default(false),
    // W3-A (migration 0095): branding applied to the invoice PDF.
    logoUrl: text("logo_url"),
    termsText: text("terms_text"),
    bankDetails: text("bank_details"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    companyIdIdx: index("idx_invoice_templates_company_id").on(table.companyId),
  })
);

export const insertInvoiceTemplateSchema = createInsertSchema(invoiceTemplates).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertInvoiceTemplate = z.infer<typeof insertInvoiceTemplateSchema>;
export type InvoiceTemplate = typeof invoiceTemplates.$inferSelect;

// ===========================
// Bank Connections (open-banking links + manual statement imports)
// ===========================
export const bankConnections = pgTable(
  "bank_connections",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    provider: text("provider").notNull().default("manual"), // manual | lean | ...
    connectionType: text("connection_type").notNull().default("statement"), // statement | open_banking
    bankName: text("bank_name"),
    accountName: text("account_name"),
    bankAccountId: uuid("bank_account_id"), // optional link to bank_accounts ledger record
    externalAccountId: text("external_account_id"),
    accountNumberLast4: text("account_number_last4"),
    iban: text("iban"),
    consentId: text("consent_id"),
    autoSync: boolean("auto_sync").notNull().default(false),
    lastError: text("last_error"),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    tokenExpiresAt: timestamp("token_expires_at"),
    status: text("status").notNull().default("active"), // active | error | disconnected
    lastSyncedAt: timestamp("last_synced_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    companyIdIdx: index("idx_bank_connections_company_id").on(table.companyId),
  })
);

export const insertBankConnectionSchema = createInsertSchema(bankConnections).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertBankConnection = z.infer<typeof insertBankConnectionSchema>;
export type BankConnection = typeof bankConnections.$inferSelect;

// ===========================
// Document Versions (audit-grade change history for documents)
// ===========================
export const documentVersions = pgTable(
  "document_versions",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    documentType: text("document_type").notNull(), // invoice | quote | credit_note | purchase_order | receipt
    documentId: uuid("document_id").notNull(),
    version: integer("version").notNull(),
    changeDescription: text("change_description"),
    changedBy: uuid("changed_by").references(() => users.id),
    snapshotData: text("snapshot_data"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    documentIdx: index("idx_document_versions_document").on(
      table.companyId,
      table.documentType,
      table.documentId
    ),
    // W4-D (0103, R16-10): one number per version of a document.
    versionUnique: uniqueIndex("uq_document_versions_number").on(
      table.companyId,
      table.documentType,
      table.documentId,
      table.version
    ),
  })
);

export const insertDocumentVersionSchema = createInsertSchema(documentVersions).omit({
  id: true,
  createdAt: true,
});

export type InsertDocumentVersion = z.infer<typeof insertDocumentVersionSchema>;
export type DocumentVersion = typeof documentVersions.$inferSelect;

// ===========================
// API Keys (public API access)
// ===========================
export const apiKeys = pgTable(
  "api_keys",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    keyHash: text("key_hash").notNull(),
    keyPrefix: text("key_prefix").notNull(),
    scopes: text("scopes").notNull().default("read"),
    isActive: boolean("is_active").notNull().default(true),
    lastUsedAt: timestamp("last_used_at"),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    // W5-B (0106, R19-01): per-key rate limit, expiry and revocation.
    rateLimitPerMinute: integer("rate_limit_per_minute").notNull().default(120),
    expiresAt: timestamp("expires_at"),
    revokedAt: timestamp("revoked_at"),
  },
  (table) => ({
    companyIdIdx: index("idx_api_keys_company_id").on(table.companyId),
    keyHashIdx: index("idx_api_keys_key_hash").on(table.keyHash),
    keyPrefixIdx: index("idx_api_keys_key_prefix").on(table.keyPrefix),
  })
);

export const insertApiKeySchema = createInsertSchema(apiKeys).omit({ id: true, createdAt: true });
export type InsertApiKey = z.infer<typeof insertApiKeySchema>;
export type ApiKey = typeof apiKeys.$inferSelect;

// ===========================
// Webhook Endpoints + Deliveries (outbound integrations)
// ===========================
export const webhookEndpoints = pgTable(
  "webhook_endpoints",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    secret: text("secret").notNull(),
    events: text("events").notNull(), // comma-separated event names, or '*'
    isActive: boolean("is_active").notNull().default(true),
    failureCount: integer("failure_count").notNull().default(0),
    lastTriggeredAt: timestamp("last_triggered_at"),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    companyIdIdx: index("idx_webhook_endpoints_company_id").on(table.companyId),
  })
);

export const insertWebhookEndpointSchema = createInsertSchema(webhookEndpoints).omit({
  id: true,
  createdAt: true,
});
export type InsertWebhookEndpoint = z.infer<typeof insertWebhookEndpointSchema>;
export type WebhookEndpoint = typeof webhookEndpoints.$inferSelect;

export const webhookDeliveries = pgTable(
  "webhook_deliveries",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    webhookEndpointId: uuid("webhook_endpoint_id")
      .notNull()
      .references(() => webhookEndpoints.id, { onDelete: "cascade" }),
    event: text("event").notNull(),
    payload: text("payload"),
    responseStatus: integer("response_status"),
    responseBody: text("response_body"),
    success: boolean("success").notNull().default(false),
    attemptNumber: integer("attempt_number").notNull().default(1),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    // W5-B (0106, R19-02): durable delivery queue.
    companyId: uuid("company_id").references(() => companies.id, { onDelete: "cascade" }),
    eventId: text("event_id"),
    status: text("status").notNull().default("delivered"), // pending | retrying | delivered | dead
    nextAttemptAt: timestamp("next_attempt_at"),
    maxAttempts: integer("max_attempts").notNull().default(6),
    signature: text("signature"),
    lastError: text("last_error"),
    deliveredAt: timestamp("delivered_at"),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (table) => ({
    endpointIdx: index("idx_webhook_deliveries_endpoint").on(table.webhookEndpointId),
    dueIdx: index("idx_webhook_deliveries_due").on(table.status, table.nextAttemptAt),
  })
);

export const insertWebhookDeliverySchema = createInsertSchema(webhookDeliveries).omit({
  id: true,
  createdAt: true,
});
export type InsertWebhookDelivery = z.infer<typeof insertWebhookDeliverySchema>;
export type WebhookDelivery = typeof webhookDeliveries.$inferSelect;

// ===========================
// Push Subscriptions + Notification Preferences
// ===========================
export const pushSubscriptions = pgTable(
  "push_subscriptions",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    endpoint: text("endpoint").notNull(),
    p256dhKey: text("p256dh_key").notNull(),
    authKey: text("auth_key").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    userIdIdx: index("idx_push_subscriptions_user_id").on(table.userId),
    // W4-D (0103, R16-11): one row per (user, endpoint).
    userEndpointUnique: uniqueIndex("uq_push_subscriptions_user_endpoint").on(
      table.userId,
      table.endpoint
    ),
  })
);

export const insertPushSubscriptionSchema = createInsertSchema(pushSubscriptions).omit({
  id: true,
  createdAt: true,
});
export type InsertPushSubscription = z.infer<typeof insertPushSubscriptionSchema>;
export type PushSubscription = typeof pushSubscriptions.$inferSelect;

export const notificationPreferences = pgTable("notification_preferences", {
  id: uuid("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  userId: uuid("user_id")
    .notNull()
    .unique()
    .references(() => users.id, { onDelete: "cascade" }),
  pushEnabled: boolean("push_enabled").notNull().default(true),
  emailEnabled: boolean("email_enabled").notNull().default(true),
  invoiceReminders: boolean("invoice_reminders").notNull().default(true),
  paymentReceived: boolean("payment_received").notNull().default(true),
  vatDeadlines: boolean("vat_deadlines").notNull().default(true),
  weeklyDigest: boolean("weekly_digest").notNull().default(false),
  // W4-D (0103, R16-18): in-app channel switch, per-event-type channel overrides (JSON
  // `{ "<type>": { "inApp"?: bool, "email"?: bool, "push"?: bool } }`) and a daily digest.
  inAppEnabled: boolean("in_app_enabled").notNull().default(true),
  typePreferences: text("type_preferences").notNull().default("{}"),
  digestFrequency: text("digest_frequency").notNull().default("none"), // none | daily
  lastDigestAt: timestamp("last_digest_at"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertNotificationPreferencesSchema = createInsertSchema(notificationPreferences).omit(
  { id: true, updatedAt: true }
);
export type InsertNotificationPreferences = z.infer<typeof insertNotificationPreferencesSchema>;
export type NotificationPreferences = typeof notificationPreferences.$inferSelect;

// ===========================
// Stripe webhook event ledger (idempotency)
// ===========================
export const stripeEvents = pgTable("stripe_events", {
  id: text("id").primaryKey(), // Stripe event id (evt_...)
  type: text("type").notNull(),
  processedAt: timestamp("processed_at").defaultNow().notNull(),
});

export type StripeEvent = typeof stripeEvents.$inferSelect;
