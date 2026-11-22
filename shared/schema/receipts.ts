// Receipts / documents.
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
import type { z } from "zod";
import { sql } from "drizzle-orm";
import { createInsertSchema, money, rate } from "./columns";
import { users } from "./users";
import { companies } from "./companies";
import { accounts, journalEntries } from "./ledger";

// ===========================
// Receipts/Documents
// ===========================
export const receipts = pgTable(
  "receipts",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    merchant: text("merchant"),
    invoiceNumber: text("invoice_number"),
    date: timestamp("date"),
    amount: money("amount"),
    vatAmount: money("vat_amount"),
    currency: text("currency").default("AED"),
    exchangeRate: rate("exchange_rate").notNull().default(1), // Rate to functional currency at posting
    baseCurrencyAmount: money("base_currency_amount").notNull().default(0), // Amount in functional currency
    category: text("category"),
    accountId: uuid("account_id").references(() => accounts.id), // Expense account to debit
    paymentAccountId: uuid("payment_account_id").references(() => accounts.id), // Cash/Bank account to credit
    posted: boolean("posted").default(false).notNull(), // Whether journal entry has been created
    // Phase 2: Receipt Autopilot — true when journal entry was created automatically
    // by the autopilot pipeline (high confidence + ≥5 rule acceptances) without user review.
    autoPosted: boolean("auto_posted").default(false).notNull(),
    // Phase 2: which classifier produced the suggestion for this receipt.
    // 'rule' | 'keyword' | 'statistical' | 'openai'. Surfaced as the Internal vs. AI badge.
    classifierMethod: text("classifier_method"),
    reverseCharge: boolean("reverse_charge").default(false).notNull(), // FTA reverse-charge: buyer self-assesses VAT
    journalEntryId: uuid("journal_entry_id").references(() => journalEntries.id), // Link to created journal entry
    imageData: text("image_data"),
    imagePath: text("image_path"),
    rawText: text("raw_text"),
    // W2-D (migration 0093): optional multi-account split [{accountId, amount, vatAmount, costCenterId}].
    lines: jsonb("lines").$type<
      Array<{
        accountId: string;
        amount: number;
        vatAmount?: number | null;
        costCenterId?: string | null;
        description?: string | null;
      }>
    >(),
    // W1-D (migration 0089): supplier TRN, upload content hash and true file type/size.
    supplierTrn: text("supplier_trn"),
    contentSha256: text("content_sha256"),
    fileMime: text("file_mime"),
    fileSize: integer("file_size"),
    uploadedBy: uuid("uploaded_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    companyIdIdx: index("idx_receipts_company_id").on(table.companyId),
    companyDateIdx: index("idx_receipts_company_date").on(table.companyId, table.date),
    companyPostedIdx: index("idx_receipts_company_posted").on(table.companyId, table.posted),
  })
);

export const insertReceiptSchema = createInsertSchema(receipts).omit({
  id: true,
  createdAt: true,
});

export type InsertReceipt = z.infer<typeof insertReceiptSchema>;
export type Receipt = typeof receipts.$inferSelect;
