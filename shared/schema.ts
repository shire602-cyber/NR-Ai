import { pgTable, text, varchar, integer, real, boolean, timestamp, uuid } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { sql } from "drizzle-orm";

// ===========================
// Users
// ===========================
export const users = pgTable("users", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  passwordHash: text("password_hash").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertUserSchema = createInsertSchema(users).omit({
  id: true,
  passwordHash: true,
  createdAt: true,
}).extend({
  password: z.string().min(6, "Password must be at least 6 characters"),
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;
export type UserPublic = Omit<User, 'passwordHash'>;

// ===========================
// Companies
// ===========================
export const companies = pgTable("companies", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull().unique(),
  baseCurrency: text("base_currency").notNull().default("AED"),
  locale: text("locale").notNull().default("en"), // 'en' or 'ar'
  
  // Company Information
  legalStructure: text("legal_structure"), // Sole Proprietorship, LLC, Corporation, Partnership, Other
  industry: text("industry"),
  registrationNumber: text("registration_number"),
  businessAddress: text("business_address"),
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
  
  // Invoice Customization
  invoiceShowLogo: boolean("invoice_show_logo").notNull().default(true),
  invoiceShowAddress: boolean("invoice_show_address").notNull().default(true),
  invoiceShowPhone: boolean("invoice_show_phone").notNull().default(true),
  invoiceShowEmail: boolean("invoice_show_email").notNull().default(true),
  invoiceShowWebsite: boolean("invoice_show_website").notNull().default(false),
  invoiceCustomTitle: text("invoice_custom_title"), // Custom invoice title, defaults to "Tax Invoice" for VAT registered
  invoiceFooterNote: text("invoice_footer_note"),
  
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertCompanySchema = createInsertSchema(companies).omit({
  id: true,
  createdAt: true,
});

export type InsertCompany = z.infer<typeof insertCompanySchema>;
export type Company = typeof companies.$inferSelect;

// ===========================
// Company Users (Many-to-Many)
// ===========================
export const companyUsers = pgTable("company_users", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  role: text("role").notNull().default("owner"), // owner | accountant | cfo | employee
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertCompanyUserSchema = createInsertSchema(companyUsers).omit({
  id: true,
  createdAt: true,
});

export type InsertCompanyUser = z.infer<typeof insertCompanyUserSchema>;
export type CompanyUser = typeof companyUsers.$inferSelect;

// ===========================
// Chart of Accounts
// ===========================
export const accounts = pgTable("accounts", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  nameEn: text("name_en").notNull(),
  nameAr: text("name_ar"),
  type: text("type").notNull(), // asset | liability | equity | income | expense
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertAccountSchema = createInsertSchema(accounts).omit({
  id: true,
  createdAt: true,
});

export type InsertAccount = z.infer<typeof insertAccountSchema>;
export type Account = typeof accounts.$inferSelect;

// ===========================
// Journal Entries
// ===========================
export const journalEntries = pgTable("journal_entries", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  entryNumber: text("entry_number").notNull(), // Auto-generated: JE-YYYYMMDD-001
  date: timestamp("date").notNull(),
  memo: text("memo"),
  // Status: draft entries can be edited, posted entries are immutable
  status: text("status").notNull().default("draft"), // draft | posted | void
  // Source tracking: where did this entry come from?
  source: text("source").notNull().default("manual"), // manual | invoice | receipt | payment | reversal | system
  sourceId: uuid("source_id"), // Reference to invoice, receipt, etc.
  // Reversal support: if this entry is a reversal, link to original
  reversedEntryId: uuid("reversed_entry_id").references(() => journalEntries.id),
  reversalReason: text("reversal_reason"),
  // Audit trail
  createdBy: uuid("created_by").notNull().references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  postedBy: uuid("posted_by").references(() => users.id),
  postedAt: timestamp("posted_at"),
  updatedBy: uuid("updated_by").references(() => users.id),
  updatedAt: timestamp("updated_at"),
});

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
  debit: real("debit").notNull().default(0),
  credit: real("credit").notNull().default(0),
  description: text("description"), // Line-level description
  // Reconciliation support
  isReconciled: boolean("is_reconciled").notNull().default(false),
  reconciledAt: timestamp("reconciled_at"),
  reconciledBy: uuid("reconciled_by").references(() => users.id),
  bankTransactionId: uuid("bank_transaction_id"), // Reference to matched bank transaction
});

export const insertJournalLineSchema = createInsertSchema(journalLines).omit({
  id: true,
  reconciledAt: true,
});

export type InsertJournalLine = z.infer<typeof insertJournalLineSchema>;
export type JournalLine = typeof journalLines.$inferSelect;

// ===========================
// Invoices
// ===========================
export const invoices = pgTable("invoices", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  number: text("number").notNull(),
  customerName: text("customer_name").notNull(),
  customerTrn: text("customer_trn"),
  date: timestamp("date").notNull(),
  currency: text("currency").notNull().default("AED"),
  subtotal: real("subtotal").notNull().default(0),
  vatAmount: real("vat_amount").notNull().default(0),
  total: real("total").notNull().default(0),
  status: text("status").notNull().default("draft"), // draft | sent | paid | void
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

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
  unitPrice: real("unit_price").notNull(),
  vatRate: real("vat_rate").notNull().default(0.05), // UAE standard 5%
});

export const insertInvoiceLineSchema = createInsertSchema(invoiceLines).omit({
  id: true,
});

export type InsertInvoiceLine = z.infer<typeof insertInvoiceLineSchema>;
export type InvoiceLine = typeof invoiceLines.$inferSelect;

// ===========================
// Receipts/Documents
// ===========================
export const receipts = pgTable("receipts", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  merchant: text("merchant"),
  date: text("date"),
  amount: real("amount"),
  vatAmount: real("vat_amount"),
  currency: text("currency").default("AED"),
  category: text("category"),
  accountId: uuid("account_id").references(() => accounts.id), // Expense account to debit
  paymentAccountId: uuid("payment_account_id").references(() => accounts.id), // Cash/Bank account to credit
  posted: boolean("posted").default(false).notNull(), // Whether journal entry has been created
  journalEntryId: uuid("journal_entry_id").references(() => journalEntries.id), // Link to created journal entry
  imageData: text("image_data"),
  rawText: text("raw_text"),
  uploadedBy: uuid("uploaded_by").notNull().references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertReceiptSchema = createInsertSchema(receipts).omit({
  id: true,
  createdAt: true,
});

export type InsertReceipt = z.infer<typeof insertReceiptSchema>;
export type Receipt = typeof receipts.$inferSelect;

// ===========================
// Additional Types for Frontend
// ===========================

// Complete invoice with lines
export interface InvoiceWithLines extends Invoice {
  lines: InvoiceLine[];
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
});

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
});

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
});

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
});

export const insertAnomalyAlertSchema = createInsertSchema(anomalyAlerts).omit({
  id: true,
  createdAt: true,
});

export type InsertAnomalyAlert = z.infer<typeof insertAnomalyAlertSchema>;
export type AnomalyAlert = typeof anomalyAlerts.$inferSelect;

// ===========================
// Bank Transactions (for reconciliation)
// ===========================
export const bankTransactions = pgTable("bank_transactions", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  bankAccountId: uuid("bank_account_id").references(() => accounts.id), // Links to bank account in COA
  transactionDate: timestamp("transaction_date").notNull(),
  description: text("description").notNull(),
  amount: real("amount").notNull(), // Positive for credits, negative for debits
  reference: text("reference"), // Bank reference number
  category: text("category"), // AI-suggested category
  isReconciled: boolean("is_reconciled").notNull().default(false),
  matchedJournalEntryId: uuid("matched_journal_entry_id").references(() => journalEntries.id),
  matchedReceiptId: uuid("matched_receipt_id").references(() => receipts.id),
  matchedInvoiceId: uuid("matched_invoice_id").references(() => invoices.id),
  matchConfidence: real("match_confidence"), // AI confidence for the match
  importSource: text("import_source"), // manual | csv | api
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

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
  predictedInflow: real("predicted_inflow").notNull().default(0),
  predictedOutflow: real("predicted_outflow").notNull().default(0),
  predictedBalance: real("predicted_balance").notNull().default(0),
  confidenceLevel: real("confidence_level"), // 0-1
  factors: text("factors"), // JSON string of contributing factors
  generatedAt: timestamp("generated_at").defaultNow().notNull(),
});

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
  amount: real("amount"),
  suggestedAccountId: uuid("suggested_account_id").references(() => accounts.id),
  suggestedCategory: text("suggested_category"),
  aiConfidence: real("ai_confidence"), // 0-1
  aiReason: text("ai_reason"),
  wasAccepted: boolean("was_accepted"), // User feedback for ML improvement
  userSelectedAccountId: uuid("user_selected_account_id").references(() => accounts.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertTransactionClassificationSchema = createInsertSchema(transactionClassifications).omit({
  id: true,
  createdAt: true,
});

export type InsertTransactionClassification = z.infer<typeof insertTransactionClassificationSchema>;
export type TransactionClassification = typeof transactionClassifications.$inferSelect;

// ===========================
// Budgets (for Budget vs Actual)
// ===========================
export const budgets = pgTable("budgets", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  accountId: uuid("account_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
  year: integer("year").notNull(),
  month: integer("month").notNull(), // 1-12
  budgetAmount: real("budget_amount").notNull().default(0),
  notes: text("notes"),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

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
});

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
  amount: real("amount").notNull(),
  currency: text("currency").notNull().default("AED"),
  customerName: text("customer_name"),
  customerEmail: text("customer_email"),
  description: text("description"),
  status: text("status").notNull(), // succeeded | pending | failed | refunded
  platformFees: real("platform_fees"), // Stripe/Shopify fees
  netAmount: real("net_amount"), // Amount after fees
  transactionDate: timestamp("transaction_date").notNull(),
  metadata: text("metadata"), // JSON with platform-specific data
  isReconciled: boolean("is_reconciled").notNull().default(false),
  journalEntryId: uuid("journal_entry_id").references(() => journalEntries.id),
  invoiceId: uuid("invoice_id").references(() => invoices.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

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
});

export const insertFinancialKpiSchema = createInsertSchema(financialKpis).omit({
  id: true,
  calculatedAt: true,
});

export type InsertFinancialKpi = z.infer<typeof insertFinancialKpiSchema>;
export type FinancialKpi = typeof financialKpis.$inferSelect;
