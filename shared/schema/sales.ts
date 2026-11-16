// Invoices, invoice lines, quotes and credit notes.
// Part of the shared/schema.ts barrel (R20-09); import from "@shared/schema".

import {
  boolean,
  index,
  integer,
  pgTable,
  real,
  text,
  timestamp,
  unique,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import type { z } from "zod";
import { sql } from "drizzle-orm";
import { createInsertSchema, money, rate, vatRateType } from "./columns";
import { companies } from "./companies";
import { journalEntries } from "./ledger";
import { costCenters } from "./integrations";
import { products } from "./inventory";
import { customerContacts } from "./contacts";

// ===========================
// Invoices
// ===========================
export const invoices = pgTable(
  "invoices",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    number: text("number").notNull(),
    customerName: text("customer_name").notNull(),
    customerTrn: text("customer_trn"),
    customerAddress: text("customer_address"),
    date: timestamp("date").notNull(),
    dueDate: timestamp("due_date"),
    paymentTerms: text("payment_terms").default("net30"),
    currency: text("currency").notNull().default("AED"),
    exchangeRate: rate("exchange_rate").notNull().default(1), // Rate to AED at time of transaction
    baseCurrencyAmount: money("base_currency_amount").notNull().default(0), // Total in AED
    subtotal: money("subtotal").notNull().default(0),
    vatAmount: money("vat_amount").notNull().default(0),
    total: money("total").notNull().default(0),
    status: text("status").notNull().default("draft"), // draft | sent | paid | partial | void
    shareToken: text("share_token").unique(),
    shareTokenExpiresAt: timestamp("share_token_expires_at"),
    einvoiceUuid: text("einvoice_uuid"),
    einvoiceXml: text("einvoice_xml"),
    einvoiceHash: text("einvoice_hash"),
    einvoiceStatus: text("einvoice_status"), // null | generated | submitted | accepted | rejected | failed
    // ASP submission tracking (provider-agnostic; see einvoice-provider.ts).
    einvoiceProvider: text("einvoice_provider"),
    einvoiceProviderMessageId: text("einvoice_provider_message_id"),
    einvoiceSubmittedAt: timestamp("einvoice_submitted_at"),
    einvoiceStatusDetail: text("einvoice_status_detail"),
    reminderCount: integer("reminder_count").notNull().default(0),
    lastReminderSentAt: timestamp("last_reminder_sent_at"),
    // Phase 4: Payment Chasing Autopilot
    // chaseLevel reflects the highest escalation level reached for this invoice
    // (0 = never chased, 1..4 = friendly..final notice). lastChasedAt drives
    // the chase queue (frequency throttling per company config).
    chaseLevel: integer("chase_level").notNull().default(0),
    lastChasedAt: timestamp("last_chased_at"),
    doNotChase: boolean("do_not_chase").notNull().default(false),
    invoiceType: text("invoice_type").notNull().default("invoice"),
    reverseCharge: boolean("reverse_charge").notNull().default(false), // FTA reverse-charge: recipient self-assesses VAT
    originalInvoiceId: uuid("original_invoice_id"),
    legacyCreditNoteId: uuid("legacy_credit_note_id").references(
      (): AnyPgColumn => creditNotes.id,
      {
        onDelete: "set null",
      }
    ),
    isRecurring: boolean("is_recurring").notNull().default(false),
    recurringInterval: text("recurring_interval"), // weekly | monthly | quarterly | yearly
    nextRecurringDate: timestamp("next_recurring_date"),
    recurringEndDate: timestamp("recurring_end_date"),
    contactId: uuid("contact_id").references((): AnyPgColumn => customerContacts.id, {
      onDelete: "set null",
    }),
    // W3-A (migration 0095): place of supply drives VAT 201 Box 1 emirate
    // attribution; supply date is the tax point when it differs from the
    // invoice date; discounts are stored, never silently dropped (R03-07).
    placeOfSupplyEmirate: text("place_of_supply_emirate"),
    supplyDate: timestamp("supply_date"),
    notes: text("notes"),
    discountType: text("discount_type"), // amount | percent | null (document-level)
    discountValue: rate("discount_value"),
    discountAmount: money("discount_amount").notNull().default(0), // line + document discounts
    sourceQuoteId: uuid("source_quote_id"),
    templateId: uuid("template_id"),
    issuedAt: timestamp("issued_at"),
    // S1 (migration 0110): credit notes only — return goods to stock (true / null) or write off (false).
    restock: boolean("restock"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    companyNumberUnique: unique("invoices_company_number_unique").on(table.companyId, table.number),
    companyCreatedIdx: index("idx_invoices_company_created_id").on(
      table.companyId,
      table.createdAt,
      table.id
    ),
    companyIdIdx: index("idx_invoices_company_id").on(table.companyId),
    companyDateIdx: index("idx_invoices_company_date").on(table.companyId, table.date),
    companyStatusIdx: index("idx_invoices_company_status").on(table.companyId, table.status),
    contactIdIdx: index("idx_invoices_contact_id").on(table.contactId),
    legacyCreditNoteUnique: unique("invoices_legacy_credit_note_unique").on(
      table.legacyCreditNoteId
    ),
  })
);

export const insertInvoiceSchema = createInsertSchema(invoices).omit({
  id: true,
  createdAt: true,
});

export type InsertInvoice = z.infer<typeof insertInvoiceSchema>;
export type Invoice = typeof invoices.$inferSelect;

// ===========================
// Invoice Lines
// ===========================
export const invoiceLines = pgTable(
  "invoice_lines",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    invoiceId: uuid("invoice_id")
      .notNull()
      .references(() => invoices.id, { onDelete: "cascade" }),
    description: text("description").notNull(),
    quantity: real("quantity").notNull(),
    unitPrice: money("unit_price").notNull(),
    vatRate: vatRateType("vat_rate").notNull().default(0.05), // UAE standard 5%
    vatSupplyType: text("vat_supply_type").default("standard_rated"), // standard_rated | zero_rated | exempt | out_of_scope | reverse_charge
    // W3-A (migration 0095): discounts, net amount after all discounts, and
    // optional product / cost-centre links (used by the inventory worker).
    discountType: text("discount_type"), // amount | percent | null
    discountValue: rate("discount_value"),
    discountAmount: money("discount_amount").notNull().default(0), // line discount only
    netAmount: money("net_amount"), // after line + allocated document discount
    productId: uuid("product_id").references((): AnyPgColumn => products.id, {
      onDelete: "set null",
    }),
    costCenterId: uuid("cost_center_id").references((): AnyPgColumn => costCenters.id, {
      onDelete: "set null",
    }),
    quoteLineId: uuid("quote_line_id"),
    // S1 (migration 0110): profit-margin scheme (Art. 29) — VAT and Box 1 on the margin only.
    marginScheme: boolean("margin_scheme").notNull().default(false),
    marginPurchaseCost: money("margin_purchase_cost"), // line purchase cost, document currency
  },
  (table) => ({
    invoiceIdIdx: index("idx_invoice_lines_invoice_id").on(table.invoiceId),
  })
);

export const insertInvoiceLineSchema = createInsertSchema(invoiceLines).omit({
  id: true,
});

export type InsertInvoiceLine = z.infer<typeof insertInvoiceLineSchema>;
export type InvoiceLine = typeof invoiceLines.$inferSelect;

// ===========================
// Quotes (estimates / proposals — convertible to invoices)
// ===========================
export const quotes = pgTable(
  "quotes",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    number: text("number").notNull(),
    customerName: text("customer_name").notNull(),
    customerTrn: text("customer_trn"),
    contactId: uuid("contact_id").references((): AnyPgColumn => customerContacts.id, {
      onDelete: "set null",
    }),
    date: timestamp("date").notNull(),
    expiryDate: timestamp("expiry_date"),
    currency: text("currency").notNull().default("AED"),
    subtotal: money("subtotal").notNull().default(0),
    vatAmount: money("vat_amount").notNull().default(0),
    total: money("total").notNull().default(0),
    status: text("status").notNull().default("draft"), // draft | sent | accepted | declined | expired | converted
    convertedInvoiceId: uuid("converted_invoice_id"),
    notes: text("notes"),
    // W3-A (migration 0095)
    customerAddress: text("customer_address"),
    paymentTerms: text("payment_terms"),
    placeOfSupplyEmirate: text("place_of_supply_emirate"),
    discountType: text("discount_type"),
    discountValue: rate("discount_value"),
    discountAmount: money("discount_amount").notNull().default(0),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    companyNumberUnique: unique("quotes_company_number_unique").on(table.companyId, table.number),
    companyIdIdx: index("idx_quotes_company_id").on(table.companyId),
    companyStatusIdx: index("idx_quotes_company_status").on(table.companyId, table.status),
  })
);

export const insertQuoteSchema = createInsertSchema(quotes).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertQuote = z.infer<typeof insertQuoteSchema>;
export type Quote = typeof quotes.$inferSelect;

export const quoteLines = pgTable(
  "quote_lines",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    quoteId: uuid("quote_id")
      .notNull()
      .references(() => quotes.id, { onDelete: "cascade" }),
    description: text("description").notNull(),
    quantity: real("quantity").notNull(),
    unitPrice: money("unit_price").notNull(),
    vatRate: vatRateType("vat_rate").notNull().default(0.05),
    vatSupplyType: text("vat_supply_type").default("standard_rated"),
    // W3-A (migration 0095): discounts + progress billing (quantity already invoiced).
    discountType: text("discount_type"),
    discountValue: rate("discount_value"),
    discountAmount: money("discount_amount").notNull().default(0),
    billedQuantity: real("billed_quantity").notNull().default(0),
    productId: uuid("product_id"),
    costCenterId: uuid("cost_center_id"),
  },
  (table) => ({
    quoteIdIdx: index("idx_quote_lines_quote_id").on(table.quoteId),
  })
);

export const insertQuoteLineSchema = createInsertSchema(quoteLines).omit({
  id: true,
});

export type InsertQuoteLine = z.infer<typeof insertQuoteLineSchema>;
export type QuoteLine = typeof quoteLines.$inferSelect;

// ===========================
// Credit Notes (FTA-compliant corrections to issued invoices)
// ===========================
export const creditNotes = pgTable(
  "credit_notes",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    number: text("number").notNull(),
    customerName: text("customer_name").notNull(),
    customerTrn: text("customer_trn"),
    invoiceId: uuid("invoice_id").references(() => invoices.id, { onDelete: "set null" }),
    invoiceNumber: text("invoice_number"),
    date: timestamp("date").notNull(),
    currency: text("currency").notNull().default("AED"),
    subtotal: money("subtotal").notNull().default(0),
    vatAmount: money("vat_amount").notNull().default(0),
    total: money("total").notNull().default(0),
    status: text("status").notNull().default("draft"), // draft | issued | void
    reason: text("reason"),
    journalEntryId: uuid("journal_entry_id").references(() => journalEntries.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    companyNumberUnique: unique("credit_notes_company_number_unique").on(
      table.companyId,
      table.number
    ),
    companyIdIdx: index("idx_credit_notes_company_id").on(table.companyId),
    companyStatusIdx: index("idx_credit_notes_company_status").on(table.companyId, table.status),
  })
);

export const insertCreditNoteSchema = createInsertSchema(creditNotes).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertCreditNote = z.infer<typeof insertCreditNoteSchema>;
export type CreditNote = typeof creditNotes.$inferSelect;

export const creditNoteLines = pgTable(
  "credit_note_lines",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    creditNoteId: uuid("credit_note_id")
      .notNull()
      .references(() => creditNotes.id, { onDelete: "cascade" }),
    description: text("description").notNull(),
    quantity: real("quantity").notNull(),
    unitPrice: money("unit_price").notNull(),
    vatRate: vatRateType("vat_rate").notNull().default(0.05),
    vatSupplyType: text("vat_supply_type").default("standard_rated"),
  },
  (table) => ({
    creditNoteIdIdx: index("idx_credit_note_lines_credit_note_id").on(table.creditNoteId),
  })
);

export const insertCreditNoteLineSchema = createInsertSchema(creditNoteLines).omit({
  id: true,
});

export type InsertCreditNoteLine = z.infer<typeof insertCreditNoteLineSchema>;
export type CreditNoteLine = typeof creditNoteLines.$inferSelect;
