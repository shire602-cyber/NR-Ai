import type { 
  User, InsertUser,
  Company, InsertCompany,
  CompanyUser, InsertCompanyUser,
  Account, InsertAccount,
  JournalEntry, InsertJournalEntry,
  JournalLine, InsertJournalLine,
  Invoice, InsertInvoice,
  InvoiceLine, InsertInvoiceLine,
  Receipt, InsertReceipt,
  CustomerContact, InsertCustomerContact,
  Waitlist, InsertWaitlist,
  IntegrationSync, InsertIntegrationSync,
  WhatsappConfig, InsertWhatsappConfig,
  WhatsappMessage, InsertWhatsappMessage,
  AnomalyAlert, InsertAnomalyAlert,
  BankTransaction, InsertBankTransaction,
  CashFlowForecast, InsertCashFlowForecast,
  TransactionClassification, InsertTransactionClassification,
  Budget, InsertBudget,
  EcommerceIntegration, InsertEcommerceIntegration,
  EcommerceTransaction, InsertEcommerceTransaction,
  FinancialKpi, InsertFinancialKpi,
  Notification, InsertNotification,
  RegulatoryNews, InsertRegulatoryNews,
  ReminderSetting, InsertReminderSetting,
  ReminderLog, InsertReminderLog,
  UserOnboarding, InsertUserOnboarding,
  HelpTip, InsertHelpTip,
  ReferralCode, InsertReferralCode,
  Referral, InsertReferral,
  UserFeedback, InsertUserFeedback,
  AnalyticsEvent, InsertAnalyticsEvent,
  FeatureUsageMetric, InsertFeatureUsageMetric,
  AdminSetting, InsertAdminSetting,
  SubscriptionPlan, InsertSubscriptionPlan,
  UserSubscription, InsertUserSubscription,
  AuditLog, InsertAuditLog,
  VatReturn, InsertVatReturn,
  Document, InsertDocument,
  TaxReturnArchive, InsertTaxReturnArchive,
  ComplianceTask, InsertComplianceTask,
  Message, InsertMessage,
  NewsItem, InsertNewsItem,
  Invitation, InsertInvitation,
  ActivityLog, InsertActivityLog,
  ClientNote, InsertClientNote,
  Engagement, InsertEngagement,
  ServiceInvoice, InsertServiceInvoice,
  ServiceInvoiceLine, InsertServiceInvoiceLine,
  FtaEmail, InsertFtaEmail,
  Subscription, InsertSubscription,
  Backup, InsertBackup,
  AiConversation, InsertAiConversation,
  RecurringInvoice, InsertRecurringInvoice,
  CorporateTaxReturn, InsertCorporateTaxReturn,
  Product, InsertProduct,
  InventoryMovement, InsertInventoryMovement,
  BankAccount, InsertBankAccount,
  InvoicePayment, InsertInvoicePayment,
  PaymentChase, InsertPaymentChase,
  ChaseTemplate, InsertChaseTemplate,
  ChaseConfig, InsertChaseConfig
} from "@shared/schema";
import {
  passwordResetTokens,
  users,
  companies,
  companyUsers,
  firmStaffAssignments,
  accounts,
  journalEntries,
  journalLines,
  invoices,
  invoiceLines,
  receipts,
  customerContacts,
  waitlist,
  integrationSyncs,
  whatsappConfigs,
  whatsappMessages,
  anomalyAlerts,
  bankAccounts,
  bankTransactions,
  cashFlowForecasts,
  transactionClassifications,
  budgets,
  ecommerceIntegrations,
  ecommerceTransactions,
  financialKpis,
  notifications,
  regulatoryNews,
  reminderSettings,
  reminderLogs,
  userOnboarding,
  helpTips,
  referralCodes,
  referrals,
  userFeedback,
  analyticsEvents,
  featureUsageMetrics,
  adminSettings,
  subscriptionPlans,
  userSubscriptions,
  auditLogs,
  vatReturns,
  documents,
  taxReturnArchive,
  complianceTasks,
  messages,
  newsItems,
  invitations,
  activityLogs,
  clientNotes,
  engagements,
  serviceInvoices,
  serviceInvoiceLines,
  ftaEmails,
  subscriptions,
  backups,
  aiConversations,
  recurringInvoices,
  corporateTaxReturns,
  products,
  inventoryMovements,
  invoicePayments,
  paymentChases,
  chaseTemplates,
  chaseConfigs
} from "@shared/schema";
import { db } from "./db";
import { eq, and, desc, lt, lte, gt, gte, isNull, isNotNull, or, sql, inArray } from "drizzle-orm";
import Decimal from "decimal.js";
import { statusFromPayments, isTerminal, type InvoiceStatus } from "./services/invoice-state-machine";
import { ACCOUNT_CODES } from "./constants";

// Default cap on list-endpoint queries. Without this, a single tenant with
// runaway invoice/journal volume can pull tens of MB into memory. Pages that
// truly need the full dataset (PDF export, GL ledger) pass an explicit limit.
const DEFAULT_LIST_LIMIT = 1000;

// Stable 32-bit hash of a string, used to derive Postgres advisory-lock keys.
// Postgres advisory locks accept (int4, int4); pg_advisory_lock(bigint) would
// also work but the two-int form makes the namespace more obvious.
function hashStringToInt(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  }
  return h;
}

// Tolerance for float-rounding drift. Anything beyond this is a real imbalance.
const JOURNAL_BALANCE_TOLERANCE = 0.01;

function assertBalanced(lines: Array<{ debit?: number | null; credit?: number | null }>): void {
  const totalDebit = lines.reduce((sum, l) => sum + (Number(l.debit) || 0), 0);
  const totalCredit = lines.reduce((sum, l) => sum + (Number(l.credit) || 0), 0);
  if (Math.abs(totalDebit - totalCredit) > JOURNAL_BALANCE_TOLERANCE) {
    throw new Error(
      `Journal entry is unbalanced: debits ${totalDebit.toFixed(2)} ≠ credits ${totalCredit.toFixed(2)}`
    );
  }
}

export interface IStorage {
  // Users
  getUser(id: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  updateUserPassword(userId: string, passwordHash: string): Promise<void>;

  // Password reset tokens
  createPasswordResetToken(input: { userId: string; tokenHash: string; expiresAt: Date }): Promise<void>;
  findValidPasswordResetToken(tokenHash: string): Promise<{ id: string; userId: string } | undefined>;
  markPasswordResetTokenUsed(id: string): Promise<void>;
  deletePasswordResetTokensForUser(userId: string): Promise<void>;
  
  // Companies
  getCompany(id: string): Promise<Company | undefined>;
  getCompanyByName(name: string): Promise<Company | undefined>;
  getCompaniesByUserId(userId: string): Promise<Company[]>;
  createCompany(company: InsertCompany): Promise<Company>;
  updateCompany(id: string, data: Partial<InsertCompany>): Promise<Company>;
  
  // Company Users
  createCompanyUser(companyUser: InsertCompanyUser): Promise<CompanyUser>;
  getUserRole(companyId: string, userId: string): Promise<CompanyUser | undefined>;
  getCompanyUsersByCompanyId(companyId: string): Promise<CompanyUser[]>;
  /**
   * Check whether the user has access to a company. Optional firmRole allows
   * firm_owner (all client companies) or firm_admin (assigned client companies)
   * to be treated as having access without an explicit company_users row.
   */
  hasCompanyAccess(userId: string, companyId: string, firmRole?: string | null): Promise<boolean>;
  /**
   * Return all companies a user can access — direct company_users membership
   * plus firm-accessible client companies if firmRole is supplied.
   */
  getAccessibleCompanies(userId: string, firmRole?: string | null): Promise<Company[]>;
  
  // Accounts
  getAccount(id: string, companyId: string): Promise<Account | undefined>;
  getAccountsByCompanyId(companyId: string): Promise<Account[]>;
  createAccount(account: InsertAccount): Promise<Account>;
  updateAccount(id: string, companyId: string, data: Partial<Account>): Promise<Account>;
  deleteAccount(id: string, companyId: string): Promise<void>;
  accountHasTransactions(accountId: string): Promise<boolean>;
  
  // Account Ledger & Balance
  getAccountsWithBalances(companyId: string, dateRange?: { start: Date; end: Date }): Promise<{
    account: Account;
    balance: number;
    debitTotal: number;
    creditTotal: number;
  }[]>;
  getAccountLedger(accountId: string, options?: { 
    dateStart?: Date; 
    dateEnd?: Date; 
    search?: string;
    limit?: number;
    offset?: number;
  }): Promise<{
    entries: {
      id: string;
      date: Date;
      entryNumber: string;
      description: string;
      debit: number;
      credit: number;
      runningBalance: number;
      journalEntryId: string;
      journalLineId: string;
      memo: string | null;
      source: string;
      status: string;
    }[];
    allEntries: {
      id: string;
      date: Date;
      entryNumber: string;
      description: string;
      debit: number;
      credit: number;
      runningBalance: number;
      journalEntryId: string;
      journalLineId: string;
      memo: string | null;
      source: string;
      status: string;
    }[];
    account: Account;
    openingBalance: number;
    totalDebit: number;
    totalCredit: number;
    closingBalance: number;
    totalCount: number;
  }>;
  
  // Journal Entries
  getJournalEntry(id: string, companyId: string): Promise<JournalEntry | undefined>;
  getJournalEntriesByCompanyId(companyId: string): Promise<JournalEntry[]>;
  getPostedJournalEntriesWithLines(
    companyId: string,
  ): Promise<Array<{ entry: JournalEntry; lines: JournalLine[] }>>;
  createJournalEntry(entry: InsertJournalEntry & { postedAt?: Date | null; updatedAt?: Date | null }, lines: Array<Omit<InsertJournalLine, 'entryId'>>): Promise<JournalEntry>;
  updateJournalEntry(id: string, companyId: string, data: Partial<JournalEntry>): Promise<JournalEntry>;
  updateJournalEntryWithLines(id: string, companyId: string, data: Partial<JournalEntry>, lines: Array<Omit<InsertJournalLine, 'entryId'>>): Promise<JournalEntry>;
  deleteJournalEntry(id: string, companyId: string): Promise<void>;
  generateEntryNumber(companyId: string, date: Date): Promise<string>;
  
  // Journal Lines
  createJournalLine(line: InsertJournalLine): Promise<JournalLine>;
  getJournalLinesByEntryId(entryId: string): Promise<JournalLine[]>;
  getJournalLinesByEntryIds(entryIds: string[]): Promise<JournalLine[]>;
  deleteJournalLinesByEntryId(entryId: string): Promise<void>;

  // Invoices
  getInvoice(id: string, companyId: string): Promise<Invoice | undefined>;
  getInvoicesByCompanyId(companyId: string): Promise<Invoice[]>;
  getInvoicesSummaryByCompanyId(companyId: string, opts?: { limit?: number; offset?: number }): Promise<Omit<Invoice, 'einvoiceXml' | 'einvoiceHash'>[]>;
  createInvoice(invoice: InsertInvoice): Promise<Invoice>;
  updateInvoice(id: string, companyId: string, data: Partial<InsertInvoice>): Promise<Invoice>;
  updateInvoiceStatus(id: string, companyId: string, status: string): Promise<Invoice>;
  deleteInvoice(id: string, companyId: string): Promise<void>;
  
  // Invoice Share Token
  getInvoiceByShareToken(token: string): Promise<Invoice | undefined>;
  setInvoiceShareToken(id: string, token: string, expiresAt: Date): Promise<void>;

  // Invoice Lines
  createInvoiceLine(line: InsertInvoiceLine): Promise<InvoiceLine>;
  getInvoiceLinesByInvoiceId(invoiceId: string): Promise<InvoiceLine[]>;
  getInvoiceLinesByInvoiceIds(invoiceIds: string[]): Promise<InvoiceLine[]>;
  deleteInvoiceLinesByInvoiceId(invoiceId: string): Promise<void>;
  
  // Receipts
  getReceipt(id: string, companyId: string): Promise<Receipt | undefined>;
  createReceipt(receipt: InsertReceipt): Promise<Receipt>;
  getReceiptsByCompanyId(companyId: string): Promise<Receipt[]>;
  updateReceipt(id: string, companyId: string, data: Partial<InsertReceipt>): Promise<Receipt>;
  deleteReceipt(id: string, companyId: string): Promise<void>;
  
  // Customer Contacts
  getCustomerContact(id: string): Promise<CustomerContact | undefined>;
  getCustomerContactsByCompanyId(companyId: string): Promise<CustomerContact[]>;
  getCustomerContactByEmail(companyId: string, email: string): Promise<CustomerContact | undefined>;
  getCustomerContactByTrn(companyId: string, trn: string): Promise<CustomerContact | undefined>;
  createCustomerContact(contact: InsertCustomerContact): Promise<CustomerContact>;
  createBulkCustomerContacts(contacts: InsertCustomerContact[]): Promise<CustomerContact[]>;
  updateCustomerContact(id: string, data: Partial<InsertCustomerContact>): Promise<CustomerContact>;
  deleteCustomerContact(id: string): Promise<void>;
  deleteAllCustomerContactsByCompanyId(companyId: string): Promise<number>;
  countCustomerContactsByCompanyId(companyId: string): Promise<number>;
  countInvoicesWithContactByCompanyId(companyId: string): Promise<number>;
  getCustomerContactByPortalToken(token: string): Promise<CustomerContact | undefined>;
  setPortalAccessToken(contactId: string, token: string, expiresAt: Date): Promise<CustomerContact>;

  // Waitlist
  createWaitlistEntry(entry: InsertWaitlist): Promise<Waitlist>;
  getWaitlistByEmail(email: string): Promise<Waitlist | undefined>;
  
  // Integration Syncs
  createIntegrationSync(sync: InsertIntegrationSync): Promise<IntegrationSync>;
  getIntegrationSyncsByCompanyId(companyId: string): Promise<IntegrationSync[]>;
  getIntegrationSyncsByType(companyId: string, integrationType: string): Promise<IntegrationSync[]>;

  // WhatsApp Configuration
  getWhatsappConfig(companyId: string): Promise<WhatsappConfig | undefined>;
  getWhatsappConfigByPhoneNumberId(phoneNumberId: string): Promise<WhatsappConfig | undefined>;
  createWhatsappConfig(config: InsertWhatsappConfig): Promise<WhatsappConfig>;
  updateWhatsappConfig(id: string, data: Partial<InsertWhatsappConfig>): Promise<WhatsappConfig>;

  // WhatsApp Messages
  createWhatsappMessage(message: InsertWhatsappMessage): Promise<WhatsappMessage>;
  getWhatsappMessagesByCompanyId(companyId: string): Promise<WhatsappMessage[]>;
  getWhatsappMessage(id: string): Promise<WhatsappMessage | undefined>;
  updateWhatsappMessage(id: string, data: Partial<InsertWhatsappMessage>): Promise<WhatsappMessage>;

  // AI Anomaly Alerts
  createAnomalyAlert(alert: InsertAnomalyAlert): Promise<AnomalyAlert>;
  getAnomalyAlertById(id: string): Promise<AnomalyAlert | undefined>;
  getAnomalyAlertsByCompanyId(companyId: string): Promise<AnomalyAlert[]>;
  getUnresolvedAnomalyAlerts(companyId: string): Promise<AnomalyAlert[]>;
  updateAnomalyAlert(id: string, data: Partial<InsertAnomalyAlert>): Promise<AnomalyAlert>;
  resolveAnomalyAlert(id: string, userId: string, note?: string): Promise<AnomalyAlert>;

  // Bank Accounts
  createBankAccount(account: InsertBankAccount): Promise<BankAccount>;
  getBankAccountsByCompanyId(companyId: string): Promise<BankAccount[]>;
  getBankAccountById(id: string): Promise<BankAccount | undefined>;
  updateBankAccount(id: string, data: Partial<InsertBankAccount>): Promise<BankAccount>;

  // Bank Transactions
  createBankTransaction(transaction: InsertBankTransaction): Promise<BankTransaction>;
  bulkCreateBankTransactions(transactions: InsertBankTransaction[]): Promise<BankTransaction[]>;
  getBankTransactionById(id: string, companyId: string): Promise<BankTransaction | undefined>;
  getBankTransactionsByCompanyId(companyId: string): Promise<BankTransaction[]>;
  getUnreconciledBankTransactions(companyId: string): Promise<BankTransaction[]>;
  updateBankTransaction(id: string, companyId: string, data: Partial<InsertBankTransaction>): Promise<BankTransaction>;
  reconcileBankTransaction(
    id: string,
    companyId: string,
    matchedId: string,
    matchType: 'journal' | 'receipt' | 'invoice',
    createdBy?: string,
  ): Promise<BankTransaction>;

  // Cash Flow Forecasts
  createCashFlowForecast(forecast: InsertCashFlowForecast): Promise<CashFlowForecast>;
  getCashFlowForecastsByCompanyId(companyId: string): Promise<CashFlowForecast[]>;
  deleteCashFlowForecastsByCompanyId(companyId: string): Promise<void>;

  // Transaction Classifications
  createTransactionClassification(classification: InsertTransactionClassification): Promise<TransactionClassification>;
  getTransactionClassification(id: string): Promise<TransactionClassification | undefined>;
  getTransactionClassificationsByCompanyId(companyId: string): Promise<TransactionClassification[]>;
  updateTransactionClassification(id: string, companyId: string, data: Partial<InsertTransactionClassification>): Promise<TransactionClassification>;

  // Journal Lines (for analytics)
  getJournalLinesByCompanyId(companyId: string): Promise<JournalLine[]>;

  // Budgets
  getBudgetsByCompanyId(companyId: string, year: number, month: number): Promise<Budget[]>;
  createBudget(budget: InsertBudget): Promise<Budget>;
  updateBudget(id: string, companyId: string, data: Partial<InsertBudget>): Promise<Budget>;

  // E-Commerce Integrations
  getEcommerceIntegrations(companyId: string): Promise<EcommerceIntegration[]>;
  getEcommerceIntegrationById(id: string): Promise<EcommerceIntegration | undefined>;
  createEcommerceIntegration(integration: InsertEcommerceIntegration): Promise<EcommerceIntegration>;
  updateEcommerceIntegration(id: string, data: Partial<InsertEcommerceIntegration>): Promise<EcommerceIntegration>;
  deleteEcommerceIntegration(id: string): Promise<void>;

  // E-Commerce Transactions
  getEcommerceTransactions(companyId: string): Promise<EcommerceTransaction[]>;
  createEcommerceTransaction(transaction: InsertEcommerceTransaction): Promise<EcommerceTransaction>;
  updateEcommerceTransaction(id: string, data: Partial<InsertEcommerceTransaction>): Promise<EcommerceTransaction>;

  // Financial KPIs
  getFinancialKpis(companyId: string): Promise<FinancialKpi[]>;
  createFinancialKpi(kpi: InsertFinancialKpi): Promise<FinancialKpi>;
  
  // Cash Flow Forecasts (alias for consistency)
  getCashFlowForecasts(companyId: string): Promise<CashFlowForecast[]>;
  
  // Notifications
  getNotificationsByUserId(userId: string): Promise<Notification[]>;
  getUnreadNotificationCount(userId: string): Promise<number>;
  createNotification(notification: InsertNotification): Promise<Notification>;
  markNotificationAsRead(id: string): Promise<Notification>;
  markAllNotificationsAsRead(userId: string): Promise<void>;
  dismissNotification(id: string): Promise<Notification>;
  
  // Regulatory News
  getRegulatoryNews(): Promise<RegulatoryNews[]>;
  createRegulatoryNews(news: InsertRegulatoryNews): Promise<RegulatoryNews>;
  
  // Reminder Settings
  getReminderSettingsByCompanyId(companyId: string): Promise<ReminderSetting[]>;
  createReminderSetting(setting: InsertReminderSetting): Promise<ReminderSetting>;
  updateReminderSetting(id: string, data: Partial<InsertReminderSetting>): Promise<ReminderSetting>;
  
  // Reminder Logs
  getReminderLogsByCompanyId(companyId: string): Promise<ReminderLog[]>;
  createReminderLog(log: InsertReminderLog): Promise<ReminderLog>;
  updateReminderLog(id: string, data: Partial<InsertReminderLog>): Promise<ReminderLog>;
  
  // User Onboarding
  getUserOnboarding(userId: string): Promise<UserOnboarding | undefined>;
  createUserOnboarding(onboarding: InsertUserOnboarding): Promise<UserOnboarding>;
  updateUserOnboarding(userId: string, data: Partial<InsertUserOnboarding>): Promise<UserOnboarding>;
  
  // Help Tips
  getHelpTipsByPage(pageContext: string): Promise<HelpTip[]>;
  getAllHelpTips(): Promise<HelpTip[]>;
  createHelpTip(tip: InsertHelpTip): Promise<HelpTip>;
  
  // Referral Codes
  getReferralCodeByUserId(userId: string): Promise<ReferralCode | undefined>;
  getReferralCodeByCode(code: string): Promise<ReferralCode | undefined>;
  createReferralCode(code: InsertReferralCode): Promise<ReferralCode>;
  updateReferralCode(id: string, data: Partial<InsertReferralCode>): Promise<ReferralCode>;
  
  // Referrals
  getReferralsByReferrerId(referrerId: string): Promise<Referral[]>;
  createReferral(referral: InsertReferral): Promise<Referral>;
  updateReferral(id: string, data: Partial<InsertReferral>): Promise<Referral>;
  
  // User Feedback
  createUserFeedback(feedback: InsertUserFeedback): Promise<UserFeedback>;
  getUserFeedback(userId?: string): Promise<UserFeedback[]>;
  updateUserFeedback(id: string, data: Partial<InsertUserFeedback>): Promise<UserFeedback>;
  
  // Analytics Events
  createAnalyticsEvent(event: InsertAnalyticsEvent): Promise<AnalyticsEvent>;
  getAnalyticsEvents(filters?: { userId?: string; eventType?: string; startDate?: Date; endDate?: Date }): Promise<AnalyticsEvent[]>;
  
  // Feature Usage Metrics
  getFeatureUsageMetrics(featureName?: string): Promise<FeatureUsageMetric[]>;
  createFeatureUsageMetric(metric: InsertFeatureUsageMetric): Promise<FeatureUsageMetric>;

  // Admin Settings
  getAdminSettings(): Promise<AdminSetting[]>;
  getAdminSettingByKey(key: string): Promise<AdminSetting | undefined>;
  createAdminSetting(setting: InsertAdminSetting): Promise<AdminSetting>;
  updateAdminSetting(key: string, value: string): Promise<AdminSetting>;

  // Subscription Plans
  getSubscriptionPlans(): Promise<SubscriptionPlan[]>;
  getSubscriptionPlan(id: string): Promise<SubscriptionPlan | undefined>;
  createSubscriptionPlan(plan: InsertSubscriptionPlan): Promise<SubscriptionPlan>;
  updateSubscriptionPlan(id: string, data: Partial<InsertSubscriptionPlan>): Promise<SubscriptionPlan>;
  deleteSubscriptionPlan(id: string): Promise<void>;

  // User Subscriptions
  getUserSubscription(userId: string): Promise<UserSubscription | undefined>;
  createUserSubscription(subscription: InsertUserSubscription): Promise<UserSubscription>;
  updateUserSubscription(id: string, data: Partial<InsertUserSubscription>): Promise<UserSubscription>;

  // Audit Logs
  getAuditLogs(limit?: number): Promise<AuditLog[]>;
  createAuditLog(log: InsertAuditLog): Promise<AuditLog>;

  // VAT Returns
  getVatReturnsByCompanyId(companyId: string): Promise<VatReturn[]>;
  getVatReturn(id: string): Promise<VatReturn | undefined>;
  createVatReturn(vatReturn: InsertVatReturn): Promise<VatReturn>;
  updateVatReturn(id: string, data: Partial<InsertVatReturn>): Promise<VatReturn>;
  deleteVatReturn(id: string): Promise<void>;

  // Corporate Tax Returns
  getCorporateTaxReturnsByCompanyId(companyId: string): Promise<CorporateTaxReturn[]>;
  getCorporateTaxReturn(id: string): Promise<CorporateTaxReturn | undefined>;
  createCorporateTaxReturn(data: InsertCorporateTaxReturn): Promise<CorporateTaxReturn>;
  updateCorporateTaxReturn(id: string, data: Partial<CorporateTaxReturn>): Promise<CorporateTaxReturn>;

  // Team Management
  updateCompanyUser(id: string, data: Partial<InsertCompanyUser>): Promise<CompanyUser>;
  deleteCompanyUser(id: string): Promise<void>;
  getCompanyUserWithUser(companyId: string): Promise<(CompanyUser & { user: User })[]>;

  // Admin Stats
  getAllUsers(): Promise<User[]>;
  getAllCompanies(): Promise<Company[]>;

  // Document Vault
  getDocuments(companyId: string): Promise<Document[]>;
  getDocument(id: string): Promise<Document | undefined>;
  createDocument(document: InsertDocument): Promise<Document>;
  updateDocument(id: string, data: Partial<InsertDocument>): Promise<Document>;
  deleteDocument(id: string): Promise<void>;

  // Tax Return Archive
  getTaxReturnArchive(companyId: string): Promise<TaxReturnArchive[]>;
  getTaxReturnArchiveItem(id: string): Promise<TaxReturnArchive | undefined>;
  createTaxReturnArchive(taxReturn: InsertTaxReturnArchive): Promise<TaxReturnArchive>;

  // Compliance Tasks
  getComplianceTasks(companyId: string): Promise<ComplianceTask[]>;
  getComplianceTask(id: string): Promise<ComplianceTask | undefined>;
  createComplianceTask(task: InsertComplianceTask): Promise<ComplianceTask>;
  updateComplianceTask(id: string, data: Partial<InsertComplianceTask>): Promise<ComplianceTask>;
  deleteComplianceTask(id: string): Promise<void>;

  // Messages
  getMessages(companyId: string): Promise<Message[]>;
  getMessage(id: string): Promise<Message | undefined>;
  createMessage(message: InsertMessage): Promise<Message>;
  markMessageAsRead(id: string): Promise<Message>;

  // News Items
  getNewsItems(): Promise<NewsItem[]>;
  createNewsItem(news: InsertNewsItem): Promise<NewsItem>;

  // Invitations (Admin)
  getInvitations(): Promise<Invitation[]>;
  getInvitationsByCompany(companyId: string): Promise<Invitation[]>;
  getInvitationByToken(token: string): Promise<Invitation | undefined>;
  getInvitationByEmail(email: string): Promise<Invitation | undefined>;
  createInvitation(invitation: InsertInvitation): Promise<Invitation>;
  updateInvitation(id: string, data: Partial<InsertInvitation>): Promise<Invitation>;
  deleteInvitation(id: string): Promise<void>;

  // Activity Logs (Admin)
  getActivityLogs(limit?: number): Promise<ActivityLog[]>;
  getActivityLogsByCompany(companyId: string, limit?: number): Promise<ActivityLog[]>;
  getActivityLogsByUser(userId: string, limit?: number): Promise<ActivityLog[]>;
  createActivityLog(log: InsertActivityLog): Promise<ActivityLog>;

  // Client Notes (Admin internal notes)
  getClientNotes(companyId: string): Promise<ClientNote[]>;
  createClientNote(note: InsertClientNote): Promise<ClientNote>;
  updateClientNote(id: string, data: Partial<InsertClientNote>): Promise<ClientNote>;
  deleteClientNote(id: string): Promise<void>;

  // Admin User Management
  updateUser(id: string, data: { name?: string; email?: string; isAdmin?: boolean }): Promise<User>;
  deleteUser(id: string): Promise<void>;

  // Admin Company Management
  deleteCompany(id: string): Promise<void>;

  // Client Engagements
  getEngagements(): Promise<Engagement[]>;
  getEngagementsByCompany(companyId: string): Promise<Engagement[]>;
  getEngagement(id: string): Promise<Engagement | undefined>;
  createEngagement(engagement: InsertEngagement): Promise<Engagement>;
  updateEngagement(id: string, data: Partial<InsertEngagement>): Promise<Engagement>;
  deleteEngagement(id: string): Promise<void>;

  // Service Invoices (NR billing to clients)
  getServiceInvoices(companyId?: string): Promise<ServiceInvoice[]>;
  getServiceInvoice(id: string): Promise<ServiceInvoice | undefined>;
  createServiceInvoice(invoice: InsertServiceInvoice): Promise<ServiceInvoice>;
  updateServiceInvoice(id: string, data: Partial<InsertServiceInvoice>): Promise<ServiceInvoice>;
  deleteServiceInvoice(id: string): Promise<void>;

  // Service Invoice Lines
  getServiceInvoiceLines(serviceInvoiceId: string): Promise<ServiceInvoiceLine[]>;
  createServiceInvoiceLine(line: InsertServiceInvoiceLine): Promise<ServiceInvoiceLine>;
  deleteServiceInvoiceLines(serviceInvoiceId: string): Promise<void>;

  // FTA Emails
  getFtaEmails(companyId: string): Promise<FtaEmail[]>;
  createFtaEmail(email: InsertFtaEmail): Promise<FtaEmail>;
  updateFtaEmail(id: string, data: Partial<InsertFtaEmail>): Promise<FtaEmail>;

  // Customer Subscriptions
  getSubscription(companyId: string): Promise<Subscription | undefined>;
  createSubscription(subscription: InsertSubscription): Promise<Subscription>;
  updateSubscription(id: string, data: Partial<InsertSubscription>): Promise<Subscription>;

  // User type management
  updateUserType(id: string, userType: string): Promise<User>;
  getUsersByType(userType: string): Promise<User[]>;
  getClientCompanies(): Promise<Company[]>;
  getCustomerCompanies(): Promise<Company[]>;

  // Backups
  getBackupsByCompanyId(companyId: string): Promise<Backup[]>;
  getBackup(id: string): Promise<Backup | undefined>;
  createBackup(backup: InsertBackup): Promise<Backup>;
  updateBackup(id: string, data: Partial<InsertBackup>): Promise<Backup>;
  deleteBackup(id: string): Promise<void>;
  
  // AI Conversations
  createAiConversation(conversation: InsertAiConversation): Promise<AiConversation>;
  getAiConversationsByUserId(userId: string, limit?: number): Promise<AiConversation[]>;
  getAiConversationsByCompanyId(companyId: string, limit?: number): Promise<AiConversation[]>;
  getAiConversation(id: string): Promise<AiConversation | undefined>;
  deleteAiConversation(id: string): Promise<void>;

  // Recurring Invoices
  getRecurringInvoicesByCompanyId(companyId: string): Promise<RecurringInvoice[]>;
  getRecurringInvoice(id: string): Promise<RecurringInvoice | undefined>;
  getDueRecurringInvoices(): Promise<RecurringInvoice[]>;
  // Lock-and-fetch a single due template inside an open tx using
  // SELECT ... FOR UPDATE SKIP LOCKED. Returns undefined if no due template
  // is available (or another runner already holds the lock). Caller must do
  // its work and commit the tx to release the lock. `excludeIds` lets the
  // scheduler advance past templates it has already visited this cron tick
  // (period-locked, errored, or already processed) so a single bad template
  // can't starve later due templates.
  fetchAndLockNextDueRecurringInvoice(
    tx: typeof db,
    excludeIds?: string[],
  ): Promise<RecurringInvoice | undefined>;
  createRecurringInvoice(data: InsertRecurringInvoice): Promise<RecurringInvoice>;
  updateRecurringInvoice(id: string, data: Partial<RecurringInvoice>): Promise<RecurringInvoice>;
  deleteRecurringInvoice(id: string): Promise<void>;

  // Invoice Payments
  getInvoicePaymentsByInvoiceId(invoiceId: string): Promise<InvoicePayment[]>;
  getInvoicePaymentsByCompanyId(companyId: string): Promise<InvoicePayment[]>;
  createInvoicePayment(data: InsertInvoicePayment): Promise<InvoicePayment>;
  getInvoicePaidTotal(invoiceId: string): Promise<number>;
  getDueInvoicesForRecurring(): Promise<Invoice[]>;
  /**
   * Atomically record an invoice payment + post the cash/AR journal entry +
   * recompute invoice status. All inside a single transaction with
   * SELECT FOR UPDATE on the invoice row, so concurrent payments cannot
   * over-pay or race on the status field.
   */
  recordInvoicePayment(input: {
    invoiceId: string;
    companyId: string;
    amount: number;
    date: Date;
    method: string;
    reference: string | null;
    notes: string | null;
    paymentAccountId: string;
    paymentAccountCurrency?: string | null;
    receivableAccountId: string;
    createdBy: string;
  }): Promise<{
    payment: InvoicePayment;
    invoice: Invoice;
    journalEntryId: string;
    totalPaid: number;
  }>;
  /**
   * Delete an invoice safely. Refuses if any associated journal entry is
   * posted (caller must void instead). Cascades draft journal entries.
   * Throws Error with .code === 'INVOICE_HAS_POSTED_JE' for the route
   * layer to translate to a 422.
   */
  safeDeleteInvoice(id: string): Promise<void>;
  /**
   * Get journal entries that originated from an invoice.
   */
  getJournalEntriesBySource(
    companyId: string,
    source: string,
    sourceId: string,
  ): Promise<JournalEntry[]>;

  // Products / Inventory
  getProductsByCompanyId(companyId: string): Promise<Product[]>;
  getProduct(id: string): Promise<Product | undefined>;
  createProduct(data: InsertProduct): Promise<Product>;
  updateProduct(id: string, data: Partial<Product>): Promise<Product>;
  deleteProduct(id: string): Promise<void>;

  // Inventory Movements
  getInventoryMovementsByProductId(productId: string): Promise<InventoryMovement[]>;
  getInventoryMovementsByCompanyId(companyId: string): Promise<InventoryMovement[]>;
  createInventoryMovement(data: InsertInventoryMovement): Promise<InventoryMovement>;

  // Payment Chasing (Phase 4)
  createPaymentChase(data: InsertPaymentChase): Promise<PaymentChase>;
  getPaymentChasesByCompanyId(companyId: string, opts?: { invoiceId?: string; sinceDays?: number }): Promise<PaymentChase[]>;
  getPaymentChasesByInvoiceId(invoiceId: string): Promise<PaymentChase[]>;
  /**
   * Atomically set chase_level/last_chased_at iff the invoice has not been
   * chased within the last `minSecondsBetween` seconds. Returns true when the
   * caller has won the slot (and may safely send), false otherwise. Prevents
   * duplicate chases from concurrent requests / double-clicks.
   */
  tryClaimChaseSlot(
    invoiceId: string,
    level: number,
    now: Date,
    minSecondsBetween: number,
  ): Promise<boolean>;
  setInvoiceDoNotChase(invoiceId: string, value: boolean): Promise<void>;

  getChaseTemplatesForCompany(companyId: string): Promise<ChaseTemplate[]>;
  getChaseTemplate(level: number, language: string, companyId: string | null): Promise<ChaseTemplate | undefined>;
  createChaseTemplate(data: InsertChaseTemplate): Promise<ChaseTemplate>;
  updateChaseTemplate(id: string, companyId: string, data: Partial<InsertChaseTemplate>): Promise<ChaseTemplate | undefined>;
  deleteChaseTemplate(id: string, companyId: string): Promise<boolean>;

  getChaseConfig(companyId: string): Promise<ChaseConfig | undefined>;
  upsertChaseConfig(companyId: string, data: Partial<InsertChaseConfig>): Promise<ChaseConfig>;
}

export class DatabaseStorage implements IStorage {
  // Users
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user || undefined;
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.email, email));
    return user || undefined;
  }

  async createUser(insertUser: InsertUser & { passwordHash?: string }): Promise<User> {
    const [user] = await db
      .insert(users)
      .values({
        ...insertUser,
        passwordHash: (insertUser as any).passwordHash || '',
      })
      .returning();
    return user;
  }

  async updateUserPassword(userId: string, passwordHash: string): Promise<void> {
    await db.update(users).set({ passwordHash }).where(eq(users.id, userId));
  }

  // Password reset tokens
  async createPasswordResetToken(input: { userId: string; tokenHash: string; expiresAt: Date }): Promise<void> {
    await db.insert(passwordResetTokens).values({
      userId: input.userId,
      tokenHash: input.tokenHash,
      expiresAt: input.expiresAt,
    });
  }

  async findValidPasswordResetToken(tokenHash: string): Promise<{ id: string; userId: string } | undefined> {
    const [row] = await db
      .select({ id: passwordResetTokens.id, userId: passwordResetTokens.userId })
      .from(passwordResetTokens)
      .where(
        and(
          eq(passwordResetTokens.tokenHash, tokenHash),
          isNull(passwordResetTokens.usedAt),
          gt(passwordResetTokens.expiresAt, new Date()),
        ),
      );
    return row || undefined;
  }

  async markPasswordResetTokenUsed(id: string): Promise<void> {
    await db
      .update(passwordResetTokens)
      .set({ usedAt: new Date() })
      .where(eq(passwordResetTokens.id, id));
  }

  async deletePasswordResetTokensForUser(userId: string): Promise<void> {
    await db.delete(passwordResetTokens).where(eq(passwordResetTokens.userId, userId));
  }

  // Companies
  async getCompany(id: string): Promise<Company | undefined> {
    const [company] = await db.select().from(companies).where(and(eq(companies.id, id), isNull(companies.deletedAt)));
    return company || undefined;
  }

  async getCompanyByName(name: string): Promise<Company | undefined> {
    const [company] = await db.select().from(companies).where(and(eq(companies.name, name), isNull(companies.deletedAt)));
    return company || undefined;
  }

  async getCompaniesByUserId(userId: string): Promise<Company[]> {
    const results = await db
      .select()
      .from(companies)
      .innerJoin(companyUsers, eq(companies.id, companyUsers.companyId))
      .where(and(eq(companyUsers.userId, userId), isNull(companies.deletedAt)));

    return results.map((r: any) => r.companies);
  }

  async createCompany(insertCompany: InsertCompany): Promise<Company> {
    const [company] = await db
      .insert(companies)
      .values(insertCompany)
      .returning();
    return company;
  }

  async updateCompany(id: string, data: Partial<InsertCompany>): Promise<Company> {
    const [company] = await db
      .update(companies)
      .set(data)
      .where(eq(companies.id, id))
      .returning();
    return company;
  }

  // Company Users
  async createCompanyUser(insertCompanyUser: InsertCompanyUser): Promise<CompanyUser> {
    const [companyUser] = await db
      .insert(companyUsers)
      .values(insertCompanyUser)
      .returning();
    return companyUser;
  }

  async getUserRole(companyId: string, userId: string): Promise<CompanyUser | undefined> {
    const [companyUser] = await db
      .select()
      .from(companyUsers)
      .where(
        and(
          eq(companyUsers.companyId, companyId),
          eq(companyUsers.userId, userId)
        )
      );
    return companyUser || undefined;
  }

  async hasCompanyAccess(
    userId: string,
    companyId: string,
    firmRole?: string | null,
  ): Promise<boolean> {
    // Direct company_users membership.
    if (await this.getUserRole(companyId, userId)) return true;

    // Look up firm role if caller didn't pass it. This makes all existing
    // call sites firm-aware without per-route changes.
    let role: string | null = firmRole ?? null;
    if (firmRole === undefined) {
      const [u] = await db
        .select({ firmRole: users.firmRole })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
      role = u?.firmRole ?? null;
    }

    if (role !== 'firm_owner' && role !== 'firm_admin') return false;

    const company = await this.getCompany(companyId);
    if (!company || company.companyType !== 'client') return false;

    if (role === 'firm_owner') return true;

    // firm_admin: must have an explicit assignment.
    const [assignment] = await db
      .select({ id: firmStaffAssignments.id })
      .from(firmStaffAssignments)
      .where(
        and(
          eq(firmStaffAssignments.userId, userId),
          eq(firmStaffAssignments.companyId, companyId),
        ),
      )
      .limit(1);
    return !!assignment;
  }

  async getAccessibleCompanies(
    userId: string,
    firmRole?: string | null,
  ): Promise<Company[]> {
    const direct = await this.getCompaniesByUserId(userId);

    if (firmRole !== 'firm_owner' && firmRole !== 'firm_admin') {
      return direct;
    }

    // Add firm-accessible client companies (not already in direct list).
    const directIds = new Set(direct.map(c => c.id));

    let firmCompanies: Company[];
    if (firmRole === 'firm_owner') {
      firmCompanies = await db
        .select()
        .from(companies)
        .where(
          and(eq(companies.companyType, 'client'), isNull(companies.deletedAt)),
        );
    } else {
      // firm_admin: only assigned companies.
      const assignedIds = await db
        .select({ companyId: firmStaffAssignments.companyId })
        .from(firmStaffAssignments)
        .where(eq(firmStaffAssignments.userId, userId));

      const ids = assignedIds.map((a: { companyId: string }) => a.companyId);
      if (ids.length === 0) {
        firmCompanies = [];
      } else {
        firmCompanies = await db
          .select()
          .from(companies)
          .where(
            and(
              inArray(companies.id, ids),
              eq(companies.companyType, 'client'),
              isNull(companies.deletedAt),
            ),
          );
      }
    }

    const merged = [...direct];
    for (const c of firmCompanies) {
      if (!directIds.has(c.id)) merged.push(c);
    }
    return merged;
  }

  async getCompanyUsersByCompanyId(companyId: string): Promise<CompanyUser[]> {
    return await db.select().from(companyUsers).where(eq(companyUsers.companyId, companyId));
  }

  // Accounts
  async getAccount(id: string, companyId: string): Promise<Account | undefined> {
    const [account] = await db
      .select()
      .from(accounts)
      .where(and(eq(accounts.id, id), eq(accounts.companyId, companyId)));
    return account || undefined;
  }

  async getAccountsByCompanyId(companyId: string): Promise<Account[]> {
    return await db.select().from(accounts).where(eq(accounts.companyId, companyId));
  }

  async createAccount(insertAccount: InsertAccount): Promise<Account> {
    const [account] = await db
      .insert(accounts)
      .values(insertAccount)
      .returning();
    return account;
  }

  async updateAccount(id: string, companyId: string, data: Partial<Account>): Promise<Account> {
    const [account] = await db
      .update(accounts)
      .set(data)
      .where(and(eq(accounts.id, id), eq(accounts.companyId, companyId)))
      .returning();
    if (!account) {
      throw new Error('Account not found');
    }
    return account;
  }

  async deleteAccount(id: string, companyId: string): Promise<void> {
    await db
      .delete(accounts)
      .where(and(eq(accounts.id, id), eq(accounts.companyId, companyId)));
  }

  async archiveAccount(id: string): Promise<Account> {
    const [account] = await db
      .update(accounts)
      .set({ isArchived: true, isActive: false, updatedAt: new Date() })
      .where(and(eq(accounts.id, id), eq(accounts.isSystemAccount, false)))
      .returning();
    if (!account) {
      throw new Error('Account not found or is a system account');
    }
    return account;
  }

  async getAccountByCode(companyId: string, code: string): Promise<Account | undefined> {
    const [account] = await db
      .select()
      .from(accounts)
      .where(and(eq(accounts.companyId, companyId), eq(accounts.code, code)));
    return account || undefined;
  }

  async getVatAccounts(companyId: string): Promise<Account[]> {
    return await db
      .select()
      .from(accounts)
      .where(and(eq(accounts.companyId, companyId), eq(accounts.isVatAccount, true)));
  }

  async createBulkAccounts(accountsData: InsertAccount[]): Promise<Account[]> {
    if (accountsData.length === 0) return [];
    
    const expectedCount = accountsData.length;
    const createdAccounts = await db.transaction(async (tx: any) => {
      const inserted = await tx
        .insert(accounts)
        .values(accountsData)
        .onConflictDoNothing()
        .returning();
      
      if (inserted.length < expectedCount) {
        throw new Error(`PARTIAL_INSERT: Only ${inserted.length}/${expectedCount} accounts were created. Some accounts already exist.`);
      }
      
      return inserted;
    });
    
    return createdAccounts;
  }

  async companyHasAccounts(companyId: string): Promise<boolean> {
    const existingAccounts = await db
      .select({ id: accounts.id })
      .from(accounts)
      .where(eq(accounts.companyId, companyId))
      .limit(1);
    return existingAccounts.length > 0;
  }

  async accountHasTransactions(accountId: string): Promise<boolean> {
    const lines = await db
      .select()
      .from(journalLines)
      .where(eq(journalLines.accountId, accountId))
      .limit(1);
    return lines.length > 0;
  }

  async getAccountsWithBalances(companyId: string, dateRange?: { start: Date; end: Date }) {
    const accountsList = await db.select().from(accounts).where(eq(accounts.companyId, companyId));
    
    const results = await Promise.all(accountsList.map(async (account: any) => {
      let lines = await db
        .select({
          debit: journalLines.debit,
          credit: journalLines.credit,
          date: journalEntries.date,
          status: journalEntries.status
        })
        .from(journalLines)
        .innerJoin(journalEntries, eq(journalLines.entryId, journalEntries.id))
        .where(eq(journalLines.accountId, account.id));
      
      if (dateRange) {
        lines = lines.filter((line: any) => {
          const lineDate = new Date(line.date);
          return lineDate >= dateRange.start && lineDate <= dateRange.end;
        });
      }
      
      const postedLines = lines.filter((l: any) => l.status === 'posted');

      const debitTotal = postedLines.reduce((sum: any, l: any) => sum + (l.debit || 0), 0);
      const creditTotal = postedLines.reduce((sum: any, l: any) => sum + (l.credit || 0), 0);
      
      let balance = 0;
      if (['asset', 'expense'].includes(account.type)) {
        balance = debitTotal - creditTotal;
      } else {
        balance = creditTotal - debitTotal;
      }
      
      return {
        account,
        balance,
        debitTotal,
        creditTotal
      };
    }));
    
    return results;
  }

  async getAccountLedger(accountId: string, options?: {
    dateStart?: Date;
    dateEnd?: Date;
    search?: string;
    limit?: number;
    offset?: number;
  }) {
    // Existence check; tenant scoping is the caller's responsibility (the
    // accounts.routes ledger handler resolves the account against the user's
    // companies before invoking this).
    const [account] = await db.select().from(accounts).where(eq(accounts.id, accountId));
    if (!account) {
      throw new Error('Account not found');
    }
    
    const allLines = await db
      .select({
        lineId: journalLines.id,
        debit: journalLines.debit,
        credit: journalLines.credit,
        lineDescription: journalLines.description,
        entryId: journalEntries.id,
        entryNumber: journalEntries.entryNumber,
        date: journalEntries.date,
        memo: journalEntries.memo,
        source: journalEntries.source,
        status: journalEntries.status
      })
      .from(journalLines)
      .innerJoin(journalEntries, eq(journalLines.entryId, journalEntries.id))
      .where(eq(journalLines.accountId, accountId));
    
    const postedLines = allLines.filter((l: any) => l.status === 'posted');
    postedLines.sort((a: any, b: any) => new Date(a.date).getTime() - new Date(b.date).getTime());

    let openingBalance = 0;
    if (options?.dateStart) {
      const priorLines = postedLines.filter((l: any) => new Date(l.date) < options.dateStart!);
      const priorDebit = priorLines.reduce((sum: any, l: any) => sum + (l.debit || 0), 0);
      const priorCredit = priorLines.reduce((sum: any, l: any) => sum + (l.credit || 0), 0);
      
      if (['asset', 'expense'].includes(account.type)) {
        openingBalance = priorDebit - priorCredit;
      } else {
        openingBalance = priorCredit - priorDebit;
      }
    }
    
    let filteredLines = postedLines;
    if (options?.dateStart) {
      filteredLines = filteredLines.filter((l: any) => new Date(l.date) >= options.dateStart!);
    }
    if (options?.dateEnd) {
      filteredLines = filteredLines.filter((l: any) => new Date(l.date) <= options.dateEnd!);
    }

    if (options?.search) {
      const searchLower = options.search.toLowerCase();
      filteredLines = filteredLines.filter((l: any) =>
        l.entryNumber?.toLowerCase().includes(searchLower) ||
        l.memo?.toLowerCase().includes(searchLower) ||
        l.lineDescription?.toLowerCase().includes(searchLower)
      );
    }
    
    let runningBalance = openingBalance;
    let totalDebit = 0;
    let totalCredit = 0;
    
    const allEntries = filteredLines.map((line: any) => {
      const debit = line.debit || 0;
      const credit = line.credit || 0;
      
      totalDebit += debit;
      totalCredit += credit;
      
      if (['asset', 'expense'].includes(account.type)) {
        runningBalance += debit - credit;
      } else {
        runningBalance += credit - debit;
      }
      
      return {
        id: line.lineId,
        date: line.date,
        entryNumber: line.entryNumber,
        description: line.lineDescription || line.memo || '',
        debit,
        credit,
        runningBalance,
        journalEntryId: line.entryId,
        journalLineId: line.lineId,
        memo: line.memo,
        source: line.source,
        status: line.status
      };
    });
    
    const totalCount = allEntries.length;
    const paginatedEntries = options?.limit 
      ? allEntries.slice(options.offset || 0, (options.offset || 0) + options.limit)
      : allEntries;
    
    const closingBalance = openingBalance + ((['asset', 'expense'].includes(account.type)) 
      ? totalDebit - totalCredit 
      : totalCredit - totalDebit);
    
    return {
      entries: paginatedEntries,
      allEntries,
      account,
      openingBalance,
      totalDebit,
      totalCredit,
      closingBalance,
      totalCount
    };
  }

  // Journal Entries
  async getJournalEntry(id: string, companyId: string): Promise<JournalEntry | undefined> {
    const [entry] = await db
      .select()
      .from(journalEntries)
      .where(and(eq(journalEntries.id, id), eq(journalEntries.companyId, companyId)));
    return entry || undefined;
  }

  async getJournalEntriesByCompanyId(companyId: string): Promise<JournalEntry[]> {
    return await db
      .select()
      .from(journalEntries)
      .where(eq(journalEntries.companyId, companyId))
      .orderBy(desc(journalEntries.date));
  }

  async getPostedJournalEntriesWithLines(
    companyId: string,
  ): Promise<Array<{ entry: JournalEntry; lines: JournalLine[] }>> {
    // Single JOIN replaces an N+1 (one query per entry to fetch lines).
    const rows = await db
      .select({
        entry: journalEntries,
        line: journalLines,
      })
      .from(journalEntries)
      .leftJoin(journalLines, eq(journalLines.entryId, journalEntries.id))
      .where(and(
        eq(journalEntries.companyId, companyId),
        eq(journalEntries.status, 'posted'),
      ));

    const byId = new Map<string, { entry: JournalEntry; lines: JournalLine[] }>();
    for (const row of rows) {
      const entryId = row.entry.id;
      let bucket = byId.get(entryId);
      if (!bucket) {
        bucket = { entry: row.entry, lines: [] };
        byId.set(entryId, bucket);
      }
      if (row.line) bucket.lines.push(row.line);
    }
    return Array.from(byId.values());
  }

  async createJournalEntry(
    insertEntry: InsertJournalEntry & { postedAt?: Date | null; updatedAt?: Date | null },
    lines: Array<Omit<InsertJournalLine, 'entryId'>>
  ): Promise<JournalEntry> {
    if (!Array.isArray(lines) || lines.length === 0) {
      throw new Error('Journal entry must have at least one line');
    }
    assertBalanced(lines);

    return await db.transaction(async (tx: typeof db) => {
      const [entry] = await tx.insert(journalEntries).values(insertEntry).returning();
      for (const line of lines) {
        await tx.insert(journalLines).values({ ...line, entryId: entry.id });
      }
      return entry;
    });
  }

  async updateJournalEntry(id: string, companyId: string, data: Partial<JournalEntry>): Promise<JournalEntry> {
    const [entry] = await db
      .update(journalEntries)
      .set(data)
      .where(and(eq(journalEntries.id, id), eq(journalEntries.companyId, companyId)))
      .returning();
    if (!entry) {
      throw new Error('Journal entry not found');
    }
    return entry;
  }

  async updateJournalEntryWithLines(
    id: string,
    companyId: string,
    data: Partial<JournalEntry>,
    lines: Array<Omit<InsertJournalLine, 'entryId'>>
  ): Promise<JournalEntry> {
    if (!Array.isArray(lines) || lines.length === 0) {
      throw new Error('Journal entry must have at least one line');
    }
    assertBalanced(lines);

    return await db.transaction(async (tx: typeof db) => {
      const [entry] = await tx
        .update(journalEntries)
        .set(data)
        .where(and(eq(journalEntries.id, id), eq(journalEntries.companyId, companyId)))
        .returning();
      if (!entry) {
        throw new Error('Journal entry not found');
      }
      await tx.delete(journalLines).where(eq(journalLines.entryId, id));
      for (const line of lines) {
        await tx.insert(journalLines).values({ ...line, entryId: id });
      }
      return entry;
    });
  }

  async deleteJournalEntry(id: string, companyId: string): Promise<void> {
    await db
      .delete(journalEntries)
      .where(and(eq(journalEntries.id, id), eq(journalEntries.companyId, companyId)));
  }

  async generateEntryNumber(companyId: string, date: Date): Promise<string> {
    const dateStr = date.toISOString().slice(0, 10).replace(/-/g, '');
    const prefix = `JE-${dateStr}`;
    const likePattern = prefix + '-%';
    // Trim 'JE-' (3) + 'YYYYMMDD' (8) + '-' (1) → 12, so the counter starts at
    // SUBSTRING position 13 (1-based) per Postgres semantics.
    const counterStart = prefix.length + 2;

    // Atomic next-number generation. Two-pronged defence:
    // 1) Per-(company, date) advisory lock serialises concurrent generators in
    //    the same Postgres session pool, so they don't both compute MAX+1.
    // 2) The unique constraint (company_id, entry_number) is the final safety
    //    net. If we still collide (different DB instances / restored backups /
    //    bug), the insert will fail and the caller can retry.
    //
    // The advisory lock is session-scoped here (not _xact_) because the caller
    // typically generates the number, then runs createJournalEntry which opens
    // its own transaction. We release at function exit.
    const lockKey1 = hashStringToInt(companyId);
    const lockKey2 = hashStringToInt(prefix);
    await db.execute(sql`SELECT pg_advisory_lock(${lockKey1}, ${lockKey2})`);
    try {
      const result: any = await db.execute(sql`
        SELECT COALESCE(
          MAX(CAST(SUBSTRING(entry_number FROM ${counterStart}) AS INTEGER)),
          0
        ) AS max_seq
        FROM journal_entries
        WHERE company_id = ${companyId}
          AND entry_number LIKE ${likePattern}
      `);
      const rows = (result.rows ?? result) as Array<{ max_seq: number | string | null }>;
      const maxSeq = Number(rows[0]?.max_seq ?? 0);
      const nextNumber = maxSeq + 1;
      return `${prefix}-${String(nextNumber).padStart(3, '0')}`;
    } finally {
      await db.execute(sql`SELECT pg_advisory_unlock(${lockKey1}, ${lockKey2})`).catch(() => {});
    }
  }

  // Journal Lines
  async createJournalLine(insertLine: InsertJournalLine): Promise<JournalLine> {
    const [line] = await db
      .insert(journalLines)
      .values(insertLine)
      .returning();
    return line;
  }

  async getJournalLinesByEntryId(entryId: string): Promise<JournalLine[]> {
    return await db.select().from(journalLines).where(eq(journalLines.entryId, entryId));
  }

  async getJournalLinesByEntryIds(entryIds: string[]): Promise<JournalLine[]> {
    if (entryIds.length === 0) return [];
    return await db.select().from(journalLines).where(inArray(journalLines.entryId, entryIds));
  }

  async deleteJournalLinesByEntryId(entryId: string): Promise<void> {
    await db.delete(journalLines).where(eq(journalLines.entryId, entryId));
  }

  // Invoices
  async getInvoice(id: string, companyId: string): Promise<Invoice | undefined> {
    const [invoice] = await db
      .select()
      .from(invoices)
      .where(and(eq(invoices.id, id), eq(invoices.companyId, companyId)));
    return invoice || undefined;
  }

  async getInvoicesByCompanyId(companyId: string): Promise<Invoice[]> {
    return await db
      .select()
      .from(invoices)
      .where(eq(invoices.companyId, companyId))
      .orderBy(desc(invoices.date));
  }

  // Trimmed projection used by list endpoints — strips einvoiceXml (full UBL
  // doc) and einvoiceHash, which can each be 10-50KB per invoice and bloat
  // the JSON payload by 100x for a tenant with hundreds of submitted invoices.
  async getInvoicesSummaryByCompanyId(
    companyId: string,
    opts: { limit?: number; offset?: number } = {},
  ): Promise<Omit<Invoice, 'einvoiceXml' | 'einvoiceHash'>[]> {
    const limit = opts.limit ?? DEFAULT_LIST_LIMIT;
    const offset = opts.offset ?? 0;
    return await db
      .select({
        id: invoices.id,
        companyId: invoices.companyId,
        number: invoices.number,
        customerName: invoices.customerName,
        customerTrn: invoices.customerTrn,
        date: invoices.date,
        dueDate: invoices.dueDate,
        paymentTerms: invoices.paymentTerms,
        currency: invoices.currency,
        exchangeRate: invoices.exchangeRate,
        baseCurrencyAmount: invoices.baseCurrencyAmount,
        subtotal: invoices.subtotal,
        vatAmount: invoices.vatAmount,
        total: invoices.total,
        status: invoices.status,
        shareToken: invoices.shareToken,
        shareTokenExpiresAt: invoices.shareTokenExpiresAt,
        einvoiceUuid: invoices.einvoiceUuid,
        einvoiceStatus: invoices.einvoiceStatus,
        reminderCount: invoices.reminderCount,
        lastReminderSentAt: invoices.lastReminderSentAt,
        invoiceType: invoices.invoiceType,
        originalInvoiceId: invoices.originalInvoiceId,
        isRecurring: invoices.isRecurring,
        recurringInterval: invoices.recurringInterval,
        nextRecurringDate: invoices.nextRecurringDate,
        recurringEndDate: invoices.recurringEndDate,
        contactId: invoices.contactId,
        createdAt: invoices.createdAt,
      })
      .from(invoices)
      .where(eq(invoices.companyId, companyId))
      .orderBy(desc(invoices.date))
      .limit(limit)
      .offset(offset);
  }

  async createInvoice(insertInvoice: InsertInvoice): Promise<Invoice> {
    const [invoice] = await db
      .insert(invoices)
      .values(insertInvoice)
      .returning();
    return invoice;
  }

  async updateInvoice(id: string, companyId: string, data: Partial<InsertInvoice>): Promise<Invoice> {
    const [invoice] = await db
      .update(invoices)
      .set(data)
      .where(and(eq(invoices.id, id), eq(invoices.companyId, companyId)))
      .returning();
    if (!invoice) {
      throw new Error('Invoice not found');
    }
    return invoice;
  }

  async updateInvoiceStatus(id: string, companyId: string, status: string): Promise<Invoice> {
    const [invoice] = await db
      .update(invoices)
      .set({ status })
      .where(and(eq(invoices.id, id), eq(invoices.companyId, companyId)))
      .returning();

    if (!invoice) {
      throw new Error('Invoice not found');
    }

    return invoice;
  }

  async deleteInvoice(id: string, companyId: string): Promise<void> {
    await db
      .delete(invoices)
      .where(and(eq(invoices.id, id), eq(invoices.companyId, companyId)));
  }

  async getInvoiceByShareToken(token: string): Promise<Invoice | undefined> {
    const [invoice] = await db.select().from(invoices).where(eq(invoices.shareToken, token));
    return invoice || undefined;
  }

  async setInvoiceShareToken(id: string, token: string, expiresAt: Date): Promise<void> {
    await db
      .update(invoices)
      .set({ shareToken: token, shareTokenExpiresAt: expiresAt })
      .where(eq(invoices.id, id));
  }

  // Invoice Lines
  async createInvoiceLine(insertLine: InsertInvoiceLine): Promise<InvoiceLine> {
    const [line] = await db
      .insert(invoiceLines)
      .values(insertLine)
      .returning();
    return line;
  }

  async getInvoiceLinesByInvoiceId(invoiceId: string): Promise<InvoiceLine[]> {
    return await db.select().from(invoiceLines).where(eq(invoiceLines.invoiceId, invoiceId));
  }

  async getInvoiceLinesByInvoiceIds(invoiceIds: string[]): Promise<InvoiceLine[]> {
    if (invoiceIds.length === 0) return [];
    return await db.select().from(invoiceLines).where(inArray(invoiceLines.invoiceId, invoiceIds));
  }

  async deleteInvoiceLinesByInvoiceId(invoiceId: string): Promise<void> {
    await db.delete(invoiceLines).where(eq(invoiceLines.invoiceId, invoiceId));
  }

  // Receipts
  async getReceipt(id: string, companyId: string): Promise<Receipt | undefined> {
    const [receipt] = await db
      .select()
      .from(receipts)
      .where(and(eq(receipts.id, id), eq(receipts.companyId, companyId)));
    return receipt || undefined;
  }

  async createReceipt(insertReceipt: InsertReceipt): Promise<Receipt> {
    const [receipt] = await db
      .insert(receipts)
      .values(insertReceipt)
      .returning();
    return receipt;
  }

  async getReceiptsByCompanyId(companyId: string): Promise<Receipt[]> {
    return await db
      .select()
      .from(receipts)
      .where(eq(receipts.companyId, companyId))
      .orderBy(desc(receipts.createdAt));
  }

  async updateReceipt(id: string, companyId: string, data: Partial<InsertReceipt>): Promise<Receipt> {
    const [receipt] = await db
      .update(receipts)
      .set(data)
      .where(and(eq(receipts.id, id), eq(receipts.companyId, companyId)))
      .returning();
    if (!receipt) {
      throw new Error('Receipt not found');
    }
    return receipt;
  }

  async deleteReceipt(id: string, companyId: string): Promise<void> {
    await db
      .delete(receipts)
      .where(and(eq(receipts.id, id), eq(receipts.companyId, companyId)));
  }

  // Customer Contacts
  async getCustomerContact(id: string): Promise<CustomerContact | undefined> {
    const [contact] = await db.select().from(customerContacts).where(eq(customerContacts.id, id));
    return contact;
  }

  async getCustomerContactsByCompanyId(companyId: string): Promise<CustomerContact[]> {
    return await db.select().from(customerContacts)
      .where(and(eq(customerContacts.companyId, companyId), eq(customerContacts.isActive, true)))
      .orderBy(desc(customerContacts.createdAt));
  }

  async getCustomerContactByEmail(companyId: string, email: string): Promise<CustomerContact | undefined> {
    const [contact] = await db.select().from(customerContacts)
      .where(and(eq(customerContacts.companyId, companyId), eq(customerContacts.email, email)));
    return contact;
  }

  async getCustomerContactByTrn(companyId: string, trn: string): Promise<CustomerContact | undefined> {
    const [contact] = await db.select().from(customerContacts)
      .where(and(eq(customerContacts.companyId, companyId), eq(customerContacts.trnNumber, trn)));
    return contact;
  }

  async createCustomerContact(insertContact: InsertCustomerContact): Promise<CustomerContact> {
    const [contact] = await db.insert(customerContacts).values(insertContact).returning();
    return contact;
  }

  async createBulkCustomerContacts(contactsData: InsertCustomerContact[]): Promise<CustomerContact[]> {
    if (contactsData.length === 0) return [];
    const created = await db.insert(customerContacts).values(contactsData).returning();
    return created;
  }

  async updateCustomerContact(id: string, data: Partial<InsertCustomerContact>): Promise<CustomerContact> {
    const [contact] = await db.update(customerContacts)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(customerContacts.id, id))
      .returning();
    if (!contact) throw new Error('Customer contact not found');
    return contact;
  }

  async deleteCustomerContact(id: string): Promise<void> {
    await db.delete(customerContacts).where(eq(customerContacts.id, id));
  }

  async deleteAllCustomerContactsByCompanyId(companyId: string): Promise<number> {
    const deleted = await db
      .delete(customerContacts)
      .where(eq(customerContacts.companyId, companyId))
      .returning({ id: customerContacts.id });
    return deleted.length;
  }

  async countCustomerContactsByCompanyId(companyId: string): Promise<number> {
    const [row] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(customerContacts)
      .where(eq(customerContacts.companyId, companyId));
    return row?.count ?? 0;
  }

  async countInvoicesWithContactByCompanyId(companyId: string): Promise<number> {
    const [row] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(invoices)
      .where(and(eq(invoices.companyId, companyId), isNotNull(invoices.contactId)));
    return row?.count ?? 0;
  }

  async getCustomerContactByPortalToken(token: string): Promise<CustomerContact | undefined> {
    const [contact] = await db.select().from(customerContacts)
      .where(eq(customerContacts.portalAccessToken, token));
    return contact || undefined;
  }

  async setPortalAccessToken(contactId: string, token: string, expiresAt: Date): Promise<CustomerContact> {
    const [contact] = await db.update(customerContacts)
      .set({ portalAccessToken: token, portalAccessExpiresAt: expiresAt, updatedAt: new Date() })
      .where(eq(customerContacts.id, contactId))
      .returning();
    if (!contact) throw new Error('Customer contact not found');
    return contact;
  }

  // Waitlist
  async createWaitlistEntry(insertEntry: InsertWaitlist): Promise<Waitlist> {
    const [entry] = await db
      .insert(waitlist)
      .values(insertEntry)
      .returning();
    return entry;
  }

  async getWaitlistByEmail(email: string): Promise<Waitlist | undefined> {
    const [entry] = await db.select().from(waitlist).where(eq(waitlist.email, email));
    return entry || undefined;
  }

  // Integration Syncs
  async createIntegrationSync(insertSync: InsertIntegrationSync): Promise<IntegrationSync> {
    const [sync] = await db
      .insert(integrationSyncs)
      .values(insertSync)
      .returning();
    return sync;
  }

  async getIntegrationSyncsByCompanyId(companyId: string): Promise<IntegrationSync[]> {
    return await db
      .select()
      .from(integrationSyncs)
      .where(eq(integrationSyncs.companyId, companyId))
      .orderBy(desc(integrationSyncs.syncedAt));
  }

  async getIntegrationSyncsByType(companyId: string, integrationType: string): Promise<IntegrationSync[]> {
    return await db
      .select()
      .from(integrationSyncs)
      .where(and(
        eq(integrationSyncs.companyId, companyId),
        eq(integrationSyncs.integrationType, integrationType)
      ))
      .orderBy(desc(integrationSyncs.syncedAt));
  }

  // WhatsApp Configuration
  async getWhatsappConfig(companyId: string): Promise<WhatsappConfig | undefined> {
    const [config] = await db
      .select()
      .from(whatsappConfigs)
      .where(eq(whatsappConfigs.companyId, companyId));
    return config || undefined;
  }

  async getWhatsappConfigByPhoneNumberId(phoneNumberId: string): Promise<WhatsappConfig | undefined> {
    const [config] = await db
      .select()
      .from(whatsappConfigs)
      .where(eq(whatsappConfigs.phoneNumberId, phoneNumberId));
    return config || undefined;
  }

  async createWhatsappConfig(insertConfig: InsertWhatsappConfig): Promise<WhatsappConfig> {
    const [config] = await db
      .insert(whatsappConfigs)
      .values(insertConfig)
      .returning();
    return config;
  }

  async updateWhatsappConfig(id: string, data: Partial<InsertWhatsappConfig>): Promise<WhatsappConfig> {
    const [config] = await db
      .update(whatsappConfigs)
      .set(data)
      .where(eq(whatsappConfigs.id, id))
      .returning();
    if (!config) {
      throw new Error('WhatsApp configuration not found');
    }
    return config;
  }

  // WhatsApp Messages
  async createWhatsappMessage(insertMessage: InsertWhatsappMessage): Promise<WhatsappMessage> {
    const [message] = await db
      .insert(whatsappMessages)
      .values(insertMessage)
      .returning();
    return message;
  }

  async getWhatsappMessagesByCompanyId(companyId: string): Promise<WhatsappMessage[]> {
    return await db
      .select()
      .from(whatsappMessages)
      .where(eq(whatsappMessages.companyId, companyId))
      .orderBy(desc(whatsappMessages.createdAt));
  }

  async getWhatsappMessage(id: string): Promise<WhatsappMessage | undefined> {
    const [message] = await db
      .select()
      .from(whatsappMessages)
      .where(eq(whatsappMessages.id, id));
    return message || undefined;
  }

  async updateWhatsappMessage(id: string, data: Partial<InsertWhatsappMessage>): Promise<WhatsappMessage> {
    const [message] = await db
      .update(whatsappMessages)
      .set(data)
      .where(eq(whatsappMessages.id, id))
      .returning();
    if (!message) {
      throw new Error('WhatsApp message not found');
    }
    return message;
  }

  // AI Anomaly Alerts
  async createAnomalyAlert(insertAlert: InsertAnomalyAlert): Promise<AnomalyAlert> {
    const [alert] = await db
      .insert(anomalyAlerts)
      .values(insertAlert)
      .returning();
    return alert;
  }

  async getAnomalyAlertById(id: string): Promise<AnomalyAlert | undefined> {
    const [alert] = await db
      .select()
      .from(anomalyAlerts)
      .where(eq(anomalyAlerts.id, id));
    return alert;
  }

  async getAnomalyAlertsByCompanyId(companyId: string): Promise<AnomalyAlert[]> {
    return await db
      .select()
      .from(anomalyAlerts)
      .where(eq(anomalyAlerts.companyId, companyId))
      .orderBy(desc(anomalyAlerts.createdAt));
  }

  async getUnresolvedAnomalyAlerts(companyId: string): Promise<AnomalyAlert[]> {
    return await db
      .select()
      .from(anomalyAlerts)
      .where(and(
        eq(anomalyAlerts.companyId, companyId),
        eq(anomalyAlerts.isResolved, false)
      ))
      .orderBy(desc(anomalyAlerts.createdAt));
  }

  async updateAnomalyAlert(id: string, data: Partial<InsertAnomalyAlert>): Promise<AnomalyAlert> {
    const [alert] = await db
      .update(anomalyAlerts)
      .set(data)
      .where(eq(anomalyAlerts.id, id))
      .returning();
    if (!alert) {
      throw new Error('Anomaly alert not found');
    }
    return alert;
  }

  async resolveAnomalyAlert(id: string, userId: string, note?: string): Promise<AnomalyAlert> {
    const [alert] = await db
      .update(anomalyAlerts)
      .set({
        isResolved: true,
        resolvedBy: userId,
        resolvedAt: new Date(),
        resolutionNote: note,
      })
      .where(eq(anomalyAlerts.id, id))
      .returning();
    if (!alert) {
      throw new Error('Anomaly alert not found');
    }
    return alert;
  }

  // Bank Accounts
  async createBankAccount(account: InsertBankAccount): Promise<BankAccount> {
    const [result] = await db.insert(bankAccounts).values(account).returning();
    return result;
  }

  async getBankAccountsByCompanyId(companyId: string): Promise<BankAccount[]> {
    return await db
      .select()
      .from(bankAccounts)
      .where(eq(bankAccounts.companyId, companyId))
      .orderBy(bankAccounts.nameEn);
  }

  async getBankAccountById(id: string): Promise<BankAccount | undefined> {
    const [result] = await db.select().from(bankAccounts).where(eq(bankAccounts.id, id));
    return result;
  }

  async updateBankAccount(id: string, data: Partial<InsertBankAccount>): Promise<BankAccount> {
    const [result] = await db
      .update(bankAccounts)
      .set(data)
      .where(eq(bankAccounts.id, id))
      .returning();
    if (!result) throw new Error('Bank account not found');
    return result;
  }

  // Bank Transactions
  async createBankTransaction(insertTransaction: InsertBankTransaction): Promise<BankTransaction> {
    const [transaction] = await db
      .insert(bankTransactions)
      .values(insertTransaction)
      .returning();
    return transaction;
  }

  async bulkCreateBankTransactions(transactions: InsertBankTransaction[]): Promise<BankTransaction[]> {
    if (transactions.length === 0) return [];
    return await db.insert(bankTransactions).values(transactions).returning();
  }

  async getBankTransactionById(id: string, companyId: string): Promise<BankTransaction | undefined> {
    const [transaction] = await db
      .select()
      .from(bankTransactions)
      .where(and(eq(bankTransactions.id, id), eq(bankTransactions.companyId, companyId)));
    return transaction;
  }

  async getBankTransactionsByCompanyId(companyId: string): Promise<BankTransaction[]> {
    return await db
      .select()
      .from(bankTransactions)
      .where(eq(bankTransactions.companyId, companyId))
      .orderBy(desc(bankTransactions.transactionDate));
  }

  async getUnreconciledBankTransactions(companyId: string): Promise<BankTransaction[]> {
    return await db
      .select()
      .from(bankTransactions)
      .where(and(
        eq(bankTransactions.companyId, companyId),
        eq(bankTransactions.isReconciled, false)
      ))
      .orderBy(desc(bankTransactions.transactionDate));
  }

  async updateBankTransaction(id: string, companyId: string, data: Partial<InsertBankTransaction>): Promise<BankTransaction> {
    const [transaction] = await db
      .update(bankTransactions)
      .set(data)
      .where(and(eq(bankTransactions.id, id), eq(bankTransactions.companyId, companyId)))
      .returning();
    if (!transaction) {
      throw new Error('Bank transaction not found');
    }
    return transaction;
  }

  async reconcileBankTransaction(
    id: string,
    companyId: string,
    matchedId: string,
    matchType: 'journal' | 'receipt' | 'invoice',
    createdBy?: string,
  ): Promise<BankTransaction> {
    // Load the bank txn so we have amount/date/bankAccountId for JE posting.
    const existing = await this.getBankTransactionById(id, companyId);
    if (!existing) {
      throw new Error('Bank transaction not found');
    }

    const updateData: any = {
      isReconciled: true,
    };
    if (matchType === 'journal') {
      updateData.matchedJournalEntryId = matchedId;
    } else if (matchType === 'receipt') {
      updateData.matchedReceiptId = matchedId;
    } else {
      updateData.matchedInvoiceId = matchedId;
    }

    // Reconciliation must produce a journal entry: previously this method only
    // flipped flags on the bank transaction, leaving the books out of step
    // with the bank statement. For 'journal' matches the contra entry already
    // exists, so we just link to it. For 'invoice' / 'receipt' matches we
    // either link an existing source-derived JE (e.g. one posted by
    // recordInvoicePayment / receipt posting) or create a fresh
    // bank-reconciliation JE here.
    if (
      createdBy &&
      matchType !== 'journal' &&
      !existing.matchedJournalEntryId &&
      existing.bankAccountId
    ) {
      const sourceTag = matchType === 'invoice' ? 'payment' : 'receipt';
      const sourceEntries = await this.getJournalEntriesBySource(
        existing.companyId,
        sourceTag,
        matchedId,
      );
      const linkedExisting = sourceEntries[0];

      if (linkedExisting) {
        updateData.matchedJournalEntryId = linkedExisting.id;
      } else {
        const accounts = await this.getAccountsByCompanyId(existing.companyId);
        const arAccount = accounts.find(
          (a) => a.code === ACCOUNT_CODES.AR && a.isSystemAccount,
        );
        const apAccount = accounts.find(
          (a) => a.code === ACCOUNT_CODES.AP && a.isSystemAccount,
        );
        const isInflow = Number(existing.amount) > 0;
        // Inflow: customer paid → Dr Bank, Cr A/R (link to invoice).
        // Outflow: paid vendor / expense → Dr A/P, Cr Bank (link to receipt).
        const contraAccount = isInflow ? arAccount : apAccount;

        if (contraAccount) {
          const absAmount = Math.abs(Number(existing.amount));
          const txnDate = existing.transactionDate instanceof Date
            ? existing.transactionDate
            : new Date(existing.transactionDate);
          const entryNumber = await this.generateEntryNumber(existing.companyId, txnDate);

          const newEntry = await this.createJournalEntry(
            {
              companyId: existing.companyId,
              entryNumber,
              date: txnDate,
              memo: `Bank reconciliation: ${existing.description}`.slice(0, 500),
              status: 'posted',
              source: 'bank_reconciliation',
              sourceId: existing.id,
              createdBy,
              postedBy: createdBy,
              postedAt: new Date(),
            },
            [
              {
                accountId: existing.bankAccountId,
                debit: isInflow ? absAmount : 0,
                credit: isInflow ? 0 : absAmount,
                description: existing.description,
              },
              {
                accountId: contraAccount.id,
                debit: isInflow ? 0 : absAmount,
                credit: isInflow ? absAmount : 0,
                description: existing.description,
              },
            ],
          );
          updateData.matchedJournalEntryId = newEntry.id;
        }
      }
    }

    const [transaction] = await db
      .update(bankTransactions)
      .set(updateData)
      .where(eq(bankTransactions.id, id))
      .returning();
    if (!transaction) {
      throw new Error('Bank transaction not found');
    }
    return transaction;
  }

  // Cash Flow Forecasts
  async createCashFlowForecast(insertForecast: InsertCashFlowForecast): Promise<CashFlowForecast> {
    const [forecast] = await db
      .insert(cashFlowForecasts)
      .values(insertForecast)
      .returning();
    return forecast;
  }

  async getCashFlowForecastsByCompanyId(companyId: string): Promise<CashFlowForecast[]> {
    return await db
      .select()
      .from(cashFlowForecasts)
      .where(eq(cashFlowForecasts.companyId, companyId))
      .orderBy(cashFlowForecasts.forecastDate);
  }

  async deleteCashFlowForecastsByCompanyId(companyId: string): Promise<void> {
    await db.delete(cashFlowForecasts).where(eq(cashFlowForecasts.companyId, companyId));
  }

  // Transaction Classifications
  async createTransactionClassification(insertClassification: InsertTransactionClassification): Promise<TransactionClassification> {
    const [classification] = await db
      .insert(transactionClassifications)
      .values(insertClassification)
      .returning();
    return classification;
  }

  async getTransactionClassification(id: string): Promise<TransactionClassification | undefined> {
    const [classification] = await db
      .select()
      .from(transactionClassifications)
      .where(eq(transactionClassifications.id, id))
      .limit(1);
    return classification || undefined;
  }

  async getTransactionClassificationsByCompanyId(companyId: string): Promise<TransactionClassification[]> {
    return await db
      .select()
      .from(transactionClassifications)
      .where(eq(transactionClassifications.companyId, companyId))
      .orderBy(desc(transactionClassifications.createdAt));
  }

  async updateTransactionClassification(id: string, companyId: string, data: Partial<InsertTransactionClassification>): Promise<TransactionClassification> {
    // Scoping by company_id is defense-in-depth: the route layer already
    // verifies tenant access, but a regression there must not silently mutate
    // another tenant's row. The UPDATE returns no rows when the id/company
    // pair doesn't match, which we surface as a not-found error.
    const [classification] = await db
      .update(transactionClassifications)
      .set(data)
      .where(and(
        eq(transactionClassifications.id, id),
        eq(transactionClassifications.companyId, companyId),
      ))
      .returning();
    if (!classification) {
      throw new Error('Transaction classification not found');
    }
    return classification;
  }

  // Journal Lines (for analytics)
  async getJournalLinesByCompanyId(companyId: string): Promise<JournalLine[]> {
    return await db
      .select({
        id: journalLines.id,
        entryId: journalLines.entryId,
        accountId: journalLines.accountId,
        debit: journalLines.debit,
        credit: journalLines.credit,
      })
      .from(journalLines)
      .innerJoin(journalEntries, eq(journalLines.entryId, journalEntries.id))
      .where(eq(journalEntries.companyId, companyId));
  }

  // Budgets
  async getBudgetsByCompanyId(companyId: string, year: number, month: number): Promise<Budget[]> {
    return await db
      .select()
      .from(budgets)
      .where(and(
        eq(budgets.companyId, companyId),
        eq(budgets.year, year),
        eq(budgets.month, month)
      ));
  }

  async createBudget(insertBudget: InsertBudget): Promise<Budget> {
    const [budget] = await db
      .insert(budgets)
      .values(insertBudget)
      .returning();
    return budget;
  }

  async updateBudget(id: string, companyId: string, data: Partial<InsertBudget>): Promise<Budget> {
    const [budget] = await db
      .update(budgets)
      .set(data)
      .where(and(eq(budgets.id, id), eq(budgets.companyId, companyId)))
      .returning();
    if (!budget) {
      throw new Error('Budget not found');
    }
    return budget;
  }

  // E-Commerce Integrations
  async getEcommerceIntegrations(companyId: string): Promise<EcommerceIntegration[]> {
    return await db
      .select()
      .from(ecommerceIntegrations)
      .where(eq(ecommerceIntegrations.companyId, companyId))
      .orderBy(desc(ecommerceIntegrations.createdAt));
  }

  async getEcommerceIntegrationById(id: string): Promise<EcommerceIntegration | undefined> {
    const [integration] = await db
      .select()
      .from(ecommerceIntegrations)
      .where(eq(ecommerceIntegrations.id, id));
    return integration || undefined;
  }

  async createEcommerceIntegration(insertIntegration: InsertEcommerceIntegration): Promise<EcommerceIntegration> {
    const [integration] = await db
      .insert(ecommerceIntegrations)
      .values(insertIntegration)
      .returning();
    return integration;
  }

  async updateEcommerceIntegration(id: string, data: Partial<InsertEcommerceIntegration>): Promise<EcommerceIntegration> {
    const [integration] = await db
      .update(ecommerceIntegrations)
      .set(data)
      .where(eq(ecommerceIntegrations.id, id))
      .returning();
    if (!integration) {
      throw new Error('E-commerce integration not found');
    }
    return integration;
  }

  async deleteEcommerceIntegration(id: string): Promise<void> {
    await db.delete(ecommerceIntegrations).where(eq(ecommerceIntegrations.id, id));
  }

  // E-Commerce Transactions
  async getEcommerceTransactions(companyId: string): Promise<EcommerceTransaction[]> {
    const results = await db
      .select({
        ecommerceTransactions: ecommerceTransactions,
      })
      .from(ecommerceTransactions)
      .innerJoin(ecommerceIntegrations, eq(ecommerceTransactions.integrationId, ecommerceIntegrations.id))
      .where(eq(ecommerceIntegrations.companyId, companyId));
    
    return results.map((r: any) => r.ecommerceTransactions);
  }

  async createEcommerceTransaction(insertTransaction: InsertEcommerceTransaction): Promise<EcommerceTransaction> {
    const [transaction] = await db
      .insert(ecommerceTransactions)
      .values(insertTransaction)
      .returning();
    return transaction;
  }

  async updateEcommerceTransaction(id: string, data: Partial<InsertEcommerceTransaction>): Promise<EcommerceTransaction> {
    const [transaction] = await db
      .update(ecommerceTransactions)
      .set(data)
      .where(eq(ecommerceTransactions.id, id))
      .returning();
    if (!transaction) {
      throw new Error('E-commerce transaction not found');
    }
    return transaction;
  }

  // Financial KPIs
  async getFinancialKpis(companyId: string): Promise<FinancialKpi[]> {
    return await db
      .select()
      .from(financialKpis)
      .where(eq(financialKpis.companyId, companyId))
      .orderBy(desc(financialKpis.calculatedAt));
  }

  async createFinancialKpi(insertKpi: InsertFinancialKpi): Promise<FinancialKpi> {
    const [kpi] = await db
      .insert(financialKpis)
      .values(insertKpi)
      .returning();
    return kpi;
  }

  // Cash Flow Forecasts (alias for consistency)
  async getCashFlowForecasts(companyId: string): Promise<CashFlowForecast[]> {
    return this.getCashFlowForecastsByCompanyId(companyId);
  }

  // Notifications
  async getNotificationsByUserId(userId: string): Promise<Notification[]> {
    return await db
      .select()
      .from(notifications)
      .where(and(
        eq(notifications.userId, userId),
        eq(notifications.isDismissed, false)
      ))
      .orderBy(desc(notifications.createdAt));
  }

  async getUnreadNotificationCount(userId: string): Promise<number> {
    const result = await db
      .select()
      .from(notifications)
      .where(and(
        eq(notifications.userId, userId),
        eq(notifications.isRead, false),
        eq(notifications.isDismissed, false)
      ));
    return result.length;
  }

  async createNotification(insertNotification: InsertNotification): Promise<Notification> {
    const [notification] = await db
      .insert(notifications)
      .values(insertNotification)
      .returning();
    return notification;
  }

  async markNotificationAsRead(id: string): Promise<Notification> {
    const [notification] = await db
      .update(notifications)
      .set({ isRead: true, readAt: new Date() })
      .where(eq(notifications.id, id))
      .returning();
    return notification;
  }

  async markAllNotificationsAsRead(userId: string): Promise<void> {
    await db
      .update(notifications)
      .set({ isRead: true, readAt: new Date() })
      .where(eq(notifications.userId, userId));
  }

  async dismissNotification(id: string): Promise<Notification> {
    const [notification] = await db
      .update(notifications)
      .set({ isDismissed: true })
      .where(eq(notifications.id, id))
      .returning();
    return notification;
  }

  // Regulatory News
  async getRegulatoryNews(): Promise<RegulatoryNews[]> {
    return await db
      .select()
      .from(regulatoryNews)
      .where(eq(regulatoryNews.isActive, true))
      .orderBy(desc(regulatoryNews.publishedAt));
  }

  async createRegulatoryNews(insertNews: InsertRegulatoryNews): Promise<RegulatoryNews> {
    const [news] = await db
      .insert(regulatoryNews)
      .values(insertNews)
      .returning();
    return news;
  }

  // Reminder Settings
  async getReminderSettingsByCompanyId(companyId: string): Promise<ReminderSetting[]> {
    return await db
      .select()
      .from(reminderSettings)
      .where(eq(reminderSettings.companyId, companyId));
  }

  async createReminderSetting(insertSetting: InsertReminderSetting): Promise<ReminderSetting> {
    const [setting] = await db
      .insert(reminderSettings)
      .values(insertSetting)
      .returning();
    return setting;
  }

  async updateReminderSetting(id: string, data: Partial<InsertReminderSetting>): Promise<ReminderSetting> {
    const [setting] = await db
      .update(reminderSettings)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(reminderSettings.id, id))
      .returning();
    return setting;
  }

  // Reminder Logs
  async getReminderLogsByCompanyId(companyId: string): Promise<ReminderLog[]> {
    return await db
      .select()
      .from(reminderLogs)
      .where(eq(reminderLogs.companyId, companyId))
      .orderBy(desc(reminderLogs.createdAt));
  }

  async createReminderLog(insertLog: InsertReminderLog): Promise<ReminderLog> {
    const [log] = await db
      .insert(reminderLogs)
      .values(insertLog)
      .returning();
    return log;
  }

  async updateReminderLog(id: string, data: Partial<InsertReminderLog>): Promise<ReminderLog> {
    const [log] = await db
      .update(reminderLogs)
      .set(data)
      .where(eq(reminderLogs.id, id))
      .returning();
    return log;
  }

  // User Onboarding
  async getUserOnboarding(userId: string): Promise<UserOnboarding | undefined> {
    const [onboarding] = await db
      .select()
      .from(userOnboarding)
      .where(eq(userOnboarding.userId, userId));
    return onboarding;
  }

  async createUserOnboarding(insertOnboarding: InsertUserOnboarding): Promise<UserOnboarding> {
    const [onboarding] = await db
      .insert(userOnboarding)
      .values(insertOnboarding)
      .returning();
    return onboarding;
  }

  async updateUserOnboarding(userId: string, data: Partial<InsertUserOnboarding>): Promise<UserOnboarding> {
    const [onboarding] = await db
      .update(userOnboarding)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(userOnboarding.userId, userId))
      .returning();
    return onboarding;
  }

  // Help Tips
  async getHelpTipsByPage(pageContext: string): Promise<HelpTip[]> {
    return await db
      .select()
      .from(helpTips)
      .where(and(
        eq(helpTips.pageContext, pageContext),
        eq(helpTips.isActive, true)
      ))
      .orderBy(helpTips.order);
  }

  async getAllHelpTips(): Promise<HelpTip[]> {
    return await db
      .select()
      .from(helpTips)
      .where(eq(helpTips.isActive, true))
      .orderBy(helpTips.order);
  }

  async createHelpTip(insertTip: InsertHelpTip): Promise<HelpTip> {
    const [tip] = await db
      .insert(helpTips)
      .values(insertTip)
      .returning();
    return tip;
  }

  // Referral Codes
  async getReferralCodeByUserId(userId: string): Promise<ReferralCode | undefined> {
    const [code] = await db
      .select()
      .from(referralCodes)
      .where(eq(referralCodes.userId, userId));
    return code;
  }

  async getReferralCodeByCode(code: string): Promise<ReferralCode | undefined> {
    const [referralCode] = await db
      .select()
      .from(referralCodes)
      .where(eq(referralCodes.code, code));
    return referralCode;
  }

  async createReferralCode(insertCode: InsertReferralCode): Promise<ReferralCode> {
    const [code] = await db
      .insert(referralCodes)
      .values(insertCode)
      .returning();
    return code;
  }

  async updateReferralCode(id: string, data: Partial<InsertReferralCode>): Promise<ReferralCode> {
    const [code] = await db
      .update(referralCodes)
      .set(data)
      .where(eq(referralCodes.id, id))
      .returning();
    return code;
  }

  // Referrals
  async getReferralsByReferrerId(referrerId: string): Promise<Referral[]> {
    return await db
      .select()
      .from(referrals)
      .where(eq(referrals.referrerId, referrerId))
      .orderBy(desc(referrals.createdAt));
  }

  async createReferral(insertReferral: InsertReferral): Promise<Referral> {
    const [referral] = await db
      .insert(referrals)
      .values(insertReferral)
      .returning();
    return referral;
  }

  async updateReferral(id: string, data: Partial<InsertReferral>): Promise<Referral> {
    const [referral] = await db
      .update(referrals)
      .set(data)
      .where(eq(referrals.id, id))
      .returning();
    return referral;
  }

  // User Feedback
  async createUserFeedback(insertFeedback: InsertUserFeedback): Promise<UserFeedback> {
    const [feedback] = await db
      .insert(userFeedback)
      .values(insertFeedback)
      .returning();
    return feedback;
  }

  async getUserFeedback(userId?: string): Promise<UserFeedback[]> {
    if (userId) {
      return await db
        .select()
        .from(userFeedback)
        .where(eq(userFeedback.userId, userId))
        .orderBy(desc(userFeedback.createdAt));
    }
    return await db
      .select()
      .from(userFeedback)
      .orderBy(desc(userFeedback.createdAt));
  }

  async updateUserFeedback(id: string, data: Partial<InsertUserFeedback>): Promise<UserFeedback> {
    const [feedback] = await db
      .update(userFeedback)
      .set(data)
      .where(eq(userFeedback.id, id))
      .returning();
    return feedback;
  }

  // Analytics Events
  async createAnalyticsEvent(insertEvent: InsertAnalyticsEvent): Promise<AnalyticsEvent> {
    const [event] = await db
      .insert(analyticsEvents)
      .values(insertEvent)
      .returning();
    return event;
  }

  async getAnalyticsEvents(filters?: { userId?: string; eventType?: string; startDate?: Date; endDate?: Date }): Promise<AnalyticsEvent[]> {
    let query = db.select().from(analyticsEvents);
    
    if (filters?.userId) {
      query = query.where(eq(analyticsEvents.userId, filters.userId)) as typeof query;
    }
    if (filters?.eventType) {
      query = query.where(eq(analyticsEvents.eventType, filters.eventType)) as typeof query;
    }
    
    return await query.orderBy(desc(analyticsEvents.createdAt));
  }

  // Feature Usage Metrics
  async getFeatureUsageMetrics(featureName?: string): Promise<FeatureUsageMetric[]> {
    if (featureName) {
      return await db
        .select()
        .from(featureUsageMetrics)
        .where(eq(featureUsageMetrics.featureName, featureName))
        .orderBy(desc(featureUsageMetrics.calculatedAt));
    }
    return await db
      .select()
      .from(featureUsageMetrics)
      .orderBy(desc(featureUsageMetrics.calculatedAt));
  }

  async createFeatureUsageMetric(insertMetric: InsertFeatureUsageMetric): Promise<FeatureUsageMetric> {
    const [metric] = await db
      .insert(featureUsageMetrics)
      .values(insertMetric)
      .returning();
    return metric;
  }

  // Admin Settings
  async getAdminSettings(): Promise<AdminSetting[]> {
    return await db.select().from(adminSettings);
  }

  async getAdminSettingByKey(key: string): Promise<AdminSetting | undefined> {
    const [setting] = await db.select().from(adminSettings).where(eq(adminSettings.key, key));
    return setting || undefined;
  }

  async createAdminSetting(insertSetting: InsertAdminSetting): Promise<AdminSetting> {
    const [setting] = await db
      .insert(adminSettings)
      .values(insertSetting)
      .returning();
    return setting;
  }

  async updateAdminSetting(key: string, value: string): Promise<AdminSetting> {
    const [setting] = await db
      .update(adminSettings)
      .set({ value, updatedAt: new Date() })
      .where(eq(adminSettings.key, key))
      .returning();
    return setting;
  }

  // Subscription Plans
  async getSubscriptionPlans(): Promise<SubscriptionPlan[]> {
    return await db.select().from(subscriptionPlans).orderBy(subscriptionPlans.sortOrder);
  }

  async getSubscriptionPlan(id: string): Promise<SubscriptionPlan | undefined> {
    const [plan] = await db.select().from(subscriptionPlans).where(eq(subscriptionPlans.id, id));
    return plan || undefined;
  }

  async createSubscriptionPlan(insertPlan: InsertSubscriptionPlan): Promise<SubscriptionPlan> {
    const [plan] = await db
      .insert(subscriptionPlans)
      .values(insertPlan)
      .returning();
    return plan;
  }

  async updateSubscriptionPlan(id: string, data: Partial<InsertSubscriptionPlan>): Promise<SubscriptionPlan> {
    const [plan] = await db
      .update(subscriptionPlans)
      .set(data)
      .where(eq(subscriptionPlans.id, id))
      .returning();
    return plan;
  }

  async deleteSubscriptionPlan(id: string): Promise<void> {
    await db.delete(subscriptionPlans).where(eq(subscriptionPlans.id, id));
  }

  // User Subscriptions
  async getUserSubscription(userId: string): Promise<UserSubscription | undefined> {
    const [subscription] = await db
      .select()
      .from(userSubscriptions)
      .where(eq(userSubscriptions.userId, userId));
    return subscription || undefined;
  }

  async createUserSubscription(insertSubscription: InsertUserSubscription): Promise<UserSubscription> {
    const [subscription] = await db
      .insert(userSubscriptions)
      .values(insertSubscription)
      .returning();
    return subscription;
  }

  async updateUserSubscription(id: string, data: Partial<InsertUserSubscription>): Promise<UserSubscription> {
    const [subscription] = await db
      .update(userSubscriptions)
      .set(data)
      .where(eq(userSubscriptions.id, id))
      .returning();
    return subscription;
  }

  // Audit Logs
  async getAuditLogs(limit: number = 100): Promise<AuditLog[]> {
    return await db
      .select()
      .from(auditLogs)
      .orderBy(desc(auditLogs.createdAt))
      .limit(limit);
  }

  async createAuditLog(insertLog: InsertAuditLog): Promise<AuditLog> {
    const [log] = await db
      .insert(auditLogs)
      .values(insertLog)
      .returning();
    return log;
  }

  // Admin Stats
  async getAllUsers(): Promise<User[]> {
    return await db.select().from(users).orderBy(desc(users.createdAt));
  }

  async getAllCompanies(): Promise<Company[]> {
    return await db.select().from(companies).where(isNull(companies.deletedAt)).orderBy(desc(companies.createdAt));
  }

  // VAT Returns
  async getVatReturnsByCompanyId(companyId: string): Promise<VatReturn[]> {
    return await db
      .select()
      .from(vatReturns)
      .where(eq(vatReturns.companyId, companyId))
      .orderBy(desc(vatReturns.periodEnd));
  }

  async getVatReturn(id: string): Promise<VatReturn | undefined> {
    const [vatReturn] = await db.select().from(vatReturns).where(eq(vatReturns.id, id));
    return vatReturn || undefined;
  }

  async createVatReturn(insertVatReturn: InsertVatReturn): Promise<VatReturn> {
    const [vatReturn] = await db
      .insert(vatReturns)
      .values(insertVatReturn)
      .returning();
    return vatReturn;
  }

  async updateVatReturn(id: string, data: Partial<InsertVatReturn>): Promise<VatReturn> {
    const [vatReturn] = await db
      .update(vatReturns)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(vatReturns.id, id))
      .returning();
    return vatReturn;
  }

  async deleteVatReturn(id: string): Promise<void> {
    await db.delete(vatReturns).where(eq(vatReturns.id, id));
  }

  // Corporate Tax Returns
  async getCorporateTaxReturnsByCompanyId(companyId: string): Promise<CorporateTaxReturn[]> {
    return await db
      .select()
      .from(corporateTaxReturns)
      .where(eq(corporateTaxReturns.companyId, companyId))
      .orderBy(desc(corporateTaxReturns.taxPeriodEnd));
  }

  async getCorporateTaxReturn(id: string): Promise<CorporateTaxReturn | undefined> {
    const [taxReturn] = await db.select().from(corporateTaxReturns).where(eq(corporateTaxReturns.id, id));
    return taxReturn || undefined;
  }

  async createCorporateTaxReturn(data: InsertCorporateTaxReturn): Promise<CorporateTaxReturn> {
    const [taxReturn] = await db
      .insert(corporateTaxReturns)
      .values(data)
      .returning();
    return taxReturn;
  }

  async updateCorporateTaxReturn(id: string, data: Partial<CorporateTaxReturn>): Promise<CorporateTaxReturn> {
    const [taxReturn] = await db
      .update(corporateTaxReturns)
      .set(data)
      .where(eq(corporateTaxReturns.id, id))
      .returning();
    return taxReturn;
  }

  // Team Management
  async updateCompanyUser(id: string, data: Partial<InsertCompanyUser>): Promise<CompanyUser> {
    const [companyUser] = await db
      .update(companyUsers)
      .set(data)
      .where(eq(companyUsers.id, id))
      .returning();
    return companyUser;
  }

  async deleteCompanyUser(id: string): Promise<void> {
    await db.delete(companyUsers).where(eq(companyUsers.id, id));
  }

  async getCompanyUserWithUser(companyId: string): Promise<(CompanyUser & { user: User })[]> {
    const results = await db
      .select()
      .from(companyUsers)
      .innerJoin(users, eq(companyUsers.userId, users.id))
      .where(eq(companyUsers.companyId, companyId));
    
    return results.map((r: any) => ({
      ...r.company_users,
      user: r.users
    }));
  }

  // Document Vault
  async getDocuments(companyId: string): Promise<Document[]> {
    return await db
      .select()
      .from(documents)
      .where(eq(documents.companyId, companyId))
      .orderBy(desc(documents.createdAt));
  }

  async getDocument(id: string): Promise<Document | undefined> {
    const [document] = await db.select().from(documents).where(eq(documents.id, id));
    return document || undefined;
  }

  async createDocument(insertDocument: InsertDocument): Promise<Document> {
    const [document] = await db
      .insert(documents)
      .values(insertDocument)
      .returning();
    return document;
  }

  async updateDocument(id: string, data: Partial<InsertDocument>): Promise<Document> {
    const [document] = await db
      .update(documents)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(documents.id, id))
      .returning();
    return document;
  }

  async deleteDocument(id: string): Promise<void> {
    await db.delete(documents).where(eq(documents.id, id));
  }

  // Tax Return Archive
  async getTaxReturnArchive(companyId: string): Promise<TaxReturnArchive[]> {
    return await db
      .select()
      .from(taxReturnArchive)
      .where(eq(taxReturnArchive.companyId, companyId))
      .orderBy(desc(taxReturnArchive.filingDate));
  }

  async getTaxReturnArchiveItem(id: string): Promise<TaxReturnArchive | undefined> {
    const [item] = await db.select().from(taxReturnArchive).where(eq(taxReturnArchive.id, id));
    return item || undefined;
  }

  async createTaxReturnArchive(insertTaxReturn: InsertTaxReturnArchive): Promise<TaxReturnArchive> {
    const [taxReturn] = await db
      .insert(taxReturnArchive)
      .values(insertTaxReturn)
      .returning();
    return taxReturn;
  }

  // Compliance Tasks
  async getComplianceTasks(companyId: string): Promise<ComplianceTask[]> {
    return await db
      .select()
      .from(complianceTasks)
      .where(eq(complianceTasks.companyId, companyId))
      .orderBy(complianceTasks.dueDate);
  }

  async getComplianceTask(id: string): Promise<ComplianceTask | undefined> {
    const [task] = await db.select().from(complianceTasks).where(eq(complianceTasks.id, id));
    return task || undefined;
  }

  async createComplianceTask(insertTask: InsertComplianceTask): Promise<ComplianceTask> {
    const [task] = await db
      .insert(complianceTasks)
      .values(insertTask)
      .returning();
    return task;
  }

  async updateComplianceTask(id: string, data: Partial<InsertComplianceTask>): Promise<ComplianceTask> {
    const [task] = await db
      .update(complianceTasks)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(complianceTasks.id, id))
      .returning();
    return task;
  }

  async deleteComplianceTask(id: string): Promise<void> {
    await db.delete(complianceTasks).where(eq(complianceTasks.id, id));
  }

  // Messages
  async getMessages(companyId: string): Promise<Message[]> {
    return await db
      .select()
      .from(messages)
      .where(eq(messages.companyId, companyId))
      .orderBy(desc(messages.createdAt));
  }

  async getMessage(id: string): Promise<Message | undefined> {
    const [message] = await db.select().from(messages).where(eq(messages.id, id));
    return message || undefined;
  }

  async createMessage(insertMessage: InsertMessage): Promise<Message> {
    const [message] = await db
      .insert(messages)
      .values(insertMessage)
      .returning();
    return message;
  }

  async markMessageAsRead(id: string): Promise<Message> {
    const [message] = await db
      .update(messages)
      .set({ isRead: true, readAt: new Date() })
      .where(eq(messages.id, id))
      .returning();
    return message;
  }

  // News Items
  async getNewsItems(): Promise<NewsItem[]> {
    return await db
      .select()
      .from(newsItems)
      .where(eq(newsItems.isActive, true))
      .orderBy(desc(newsItems.publishedAt));
  }

  async createNewsItem(insertNews: InsertNewsItem): Promise<NewsItem> {
    const [news] = await db
      .insert(newsItems)
      .values(insertNews)
      .returning();
    return news;
  }

  // Invitations (Admin)
  async getInvitations(): Promise<Invitation[]> {
    return await db
      .select()
      .from(invitations)
      .orderBy(desc(invitations.createdAt));
  }

  async getInvitationsByCompany(companyId: string): Promise<Invitation[]> {
    return await db
      .select()
      .from(invitations)
      .where(eq(invitations.companyId, companyId))
      .orderBy(desc(invitations.createdAt));
  }

  async getInvitationByToken(token: string): Promise<Invitation | undefined> {
    const [invitation] = await db
      .select()
      .from(invitations)
      .where(eq(invitations.token, token));
    return invitation || undefined;
  }

  async getInvitationByEmail(email: string): Promise<Invitation | undefined> {
    const [invitation] = await db
      .select()
      .from(invitations)
      .where(eq(invitations.email, email));
    return invitation || undefined;
  }

  async createInvitation(insertInvitation: InsertInvitation): Promise<Invitation> {
    const [invitation] = await db
      .insert(invitations)
      .values(insertInvitation)
      .returning();
    return invitation;
  }

  async updateInvitation(id: string, data: Partial<InsertInvitation>): Promise<Invitation> {
    const [invitation] = await db
      .update(invitations)
      .set(data)
      .where(eq(invitations.id, id))
      .returning();
    return invitation;
  }

  async deleteInvitation(id: string): Promise<void> {
    await db.delete(invitations).where(eq(invitations.id, id));
  }

  // Activity Logs (Admin)
  async getActivityLogs(limit: number = 100): Promise<ActivityLog[]> {
    return await db
      .select()
      .from(activityLogs)
      .orderBy(desc(activityLogs.createdAt))
      .limit(limit);
  }

  async getActivityLogsByCompany(companyId: string, limit: number = 100): Promise<ActivityLog[]> {
    return await db
      .select()
      .from(activityLogs)
      .where(eq(activityLogs.companyId, companyId))
      .orderBy(desc(activityLogs.createdAt))
      .limit(limit);
  }

  async getActivityLogsByUser(userId: string, limit: number = 100): Promise<ActivityLog[]> {
    return await db
      .select()
      .from(activityLogs)
      .where(eq(activityLogs.userId, userId))
      .orderBy(desc(activityLogs.createdAt))
      .limit(limit);
  }

  async createActivityLog(insertLog: InsertActivityLog): Promise<ActivityLog> {
    const [log] = await db
      .insert(activityLogs)
      .values(insertLog)
      .returning();
    return log;
  }

  // Client Notes (Admin)
  async getClientNotes(companyId: string): Promise<ClientNote[]> {
    return await db
      .select()
      .from(clientNotes)
      .where(eq(clientNotes.companyId, companyId))
      .orderBy(desc(clientNotes.createdAt));
  }

  async createClientNote(insertNote: InsertClientNote): Promise<ClientNote> {
    const [note] = await db
      .insert(clientNotes)
      .values(insertNote)
      .returning();
    return note;
  }

  async updateClientNote(id: string, data: Partial<InsertClientNote>): Promise<ClientNote> {
    const [note] = await db
      .update(clientNotes)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(clientNotes.id, id))
      .returning();
    return note;
  }

  async deleteClientNote(id: string): Promise<void> {
    await db.delete(clientNotes).where(eq(clientNotes.id, id));
  }

  // Admin User Management
  async updateUser(id: string, data: { name?: string; email?: string; isAdmin?: boolean }): Promise<User> {
    const [user] = await db
      .update(users)
      .set(data)
      .where(eq(users.id, id))
      .returning();
    return user;
  }

  async deleteUser(id: string): Promise<void> {
    await db.delete(users).where(eq(users.id, id));
  }

  // Admin Company Management
  async deleteCompany(id: string): Promise<void> {
    await db.update(companies).set({ deletedAt: new Date(), isActive: false }).where(eq(companies.id, id));
  }

  // Client Engagements
  async getEngagements(): Promise<Engagement[]> {
    return await db
      .select()
      .from(engagements)
      .orderBy(desc(engagements.createdAt));
  }

  async getEngagementsByCompany(companyId: string): Promise<Engagement[]> {
    return await db
      .select()
      .from(engagements)
      .where(eq(engagements.companyId, companyId))
      .orderBy(desc(engagements.createdAt));
  }

  async getEngagement(id: string): Promise<Engagement | undefined> {
    const [engagement] = await db
      .select()
      .from(engagements)
      .where(eq(engagements.id, id));
    return engagement || undefined;
  }

  async createEngagement(insertEngagement: InsertEngagement): Promise<Engagement> {
    const [engagement] = await db
      .insert(engagements)
      .values(insertEngagement)
      .returning();
    return engagement;
  }

  async updateEngagement(id: string, data: Partial<InsertEngagement>): Promise<Engagement> {
    const [engagement] = await db
      .update(engagements)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(engagements.id, id))
      .returning();
    return engagement;
  }

  async deleteEngagement(id: string): Promise<void> {
    await db.delete(engagements).where(eq(engagements.id, id));
  }

  // Service Invoices (NR billing to clients)
  async getServiceInvoices(companyId?: string): Promise<ServiceInvoice[]> {
    if (companyId) {
      return await db
        .select()
        .from(serviceInvoices)
        .where(eq(serviceInvoices.companyId, companyId))
        .orderBy(desc(serviceInvoices.createdAt));
    }
    return await db
      .select()
      .from(serviceInvoices)
      .orderBy(desc(serviceInvoices.createdAt));
  }

  async getServiceInvoice(id: string): Promise<ServiceInvoice | undefined> {
    const [invoice] = await db
      .select()
      .from(serviceInvoices)
      .where(eq(serviceInvoices.id, id));
    return invoice || undefined;
  }

  async createServiceInvoice(insertInvoice: InsertServiceInvoice): Promise<ServiceInvoice> {
    const [invoice] = await db
      .insert(serviceInvoices)
      .values(insertInvoice)
      .returning();
    return invoice;
  }

  async updateServiceInvoice(id: string, data: Partial<InsertServiceInvoice>): Promise<ServiceInvoice> {
    const [invoice] = await db
      .update(serviceInvoices)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(serviceInvoices.id, id))
      .returning();
    return invoice;
  }

  async deleteServiceInvoice(id: string): Promise<void> {
    await db.delete(serviceInvoices).where(eq(serviceInvoices.id, id));
  }

  // Service Invoice Lines
  async getServiceInvoiceLines(serviceInvoiceId: string): Promise<ServiceInvoiceLine[]> {
    return await db
      .select()
      .from(serviceInvoiceLines)
      .where(eq(serviceInvoiceLines.serviceInvoiceId, serviceInvoiceId));
  }

  async createServiceInvoiceLine(insertLine: InsertServiceInvoiceLine): Promise<ServiceInvoiceLine> {
    const [line] = await db
      .insert(serviceInvoiceLines)
      .values(insertLine)
      .returning();
    return line;
  }

  async deleteServiceInvoiceLines(serviceInvoiceId: string): Promise<void> {
    await db.delete(serviceInvoiceLines).where(eq(serviceInvoiceLines.serviceInvoiceId, serviceInvoiceId));
  }

  // FTA Emails
  async getFtaEmails(companyId: string): Promise<FtaEmail[]> {
    return await db
      .select()
      .from(ftaEmails)
      .where(eq(ftaEmails.companyId, companyId))
      .orderBy(desc(ftaEmails.receivedAt));
  }

  async createFtaEmail(insertEmail: InsertFtaEmail): Promise<FtaEmail> {
    const [email] = await db
      .insert(ftaEmails)
      .values(insertEmail)
      .returning();
    return email;
  }

  async updateFtaEmail(id: string, data: Partial<InsertFtaEmail>): Promise<FtaEmail> {
    const [email] = await db
      .update(ftaEmails)
      .set(data)
      .where(eq(ftaEmails.id, id))
      .returning();
    return email;
  }

  // Customer Subscriptions
  async getSubscription(companyId: string): Promise<Subscription | undefined> {
    const [subscription] = await db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.companyId, companyId));
    return subscription || undefined;
  }

  async createSubscription(insertSubscription: InsertSubscription): Promise<Subscription> {
    const [subscription] = await db
      .insert(subscriptions)
      .values(insertSubscription)
      .returning();
    return subscription;
  }

  async updateSubscription(id: string, data: Partial<InsertSubscription>): Promise<Subscription> {
    const [subscription] = await db
      .update(subscriptions)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(subscriptions.id, id))
      .returning();
    return subscription;
  }

  // User type management
  async updateUserType(id: string, userType: string): Promise<User> {
    const [user] = await db
      .update(users)
      .set({ userType })
      .where(eq(users.id, id))
      .returning();
    return user;
  }

  async getUsersByType(userType: string): Promise<User[]> {
    return await db
      .select()
      .from(users)
      .where(eq(users.userType, userType))
      .orderBy(desc(users.createdAt));
  }

  async getClientCompanies(): Promise<Company[]> {
    return await db
      .select()
      .from(companies)
      .where(and(eq(companies.companyType, 'client'), isNull(companies.deletedAt)))
      .orderBy(desc(companies.createdAt));
  }

  async getCustomerCompanies(): Promise<Company[]> {
    return await db
      .select()
      .from(companies)
      .where(and(eq(companies.companyType, 'customer'), isNull(companies.deletedAt)))
      .orderBy(desc(companies.createdAt));
  }

  // Backups
  async getBackupsByCompanyId(companyId: string): Promise<Backup[]> {
    return await db
      .select()
      .from(backups)
      .where(eq(backups.companyId, companyId))
      .orderBy(desc(backups.createdAt));
  }

  async getBackup(id: string): Promise<Backup | undefined> {
    const [backup] = await db.select().from(backups).where(eq(backups.id, id));
    return backup || undefined;
  }

  async createBackup(insertBackup: InsertBackup): Promise<Backup> {
    const [backup] = await db
      .insert(backups)
      .values(insertBackup)
      .returning();
    return backup;
  }

  async updateBackup(id: string, data: Partial<InsertBackup>): Promise<Backup> {
    const [backup] = await db
      .update(backups)
      .set(data)
      .where(eq(backups.id, id))
      .returning();
    return backup;
  }

  async deleteBackup(id: string): Promise<void> {
    await db.delete(backups).where(eq(backups.id, id));
  }

  // AI Conversations
  async createAiConversation(conversation: InsertAiConversation): Promise<AiConversation> {
    const [result] = await db
      .insert(aiConversations)
      .values(conversation)
      .returning();
    return result;
  }

  async getAiConversationsByUserId(userId: string, limit: number = 50): Promise<AiConversation[]> {
    return await db
      .select()
      .from(aiConversations)
      .where(eq(aiConversations.userId, userId))
      .orderBy(desc(aiConversations.createdAt))
      .limit(limit);
  }

  async getAiConversationsByCompanyId(companyId: string, limit: number = 50): Promise<AiConversation[]> {
    return await db
      .select()
      .from(aiConversations)
      .where(eq(aiConversations.companyId, companyId))
      .orderBy(desc(aiConversations.createdAt))
      .limit(limit);
  }

  async getAiConversation(id: string): Promise<AiConversation | undefined> {
    const [conversation] = await db
      .select()
      .from(aiConversations)
      .where(eq(aiConversations.id, id));
    return conversation || undefined;
  }

  async deleteAiConversation(id: string): Promise<void> {
    await db.delete(aiConversations).where(eq(aiConversations.id, id));
  }

  // Recurring Invoices
  async getRecurringInvoicesByCompanyId(companyId: string): Promise<RecurringInvoice[]> {
    return await db
      .select()
      .from(recurringInvoices)
      .where(eq(recurringInvoices.companyId, companyId))
      .orderBy(desc(recurringInvoices.createdAt));
  }

  async getRecurringInvoice(id: string): Promise<RecurringInvoice | undefined> {
    const [item] = await db.select().from(recurringInvoices).where(eq(recurringInvoices.id, id));
    return item || undefined;
  }

  async getDueRecurringInvoices(): Promise<RecurringInvoice[]> {
    return await db
      .select()
      .from(recurringInvoices)
      .where(
        and(
          eq(recurringInvoices.isActive, true),
          lte(recurringInvoices.nextRunDate, new Date())
        )
      );
  }

  async fetchAndLockNextDueRecurringInvoice(
    tx: typeof db,
    excludeIds: string[] = [],
  ): Promise<RecurringInvoice | undefined> {
    // Pessimistic row lock with SKIP LOCKED — concurrent cron runners see
    // the row as "unavailable" rather than the same row twice. Eliminates
    // the throwaway-invoice + safeDeleteInvoice pattern that left holes in
    // the FTA-required sequential allocator.
    //
    // `excludeIds` skips templates the caller has already visited in this
    // cron tick. Without this, a period-locked or errored template stays
    // "earliest due" and the scheduler would re-fetch it on every loop
    // iteration, starving later due templates.
    const result: any = excludeIds.length === 0
      ? await tx.execute(sql`
          SELECT * FROM recurring_invoices
          WHERE is_active = true
            AND next_run_date <= now()
          ORDER BY next_run_date ASC
          LIMIT 1
          FOR UPDATE SKIP LOCKED
        `)
      : await tx.execute(sql`
          SELECT * FROM recurring_invoices
          WHERE is_active = true
            AND next_run_date <= now()
            AND id <> ALL(${excludeIds}::uuid[])
          ORDER BY next_run_date ASC
          LIMIT 1
          FOR UPDATE SKIP LOCKED
        `);
    const rows = (result.rows ?? result) as RecurringInvoice[];
    return rows[0];
  }

  async createRecurringInvoice(data: InsertRecurringInvoice): Promise<RecurringInvoice> {
    const [item] = await db
      .insert(recurringInvoices)
      .values(data)
      .returning();
    return item;
  }

  async updateRecurringInvoice(id: string, data: Partial<RecurringInvoice>): Promise<RecurringInvoice> {
    const [item] = await db
      .update(recurringInvoices)
      .set(data)
      .where(eq(recurringInvoices.id, id))
      .returning();
    if (!item) {
      throw new Error('Recurring invoice not found');
    }
    return item;
  }

  async deleteRecurringInvoice(id: string): Promise<void> {
    await db.delete(recurringInvoices).where(eq(recurringInvoices.id, id));
  }

  // Invoice Payments
  async getInvoicePaymentsByInvoiceId(invoiceId: string): Promise<InvoicePayment[]> {
    return await db
      .select()
      .from(invoicePayments)
      .where(eq(invoicePayments.invoiceId, invoiceId))
      .orderBy(desc(invoicePayments.createdAt));
  }

  async getInvoicePaymentsByCompanyId(companyId: string): Promise<InvoicePayment[]> {
    return await db
      .select()
      .from(invoicePayments)
      .where(eq(invoicePayments.companyId, companyId))
      .orderBy(desc(invoicePayments.createdAt));
  }

  async createInvoicePayment(data: InsertInvoicePayment): Promise<InvoicePayment> {
    const [payment] = await db.insert(invoicePayments).values(data).returning();
    return payment;
  }

  async getJournalEntriesBySource(
    companyId: string,
    source: string,
    sourceId: string,
  ): Promise<JournalEntry[]> {
    return await db
      .select()
      .from(journalEntries)
      .where(
        and(
          eq(journalEntries.companyId, companyId),
          eq(journalEntries.source, source),
          eq(journalEntries.sourceId, sourceId),
        ),
      );
  }

  async recordInvoicePayment(input: {
    invoiceId: string;
    companyId: string;
    amount: number;
    date: Date;
    method: string;
    reference: string | null;
    notes: string | null;
    paymentAccountId: string;
    paymentAccountCurrency?: string | null;
    receivableAccountId: string;
    createdBy: string;
  }): Promise<{
    payment: InvoicePayment;
    invoice: Invoice;
    journalEntryId: string;
    totalPaid: number;
  }> {
    return await db.transaction(async (tx: typeof db) => {
      // Lock the invoice row. Concurrent payment writers will queue here.
      const lockResult: any = await tx.execute(sql`
        SELECT id, company_id, currency, total, status
        FROM invoices
        WHERE id = ${input.invoiceId}
        FOR UPDATE
      `);
      const lockedRows = (lockResult.rows ?? lockResult) as Array<{
        id: string;
        company_id: string;
        currency: string;
        total: number;
        status: string;
      }>;
      const lockedInvoice = lockedRows[0];
      if (!lockedInvoice) {
        const e: any = new Error('Invoice not found');
        e.code = 'INVOICE_NOT_FOUND';
        throw e;
      }
      if (lockedInvoice.company_id !== input.companyId) {
        const e: any = new Error('Invoice does not belong to company');
        e.code = 'INVOICE_COMPANY_MISMATCH';
        throw e;
      }
      if (isTerminal(lockedInvoice.status)) {
        const e: any = new Error(`Cannot record payment on ${lockedInvoice.status} invoice`);
        e.code = 'INVOICE_TERMINAL';
        throw e;
      }
      if (
        input.paymentAccountCurrency &&
        input.paymentAccountCurrency !== lockedInvoice.currency
      ) {
        const e: any = new Error(
          `Payment account currency (${input.paymentAccountCurrency}) does not match invoice currency (${lockedInvoice.currency})`,
        );
        e.code = 'CURRENCY_MISMATCH';
        throw e;
      }

      // Sum existing payments INSIDE the lock so we see the canonical figure.
      const sumResult: any = await tx.execute(sql`
        SELECT COALESCE(SUM(amount), 0) AS paid
        FROM invoice_payments
        WHERE invoice_id = ${input.invoiceId}
      `);
      const sumRows = (sumResult.rows ?? sumResult) as Array<{ paid: number | string }>;

      // Decimal.js comparison so summing many payments cannot drift past
      // the invoice total via binary-float error and silently overpay.
      const totalD = new Decimal(lockedInvoice.total);
      const previouslyPaidD = new Decimal(sumRows[0]?.paid ?? 0);
      const amountD = new Decimal(input.amount);
      const remainingD = totalD.minus(previouslyPaidD);

      // 0.005 fils tolerance for legitimate 2dp rounding.
      if (amountD.greaterThan(remainingD.plus('0.005'))) {
        const e: any = new Error(
          `Payment ${amountD.toFixed(2)} exceeds remaining balance ${remainingD.toFixed(2)}`,
        );
        e.code = 'OVERPAYMENT';
        throw e;
      }

      // Generate JE number — uses session advisory lock so concurrent calls
      // serialise. The session is the same as this transaction's connection,
      // so the lock will be released at commit.
      const dateStr = input.date.toISOString().slice(0, 10).replace(/-/g, '');
      const prefix = `JE-${dateStr}`;
      const lockKey1 = hashStringToInt(input.companyId);
      const lockKey2 = hashStringToInt(prefix);
      await tx.execute(sql`SELECT pg_advisory_xact_lock(${lockKey1}, ${lockKey2})`);
      const counterStart = prefix.length + 2;
      const numResult: any = await tx.execute(sql`
        SELECT COALESCE(
          MAX(CAST(SUBSTRING(entry_number FROM ${counterStart}) AS INTEGER)),
          0
        ) AS max_seq
        FROM journal_entries
        WHERE company_id = ${input.companyId}
          AND entry_number LIKE ${prefix + '-%'}
      `);
      const numRows = (numResult.rows ?? numResult) as Array<{ max_seq: number | string | null }>;
      const nextNumber = Number(numRows[0]?.max_seq ?? 0) + 1;
      const entryNumber = `${prefix}-${String(nextNumber).padStart(3, '0')}`;

      // Insert journal entry + balanced lines.
      const [entry] = await tx
        .insert(journalEntries)
        .values({
          companyId: input.companyId,
          date: input.date,
          memo: `Payment received for Invoice ${input.invoiceId} - ${input.method}`,
          entryNumber,
          status: 'posted',
          source: 'payment',
          sourceId: input.invoiceId,
          createdBy: input.createdBy,
          postedBy: input.createdBy,
          postedAt: input.date,
        })
        .returning();
      await tx.insert(journalLines).values({
        entryId: entry.id,
        accountId: input.paymentAccountId,
        debit: input.amount,
        credit: 0,
        description: `Payment received - Invoice ${input.invoiceId}`,
      });
      await tx.insert(journalLines).values({
        entryId: entry.id,
        accountId: input.receivableAccountId,
        debit: 0,
        credit: input.amount,
        description: `Clear A/R - Invoice ${input.invoiceId}`,
      });

      // Record the payment row.
      const [payment] = await tx
        .insert(invoicePayments)
        .values({
          invoiceId: input.invoiceId,
          companyId: input.companyId,
          amount: input.amount,
          date: input.date,
          method: input.method,
          reference: input.reference,
          notes: input.notes,
          paymentAccountId: input.paymentAccountId,
          journalEntryId: entry.id,
          createdBy: input.createdBy,
        })
        .returning();

      // Recompute status from the canonical paid total (post-insert).
      const newTotalPaid = previouslyPaidD.plus(amountD).toNumber();
      const newStatus = statusFromPayments(
        lockedInvoice.status as InvoiceStatus,
        Number(lockedInvoice.total),
        newTotalPaid,
      );
      const [updatedInvoice] = await tx
        .update(invoices)
        .set({ status: newStatus })
        .where(eq(invoices.id, input.invoiceId))
        .returning();

      // When the invoice transitions to fully paid, stamp paidAt on every
      // open chase row for it. This is what makes the chase effectiveness
      // dashboard work — without it, conversionRate is permanently 0.
      // Done inside the same txn so a payment write can't leave chase
      // analytics inconsistent with invoice state.
      if (newStatus === 'paid') {
        await tx
          .update(paymentChases)
          .set({ paidAt: input.date })
          .where(and(
            eq(paymentChases.invoiceId, input.invoiceId),
            isNull(paymentChases.paidAt),
          ));
      }

      return {
        payment,
        invoice: updatedInvoice,
        journalEntryId: entry.id,
        totalPaid: newTotalPaid,
      };
    });
  }

  async safeDeleteInvoice(id: string): Promise<void> {
    await db.transaction(async (tx: typeof db) => {
      // Read invoice for company scope
      const [inv] = await tx.select().from(invoices).where(eq(invoices.id, id));
      if (!inv) {
        const e: any = new Error('Invoice not found');
        e.code = 'INVOICE_NOT_FOUND';
        throw e;
      }

      // Find associated journal entries (any source — invoice or payment).
      const associatedEntries = await tx
        .select()
        .from(journalEntries)
        .where(
          and(
            eq(journalEntries.companyId, inv.companyId),
            eq(journalEntries.sourceId, id),
          ),
        );

      // Refuse if any are posted — caller must void instead.
      const posted = associatedEntries.filter((e: any) => e.status === 'posted');
      if (posted.length > 0) {
        const err: any = new Error(
          'Cannot delete invoice with posted journal entries. Void the invoice instead.',
        );
        err.code = 'INVOICE_HAS_POSTED_JE';
        throw err;
      }

      // Order matters: invoice_payments references journal_entries, and
      // invoices cascades to invoice_payments. Drop the invoice first so
      // payment rows are gone before we drop the JEs they referenced.
      await tx.delete(invoices).where(eq(invoices.id, id));
      for (const e of associatedEntries) {
        await tx.delete(journalEntries).where(eq(journalEntries.id, e.id));
      }
    });
  }

  async getInvoicePaidTotal(invoiceId: string): Promise<number> {
    const payments = await db
      .select()
      .from(invoicePayments)
      .where(eq(invoicePayments.invoiceId, invoiceId));
    return payments.reduce((sum: number, p: InvoicePayment) => sum + p.amount, 0);
  }

  async getDueInvoicesForRecurring(): Promise<Invoice[]> {
    return await db
      .select()
      .from(invoices)
      .where(
        and(
          eq(invoices.isRecurring, true),
          lte(invoices.nextRecurringDate, new Date())
        )
      );
  }

  // Products / Inventory
  async getProductsByCompanyId(companyId: string): Promise<Product[]> {
    return await db
      .select()
      .from(products)
      .where(eq(products.companyId, companyId))
      .orderBy(desc(products.createdAt));
  }

  async getProduct(id: string): Promise<Product | undefined> {
    const [product] = await db.select().from(products).where(eq(products.id, id));
    return product || undefined;
  }

  async createProduct(data: InsertProduct): Promise<Product> {
    const [product] = await db
      .insert(products)
      .values(data)
      .returning();
    return product;
  }

  async updateProduct(id: string, data: Partial<Product>): Promise<Product> {
    const [product] = await db
      .update(products)
      .set(data)
      .where(eq(products.id, id))
      .returning();
    if (!product) {
      throw new Error('Product not found');
    }
    return product;
  }

  async deleteProduct(id: string): Promise<void> {
    await db.delete(products).where(eq(products.id, id));
  }

  // Inventory Movements
  async getInventoryMovementsByProductId(productId: string): Promise<InventoryMovement[]> {
    return await db
      .select()
      .from(inventoryMovements)
      .where(eq(inventoryMovements.productId, productId))
      .orderBy(desc(inventoryMovements.createdAt));
  }

  async getInventoryMovementsByCompanyId(companyId: string): Promise<InventoryMovement[]> {
    return await db
      .select()
      .from(inventoryMovements)
      .where(eq(inventoryMovements.companyId, companyId))
      .orderBy(desc(inventoryMovements.createdAt));
  }

  async createInventoryMovement(data: InsertInventoryMovement): Promise<InventoryMovement> {
    const [movement] = await db
      .insert(inventoryMovements)
      .values(data)
      .returning();
    return movement;
  }

  // ─── Payment Chasing (Phase 4) ─────────────────────────────────────────────

  async createPaymentChase(data: InsertPaymentChase): Promise<PaymentChase> {
    const [row] = await db.insert(paymentChases).values(data).returning();
    return row;
  }

  async getPaymentChasesByCompanyId(
    companyId: string,
    opts: { invoiceId?: string; sinceDays?: number } = {},
  ): Promise<PaymentChase[]> {
    const conds = [eq(paymentChases.companyId, companyId)];
    if (opts.invoiceId) conds.push(eq(paymentChases.invoiceId, opts.invoiceId));
    if (opts.sinceDays && opts.sinceDays > 0) {
      const cutoff = new Date(Date.now() - opts.sinceDays * 86_400_000);
      conds.push(gte(paymentChases.sentAt, cutoff));
    }
    return await db
      .select()
      .from(paymentChases)
      .where(and(...conds))
      .orderBy(desc(paymentChases.sentAt));
  }

  async getPaymentChasesByInvoiceId(invoiceId: string): Promise<PaymentChase[]> {
    return await db
      .select()
      .from(paymentChases)
      .where(eq(paymentChases.invoiceId, invoiceId))
      .orderBy(desc(paymentChases.sentAt));
  }

  async tryClaimChaseSlot(
    invoiceId: string,
    level: number,
    now: Date,
    minSecondsBetween: number,
  ): Promise<boolean> {
    const cutoff = new Date(now.getTime() - Math.max(0, minSecondsBetween) * 1000);
    const claimed = await db
      .update(invoices)
      .set({ chaseLevel: level, lastChasedAt: now })
      .where(and(
        eq(invoices.id, invoiceId),
        or(isNull(invoices.lastChasedAt), lt(invoices.lastChasedAt, cutoff)),
      ))
      .returning({ id: invoices.id });
    return claimed.length > 0;
  }

  async setInvoiceDoNotChase(invoiceId: string, value: boolean): Promise<void> {
    await db.update(invoices).set({ doNotChase: value }).where(eq(invoices.id, invoiceId));
  }

  async getChaseTemplatesForCompany(companyId: string): Promise<ChaseTemplate[]> {
    return await db
      .select()
      .from(chaseTemplates)
      .where(or(eq(chaseTemplates.companyId, companyId), isNull(chaseTemplates.companyId)))
      .orderBy(chaseTemplates.level, chaseTemplates.language);
  }

  async getChaseTemplate(
    level: number,
    language: string,
    companyId: string | null,
  ): Promise<ChaseTemplate | undefined> {
    // Prefer company override, fall back to system default.
    if (companyId) {
      const [override] = await db
        .select()
        .from(chaseTemplates)
        .where(and(
          eq(chaseTemplates.companyId, companyId),
          eq(chaseTemplates.level, level),
          eq(chaseTemplates.language, language),
        ))
        .limit(1);
      if (override) return override;
    }
    const [system] = await db
      .select()
      .from(chaseTemplates)
      .where(and(
        isNull(chaseTemplates.companyId),
        eq(chaseTemplates.level, level),
        eq(chaseTemplates.language, language),
      ))
      .limit(1);
    return system || undefined;
  }

  async createChaseTemplate(data: InsertChaseTemplate): Promise<ChaseTemplate> {
    const [row] = await db.insert(chaseTemplates).values(data).returning();
    return row;
  }

  async updateChaseTemplate(
    id: string,
    companyId: string,
    data: Partial<InsertChaseTemplate>,
  ): Promise<ChaseTemplate | undefined> {
    // Scoped by companyId to prevent cross-tenant edits and keep system
    // defaults (company_id IS NULL) immutable from the customer-facing API.
    const [row] = await db
      .update(chaseTemplates)
      .set({ ...data, updatedAt: new Date() })
      .where(and(eq(chaseTemplates.id, id), eq(chaseTemplates.companyId, companyId)))
      .returning();
    return row || undefined;
  }

  async deleteChaseTemplate(id: string, companyId: string): Promise<boolean> {
    const rows = await db
      .delete(chaseTemplates)
      .where(and(eq(chaseTemplates.id, id), eq(chaseTemplates.companyId, companyId)))
      .returning({ id: chaseTemplates.id });
    return rows.length > 0;
  }

  async getChaseConfig(companyId: string): Promise<ChaseConfig | undefined> {
    const [row] = await db
      .select()
      .from(chaseConfigs)
      .where(eq(chaseConfigs.companyId, companyId))
      .limit(1);
    return row || undefined;
  }

  async upsertChaseConfig(companyId: string, data: Partial<InsertChaseConfig>): Promise<ChaseConfig> {
    const existing = await this.getChaseConfig(companyId);
    if (existing) {
      const [row] = await db
        .update(chaseConfigs)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(chaseConfigs.companyId, companyId))
        .returning();
      return row;
    }
    const [row] = await db
      .insert(chaseConfigs)
      .values({ companyId, ...data } as InsertChaseConfig)
      .returning();
    return row;
  }
}

export const storage = new DatabaseStorage();
