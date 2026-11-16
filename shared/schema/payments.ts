// Invoice payments, customer credits and recurring invoices.
// Part of the shared/schema.ts barrel (R20-09); import from "@shared/schema".

import {
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import type { z } from "zod";
import { sql } from "drizzle-orm";
import { createInsertSchema, money, rate } from "./columns";
import { users } from "./users";
import { companies } from "./companies";
import { accounts, journalEntries } from "./ledger";
import { invoices } from "./sales";

// ===========================
// Invoice Payments
// ===========================
export const invoicePayments = pgTable(
  "invoice_payments",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    invoiceId: uuid("invoice_id")
      .notNull()
      .references(() => invoices.id, { onDelete: "cascade" }),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    amount: money("amount").notNull(),
    date: timestamp("date").notNull(),
    method: text("method").notNull().default("bank"), // cash | bank | cheque | online
    reference: text("reference"),
    notes: text("notes"),
    paymentAccountId: uuid("payment_account_id").references(() => accounts.id),
    // A-B5: exchange rate on the payment date (AED per unit of the invoice
    // currency). Null = settle at the invoice rate (no realised FX). When set
    // and it differs from the invoice rate, the realised FX gain/loss is posted.
    exchangeRate: rate("exchange_rate"),
    journalEntryId: uuid("journal_entry_id").references(() => journalEntries.id),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    invoiceIdIdx: index("idx_invoice_payments_invoice_id").on(table.invoiceId),
    companyIdIdx: index("idx_invoice_payments_company_id").on(table.companyId),
  })
);

export const insertInvoicePaymentSchema = createInsertSchema(invoicePayments).omit({
  id: true,
  createdAt: true,
});

export type InsertInvoicePayment = z.infer<typeof insertInvoicePaymentSchema>;
export type InvoicePayment = typeof invoicePayments.$inferSelect;

// ===========================
// Customer credits (W3-A, migration 0095): a credit note on a paid invoice or
// an overpayment leaves money owed TO the customer. It is a liability that is
// either applied to another invoice or refunded through a cash/bank account.
// ===========================
export const customerCredits = pgTable(
  "customer_credits",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id"),
    customerName: text("customer_name").notNull(),
    sourceType: text("source_type").notNull(), // credit_note | overpayment
    sourceId: uuid("source_id").notNull(),
    invoiceId: uuid("invoice_id"), // the invoice the credit arose on
    currency: text("currency").notNull().default("AED"),
    exchangeRate: rate("exchange_rate").notNull().default(1),
    liabilityAccountId: uuid("liability_account_id")
      .notNull()
      .references(() => accounts.id),
    amount: money("amount").notNull(),
    remaining: money("remaining").notNull(),
    status: text("status").notNull().default("open"), // open | closed | void
    createdBy: uuid("created_by"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    companyIdx: index("idx_customer_credits_company").on(table.companyId, table.status),
    sourceUnique: unique("customer_credits_source_unique").on(
      table.companyId,
      table.sourceType,
      table.sourceId
    ),
  })
);
export type CustomerCredit = typeof customerCredits.$inferSelect;

export const customerCreditAllocations = pgTable(
  "customer_credit_allocations",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    creditId: uuid("credit_id")
      .notNull()
      .references(() => customerCredits.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(), // apply | refund
    invoiceId: uuid("invoice_id").references(() => invoices.id, { onDelete: "set null" }),
    paymentAccountId: uuid("payment_account_id").references(() => accounts.id),
    amount: money("amount").notNull(),
    date: timestamp("date").notNull(),
    exchangeRate: rate("exchange_rate"),
    reference: text("reference"),
    journalEntryId: uuid("journal_entry_id").references(() => journalEntries.id),
    createdBy: uuid("created_by"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    creditIdx: index("idx_customer_credit_allocations_credit").on(table.creditId),
    invoiceIdx: index("idx_customer_credit_allocations_invoice").on(table.invoiceId),
  })
);
export type CustomerCreditAllocation = typeof customerCreditAllocations.$inferSelect;

// ===========================
// Recurring Invoices
// ===========================
export const recurringInvoices = pgTable(
  "recurring_invoices",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    customerName: text("customer_name").notNull(),
    customerTrn: text("customer_trn"),
    currency: text("currency").notNull().default("AED"),
    frequency: text("frequency").notNull().default("monthly"), // weekly | monthly | quarterly | yearly
    startDate: timestamp("start_date").notNull(),
    nextRunDate: timestamp("next_run_date").notNull(),
    endDate: timestamp("end_date"), // null = indefinite
    linesJson: text("lines_json").notNull(), // JSON string of invoice line items
    isActive: boolean("is_active").notNull().default(true),
    lastGeneratedInvoiceId: uuid("last_generated_invoice_id"),
    totalGenerated: integer("total_generated").notNull().default(0),
    // W3-A (migration 0095): draft vs auto-issue, optional auto-send, contact
    // link and the outcome of the last run (honest: "no email provider").
    contactId: uuid("contact_id"),
    customerAddress: text("customer_address"),
    paymentTerms: text("payment_terms"),
    placeOfSupplyEmirate: text("place_of_supply_emirate"),
    autoIssue: boolean("auto_issue").notNull().default(true),
    autoSend: boolean("auto_send").notNull().default(false),
    sendToEmail: text("send_to_email"),
    lastRunStatus: text("last_run_status"),
    lastRunMessage: text("last_run_message"),
    lastRunAt: timestamp("last_run_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    companyIdIdx: index("idx_recurring_invoices_company_id").on(table.companyId),
    nextRunActiveIdx: index("idx_recurring_invoices_next_run_active").on(
      table.isActive,
      table.nextRunDate
    ),
  })
);

export const insertRecurringInvoiceSchema = createInsertSchema(recurringInvoices).omit({
  id: true,
  createdAt: true,
});

export type InsertRecurringInvoice = z.infer<typeof insertRecurringInvoiceSchema>;
export type RecurringInvoice = typeof recurringInvoices.$inferSelect;
