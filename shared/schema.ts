import { pgTable, text, varchar, integer, real, boolean, timestamp, uuid, unique, index, customType, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { sql } from "drizzle-orm";

// Monetary amount stored as NUMERIC(15,2) in Postgres for exact decimal arithmetic.
// fromDriver rounds to 2 decimals so JS-side floating-point drift cannot accumulate
// across multi-line entries (a long-term decimal library is the proper fix).
const money = customType<{ data: number; driverData: string }>({
  dataType() { return "numeric(15,2)"; },
  fromDriver(value: string): number { return Math.round(parseFloat(value) * 100) / 100; },
  toDriver(value: number) { return String(value); },
});

// Exchange rates need higher decimal precision than monetary amounts.
const rate = customType<{ data: number; driverData: string }>({
  dataType() { return "numeric(15,6)"; },
  fromDriver(value: string): number { return parseFloat(value); },
  toDriver(value: number) { return String(value); },
});

// VAT rates (e.g. 0.05 for UAE 5%) need exact decimal storage; real() cannot
// represent 0.05 exactly in IEEE-754.
const vatRateType = customType<{ data: number; driverData: string }>({
  dataType() { return "numeric(5,4)"; },
  fromDriver(value: string): number { return parseFloat(value); },
  toDriver(value: number) { return String(value); },
});

// ===========================
// User Types
// ===========================
// admin: NR Accounting staff with full access
// client: Existing NR Accounting clients (invite-only, relationship-based)
// customer: Self-signup SaaS users (tier-based pricing)
// client_portal: NRA-managed company contacts with read-only portal access
export type UserType = 'admin' | 'client' | 'customer' | 'client_portal';

// firmRole: NRA firm staff roles for internal management center access
// firm_owner: Full access to all clients in NRA center
// firm_admin: Access only to assigned client companies
// null: Regular user — no NRA features visible
export type FirmRole = 'firm_owner' | 'firm_admin' | null;

// ===========================
// Users
// ===========================
export const users = pgTable("users", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  passwordHash: text("password_hash").notNull(),
  isAdmin: boolean("is_admin").notNull().default(false),
  userType: text("user_type").notNull().default("customer"), // admin | client | customer | client_portal
  firmRole: text("firm_role"), // firm_owner | firm_admin | null
  phone: text("phone"),
  avatarUrl: text("avatar_url"),
  emailVerified: boolean("email_verified").notNull().default(false),
  lastLoginAt: timestamp("last_login_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertUserSchema = createInsertSchema(users).omit({
  id: true,
  passwordHash: true,
  createdAt: true,
  emailVerified: true,
}).extend({
  password: z.string().min(8, "Password must be at least 8 characters"),
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;
export type UserPublic = Omit<User, 'passwordHash'>;

// ===========================
// Auth security tables
// ===========================
// Blacklisted JWTs — entries are kept until token expiry, then swept.
export const tokenBlacklist = pgTable("token_blacklist", {
  tokenHash: text("token_hash").primaryKey(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export type TokenBlacklistEntry = typeof tokenBlacklist.$inferSelect;

// One-time tokens issued by /auth/forgot-password and consumed by /auth/reset-password.
// usedAt is set the moment the token is redeemed so a captured token cannot be replayed.
export const passwordResetTokens = pgTable("password_reset_tokens", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull().unique(), // SHA-256 of the token; raw token only ever lives in the email
  expiresAt: timestamp("expires_at").notNull(),
  usedAt: timestamp("used_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  tokenHashIdx: index("idx_password_reset_token_hash").on(table.tokenHash),
  userIdIdx: index("idx_password_reset_user_id").on(table.userId),
}));

export const insertPasswordResetTokenSchema = createInsertSchema(passwordResetTokens).omit({
  id: true,
  createdAt: true,
});

export type InsertPasswordResetToken = z.infer<typeof insertPasswordResetTokenSchema>;
export type PasswordResetToken = typeof passwordResetTokens.$inferSelect;

// Email-verification tokens — issued on registration.
export const emailVerificationTokens = pgTable("email_verification_tokens", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export type EmailVerificationToken = typeof emailVerificationTokens.$inferSelect;


// ===========================
// Companies
// ===========================
export const companies = pgTable("companies", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  legalName: text("legal_name"), // Registered legal name (may differ from trading name)
  baseCurrency: text("base_currency").notNull().default("AED"),
  locale: text("locale").notNull().default("en"), // 'en' or 'ar'
  dateFormat: text("date_format").notNull().default("DD/MM/YYYY"), // DD/MM/YYYY | MM/DD/YYYY | YYYY-MM-DD
  fiscalYearStartMonth: integer("fiscal_year_start_month").notNull().default(1), // 1..12
  defaultVatRate: vatRateType("default_vat_rate").notNull().default(0.05), // UAE standard rate

  // Company Type - determines access model
  companyType: text("company_type").notNull().default("customer"), // client | customer
  // client = Managed by NR Accounting, invite-only portal access
  // customer = Self-service SaaS user

  // Company Information
  legalStructure: text("legal_structure"), // Sole Proprietorship, LLC, Corporation, Partnership, Other
  industry: text("industry"),
  registrationNumber: text("registration_number"),
  businessAddress: text("business_address"), // Free-text legacy single-line address
  addressStreet: text("address_street"),
  addressCity: text("address_city"),
  addressCountry: text("address_country").default("AE"),
  contactPhone: text("contact_phone"),
  contactEmail: text("contact_email"),
  websiteUrl: text("website_url"),
  logoUrl: text("logo_url"),
  
  // Tax & Compliance
  trnVatNumber: text("trn_vat_number"),
  taxRegistrationType: text("tax_registration_type"), // Standard, Flat Rate, Non-registered, Other
  vatFilingFrequency: text("vat_filing_frequency"), // Monthly, Quarterly, Annually
  taxRegistrationDate: timestamp("tax_registration_date"),
  corporateTaxId: text("corporate_tax_id"),
  emirate: text("emirate").default("dubai"), // abu_dhabi | dubai | sharjah | ajman | umm_al_quwain | ras_al_khaimah | fujairah

  // WPS / Payroll — MOHRE establishment ID and employer bank fields used to
  // build the SCR (Salary Control Record) line of the SIF file. Distinct from
  // `registrationNumber` (trade-license number).
  mohreEstablishmentId: text("mohre_establishment_id"),
  wpsEmployerBankName: text("wps_employer_bank_name"),
  wpsEmployerIban: text("wps_employer_iban"),
  wpsEmployerRoutingCode: text("wps_employer_routing_code"),
  // Partial exemption: fraction of supplies that are exempt (0..1). When > 0, input VAT
  // is reduced by this ratio per FTA partial-exemption rules.
  exemptSupplyRatio: vatRateType("exempt_supply_ratio").notNull().default(0),
  // VAT autopilot configuration. periodStartMonth is the calendar month (1-12)
  // that the VAT period cycle starts on — defaults to January but FTA assigns
  // each registrant a stagger so quarterly periods may begin in Feb or Mar.
  vatAutoCalculate: boolean("vat_auto_calculate").notNull().default(true),
  vatPeriodStartMonth: integer("vat_period_start_month").notNull().default(1),

  // Soft delete — UAE FTA requires 5-year retention; hard deletes are disallowed
  deletedAt: timestamp("deleted_at"),
  isActive: boolean("is_active").notNull().default(true),

  // Invoice Customization
  invoiceShowLogo: boolean("invoice_show_logo").notNull().default(true),
  invoiceShowAddress: boolean("invoice_show_address").notNull().default(true),
  invoiceShowPhone: boolean("invoice_show_phone").notNull().default(true),
  invoiceShowEmail: boolean("invoice_show_email").notNull().default(true),
  invoiceShowWebsite: boolean("invoice_show_website").notNull().default(false),
  invoiceCustomTitle: text("invoice_custom_title"), // Custom invoice title, defaults to "Tax Invoice" for VAT registered
  invoiceFooterNote: text("invoice_footer_note"),

  onboardingCompleted: boolean("onboarding_completed").notNull().default(false),

  // Phase 2: Receipt Autopilot — per-company classifier config.
  // mode: 'hybrid' uses internal classifier first with OpenAI fallback; 'openai_only' bypasses internal model.
  // accuracyThreshold: when internal accuracy drops below this, the company is auto-switched to openai_only.
  // autopilotEnabled: when true, high-confidence receipts are auto-posted to the GL without user review.
  classifierConfig: jsonb("classifier_config").notNull().default(
    sql`'{"mode":"hybrid","accuracyThreshold":0.8,"autopilotEnabled":false}'::jsonb`
  ).$type<{
    mode: 'hybrid' | 'openai_only';
    accuracyThreshold: number;
    autopilotEnabled: boolean;
  }>(),

  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertCompanySchema = createInsertSchema(companies).omit({
  id: true,
  createdAt: true,
});

export type InsertCompany = z.infer<typeof insertCompanySchema>;
export type Company = typeof companies.$inferSelect;

// Schema for the QuickBooks-style Company Preferences page (PATCH /api/companies/:id).
// All fields are optional so the page can be saved partially and so legacy clients
// that omit a field continue to work.
export const companyPreferencesSchema = z.object({
  name: z.string().min(2, "Company name must be at least 2 characters").optional(),
  legalName: z.string().max(200).optional().nullable(),
  trnVatNumber: z
    .string()
    .regex(/^\d{15}$/u, "TRN must be exactly 15 digits")
    .optional()
    .nullable()
    .or(z.literal("").transform(() => null)),
  baseCurrency: z
    .enum(["AED", "USD", "EUR", "GBP", "SAR", "QAR", "KWD", "BHD", "OMR", "INR"]) // common GCC + global currencies
    .optional(),
  fiscalYearStartMonth: z.number().int().min(1).max(12).optional(),
  defaultVatRate: z.number().min(0).max(1).optional(), // stored as fraction (0.05 = 5%)
  addressStreet: z.string().max(200).optional().nullable(),
  addressCity: z.string().max(100).optional().nullable(),
  emirate: z
    .enum([
      "abu_dhabi",
      "dubai",
      "sharjah",
      "ajman",
      "umm_al_quwain",
      "ras_al_khaimah",
      "fujairah",
    ])
    .optional()
    .nullable(),
  addressCountry: z.string().max(2).optional().nullable(), // ISO-3166 alpha-2
  contactPhone: z.string().max(40).optional().nullable(),
  contactEmail: z
    .string()
    .email("Invalid email address")
    .optional()
    .nullable()
    .or(z.literal("").transform(() => null)),
  industry: z.string().max(100).optional().nullable(),
  logoUrl: z.string().optional().nullable(),
  dateFormat: z.enum(["DD/MM/YYYY", "MM/DD/YYYY", "YYYY-MM-DD"]).optional(),
  locale: z.enum(["en", "ar"]).optional(),
});

export type CompanyPreferences = z.infer<typeof companyPreferencesSchema>;

// ===========================
// Company Users (Many-to-Many)
// ===========================
export const companyUsers = pgTable("company_users", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  role: text("role").notNull().default("owner"), // owner | accountant | cfo | employee
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  companyUserUnique: unique("company_users_company_user_unique").on(table.companyId, table.userId),
  companyIdIdx: index("idx_company_users_company_id").on(table.companyId),
  userIdIdx: index("idx_company_users_user_id").on(table.userId),
}));

export const insertCompanyUserSchema = createInsertSchema(companyUsers).omit({
  id: true,
  createdAt: true,
});

export type InsertCompanyUser = z.infer<typeof insertCompanyUserSchema>;
export type CompanyUser = typeof companyUsers.$inferSelect;

// ===========================
// Firm Staff Assignments
// ===========================
// Links firm_admin users to specific client companies they can manage.
// firm_owner bypasses this table and sees all companies.
export const firmStaffAssignments = pgTable("firm_staff_assignments", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  // Role this staff member plays for the assigned client (e.g. accountant | reviewer | manager).
  // Phase 6 added this column so workload analytics can group by responsibility, not just assignment.
  role: text("role").notNull().default("accountant"),
  assignedAt: timestamp("assigned_at").defaultNow().notNull(),
}, (table) => ({
  userCompanyUnique: unique().on(table.userId, table.companyId),
  userIdIdx: index("idx_firm_staff_assignments_user_id").on(table.userId),
  companyIdIdx: index("idx_firm_staff_assignments_company_id").on(table.companyId),
}));

export const insertFirmStaffAssignmentSchema = createInsertSchema(firmStaffAssignments).omit({
  id: true,
  assignedAt: true,
});

export type InsertFirmStaffAssignment = z.infer<typeof insertFirmStaffAssignmentSchema>;
export type FirmStaffAssignment = typeof firmStaffAssignments.$inferSelect;

// ===========================
// Chart of Accounts
// ===========================
export const accounts = pgTable("accounts", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
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
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at"),
}, (table) => ({
  companyCodeUnique: unique().on(table.companyId, table.code),
  companyIdIdx: index("idx_accounts_company_id").on(table.companyId),
}));

export const insertAccountSchema = createInsertSchema(accounts).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).refine(
  (data) => {
    if (data.isVatAccount && !data.vatType) {
      return false;
    }
    if (!data.isVatAccount && data.vatType) {
      return false;
    }
    return true;
  },
  { message: "vatType must be provided when isVatAccount is true, and must be null when isVatAccount is false" }
);

export type InsertAccount = z.infer<typeof insertAccountSchema>;
export type Account = typeof accounts.$inferSelect;

// ===========================
// Journal Entries
// ===========================
export const journalEntries = pgTable("journal_entries", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  entryNumber: text("entry_number").notNull(),
  date: timestamp("date").notNull(),
  memo: text("memo"),
  // Status: draft entries can be edited, posted entries are immutable
  status: text("status").notNull().default("draft"), // draft | posted | void
  // Source tracking: where did this entry come from?
  source: text("source").notNull().default("manual"), // manual | invoice | receipt | payment | reversal | system
  sourceId: uuid("source_id"), // Reference to invoice, receipt, etc.
  // Reversal support: if this entry is a reversal, link to original
  reversedEntryId: uuid("reversed_entry_id").references((): any => journalEntries.id),
  reversalReason: text("reversal_reason"),
  // Audit trail
  createdBy: uuid("created_by").notNull().references((): any => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  postedBy: uuid("posted_by").references(() => users.id),
  postedAt: timestamp("posted_at"),
  updatedBy: uuid("updated_by").references(() => users.id),
  updatedAt: timestamp("updated_at"),
}, (table) => ({
  companyEntryUnique: unique().on(table.companyId, table.entryNumber),
  companyIdIdx: index("idx_journal_entries_company_id").on(table.companyId),
  companyDateIdx: index("idx_journal_entries_company_date").on(table.companyId, table.date),
  companyStatusIdx: index("idx_journal_entries_company_status").on(table.companyId, table.status),
}));

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
export const journalLines = pgTable("journal_lines", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  entryId: uuid("entry_id").notNull().references(() => journalEntries.id, { onDelete: "cascade" }),
  accountId: uuid("account_id").notNull().references(() => accounts.id),
  debit: money("debit").notNull().default(0),   // Always in base currency (AED)
  credit: money("credit").notNull().default(0), // Always in base currency (AED)
  description: text("description"), // Line-level description
  // Foreign currency tracking
  foreignCurrency: text("foreign_currency"), // null = AED, otherwise ISO code (USD, EUR, etc.)
  foreignDebit: money("foreign_debit").default(0),   // Original amount in foreign currency
  foreignCredit: money("foreign_credit").default(0), // Original amount in foreign currency
  exchangeRate: rate("exchange_rate").default(1),    // Rate used: 1 foreignCurrency = X AED
  // Reconciliation support
  isReconciled: boolean("is_reconciled").notNull().default(false),
  reconciledAt: timestamp("reconciled_at"),
  reconciledBy: uuid("reconciled_by").references(() => users.id),
  bankTransactionId: uuid("bank_transaction_id"), // Reference to matched bank transaction
}, (table) => ({
  entryIdIdx: index("idx_journal_lines_entry_id").on(table.entryId),
}));

export const insertJournalLineSchema = createInsertSchema(journalLines).omit({
  id: true,
  reconciledAt: true,
});

export type InsertJournalLine = z.infer<typeof insertJournalLineSchema>;
export type JournalLine = typeof journalLines.$inferSelect;

// ===========================
// Exchange Rates
// ===========================
export const exchangeRates = pgTable("exchange_rates", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  baseCurrency: text("base_currency").notNull().default("AED"),
  targetCurrency: text("target_currency").notNull(),
  rate: rate("rate").notNull(), // How many units of targetCurrency per 1 baseCurrency
  date: timestamp("date").notNull().defaultNow(),
  source: text("source").notNull().default("manual"), // manual | api
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertExchangeRateSchema = createInsertSchema(exchangeRates).omit({
  id: true,
  createdAt: true,
});

export type InsertExchangeRate = z.infer<typeof insertExchangeRateSchema>;
export type ExchangeRate = typeof exchangeRates.$inferSelect;

// ===========================
// Invoices
// ===========================
export const invoices = pgTable("invoices", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
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
  einvoiceStatus: text("einvoice_status"), // null | generated | submitted | accepted | rejected
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
  isRecurring: boolean("is_recurring").notNull().default(false),
  recurringInterval: text("recurring_interval"), // weekly | monthly | quarterly | yearly
  nextRecurringDate: timestamp("next_recurring_date"),
  recurringEndDate: timestamp("recurring_end_date"),
  contactId: uuid("contact_id").references((): any => customerContacts.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  companyNumberUnique: unique("invoices_company_number_unique").on(table.companyId, table.number),
  companyIdIdx: index("idx_invoices_company_id").on(table.companyId),
  companyDateIdx: index("idx_invoices_company_date").on(table.companyId, table.date),
  companyStatusIdx: index("idx_invoices_company_status").on(table.companyId, table.status),
  contactIdIdx: index("idx_invoices_contact_id").on(table.contactId),
}));

export const insertInvoiceSchema = createInsertSchema(invoices).omit({
  id: true,
  createdAt: true,
});

export type InsertInvoice = z.infer<typeof insertInvoiceSchema>;
export type Invoice = typeof invoices.$inferSelect;

// ===========================
// Invoice Lines
// ===========================
export const invoiceLines = pgTable("invoice_lines", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  invoiceId: uuid("invoice_id").notNull().references(() => invoices.id, { onDelete: "cascade" }),
  description: text("description").notNull(),
  quantity: real("quantity").notNull(),
  unitPrice: money("unit_price").notNull(),
  vatRate: vatRateType("vat_rate").notNull().default(0.05), // UAE standard 5%
  vatSupplyType: text("vat_supply_type").default("standard_rated"), // standard_rated | zero_rated | exempt | out_of_scope
}, (table) => ({
  invoiceIdIdx: index("idx_invoice_lines_invoice_id").on(table.invoiceId),
}));

export const insertInvoiceLineSchema = createInsertSchema(invoiceLines).omit({
  id: true,
});

export type InsertInvoiceLine = z.infer<typeof insertInvoiceLineSchema>;
export type InvoiceLine = typeof invoiceLines.$inferSelect;

// ===========================
// Invoice Payments
// ===========================
export const invoicePayments = pgTable("invoice_payments", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  invoiceId: uuid("invoice_id").notNull().references(() => invoices.id, { onDelete: "cascade" }),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  amount: money("amount").notNull(),
  date: timestamp("date").notNull(),
  method: text("method").notNull().default("bank"), // cash | bank | cheque | online
  reference: text("reference"),
  notes: text("notes"),
  paymentAccountId: uuid("payment_account_id").references(() => accounts.id),
  journalEntryId: uuid("journal_entry_id").references(() => journalEntries.id),
  createdBy: uuid("created_by").notNull().references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  invoiceIdIdx: index("idx_invoice_payments_invoice_id").on(table.invoiceId),
  companyIdIdx: index("idx_invoice_payments_company_id").on(table.companyId),
}));

export const insertInvoicePaymentSchema = createInsertSchema(invoicePayments).omit({
  id: true,
  createdAt: true,
});

export type InsertInvoicePayment = z.infer<typeof insertInvoicePaymentSchema>;
export type InvoicePayment = typeof invoicePayments.$inferSelect;

// ===========================
// Recurring Invoices
// ===========================
export const recurringInvoices = pgTable("recurring_invoices", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
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
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  companyIdIdx: index("idx_recurring_invoices_company_id").on(table.companyId),
  nextRunActiveIdx: index("idx_recurring_invoices_next_run_active").on(table.isActive, table.nextRunDate),
}));

export const insertRecurringInvoiceSchema = createInsertSchema(recurringInvoices).omit({
  id: true,
  createdAt: true,
});

export type InsertRecurringInvoice = z.infer<typeof insertRecurringInvoiceSchema>;
export type RecurringInvoice = typeof recurringInvoices.$inferSelect;

// ===========================
// Receipts/Documents
// ===========================
export const receipts = pgTable("receipts", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  merchant: text("merchant"),
  date: timestamp("date"),
  amount: money("amount"),
  vatAmount: money("vat_amount"),
  currency: text("currency").default("AED"),
  exchangeRate: rate("exchange_rate").notNull().default(1), // Rate to AED at time of transaction
  baseCurrencyAmount: money("base_currency_amount").notNull().default(0), // Amount in AED
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
  uploadedBy: uuid("uploaded_by").notNull().references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  companyIdIdx: index("idx_receipts_company_id").on(table.companyId),
  companyDateIdx: index("idx_receipts_company_date").on(table.companyId, table.date),
  companyPostedIdx: index("idx_receipts_company_posted").on(table.companyId, table.posted),
}));

export const insertReceiptSchema = createInsertSchema(receipts).omit({
  id: true,
  createdAt: true,
});

export type InsertReceipt = z.infer<typeof insertReceiptSchema>;
export type Receipt = typeof receipts.$inferSelect;

// ===========================
// Products / Inventory
// ===========================
export const products = pgTable("products", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  nameAr: text("name_ar"),
  sku: text("sku"),
  description: text("description"),
  unitPrice: money("unit_price").notNull().default(0),
  costPrice: money("cost_price").default(0),
  vatRate: vatRateType("vat_rate").notNull().default(0.05),
  unit: text("unit").notNull().default("pcs"), // pcs, kg, m, hr, etc.
  currentStock: integer("current_stock").notNull().default(0),
  lowStockThreshold: integer("low_stock_threshold").default(10),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  companyIdIdx: index("idx_products_company_id").on(table.companyId),
}));

export const insertProductSchema = createInsertSchema(products).omit({
  id: true,
  createdAt: true,
});

export type InsertProduct = z.infer<typeof insertProductSchema>;
export type Product = typeof products.$inferSelect;

// ===========================
// Inventory Movements
// ===========================
export const inventoryMovements = pgTable("inventory_movements", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  productId: uuid("product_id").notNull().references(() => products.id, { onDelete: "cascade" }),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  type: text("type").notNull(), // purchase | sale | adjustment | return
  quantity: integer("quantity").notNull(),
  unitCost: money("unit_cost"),
  reference: text("reference"), // e.g., "Invoice INV-001" or "Manual adjustment"
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  productIdIdx: index("idx_inventory_movements_product_id").on(table.productId),
  companyIdIdx: index("idx_inventory_movements_company_id").on(table.companyId),
}));

export const insertInventoryMovementSchema = createInsertSchema(inventoryMovements).omit({
  id: true,
  createdAt: true,
});

export type InsertInventoryMovement = z.infer<typeof insertInventoryMovementSchema>;
export type InventoryMovement = typeof inventoryMovements.$inferSelect;

// ===========================
// Customer Contacts (for invoicing)
// ===========================
export const customerContacts = pgTable("customer_contacts", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  nameAr: text("name_ar"),
  email: text("email"),
  phone: text("phone"),
  whatsappNumber: text("whatsapp_number"),
  trnNumber: text("trn_number"),
  address: text("address"),
  city: text("city"),
  country: text("country").default("UAE"),
  contactPerson: text("contact_person"),
  paymentTerms: integer("payment_terms").default(30),
  notes: text("notes"),
  isActive: boolean("is_active").default(true).notNull(),
  portalAccessToken: text("portal_access_token").unique(),
  portalAccessExpiresAt: timestamp("portal_access_expires_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at"),
}, (table) => ({
  companyIdIdx: index("idx_customer_contacts_company_id").on(table.companyId),
}));

export const insertCustomerContactSchema = createInsertSchema(customerContacts).omit({
  id: true,
  portalAccessToken: true,
  portalAccessExpiresAt: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertCustomerContact = z.infer<typeof insertCustomerContactSchema>;
export type CustomerContact = typeof customerContacts.$inferSelect;

// ===========================
// Additional Types for Frontend
// ===========================

// Complete invoice with lines and payments
export interface InvoiceWithLines extends Invoice {
  lines: InvoiceLine[];
  payments?: InvoicePayment[];
}

// Complete journal entry with lines
export interface JournalEntryWithLines extends JournalEntry {
  lines: (JournalLine & { account: Account })[];
}

// AI Categorization Request/Response
export const categorizationRequestSchema = z.object({
  companyId: z.string().uuid(),
  description: z.string().min(1),
  amount: z.number(),
  currency: z.string().default("AED"),
});

export type CategorizationRequest = z.infer<typeof categorizationRequestSchema>;

export interface CategorizationResponse {
  suggestedAccountCode: string;
  suggestedAccountName: string;
  confidence: number;
  reason: string;
}

// Financial Reports Types
export interface ProfitLossReport {
  revenue: { accountCode: string; accountName: string; amount: number }[];
  expenses: { accountCode: string; accountName: string; amount: number }[];
  totalRevenue: number;
  totalExpenses: number;
  netProfit: number;
}

export interface BalanceSheetReport {
  assets: { accountCode: string; accountName: string; amount: number }[];
  liabilities: { accountCode: string; accountName: string; amount: number }[];
  equity: { accountCode: string; accountName: string; amount: number }[];
  totalAssets: number;
  totalLiabilities: number;
  totalEquity: number;
}

export interface VATSummaryReport {
  period: string;
  salesSubtotal: number;
  salesVAT: number;
  purchasesSubtotal: number;
  purchasesVAT: number;
  netVATPayable: number;
}

export interface UnrealizedFxGainLoss {
  entityType: 'invoice' | 'payable';
  entityId: string;
  entityNumber: string;
  counterparty: string;
  currency: string;
  foreignAmount: number;
  transactionRate: number;    // Rate when transaction was recorded
  currentRate: number;        // Latest known rate
  bookValueAed: number;       // Value at transaction rate
  currentValueAed: number;    // Value at current rate
  unrealizedGainLoss: number; // Positive = gain, negative = loss
}

export interface FxGainsLossesReport {
  asOf: string;
  baseCurrency: string;
  receivables: UnrealizedFxGainLoss[];
  payables: UnrealizedFxGainLoss[];
  totalUnrealizedGain: number;
  totalUnrealizedLoss: number;
  netUnrealizedGainLoss: number;
}

// ===========================
// Waitlist / Email Collection
// ===========================
export const waitlist = pgTable("waitlist", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  email: text("email").notNull().unique(),
  source: text("source").notNull().default("landing_page"), // landing_page | popup | other
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertWaitlistSchema = createInsertSchema(waitlist).omit({
  id: true,
  createdAt: true,
});

export type InsertWaitlist = z.infer<typeof insertWaitlistSchema>;
export type Waitlist = typeof waitlist.$inferSelect;

// ===========================
// Integration Sync History
// ===========================
export const integrationSyncs = pgTable("integration_syncs", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  integrationType: text("integration_type").notNull(), // google_sheets | xero | quickbooks | whatsapp
  syncType: text("sync_type").notNull(), // export | import
  dataType: text("data_type").notNull(), // invoices | expenses | journal_entries | chart_of_accounts
  status: text("status").notNull().default("completed"), // pending | in_progress | completed | failed
  recordCount: integer("record_count"),
  externalId: text("external_id"), // Spreadsheet ID, etc.
  externalUrl: text("external_url"), // Link to the spreadsheet, etc.
  errorMessage: text("error_message"),
  syncedAt: timestamp("synced_at").defaultNow().notNull(),
}, (table) => ({
  companyIdIdx: index("idx_integration_syncs_company_id").on(table.companyId),
}));

export const insertIntegrationSyncSchema = createInsertSchema(integrationSyncs).omit({
  id: true,
  syncedAt: true,
});

export type InsertIntegrationSync = z.infer<typeof insertIntegrationSyncSchema>;
export type IntegrationSync = typeof integrationSyncs.$inferSelect;

// ===========================
// WhatsApp Integration
// ===========================
export const whatsappConfigs = pgTable("whatsapp_configs", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  phoneNumberId: text("phone_number_id"),
  accessToken: text("access_token"),
  webhookVerifyToken: text("webhook_verify_token"),
  businessAccountId: text("business_account_id"),
  isActive: boolean("is_active").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  companyIdIdx: index("idx_whatsapp_configs_company_id").on(table.companyId),
}));

export const insertWhatsappConfigSchema = createInsertSchema(whatsappConfigs).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertWhatsappConfig = z.infer<typeof insertWhatsappConfigSchema>;
export type WhatsappConfig = typeof whatsappConfigs.$inferSelect;

// WhatsApp Message Logs
export const whatsappMessages = pgTable("whatsapp_messages", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  waMessageId: text("wa_message_id").notNull(),
  from: text("from_number").notNull(),
  to: text("to_number"),
  messageType: text("message_type").notNull(), // text | image | document
  content: text("content"),
  mediaUrl: text("media_url"),
  mediaId: text("media_id"),
  direction: text("direction").notNull().default("inbound"), // inbound | outbound
  status: text("status").notNull().default("received"), // received | processing | processed | failed
  receiptId: uuid("receipt_id").references(() => receipts.id), // Link to created receipt
  errorMessage: text("error_message"),
  processedAt: timestamp("processed_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  companyIdIdx: index("idx_whatsapp_messages_company_id").on(table.companyId),
}));

export const insertWhatsappMessageSchema = createInsertSchema(whatsappMessages).omit({
  id: true,
  createdAt: true,
});

export type InsertWhatsappMessage = z.infer<typeof insertWhatsappMessageSchema>;
export type WhatsappMessage = typeof whatsappMessages.$inferSelect;

// ===========================
// AI Anomaly Detection
// ===========================
export const anomalyAlerts = pgTable("anomaly_alerts", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
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
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  companyIdIdx: index("idx_anomaly_alerts_company_id").on(table.companyId),
  companyResolvedIdx: index("idx_anomaly_alerts_company_resolved").on(table.companyId, table.isResolved),
}));

export const insertAnomalyAlertSchema = createInsertSchema(anomalyAlerts).omit({
  id: true,
  createdAt: true,
});

export type InsertAnomalyAlert = z.infer<typeof insertAnomalyAlertSchema>;
export type AnomalyAlert = typeof anomalyAlerts.$inferSelect;

// ===========================
// Bank Accounts (managed bank accounts linked to GL)
// ===========================
export const bankAccounts = pgTable("bank_accounts", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  nameEn: text("name_en").notNull(), // Display name e.g. "Emirates NBD Current"
  bankName: text("bank_name").notNull(), // Emirates NBD | ADCB | FAB | Mashreq | Other
  accountNumber: text("account_number"),
  iban: text("iban"),
  currency: text("currency").notNull().default("AED"),
  glAccountId: uuid("gl_account_id").references(() => accounts.id), // Linked GL account
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  companyIdIdx: index("idx_bank_accounts_company_id").on(table.companyId),
}));

export const insertBankAccountSchema = createInsertSchema(bankAccounts).omit({
  id: true,
  createdAt: true,
});

export type InsertBankAccount = z.infer<typeof insertBankAccountSchema>;
export type BankAccount = typeof bankAccounts.$inferSelect;

// ===========================
// Bank Transactions (for reconciliation)
// ===========================
export const bankTransactions = pgTable("bank_transactions", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  bankAccountId: uuid("bank_account_id").references(() => accounts.id), // Links to bank account in COA
  bankStatementAccountId: uuid("bank_statement_account_id").references(() => bankAccounts.id), // Links to managed bank account
  transactionDate: timestamp("transaction_date").notNull(),
  description: text("description").notNull(),
  amount: money("amount").notNull(), // Positive for credits, negative for debits
  balance: money("balance"), // Running balance from bank statement
  reference: text("reference"), // Bank reference number
  category: text("category"), // AI-suggested category
  matchStatus: text("match_status").notNull().default("unmatched"), // matched | suggested | unmatched
  isReconciled: boolean("is_reconciled").notNull().default(false),
  matchedJournalEntryId: uuid("matched_journal_entry_id").references(() => journalEntries.id),
  matchedReceiptId: uuid("matched_receipt_id").references(() => receipts.id),
  matchedInvoiceId: uuid("matched_invoice_id").references(() => invoices.id),
  matchConfidence: real("match_confidence"), // AI confidence for the match
  importSource: text("import_source"), // manual | csv | api
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  bankAccountIdIdx: index("idx_bank_transactions_bank_account_id").on(table.bankAccountId),
  companyIdIdx: index("idx_bank_transactions_company_id").on(table.companyId),
  companyMatchStatusIdx: index("idx_bank_transactions_company_match").on(table.companyId, table.matchStatus),
}));

export const insertBankTransactionSchema = createInsertSchema(bankTransactions).omit({
  id: true,
  createdAt: true,
});

export type InsertBankTransaction = z.infer<typeof insertBankTransactionSchema>;
export type BankTransaction = typeof bankTransactions.$inferSelect;

// ===========================
// Cash Flow Forecasts
// ===========================
export const cashFlowForecasts = pgTable("cash_flow_forecasts", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  forecastDate: timestamp("forecast_date").notNull(),
  forecastType: text("forecast_type").notNull(), // daily | weekly | monthly
  predictedInflow: money("predicted_inflow").notNull().default(0),
  predictedOutflow: money("predicted_outflow").notNull().default(0),
  predictedBalance: money("predicted_balance").notNull().default(0),
  confidenceLevel: real("confidence_level"), // 0-1
  factors: text("factors"), // JSON string of contributing factors
  generatedAt: timestamp("generated_at").defaultNow().notNull(),
}, (table) => ({
  companyIdIdx: index("idx_cash_flow_forecasts_company_id").on(table.companyId),
}));

export const insertCashFlowForecastSchema = createInsertSchema(cashFlowForecasts).omit({
  id: true,
  generatedAt: true,
});

export type InsertCashFlowForecast = z.infer<typeof insertCashFlowForecastSchema>;
export type CashFlowForecast = typeof cashFlowForecasts.$inferSelect;

// ===========================
// AI Transaction Classifications (for ML-style learning)
// ===========================
export const transactionClassifications = pgTable("transaction_classifications", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  description: text("description").notNull(),
  merchant: text("merchant"),
  amount: money("amount"),
  suggestedAccountId: uuid("suggested_account_id").references(() => accounts.id),
  suggestedCategory: text("suggested_category"),
  aiConfidence: real("ai_confidence"), // 0-1
  aiReason: text("ai_reason"),
  wasAccepted: boolean("was_accepted"), // User feedback for ML improvement
  userSelectedAccountId: uuid("user_selected_account_id").references(() => accounts.id),
  // Phase 2: Receipt Autopilot — which classifier produced this suggestion.
  // 'rule' = ai_company_rules match, 'keyword' = UAE keyword pattern, 'statistical' = Naive Bayes,
  // 'openai' = LLM fallback. Used to compute per-method accuracy and trip the openai_only failsafe.
  classifierMethod: text("classifier_method"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  companyIdIdx: index("idx_transaction_classifications_company_id").on(table.companyId),
}));

export const insertTransactionClassificationSchema = createInsertSchema(transactionClassifications).omit({
  id: true,
  createdAt: true,
});

export type InsertTransactionClassification = z.infer<typeof insertTransactionClassificationSchema>;
export type TransactionClassification = typeof transactionClassifications.$inferSelect;

export type ClassifierMethod = 'rule' | 'keyword' | 'statistical' | 'openai';
export type ClassifierMode = 'hybrid' | 'openai_only';

export interface ClassifierConfig {
  mode: ClassifierMode;
  accuracyThreshold: number;
  autopilotEnabled: boolean;
}

export const DEFAULT_CLASSIFIER_CONFIG: ClassifierConfig = {
  mode: 'hybrid',
  accuracyThreshold: 0.8,
  autopilotEnabled: false,
};

// ===========================
// Budgets (for Budget vs Actual)
// ===========================
export const budgets = pgTable("budgets", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  accountId: uuid("account_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
  year: integer("year").notNull(),
  month: integer("month").notNull(), // 1-12
  budgetAmount: money("budget_amount").notNull().default(0),
  notes: text("notes"),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  companyPeriodIdx: index("idx_budgets_company_period").on(table.companyId, table.year, table.month),
}));

export const insertBudgetSchema = createInsertSchema(budgets).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertBudget = z.infer<typeof insertBudgetSchema>;
export type Budget = typeof budgets.$inferSelect;

// ===========================
// E-Commerce Integrations (Stripe, Shopify, Salesforce)
// ===========================
export const ecommerceIntegrations = pgTable("ecommerce_integrations", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  platform: text("platform").notNull(), // stripe | shopify | salesforce
  isActive: boolean("is_active").notNull().default(false),
  accessToken: text("access_token"), // Encrypted OAuth token
  refreshToken: text("refresh_token"),
  tokenExpiresAt: timestamp("token_expires_at"),
  shopDomain: text("shop_domain"), // Shopify shop domain
  apiKey: text("api_key"), // API key if needed
  webhookSecret: text("webhook_secret"),
  lastSyncAt: timestamp("last_sync_at"),
  syncStatus: text("sync_status").default("never"), // never | syncing | success | failed
  syncError: text("sync_error"),
  settings: text("settings"), // JSON config for mapping
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  companyIdIdx: index("idx_ecommerce_integrations_company_id").on(table.companyId),
}));

export const insertEcommerceIntegrationSchema = createInsertSchema(ecommerceIntegrations).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertEcommerceIntegration = z.infer<typeof insertEcommerceIntegrationSchema>;
export type EcommerceIntegration = typeof ecommerceIntegrations.$inferSelect;

// ===========================
// E-Commerce Transactions (imported from platforms)
// ===========================
export const ecommerceTransactions = pgTable("ecommerce_transactions", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  integrationId: uuid("integration_id").notNull().references(() => ecommerceIntegrations.id, { onDelete: "cascade" }),
  platform: text("platform").notNull(), // stripe | shopify | salesforce
  externalId: text("external_id").notNull(), // Platform's transaction ID
  transactionType: text("transaction_type").notNull(), // payment | refund | order | invoice
  amount: money("amount").notNull(),
  currency: text("currency").notNull().default("AED"),
  customerName: text("customer_name"),
  customerEmail: text("customer_email"),
  description: text("description"),
  status: text("status").notNull(), // succeeded | pending | failed | refunded
  platformFees: money("platform_fees"), // Stripe/Shopify fees
  netAmount: money("net_amount"), // Amount after fees
  transactionDate: timestamp("transaction_date").notNull(),
  metadata: text("metadata"), // JSON with platform-specific data
  isReconciled: boolean("is_reconciled").notNull().default(false),
  journalEntryId: uuid("journal_entry_id").references(() => journalEntries.id),
  invoiceId: uuid("invoice_id").references(() => invoices.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  companyIdIdx: index("idx_ecommerce_transactions_company_id").on(table.companyId),
  integrationIdIdx: index("idx_ecommerce_transactions_integration_id").on(table.integrationId),
}));

export const insertEcommerceTransactionSchema = createInsertSchema(ecommerceTransactions).omit({
  id: true,
  createdAt: true,
});

export type InsertEcommerceTransaction = z.infer<typeof insertEcommerceTransactionSchema>;
export type EcommerceTransaction = typeof ecommerceTransactions.$inferSelect;

// ===========================
// Financial KPIs (for real-time indicators)
// ===========================
export const financialKpis = pgTable("financial_kpis", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  kpiType: text("kpi_type").notNull(), // profit_margin | expense_ratio | revenue_growth | cash_runway | dso | current_ratio
  period: text("period").notNull(), // daily | weekly | monthly | quarterly
  periodStart: timestamp("period_start").notNull(),
  periodEnd: timestamp("period_end").notNull(),
  value: real("value").notNull(),
  previousValue: real("previous_value"),
  changePercent: real("change_percent"),
  trend: text("trend"), // up | down | stable
  benchmark: real("benchmark"), // Industry benchmark
  calculatedAt: timestamp("calculated_at").defaultNow().notNull(),
}, (table) => ({
  companyIdIdx: index("idx_financial_kpis_company_id").on(table.companyId),
}));

export const insertFinancialKpiSchema = createInsertSchema(financialKpis).omit({
  id: true,
  calculatedAt: true,
});

export type InsertFinancialKpi = z.infer<typeof insertFinancialKpiSchema>;
export type FinancialKpi = typeof financialKpis.$inferSelect;

// ===========================
// Smart Reminders & Notifications
// ===========================
export const notifications = pgTable("notifications", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
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
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  userIdIdx: index("idx_notifications_user_id").on(table.userId),
  userUnreadIdx: index("idx_notifications_user_unread").on(table.userId, table.isRead),
  companyIdIdx: index("idx_notifications_company_id").on(table.companyId),
}));

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
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
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
export const reminderSettings = pgTable("reminder_settings", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
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
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  companyIdIdx: index("idx_reminder_settings_company_id").on(table.companyId),
}));

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
export const reminderLogs = pgTable("reminder_logs", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
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
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  companyIdIdx: index("idx_reminder_logs_company_id").on(table.companyId),
  relatedEntityIdx: index("idx_reminder_logs_related_entity").on(table.relatedEntityType, table.relatedEntityId),
}));

export const insertReminderLogSchema = createInsertSchema(reminderLogs).omit({
  id: true,
  createdAt: true,
});

export type InsertReminderLog = z.infer<typeof insertReminderLogSchema>;
export type ReminderLog = typeof reminderLogs.$inferSelect;

// ===========================
// User Onboarding Progress
// ===========================
export const userOnboarding = pgTable("user_onboarding", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  // Onboarding steps completed
  hasCompletedWelcome: boolean("has_completed_welcome").notNull().default(false),
  hasCreatedCompany: boolean("has_created_company").notNull().default(false),
  hasSetupChartOfAccounts: boolean("has_setup_chart_of_accounts").notNull().default(false),
  hasCreatedFirstInvoice: boolean("has_created_first_invoice").notNull().default(false),
  hasUploadedFirstReceipt: boolean("has_uploaded_first_receipt").notNull().default(false),
  hasViewedReports: boolean("has_viewed_reports").notNull().default(false),
  hasExploredAI: boolean("has_explored_ai").notNull().default(false),
  hasConfiguredReminders: boolean("has_configured_reminders").notNull().default(false),
  // Progress tracking
  currentStep: integer("current_step").notNull().default(0),
  totalSteps: integer("total_steps").notNull().default(8),
  isOnboardingComplete: boolean("is_onboarding_complete").notNull().default(false),
  completedAt: timestamp("completed_at"),
  // UI preferences
  showTips: boolean("show_tips").notNull().default(true),
  showTour: boolean("show_tour").notNull().default(true),
  dismissedTips: text("dismissed_tips"), // JSON array of dismissed tip IDs
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  userIdIdx: index("idx_user_onboarding_user_id").on(table.userId),
}));

export const insertUserOnboardingSchema = createInsertSchema(userOnboarding).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertUserOnboarding = z.infer<typeof insertUserOnboardingSchema>;
export type UserOnboarding = typeof userOnboarding.$inferSelect;

// ===========================
// Help Tips (contextual help)
// ===========================
export const helpTips = pgTable("help_tips", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  tipKey: text("tip_key").notNull().unique(), // Unique identifier for the tip location
  title: text("title").notNull(),
  titleAr: text("title_ar"),
  content: text("content").notNull(),
  contentAr: text("content_ar"),
  pageContext: text("page_context").notNull(), // dashboard | invoices | receipts | journal | reports | settings
  targetElement: text("target_element"), // CSS selector for element to highlight
  tipType: text("tip_type").notNull().default("tooltip"), // tooltip | popover | modal | tour_step
  order: integer("order").default(0), // For tour ordering
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertHelpTipSchema = createInsertSchema(helpTips).omit({
  id: true,
  createdAt: true,
});

export type InsertHelpTip = z.infer<typeof insertHelpTipSchema>;
export type HelpTip = typeof helpTips.$inferSelect;

// ===========================
// Referral Codes
// ===========================
export const referralCodes = pgTable("referral_codes", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  code: text("code").notNull().unique(), // Unique referral code
  customSlug: text("custom_slug").unique(), // User-friendly custom slug
  isActive: boolean("is_active").notNull().default(true),
  // Reward configuration
  referrerRewardType: text("referrer_reward_type").default("credit"), // credit | discount | subscription_days
  referrerRewardValue: money("referrer_reward_value").default(0),
  refereeRewardType: text("referee_reward_type").default("discount"), // credit | discount | trial_extension
  refereeRewardValue: money("referee_reward_value").default(0),
  // Tracking
  totalReferrals: integer("total_referrals").notNull().default(0),
  successfulReferrals: integer("successful_referrals").notNull().default(0),
  totalRewardsEarned: money("total_rewards_earned").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  expiresAt: timestamp("expires_at"),
});

export const insertReferralCodeSchema = createInsertSchema(referralCodes).omit({
  id: true,
  createdAt: true,
});

export type InsertReferralCode = z.infer<typeof insertReferralCodeSchema>;
export type ReferralCode = typeof referralCodes.$inferSelect;

// ===========================
// Referrals (tracking sign-ups)
// ===========================
export const referrals = pgTable("referrals", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  referralCodeId: uuid("referral_code_id").notNull().references(() => referralCodes.id, { onDelete: "cascade" }),
  referrerId: uuid("referrer_id").notNull().references(() => users.id),
  refereeId: uuid("referee_id").references(() => users.id), // Null until they sign up
  refereeEmail: text("referee_email"), // Email before sign-up
  status: text("status").notNull().default("pending"), // pending | signed_up | qualified | rewarded | expired
  // Reward tracking
  referrerRewardStatus: text("referrer_reward_status").default("pending"), // pending | credited | used
  refereeRewardStatus: text("referee_reward_status").default("pending"),
  referrerRewardAmount: money("referrer_reward_amount"),
  refereeRewardAmount: money("referee_reward_amount"),
  // Qualification criteria
  qualificationCriteria: text("qualification_criteria"), // JSON with criteria met
  qualifiedAt: timestamp("qualified_at"),
  rewardedAt: timestamp("rewarded_at"),
  // Tracking
  signupSource: text("signup_source"), // link | email | social
  createdAt: timestamp("created_at").defaultNow().notNull(),
  expiresAt: timestamp("expires_at"),
});

export const insertReferralSchema = createInsertSchema(referrals).omit({
  id: true,
  createdAt: true,
});

export type InsertReferral = z.infer<typeof insertReferralSchema>;
export type Referral = typeof referrals.$inferSelect;

// ===========================
// User Feedback
// ===========================
export const userFeedback = pgTable("user_feedback", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
  companyId: uuid("company_id").references(() => companies.id, { onDelete: "set null" }),
  feedbackType: text("feedback_type").notNull(), // bug | feature_request | improvement | praise | complaint | nps | survey
  category: text("category"), // ui | performance | feature | billing | support | other
  pageContext: text("page_context"), // Which page they were on
  rating: integer("rating"), // 1-5 or 0-10 for NPS
  title: text("title"),
  message: text("message").notNull(),
  screenshot: text("screenshot"), // Base64 or URL
  browserInfo: text("browser_info"), // JSON with browser/device info
  // Response tracking
  status: text("status").notNull().default("new"), // new | reviewed | in_progress | resolved | wont_fix
  assignedTo: text("assigned_to"),
  responseMessage: text("response_message"),
  respondedAt: timestamp("responded_at"),
  // Contact preference
  allowContact: boolean("allow_contact").notNull().default(true),
  contactEmail: text("contact_email"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertUserFeedbackSchema = createInsertSchema(userFeedback).omit({
  id: true,
  createdAt: true,
});

export type InsertUserFeedback = z.infer<typeof insertUserFeedbackSchema>;
export type UserFeedback = typeof userFeedback.$inferSelect;

// ===========================
// Analytics Events
// ===========================
export const analyticsEvents = pgTable("analytics_events", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
  companyId: uuid("company_id").references(() => companies.id, { onDelete: "set null" }),
  sessionId: text("session_id"),
  eventType: text("event_type").notNull(), // page_view | click | feature_use | error | conversion | search
  eventName: text("event_name").notNull(), // Specific event identifier
  pageUrl: text("page_url"),
  pageTitle: text("page_title"),
  // Event-specific data
  properties: text("properties"), // JSON with event properties
  value: real("value"), // Numeric value if applicable
  // Context
  referrer: text("referrer"),
  deviceType: text("device_type"), // desktop | mobile | tablet
  browser: text("browser"),
  os: text("os"),
  country: text("country"),
  language: text("language"),
  // Timing
  duration: integer("duration"), // Time spent in ms
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertAnalyticsEventSchema = createInsertSchema(analyticsEvents).omit({
  id: true,
  createdAt: true,
});

export type InsertAnalyticsEvent = z.infer<typeof insertAnalyticsEventSchema>;
export type AnalyticsEvent = typeof analyticsEvents.$inferSelect;

// ===========================
// Feature Usage Metrics (aggregated)
// ===========================
export const featureUsageMetrics = pgTable("feature_usage_metrics", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  featureName: text("feature_name").notNull(),
  period: text("period").notNull(), // daily | weekly | monthly
  periodStart: timestamp("period_start").notNull(),
  periodEnd: timestamp("period_end").notNull(),
  totalUsers: integer("total_users").notNull().default(0),
  totalSessions: integer("total_sessions").notNull().default(0),
  totalEvents: integer("total_events").notNull().default(0),
  avgDuration: real("avg_duration"), // Average time spent
  conversionRate: real("conversion_rate"), // If applicable
  errorRate: real("error_rate"),
  calculatedAt: timestamp("calculated_at").defaultNow().notNull(),
});

export const insertFeatureUsageMetricSchema = createInsertSchema(featureUsageMetrics).omit({
  id: true,
  calculatedAt: true,
});

export type InsertFeatureUsageMetric = z.infer<typeof insertFeatureUsageMetricSchema>;
export type FeatureUsageMetric = typeof featureUsageMetrics.$inferSelect;

// ===========================
// Admin Settings (Platform-wide)
// ===========================
export const adminSettings = pgTable("admin_settings", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  key: text("key").notNull().unique(),
  value: text("value").notNull(),
  category: text("category").notNull(), // pricing | features | system | integrations | notifications
  description: text("description"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  updatedBy: uuid("updated_by").references(() => users.id),
});

export const insertAdminSettingSchema = createInsertSchema(adminSettings).omit({
  id: true,
  updatedAt: true,
});

export type InsertAdminSetting = z.infer<typeof insertAdminSettingSchema>;
export type AdminSetting = typeof adminSettings.$inferSelect;

// ===========================
// Subscription Plans
// ===========================
export const subscriptionPlans = pgTable("subscription_plans", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  nameAr: text("name_ar"),
  description: text("description"),
  descriptionAr: text("description_ar"),
  priceMonthly: money("price_monthly").notNull(),
  priceYearly: money("price_yearly"),
  currency: text("currency").notNull().default("AED"),
  features: text("features"), // JSON array of features
  maxCompanies: integer("max_companies").default(1),
  maxUsers: integer("max_users").default(1),
  maxInvoicesPerMonth: integer("max_invoices_per_month"),
  maxReceiptsPerMonth: integer("max_receipts_per_month"),
  aiCreditsPerMonth: integer("ai_credits_per_month").default(100),
  hasWhatsappIntegration: boolean("has_whatsapp_integration").default(false),
  hasAdvancedReports: boolean("has_advanced_reports").default(false),
  hasApiAccess: boolean("has_api_access").default(false),
  isActive: boolean("is_active").notNull().default(true),
  sortOrder: integer("sort_order").default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertSubscriptionPlanSchema = createInsertSchema(subscriptionPlans).omit({
  id: true,
  createdAt: true,
});

export type InsertSubscriptionPlan = z.infer<typeof insertSubscriptionPlanSchema>;
export type SubscriptionPlan = typeof subscriptionPlans.$inferSelect;

// ===========================
// User Subscriptions
// ===========================
export const userSubscriptions = pgTable("user_subscriptions", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  planId: uuid("plan_id").notNull().references(() => subscriptionPlans.id),
  status: text("status").notNull().default("active"), // active | cancelled | expired | trial
  billingCycle: text("billing_cycle").notNull().default("monthly"), // monthly | yearly
  currentPeriodStart: timestamp("current_period_start").notNull(),
  currentPeriodEnd: timestamp("current_period_end").notNull(),
  cancelledAt: timestamp("cancelled_at"),
  trialEndsAt: timestamp("trial_ends_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertUserSubscriptionSchema = createInsertSchema(userSubscriptions).omit({
  id: true,
  createdAt: true,
});

export type InsertUserSubscription = z.infer<typeof insertUserSubscriptionSchema>;
export type UserSubscription = typeof userSubscriptions.$inferSelect;

// ===========================
// VAT Returns (for FTA VAT 201 compliance)
// Matches official FTA VAT 201 Return format
// ===========================
export const vatReturns = pgTable("vat_returns", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  
  // Period information
  periodStart: timestamp("period_start").notNull(),
  periodEnd: timestamp("period_end").notNull(),
  dueDate: timestamp("due_date").notNull(),
  taxYearEnd: timestamp("tax_year_end"),
  vatStagger: text("vat_stagger").default("quarterly"), // quarterly | monthly
  status: text("status").notNull().default("draft"), // draft | pending_review | submitted | filed | amended
  
  // ===== VAT ON SALES AND ALL OTHER OUTPUTS =====
  // Box 1a-1g: Standard Rated Supplies by Emirate (Amount, VAT, Adjustment)
  box1aAbuDhabiAmount: money("box1a_abu_dhabi_amount").notNull().default(0),
  box1aAbuDhabiVat: money("box1a_abu_dhabi_vat").notNull().default(0),
  box1aAbuDhabiAdj: money("box1a_abu_dhabi_adj").notNull().default(0),

  box1bDubaiAmount: money("box1b_dubai_amount").notNull().default(0),
  box1bDubaiVat: money("box1b_dubai_vat").notNull().default(0),
  box1bDubaiAdj: money("box1b_dubai_adj").notNull().default(0),

  box1cSharjahAmount: money("box1c_sharjah_amount").notNull().default(0),
  box1cSharjahVat: money("box1c_sharjah_vat").notNull().default(0),
  box1cSharjahAdj: money("box1c_sharjah_adj").notNull().default(0),

  box1dAjmanAmount: money("box1d_ajman_amount").notNull().default(0),
  box1dAjmanVat: money("box1d_ajman_vat").notNull().default(0),
  box1dAjmanAdj: money("box1d_ajman_adj").notNull().default(0),

  box1eUmmAlQuwainAmount: money("box1e_umm_al_quwain_amount").notNull().default(0),
  box1eUmmAlQuwainVat: money("box1e_umm_al_quwain_vat").notNull().default(0),
  box1eUmmAlQuwainAdj: money("box1e_umm_al_quwain_adj").notNull().default(0),

  box1fRasAlKhaimahAmount: money("box1f_ras_al_khaimah_amount").notNull().default(0),
  box1fRasAlKhaimahVat: money("box1f_ras_al_khaimah_vat").notNull().default(0),
  box1fRasAlKhaimahAdj: money("box1f_ras_al_khaimah_adj").notNull().default(0),

  box1gFujairahAmount: money("box1g_fujairah_amount").notNull().default(0),
  box1gFujairahVat: money("box1g_fujairah_vat").notNull().default(0),
  box1gFujairahAdj: money("box1g_fujairah_adj").notNull().default(0),

  // Box 2: Tax Refunds to Tourists
  box2TouristRefundAmount: money("box2_tourist_refund_amount").notNull().default(0),
  box2TouristRefundVat: money("box2_tourist_refund_vat").notNull().default(0),

  // Box 3: Supplies subject to reverse charge
  box3ReverseChargeAmount: money("box3_reverse_charge_amount").notNull().default(0),
  box3ReverseChargeVat: money("box3_reverse_charge_vat").notNull().default(0),

  // Box 4: Zero Rated Supplies
  box4ZeroRatedAmount: money("box4_zero_rated_amount").notNull().default(0),

  // Box 5: Exempt Supplies
  box5ExemptAmount: money("box5_exempt_amount").notNull().default(0),

  // Box 6: Goods imported into UAE
  box6ImportsAmount: money("box6_imports_amount").notNull().default(0),
  box6ImportsVat: money("box6_imports_vat").notNull().default(0),

  // Box 7: Adjustments to goods imported
  box7ImportsAdjAmount: money("box7_imports_adj_amount").notNull().default(0),
  box7ImportsAdjVat: money("box7_imports_adj_vat").notNull().default(0),

  // Box 8: Totals for Output VAT
  box8TotalAmount: money("box8_total_amount").notNull().default(0),
  box8TotalVat: money("box8_total_vat").notNull().default(0),
  box8TotalAdj: money("box8_total_adj").notNull().default(0),

  // ===== VAT ON EXPENSES AND ALL OTHER INPUTS =====
  // Box 9: Standard Rated Expenses
  box9ExpensesAmount: money("box9_expenses_amount").notNull().default(0),
  box9ExpensesVat: money("box9_expenses_vat").notNull().default(0),
  box9ExpensesAdj: money("box9_expenses_adj").notNull().default(0),

  // Box 10: Supplies subject to reverse charge (input)
  box10ReverseChargeAmount: money("box10_reverse_charge_amount").notNull().default(0),
  box10ReverseChargeVat: money("box10_reverse_charge_vat").notNull().default(0),

  // Box 11: Totals for Input VAT
  box11TotalAmount: money("box11_total_amount").notNull().default(0),
  box11TotalVat: money("box11_total_vat").notNull().default(0),
  box11TotalAdj: money("box11_total_adj").notNull().default(0),

  // ===== NET VAT DUE =====
  // Box 12: Total value of due tax for the period
  box12TotalDueTax: money("box12_total_due_tax").notNull().default(0),

  // Box 13: Total value of recoverable tax for the period
  box13RecoverableTax: money("box13_recoverable_tax").notNull().default(0),

  // Box 14: Payable tax for the period (Box 12 - Box 13)
  box14PayableTax: money("box14_payable_tax").notNull().default(0),

  // Legacy fields for backward compatibility
  box1SalesStandard: money("box1_sales_standard").notNull().default(0),
  box2SalesOtherEmirates: money("box2_sales_other_emirates").notNull().default(0),
  box3SalesTaxExempt: money("box3_sales_tax_exempt").notNull().default(0),
  box4SalesExempt: money("box4_sales_exempt").notNull().default(0),
  box5TotalOutputTax: money("box5_total_output_tax").notNull().default(0),
  box6ExpensesStandard: money("box6_expenses_standard").notNull().default(0),
  box7ExpensesTouristRefund: money("box7_expenses_tourist_refund").notNull().default(0),
  box8TotalInputTax: money("box8_total_input_tax").notNull().default(0),
  box9NetTax: money("box9_net_tax").notNull().default(0),
  adjustmentAmount: money("adjustment_amount").default(0),
  adjustmentReason: text("adjustment_reason"),

  // Filing info
  submittedBy: uuid("submitted_by").references(() => users.id),
  submittedAt: timestamp("submitted_at"),
  ftaReferenceNumber: text("fta_reference_number"),
  paymentStatus: text("payment_status").default("unpaid"), // unpaid | paid | partial
  paymentAmount: money("payment_amount"),
  paymentDate: timestamp("payment_date"),
  notes: text("notes"),
  
  // Declaration
  declarantName: text("declarant_name"),
  declarantPosition: text("declarant_position"),
  declarationDate: timestamp("declaration_date"),

  createdBy: uuid("created_by").notNull().references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  companyIdIdx: index("idx_vat_returns_company_id").on(table.companyId),
  companyPeriodIdx: index("idx_vat_returns_company_period").on(table.companyId, table.periodStart),
}));

export const insertVatReturnSchema = createInsertSchema(vatReturns).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertVatReturn = z.infer<typeof insertVatReturnSchema>;
export type VatReturn = typeof vatReturns.$inferSelect;

// ===========================
// VAT Return Periods (Phase 3: VAT Autopilot)
// Tracks each filing window per company so deadlines, calculation snapshots,
// and adjustments can be reasoned about independently of the immutable
// `vat_returns` row. A period progresses through draft → ready → submitted →
// accepted; an `adjustments` JSONB column carries an audit-trailed list of
// manual overrides applied on top of the auto-calculated boxes.
// ===========================
export const vatReturnPeriods = pgTable("vat_return_periods", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  periodStart: timestamp("period_start").notNull(),
  periodEnd: timestamp("period_end").notNull(),
  dueDate: timestamp("due_date").notNull(),
  frequency: text("frequency").notNull().default("quarterly"), // quarterly | monthly
  status: text("status").notNull().default("draft"), // draft | ready | submitted | accepted
  // Snapshot of the most recent auto-calculation. Stored so the UI can show
  // last-calculated totals without re-running the full aggregation.
  outputVat: money("output_vat").notNull().default(0),
  inputVat: money("input_vat").notNull().default(0),
  netVatPayable: money("net_vat_payable").notNull().default(0),
  calculatedAt: timestamp("calculated_at"),
  // adjustments: array of { id, box, amount, reason, userId, createdAt } items.
  // Applied additively to the auto-calculated baseline.
  adjustments: jsonb("adjustments").notNull().default(sql`'[]'::jsonb`),
  // Link to the formal vat_returns row once one has been generated/submitted.
  vatReturnId: uuid("vat_return_id").references(() => vatReturns.id),
  submittedAt: timestamp("submitted_at"),
  submittedBy: uuid("submitted_by").references(() => users.id),
  ftaReferenceNumber: text("fta_reference_number"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  companyPeriodUnique: unique("vat_return_periods_company_period_unique").on(table.companyId, table.periodStart, table.periodEnd),
  companyIdIdx: index("idx_vat_return_periods_company_id").on(table.companyId),
  dueDateIdx: index("idx_vat_return_periods_due_date").on(table.dueDate),
  statusIdx: index("idx_vat_return_periods_status").on(table.status),
}));

export const insertVatReturnPeriodSchema = createInsertSchema(vatReturnPeriods).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertVatReturnPeriod = z.infer<typeof insertVatReturnPeriodSchema>;
export type VatReturnPeriod = typeof vatReturnPeriods.$inferSelect;

export interface VatReturnAdjustment {
  id: string;
  box: string;             // e.g. "box1bDubaiVat", "box9ExpensesVat"
  amount: number;          // positive or negative AED delta
  reason: string;
  userId: string;
  createdAt: string;       // ISO timestamp
}

// ===========================
// Corporate Tax Returns (9% UAE CT)
// ===========================
export const corporateTaxReturns = pgTable("corporate_tax_returns", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  taxPeriodStart: timestamp("tax_period_start").notNull(),
  taxPeriodEnd: timestamp("tax_period_end").notNull(),
  totalRevenue: money("total_revenue").notNull().default(0),
  totalExpenses: money("total_expenses").notNull().default(0),
  totalDeductions: money("total_deductions").notNull().default(0),
  taxableIncome: money("taxable_income").notNull().default(0),
  exemptionThreshold: money("exemption_threshold").notNull().default(375000),
  taxRate: real("tax_rate").notNull().default(0.09),
  taxPayable: money("tax_payable").notNull().default(0),
  status: text("status").notNull().default("draft"), // draft | filed | paid
  filedAt: timestamp("filed_at"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  companyIdIdx: index("idx_corporate_tax_returns_company_id").on(table.companyId),
}));

export const insertCorporateTaxReturnSchema = createInsertSchema(corporateTaxReturns).omit({
  id: true,
  createdAt: true,
});

export type InsertCorporateTaxReturn = z.infer<typeof insertCorporateTaxReturnSchema>;
export type CorporateTaxReturn = typeof corporateTaxReturns.$inferSelect;

// ===========================
// System Audit Logs
// ===========================
export const auditLogs = pgTable("audit_logs", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: uuid("user_id").references(() => users.id),
  action: text("action").notNull(), // create | update | delete | login | logout | admin_action
  resourceType: text("resource_type").notNull(), // user | company | invoice | receipt | setting | subscription
  resourceId: text("resource_id"),
  details: text("details"), // JSON with change details
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  userIdIdx: index("idx_audit_logs_user_id").on(table.userId),
  resourceIdx: index("idx_audit_logs_resource").on(table.resourceType, table.resourceId),
  createdAtIdx: index("idx_audit_logs_created_at").on(table.createdAt),
}));

export const insertAuditLogSchema = createInsertSchema(auditLogs).omit({
  id: true,
  createdAt: true,
});

export type InsertAuditLog = z.infer<typeof insertAuditLogSchema>;
export type AuditLog = typeof auditLogs.$inferSelect;

// ===========================
// Document Vault (Trade licenses, contracts, tax certificates with expiry tracking)
// ===========================
export const documents = pgTable("documents", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
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
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  companyIdIdx: index("idx_documents_company_id").on(table.companyId),
}));

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
export const taxReturnArchive = pgTable("tax_return_archive", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
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
}, (table) => ({
  companyIdIdx: index("idx_tax_return_archive_company_id").on(table.companyId),
}));

export const insertTaxReturnArchiveSchema = createInsertSchema(taxReturnArchive).omit({
  id: true,
  createdAt: true,
});

export type InsertTaxReturnArchive = z.infer<typeof insertTaxReturnArchiveSchema>;
export type TaxReturnArchive = typeof taxReturnArchive.$inferSelect;

// ===========================
// Compliance Tasks & Reminders
// ===========================
export const complianceTasks = pgTable("compliance_tasks", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
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
}, (table) => ({
  companyIdIdx: index("idx_compliance_tasks_company_id").on(table.companyId),
  companyStatusDueIdx: index("idx_compliance_tasks_company_status_due").on(table.companyId, table.status, table.dueDate),
}));

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
export const messages = pgTable("messages", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  threadId: uuid("thread_id"), // For grouping related messages
  subject: text("subject"),
  content: text("content").notNull(),
  senderId: uuid("sender_id").notNull().references(() => users.id),
  recipientId: uuid("recipient_id").references(() => users.id), // null = broadcast to all company users
  isRead: boolean("is_read").default(false),
  readAt: timestamp("read_at"),
  attachmentUrl: text("attachment_url"),
  attachmentName: text("attachment_name"),
  messageType: text("message_type").default("general"), // general | inquiry | update | urgent | system
  isArchived: boolean("is_archived").default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  companyIdIdx: index("idx_messages_company_id").on(table.companyId),
  threadIdx: index("idx_messages_thread_id").on(table.threadId),
}));

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
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
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
export const invitations = pgTable("invitations", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  email: text("email").notNull(),
  companyId: uuid("company_id").references(() => companies.id, { onDelete: "cascade" }),
  role: text("role").notNull().default("client"), // client | staff
  userType: text("user_type").notNull().default("client"), // admin | client | customer
  token: text("token").notNull().unique(), // Hashed invitation token
  invitedBy: uuid("invited_by").notNull().references(() => users.id),
  status: text("status").notNull().default("pending"), // pending | accepted | expired | revoked
  expiresAt: timestamp("expires_at").notNull(),
  acceptedAt: timestamp("accepted_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  companyIdIdx: index("idx_invitations_company_id").on(table.companyId),
}));

export const insertInvitationSchema = createInsertSchema(invitations).omit({
  id: true,
  createdAt: true,
});

export type InsertInvitation = z.infer<typeof insertInvitationSchema>;
export type Invitation = typeof invitations.$inferSelect;

// ===========================
// Activity Logs (Audit Trail)
// ===========================
export const activityLogs = pgTable("activity_logs", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: uuid("user_id").references(() => users.id),
  companyId: uuid("company_id").references(() => companies.id, { onDelete: "cascade" }),
  action: text("action").notNull(), // create | update | delete | login | logout | invite | view
  entityType: text("entity_type").notNull(), // user | company | document | invoice | journal_entry | etc
  entityId: text("entity_id"),
  description: text("description").notNull(),
  metadata: text("metadata"), // JSON string for additional context
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  companyIdIdx: index("idx_activity_logs_company_id").on(table.companyId),
}));

export const insertActivityLogSchema = createInsertSchema(activityLogs).omit({
  id: true,
  createdAt: true,
});

export type InsertActivityLog = z.infer<typeof insertActivityLogSchema>;
export type ActivityLog = typeof activityLogs.$inferSelect;

// ===========================
// Client Notes (Admin notes about clients - internal only)
// ===========================
export const clientNotes = pgTable("client_notes", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  authorId: uuid("author_id").notNull().references(() => users.id),
  content: text("content").notNull(),
  isPinned: boolean("is_pinned").default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  companyIdIdx: index("idx_client_notes_company_id").on(table.companyId),
}));

export const insertClientNoteSchema = createInsertSchema(clientNotes).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertClientNote = z.infer<typeof insertClientNoteSchema>;
export type ClientNote = typeof clientNotes.$inferSelect;

// ===========================
// Client Engagements (NR Accounting managing clients)
// ===========================
// Tracks the relationship between NR Accounting and their clients
export const engagements = pgTable("engagements", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  accountManagerId: uuid("account_manager_id").references(() => users.id), // NR staff assigned
  
  // Engagement Details
  engagementType: text("engagement_type").notNull().default("full_service"), // full_service | vat_only | bookkeeping | advisory
  status: text("status").notNull().default("active"), // active | on_hold | terminated
  startDate: timestamp("start_date").notNull(),
  endDate: timestamp("end_date"),
  
  // Service Agreement
  monthlyFee: money("monthly_fee"),
  billingCycle: text("billing_cycle").default("monthly"), // monthly | quarterly | annually
  paymentTerms: integer("payment_terms").default(30), // days
  
  // Service Scope
  servicesIncluded: text("services_included"), // JSON array of services
  specialInstructions: text("special_instructions"),
  
  // Onboarding
  onboardingCompleted: boolean("onboarding_completed").default(false),
  onboardingCompletedAt: timestamp("onboarding_completed_at"),

  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  companyIdIdx: index("idx_engagements_company_id").on(table.companyId),
  accountManagerIdx: index("idx_engagements_account_manager_id").on(table.accountManagerId),
}));

export const insertEngagementSchema = createInsertSchema(engagements).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertEngagement = z.infer<typeof insertEngagementSchema>;
export type Engagement = typeof engagements.$inferSelect;

// ===========================
// Service Invoices (NR Accounting billing to clients)
// ===========================
// Invoices from NR Accounting Services to their managed clients
export const serviceInvoices = pgTable("service_invoices", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  engagementId: uuid("engagement_id").notNull().references(() => engagements.id, { onDelete: "cascade" }),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  
  // Invoice Details
  invoiceNumber: text("invoice_number").notNull(),
  invoiceDate: timestamp("invoice_date").notNull(),
  dueDate: timestamp("due_date").notNull(),
  
  // Amounts (in AED)
  subtotal: money("subtotal").notNull().default(0),
  vatAmount: money("vat_amount").notNull().default(0),
  total: money("total").notNull().default(0),

  // Payment
  status: text("status").notNull().default("draft"), // draft | sent | paid | overdue | void
  paidAmount: money("paid_amount").default(0),
  paidAt: timestamp("paid_at"),
  paymentMethod: text("payment_method"), // bank_transfer | card | cash | cheque
  paymentReference: text("payment_reference"),
  
  // Period
  periodStart: timestamp("period_start"),
  periodEnd: timestamp("period_end"),
  
  // Notes
  description: text("description"),
  notes: text("notes"),
  
  // PDF
  pdfUrl: text("pdf_url"),

  createdBy: uuid("created_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  companyIdIdx: index("idx_service_invoices_company_id").on(table.companyId),
  engagementIdIdx: index("idx_service_invoices_engagement_id").on(table.engagementId),
}));

export const insertServiceInvoiceSchema = createInsertSchema(serviceInvoices).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertServiceInvoice = z.infer<typeof insertServiceInvoiceSchema>;
export type ServiceInvoice = typeof serviceInvoices.$inferSelect;

// ===========================
// Service Invoice Lines
// ===========================
export const serviceInvoiceLines = pgTable("service_invoice_lines", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  serviceInvoiceId: uuid("service_invoice_id").notNull().references(() => serviceInvoices.id, { onDelete: "cascade" }),
  description: text("description").notNull(),
  quantity: real("quantity").notNull().default(1),
  unitPrice: money("unit_price").notNull(),
  vatRate: vatRateType("vat_rate").notNull().default(0.05), // UAE 5%
  amount: money("amount").notNull(), // quantity * unitPrice
}, (table) => ({
  serviceInvoiceIdIdx: index("idx_service_invoice_lines_service_invoice_id").on(table.serviceInvoiceId),
}));

export const insertServiceInvoiceLineSchema = createInsertSchema(serviceInvoiceLines).omit({
  id: true,
});

export type InsertServiceInvoiceLine = z.infer<typeof insertServiceInvoiceLineSchema>;
export type ServiceInvoiceLine = typeof serviceInvoiceLines.$inferSelect;

// ===========================
// FTA Email Sync (for client portal)
// ===========================
// Tracks emails synced from FTA for clients
export const ftaEmails = pgTable("fta_emails", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  
  // Email Details
  subject: text("subject").notNull(),
  sender: text("sender"),
  receivedAt: timestamp("received_at").notNull(),
  
  // Content
  bodyText: text("body_text"),
  bodyHtml: text("body_html"),
  
  // Categorization
  emailType: text("email_type"), // vat_return_confirmation | payment_reminder | tax_notice | assessment | other
  priority: text("priority").default("normal"), // low | normal | high | urgent
  
  // Status
  isRead: boolean("is_read").default(false),
  isArchived: boolean("is_archived").default(false),
  isStarred: boolean("is_starred").default(false),
  
  // Attachments
  hasAttachments: boolean("has_attachments").default(false),
  attachments: text("attachments"), // JSON array of attachment details
  
  // Processing
  aiSummary: text("ai_summary"),
  actionRequired: boolean("action_required").default(false),
  actionDescription: text("action_description"),
  actionDueDate: timestamp("action_due_date"),

  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  companyIdIdx: index("idx_fta_emails_company_id").on(table.companyId),
}));

export const insertFtaEmailSchema = createInsertSchema(ftaEmails).omit({
  id: true,
  createdAt: true,
});

export type InsertFtaEmail = z.infer<typeof insertFtaEmailSchema>;
export type FtaEmail = typeof ftaEmails.$inferSelect;

// ===========================
// Customer Subscriptions (SaaS tier tracking)
// ===========================
export const subscriptions = pgTable("subscriptions", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  
  // Plan Details
  planId: text("plan_id").notNull(), // free | starter | professional | enterprise
  planName: text("plan_name").notNull(),
  
  // Billing
  status: text("status").notNull().default("active"), // active | cancelled | past_due | trialing
  currentPeriodStart: timestamp("current_period_start").notNull(),
  currentPeriodEnd: timestamp("current_period_end").notNull(),
  cancelAtPeriodEnd: boolean("cancel_at_period_end").default(false),
  
  // Stripe Integration (if using)
  stripeCustomerId: text("stripe_customer_id"),
  stripeSubscriptionId: text("stripe_subscription_id"),

  // Usage Limits
  maxUsers: integer("max_users").default(1),
  maxInvoices: integer("max_invoices").default(50),
  maxReceipts: integer("max_receipts").default(100),
  aiCreditsRemaining: integer("ai_credits_remaining").default(100),

  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  companyIdIdx: index("idx_subscriptions_company_id").on(table.companyId),
}));

export const insertSubscriptionSchema = createInsertSchema(subscriptions).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertSubscription = z.infer<typeof insertSubscriptionSchema>;
export type Subscription = typeof subscriptions.$inferSelect;

// ===========================
// Data Backups (Financial Records Safeguard)
// ===========================
export const backups = pgTable("backups", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  
  // Backup Details
  name: text("name").notNull(),
  description: text("description"),
  backupType: text("backup_type").notNull().default("manual"), // manual | scheduled | pre_restore
  status: text("status").notNull().default("pending"), // pending | in_progress | completed | failed
  
  // Data Counts (for verification)
  accountsCount: integer("accounts_count").default(0),
  journalEntriesCount: integer("journal_entries_count").default(0),
  invoicesCount: integer("invoices_count").default(0),
  receiptsCount: integer("receipts_count").default(0),
  vatReturnsCount: integer("vat_returns_count").default(0),
  
  // Storage
  dataSnapshot: text("data_snapshot"), // JSON stringified backup data
  checksum: text("checksum"), // SHA256 for integrity verification
  sizeBytes: integer("size_bytes").default(0),

  // Timestamps
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  completedAt: timestamp("completed_at"),
  expiresAt: timestamp("expires_at"), // Auto-cleanup after 90 days
}, (table) => ({
  companyIdIdx: index("idx_backups_company_id").on(table.companyId),
}));

export const insertBackupSchema = createInsertSchema(backups).omit({
  id: true,
  createdAt: true,
});

export type InsertBackup = z.infer<typeof insertBackupSchema>;
export type Backup = typeof backups.$inferSelect;

// ===========================
// AI Conversations (Chat History)
// ===========================
export const aiConversations = pgTable("ai_conversations", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  companyId: uuid("company_id").references(() => companies.id, { onDelete: "cascade" }),
  
  // Conversation Details
  prompt: text("prompt").notNull(),
  response: text("response").notNull(),
  model: text("model").notNull().default("gpt-3.5-turbo"), // gpt-3.5-turbo | gpt-4 | gpt-4-turbo
  systemPrompt: text("system_prompt"), // Custom system prompt if provided
  
  // Metadata
  tokensUsed: integer("tokens_used"), // If available from OpenAI
  responseTime: integer("response_time"), // Milliseconds
  error: text("error"), // Error message if request failed

  // Timestamps
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  userIdIdx: index("idx_ai_conversations_user_id").on(table.userId),
  companyIdIdx: index("idx_ai_conversations_company_id").on(table.companyId),
}));

export const insertAiConversationSchema = createInsertSchema(aiConversations).omit({
  id: true,
  createdAt: true,
});

export type InsertAiConversation = z.infer<typeof insertAiConversationSchema>;
export type AiConversation = typeof aiConversations.$inferSelect;

// ===========================
// Client Communications
// ===========================
export const clientCommunications = pgTable("client_communications", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
  channel: text("channel").notNull(), // 'whatsapp' | 'email' | 'sms'
  direction: text("direction").notNull().default("outbound"), // 'inbound' | 'outbound'
  recipientPhone: text("recipient_phone"),
  recipientEmail: text("recipient_email"),
  subject: text("subject"),
  body: text("body").notNull(),
  status: text("status").notNull().default("sent"), // 'sent' | 'delivered' | 'read' | 'failed'
  templateType: text("template_type"), // 'vat_reminder' | 'invoice' | 'document_request' | 'payment_confirmation' | 'custom'
  metadata: text("metadata"), // JSON string
  sentAt: timestamp("sent_at").defaultNow().notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  companyIdIdx: index("idx_client_communications_company_id").on(table.companyId),
}));

export const insertClientCommunicationSchema = createInsertSchema(clientCommunications).omit({
  id: true,
  createdAt: true,
});

export type InsertClientCommunication = z.infer<typeof insertClientCommunicationSchema>;
export type ClientCommunication = typeof clientCommunications.$inferSelect;

// ===========================
// Communication Templates
// ===========================
export const communicationTemplates = pgTable("communication_templates", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  channel: text("channel").notNull(), // 'whatsapp' | 'email' | 'sms'
  templateType: text("template_type").notNull(), // 'vat_reminder' | 'invoice' | 'document_request' | 'payment_confirmation' | 'custom'
  subjectTemplate: text("subject_template"),
  bodyTemplate: text("body_template").notNull(),
  language: text("language").notNull().default("en"), // 'en' | 'ar'
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertCommunicationTemplateSchema = createInsertSchema(communicationTemplates).omit({
  id: true,
  createdAt: true,
});

export type InsertCommunicationTemplate = z.infer<typeof insertCommunicationTemplateSchema>;
export type CommunicationTemplate = typeof communicationTemplates.$inferSelect;

// ===========================
// Firm Leads (NRA Lead Pipeline)
// ===========================
export const firmLeads = pgTable("firm_leads", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  companyId: uuid("company_id").references(() => companies.id, { onDelete: "set null" }),

  stage: text("stage").notNull().default("prospect"), // prospect | contacted | interested | converted | lost
  source: text("source").notNull().default("manual"), // saas_signup | referral | manual | website

  notes: text("notes"),
  score: integer("score").default(50), // 0–100

  convertedAt: timestamp("converted_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  userIdIdx: index("idx_firm_leads_user_id").on(table.userId),
  stageIdx: index("idx_firm_leads_stage").on(table.stage),
}));

export const insertFirmLeadSchema = createInsertSchema(firmLeads).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const updateFirmLeadSchema = insertFirmLeadSchema.partial();

export type InsertFirmLead = z.infer<typeof insertFirmLeadSchema>;
export type UpdateFirmLead = z.infer<typeof updateFirmLeadSchema>;
export type FirmLead = typeof firmLeads.$inferSelect;

// ===========================
// Payment Chasing Autopilot (Phase 4)
// ===========================
// Tracks every "chase" action taken against an overdue invoice. A chase is a
// reminder communication (WhatsApp / email / manual) that escalates with the
// number of days the invoice is overdue. We log each attempt — even when the
// user only previews a wa.me link without sending — so that the next chase
// level is computed deterministically and effectiveness can be measured.
export const paymentChases = pgTable("payment_chases", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  invoiceId: uuid("invoice_id").notNull().references(() => invoices.id, { onDelete: "cascade" }),
  contactId: uuid("contact_id").references(() => customerContacts.id, { onDelete: "set null" }),
  level: integer("level").notNull(), // 1..4 escalation level applied
  method: text("method").notNull().default("whatsapp"), // whatsapp | email | manual
  language: text("language").notNull().default("en"), // en | ar
  messageText: text("message_text").notNull(),
  daysOverdueAtSend: integer("days_overdue_at_send").notNull().default(0),
  amountAtSend: money("amount_at_send").notNull().default(0),
  // pending = queued / draft, sent = wa.me link generated, responded = client
  // replied, paid = invoice was paid after this chase, failed = send failed.
  status: text("status").notNull().default("sent"),
  sentAt: timestamp("sent_at").defaultNow().notNull(),
  respondedAt: timestamp("responded_at"),
  paidAt: timestamp("paid_at"),
  triggeredBy: uuid("triggered_by").references(() => users.id, { onDelete: "set null" }),
  // Free-form metadata for future webhook integrations (Business API IDs etc.)
  meta: text("meta"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  companyIdx: index("idx_payment_chases_company_id").on(table.companyId),
  invoiceIdx: index("idx_payment_chases_invoice_id").on(table.invoiceId),
  sentAtIdx: index("idx_payment_chases_sent_at").on(table.sentAt),
}));

export const insertPaymentChaseSchema = createInsertSchema(paymentChases).omit({
  id: true,
  createdAt: true,
});

export type InsertPaymentChase = z.infer<typeof insertPaymentChaseSchema>;
export type PaymentChase = typeof paymentChases.$inferSelect;

// Customizable chase message templates per company / level / language. There
// is exactly one "default" template per (level, language) seeded by the
// migration; companies can override or add custom templates.
export const chaseTemplates = pgTable("chase_templates", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: uuid("company_id").references(() => companies.id, { onDelete: "cascade" }), // null = system default
  level: integer("level").notNull(), // 1..4
  language: text("language").notNull().default("en"), // en | ar
  subject: text("subject"),
  body: text("body").notNull(),
  isDefault: boolean("is_default").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at"),
}, (table) => ({
  companyLevelLangIdx: index("idx_chase_templates_lookup").on(table.companyId, table.level, table.language),
}));

export const insertChaseTemplateSchema = createInsertSchema(chaseTemplates).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertChaseTemplate = z.infer<typeof insertChaseTemplateSchema>;
export type ChaseTemplate = typeof chaseTemplates.$inferSelect;

// Per-company configuration. One row per company; absence means defaults.
export const chaseConfigs = pgTable("chase_configs", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: uuid("company_id").notNull().unique().references(() => companies.id, { onDelete: "cascade" }),
  autoChaseEnabled: boolean("auto_chase_enabled").notNull().default(false),
  // Minimum days between chases for the same invoice — prevents spamming
  // when overdue lingers across multiple polling cycles.
  chaseFrequencyDays: integer("chase_frequency_days").notNull().default(7),
  maxLevel: integer("max_level").notNull().default(4),
  preferredMethod: text("preferred_method").notNull().default("whatsapp"), // whatsapp | email
  // JSON-encoded array of customer_contacts.id values that must never be
  // chased. Stored as text to avoid pulling in jsonb tooling here; routes
  // parse / serialize on the way in/out.
  doNotChaseContactIds: text("do_not_chase_contact_ids").notNull().default("[]"),
  defaultLanguage: text("default_language").notNull().default("en"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at"),
});

export const insertChaseConfigSchema = createInsertSchema(chaseConfigs).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertChaseConfig = z.infer<typeof insertChaseConfigSchema>;
export type ChaseConfig = typeof chaseConfigs.$inferSelect;

// ===========================
// Phase 5: Document Chasing Autopilot
// ===========================
//
// Document requirements describe what a client must supply for bookkeeping
// and UAE compliance (trade licence renewals, Emirates IDs, bank statements,
// tenancy contracts, visa copies, etc.). The chase pipeline escalates a
// missing document through four levels (friendly → follow_up → urgent →
// final), mirroring the Phase 4 payment-chasing model. The compliance
// calendar is the source of truth for upcoming UAE deadlines that drive
// auto-scheduled reminders.

// UAE-specific document types — kept as a const tuple so the Zod enum below
// stays in lockstep. Free-form types are stored under "other".
export const DOCUMENT_TYPES = [
  'trade_license',
  'emirates_id',
  'visa_copy',
  'passport_copy',
  'bank_statement',
  'tenancy_contract',
  'moa_aoa',
  'vat_certificate',
  'corporate_tax_certificate',
  'esr_notification',
  'esr_report',
  'audited_financials',
  'invoice',
  'receipt',
  'payslip',
  'other',
] as const;
export type DocumentType = typeof DOCUMENT_TYPES[number];

export const CHASE_LEVELS = ['friendly', 'follow_up', 'urgent', 'final'] as const;
export type ChaseLevel = typeof CHASE_LEVELS[number];

export const CHASE_CHANNELS = ['whatsapp', 'email', 'sms', 'in_app'] as const;
export type ChaseChannel = typeof CHASE_CHANNELS[number];

export const REQUIREMENT_STATUSES = [
  'pending',
  'requested',
  'received',
  'overdue',
  'waived',
] as const;
export type RequirementStatus = typeof REQUIREMENT_STATUSES[number];

export const COMPLIANCE_EVENT_TYPES = [
  'trade_license_renewal',
  'visa_expiry',
  'emirates_id_expiry',
  'vat_filing',
  'corporate_tax_filing',
  'esr_notification',
  'esr_report',
  'tenancy_renewal',
  'audit_deadline',
  'other',
] as const;
export type ComplianceEventType = typeof COMPLIANCE_EVENT_TYPES[number];

// Document requirements: what a client owes the firm per period.
export const documentRequirements = pgTable("document_requirements", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  documentType: text("document_type").notNull(), // DocumentType
  description: text("description"),
  dueDate: timestamp("due_date").notNull(),
  isRecurring: boolean("is_recurring").notNull().default(false),
  recurringIntervalDays: integer("recurring_interval_days"), // null when isRecurring is false
  status: text("status").notNull().default("pending"), // RequirementStatus
  receivedAt: timestamp("received_at"),
  uploadedDocumentId: uuid("uploaded_document_id"), // optional pointer to a document store row
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  companyIdIdx: index("idx_document_requirements_company_id").on(table.companyId),
  dueDateIdx: index("idx_document_requirements_due_date").on(table.dueDate),
  statusIdx: index("idx_document_requirements_status").on(table.status),
}));

export const insertDocumentRequirementSchema = createInsertSchema(documentRequirements).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export const updateDocumentRequirementSchema = insertDocumentRequirementSchema.partial();

export type InsertDocumentRequirement = z.infer<typeof insertDocumentRequirementSchema>;
export type UpdateDocumentRequirement = z.infer<typeof updateDocumentRequirementSchema>;
export type DocumentRequirement = typeof documentRequirements.$inferSelect;

// Document chases: one row per send. Level escalates as the same requirement
// stays open across multiple sends.
export const documentChases = pgTable("document_chases", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  requirementId: uuid("requirement_id").notNull().references(() => documentRequirements.id, { onDelete: "cascade" }),
  chaseLevel: text("chase_level").notNull(), // ChaseLevel
  sentVia: text("sent_via").notNull(), // ChaseChannel
  sentAt: timestamp("sent_at").defaultNow().notNull(),
  messageContent: text("message_content").notNull(),
  recipientPhone: text("recipient_phone"),
  recipientEmail: text("recipient_email"),
  responseReceived: boolean("response_received").notNull().default(false),
  responseReceivedAt: timestamp("response_received_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  companyIdIdx: index("idx_document_chases_company_id").on(table.companyId),
  requirementIdIdx: index("idx_document_chases_requirement_id").on(table.requirementId),
  sentAtIdx: index("idx_document_chases_sent_at").on(table.sentAt),
}));

export const insertDocumentChaseSchema = createInsertSchema(documentChases).omit({
  id: true,
  createdAt: true,
});

export type InsertDocumentChase = z.infer<typeof insertDocumentChaseSchema>;
export type DocumentChase = typeof documentChases.$inferSelect;

// Compliance calendar: UAE-specific events that drive document requirements
// and chase scheduling. Reminder days is stored as a comma-separated list of
// day offsets ("30,14,7,0") for portability across Postgres versions.
export const complianceCalendar = pgTable("compliance_calendar", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  eventType: text("event_type").notNull(), // ComplianceEventType
  description: text("description").notNull(),
  eventDate: timestamp("event_date").notNull(),
  reminderDays: text("reminder_days").notNull().default("30,14,7,0"),
  status: text("status").notNull().default("upcoming"), // upcoming | completed | overdue | dismissed
  completedAt: timestamp("completed_at"),
  linkedRequirementId: uuid("linked_requirement_id"), // optional link back to a requirement
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  companyIdIdx: index("idx_compliance_calendar_company_id").on(table.companyId),
  eventDateIdx: index("idx_compliance_calendar_event_date").on(table.eventDate),
}));

export const insertComplianceCalendarSchema = createInsertSchema(complianceCalendar).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export const updateComplianceCalendarSchema = insertComplianceCalendarSchema.partial();

export type InsertComplianceEvent = z.infer<typeof insertComplianceCalendarSchema>;
export type UpdateComplianceEvent = z.infer<typeof updateComplianceCalendarSchema>;
export type ComplianceEvent = typeof complianceCalendar.$inferSelect;

// ===========================
// Firm Alerts (Phase 6: Command Center)
// ===========================
// Surfaces critical items across all firm-managed clients (FTA deadlines, stale
// activity, large overdue balances, incomplete onboarding, etc.).
// firmId = user.id of the firm_owner. companyId is nullable for firm-wide alerts.
export const firmAlerts = pgTable("firm_alerts", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  firmId: uuid("firm_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  companyId: uuid("company_id").references(() => companies.id, { onDelete: "cascade" }),
  alertType: text("alert_type").notNull(), // vat_deadline | stale_activity | overdue_balance | incomplete_onboarding | document_missing
  severity: text("severity").notNull().default("info"), // critical | warning | info
  message: text("message").notNull(),
  metadata: text("metadata"), // optional JSON-encoded extras (amounts, dueDate, etc.)
  isRead: boolean("is_read").notNull().default(false),
  resolvedAt: timestamp("resolved_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  firmIdIdx: index("idx_firm_alerts_firm_id").on(table.firmId),
  companyIdIdx: index("idx_firm_alerts_company_id").on(table.companyId),
  severityIdx: index("idx_firm_alerts_severity").on(table.severity),
  unreadIdx: index("idx_firm_alerts_unread").on(table.firmId, table.isRead),
}));

export const insertFirmAlertSchema = createInsertSchema(firmAlerts).omit({
  id: true,
  createdAt: true,
});

export type InsertFirmAlert = z.infer<typeof insertFirmAlertSchema>;
export type FirmAlert = typeof firmAlerts.$inferSelect;
export type FirmAlertSeverity = 'critical' | 'warning' | 'info';
export type FirmAlertType =
  | 'vat_deadline'
  | 'stale_activity'
  | 'overdue_balance'
  | 'incomplete_onboarding'
  | 'document_missing';

// ===========================
// Firm Metrics Cache (Phase 6: Command Center)
// ===========================
// Caches expensive firm-wide aggregations so dashboards don't recompute on every
// page load. metricValue is a JSON-encoded payload (numbers or full objects).
// Caller is responsible for invalidating entries past their TTL.
export const firmMetricsCache = pgTable("firm_metrics_cache", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  firmId: uuid("firm_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  metricType: text("metric_type").notNull(), // dashboard_summary | period_comparison | health_scores | staff_workload
  metricValue: text("metric_value").notNull(), // JSON payload
  periodStart: timestamp("period_start"),
  periodEnd: timestamp("period_end"),
  calculatedAt: timestamp("calculated_at").defaultNow().notNull(),
}, (table) => ({
  firmTypeIdx: index("idx_firm_metrics_cache_firm_type").on(table.firmId, table.metricType),
  // One row per (firm, type, period) so we can update-on-conflict.
  firmTypePeriodUnique: unique("firm_metrics_cache_firm_type_period_unique").on(
    table.firmId,
    table.metricType,
    table.periodStart,
    table.periodEnd
  ),
}));

export const insertFirmMetricsCacheSchema = createInsertSchema(firmMetricsCache).omit({
  id: true,
  calculatedAt: true,
});

export type InsertFirmMetricsCache = z.infer<typeof insertFirmMetricsCacheSchema>;
export type FirmMetricsCache = typeof firmMetricsCache.$inferSelect;
