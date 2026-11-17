// AI anomaly alerts, bank accounts, bank transactions and banking (W3-C).
// Part of the shared/schema.ts barrel (R20-09); import from "@shared/schema".

import {
  boolean,
  index,
  integer,
  jsonb,
  date as pgDate,
  pgTable,
  real,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import type { z } from "zod";
import { sql } from "drizzle-orm";
import { createInsertSchema, ledgerDate, money } from "./columns";
import { users } from "./users";
import { companies } from "./companies";
import { accounts, journalEntries } from "./ledger";
import { invoices } from "./sales";
import { receipts } from "./receipts";

// ===========================
// AI Anomaly Detection
// ===========================
export const anomalyAlerts = pgTable(
  "anomaly_alerts",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    type: text("type").notNull(), // duplicate | unusual_amount | unusual_timing | unusual_category | potential_fraud
    severity: text("severity").notNull().default("medium"), // low | medium | high | critical
    title: text("title").notNull(),
    description: text("description").notNull(),
    relatedEntityType: text("related_entity_type"), // invoice | receipt | journal_entry
    relatedEntityId: uuid("related_entity_id"),
    duplicateOfId: uuid("duplicate_of_id"), // For duplicate detection
    aiConfidence: real("ai_confidence"), // 0-1 confidence score
    isResolved: boolean("is_resolved").notNull().default(false),
    resolvedBy: uuid("resolved_by").references(() => users.id),
    resolvedAt: timestamp("resolved_at"),
    resolutionNote: text("resolution_note"),
    // W3-E: the real transaction facts, the rule that fired, and a stable key so
    // re-scans never create duplicates.
    amount: money("amount"),
    transactionDate: pgDate("transaction_date", { mode: "string" }),
    rule: text("rule"),
    dedupeKey: text("dedupe_key"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    companyIdIdx: index("idx_anomaly_alerts_company_id").on(table.companyId),
    companyResolvedIdx: index("idx_anomaly_alerts_company_resolved").on(
      table.companyId,
      table.isResolved
    ),
  })
);

export const insertAnomalyAlertSchema = createInsertSchema(anomalyAlerts).omit({
  id: true,
  createdAt: true,
});

export type InsertAnomalyAlert = z.infer<typeof insertAnomalyAlertSchema>;
export type AnomalyAlert = typeof anomalyAlerts.$inferSelect;

// ===========================
// Bank Accounts (managed bank accounts linked to GL)
// ===========================
export const bankAccounts = pgTable(
  "bank_accounts",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    nameEn: text("name_en").notNull(), // Display name e.g. "Emirates NBD Current"
    bankName: text("bank_name").notNull(), // Emirates NBD | ADCB | FAB | Mashreq | Other
    accountNumber: text("account_number"),
    iban: text("iban"),
    currency: text("currency").notNull().default("AED"),
    glAccountId: uuid("gl_account_id").references(() => accounts.id), // Linked GL account
    isActive: boolean("is_active").notNull().default(true),
    // W3-C (migration 0097): statement opening balance for the continuity check.
    openingBalance: money("opening_balance").notNull().default(0),
    openingBalanceDate: ledgerDate("opening_balance_date"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at"),
  },
  (table) => ({
    companyIdIdx: index("idx_bank_accounts_company_id").on(table.companyId),
  })
);

export const insertBankAccountSchema = createInsertSchema(bankAccounts).omit({
  id: true,
  createdAt: true,
});

export type InsertBankAccount = z.infer<typeof insertBankAccountSchema>;
export type BankAccount = typeof bankAccounts.$inferSelect;

// ===========================
// Bank Transactions (for reconciliation)
// ===========================
export const bankTransactions = pgTable(
  "bank_transactions",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    bankConnectionId: uuid("bank_connection_id"), // source connection for imported rows
    // GL account of the managed bank account. Resolved from bank_statement_account_id at reconcile
    // time (R06-01); this column is a cached copy kept in step by relinks and migration 0097.
    bankAccountId: uuid("bank_account_id").references(() => accounts.id),
    bankStatementAccountId: uuid("bank_statement_account_id").references(() => bankAccounts.id), // Links to managed bank account
    transactionDate: timestamp("transaction_date").notNull(),
    description: text("description").notNull(),
    amount: money("amount").notNull(), // Positive for credits, negative for debits
    balance: money("balance"), // Running balance from bank statement
    reference: text("reference"), // Bank reference number
    category: text("category"), // AI-suggested category
    // matched | suggested | unmatched. Invariant (trigger + CHECK, migration 0097, R06-18):
    // is_reconciled = (match_status = 'matched').
    matchStatus: text("match_status").notNull().default("unmatched"),
    isReconciled: boolean("is_reconciled").notNull().default(false),
    matchedType: text("matched_type"), // invoice | bill | journal | receipt | transfer | entry | rule | split
    matchedJournalEntryId: uuid("matched_journal_entry_id").references(() => journalEntries.id),
    matchedReceiptId: uuid("matched_receipt_id").references(() => receipts.id),
    matchedInvoiceId: uuid("matched_invoice_id").references(() => invoices.id),
    matchConfidence: real("match_confidence"), // AI confidence for the match
    importSource: text("import_source"), // manual | csv | api
    // W3-C (migration 0097, R06-22): exclude / restore, soft delete, import batch, feed id.
    excludedAt: timestamp("excluded_at"),
    excludedBy: uuid("excluded_by"),
    excludeReason: text("exclude_reason"),
    deletedAt: timestamp("deleted_at"),
    deletedBy: uuid("deleted_by"),
    importBatchId: uuid("import_batch_id"),
    externalId: text("external_id"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    bankAccountIdIdx: index("idx_bank_transactions_bank_account_id").on(table.bankAccountId),
    companyIdIdx: index("idx_bank_transactions_company_id").on(table.companyId),
    companyMatchStatusIdx: index("idx_bank_transactions_company_match").on(
      table.companyId,
      table.matchStatus
    ),
  })
);

export const insertBankTransactionSchema = createInsertSchema(bankTransactions).omit({
  id: true,
  createdAt: true,
});

export type InsertBankTransaction = z.infer<typeof insertBankTransactionSchema>;
export type BankTransaction = typeof bankTransactions.$inferSelect;

// ===========================
// W3-C banking (migration 0097)
// ===========================

/** One allocation of a bank line to a document or entry (split matching, R06-21). */
export const bankTransactionMatches = pgTable(
  "bank_transaction_matches",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    bankTransactionId: uuid("bank_transaction_id")
      .notNull()
      .references(() => bankTransactions.id, { onDelete: "cascade" }),
    /** All allocations written by one apply share a group (unmatch reverses the group). */
    matchGroupId: uuid("match_group_id").notNull(),
    targetType: text("target_type").notNull(), // invoice | bill | journal | receipt | transfer | entry | rule
    targetId: uuid("target_id"),
    amount: money("amount").notNull().default(0),
    journalEntryId: uuid("journal_entry_id").references(() => journalEntries.id, {
      onDelete: "set null",
    }),
    paymentId: uuid("payment_id"),
    accountId: uuid("account_id"), // contra GL account of a created entry (payee memory)
    createdJournal: boolean("created_journal").notNull().default(false),
    /** A1 (H7/M8): VAT treatment of a created entry (standard | zero_rated | exempt). */
    vatTreatment: text("vat_treatment"),
    vatNetAmount: money("vat_net_amount"),
    vatAmount: money("vat_amount"),
    status: text("status").notNull().default("active"), // pending | active | reversed
    idempotencyKey: text("idempotency_key"),
    createdBy: uuid("created_by"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    reversedAt: timestamp("reversed_at"),
    reversedBy: uuid("reversed_by"),
  },
  (table) => ({
    txnIdx: index("idx_bank_txn_matches_txn").on(table.bankTransactionId),
    groupIdx: index("idx_bank_txn_matches_group").on(table.matchGroupId),
  })
);
export type BankTransactionMatch = typeof bankTransactionMatches.$inferSelect;

/** One statement file (or feed sync / AI import) per row, with undo (R06-22). */
export const bankImportBatches = pgTable(
  "bank_import_batches",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    bankAccountId: uuid("bank_account_id").references(() => bankAccounts.id, {
      onDelete: "set null",
    }),
    source: text("source").notNull().default("csv"), // csv | xlsx | mt940 | camt053 | ofx | pdf_ai | feed
    fileName: text("file_name"),
    fileFingerprint: text("file_fingerprint"),
    format: text("format"),
    rowCount: integer("row_count").notNull().default(0),
    importedCount: integer("imported_count").notNull().default(0),
    skippedCount: integer("skipped_count").notNull().default(0),
    status: text("status").notNull().default("active"), // active | undone
    continuityWarning: text("continuity_warning"),
    createdBy: uuid("created_by"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    undoneAt: timestamp("undone_at"),
    undoneBy: uuid("undone_by"),
    removedCount: integer("removed_count"),
  },
  (table) => ({
    companyIdx: index("idx_bank_import_batches_company").on(table.companyId, table.createdAt),
  })
);
export type BankImportBatch = typeof bankImportBatches.$inferSelect;

/** Bank reconciliation statement snapshot with sign-off (R06-20). */
export const bankReconciliations = pgTable(
  "bank_reconciliations",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    bankAccountId: uuid("bank_account_id")
      .notNull()
      .references(() => bankAccounts.id, { onDelete: "cascade" }),
    periodStart: ledgerDate("period_start"),
    periodEnd: ledgerDate("period_end").notNull(),
    statementClosingBalance: money("statement_closing_balance").notNull(),
    glBalance: money("gl_balance").notNull(),
    difference: money("difference").notNull(),
    snapshot: jsonb("snapshot").notNull().default({}),
    status: text("status").notNull().default("draft"), // draft | signed_off
    createdBy: uuid("created_by"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    signedOffBy: uuid("signed_off_by"),
    signedOffAt: timestamp("signed_off_at"),
  },
  (table) => ({
    accountIdx: index("idx_bank_reconciliations_account").on(
      table.companyId,
      table.bankAccountId,
      table.periodEnd
    ),
  })
);
export type BankReconciliation = typeof bankReconciliations.$inferSelect;

/** OAuth state issued on bank-feed connect, verified once on callback (R06-14). */
export const bankFeedOauthStates = pgTable("bank_feed_oauth_states", {
  id: uuid("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  companyId: uuid("company_id")
    .notNull()
    .references(() => companies.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull(),
  provider: text("provider").notNull(),
  stateHash: text("state_hash").notNull(),
  redirectUri: text("redirect_uri").notNull(),
  bankAccountId: uuid("bank_account_id"),
  expiresAt: timestamp("expires_at").notNull(),
  usedAt: timestamp("used_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export type BankFeedOauthState = typeof bankFeedOauthStates.$inferSelect;
