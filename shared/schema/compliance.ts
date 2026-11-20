// Audit logs, document vault, tax archive, compliance tasks, messages, invitations.
// Part of the shared/schema.ts barrel (R20-09); import from "@shared/schema".

import {
  boolean,
  customType,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type { z } from "zod";
import { sql } from "drizzle-orm";
import { createInsertSchema, money } from "./columns";
import { users } from "./users";
import { companies } from "./companies";
import { customerContacts } from "./contacts";
import { vatReturns } from "./vat";

// ===========================
// System Audit Logs
// ===========================
// bigint chain sequence read as a JS number (chains stay far below 2^53).
const auditSeq = customType<{ data: number; driverData: string | number }>({
  dataType: () => "bigint",
  fromDriver: (value) => Number(value),
});

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: uuid("user_id").references(() => users.id),
    action: text("action").notNull(), // create | update | delete | login | logout | admin_action
    resourceType: text("resource_type").notNull(), // user | company | invoice | receipt | setting | subscription
    resourceId: text("resource_id"),
    details: text("details"), // JSON with change details
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    // W5-E (0109): tamper-evident chain, one per company ("global" when no company).
    // chainKey/seq/prevHash/hash/legacy are set by the audit_logs_chain_insert trigger
    // inside the inserting transaction; never write them from application code.
    companyId: uuid("company_id"),
    chainKey: text("chain_key"),
    seq: auditSeq("seq"),
    prevHash: text("prev_hash"),
    hash: text("hash"),
    legacy: boolean("legacy").notNull().default(false),
  },
  (table) => ({
    userIdIdx: index("idx_audit_logs_user_id").on(table.userId),
    resourceIdx: index("idx_audit_logs_resource").on(table.resourceType, table.resourceId),
    createdAtIdx: index("idx_audit_logs_created_at").on(table.createdAt),
    companyCreatedIdx: index("idx_audit_logs_company_created").on(table.companyId, table.createdAt),
    chainSeqIdx: uniqueIndex("uniq_audit_logs_chain_seq").on(table.chainKey, table.seq),
  })
);

export const insertAuditLogSchema = createInsertSchema(auditLogs).omit({
  id: true,
  createdAt: true,
  chainKey: true,
  seq: true,
  prevHash: true,
  hash: true,
  legacy: true,
});

export type InsertAuditLog = z.infer<typeof insertAuditLogSchema>;
export type AuditLog = typeof auditLogs.$inferSelect;

// W5-E (0109): ten single-use MFA recovery codes per user, stored as SHA-256 digests.
export const userMfaRecoveryCodes = pgTable(
  "user_mfa_recovery_codes",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    codeHash: text("code_hash").notNull(),
    usedAt: timestamp("used_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    userIdx: index("idx_user_mfa_recovery_codes_user").on(table.userId),
    hashUnique: uniqueIndex("uniq_user_mfa_recovery_codes_hash").on(table.userId, table.codeHash),
  })
);
export type UserMfaRecoveryCode = typeof userMfaRecoveryCodes.$inferSelect;

// W5-E (0109): per-company security policy (MFA requirement by role).
export const COMPANY_MFA_POLICIES = ["none", "owners_admins", "all"] as const;
export type CompanyMfaPolicy = (typeof COMPANY_MFA_POLICIES)[number];
export const companySecurityPolicies = pgTable("company_security_policies", {
  companyId: uuid("company_id")
    .primaryKey()
    .references(() => companies.id, { onDelete: "cascade" }),
  requireMfa: text("require_mfa").$type<CompanyMfaPolicy>().notNull().default("none"),
  updatedBy: uuid("updated_by"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
export type CompanySecurityPolicy = typeof companySecurityPolicies.$inferSelect;

// ===========================
// Document Vault (Trade licenses, contracts, tax certificates with expiry tracking)
// ===========================
export const documents = pgTable(
  "documents",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    nameAr: text("name_ar"),
    category: text("category").notNull(), // trade_license | contract | tax_certificate | audit_report | bank_statement | insurance | visa | other
    description: text("description"),
    fileUrl: text("file_url").notNull(),
    fileName: text("file_name").notNull(),
    fileSize: integer("file_size"),
    mimeType: text("mime_type"),
    expiryDate: timestamp("expiry_date"), // For licenses, certificates that expire
    reminderDays: integer("reminder_days").default(30), // Days before expiry to send reminder
    reminderSent: boolean("reminder_sent").default(false),
    tags: text("tags"), // JSON array of tags for search
    isArchived: boolean("is_archived").default(false),
    uploadedBy: uuid("uploaded_by").references(() => users.id),
    // W4-D (0103, R16-09): bytes live in file storage under storage_key (never a client URL);
    // every upload is a numbered row in document_file_versions; delete is soft.
    storageKey: text("storage_key"),
    sha256: text("sha256"),
    currentVersion: integer("current_version").notNull().default(1),
    deletedAt: timestamp("deleted_at"),
    deletedBy: uuid("deleted_by"),
    contactId: uuid("contact_id").references(() => customerContacts.id, { onDelete: "set null" }),
    source: text("source").notNull().default("staff"), // staff | customer_portal | external_link
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    companyIdIdx: index("idx_documents_company_id").on(table.companyId),
  })
);

export const documentFileVersions = pgTable(
  "document_file_versions",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    storageKey: text("storage_key").notNull(),
    fileName: text("file_name").notNull(),
    mimeType: text("mime_type").notNull(),
    fileSize: integer("file_size").notNull(),
    sha256: text("sha256").notNull(),
    note: text("note"),
    uploadedBy: uuid("uploaded_by"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    versionUnique: unique("uq_document_file_versions").on(table.documentId, table.version),
  })
);
export type DocumentFileVersion = typeof documentFileVersions.$inferSelect;

export const insertDocumentSchema = createInsertSchema(documents).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertDocument = z.infer<typeof insertDocumentSchema>;
export type Document = typeof documents.$inferSelect;

// ===========================
// Tax Return Archive (Historical filed returns with PDF storage)
// ===========================
export const taxReturnArchive = pgTable(
  "tax_return_archive",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    returnType: text("return_type").notNull(), // vat | corporate_tax | excise_tax
    periodLabel: text("period_label").notNull(), // e.g., "Q1 2025", "FY2024"
    periodStart: timestamp("period_start").notNull(),
    periodEnd: timestamp("period_end").notNull(),
    filingDate: timestamp("filing_date").notNull(),
    ftaReferenceNumber: text("fta_reference_number"),
    taxAmount: money("tax_amount").default(0),
    paymentStatus: text("payment_status").default("paid"), // paid | partial | unpaid
    fileUrl: text("file_url"), // PDF of filed return
    fileName: text("file_name"),
    notes: text("notes"),
    filedBy: uuid("filed_by").references(() => users.id),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    companyIdIdx: index("idx_tax_return_archive_company_id").on(table.companyId),
  })
);

export const insertTaxReturnArchiveSchema = createInsertSchema(taxReturnArchive).omit({
  id: true,
  createdAt: true,
});

export type InsertTaxReturnArchive = z.infer<typeof insertTaxReturnArchiveSchema>;
export type TaxReturnArchive = typeof taxReturnArchive.$inferSelect;

// ===========================
// Compliance Tasks & Reminders
// ===========================
export const complianceTasks = pgTable(
  "compliance_tasks",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    titleAr: text("title_ar"),
    description: text("description"),
    category: text("category").notNull(), // vat_filing | corporate_tax | document_upload | payment | review | other
    priority: text("priority").default("medium"), // low | medium | high | urgent
    status: text("status").default("pending"), // pending | in_progress | completed | overdue | cancelled
    dueDate: timestamp("due_date").notNull(),
    reminderDate: timestamp("reminder_date"),
    reminderSent: boolean("reminder_sent").default(false),
    isRecurring: boolean("is_recurring").default(false),
    recurrencePattern: text("recurrence_pattern"), // monthly | quarterly | yearly
    completedAt: timestamp("completed_at"),
    completedBy: uuid("completed_by").references(() => users.id),
    assignedTo: uuid("assigned_to").references(() => users.id),
    createdBy: uuid("created_by").references(() => users.id),
    relatedDocumentId: uuid("related_document_id").references(() => documents.id),
    relatedVatReturnId: uuid("related_vat_return_id").references(() => vatReturns.id),
    notes: text("notes"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    companyIdIdx: index("idx_compliance_tasks_company_id").on(table.companyId),
    companyStatusDueIdx: index("idx_compliance_tasks_company_status_due").on(
      table.companyId,
      table.status,
      table.dueDate
    ),
  })
);

export const insertComplianceTaskSchema = createInsertSchema(complianceTasks).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertComplianceTask = z.infer<typeof insertComplianceTaskSchema>;
export type ComplianceTask = typeof complianceTasks.$inferSelect;

// ===========================
// Secure Messages (Client-Accountant Communication)
// ===========================
export const messages = pgTable(
  "messages",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    threadId: uuid("thread_id"), // For grouping related messages
    subject: text("subject"),
    content: text("content").notNull(),
    senderId: uuid("sender_id")
      .notNull()
      .references(() => users.id),
    recipientId: uuid("recipient_id").references(() => users.id), // null = broadcast to all company users
    isRead: boolean("is_read").default(false),
    readAt: timestamp("read_at"),
    attachmentUrl: text("attachment_url"),
    attachmentName: text("attachment_name"),
    messageType: text("message_type").default("general"), // general | inquiry | update | urgent | system
    isArchived: boolean("is_archived").default(false),
    // W4-D (0103, R16-05): a thread with a contact is customer-visible; everything else is an
    // internal staff thread that portal users never see.
    contactId: uuid("contact_id").references(() => customerContacts.id, { onDelete: "set null" }),
    visibility: text("visibility").notNull().default("internal"), // internal | customer
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    companyIdIdx: index("idx_messages_company_id").on(table.companyId),
    threadIdx: index("idx_messages_thread_id").on(table.threadId),
  })
);

export const insertMessageSchema = createInsertSchema(messages).omit({
  id: true,
  createdAt: true,
});

export type InsertMessage = z.infer<typeof insertMessageSchema>;
export type Message = typeof messages.$inferSelect;

// ===========================
// UAE Tax News Feed Items
// ===========================
export const newsItems = pgTable("news_items", {
  id: uuid("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  title: text("title").notNull(),
  titleAr: text("title_ar"),
  summary: text("summary"),
  summaryAr: text("summary_ar"),
  content: text("content"),
  contentAr: text("content_ar"),
  source: text("source").notNull(), // fta | gulf_news | khaleej_times | other
  sourceUrl: text("source_url"),
  category: text("category").notNull(), // vat | corporate_tax | regulation | economy | general
  imageUrl: text("image_url"),
  publishedAt: timestamp("published_at").notNull(),
  isActive: boolean("is_active").default(true),
  externalId: text("external_id"), // W3-E: feed item guid, unique per source
  curatedBy: uuid("curated_by"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertNewsItemSchema = createInsertSchema(newsItems).omit({
  id: true,
  createdAt: true,
});

export type InsertNewsItem = z.infer<typeof insertNewsItemSchema>;
export type NewsItem = typeof newsItems.$inferSelect;

// ===========================
// User Invitations (Admin invites clients)
// ===========================
export const invitations = pgTable(
  "invitations",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    email: text("email").notNull(),
    companyId: uuid("company_id").references(() => companies.id, { onDelete: "cascade" }),
    role: text("role").notNull().default("client"), // client | staff
    userType: text("user_type").notNull().default("client"), // admin | client | customer
    token: text("token").notNull().unique(), // Hashed invitation token
    invitedBy: uuid("invited_by")
      .notNull()
      .references(() => users.id),
    status: text("status").notNull().default("pending"), // pending | accepted | expired | revoked
    expiresAt: timestamp("expires_at").notNull(),
    acceptedAt: timestamp("accepted_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    companyIdIdx: index("idx_invitations_company_id").on(table.companyId),
  })
);

export const insertInvitationSchema = createInsertSchema(invitations).omit({
  id: true,
  createdAt: true,
});

export type InsertInvitation = z.infer<typeof insertInvitationSchema>;
export type Invitation = typeof invitations.$inferSelect;

// ===========================
// Company team invitations (W2-C, 0092)
// ===========================
// An owner/admin invites a person into ONE company with a company role. Only
// the SHA-256 of the token is stored; the raw token lives in the emailed link
// (or is shown to the inviter when no email provider is configured).
// Accepting attaches an existing account or creates one with the invitee's
// own password, so no placeholder users are created.
export const companyInvitations = pgTable(
  "company_invitations",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    role: text("role").notNull().default("employee"),
    tokenHash: text("token_hash").notNull().unique(),
    invitedBy: uuid("invited_by").references(() => users.id, { onDelete: "set null" }),
    status: text("status").notNull().default("pending"), // pending | accepted | revoked | expired
    expiresAt: timestamp("expires_at").notNull(),
    acceptedAt: timestamp("accepted_at"),
    acceptedUserId: uuid("accepted_user_id").references(() => users.id, { onDelete: "set null" }),
    revokedAt: timestamp("revoked_at"),
    lastSentAt: timestamp("last_sent_at"),
    sendCount: integer("send_count").notNull().default(0),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    companyStatusIdx: index("idx_company_invitations_company").on(table.companyId, table.status),
  })
);

export type CompanyInvitation = typeof companyInvitations.$inferSelect;
export type InsertCompanyInvitation = typeof companyInvitations.$inferInsert;
