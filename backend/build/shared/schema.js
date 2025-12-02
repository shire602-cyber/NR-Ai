import { pgTable, text, integer, real, boolean, timestamp, uuid, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { sql } from "drizzle-orm";
// ===========================
// Users
// ===========================
export const users = pgTable("users", {
    id: uuid("id").primaryKey().default(sql `gen_random_uuid()`),
    email: text("email").notNull().unique(),
    name: text("name").notNull(),
    passwordHash: text("password_hash").notNull(),
    isAdmin: boolean("is_admin").notNull().default(false),
    userType: text("user_type").notNull().default("customer"), // admin | client | customer
    phone: text("phone"),
    avatarUrl: text("avatar_url"),
    lastLoginAt: timestamp("last_login_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
});
export const insertUserSchema = createInsertSchema(users).omit({
    id: true,
    passwordHash: true,
    createdAt: true,
}).extend({
    password: z.string().min(6, "Password must be at least 6 characters"),
});
// ===========================
// Companies
// ===========================
export const companies = pgTable("companies", {
    id: uuid("id").primaryKey().default(sql `gen_random_uuid()`),
    name: text("name").notNull().unique(),
    baseCurrency: text("base_currency").notNull().default("AED"),
    locale: text("locale").notNull().default("en"), // 'en' or 'ar'
    // Company Type - determines access model
    companyType: text("company_type").notNull().default("customer"), // client | customer
    // client = Managed by NR Accounting, invite-only portal access
    // customer = Self-service SaaS user
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
    emirate: text("emirate").default("dubai"), // abu_dhabi | dubai | sharjah | ajman | umm_al_quwain | ras_al_khaimah | fujairah
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
// ===========================
// Company Users (Many-to-Many)
// ===========================
export const companyUsers = pgTable("company_users", {
    id: uuid("id").primaryKey().default(sql `gen_random_uuid()`),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    role: text("role").notNull().default("owner"), // owner | accountant | cfo | employee
    createdAt: timestamp("created_at").defaultNow().notNull(),
});
export const insertCompanyUserSchema = createInsertSchema(companyUsers).omit({
    id: true,
    createdAt: true,
});
// ===========================
// Chart of Accounts
// ===========================
export const accounts = pgTable("accounts", {
    id: uuid("id").primaryKey().default(sql `gen_random_uuid()`),
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
}));
export const insertAccountSchema = createInsertSchema(accounts).omit({
    id: true,
    createdAt: true,
    updatedAt: true,
}).refine((data) => {
    if (data.isVatAccount && !data.vatType) {
        return false;
    }
    if (!data.isVatAccount && data.vatType) {
        return false;
    }
    return true;
}, { message: "vatType must be provided when isVatAccount is true, and must be null when isVatAccount is false" });
// ===========================
// Journal Entries
// ===========================
export const journalEntries = pgTable("journal_entries", {
    id: uuid("id").primaryKey().default(sql `gen_random_uuid()`),
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
    reversedEntryId: uuid("reversed_entry_id"),
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
// ===========================
// Journal Lines
// ===========================
export const journalLines = pgTable("journal_lines", {
    id: uuid("id").primaryKey().default(sql `gen_random_uuid()`),
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
// ===========================
// Invoices
// ===========================
export const invoices = pgTable("invoices", {
    id: uuid("id").primaryKey().default(sql `gen_random_uuid()`),
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
// ===========================
// Invoice Lines
// ===========================
export const invoiceLines = pgTable("invoice_lines", {
    id: uuid("id").primaryKey().default(sql `gen_random_uuid()`),
    invoiceId: uuid("invoice_id").notNull().references(() => invoices.id, { onDelete: "cascade" }),
    description: text("description").notNull(),
    quantity: real("quantity").notNull(),
    unitPrice: real("unit_price").notNull(),
    vatRate: real("vat_rate").notNull().default(0.05), // UAE standard 5%
    vatSupplyType: text("vat_supply_type").default("standard_rated"), // standard_rated | zero_rated | exempt | out_of_scope
});
export const insertInvoiceLineSchema = createInsertSchema(invoiceLines).omit({
    id: true,
});
// ===========================
// Receipts/Documents
// ===========================
export const receipts = pgTable("receipts", {
    id: uuid("id").primaryKey().default(sql `gen_random_uuid()`),
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
// ===========================
// Customer Contacts (for invoicing)
// ===========================
export const customerContacts = pgTable("customer_contacts", {
    id: uuid("id").primaryKey().default(sql `gen_random_uuid()`),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    nameAr: text("name_ar"),
    email: text("email"),
    phone: text("phone"),
    trnNumber: text("trn_number"),
    address: text("address"),
    city: text("city"),
    country: text("country").default("UAE"),
    contactPerson: text("contact_person"),
    paymentTerms: integer("payment_terms").default(30),
    notes: text("notes"),
    isActive: boolean("is_active").default(true).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at"),
});
export const insertCustomerContactSchema = createInsertSchema(customerContacts).omit({
    id: true,
    createdAt: true,
    updatedAt: true,
});
// AI Categorization Request/Response
export const categorizationRequestSchema = z.object({
    companyId: z.string().uuid(),
    description: z.string().min(1),
    amount: z.number(),
    currency: z.string().default("AED"),
});
// ===========================
// Waitlist / Email Collection
// ===========================
export const waitlist = pgTable("waitlist", {
    id: uuid("id").primaryKey().default(sql `gen_random_uuid()`),
    email: text("email").notNull().unique(),
    source: text("source").notNull().default("landing_page"), // landing_page | popup | other
    createdAt: timestamp("created_at").defaultNow().notNull(),
});
export const insertWaitlistSchema = createInsertSchema(waitlist).omit({
    id: true,
    createdAt: true,
});
// ===========================
// Integration Sync History
// ===========================
export const integrationSyncs = pgTable("integration_syncs", {
    id: uuid("id").primaryKey().default(sql `gen_random_uuid()`),
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
// ===========================
// WhatsApp Integration
// ===========================
export const whatsappConfigs = pgTable("whatsapp_configs", {
    id: uuid("id").primaryKey().default(sql `gen_random_uuid()`),
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
// WhatsApp Message Logs
export const whatsappMessages = pgTable("whatsapp_messages", {
    id: uuid("id").primaryKey().default(sql `gen_random_uuid()`),
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
// ===========================
// AI Anomaly Detection
// ===========================
export const anomalyAlerts = pgTable("anomaly_alerts", {
    id: uuid("id").primaryKey().default(sql `gen_random_uuid()`),
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
// ===========================
// Bank Transactions (for reconciliation)
// ===========================
export const bankTransactions = pgTable("bank_transactions", {
    id: uuid("id").primaryKey().default(sql `gen_random_uuid()`),
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
// ===========================
// Cash Flow Forecasts
// ===========================
export const cashFlowForecasts = pgTable("cash_flow_forecasts", {
    id: uuid("id").primaryKey().default(sql `gen_random_uuid()`),
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
// ===========================
// AI Transaction Classifications (for ML-style learning)
// ===========================
export const transactionClassifications = pgTable("transaction_classifications", {
    id: uuid("id").primaryKey().default(sql `gen_random_uuid()`),
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
// ===========================
// Budgets (for Budget vs Actual)
// ===========================
export const budgets = pgTable("budgets", {
    id: uuid("id").primaryKey().default(sql `gen_random_uuid()`),
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
// ===========================
// E-Commerce Integrations (Stripe, Shopify, Salesforce)
// ===========================
export const ecommerceIntegrations = pgTable("ecommerce_integrations", {
    id: uuid("id").primaryKey().default(sql `gen_random_uuid()`),
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
// ===========================
// E-Commerce Transactions (imported from platforms)
// ===========================
export const ecommerceTransactions = pgTable("ecommerce_transactions", {
    id: uuid("id").primaryKey().default(sql `gen_random_uuid()`),
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
// ===========================
// Financial KPIs (for real-time indicators)
// ===========================
export const financialKpis = pgTable("financial_kpis", {
    id: uuid("id").primaryKey().default(sql `gen_random_uuid()`),
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
// ===========================
// Smart Reminders & Notifications
// ===========================
export const notifications = pgTable("notifications", {
    id: uuid("id").primaryKey().default(sql `gen_random_uuid()`),
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
});
export const insertNotificationSchema = createInsertSchema(notifications).omit({
    id: true,
    createdAt: true,
    readAt: true,
});
// ===========================
// Regulatory News Feed
// ===========================
export const regulatoryNews = pgTable("regulatory_news", {
    id: uuid("id").primaryKey().default(sql `gen_random_uuid()`),
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
// ===========================
// Reminder Settings (for automated reminders)
// ===========================
export const reminderSettings = pgTable("reminder_settings", {
    id: uuid("id").primaryKey().default(sql `gen_random_uuid()`),
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
    // Template customization
    emailSubject: text("email_subject"),
    emailTemplate: text("email_template"),
    smsTemplate: text("sms_template"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
export const insertReminderSettingSchema = createInsertSchema(reminderSettings).omit({
    id: true,
    createdAt: true,
    updatedAt: true,
});
// ===========================
// Reminder Logs (track sent reminders)
// ===========================
export const reminderLogs = pgTable("reminder_logs", {
    id: uuid("id").primaryKey().default(sql `gen_random_uuid()`),
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
});
export const insertReminderLogSchema = createInsertSchema(reminderLogs).omit({
    id: true,
    createdAt: true,
});
// ===========================
// User Onboarding Progress
// ===========================
export const userOnboarding = pgTable("user_onboarding", {
    id: uuid("id").primaryKey().default(sql `gen_random_uuid()`),
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
});
export const insertUserOnboardingSchema = createInsertSchema(userOnboarding).omit({
    id: true,
    createdAt: true,
    updatedAt: true,
});
// ===========================
// Help Tips (contextual help)
// ===========================
export const helpTips = pgTable("help_tips", {
    id: uuid("id").primaryKey().default(sql `gen_random_uuid()`),
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
// ===========================
// Referral Codes
// ===========================
export const referralCodes = pgTable("referral_codes", {
    id: uuid("id").primaryKey().default(sql `gen_random_uuid()`),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    code: text("code").notNull().unique(), // Unique referral code
    customSlug: text("custom_slug").unique(), // User-friendly custom slug
    isActive: boolean("is_active").notNull().default(true),
    // Reward configuration
    referrerRewardType: text("referrer_reward_type").default("credit"), // credit | discount | subscription_days
    referrerRewardValue: real("referrer_reward_value").default(0),
    refereeRewardType: text("referee_reward_type").default("discount"), // credit | discount | trial_extension
    refereeRewardValue: real("referee_reward_value").default(0),
    // Tracking
    totalReferrals: integer("total_referrals").notNull().default(0),
    successfulReferrals: integer("successful_referrals").notNull().default(0),
    totalRewardsEarned: real("total_rewards_earned").notNull().default(0),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    expiresAt: timestamp("expires_at"),
});
export const insertReferralCodeSchema = createInsertSchema(referralCodes).omit({
    id: true,
    createdAt: true,
});
// ===========================
// Referrals (tracking sign-ups)
// ===========================
export const referrals = pgTable("referrals", {
    id: uuid("id").primaryKey().default(sql `gen_random_uuid()`),
    referralCodeId: uuid("referral_code_id").notNull().references(() => referralCodes.id, { onDelete: "cascade" }),
    referrerId: uuid("referrer_id").notNull().references(() => users.id),
    refereeId: uuid("referee_id").references(() => users.id), // Null until they sign up
    refereeEmail: text("referee_email"), // Email before sign-up
    status: text("status").notNull().default("pending"), // pending | signed_up | qualified | rewarded | expired
    // Reward tracking
    referrerRewardStatus: text("referrer_reward_status").default("pending"), // pending | credited | used
    refereeRewardStatus: text("referee_reward_status").default("pending"),
    referrerRewardAmount: real("referrer_reward_amount"),
    refereeRewardAmount: real("referee_reward_amount"),
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
// ===========================
// User Feedback
// ===========================
export const userFeedback = pgTable("user_feedback", {
    id: uuid("id").primaryKey().default(sql `gen_random_uuid()`),
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
// ===========================
// Analytics Events
// ===========================
export const analyticsEvents = pgTable("analytics_events", {
    id: uuid("id").primaryKey().default(sql `gen_random_uuid()`),
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
// ===========================
// Feature Usage Metrics (aggregated)
// ===========================
export const featureUsageMetrics = pgTable("feature_usage_metrics", {
    id: uuid("id").primaryKey().default(sql `gen_random_uuid()`),
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
// ===========================
// Admin Settings (Platform-wide)
// ===========================
export const adminSettings = pgTable("admin_settings", {
    id: uuid("id").primaryKey().default(sql `gen_random_uuid()`),
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
// ===========================
// Subscription Plans
// ===========================
export const subscriptionPlans = pgTable("subscription_plans", {
    id: uuid("id").primaryKey().default(sql `gen_random_uuid()`),
    name: text("name").notNull(),
    nameAr: text("name_ar"),
    description: text("description"),
    descriptionAr: text("description_ar"),
    priceMonthly: real("price_monthly").notNull(),
    priceYearly: real("price_yearly"),
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
// ===========================
// User Subscriptions
// ===========================
export const userSubscriptions = pgTable("user_subscriptions", {
    id: uuid("id").primaryKey().default(sql `gen_random_uuid()`),
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
// ===========================
// VAT Returns (for FTA VAT 201 compliance)
// Matches official FTA VAT 201 Return format
// ===========================
export const vatReturns = pgTable("vat_returns", {
    id: uuid("id").primaryKey().default(sql `gen_random_uuid()`),
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
    box1aAbuDhabiAmount: real("box1a_abu_dhabi_amount").notNull().default(0),
    box1aAbuDhabiVat: real("box1a_abu_dhabi_vat").notNull().default(0),
    box1aAbuDhabiAdj: real("box1a_abu_dhabi_adj").notNull().default(0),
    box1bDubaiAmount: real("box1b_dubai_amount").notNull().default(0),
    box1bDubaiVat: real("box1b_dubai_vat").notNull().default(0),
    box1bDubaiAdj: real("box1b_dubai_adj").notNull().default(0),
    box1cSharjahAmount: real("box1c_sharjah_amount").notNull().default(0),
    box1cSharjahVat: real("box1c_sharjah_vat").notNull().default(0),
    box1cSharjahAdj: real("box1c_sharjah_adj").notNull().default(0),
    box1dAjmanAmount: real("box1d_ajman_amount").notNull().default(0),
    box1dAjmanVat: real("box1d_ajman_vat").notNull().default(0),
    box1dAjmanAdj: real("box1d_ajman_adj").notNull().default(0),
    box1eUmmAlQuwainAmount: real("box1e_umm_al_quwain_amount").notNull().default(0),
    box1eUmmAlQuwainVat: real("box1e_umm_al_quwain_vat").notNull().default(0),
    box1eUmmAlQuwainAdj: real("box1e_umm_al_quwain_adj").notNull().default(0),
    box1fRasAlKhaimahAmount: real("box1f_ras_al_khaimah_amount").notNull().default(0),
    box1fRasAlKhaimahVat: real("box1f_ras_al_khaimah_vat").notNull().default(0),
    box1fRasAlKhaimahAdj: real("box1f_ras_al_khaimah_adj").notNull().default(0),
    box1gFujairahAmount: real("box1g_fujairah_amount").notNull().default(0),
    box1gFujairahVat: real("box1g_fujairah_vat").notNull().default(0),
    box1gFujairahAdj: real("box1g_fujairah_adj").notNull().default(0),
    // Box 2: Tax Refunds to Tourists
    box2TouristRefundAmount: real("box2_tourist_refund_amount").notNull().default(0),
    box2TouristRefundVat: real("box2_tourist_refund_vat").notNull().default(0),
    // Box 3: Supplies subject to reverse charge
    box3ReverseChargeAmount: real("box3_reverse_charge_amount").notNull().default(0),
    box3ReverseChargeVat: real("box3_reverse_charge_vat").notNull().default(0),
    // Box 4: Zero Rated Supplies
    box4ZeroRatedAmount: real("box4_zero_rated_amount").notNull().default(0),
    // Box 5: Exempt Supplies
    box5ExemptAmount: real("box5_exempt_amount").notNull().default(0),
    // Box 6: Goods imported into UAE
    box6ImportsAmount: real("box6_imports_amount").notNull().default(0),
    box6ImportsVat: real("box6_imports_vat").notNull().default(0),
    // Box 7: Adjustments to goods imported
    box7ImportsAdjAmount: real("box7_imports_adj_amount").notNull().default(0),
    box7ImportsAdjVat: real("box7_imports_adj_vat").notNull().default(0),
    // Box 8: Totals for Output VAT
    box8TotalAmount: real("box8_total_amount").notNull().default(0),
    box8TotalVat: real("box8_total_vat").notNull().default(0),
    box8TotalAdj: real("box8_total_adj").notNull().default(0),
    // ===== VAT ON EXPENSES AND ALL OTHER INPUTS =====
    // Box 9: Standard Rated Expenses
    box9ExpensesAmount: real("box9_expenses_amount").notNull().default(0),
    box9ExpensesVat: real("box9_expenses_vat").notNull().default(0),
    box9ExpensesAdj: real("box9_expenses_adj").notNull().default(0),
    // Box 10: Supplies subject to reverse charge (input)
    box10ReverseChargeAmount: real("box10_reverse_charge_amount").notNull().default(0),
    box10ReverseChargeVat: real("box10_reverse_charge_vat").notNull().default(0),
    // Box 11: Totals for Input VAT
    box11TotalAmount: real("box11_total_amount").notNull().default(0),
    box11TotalVat: real("box11_total_vat").notNull().default(0),
    box11TotalAdj: real("box11_total_adj").notNull().default(0),
    // ===== NET VAT DUE =====
    // Box 12: Total value of due tax for the period
    box12TotalDueTax: real("box12_total_due_tax").notNull().default(0),
    // Box 13: Total value of recoverable tax for the period
    box13RecoverableTax: real("box13_recoverable_tax").notNull().default(0),
    // Box 14: Payable tax for the period (Box 12 - Box 13)
    box14PayableTax: real("box14_payable_tax").notNull().default(0),
    // Legacy fields for backward compatibility
    box1SalesStandard: real("box1_sales_standard").notNull().default(0),
    box2SalesOtherEmirates: real("box2_sales_other_emirates").notNull().default(0),
    box3SalesTaxExempt: real("box3_sales_tax_exempt").notNull().default(0),
    box4SalesExempt: real("box4_sales_exempt").notNull().default(0),
    box5TotalOutputTax: real("box5_total_output_tax").notNull().default(0),
    box6ExpensesStandard: real("box6_expenses_standard").notNull().default(0),
    box7ExpensesTouristRefund: real("box7_expenses_tourist_refund").notNull().default(0),
    box8TotalInputTax: real("box8_total_input_tax").notNull().default(0),
    box9NetTax: real("box9_net_tax").notNull().default(0),
    adjustmentAmount: real("adjustment_amount").default(0),
    adjustmentReason: text("adjustment_reason"),
    // Filing info
    submittedBy: uuid("submitted_by").references(() => users.id),
    submittedAt: timestamp("submitted_at"),
    ftaReferenceNumber: text("fta_reference_number"),
    paymentStatus: text("payment_status").default("unpaid"), // unpaid | paid | partial
    paymentAmount: real("payment_amount"),
    paymentDate: timestamp("payment_date"),
    notes: text("notes"),
    // Declaration
    declarantName: text("declarant_name"),
    declarantPosition: text("declarant_position"),
    declarationDate: timestamp("declaration_date"),
    createdBy: uuid("created_by").notNull().references(() => users.id),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
export const insertVatReturnSchema = createInsertSchema(vatReturns).omit({
    id: true,
    createdAt: true,
    updatedAt: true,
});
// ===========================
// System Audit Logs
// ===========================
export const auditLogs = pgTable("audit_logs", {
    id: uuid("id").primaryKey().default(sql `gen_random_uuid()`),
    userId: uuid("user_id").references(() => users.id),
    action: text("action").notNull(), // create | update | delete | login | logout | admin_action
    resourceType: text("resource_type").notNull(), // user | company | invoice | receipt | setting | subscription
    resourceId: text("resource_id"),
    details: text("details"), // JSON with change details
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
});
export const insertAuditLogSchema = createInsertSchema(auditLogs).omit({
    id: true,
    createdAt: true,
});
// ===========================
// Document Vault (Trade licenses, contracts, tax certificates with expiry tracking)
// ===========================
export const documents = pgTable("documents", {
    id: uuid("id").primaryKey().default(sql `gen_random_uuid()`),
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
});
export const insertDocumentSchema = createInsertSchema(documents).omit({
    id: true,
    createdAt: true,
    updatedAt: true,
});
// ===========================
// Tax Return Archive (Historical filed returns with PDF storage)
// ===========================
export const taxReturnArchive = pgTable("tax_return_archive", {
    id: uuid("id").primaryKey().default(sql `gen_random_uuid()`),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    returnType: text("return_type").notNull(), // vat | corporate_tax | excise_tax
    periodLabel: text("period_label").notNull(), // e.g., "Q1 2025", "FY2024"
    periodStart: timestamp("period_start").notNull(),
    periodEnd: timestamp("period_end").notNull(),
    filingDate: timestamp("filing_date").notNull(),
    ftaReferenceNumber: text("fta_reference_number"),
    taxAmount: real("tax_amount").default(0),
    paymentStatus: text("payment_status").default("paid"), // paid | partial | unpaid
    fileUrl: text("file_url"), // PDF of filed return
    fileName: text("file_name"),
    notes: text("notes"),
    filedBy: uuid("filed_by").references(() => users.id),
    createdAt: timestamp("created_at").defaultNow().notNull(),
});
export const insertTaxReturnArchiveSchema = createInsertSchema(taxReturnArchive).omit({
    id: true,
    createdAt: true,
});
// ===========================
// Compliance Tasks & Reminders
// ===========================
export const complianceTasks = pgTable("compliance_tasks", {
    id: uuid("id").primaryKey().default(sql `gen_random_uuid()`),
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
});
export const insertComplianceTaskSchema = createInsertSchema(complianceTasks).omit({
    id: true,
    createdAt: true,
    updatedAt: true,
});
// ===========================
// Secure Messages (Client-Accountant Communication)
// ===========================
export const messages = pgTable("messages", {
    id: uuid("id").primaryKey().default(sql `gen_random_uuid()`),
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
});
export const insertMessageSchema = createInsertSchema(messages).omit({
    id: true,
    createdAt: true,
});
// ===========================
// UAE Tax News Feed Items
// ===========================
export const newsItems = pgTable("news_items", {
    id: uuid("id").primaryKey().default(sql `gen_random_uuid()`),
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
// ===========================
// User Invitations (Admin invites clients)
// ===========================
export const invitations = pgTable("invitations", {
    id: uuid("id").primaryKey().default(sql `gen_random_uuid()`),
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
});
export const insertInvitationSchema = createInsertSchema(invitations).omit({
    id: true,
    createdAt: true,
});
// ===========================
// Activity Logs (Audit Trail)
// ===========================
export const activityLogs = pgTable("activity_logs", {
    id: uuid("id").primaryKey().default(sql `gen_random_uuid()`),
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
});
export const insertActivityLogSchema = createInsertSchema(activityLogs).omit({
    id: true,
    createdAt: true,
});
// ===========================
// Client Notes (Admin notes about clients - internal only)
// ===========================
export const clientNotes = pgTable("client_notes", {
    id: uuid("id").primaryKey().default(sql `gen_random_uuid()`),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    authorId: uuid("author_id").notNull().references(() => users.id),
    content: text("content").notNull(),
    isPinned: boolean("is_pinned").default(false),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
export const insertClientNoteSchema = createInsertSchema(clientNotes).omit({
    id: true,
    createdAt: true,
    updatedAt: true,
});
// ===========================
// Client Engagements (NR Accounting managing clients)
// ===========================
// Tracks the relationship between NR Accounting and their clients
export const engagements = pgTable("engagements", {
    id: uuid("id").primaryKey().default(sql `gen_random_uuid()`),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    accountManagerId: uuid("account_manager_id").references(() => users.id), // NR staff assigned
    // Engagement Details
    engagementType: text("engagement_type").notNull().default("full_service"), // full_service | vat_only | bookkeeping | advisory
    status: text("status").notNull().default("active"), // active | on_hold | terminated
    startDate: timestamp("start_date").notNull(),
    endDate: timestamp("end_date"),
    // Service Agreement
    monthlyFee: real("monthly_fee"),
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
});
export const insertEngagementSchema = createInsertSchema(engagements).omit({
    id: true,
    createdAt: true,
    updatedAt: true,
});
// ===========================
// Service Invoices (NR Accounting billing to clients)
// ===========================
// Invoices from NR Accounting Services to their managed clients
export const serviceInvoices = pgTable("service_invoices", {
    id: uuid("id").primaryKey().default(sql `gen_random_uuid()`),
    engagementId: uuid("engagement_id").notNull().references(() => engagements.id, { onDelete: "cascade" }),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    // Invoice Details
    invoiceNumber: text("invoice_number").notNull(),
    invoiceDate: timestamp("invoice_date").notNull(),
    dueDate: timestamp("due_date").notNull(),
    // Amounts (in AED)
    subtotal: real("subtotal").notNull().default(0),
    vatAmount: real("vat_amount").notNull().default(0),
    total: real("total").notNull().default(0),
    // Payment
    status: text("status").notNull().default("draft"), // draft | sent | paid | overdue | void
    paidAmount: real("paid_amount").default(0),
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
});
export const insertServiceInvoiceSchema = createInsertSchema(serviceInvoices).omit({
    id: true,
    createdAt: true,
    updatedAt: true,
});
// ===========================
// Service Invoice Lines
// ===========================
export const serviceInvoiceLines = pgTable("service_invoice_lines", {
    id: uuid("id").primaryKey().default(sql `gen_random_uuid()`),
    serviceInvoiceId: uuid("service_invoice_id").notNull().references(() => serviceInvoices.id, { onDelete: "cascade" }),
    description: text("description").notNull(),
    quantity: real("quantity").notNull().default(1),
    unitPrice: real("unit_price").notNull(),
    vatRate: real("vat_rate").notNull().default(0.05), // UAE 5%
    amount: real("amount").notNull(), // quantity * unitPrice
});
export const insertServiceInvoiceLineSchema = createInsertSchema(serviceInvoiceLines).omit({
    id: true,
});
// ===========================
// FTA Email Sync (for client portal)
// ===========================
// Tracks emails synced from FTA for clients
export const ftaEmails = pgTable("fta_emails", {
    id: uuid("id").primaryKey().default(sql `gen_random_uuid()`),
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
});
export const insertFtaEmailSchema = createInsertSchema(ftaEmails).omit({
    id: true,
    createdAt: true,
});
// ===========================
// Customer Subscriptions (SaaS tier tracking)
// ===========================
export const subscriptions = pgTable("subscriptions", {
    id: uuid("id").primaryKey().default(sql `gen_random_uuid()`),
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
});
export const insertSubscriptionSchema = createInsertSchema(subscriptions).omit({
    id: true,
    createdAt: true,
    updatedAt: true,
});
// ===========================
// Data Backups (Financial Records Safeguard)
// ===========================
export const backups = pgTable("backups", {
    id: uuid("id").primaryKey().default(sql `gen_random_uuid()`),
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
});
export const insertBackupSchema = createInsertSchema(backups).omit({
    id: true,
    createdAt: true,
});
