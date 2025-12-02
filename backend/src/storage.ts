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
  Backup, InsertBackup
} from "../shared/schema.js";
import {
  users,
  companies,
  companyUsers,
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
  backups
} from "../shared/schema.js";
import { db } from "./db.js";
import { eq, and, desc } from "drizzle-orm";

// Relaxed input types to bypass drizzle-zod inference issues
type RelaxedInsert<T> = Partial<T> & Record<string, any>;

export interface IStorage {
  // Users
  getUser(id: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  createUser(user: RelaxedInsert<InsertUser>): Promise<User>;
  
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
  hasCompanyAccess(userId: string, companyId: string): Promise<boolean>;
  
  // Accounts
  getAccount(id: string): Promise<Account | undefined>;
  getAccountsByCompanyId(companyId: string): Promise<Account[]>;
  createAccount(account: InsertAccount): Promise<Account>;
  updateAccount(id: string, data: Partial<InsertAccount>): Promise<Account>;
  deleteAccount(id: string): Promise<void>;
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
  getJournalEntry(id: string): Promise<JournalEntry | undefined>;
  getJournalEntriesByCompanyId(companyId: string): Promise<JournalEntry[]>;
  createJournalEntry(entry: any): Promise<JournalEntry>;
  updateJournalEntry(id: string, data: any): Promise<JournalEntry>;
  deleteJournalEntry(id: string): Promise<void>;
  generateEntryNumber(companyId: string, date: Date): Promise<string>;
  
  // Journal Lines
  createJournalLine(line: any): Promise<JournalLine>;
  getJournalLinesByEntryId(entryId: string): Promise<JournalLine[]>;
  deleteJournalLinesByEntryId(entryId: string): Promise<void>;
  
  // Invoices
  getInvoice(id: string): Promise<Invoice | undefined>;
  getInvoicesByCompanyId(companyId: string): Promise<Invoice[]>;
  createInvoice(invoice: InsertInvoice): Promise<Invoice>;
  updateInvoice(id: string, data: Partial<InsertInvoice>): Promise<Invoice>;
  updateInvoiceStatus(id: string, status: string): Promise<Invoice>;
  deleteInvoice(id: string): Promise<void>;
  
  // Invoice Lines
  createInvoiceLine(line: InsertInvoiceLine): Promise<InvoiceLine>;
  getInvoiceLinesByInvoiceId(invoiceId: string): Promise<InvoiceLine[]>;
  deleteInvoiceLinesByInvoiceId(invoiceId: string): Promise<void>;
  
  // Receipts
  getReceipt(id: string): Promise<Receipt | undefined>;
  createReceipt(receipt: any): Promise<Receipt>;
  getReceiptsByCompanyId(companyId: string): Promise<Receipt[]>;
  updateReceipt(id: string, data: any): Promise<Receipt>;
  deleteReceipt(id: string): Promise<void>;
  
  // Customer Contacts
  getCustomerContact(id: string): Promise<CustomerContact | undefined>;
  getCustomerContactsByCompanyId(companyId: string): Promise<CustomerContact[]>;
  getCustomerContactByEmail(companyId: string, email: string): Promise<CustomerContact | undefined>;
  getCustomerContactByTrn(companyId: string, trn: string): Promise<CustomerContact | undefined>;
  createCustomerContact(contact: any): Promise<CustomerContact>;
  createBulkCustomerContacts(contacts: any[]): Promise<CustomerContact[]>;
  updateCustomerContact(id: string, data: any): Promise<CustomerContact>;
  deleteCustomerContact(id: string): Promise<void>;
  
  // Waitlist
  createWaitlistEntry(entry: InsertWaitlist): Promise<Waitlist>;
  getWaitlistByEmail(email: string): Promise<Waitlist | undefined>;
  
  // Integration Syncs
  createIntegrationSync(sync: InsertIntegrationSync): Promise<IntegrationSync>;
  getIntegrationSyncsByCompanyId(companyId: string): Promise<IntegrationSync[]>;
  getIntegrationSyncsByType(companyId: string, integrationType: string): Promise<IntegrationSync[]>;

  // WhatsApp Configuration
  getWhatsappConfig(companyId: string): Promise<WhatsappConfig | undefined>;
  createWhatsappConfig(config: InsertWhatsappConfig): Promise<WhatsappConfig>;
  updateWhatsappConfig(id: string, data: Partial<InsertWhatsappConfig>): Promise<WhatsappConfig>;

  // WhatsApp Messages
  createWhatsappMessage(message: InsertWhatsappMessage): Promise<WhatsappMessage>;
  getWhatsappMessagesByCompanyId(companyId: string): Promise<WhatsappMessage[]>;
  updateWhatsappMessage(id: string, data: Partial<InsertWhatsappMessage>): Promise<WhatsappMessage>;

  // AI Anomaly Alerts
  createAnomalyAlert(alert: InsertAnomalyAlert): Promise<AnomalyAlert>;
  getAnomalyAlertById(id: string): Promise<AnomalyAlert | undefined>;
  getAnomalyAlertsByCompanyId(companyId: string): Promise<AnomalyAlert[]>;
  getUnresolvedAnomalyAlerts(companyId: string): Promise<AnomalyAlert[]>;
  updateAnomalyAlert(id: string, data: Partial<InsertAnomalyAlert>): Promise<AnomalyAlert>;
  resolveAnomalyAlert(id: string, userId: string, note?: string): Promise<AnomalyAlert>;

  // Bank Transactions
  createBankTransaction(transaction: InsertBankTransaction): Promise<BankTransaction>;
  getBankTransactionById(id: string): Promise<BankTransaction | undefined>;
  getBankTransactionsByCompanyId(companyId: string): Promise<BankTransaction[]>;
  getUnreconciledBankTransactions(companyId: string): Promise<BankTransaction[]>;
  updateBankTransaction(id: string, data: Partial<InsertBankTransaction>): Promise<BankTransaction>;
  reconcileBankTransaction(id: string, matchedId: string, matchType: 'journal' | 'receipt' | 'invoice'): Promise<BankTransaction>;

  // Cash Flow Forecasts
  createCashFlowForecast(forecast: InsertCashFlowForecast): Promise<CashFlowForecast>;
  getCashFlowForecastsByCompanyId(companyId: string): Promise<CashFlowForecast[]>;
  deleteCashFlowForecastsByCompanyId(companyId: string): Promise<void>;

  // Transaction Classifications
  createTransactionClassification(classification: InsertTransactionClassification): Promise<TransactionClassification>;
  getTransactionClassificationsByCompanyId(companyId: string): Promise<TransactionClassification[]>;
  updateTransactionClassification(id: string, data: Partial<InsertTransactionClassification>): Promise<TransactionClassification>;

  // Journal Lines (for analytics)
  getJournalLinesByCompanyId(companyId: string): Promise<JournalLine[]>;

  // Budgets
  getBudgetsByCompanyId(companyId: string, year: number, month: number): Promise<Budget[]>;
  createBudget(budget: InsertBudget): Promise<Budget>;
  updateBudget(id: string, data: Partial<InsertBudget>): Promise<Budget>;

  // E-Commerce Integrations
  getEcommerceIntegrations(companyId: string): Promise<EcommerceIntegration[]>;
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

  // Companies
  async getCompany(id: string): Promise<Company | undefined> {
    const [company] = await db.select().from(companies).where(eq(companies.id, id));
    return company || undefined;
  }

  async getCompanyByName(name: string): Promise<Company | undefined> {
    const [company] = await db.select().from(companies).where(eq(companies.name, name));
    return company || undefined;
  }

  async getCompaniesByUserId(userId: string): Promise<Company[]> {
    const results = await db
      .select()
      .from(companies)
      .innerJoin(companyUsers, eq(companies.id, companyUsers.companyId))
      .where(eq(companyUsers.userId, userId));
    
    return results.map(r => r.companies);
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

  async hasCompanyAccess(userId: string, companyId: string): Promise<boolean> {
    const result = await this.getUserRole(companyId, userId);
    return !!result;
  }

  async getCompanyUsersByCompanyId(companyId: string): Promise<CompanyUser[]> {
    return await db.select().from(companyUsers).where(eq(companyUsers.companyId, companyId));
  }

  // Accounts
  async getAccount(id: string): Promise<Account | undefined> {
    const [account] = await db.select().from(accounts).where(eq(accounts.id, id));
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

  async updateAccount(id: string, data: Partial<InsertAccount>): Promise<Account> {
    const [account] = await db
      .update(accounts)
      .set(data)
      .where(eq(accounts.id, id))
      .returning();
    if (!account) {
      throw new Error('Account not found');
    }
    return account;
  }

  async deleteAccount(id: string): Promise<void> {
    await db.delete(accounts).where(eq(accounts.id, id));
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
    const createdAccounts = await db.transaction(async (tx) => {
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
    
    const results = await Promise.all(accountsList.map(async (account) => {
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
        lines = lines.filter(line => {
          const lineDate = new Date(line.date);
          return lineDate >= dateRange.start && lineDate <= dateRange.end;
        });
      }
      
      const postedLines = lines.filter(l => l.status === 'posted');
      
      const debitTotal = postedLines.reduce((sum, l) => sum + (l.debit || 0), 0);
      const creditTotal = postedLines.reduce((sum, l) => sum + (l.credit || 0), 0);
      
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
    const account = await this.getAccount(accountId);
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
    
    const postedLines = allLines.filter(l => l.status === 'posted');
    postedLines.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    
    let openingBalance = 0;
    if (options?.dateStart) {
      const priorLines = postedLines.filter(l => new Date(l.date) < options.dateStart!);
      const priorDebit = priorLines.reduce((sum, l) => sum + (l.debit || 0), 0);
      const priorCredit = priorLines.reduce((sum, l) => sum + (l.credit || 0), 0);
      
      if (['asset', 'expense'].includes(account.type)) {
        openingBalance = priorDebit - priorCredit;
      } else {
        openingBalance = priorCredit - priorDebit;
      }
    }
    
    let filteredLines = postedLines;
    if (options?.dateStart) {
      filteredLines = filteredLines.filter(l => new Date(l.date) >= options.dateStart!);
    }
    if (options?.dateEnd) {
      filteredLines = filteredLines.filter(l => new Date(l.date) <= options.dateEnd!);
    }
    
    if (options?.search) {
      const searchLower = options.search.toLowerCase();
      filteredLines = filteredLines.filter(l => 
        l.entryNumber?.toLowerCase().includes(searchLower) ||
        l.memo?.toLowerCase().includes(searchLower) ||
        l.lineDescription?.toLowerCase().includes(searchLower)
      );
    }
    
    let runningBalance = openingBalance;
    let totalDebit = 0;
    let totalCredit = 0;
    
    const allEntries = filteredLines.map(line => {
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
  async getJournalEntry(id: string): Promise<JournalEntry | undefined> {
    const results = await db.select().from(journalEntries).where(eq(journalEntries.id, id));
    return (results[0] as JournalEntry) || undefined;
  }

  async getJournalEntriesByCompanyId(companyId: string): Promise<JournalEntry[]> {
    const results = await db
      .select()
      .from(journalEntries)
      .where(eq(journalEntries.companyId, companyId))
      .orderBy(desc(journalEntries.date));
    return results as JournalEntry[];
  }

  async createJournalEntry(insertEntry: any): Promise<JournalEntry> {
    const results = await db
      .insert(journalEntries)
      .values(insertEntry)
      .returning() as JournalEntry[];
    return results[0];
  }

  async updateJournalEntry(id: string, data: any): Promise<JournalEntry> {
    const results = await db
      .update(journalEntries)
      .set(data)
      .where(eq(journalEntries.id, id))
      .returning();
    if (!results[0]) {
      throw new Error('Journal entry not found');
    }
    return results[0] as JournalEntry;
  }

  async deleteJournalEntry(id: string): Promise<void> {
    await db.delete(journalEntries).where(eq(journalEntries.id, id));
  }

  async generateEntryNumber(companyId: string, date: Date): Promise<string> {
    const dateStr = date.toISOString().slice(0, 10).replace(/-/g, '');
    const prefix = `JE-${dateStr}`;
    
    // Get count of entries for this company and date prefix using SQL for atomicity
    const allEntries = await db
      .select()
      .from(journalEntries)
      .where(eq(journalEntries.companyId, companyId));
    
    // Filter entries that match this date prefix
    const todayEntries = allEntries.filter(e => 
      e.entryNumber?.startsWith(prefix)
    );
    
    const nextNumber = todayEntries.length + 1;
    return `${prefix}-${String(nextNumber).padStart(3, '0')}`;
  }

  // Journal Lines
  async createJournalLine(insertLine: any): Promise<JournalLine> {
    const [line] = await db
      .insert(journalLines)
      .values(insertLine)
      .returning();
    return line;
  }

  async getJournalLinesByEntryId(entryId: string): Promise<JournalLine[]> {
    return await db.select().from(journalLines).where(eq(journalLines.entryId, entryId));
  }

  async deleteJournalLinesByEntryId(entryId: string): Promise<void> {
    await db.delete(journalLines).where(eq(journalLines.entryId, entryId));
  }

  // Invoices
  async getInvoice(id: string): Promise<Invoice | undefined> {
    const [invoice] = await db.select().from(invoices).where(eq(invoices.id, id));
    return invoice || undefined;
  }

  async getInvoicesByCompanyId(companyId: string): Promise<Invoice[]> {
    return await db
      .select()
      .from(invoices)
      .where(eq(invoices.companyId, companyId))
      .orderBy(desc(invoices.date));
  }

  async createInvoice(insertInvoice: InsertInvoice): Promise<Invoice> {
    const [invoice] = await db
      .insert(invoices)
      .values(insertInvoice)
      .returning();
    return invoice;
  }

  async updateInvoice(id: string, data: Partial<InsertInvoice>): Promise<Invoice> {
    const [invoice] = await db
      .update(invoices)
      .set(data)
      .where(eq(invoices.id, id))
      .returning();
    if (!invoice) {
      throw new Error('Invoice not found');
    }
    return invoice;
  }

  async updateInvoiceStatus(id: string, status: string): Promise<Invoice> {
    const [invoice] = await db
      .update(invoices)
      .set({ status })
      .where(eq(invoices.id, id))
      .returning();
    
    if (!invoice) {
      throw new Error('Invoice not found');
    }
    
    return invoice;
  }

  async deleteInvoice(id: string): Promise<void> {
    await db.delete(invoices).where(eq(invoices.id, id));
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

  async deleteInvoiceLinesByInvoiceId(invoiceId: string): Promise<void> {
    await db.delete(invoiceLines).where(eq(invoiceLines.invoiceId, invoiceId));
  }

  // Receipts
  async getReceipt(id: string): Promise<Receipt | undefined> {
    const [receipt] = await db.select().from(receipts).where(eq(receipts.id, id));
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

  async updateReceipt(id: string, data: Partial<InsertReceipt>): Promise<Receipt> {
    const [receipt] = await db
      .update(receipts)
      .set(data)
      .where(eq(receipts.id, id))
      .returning();
    if (!receipt) {
      throw new Error('Receipt not found');
    }
    return receipt;
  }

  async deleteReceipt(id: string): Promise<void> {
    await db.delete(receipts).where(eq(receipts.id, id));
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

  // Bank Transactions
  async createBankTransaction(insertTransaction: InsertBankTransaction): Promise<BankTransaction> {
    const [transaction] = await db
      .insert(bankTransactions)
      .values(insertTransaction)
      .returning();
    return transaction;
  }

  async getBankTransactionById(id: string): Promise<BankTransaction | undefined> {
    const [transaction] = await db
      .select()
      .from(bankTransactions)
      .where(eq(bankTransactions.id, id));
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

  async updateBankTransaction(id: string, data: Partial<InsertBankTransaction>): Promise<BankTransaction> {
    const [transaction] = await db
      .update(bankTransactions)
      .set(data)
      .where(eq(bankTransactions.id, id))
      .returning();
    if (!transaction) {
      throw new Error('Bank transaction not found');
    }
    return transaction;
  }

  async reconcileBankTransaction(id: string, matchedId: string, matchType: 'journal' | 'receipt' | 'invoice'): Promise<BankTransaction> {
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

  async getTransactionClassificationsByCompanyId(companyId: string): Promise<TransactionClassification[]> {
    return await db
      .select()
      .from(transactionClassifications)
      .where(eq(transactionClassifications.companyId, companyId))
      .orderBy(desc(transactionClassifications.createdAt));
  }

  async updateTransactionClassification(id: string, data: Partial<InsertTransactionClassification>): Promise<TransactionClassification> {
    const [classification] = await db
      .update(transactionClassifications)
      .set(data)
      .where(eq(transactionClassifications.id, id))
      .returning();
    if (!classification) {
      throw new Error('Transaction classification not found');
    }
    return classification;
  }

  // Journal Lines (for analytics)
  async getJournalLinesByCompanyId(companyId: string): Promise<JournalLine[]> {
    const results = await db
      .select()
      .from(journalLines)
      .innerJoin(journalEntries, eq(journalLines.entryId, journalEntries.id))
      .where(eq(journalEntries.companyId, companyId));
    return results.map(r => r.journal_lines) as JournalLine[];
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

  async updateBudget(id: string, data: Partial<InsertBudget>): Promise<Budget> {
    const [budget] = await db
      .update(budgets)
      .set(data)
      .where(eq(budgets.id, id))
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
    
    return results.map(r => r.ecommerceTransactions);
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
    return await db.select().from(companies).orderBy(desc(companies.createdAt));
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
    
    return results.map(r => ({
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
    await db.delete(companies).where(eq(companies.id, id));
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
      .where(eq(companies.companyType, 'client'))
      .orderBy(desc(companies.createdAt));
  }

  async getCustomerCompanies(): Promise<Company[]> {
    return await db
      .select()
      .from(companies)
      .where(eq(companies.companyType, 'customer'))
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
}

export const storage = new DatabaseStorage();
