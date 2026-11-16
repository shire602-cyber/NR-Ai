// Notifications, regulatory news, reminders and the email outbox (W4-D).
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
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "./columns";
import type { z } from "zod";
import { sql } from "drizzle-orm";
import { users } from "./users";
import { companies } from "./companies";

// ===========================
// Smart Reminders & Notifications
// ===========================
export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    companyId: uuid("company_id").references(() => companies.id, { onDelete: "cascade" }),
    type: text("type").notNull(), // deadline | payment_due | overdue | regulatory | system | referral | onboarding
    title: text("title").notNull(),
    message: text("message").notNull(),
    priority: text("priority").notNull().default("normal"), // low | normal | high | urgent
    relatedEntityType: text("related_entity_type"), // invoice | receipt | vat_return | company
    relatedEntityId: uuid("related_entity_id"),
    actionUrl: text("action_url"), // Deep link to relevant page
    isRead: boolean("is_read").notNull().default(false),
    readAt: timestamp("read_at"),
    isDismissed: boolean("is_dismissed").notNull().default(false),
    scheduledFor: timestamp("scheduled_for"), // For future notifications
    expiresAt: timestamp("expires_at"), // Auto-dismiss after this date
    // W4-D (0103): idempotency key for event-driven notifications (`<event>:<entity>`) and the
    // time the row was included in a daily digest email.
    eventKey: text("event_key"),
    digestedAt: timestamp("digested_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    eventKeyUnique: uniqueIndex("uq_notifications_event_key")
      .on(table.userId, table.eventKey)
      .where(sql`event_key IS NOT NULL`),
    userIdIdx: index("idx_notifications_user_id").on(table.userId),
    userUnreadIdx: index("idx_notifications_user_unread").on(table.userId, table.isRead),
    companyIdIdx: index("idx_notifications_company_id").on(table.companyId),
  })
);

export const insertNotificationSchema = createInsertSchema(notifications).omit({
  id: true,
  createdAt: true,
  readAt: true,
});

export type InsertNotification = z.infer<typeof insertNotificationSchema>;
export type Notification = typeof notifications.$inferSelect;

// ===========================
// Regulatory News Feed
// ===========================
export const regulatoryNews = pgTable("regulatory_news", {
  id: uuid("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  title: text("title").notNull(),
  titleAr: text("title_ar"), // Arabic translation
  summary: text("summary").notNull(),
  summaryAr: text("summary_ar"),
  content: text("content"),
  contentAr: text("content_ar"),
  category: text("category").notNull(), // vat | corporate_tax | customs | labor | general
  source: text("source"), // FTA, Ministry of Finance, etc.
  sourceUrl: text("source_url"),
  effectiveDate: timestamp("effective_date"),
  importance: text("importance").notNull().default("normal"), // low | normal | high | critical
  isActive: boolean("is_active").notNull().default(true),
  publishedAt: timestamp("published_at").defaultNow().notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertRegulatoryNewsSchema = createInsertSchema(regulatoryNews).omit({
  id: true,
  createdAt: true,
});

export type InsertRegulatoryNews = z.infer<typeof insertRegulatoryNewsSchema>;
export type RegulatoryNews = typeof regulatoryNews.$inferSelect;

// ===========================
// Reminder Settings (for automated reminders)
// ===========================
export const reminderSettings = pgTable(
  "reminder_settings",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    reminderType: text("reminder_type").notNull(), // invoice_overdue | invoice_due_soon | vat_deadline | payment_followup
    isEnabled: boolean("is_enabled").notNull().default(true),
    // Timing configuration
    daysBeforeDue: integer("days_before_due"), // Send X days before due date
    daysAfterDue: integer("days_after_due"), // Send X days after due date (for overdue)
    repeatIntervalDays: integer("repeat_interval_days"), // Repeat every X days
    maxReminders: integer("max_reminders").default(3), // Max number of reminders to send
    // Channel configuration
    sendEmail: boolean("send_email").notNull().default(true),
    sendSms: boolean("send_sms").notNull().default(false),
    sendInApp: boolean("send_in_app").notNull().default(true),
    sendWhatsapp: boolean("send_whatsapp").notNull().default(false),
    // Template customization
    emailSubject: text("email_subject"),
    emailTemplate: text("email_template"),
    smsTemplate: text("sms_template"),
    whatsappTemplate: text("whatsapp_template"),
    // W4-D (0103): customer email language (en | ar | bilingual), invoice PDF + pay link.
    language: text("language").notNull().default("bilingual"),
    attachPdf: boolean("attach_pdf").notNull().default(true),
    includePayLink: boolean("include_pay_link").notNull().default(true),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    companyIdIdx: index("idx_reminder_settings_company_id").on(table.companyId),
  })
);

export const insertReminderSettingSchema = createInsertSchema(reminderSettings).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertReminderSetting = z.infer<typeof insertReminderSettingSchema>;
export type ReminderSetting = typeof reminderSettings.$inferSelect;

// ===========================
// Reminder Logs (track sent reminders)
// ===========================
export const reminderLogs = pgTable(
  "reminder_logs",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    reminderSettingId: uuid("reminder_setting_id").references(() => reminderSettings.id),
    reminderType: text("reminder_type").notNull(),
    relatedEntityType: text("related_entity_type").notNull(), // invoice | vat_return
    relatedEntityId: uuid("related_entity_id").notNull(),
    recipientEmail: text("recipient_email"),
    recipientPhone: text("recipient_phone"),
    channel: text("channel").notNull(), // email | sms | in_app
    status: text("status").notNull().default("pending"), // pending | sent | failed | delivered | opened
    attemptNumber: integer("attempt_number").notNull().default(1),
    errorMessage: text("error_message"),
    sentAt: timestamp("sent_at"),
    deliveredAt: timestamp("delivered_at"),
    openedAt: timestamp("opened_at"),
    // W4-D (0103): dunning level (1..maxReminders), the outbox row that carries the email, and
    // the contact the reminder went to. (setting, invoice, channel, level) is unique.
    level: integer("level"),
    outboxId: uuid("outbox_id"),
    contactId: uuid("contact_id"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    dunningLevelUnique: uniqueIndex("uq_reminder_logs_dunning_level")
      .on(table.reminderSettingId, table.relatedEntityId, table.channel, table.level)
      .where(sql`reminder_setting_id IS NOT NULL AND level IS NOT NULL`),
    companyIdIdx: index("idx_reminder_logs_company_id").on(table.companyId),
    relatedEntityIdx: index("idx_reminder_logs_related_entity").on(
      table.relatedEntityType,
      table.relatedEntityId
    ),
  })
);

export const insertReminderLogSchema = createInsertSchema(reminderLogs).omit({
  id: true,
  createdAt: true,
});

export type InsertReminderLog = z.infer<typeof insertReminderLogSchema>;
export type ReminderLog = typeof reminderLogs.$inferSelect;

// ===========================
// W4-D (0103): durable email outbox (server/outbox)
// ===========================

/** bytea column carried as a Buffer. */
const w4dBytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return "bytea";
  },
});

export const EMAIL_OUTBOX_STATUSES = [
  "queued",
  "sending",
  "retrying",
  "sent",
  "delivered",
  "bounced",
  "complained",
  "dead",
  "blocked_no_provider",
  "cancelled",
] as const;
export type EmailOutboxStatus = (typeof EMAIL_OUTBOX_STATUSES)[number];

export const emailOutbox = pgTable(
  "email_outbox",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    companyId: uuid("company_id").references(() => companies.id, { onDelete: "set null" }),
    toAddress: text("to_address").notNull(),
    cc: text("cc"),
    replyTo: text("reply_to"),
    fromName: text("from_name"),
    subject: text("subject").notNull(),
    html: text("html"),
    textBody: text("text_body"),
    category: text("category").notNull().default("generic"),
    relatedEntityType: text("related_entity_type"),
    relatedEntityId: uuid("related_entity_id"),
    status: text("status").notNull().default("queued"),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(6),
    nextAttemptAt: timestamp("next_attempt_at").defaultNow().notNull(),
    lockedUntil: timestamp("locked_until"),
    lastError: text("last_error"),
    provider: text("provider"),
    providerMessageId: text("provider_message_id"),
    sensitive: boolean("sensitive").notNull().default(false),
    idempotencyKey: text("idempotency_key"),
    sentAt: timestamp("sent_at"),
    deliveredAt: timestamp("delivered_at"),
    bouncedAt: timestamp("bounced_at"),
    complainedAt: timestamp("complained_at"),
    deadAt: timestamp("dead_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    idempotencyUnique: uniqueIndex("uq_email_outbox_idempotency")
      .on(table.idempotencyKey)
      .where(sql`idempotency_key IS NOT NULL`),
    dueIdx: index("idx_email_outbox_due").on(table.status, table.nextAttemptAt),
    companyIdx: index("idx_email_outbox_company").on(table.companyId, table.createdAt),
  })
);
export type EmailOutboxRow = typeof emailOutbox.$inferSelect;

export const emailOutboxAttachments = pgTable(
  "email_outbox_attachments",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    outboxId: uuid("outbox_id")
      .notNull()
      .references(() => emailOutbox.id, { onDelete: "cascade" }),
    filename: text("filename").notNull(),
    contentType: text("content_type").notNull().default("application/octet-stream"),
    content: w4dBytea("content").notNull(),
    sizeBytes: integer("size_bytes").notNull().default(0),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    outboxIdx: index("idx_email_outbox_attachments_outbox").on(table.outboxId),
  })
);
export type EmailOutboxAttachment = typeof emailOutboxAttachments.$inferSelect;

export const emailDeliveryEvents = pgTable(
  "email_delivery_events",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    outboxId: uuid("outbox_id").references(() => emailOutbox.id, { onDelete: "cascade" }),
    provider: text("provider"),
    providerMessageId: text("provider_message_id"),
    eventType: text("event_type").notNull(),
    detail: text("detail"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    outboxIdx: index("idx_email_delivery_events_outbox").on(table.outboxId),
  })
);
export type EmailDeliveryEvent = typeof emailDeliveryEvents.$inferSelect;

// F8 (migration 0115): durable domain-event outbox. Rows are written inside the document
// transaction by server/platform/event-outbox.ts and delivered by job "events.outboxDispatch".
export const DOMAIN_EVENT_OUTBOX_STATUSES = [
  "pending",
  "dispatching",
  "dispatched",
  "dead",
] as const;
export type DomainEventOutboxStatus = (typeof DOMAIN_EVENT_OUTBOX_STATUSES)[number];

export const domainEventOutbox = pgTable(
  "domain_event_outbox",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    eventType: text("event_type").notNull(),
    companyId: uuid("company_id"),
    entityId: text("entity_id").notNull(),
    payload: jsonb("payload").notNull(),
    status: text("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(8),
    nextAttemptAt: timestamp("next_attempt_at").defaultNow().notNull(),
    lockedUntil: timestamp("locked_until"),
    lastError: text("last_error"),
    dispatchedAt: timestamp("dispatched_at"),
    deadAt: timestamp("dead_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    dueIdx: index("idx_domain_event_outbox_due").on(table.status, table.nextAttemptAt),
    companyIdx: index("idx_domain_event_outbox_company").on(table.companyId, table.createdAt),
  })
);
export type DomainEventOutboxRow = typeof domainEventOutbox.$inferSelect;

export const domainEventDeliveries = pgTable(
  "domain_event_deliveries",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    eventId: uuid("event_id")
      .notNull()
      .references(() => domainEventOutbox.id, { onDelete: "cascade" }),
    handler: text("handler").notNull(),
    deliveredAt: timestamp("delivered_at").defaultNow().notNull(),
  },
  (table) => ({
    eventHandlerUnique: uniqueIndex("uq_domain_event_deliveries_event_handler").on(
      table.eventId,
      table.handler
    ),
  })
);
