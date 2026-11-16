// Payment/document chasing, firm alerts and metrics, email intake.
// Part of the shared/schema.ts barrel (R20-09); import from "@shared/schema".

import {
  boolean,
  index,
  integer,
  date as pgDate,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import type { z } from "zod";
import { sql } from "drizzle-orm";
import { money } from "./columns";
import { users } from "./users";
import { companies } from "./companies";
import { invoices } from "./sales";
import { receipts } from "./receipts";
import { customerContacts } from "./contacts";

// ===========================
// Payment Chasing Autopilot (Phase 4)
// ===========================
// Tracks every "chase" action taken against an overdue invoice. A chase is a
// reminder communication (WhatsApp / email / manual) that escalates with the
// number of days the invoice is overdue. We log each attempt — even when the
// user only previews a wa.me link without sending — so that the next chase
// level is computed deterministically and effectiveness can be measured.
export const paymentChases = pgTable(
  "payment_chases",
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
    contactId: uuid("contact_id").references(() => customerContacts.id, { onDelete: "set null" }),
    level: integer("level").notNull(), // 1..4 escalation level applied
    method: text("method").notNull().default("whatsapp"), // whatsapp | email | manual
    language: text("language").notNull().default("en"), // en | ar
    messageText: text("message_text").notNull(),
    daysOverdueAtSend: integer("days_overdue_at_send").notNull().default(0),
    amountAtSend: money("amount_at_send").notNull().default(0),
    // pending = queued / draft, sent = wa.me link generated, responded = client
    // replied, paid = invoice was paid after this chase, failed = send failed.
    status: text("status").notNull().default("sent"),
    sentAt: timestamp("sent_at").defaultNow().notNull(),
    respondedAt: timestamp("responded_at"),
    paidAt: timestamp("paid_at"),
    triggeredBy: uuid("triggered_by").references(() => users.id, { onDelete: "set null" }),
    // Free-form metadata for future webhook integrations (Business API IDs etc.)
    meta: text("meta"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    companyIdx: index("idx_payment_chases_company_id").on(table.companyId),
    invoiceIdx: index("idx_payment_chases_invoice_id").on(table.invoiceId),
    sentAtIdx: index("idx_payment_chases_sent_at").on(table.sentAt),
  })
);

export const insertPaymentChaseSchema = createInsertSchema(paymentChases).omit({
  id: true,
  createdAt: true,
});

export type InsertPaymentChase = z.infer<typeof insertPaymentChaseSchema>;
export type PaymentChase = typeof paymentChases.$inferSelect;

// Customizable chase message templates per company / level / language. There
// is exactly one "default" template per (level, language) seeded by the
// migration; companies can override or add custom templates.
export const chaseTemplates = pgTable(
  "chase_templates",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    companyId: uuid("company_id").references(() => companies.id, { onDelete: "cascade" }), // null = system default
    level: integer("level").notNull(), // 1..4
    language: text("language").notNull().default("en"), // en | ar
    subject: text("subject"),
    body: text("body").notNull(),
    isDefault: boolean("is_default").notNull().default(false),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at"),
  },
  (table) => ({
    companyLevelLangIdx: index("idx_chase_templates_lookup").on(
      table.companyId,
      table.level,
      table.language
    ),
  })
);

export const insertChaseTemplateSchema = createInsertSchema(chaseTemplates).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertChaseTemplate = z.infer<typeof insertChaseTemplateSchema>;
export type ChaseTemplate = typeof chaseTemplates.$inferSelect;

// Per-company configuration. One row per company; absence means defaults.
export const chaseConfigs = pgTable("chase_configs", {
  id: uuid("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  companyId: uuid("company_id")
    .notNull()
    .unique()
    .references(() => companies.id, { onDelete: "cascade" }),
  autoChaseEnabled: boolean("auto_chase_enabled").notNull().default(false),
  // Minimum days between chases for the same invoice — prevents spamming
  // when overdue lingers across multiple polling cycles.
  chaseFrequencyDays: integer("chase_frequency_days").notNull().default(7),
  maxLevel: integer("max_level").notNull().default(4),
  preferredMethod: text("preferred_method").notNull().default("whatsapp"), // whatsapp | email
  // JSON-encoded array of customer_contacts.id values that must never be
  // chased. Stored as text to avoid pulling in jsonb tooling here; routes
  // parse / serialize on the way in/out.
  doNotChaseContactIds: text("do_not_chase_contact_ids").notNull().default("[]"),
  defaultLanguage: text("default_language").notNull().default("en"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at"),
});

export const insertChaseConfigSchema = createInsertSchema(chaseConfigs).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertChaseConfig = z.infer<typeof insertChaseConfigSchema>;
export type ChaseConfig = typeof chaseConfigs.$inferSelect;

// ===========================
// Phase 5: Document Chasing Autopilot
// ===========================
//
// Document requirements describe what a client must supply for bookkeeping
// and UAE compliance (trade licence renewals, Emirates IDs, bank statements,
// tenancy contracts, visa copies, etc.). The chase pipeline escalates a
// missing document through four levels (friendly → follow_up → urgent →
// final), mirroring the Phase 4 payment-chasing model. The compliance
// calendar is the source of truth for upcoming UAE deadlines that drive
// auto-scheduled reminders.

// UAE-specific document types — kept as a const tuple so the Zod enum below
// stays in lockstep. Free-form types are stored under "other".
export const DOCUMENT_TYPES = [
  "trade_license",
  "emirates_id",
  "visa_copy",
  "passport_copy",
  "bank_statement",
  "tenancy_contract",
  "moa_aoa",
  "vat_certificate",
  "corporate_tax_certificate",
  "esr_notification",
  "esr_report",
  "audited_financials",
  "invoice",
  "receipt",
  "payslip",
  "other",
] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

export const CHASE_LEVELS = ["friendly", "follow_up", "urgent", "final"] as const;
export type ChaseLevel = (typeof CHASE_LEVELS)[number];

export const CHASE_CHANNELS = ["whatsapp", "email", "sms", "in_app"] as const;
export type ChaseChannel = (typeof CHASE_CHANNELS)[number];

export const REQUIREMENT_STATUSES = [
  "pending",
  "requested",
  "received",
  "overdue",
  "waived",
] as const;
export type RequirementStatus = (typeof REQUIREMENT_STATUSES)[number];

export const COMPLIANCE_EVENT_TYPES = [
  "trade_license_renewal",
  "visa_expiry",
  "emirates_id_expiry",
  "vat_filing",
  "corporate_tax_filing",
  "esr_notification",
  "esr_report",
  "tenancy_renewal",
  "audit_deadline",
  "other",
] as const;
export type ComplianceEventType = (typeof COMPLIANCE_EVENT_TYPES)[number];

// Document requirements: what a client owes the firm per period.
export const documentRequirements = pgTable(
  "document_requirements",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    documentType: text("document_type").notNull(), // DocumentType
    description: text("description"),
    dueDate: timestamp("due_date").notNull(),
    isRecurring: boolean("is_recurring").notNull().default(false),
    recurringIntervalDays: integer("recurring_interval_days"), // null when isRecurring is false
    status: text("status").notNull().default("pending"), // RequirementStatus
    receivedAt: timestamp("received_at"),
    uploadedDocumentId: uuid("uploaded_document_id"), // optional pointer to a document store row
    notes: text("notes"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    companyIdIdx: index("idx_document_requirements_company_id").on(table.companyId),
    dueDateIdx: index("idx_document_requirements_due_date").on(table.dueDate),
    statusIdx: index("idx_document_requirements_status").on(table.status),
  })
);

export const insertDocumentRequirementSchema = createInsertSchema(documentRequirements).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export const updateDocumentRequirementSchema = insertDocumentRequirementSchema.partial();

export type InsertDocumentRequirement = z.infer<typeof insertDocumentRequirementSchema>;
export type UpdateDocumentRequirement = z.infer<typeof updateDocumentRequirementSchema>;
export type DocumentRequirement = typeof documentRequirements.$inferSelect;

// Document chases: one row per send. Level escalates as the same requirement
// stays open across multiple sends.
export const documentChases = pgTable(
  "document_chases",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    requirementId: uuid("requirement_id")
      .notNull()
      .references(() => documentRequirements.id, { onDelete: "cascade" }),
    chaseLevel: text("chase_level").notNull(), // ChaseLevel
    sentVia: text("sent_via").notNull(), // ChaseChannel
    sentAt: timestamp("sent_at").defaultNow().notNull(),
    messageContent: text("message_content").notNull(),
    recipientPhone: text("recipient_phone"),
    recipientEmail: text("recipient_email"),
    responseReceived: boolean("response_received").notNull().default(false),
    responseReceivedAt: timestamp("response_received_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    companyIdIdx: index("idx_document_chases_company_id").on(table.companyId),
    requirementIdIdx: index("idx_document_chases_requirement_id").on(table.requirementId),
    sentAtIdx: index("idx_document_chases_sent_at").on(table.sentAt),
  })
);

export const insertDocumentChaseSchema = createInsertSchema(documentChases).omit({
  id: true,
  createdAt: true,
});

export type InsertDocumentChase = z.infer<typeof insertDocumentChaseSchema>;
export type DocumentChase = typeof documentChases.$inferSelect;

// Compliance calendar: UAE-specific events that drive document requirements
// and chase scheduling. Reminder days is stored as a comma-separated list of
// day offsets ("30,14,7,0") for portability across Postgres versions.
export const complianceCalendar = pgTable(
  "compliance_calendar",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    eventType: text("event_type").notNull(), // ComplianceEventType
    description: text("description").notNull(),
    eventDate: timestamp("event_date").notNull(),
    reminderDays: text("reminder_days").notNull().default("30,14,7,0"),
    status: text("status").notNull().default("upcoming"), // upcoming | completed | overdue | dismissed
    completedAt: timestamp("completed_at"),
    linkedRequirementId: uuid("linked_requirement_id"), // optional link back to a requirement
    // W4-A (migration 0100): generated obligations. `obligationKey` is unique
    // per company (e.g. "vat:2026-03-31"); status of VAT/CT rows derives from
    // the actual return state.
    source: text("source").notNull().default("manual"), // manual | generated
    obligationKey: text("obligation_key"),
    obligationType: text("obligation_type"),
    titleAr: text("title_ar"),
    periodStart: pgDate("period_start", { mode: "string" }),
    periodEnd: pgDate("period_end", { mode: "string" }),
    relatedEntityId: uuid("related_entity_id"),
    legalSource: text("legal_source"),
    remindersSent: text("reminders_sent").notNull().default(""),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    companyIdIdx: index("idx_compliance_calendar_company_id").on(table.companyId),
    eventDateIdx: index("idx_compliance_calendar_event_date").on(table.eventDate),
  })
);

export const insertComplianceCalendarSchema = createInsertSchema(complianceCalendar).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export const updateComplianceCalendarSchema = insertComplianceCalendarSchema.partial();

export type InsertComplianceEvent = z.infer<typeof insertComplianceCalendarSchema>;
export type UpdateComplianceEvent = z.infer<typeof updateComplianceCalendarSchema>;
export type ComplianceEvent = typeof complianceCalendar.$inferSelect;

// ===========================
// Firm Alerts (Phase 6: Command Center)
// ===========================
// Surfaces critical items across all firm-managed clients (FTA deadlines, stale
// activity, large overdue balances, incomplete onboarding, etc.).
// firmId = user.id of the firm_owner. companyId is nullable for firm-wide alerts.
export const firmAlerts = pgTable(
  "firm_alerts",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    firmId: uuid("firm_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    companyId: uuid("company_id").references(() => companies.id, { onDelete: "cascade" }),
    alertType: text("alert_type").notNull(), // vat_deadline | stale_activity | overdue_balance | incomplete_onboarding | document_missing
    severity: text("severity").notNull().default("info"), // critical | warning | info
    message: text("message").notNull(),
    metadata: text("metadata"), // optional JSON-encoded extras (amounts, dueDate, etc.)
    isRead: boolean("is_read").notNull().default(false),
    resolvedAt: timestamp("resolved_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    firmIdIdx: index("idx_firm_alerts_firm_id").on(table.firmId),
    companyIdIdx: index("idx_firm_alerts_company_id").on(table.companyId),
    severityIdx: index("idx_firm_alerts_severity").on(table.severity),
    unreadIdx: index("idx_firm_alerts_unread").on(table.firmId, table.isRead),
  })
);

export const insertFirmAlertSchema = createInsertSchema(firmAlerts).omit({
  id: true,
  createdAt: true,
});

export type InsertFirmAlert = z.infer<typeof insertFirmAlertSchema>;
export type FirmAlert = typeof firmAlerts.$inferSelect;
export type FirmAlertSeverity = "critical" | "warning" | "info";
export type FirmAlertType =
  | "vat_deadline"
  | "stale_activity"
  | "overdue_balance"
  | "incomplete_onboarding"
  | "document_missing";

// ===========================
// Firm Metrics Cache (Phase 6: Command Center)
// ===========================
// Caches expensive firm-wide aggregations so dashboards don't recompute on every
// page load. metricValue is a JSON-encoded payload (numbers or full objects).
// Caller is responsible for invalidating entries past their TTL.
export const firmMetricsCache = pgTable(
  "firm_metrics_cache",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    firmId: uuid("firm_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    metricType: text("metric_type").notNull(), // dashboard_summary | period_comparison | health_scores | staff_workload
    metricValue: text("metric_value").notNull(), // JSON payload
    periodStart: timestamp("period_start"),
    periodEnd: timestamp("period_end"),
    calculatedAt: timestamp("calculated_at").defaultNow().notNull(),
  },
  (table) => ({
    firmTypeIdx: index("idx_firm_metrics_cache_firm_type").on(table.firmId, table.metricType),
    // One row per (firm, type, period) so we can update-on-conflict.
    firmTypePeriodUnique: unique("firm_metrics_cache_firm_type_period_unique").on(
      table.firmId,
      table.metricType,
      table.periodStart,
      table.periodEnd
    ),
  })
);

export const insertFirmMetricsCacheSchema = createInsertSchema(firmMetricsCache).omit({
  id: true,
  calculatedAt: true,
});

export type InsertFirmMetricsCache = z.infer<typeof insertFirmMetricsCacheSchema>;
export type FirmMetricsCache = typeof firmMetricsCache.$inferSelect;

// ===========================
// Email document intake (firm-internal pilot) — see docs/EMAIL_INTAKE_PILOT.md
// ===========================

// The sender→company link: "link a certain email to a certain customer". Only
// active sources are routed; unknown senders are ignored (never auto-created).
export const clientEmailSources = pgTable(
  "client_email_sources",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    // firm_owner user.id that owns this mapping (mirrors firm_alerts.firm_id).
    firmId: uuid("firm_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    senderEmail: text("sender_email").notNull(), // stored normalised (lowercased)
    label: text("label"),
    status: text("status").notNull().default("active"), // active | paused
    requireDkimPass: boolean("require_dkim_pass").notNull().default(true),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    companyIdx: index("idx_client_email_sources_company").on(table.companyId),
    firmIdx: index("idx_client_email_sources_firm").on(table.firmId),
    // One sender address maps to at most one company per firm.
    firmSenderUq: unique("uq_client_email_sources_firm_sender").on(table.firmId, table.senderEmail),
  })
);

export const insertClientEmailSourceSchema = createInsertSchema(clientEmailSources).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertClientEmailSource = z.infer<typeof insertClientEmailSourceSchema>;
export type ClientEmailSource = typeof clientEmailSources.$inferSelect;

// One row per ingested email; idempotent on provider_message_id.
export const emailIntakeMessages = pgTable(
  "email_intake_messages",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    sourceId: uuid("source_id")
      .notNull()
      .references(() => clientEmailSources.id, { onDelete: "cascade" }),
    providerMessageId: text("provider_message_id").notNull(),
    fromEmail: text("from_email").notNull(),
    subject: text("subject"),
    receivedAt: timestamp("received_at").notNull(),
    attachmentCount: integer("attachment_count").notNull().default(0),
    // received | processing | partially_processed | done | ignored | error
    status: text("status").notNull().default("received"),
    error: text("error"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    companyIdx: index("idx_email_intake_messages_company").on(table.companyId),
    providerMsgUq: unique("uq_email_intake_messages_provider_msg").on(table.providerMessageId),
  })
);

export const insertEmailIntakeMessageSchema = createInsertSchema(emailIntakeMessages).omit({
  id: true,
  createdAt: true,
});
export type InsertEmailIntakeMessage = z.infer<typeof insertEmailIntakeMessageSchema>;
export type EmailIntakeMessage = typeof emailIntakeMessages.$inferSelect;

// One row per attachment; links to the receipt it produced. sha256 is the dedup
// key (unique per company).
export const emailIntakeDocuments = pgTable(
  "email_intake_documents",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    messageId: uuid("message_id")
      .notNull()
      .references(() => emailIntakeMessages.id, { onDelete: "cascade" }),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    filename: text("filename"),
    mimeType: text("mime_type"),
    byteSize: integer("byte_size"),
    storagePath: text("storage_path"),
    sha256: text("sha256").notNull(),
    docKind: text("doc_kind").notNull().default("unknown"), // invoice|receipt|statement|unknown
    ocrStatus: text("ocr_status").notNull().default("pending"), // pending|processed|skipped|error
    receiptId: uuid("receipt_id").references(() => receipts.id, { onDelete: "set null" }),
    isDuplicate: boolean("is_duplicate").notNull().default(false),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    messageIdx: index("idx_email_intake_documents_message").on(table.messageId),
    companyIdx: index("idx_email_intake_documents_company").on(table.companyId),
    // Dedup: a content hash is unique within a company.
    companyHashUq: unique("uq_email_intake_documents_company_hash").on(
      table.companyId,
      table.sha256
    ),
  })
);

export const insertEmailIntakeDocumentSchema = createInsertSchema(emailIntakeDocuments).omit({
  id: true,
  createdAt: true,
});
export type InsertEmailIntakeDocument = z.infer<typeof insertEmailIntakeDocumentSchema>;
export type EmailIntakeDocument = typeof emailIntakeDocuments.$inferSelect;
