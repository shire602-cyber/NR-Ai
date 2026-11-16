// Company users.
// Part of the shared/schema.ts barrel (R20-09); import from "@shared/schema".

import { index, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import type { z } from "zod";
import { sql } from "drizzle-orm";
import { users } from "./users";
import { companies } from "./companies";

// ===========================
// Company Users (Many-to-Many)
// ===========================
export const companyUsers = pgTable(
  "company_users",
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
    // shared/permissions.ts COMPANY_ROLES; 0092 adds company_users_role_check.
    role: text("role").notNull().default("owner"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    companyUserUnique: unique("company_users_company_user_unique").on(
      table.companyId,
      table.userId
    ),
    companyIdIdx: index("idx_company_users_company_id").on(table.companyId),
    userIdIdx: index("idx_company_users_user_id").on(table.userId),
  })
);

export const insertCompanyUserSchema = createInsertSchema(companyUsers).omit({
  id: true,
  createdAt: true,
});

export type InsertCompanyUser = z.infer<typeof insertCompanyUserSchema>;
export type CompanyUser = typeof companyUsers.$inferSelect;
