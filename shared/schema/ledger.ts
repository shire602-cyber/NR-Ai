// Chart of accounts, journals, ledger kernel support, exchange rates, FX revaluations.
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
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import type { z } from "zod";
import { sql } from "drizzle-orm";
import { createInsertSchema, ledgerDate, money, rate } from "./columns";
import { users } from "./users";
import { companies } from "./companies";

// ===========================
// Chart of Accounts
// ===========================
export const accounts = pgTable(
  "accounts",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    code: text("code").notNull(), // Account code: 1010, 2020, etc.
    nameEn: text("name_en").notNull(),
    nameAr: text("name_ar"),
    description: text("description"), // Optional description
    type: text("type").notNull(), // asset | liability | equity | income | expense
    subType: text("sub_type"), // current_asset | fixed_asset | current_liability | long_term_liability | null
    isVatAccount: boolean("is_vat_account").notNull().default(false), // For VAT tracking
    vatType: text("vat_type"), // input | output | zero_rated | exempt | null - for VAT accounts only
    isSystemAccount: boolean("is_system_account").notNull().default(false), // System accounts cannot be deleted
    isActive: boolean("is_active").notNull().default(true),
    isArchived: boolean("is_archived").notNull().default(false), // Soft delete / archive
    // W2-D (migration 0093): account hierarchy. FK + cycle check live in SQL / the route.
    parentId: uuid("parent_id"),
    // W4-A (migration 0100): corporate-tax tag that drives account-based
    // add-backs/deductions (shared/ct-workpaper.ts CT_ACCOUNT_TAX_TAGS).
    taxTag: text("tax_tag"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at"),
  },
  (table) => ({
    companyCodeUnique: unique().on(table.companyId, table.code),
    companyIdIdx: index("idx_accounts_company_id").on(table.companyId),
  })
);

export const insertAccountSchema = createInsertSchema(accounts)
  .omit({
    id: true,
    createdAt: true,
    updatedAt: true,
  })
  .refine(
    (data) => {
      if (data.isVatAccount && !data.vatType) {
        return false;
      }
      if (!data.isVatAccount && data.vatType) {
        return false;
      }
      return true;
    },
    {
      message:
        "vatType must be provided when isVatAccount is true, and must be null when isVatAccount is false",
    }
  );

export type InsertAccount = z.infer<typeof insertAccountSchema>;
export type Account = typeof accounts.$inferSelect;

// ===========================
// Journal Entries
// ===========================

export const journalEntries = pgTable(
  "journal_entries",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    entryNumber: text("entry_number").notNull(),
    date: timestamp("date").notNull(),
    memo: text("memo"),
    // Status: draft entries can be edited, posted entries are immutable
    status: text("status").notNull().default("draft"), // draft | posted | void
    // Source tracking: where did this entry come from?
    source: text("source").notNull().default("manual"), // manual | invoice | receipt | payment | reversal | system
    sourceId: uuid("source_id"), // Reference to invoice, receipt, etc.
    // Reversal support: if this entry is a reversal, link to original
    reversedEntryId: uuid("reversed_entry_id").references((): AnyPgColumn => journalEntries.id),
    reversalReason: text("reversal_reason"),
    // W2-A ledger kernel (migration 0090). On an ORIGINAL entry, the id of the
    // one reversal that offsets it; set in the same transaction as the reversal.
    reversedByEntryId: uuid("reversed_by_entry_id"),
    // "reversed" | "voided" once reversedByEntryId is set (void = reversal dated
    // on the original date). The ledger-effect `status` stays "posted".
    reversalKind: text("reversal_kind"),
    // standard | reversal | closing | year_end_close | opening | revaluation
    entryKind: text("entry_kind").notNull().default("standard"),
    // Caller-supplied idempotency key, unique per company when set.
    idempotencyKey: text("idempotency_key"),
    // Migration-time flag for pre-kernel duplicate reversals (kept out of the
    // one-reversal-per-entry unique index; never set by the kernel).
    isDuplicateReversal: boolean("is_duplicate_reversal").notNull().default(false),
    reference: text("reference"),
    // Maker-checker for manual journals: null (not required) | pending | approved
    approvalStatus: text("approval_status"),
    approvedBy: uuid("approved_by"),
    approvedAt: timestamp("approved_at"),
    // Accrual support: the auto-reverse job reverses the entry on this date.
    autoReverseOn: ledgerDate("auto_reverse_on"),
    // Audit trail
    createdBy: uuid("created_by")
      .notNull()
      .references((): AnyPgColumn => users.id),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    postedBy: uuid("posted_by").references(() => users.id),
    postedAt: timestamp("posted_at"),
    updatedBy: uuid("updated_by").references(() => users.id),
    updatedAt: timestamp("updated_at"),
  },
  (table) => ({
    companyEntryUnique: unique().on(table.companyId, table.entryNumber),
    companyIdIdx: index("idx_journal_entries_company_id").on(table.companyId),
    companyDateIdx: index("idx_journal_entries_company_date").on(table.companyId, table.date),
    companyStatusIdx: index("idx_journal_entries_company_status").on(table.companyId, table.status),
    // S2: source lookups (getJournalEntriesBySource) run on every void/payment/
    // credit-note/expense/FX posting and idempotency check.
    companySourceIdx: index("idx_journal_entries_company_source").on(
      table.companyId,
      table.source,
      table.sourceId
    ),
  })
);

export const insertJournalEntrySchema = createInsertSchema(journalEntries).omit({
  id: true,
  createdAt: true,
  postedAt: true,
  updatedAt: true,
});

export type InsertJournalEntry = z.infer<typeof insertJournalEntrySchema>;
export type JournalEntry = typeof journalEntries.$inferSelect;

// ===========================
// Journal Lines
// ===========================
export const journalLines = pgTable(
  "journal_lines",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    entryId: uuid("entry_id")
      .notNull()
      .references(() => journalEntries.id, { onDelete: "cascade" }),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id),
    costCenterId: uuid("cost_center_id"), // optional departmental allocation (cost_centers.id)
    debit: money("debit").notNull().default(0), // Always in base currency (AED)
    credit: money("credit").notNull().default(0), // Always in base currency (AED)
    description: text("description"), // Line-level description
    // Foreign currency tracking
    foreignCurrency: text("foreign_currency"), // null = AED, otherwise ISO code (USD, EUR, etc.)
    foreignDebit: money("foreign_debit").default(0), // Original amount in foreign currency
    foreignCredit: money("foreign_credit").default(0), // Original amount in foreign currency
    exchangeRate: rate("exchange_rate").default(1), // Rate used: 1 foreignCurrency = X AED
    // Reconciliation support
    isReconciled: boolean("is_reconciled").notNull().default(false),
    reconciledAt: timestamp("reconciled_at"),
    reconciledBy: uuid("reconciled_by").references(() => users.id),
    bankTransactionId: uuid("bank_transaction_id"), // Reference to matched bank transaction
  },
  (table) => ({
    entryIdIdx: index("idx_journal_lines_entry_id").on(table.entryId),
  })
);

export const insertJournalLineSchema = createInsertSchema(journalLines).omit({
  id: true,
  reconciledAt: true,
});

export type InsertJournalLine = z.infer<typeof insertJournalLineSchema>;
export type JournalLine = typeof journalLines.$inferSelect;

// ===========================
// Ledger kernel support tables (W2-A, migration 0090)
// ===========================
// Partial unique indexes on journal_entries live in SQL only (0090):
//   uq_journal_entries_company_idempotency (company_id, idempotency_key) WHERE idempotency_key IS NOT NULL
//   uq_journal_entries_one_reversal (reversed_entry_id) WHERE entry_kind = 'reversal' AND NOT is_duplicate_reversal

/** Integrity findings recorded by migrations / repair scans. Never edits posted data. */
export const ledgerRepairFindings = pgTable(
  "ledger_repair_findings",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    companyId: uuid("company_id"),
    kind: text("kind").notNull(), // duplicate_reversal | unbalanced_entry
    entryId: uuid("entry_id").notNull(),
    details: jsonb("details"),
    foundAt: timestamp("found_at").defaultNow().notNull(),
  },
  (table) => ({
    kindEntryUnique: unique("uq_ledger_repair_findings_kind_entry").on(table.kind, table.entryId),
  })
);
export type LedgerRepairFinding = typeof ledgerRepairFindings.$inferSelect;

/** Per-company ledger settings (maker-checker threshold for manual journals). */
export const ledgerSettings = pgTable("ledger_settings", {
  companyId: uuid("company_id")
    .primaryKey()
    .references(() => companies.id, { onDelete: "cascade" }),
  // Manual journals whose total debit exceeds this need approval by a second
  // user. null = maker-checker off.
  manualApprovalThreshold: money("manual_approval_threshold"),
  updatedBy: uuid("updated_by"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
export type LedgerSettings = typeof ledgerSettings.$inferSelect;

/** Recurring and auto-reversing manual journal templates. */
export const journalTemplates = pgTable(
  "journal_templates",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    memo: text("memo"),
    // [{ accountId, debit?, credit?, description?, costCenterId? }] amounts as 2dp strings
    lines: jsonb("lines").notNull(),
    frequency: text("frequency").notNull().default("monthly"), // none | weekly | monthly | quarterly | yearly
    nextRunOn: ledgerDate("next_run_on"),
    endOn: ledgerDate("end_on"),
    postAs: text("post_as").notNull().default("posted"), // draft | posted
    autoReverseDays: integer("auto_reverse_days"), // null = no auto reversal
    isActive: boolean("is_active").notNull().default(true),
    lastRunOn: ledgerDate("last_run_on"),
    lastEntryId: uuid("last_entry_id"),
    createdBy: uuid("created_by").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at"),
  },
  (table) => ({
    companyIdx: index("idx_journal_templates_company").on(table.companyId),
  })
);
export type JournalTemplate = typeof journalTemplates.$inferSelect;

/** Files attached to a journal entry (stored through server/services/fileStorage). */
export const journalAttachments = pgTable(
  "journal_attachments",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    entryId: uuid("entry_id")
      .notNull()
      .references(() => journalEntries.id, { onDelete: "cascade" }),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    fileName: text("file_name").notNull(),
    contentType: text("content_type").notNull(),
    storageKey: text("storage_key").notNull(),
    sizeBytes: integer("size_bytes").notNull().default(0),
    uploadedBy: uuid("uploaded_by").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    entryIdx: index("idx_journal_attachments_entry").on(table.entryId),
  })
);
export type JournalAttachment = typeof journalAttachments.$inferSelect;

// ===========================
// Exchange Rates
// ===========================
export const EXCHANGE_RATE_TYPES = ["spot", "closing", "average"] as const;
export type ExchangeRateType = (typeof EXCHANGE_RATE_TYPES)[number];

/**
 * One row = "1 unit of base_currency is worth `rate` units of target_currency".
 * Canonical form for a company rate (W2-E, R14-02): base_currency = the foreign
 * currency, target_currency = the company's base currency, so AED per USD =
 * (USD, AED, 3.6725). Inverse pairs are derived at lookup time
 * (server/services/fx/rates.ts).
 *
 * Tenancy (R14-01): company_id NULL = system row (platform admins only, e.g.
 * FTA-published rates). legacy_unscoped rows (pre-0094 rows whose owner could
 * not be determined) are ignored by every lookup.
 */
export const exchangeRates = pgTable(
  "exchange_rates",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    companyId: uuid("company_id").references(() => companies.id, { onDelete: "cascade" }),
    baseCurrency: text("base_currency").notNull().default("AED"),
    targetCurrency: text("target_currency").notNull(),
    rate: rate("rate").notNull(), // units of targetCurrency per 1 baseCurrency
    rateType: text("rate_type").notNull().default("spot"), // spot | closing | average
    date: timestamp("date").notNull().defaultNow(),
    source: text("source").notNull().default("manual"), // manual | api | fta
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    legacyUnscoped: boolean("legacy_unscoped").notNull().default(false),
    legacyInverted: boolean("legacy_inverted").notNull().default(false),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    companyPairDateIdx: index("idx_exchange_rates_company_pair_date").on(
      table.companyId,
      table.baseCurrency,
      table.targetCurrency,
      table.rateType,
      table.date
    ),
  })
);

export const insertExchangeRateSchema = createInsertSchema(exchangeRates).omit({
  id: true,
  createdAt: true,
});

export type InsertExchangeRate = z.infer<typeof insertExchangeRateSchema>;
export type ExchangeRate = typeof exchangeRates.$inferSelect;

// ===========================
// FX revaluations (W2-E, R14-03/R14-17/R11-18)
// ===========================
/**
 * One unrealised FX revaluation run per (company, as_of) while not undone
 * (partial unique index in migration 0094). journal_entry_id is the
 * revaluation dated as_of; reversal_entry_id is its automatic reversal dated
 * as_of + 1 day. Both journal entries carry source_id = this row's id.
 */
export const fxRevaluations = pgTable(
  "fx_revaluations",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    asOf: pgDate("as_of", { mode: "string" }).notNull(),
    status: text("status").notNull().default("pending"), // pending | posted | undone
    journalEntryId: uuid("journal_entry_id").references(() => journalEntries.id),
    reversalEntryId: uuid("reversal_entry_id").references(() => journalEntries.id),
    netGainLoss: money("net_gain_loss").notNull().default(0), // base currency, + = gain
    summary: jsonb("summary"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    undoneBy: uuid("undone_by").references(() => users.id, { onDelete: "set null" }),
    undoneAt: timestamp("undone_at"),
  },
  (table) => ({
    activeUnique: uniqueIndex("uniq_fx_revaluations_company_as_of_active")
      .on(table.companyId, table.asOf)
      .where(sql`status <> 'undone'`),
    companyIdx: index("idx_fx_revaluations_company").on(table.companyId, table.asOf),
  })
);

export type FxRevaluation = typeof fxRevaluations.$inferSelect;
