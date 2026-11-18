// Customer contacts.
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
import { companies } from "./companies";

// ===========================
// Customer Contacts (for invoicing)
// ===========================
export const customerContacts = pgTable(
  "customer_contacts",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    nameAr: text("name_ar"),
    email: text("email"),
    phone: text("phone"),
    whatsappNumber: text("whatsapp_number"),
    trnNumber: text("trn_number"),
    address: text("address"),
    city: text("city"),
    country: text("country").default("UAE"),
    emirate: text("emirate"), // W3-A (0095): default place of supply
    contactPerson: text("contact_person"),
    paymentTerms: integer("payment_terms").default(30),
    notes: text("notes"),
    isActive: boolean("is_active").default(true).notNull(),
    // Legacy plaintext portal token: always NULL since W4-D (0103) — portal links are stored
    // hashed in portal_access_tokens.
    portalAccessToken: text("portal_access_token").unique(),
    portalAccessExpiresAt: timestamp("portal_access_expires_at"),
    // W4-D (0103): dunning opt-out and preferred language for customer emails (en | ar).
    doNotChase: boolean("do_not_chase").notNull().default(false),
    preferredLanguage: text("preferred_language"),
    // WQ5 (0127): one record for a customer and/or supplier. A supplier contact links the
    // vendors row bills and purchase orders read (vendor_id; FKs live in the migration).
    isCustomer: boolean("is_customer").notNull().default(true),
    isSupplier: boolean("is_supplier").notNull().default(false),
    vendorId: uuid("vendor_id"),
    partyType: text("party_type").notNull().default("business"), // business | individual
    freeZone: boolean("free_zone").notNull().default(false),
    addressStreet: text("address_street"),
    addressBuilding: text("address_building"),
    addressDistrict: text("address_district"),
    postalCode: text("postal_code"),
    /** Typed registrations: [{ type: vat | ct | excise | vat_exception, number }]. */
    taxRegistrations: jsonb("tax_registrations")
      .notNull()
      .default(sql`'[]'::jsonb`)
      .$type<Array<{ type: string; number: string }>>(),
    defaultRevenueAccountId: uuid("default_revenue_account_id"),
    defaultExpenseAccountId: uuid("default_expense_account_id"),
    defaultVatTreatment: text("default_vat_treatment"),
    defaultCostCenterId: uuid("default_cost_center_id"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at"),
  },
  (table) => ({
    companyIdIdx: index("idx_customer_contacts_company_id").on(table.companyId),
  })
);

export const insertCustomerContactSchema = createInsertSchema(customerContacts).omit({
  id: true,
  portalAccessToken: true,
  portalAccessExpiresAt: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertCustomerContact = z.infer<typeof insertCustomerContactSchema>;
export type CustomerContact = typeof customerContacts.$inferSelect;
