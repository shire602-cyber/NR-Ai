// Firm staff assignments and firms (W5-D multi-firm tenancy).
// Part of the shared/schema.ts barrel (R20-09); import from "@shared/schema".

import {
  boolean,
  index,
  integer,
  jsonb,
  date as pgDate,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "./columns";
import type { z } from "zod";
import { sql } from "drizzle-orm";
import { users } from "./users";
import { companies } from "./companies";
import { companyUsers } from "./company-users";

// ===========================
// Firm Staff Assignments
// ===========================
// Links firm_admin users to specific client companies they can manage.
// firm_owner bypasses this table and sees all companies.
export const firmStaffAssignments = pgTable(
  "firm_staff_assignments",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    // Role this staff member plays for the assigned client (e.g. accountant | reviewer | manager).
    // Phase 6 added this column so workload analytics can group by responsibility, not just assignment.
    role: text("role").notNull().default("accountant"),
    assignedAt: timestamp("assigned_at").defaultNow().notNull(),
  },
  (table) => ({
    userCompanyUnique: unique().on(table.userId, table.companyId),
    userIdIdx: index("idx_firm_staff_assignments_user_id").on(table.userId),
    companyIdIdx: index("idx_firm_staff_assignments_company_id").on(table.companyId),
  })
);

export const insertFirmStaffAssignmentSchema = createInsertSchema(firmStaffAssignments).omit({
  id: true,
  assignedAt: true,
});

export type InsertFirmStaffAssignment = z.infer<typeof insertFirmStaffAssignmentSchema>;
export type FirmStaffAssignment = typeof firmStaffAssignments.$inferSelect;

// ===========================
// Firms (W5-D multi-firm tenancy, migration 0108)
// ===========================
// NR is seeded as the first firm (is_nr = true, NR_FIRM_ID). Other accounting
// firms apply through POST /api/firms/apply and are approved by a platform admin.
export const firms = pgTable("firms", {
  id: uuid("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  slug: text("slug").notNull(),
  isNr: boolean("is_nr").notNull().default(false),
  status: text("status").notNull().default("pending"), // pending | active | rejected | suspended
  trn: text("trn"),
  contactEmail: text("contact_email"),
  contactPhone: text("contact_phone"),
  country: text("country").notNull().default("AE"),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  approvedBy: uuid("approved_by").references(() => users.id, { onDelete: "set null" }),
  approvedAt: timestamp("approved_at"),
  rejectionReason: text("rejection_reason"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
export type Firm = typeof firms.$inferSelect;

/** One firm per user; role is one of shared/access.ts FIRM_ROLES. */
export const firmMembers = pgTable(
  "firm_members",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    firmId: uuid("firm_id")
      .notNull()
      .references(() => firms.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    invitedBy: uuid("invited_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    userUnique: uniqueIndex("uniq_firm_members_user").on(table.userId),
    firmIdx: index("idx_firm_members_firm").on(table.firmId),
  })
);
export type FirmMember = typeof firmMembers.$inferSelect;

/** Which firm manages which company; the client owner accepts and can revoke. */
export const firmClientLinks = pgTable(
  "firm_client_links",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    firmId: uuid("firm_id")
      .notNull()
      .references(() => firms.id, { onDelete: "cascade" }),
    companyId: uuid("company_id").references(() => companies.id, { onDelete: "cascade" }),
    inviteeEmail: text("invitee_email"),
    status: text("status").notNull().default("invited"), // invited | active | revoked | declined
    permissions: jsonb("permissions")
      .notNull()
      .default(sql`'{}'::jsonb`),
    message: text("message"),
    invitedBy: uuid("invited_by").references(() => users.id, { onDelete: "set null" }),
    invitedAt: timestamp("invited_at").defaultNow().notNull(),
    acceptedBy: uuid("accepted_by").references(() => users.id, { onDelete: "set null" }),
    acceptedAt: timestamp("accepted_at"),
    revokedBy: uuid("revoked_by").references(() => users.id, { onDelete: "set null" }),
    revokedAt: timestamp("revoked_at"),
    revokeReason: text("revoke_reason"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    firmIdx: index("idx_firm_client_links_firm").on(table.firmId, table.status),
    companyIdx: index("idx_firm_client_links_company").on(table.companyId),
  })
);
export type FirmClientLink = typeof firmClientLinks.$inferSelect;

/** company_users rows a firm created for its staff; removed when the link ends. */
export const firmCompanyGrants = pgTable(
  "firm_company_grants",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    firmId: uuid("firm_id")
      .notNull()
      .references(() => firms.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    // Retained for databases that recorded a grant before membership IDs were available.
    createdMembership: boolean("created_membership").notNull().default(true),
    membershipId: uuid("membership_id").references(() => companyUsers.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    membershipIdx: index("idx_firm_company_grants_membership").on(table.membershipId),
    grantUnique: uniqueIndex("uniq_firm_company_grants").on(
      table.firmId,
      table.userId,
      table.companyId
    ),
  })
);

export const firmTaskTemplates = pgTable(
  "firm_task_templates",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    firmId: uuid("firm_id")
      .notNull()
      .references(() => firms.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    title: text("title").notNull(),
    titleAr: text("title_ar"),
    cadence: text("cadence").notNull(), // monthly | quarterly | annual | vat_period
    dueDaysAfterPeriod: integer("due_days_after_period").notNull().default(28),
    appliesTo: text("applies_to").notNull().default("all"), // all | vat_registered | ct_registered | payroll
    isActive: boolean("is_active").notNull().default(true),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    codeUnique: uniqueIndex("uniq_firm_task_templates_code").on(table.firmId, table.code),
  })
);
export type FirmTaskTemplate = typeof firmTaskTemplates.$inferSelect;

export const firmTasks = pgTable(
  "firm_tasks",
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
    templateId: uuid("template_id").references(() => firmTaskTemplates.id, {
      onDelete: "set null",
    }),
    title: text("title").notNull(),
    periodStart: pgDate("period_start", { mode: "string" }),
    periodEnd: pgDate("period_end", { mode: "string" }),
    dueDate: pgDate("due_date", { mode: "string" }).notNull(),
    status: text("status").notNull().default("open"), // open | in_progress | review | done | cancelled
    assigneeUserId: uuid("assignee_user_id").references(() => users.id, { onDelete: "set null" }),
    source: text("source").notNull().default("manual"), // manual | template | compliance
    sourceKey: text("source_key"),
    completedAt: timestamp("completed_at"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    firmDueIdx: index("idx_firm_tasks_firm_due").on(table.firmId, table.dueDate),
    companyIdx: index("idx_firm_tasks_company").on(table.companyId),
  })
);
export type FirmTask = typeof firmTasks.$inferSelect;

export const firmDocumentRequests = pgTable(
  "firm_document_requests",
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
    listName: text("list_name").notNull().default("General"),
    title: text("title").notNull(),
    description: text("description"),
    dueDate: pgDate("due_date", { mode: "string" }),
    status: text("status").notNull().default("requested"), // requested | uploaded | accepted | rejected | cancelled
    documentId: uuid("document_id"),
    requestedBy: uuid("requested_by").references(() => users.id, { onDelete: "set null" }),
    uploadedBy: uuid("uploaded_by").references(() => users.id, { onDelete: "set null" }),
    uploadedAt: timestamp("uploaded_at"),
    reviewedBy: uuid("reviewed_by").references(() => users.id, { onDelete: "set null" }),
    reviewedAt: timestamp("reviewed_at"),
    reviewNote: text("review_note"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    companyIdx: index("idx_firm_document_requests_company").on(table.companyId, table.status),
    firmIdx: index("idx_firm_document_requests_firm").on(table.firmId),
  })
);
export type FirmDocumentRequest = typeof firmDocumentRequests.$inferSelect;

export const firmEngagementTemplates = pgTable(
  "firm_engagement_templates",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    firmId: uuid("firm_id")
      .notNull()
      .references(() => firms.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    kind: text("kind").notNull().default("engagement"), // engagement | proposal
    body: text("body").notNull(),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    firmIdx: index("idx_firm_engagement_templates_firm").on(table.firmId),
  })
);
export type FirmEngagementTemplate = typeof firmEngagementTemplates.$inferSelect;
