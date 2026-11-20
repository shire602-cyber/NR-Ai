// Activity logs, client notes, engagements, service invoices, subscriptions, backups.
// Part of the shared/schema.ts barrel (R20-09); import from "@shared/schema".

import {
  bigint,
  boolean,
  index,
  integer,
  date as pgDate,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type { z } from "zod";
import { sql } from "drizzle-orm";
import { createInsertSchema, money, vatRateType } from "./columns";
import { users } from "./users";
import { companies } from "./companies";
import { firms } from "./firms";
import { journalEntries } from "./ledger";

// ===========================
// Activity Logs (Audit Trail)
// ===========================
export const activityLogs = pgTable(
  "activity_logs",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: uuid("user_id").references(() => users.id),
    companyId: uuid("company_id").references(() => companies.id, { onDelete: "cascade" }),
    action: text("action").notNull(), // create | update | delete | login | logout | invite | view
    entityType: text("entity_type").notNull(), // user | company | document | invoice | journal_entry | etc
    entityId: text("entity_id"),
    description: text("description").notNull(),
    metadata: text("metadata"), // JSON string for additional context
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    companyIdIdx: index("idx_activity_logs_company_id").on(table.companyId),
  })
);

export const insertActivityLogSchema = createInsertSchema(activityLogs).omit({
  id: true,
  createdAt: true,
});

export type InsertActivityLog = z.infer<typeof insertActivityLogSchema>;
export type ActivityLog = typeof activityLogs.$inferSelect;

// ===========================
// Client Notes (Admin notes about clients - internal only)
// ===========================
export const clientNotes = pgTable(
  "client_notes",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    authorId: uuid("author_id")
      .notNull()
      .references(() => users.id),
    content: text("content").notNull(),
    isPinned: boolean("is_pinned").default(false),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    companyIdIdx: index("idx_client_notes_company_id").on(table.companyId),
  })
);

export const insertClientNoteSchema = createInsertSchema(clientNotes).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertClientNote = z.infer<typeof insertClientNoteSchema>;
export type ClientNote = typeof clientNotes.$inferSelect;

// ===========================
// Client Engagements (NR Accounting managing clients)
// ===========================
// Tracks the relationship between NR Accounting and their clients
export const engagements = pgTable(
  "engagements",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    accountManagerId: uuid("account_manager_id").references(() => users.id), // NR staff assigned
    firmId: uuid("firm_id").references(() => firms.id, { onDelete: "set null" }), // 0108

    // Engagement Details
    engagementType: text("engagement_type").notNull().default("full_service"), // full_service | vat_only | bookkeeping | advisory
    status: text("status").notNull().default("active"), // active | on_hold | terminated
    startDate: timestamp("start_date").notNull(),
    endDate: timestamp("end_date"),

    // Service Agreement
    monthlyFee: money("monthly_fee"),
    billingCycle: text("billing_cycle").default("monthly"), // monthly | quarterly | annually
    paymentTerms: integer("payment_terms").default(30), // days

    // Service Scope
    servicesIncluded: text("services_included"), // JSON array of services
    specialInstructions: text("special_instructions"),

    // Onboarding
    onboardingCompleted: boolean("onboarding_completed").default(false),
    onboardingCompletedAt: timestamp("onboarding_completed_at"),
    hourlyRate: money("hourly_rate"), // 0108: WIP valuation default
    nextBillingDate: pgDate("next_billing_date", { mode: "string" }), // 0108: recurring billing

    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    companyIdIdx: index("idx_engagements_company_id").on(table.companyId),
    accountManagerIdx: index("idx_engagements_account_manager_id").on(table.accountManagerId),
  })
);

export const insertEngagementSchema = createInsertSchema(engagements).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertEngagement = z.infer<typeof insertEngagementSchema>;
export type Engagement = typeof engagements.$inferSelect;

// ===========================
// Service Invoices (NR Accounting billing to clients)
// ===========================
// Invoices from NR Accounting Services to their managed clients
export const serviceInvoices = pgTable(
  "service_invoices",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    engagementId: uuid("engagement_id")
      .notNull()
      .references(() => engagements.id, { onDelete: "cascade" }),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    firmId: uuid("firm_id").references(() => firms.id, { onDelete: "set null" }), // 0108
    source: text("source"), // 0108: recurring | time | manual
    sourceKey: text("source_key"), // 0108: idempotency key for generated invoices

    // Invoice Details
    invoiceNumber: text("invoice_number").notNull(),
    invoiceDate: timestamp("invoice_date").notNull(),
    dueDate: timestamp("due_date").notNull(),

    // Amounts (in AED)
    subtotal: money("subtotal").notNull().default(0),
    vatAmount: money("vat_amount").notNull().default(0),
    total: money("total").notNull().default(0),

    // Payment
    status: text("status").notNull().default("draft"), // draft | sent | paid | overdue | void
    paidAmount: money("paid_amount").default(0),
    paidAt: timestamp("paid_at"),
    paymentMethod: text("payment_method"), // bank_transfer | card | cash | cheque
    paymentReference: text("payment_reference"),

    // Period
    periodStart: timestamp("period_start"),
    periodEnd: timestamp("period_end"),

    // Notes
    description: text("description"),
    notes: text("notes"),

    // PDF
    pdfUrl: text("pdf_url"),

    createdBy: uuid("created_by").references(() => users.id),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    companyIdIdx: index("idx_service_invoices_company_id").on(table.companyId),
    engagementIdIdx: index("idx_service_invoices_engagement_id").on(table.engagementId),
  })
);

export const insertServiceInvoiceSchema = createInsertSchema(serviceInvoices).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertServiceInvoice = z.infer<typeof insertServiceInvoiceSchema>;
export type ServiceInvoice = typeof serviceInvoices.$inferSelect;

// ===========================
// Service Invoice Lines
// ===========================
export const serviceInvoiceLines = pgTable(
  "service_invoice_lines",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    serviceInvoiceId: uuid("service_invoice_id")
      .notNull()
      .references(() => serviceInvoices.id, { onDelete: "cascade" }),
    description: text("description").notNull(),
    quantity: real("quantity").notNull().default(1),
    unitPrice: money("unit_price").notNull(),
    vatRate: vatRateType("vat_rate").notNull().default(0.05), // UAE 5%
    amount: money("amount").notNull(), // quantity * unitPrice
  },
  (table) => ({
    serviceInvoiceIdIdx: index("idx_service_invoice_lines_service_invoice_id").on(
      table.serviceInvoiceId
    ),
  })
);

export const insertServiceInvoiceLineSchema = createInsertSchema(serviceInvoiceLines).omit({
  id: true,
});

export type InsertServiceInvoiceLine = z.infer<typeof insertServiceInvoiceLineSchema>;
export type ServiceInvoiceLine = typeof serviceInvoiceLines.$inferSelect;

// ===========================
// FTA Email Sync (for client portal)
// ===========================
// Tracks emails synced from FTA for clients
export const ftaEmails = pgTable(
  "fta_emails",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),

    // Email Details
    subject: text("subject").notNull(),
    sender: text("sender"),
    receivedAt: timestamp("received_at").notNull(),

    // Content
    bodyText: text("body_text"),
    bodyHtml: text("body_html"),

    // Categorization
    emailType: text("email_type"), // vat_return_confirmation | payment_reminder | tax_notice | assessment | other
    priority: text("priority").default("normal"), // low | normal | high | urgent

    // Status
    isRead: boolean("is_read").default(false),
    isArchived: boolean("is_archived").default(false),
    isStarred: boolean("is_starred").default(false),

    // Attachments
    hasAttachments: boolean("has_attachments").default(false),
    attachments: text("attachments"), // JSON array of attachment details

    // Processing
    aiSummary: text("ai_summary"),
    actionRequired: boolean("action_required").default(false),
    actionDescription: text("action_description"),
    actionDueDate: timestamp("action_due_date"),

    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    companyIdIdx: index("idx_fta_emails_company_id").on(table.companyId),
  })
);

export const insertFtaEmailSchema = createInsertSchema(ftaEmails).omit({
  id: true,
  createdAt: true,
});

export type InsertFtaEmail = z.infer<typeof insertFtaEmailSchema>;
export type FtaEmail = typeof ftaEmails.$inferSelect;

// ===========================
// Customer Subscriptions (SaaS tier tracking)
// ===========================
export const subscriptions = pgTable(
  "subscriptions",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),

    // Plan Details
    planId: text("plan_id").notNull(), // free | starter | professional | enterprise
    planName: text("plan_name").notNull(),
    billingCycle: text("billing_cycle").notNull().default("monthly"), // monthly | yearly
    maxCompanies: integer("max_companies"),
    invoicesCreatedThisMonth: integer("invoices_created_this_month").notNull().default(0),
    receiptsCreatedThisMonth: integer("receipts_created_this_month").notNull().default(0),
    aiCreditsUsedThisMonth: integer("ai_credits_used_this_month").notNull().default(0),
    maxStorageMb: integer("max_storage_mb"),
    aiCreditsPerMonth: integer("ai_credits_per_month"),
    usagePeriodStart: timestamp("usage_period_start"),

    // Billing
    status: text("status").notNull().default("active"), // active | cancelled | past_due | trialing
    currentPeriodStart: timestamp("current_period_start").notNull(),
    currentPeriodEnd: timestamp("current_period_end").notNull(),
    cancelAtPeriodEnd: boolean("cancel_at_period_end").default(false),

    // Stripe Integration (if using)
    stripeCustomerId: text("stripe_customer_id"),
    stripeSubscriptionId: text("stripe_subscription_id"),

    // Usage Limits
    maxUsers: integer("max_users").default(1),
    maxInvoices: integer("max_invoices").default(50),
    maxReceipts: integer("max_receipts").default(100),
    aiCreditsRemaining: integer("ai_credits_remaining").default(100),

    // W5-B (0106, R19-16): trial, seats and dunning.
    trialEndsAt: timestamp("trial_ends_at"),
    seatCount: integer("seat_count").notNull().default(1),
    dunningStage: integer("dunning_stage").notNull().default(0),
    lastPaymentFailedAt: timestamp("last_payment_failed_at"),

    // STEP4 (0135): the plan the customer chose for after the trial. Never read by the gates.
    chosenPlanId: text("chosen_plan_id"), // starter | professional | enterprise
    chosenBillingCycle: text("chosen_billing_cycle"), // monthly | yearly
    chosenPlanSource: text("chosen_plan_source"), // signup_default | signup_picked | pricing_link | settings
    chosenPlanAt: timestamp("chosen_plan_at"),
    planActivationRequestedAt: timestamp("plan_activation_requested_at"),

    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    companyIdIdx: index("idx_subscriptions_company_id").on(table.companyId),
  })
);

export const insertSubscriptionSchema = createInsertSchema(subscriptions).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertSubscription = z.infer<typeof insertSubscriptionSchema>;
export type Subscription = typeof subscriptions.$inferSelect;

// W5-B (0106, R19-04): monthly usage meter (period "YYYY-MM").
export const usageCounters = pgTable(
  "usage_counters",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    period: text("period").notNull(),
    metric: text("metric").notNull(), // invoices | receipts | ai_calls | team_members
    count: integer("count").notNull().default(0),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    uniq: uniqueIndex("uq_usage_counters_company_period_metric").on(
      table.companyId,
      table.period,
      table.metric
    ),
  })
);
export type UsageCounter = typeof usageCounters.$inferSelect;

// W5-B (0106, R19-16): VAT-inclusive subscription invoices and receipts.
export const billingDocuments = pgTable("billing_documents", {
  id: uuid("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  companyId: uuid("company_id")
    .notNull()
    .references(() => companies.id, { onDelete: "cascade" }),
  kind: text("kind").notNull().default("invoice"), // invoice | receipt
  number: text("number").notNull().unique(),
  stripeInvoiceId: text("stripe_invoice_id"),
  planId: text("plan_id"),
  billingCycle: text("billing_cycle"),
  seatCount: integer("seat_count").notNull().default(1),
  periodStart: timestamp("period_start"),
  periodEnd: timestamp("period_end"),
  subtotalFils: bigint("subtotal_fils", { mode: "number" }).notNull().default(0),
  vatFils: bigint("vat_fils", { mode: "number" }).notNull().default(0),
  discountFils: bigint("discount_fils", { mode: "number" }).notNull().default(0),
  totalFils: bigint("total_fils", { mode: "number" }).notNull().default(0),
  currency: text("currency").notNull().default("AED"),
  status: text("status").notNull().default("issued"),
  issuedAt: timestamp("issued_at").defaultNow().notNull(),
  paidAt: timestamp("paid_at"),
});
export type BillingDocument = typeof billingDocuments.$inferSelect;

// ===========================
// Data Backups (Financial Records Safeguard)
// ===========================
export const backups = pgTable(
  "backups",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),

    // Backup Details
    name: text("name").notNull(),
    description: text("description"),
    backupType: text("backup_type").notNull().default("manual"), // manual | scheduled | pre_restore
    status: text("status").notNull().default("pending"), // pending | in_progress | completed | failed

    // Data Counts (for verification)
    accountsCount: integer("accounts_count").default(0),
    journalEntriesCount: integer("journal_entries_count").default(0),
    invoicesCount: integer("invoices_count").default(0),
    receiptsCount: integer("receipts_count").default(0),
    vatReturnsCount: integer("vat_returns_count").default(0),

    // Storage
    dataSnapshot: text("data_snapshot"), // W5-B: secret-vault ciphertext of the JSON snapshot
    checksum: text("checksum"), // SHA256 of the plaintext snapshot, verified before restore
    sizeBytes: integer("size_bytes").default(0),
    // W5-B (0106, R19-06, R17-22): encrypted full-company snapshot metadata.
    encrypted: boolean("encrypted").notNull().default(false),
    formatVersion: text("format_version").notNull().default("1.0"),
    tableCounts: text("table_counts"), // JSON { table: rowCount }
    lastRestoreMode: text("last_restore_mode"), // merge | replace
    lastRestoredAt: timestamp("last_restored_at"),

    // Timestamps
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    completedAt: timestamp("completed_at"),
    expiresAt: timestamp("expires_at"), // Auto-cleanup after 90 days
  },
  (table) => ({
    companyIdIdx: index("idx_backups_company_id").on(table.companyId),
  })
);

export const insertBackupSchema = createInsertSchema(backups).omit({
  id: true,
  createdAt: true,
});

export type InsertBackup = z.infer<typeof insertBackupSchema>;
export type Backup = typeof backups.$inferSelect;

// W5-B (0106, R19-17): scheduled backups (job registry "backups.scheduled").
export const backupSchedules = pgTable(
  "backup_schedules",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    frequency: text("frequency").notNull().default("weekly"), // daily | weekly | monthly
    retentionDays: integer("retention_days").notNull().default(90),
    isActive: boolean("is_active").notNull().default(true),
    lastRunAt: timestamp("last_run_at"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    companyUnique: uniqueIndex("uq_backup_schedules_company").on(table.companyId),
  })
);
export type BackupSchedule = typeof backupSchedules.$inferSelect;

// W5-B (0106, R19-13, R02-16b): migration import jobs (preview -> validate -> commit).
export const importJobs = pgTable(
  "import_jobs",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    // chart_of_accounts | trial_balance | customers | vendors | items | open_invoices | open_bills
    kind: text("kind").notNull(),
    sourceSystem: text("source_system").notNull().default("generic"), // xero | quickbooks | zoho | wafeq | generic
    status: text("status").notNull().default("previewed"), // previewed | validated | committed | failed
    fileName: text("file_name"),
    cutOverDate: pgDate("cut_over_date", { mode: "string" }),
    arApMode: text("ar_ap_mode"), // balance | documents (trial balance only)
    rows: text("rows").notNull().default("[]"),
    issues: text("issues").notNull().default("[]"),
    summary: text("summary").notNull().default("{}"),
    result: text("result"),
    journalEntryId: uuid("journal_entry_id").references(() => journalEntries.id, {
      onDelete: "set null",
    }),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    validatedAt: timestamp("validated_at"),
    committedAt: timestamp("committed_at"),
  },
  (table) => ({
    companyKindIdx: index("idx_import_jobs_company").on(table.companyId, table.kind),
  })
);
export type ImportJob = typeof importJobs.$inferSelect;

// ===========================
// AI Conversations (Chat History)
// ===========================
export const aiConversations = pgTable(
  "ai_conversations",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    companyId: uuid("company_id").references(() => companies.id, { onDelete: "cascade" }),

    // Conversation Details
    prompt: text("prompt").notNull(),
    response: text("response").notNull(),
    model: text("model").notNull().default("gpt-3.5-turbo"), // gpt-3.5-turbo | gpt-4 | gpt-4-turbo
    systemPrompt: text("system_prompt"), // Custom system prompt if provided

    // Metadata
    tokensUsed: integer("tokens_used"), // If available from OpenAI
    responseTime: integer("response_time"), // Milliseconds
    error: text("error"), // Error message if request failed

    // Timestamps
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    userIdIdx: index("idx_ai_conversations_user_id").on(table.userId),
    companyIdIdx: index("idx_ai_conversations_company_id").on(table.companyId),
  })
);

export const insertAiConversationSchema = createInsertSchema(aiConversations).omit({
  id: true,
  createdAt: true,
});

export type InsertAiConversation = z.infer<typeof insertAiConversationSchema>;
export type AiConversation = typeof aiConversations.$inferSelect;

// ===========================
// Client Communications
// ===========================
export const clientCommunications = pgTable(
  "client_communications",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    channel: text("channel").notNull(), // 'whatsapp' | 'email' | 'sms'
    direction: text("direction").notNull().default("outbound"), // 'inbound' | 'outbound'
    recipientPhone: text("recipient_phone"),
    recipientEmail: text("recipient_email"),
    subject: text("subject"),
    body: text("body").notNull(),
    status: text("status").notNull().default("sent"), // 'logged' | 'sent' | 'delivered' | 'read' | 'failed'
    templateType: text("template_type"), // 'vat_reminder' | 'invoice' | 'document_request' | 'payment_confirmation' | 'custom'
    metadata: text("metadata"), // JSON string
    sentAt: timestamp("sent_at").defaultNow().notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    companyIdIdx: index("idx_client_communications_company_id").on(table.companyId),
  })
);

export const insertClientCommunicationSchema = createInsertSchema(clientCommunications).omit({
  id: true,
  createdAt: true,
});

export type InsertClientCommunication = z.infer<typeof insertClientCommunicationSchema>;
export type ClientCommunication = typeof clientCommunications.$inferSelect;

// ===========================
// Communication Templates
// ===========================
export const communicationTemplates = pgTable("communication_templates", {
  id: uuid("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  channel: text("channel").notNull(), // 'whatsapp' | 'email' | 'sms'
  templateType: text("template_type").notNull(), // 'vat_reminder' | 'invoice' | 'document_request' | 'payment_confirmation' | 'custom'
  subjectTemplate: text("subject_template"),
  bodyTemplate: text("body_template").notNull(),
  language: text("language").notNull().default("en"), // 'en' | 'ar'
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertCommunicationTemplateSchema = createInsertSchema(communicationTemplates).omit({
  id: true,
  createdAt: true,
});

export type InsertCommunicationTemplate = z.infer<typeof insertCommunicationTemplateSchema>;
export type CommunicationTemplate = typeof communicationTemplates.$inferSelect;

// ===========================
// Firm Leads (NRA Lead Pipeline)
// ===========================
export const firmLeads = pgTable(
  "firm_leads",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    companyId: uuid("company_id").references(() => companies.id, { onDelete: "set null" }),
    firmId: uuid("firm_id").references(() => firms.id, { onDelete: "cascade" }), // 0108

    stage: text("stage").notNull().default("prospect"), // prospect | contacted | interested | converted | lost
    source: text("source").notNull().default("manual"), // saas_signup | referral | manual | website

    notes: text("notes"),
    score: integer("score").default(50), // 0–100

    convertedAt: timestamp("converted_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    userIdIdx: index("idx_firm_leads_user_id").on(table.userId),
    stageIdx: index("idx_firm_leads_stage").on(table.stage),
  })
);

export const insertFirmLeadSchema = createInsertSchema(firmLeads).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const updateFirmLeadSchema = insertFirmLeadSchema.partial();

export type InsertFirmLead = z.infer<typeof insertFirmLeadSchema>;
export type UpdateFirmLead = z.infer<typeof updateFirmLeadSchema>;
export type FirmLead = typeof firmLeads.$inferSelect;
