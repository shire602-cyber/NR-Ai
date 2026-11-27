// Storage interface (IStorage) and the argument/result types it uses.
// Part of server/storage.ts (split per domain, R20-09); import from "./storage".

import type {
  Account,
  ActivityLog,
  AdminSetting,
  AiConversation,
  AnalyticsEvent,
  AnomalyAlert,
  AuditLog,
  Backup,
  BankAccount,
  BankTransaction,
  Budget,
  CashFlowForecast,
  ChaseConfig,
  ChaseTemplate,
  ClientNote,
  Company,
  CompanyReportAutomationPreference,
  CompanyReportDeliveryRun,
  CompanyReportDeliverySchedulerScan,
  CompanyReportDeliverySubscription,
  CompanyUser,
  ComplianceTask,
  CorporateTaxReturn,
  CustomerContact,
  Document,
  EcommerceIntegration,
  EcommerceTransaction,
  Engagement,
  FeatureUsageMetric,
  FinancialKpi,
  FtaEmail,
  HelpTip,
  InsertAccount,
  InsertActivityLog,
  InsertAdminSetting,
  InsertAiConversation,
  InsertAnalyticsEvent,
  InsertAnomalyAlert,
  InsertAuditLog,
  InsertBackup,
  InsertBankAccount,
  InsertBankTransaction,
  InsertBudget,
  InsertCashFlowForecast,
  InsertChaseConfig,
  InsertChaseTemplate,
  InsertClientNote,
  InsertCompany,
  InsertCompanyReportAutomationPreference,
  InsertCompanyReportDeliveryRun,
  InsertCompanyReportDeliverySchedulerScan,
  InsertCompanyReportDeliverySubscription,
  InsertCompanyUser,
  InsertComplianceTask,
  InsertCorporateTaxReturn,
  InsertCustomerContact,
  InsertDocument,
  InsertEcommerceIntegration,
  InsertEcommerceTransaction,
  InsertEngagement,
  InsertFeatureUsageMetric,
  InsertFinancialKpi,
  InsertFtaEmail,
  InsertHelpTip,
  InsertIntegrationSync,
  InsertInvitation,
  InsertInvoice,
  InsertInvoiceLine,
  InsertJournalEntry,
  InsertJournalLine,
  InsertMessage,
  InsertNewsItem,
  InsertNotification,
  InsertPaymentChase,
  InsertProduct,
  InsertReceipt,
  InsertRecurringInvoice,
  InsertReferral,
  InsertReferralCode,
  InsertRegulatoryNews,
  InsertReminderLog,
  InsertReminderSetting,
  InsertServiceInvoice,
  InsertServiceInvoiceLine,
  InsertSubscription,
  InsertTaxReturnArchive,
  InsertTransactionClassification,
  InsertUser,
  InsertUserFeedback,
  InsertUserOnboarding,
  InsertVatReturn,
  InsertWaitlist,
  InsertWhatsappConfig,
  InsertWhatsappMessage,
  IntegrationSync,
  InventoryMovement,
  Invitation,
  Invoice,
  InvoiceLine,
  InvoicePayment,
  JournalEntry,
  JournalLine,
  Message,
  NewsItem,
  Notification,
  PaymentChase,
  Product,
  Receipt,
  RecurringInvoice,
  Referral,
  ReferralCode,
  RegulatoryNews,
  ReminderLog,
  ReminderSetting,
  ServiceInvoice,
  ServiceInvoiceLine,
  Subscription,
  TaxReturnArchive,
  TransactionClassification,
  User,
  UserFeedback,
  UserOnboarding,
  VatReturn,
  Waitlist,
  WhatsappConfig,
  WhatsappMessage,
} from "@shared/schema";
import type { AppDatabase, db } from "../db";
import type { FirmContext } from "../services/firm/scope";

export type JournalLineInsert = Omit<InsertJournalLine, "entryId">;

export interface PostReceiptAtomicArgs {
  exchangeRate?: number;
  exchangeRateSource?: "manual" | "lookup" | null;
  baseCurrencyAmount?: number;
  receiptId: string;
  companyId: string;
  userId: string;
  accountId: string | null;
  paymentAccountId: string;
  entryDate: Date;
  memo: string;
  memoKey?: string | null;
  memoParams?: Record<string, string> | null;
  lines: JournalLineInsert[];
}

export interface ReviseReceiptAtomicArgs {
  expectedEntryId: string | null;
  receiptId: string;
  companyId: string;
  userId: string;
  /** Receipt columns to change as part of the revision (already validated). */
  patch: Partial<InsertReceipt>;
  /** Reversal date; null = the ledger default (original date if its period is open, else today). */
  reversalDate?: Date | null;
  reason: string | null;
  entryDate: Date;
  memo: string;
  memoKey?: string | null;
  memoParams?: Record<string, string> | null;
  /** Builds the new journal lines from the receipt as it will be after `patch`. */
  buildLines: (updated: Receipt) => JournalLineInsert[];
}

export interface SplitReceiptAtomicArgs {
  receiptId: string;
  companyId: string;
  parts: Array<Partial<InsertReceipt>>;
}

export type InvoiceSummary = Pick<
  Invoice,
  | "id"
  | "companyId"
  | "number"
  | "customerName"
  | "customerTrn"
  | "date"
  | "dueDate"
  | "paymentTerms"
  | "currency"
  | "exchangeRate"
  | "baseCurrencyAmount"
  | "subtotal"
  | "vatAmount"
  | "total"
  | "status"
  | "shareToken"
  | "shareTokenExpiresAt"
  | "einvoiceUuid"
  | "einvoiceStatus"
  | "reminderCount"
  | "lastReminderSentAt"
  | "invoiceType"
  | "originalInvoiceId"
  | "legacyCreditNoteId"
  | "isRecurring"
  | "recurringInterval"
  | "nextRecurringDate"
  | "recurringEndDate"
  | "contactId"
  | "createdAt"
>;

/** A new user: the register payload, or an already-hashed password (invites, admin). */
/** Public projection of a member's user row (never password_hash / token_version / MFA). */
export interface CompanyMemberUser {
  id: string;
  email: string;
  name: string;
  userType: string;
  avatarUrl: string | null;
  emailVerified: boolean;
  lastLoginAt: Date | null;
  createdAt: Date;
}
export type CompanyMemberWithUser = CompanyUser & { user: CompanyMemberUser };

export type NewUserInput = Omit<InsertUser, "password"> & {
  password?: string;
  passwordHash?: string;
};

export interface IStorage {
  // Users
  getUser(id: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  createUser(user: NewUserInput): Promise<User>;
  updateUserPassword(userId: string, passwordHash: string): Promise<void>;

  // Password reset tokens
  replacePasswordResetToken(input: {
    userId: string;
    email: string;
    tokenHash: string;
    expiresAt: Date;
  }): Promise<boolean>;
  findValidPasswordResetToken(
    tokenHash: string
  ): Promise<{ id: string; userId: string } | undefined>;
  resetPasswordWithToken(userId: string, tokenHash: string, passwordHash: string): Promise<boolean>;

  // Companies
  getCompany(id: string): Promise<Company | undefined>;
  getCompanyByName(name: string): Promise<Company | undefined>;
  ownerHasCompanyNamed(userId: string, name: string, excludeCompanyId?: string): Promise<boolean>;
  companyHasPostedJournal(companyId: string): Promise<boolean>;
  getCompaniesByUserId(userId: string): Promise<Company[]>;
  createCompany(company: InsertCompany, conn?: Pick<AppDatabase, "insert">): Promise<Company>;
  updateCompany(id: string, data: Partial<InsertCompany>): Promise<Company>;

  // Company Users
  createCompanyUser(companyUser: InsertCompanyUser): Promise<CompanyUser>;
  getUserRole(companyId: string, userId: string): Promise<CompanyUser | undefined>;
  resolveCompanyActorUserId(companyId: string): Promise<string | null>;
  getCompanyUsersByCompanyId(companyId: string): Promise<CompanyUser[]>;
  getReportAutomationPreferences(
    companyId: string,
    userId: string
  ): Promise<CompanyReportAutomationPreference[]>;
  getReportAutomationPreference(
    companyId: string,
    userId: string,
    persona: string
  ): Promise<CompanyReportAutomationPreference | undefined>;
  upsertReportAutomationPreference(
    preference: InsertCompanyReportAutomationPreference
  ): Promise<CompanyReportAutomationPreference>;
  getReportDeliverySubscriptionSettings(
    companyId: string
  ): Promise<CompanyReportDeliverySubscription[]>;
  getReportDeliverySubscriptionSetting(
    companyId: string,
    subscriptionId: string
  ): Promise<CompanyReportDeliverySubscription | undefined>;
  upsertReportDeliverySubscriptionSetting(
    setting: InsertCompanyReportDeliverySubscription
  ): Promise<CompanyReportDeliverySubscription>;
  getReportDeliveryRuns(
    companyId: string,
    options?: { subscriptionId?: string; limit?: number }
  ): Promise<CompanyReportDeliveryRun[]>;
  getReportDeliveryRun(
    companyId: string,
    runId: string
  ): Promise<CompanyReportDeliveryRun | undefined>;
  createReportDeliveryRun(run: InsertCompanyReportDeliveryRun): Promise<CompanyReportDeliveryRun>;
  getReportDeliverySchedulerScans(
    companyId: string,
    options?: { limit?: number }
  ): Promise<CompanyReportDeliverySchedulerScan[]>;
  getLatestReportDeliverySchedulerScan(
    companyId: string
  ): Promise<CompanyReportDeliverySchedulerScan | undefined>;
  createReportDeliverySchedulerScan(
    scan: InsertCompanyReportDeliverySchedulerScan
  ): Promise<CompanyReportDeliverySchedulerScan>;
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
  getCompanyRolesByUserId(userId: string): Promise<Record<string, string>>;
  getAccessibleCompanies(
    userId: string,
    firmRole?: string | null,
    isAdmin?: boolean
  ): Promise<Company[]>;

  // Accounts
  getAccount(id: string, companyId: string): Promise<Account | undefined>;
  getAccountsByCompanyId(companyId: string): Promise<Account[]>;
  createAccount(account: InsertAccount): Promise<Account>;
  updateAccount(id: string, companyId: string, data: Partial<Account>): Promise<Account>;
  deleteAccount(id: string, companyId: string): Promise<void>;
  archiveAccountForCompany(id: string, companyId: string): Promise<Account>;
  accountHasTransactions(accountId: string): Promise<boolean>;

  // Account Ledger & Balance
  getAccountsWithBalances(
    companyId: string,
    dateRange?: { start: Date; end: Date }
  ): Promise<
    {
      account: Account;
      balance: number;
      debitTotal: number;
      creditTotal: number;
    }[]
  >;
  getAccountLedger(
    accountId: string,
    options?: {
      dateStart?: Date;
      dateEnd?: Date;
      search?: string;
      limit?: number;
      offset?: number;
    }
  ): Promise<{
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
  getJournalEntriesByCompanyId(
    companyId: string,
    opts?: { limit?: number; offset?: number; before?: { date: Date; id: string } }
  ): Promise<JournalEntry[]>;
  getPostedJournalEntriesWithLines(
    companyId: string
  ): Promise<Array<{ entry: JournalEntry; lines: JournalLine[] }>>;
  createJournalEntry(
    entry: InsertJournalEntry & { postedAt?: Date | null; updatedAt?: Date | null },
    lines: Array<Omit<InsertJournalLine, "entryId">>
  ): Promise<JournalEntry>;
  generateEntryNumber(companyId: string, date: Date): Promise<string>;

  // Journal Lines
  getJournalLinesByEntryId(entryId: string): Promise<JournalLine[]>;
  getJournalLinesByEntryIds(entryIds: string[]): Promise<JournalLine[]>;

  // Invoices
  getInvoice(id: string, companyId: string): Promise<Invoice | undefined>;
  getInvoicesByCompanyId(companyId: string): Promise<Invoice[]>;
  getInvoicesSummaryByCompanyId(
    companyId: string,
    opts?: { limit?: number; offset?: number }
  ): Promise<InvoiceSummary[]>;
  createInvoice(invoice: InsertInvoice, exec?: Pick<AppDatabase, "insert">): Promise<Invoice>;
  updateInvoice(id: string, companyId: string, data: Partial<InsertInvoice>): Promise<Invoice>;
  updateInvoiceStatus(id: string, companyId: string, status: string): Promise<Invoice>;
  deleteInvoice(id: string, companyId: string): Promise<void>;

  // Invoice Share Token
  getInvoiceByShareToken(token: string): Promise<Invoice | undefined>;
  ensureInvoiceShareToken(
    invoice: Pick<Invoice, "id" | "companyId" | "shareToken" | "shareTokenExpiresAt">
  ): Promise<string>;

  // Invoice Lines
  createInvoiceLine(line: InsertInvoiceLine): Promise<InvoiceLine>;
  getInvoiceLinesByInvoiceId(invoiceId: string): Promise<InvoiceLine[]>;
  getInvoiceLinesByInvoiceIds(invoiceIds: string[]): Promise<InvoiceLine[]>;
  deleteInvoiceLinesByInvoiceId(invoiceId: string): Promise<void>;

  // Receipts
  getReceipt(id: string, companyId: string): Promise<Receipt | undefined>;
  createReceipt(receipt: InsertReceipt, exec?: Pick<AppDatabase, "insert">): Promise<Receipt>;
  getCapturedReceipt(companyId: string, captureId: string): Promise<Receipt | undefined>;
  createCapturedReceipt(
    data: InsertReceipt,
    confirmDuplicate: boolean,
    signal?: AbortSignal
  ): Promise<
    | { receipt: Receipt; replay: boolean; duplicate?: never }
    | {
        duplicate: Pick<Receipt, "id" | "merchant" | "amount" | "date">;
        receipt?: never;
        replay?: never;
      }
  >;
  getReceiptsByCompanyId(companyId: string): Promise<Receipt[]>;
  updateReceipt(id: string, companyId: string, data: Partial<InsertReceipt>): Promise<Receipt>;
  updateReceiptIfUnposted(
    id: string,
    companyId: string,
    data: Partial<InsertReceipt>,
    tx?: typeof db
  ): Promise<Receipt>;
  postReceiptAtomic(
    args: PostReceiptAtomicArgs,
    tx?: typeof db
  ): Promise<{ receipt: Receipt; entry: JournalEntry }>;
  reviseReceiptAtomic(
    args: ReviseReceiptAtomicArgs,
    tx?: typeof db
  ): Promise<{ receipt: Receipt; entry: JournalEntry; reversal: JournalEntry }>;
  splitReceiptAtomic(args: SplitReceiptAtomicArgs, tx?: typeof db): Promise<Receipt[]>;
  isReceiptImageReferenced(companyId: string, imagePath: string): Promise<boolean>;
  deleteReceipt(id: string, companyId: string, tx?: typeof db): Promise<boolean>;

  // Customer Contacts
  getCustomerContact(id: string): Promise<CustomerContact | undefined>;
  getCustomerContactsByCompanyId(companyId: string): Promise<CustomerContact[]>;
  getDoNotChaseContactIds(companyId: string): Promise<string[]>;
  getCustomerContactByEmail(companyId: string, email: string): Promise<CustomerContact | undefined>;
  getCustomerContactByTrn(companyId: string, trn: string): Promise<CustomerContact | undefined>;
  createCustomerContact(contact: InsertCustomerContact): Promise<CustomerContact>;
  createBulkCustomerContacts(contacts: InsertCustomerContact[]): Promise<CustomerContact[]>;
  updateCustomerContact(
    id: string,
    data: Partial<InsertCustomerContact>,
    companyId?: string
  ): Promise<CustomerContact>;
  deleteCustomerContact(id: string, companyId?: string): Promise<void>;
  deleteAllCustomerContactsByCompanyId(companyId: string): Promise<number>;
  countCustomerContactsByCompanyId(companyId: string): Promise<number>;
  countInvoicesWithContactByCompanyId(companyId: string): Promise<number>;
  getCustomerContactByPortalToken(token: string): Promise<CustomerContact | undefined>;
  setPortalAccessToken(contactId: string, token: string, expiresAt: Date): Promise<CustomerContact>;

  // Waitlist
  createWaitlistEntry(entry: InsertWaitlist): Promise<Waitlist>;
  getWaitlistByEmail(email: string): Promise<Waitlist | undefined>;

  // Integration Syncs
  createIntegrationSync(
    sync: InsertIntegrationSync,
    exec?: Pick<AppDatabase, "insert">
  ): Promise<IntegrationSync>;
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
  /** Insert unless an alert with the same (company, dedupeKey) exists; undefined when it already did. */
  createAnomalyAlertIfNew(alert: InsertAnomalyAlert): Promise<AnomalyAlert | undefined>;
  getAnomalyAlertById(id: string): Promise<AnomalyAlert | undefined>;
  getAnomalyAlertsByCompanyId(companyId: string): Promise<AnomalyAlert[]>;
  getUnresolvedAnomalyAlerts(companyId: string): Promise<AnomalyAlert[]>;
  updateAnomalyAlert(id: string, data: Partial<InsertAnomalyAlert>): Promise<AnomalyAlert>;
  resolveAnomalyAlert(id: string, userId: string, note?: string): Promise<AnomalyAlert>;

  // Bank Accounts
  createBankAccount(account: InsertBankAccount): Promise<BankAccount>;
  getBankAccountsByCompanyId(companyId: string): Promise<BankAccount[]>;
  getBankAccountById(id: string, companyId?: string): Promise<BankAccount | undefined>;
  updateBankAccount(id: string, data: Partial<InsertBankAccount>): Promise<BankAccount>;

  // Bank Transactions
  createBankTransaction(transaction: InsertBankTransaction): Promise<BankTransaction>;
  bulkCreateBankTransactions(transactions: InsertBankTransaction[]): Promise<BankTransaction[]>;
  getBankTransactionById(id: string, companyId: string): Promise<BankTransaction | undefined>;
  getBankTransactionsByCompanyId(companyId: string): Promise<BankTransaction[]>;
  getUnreconciledBankTransactions(companyId: string): Promise<BankTransaction[]>;
  // W3-C: reconcileBankTransaction was removed. Every reconcile path goes through
  // services/bank-reconciliation.service.ts applyMatch (it wrote raw Dr Bank / Cr AR journals).

  // Cash Flow Forecasts
  createCashFlowForecast(forecast: InsertCashFlowForecast): Promise<CashFlowForecast>;
  getCashFlowForecastsByCompanyId(companyId: string): Promise<CashFlowForecast[]>;
  deleteCashFlowForecastsByCompanyId(companyId: string): Promise<void>;

  // Transaction Classifications
  createTransactionClassification(
    classification: InsertTransactionClassification
  ): Promise<TransactionClassification>;
  getTransactionClassification(id: string): Promise<TransactionClassification | undefined>;
  getTransactionClassificationsByCompanyId(companyId: string): Promise<TransactionClassification[]>;
  updateTransactionClassification(
    id: string,
    companyId: string,
    data: Partial<InsertTransactionClassification>
  ): Promise<TransactionClassification>;

  // Budgets
  getBudgetsByCompanyId(companyId: string, year: number, month: number): Promise<Budget[]>;
  createBudget(budget: InsertBudget): Promise<Budget>;
  updateBudget(id: string, companyId: string, data: Partial<InsertBudget>): Promise<Budget>;

  // E-Commerce Integrations
  getEcommerceIntegrations(companyId: string): Promise<EcommerceIntegration[]>;
  getEcommerceIntegrationById(id: string): Promise<EcommerceIntegration | undefined>;
  createEcommerceIntegration(
    integration: InsertEcommerceIntegration
  ): Promise<EcommerceIntegration>;
  updateEcommerceIntegration(
    id: string,
    data: Partial<InsertEcommerceIntegration>
  ): Promise<EcommerceIntegration>;
  deleteEcommerceIntegration(id: string): Promise<void>;

  // E-Commerce Transactions
  getEcommerceTransactions(companyId: string): Promise<EcommerceTransaction[]>;
  createEcommerceTransaction(
    transaction: InsertEcommerceTransaction
  ): Promise<EcommerceTransaction>;
  updateEcommerceTransaction(
    id: string,
    data: Partial<InsertEcommerceTransaction>
  ): Promise<EcommerceTransaction>;

  // Financial KPIs
  getFinancialKpis(companyId: string): Promise<FinancialKpi[]>;
  createFinancialKpi(kpi: InsertFinancialKpi): Promise<FinancialKpi>;

  // Cash Flow Forecasts (alias for consistency)
  getCashFlowForecasts(companyId: string): Promise<CashFlowForecast[]>;

  // Notifications
  getNotificationsByUserId(userId: string): Promise<Notification[]>;
  getUnreadNotificationCount(userId: string): Promise<number>;
  createNotification(notification: InsertNotification): Promise<Notification>;
  markNotificationAsRead(id: string, userId: string): Promise<Notification | undefined>;
  markAllNotificationsAsRead(userId: string): Promise<void>;
  dismissNotification(id: string, userId: string): Promise<Notification | undefined>;

  // Regulatory News
  getRegulatoryNews(): Promise<RegulatoryNews[]>;
  createRegulatoryNews(news: InsertRegulatoryNews): Promise<RegulatoryNews>;

  // Reminder Settings
  getReminderSettingsByCompanyId(companyId: string): Promise<ReminderSetting[]>;
  createReminderSetting(setting: InsertReminderSetting): Promise<ReminderSetting>;
  updateReminderSetting(id: string, data: Partial<InsertReminderSetting>): Promise<ReminderSetting>;
  getReminderSetting(id: string): Promise<ReminderSetting | undefined>;
  deleteReminderSettingForCompany(id: string, companyId: string): Promise<boolean>;
  updateReminderSettingForCompany(
    id: string,
    companyId: string,
    data: Partial<InsertReminderSetting>
  ): Promise<ReminderSetting | undefined>;

  // Reminder Logs
  getReminderLogsByCompanyId(companyId: string): Promise<ReminderLog[]>;
  createReminderLog(log: InsertReminderLog): Promise<ReminderLog>;
  updateReminderLog(id: string, data: Partial<InsertReminderLog>): Promise<ReminderLog>;

  // User Onboarding
  getUserOnboarding(userId: string): Promise<UserOnboarding | undefined>;
  createUserOnboarding(onboarding: InsertUserOnboarding): Promise<UserOnboarding>;
  updateUserOnboarding(
    userId: string,
    data: Partial<InsertUserOnboarding>
  ): Promise<UserOnboarding>;

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
  getAnalyticsEvents(filters?: {
    userId?: string;
    companyId?: string;
    companyIds?: string[];
    eventType?: string;
    startDate?: Date;
    endDate?: Date;
    limit?: number;
  }): Promise<AnalyticsEvent[]>;

  // Feature Usage Metrics
  getFeatureUsageMetrics(featureName?: string): Promise<FeatureUsageMetric[]>;
  createFeatureUsageMetric(metric: InsertFeatureUsageMetric): Promise<FeatureUsageMetric>;

  // Admin Settings
  getAdminSettings(): Promise<AdminSetting[]>;
  getAdminSettingByKey(key: string): Promise<AdminSetting | undefined>;
  createAdminSetting(setting: InsertAdminSetting): Promise<AdminSetting>;
  updateAdminSetting(key: string, value: string): Promise<AdminSetting>;

  // Audit Logs
  getAuditLogs(limit?: number): Promise<AuditLog[]>;
  createAuditLog(log: InsertAuditLog): Promise<AuditLog>;
  getCompanyAuditLogs(companyId: string, filter?: AuditLogFilter): Promise<AuditLog[]>;
  getUserSecurityEvents(userId: string, filter?: AuditLogFilter): Promise<AuditLog[]>;

  // VAT Returns
  getVatReturnsByCompanyId(companyId: string): Promise<VatReturn[]>;
  getVatReturn(id: string): Promise<VatReturn | undefined>;
  createVatReturn(vatReturn: InsertVatReturn): Promise<VatReturn>;
  updateUnfiledVatReturn(
    companyId: string,
    id: string,
    previousStatus: string,
    data: Partial<InsertVatReturn>
  ): Promise<VatReturn | undefined>;
  deleteVatReturn(id: string): Promise<void>;

  // Corporate Tax Returns
  getCorporateTaxReturnsByCompanyId(companyId: string): Promise<CorporateTaxReturn[]>;
  getCorporateTaxReturn(id: string): Promise<CorporateTaxReturn | undefined>;
  getCtLossBroughtForward(
    companyId: string,
    periodStart: Date,
    excludeReturnId?: string
  ): Promise<number>;
  getCtPriorPeriodRevenueExceededCap(
    companyId: string,
    periodStart: Date,
    excludeReturnId?: string
  ): Promise<boolean>;
  createCorporateTaxReturn(data: InsertCorporateTaxReturn): Promise<CorporateTaxReturn>;
  updateCorporateTaxReturn(
    id: string,
    data: Partial<CorporateTaxReturn>
  ): Promise<CorporateTaxReturn>;

  // Team Management
  updateCompanyUser(
    companyId: string,
    id: string,
    data: Pick<Partial<InsertCompanyUser>, "role">,
    tx?: Pick<AppDatabase, "select" | "update">
  ): Promise<CompanyUser | undefined>;
  deleteCompanyUser(
    companyId: string,
    id: string,
    tx?: Pick<AppDatabase, "select" | "delete">
  ): Promise<boolean>;
  getCompanyUser(companyId: string, id: string): Promise<CompanyUser | undefined>;
  getCompanyUserWithUser(companyId: string): Promise<CompanyMemberWithUser[]>;

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
  updateTaxReturnArchive(
    id: string,
    companyId: string,
    data: Partial<InsertTaxReturnArchive>
  ): Promise<TaxReturnArchive | undefined>;
  deleteTaxReturnArchive(id: string, companyId: string): Promise<boolean>;

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
  createActivityLog(
    log: InsertActivityLog,
    conn?: Pick<AppDatabase, "insert">
  ): Promise<ActivityLog>;

  // Client Notes (Admin internal notes)
  getClientNotes(companyId: string): Promise<ClientNote[]>;
  createClientNote(note: InsertClientNote): Promise<ClientNote>;
  updateClientNote(id: string, data: Partial<InsertClientNote>): Promise<ClientNote>;
  deleteClientNote(id: string): Promise<void>;

  // Admin User Management
  updateUser(id: string, data: { name?: string; email?: string; isAdmin?: boolean }): Promise<User>;
  deleteUser(id: string): Promise<void>;

  // Admin Company Management
  deleteCompany(
    id: string,
    firmActor?: Pick<FirmContext, "userId" | "firmId">
  ): Promise<Date | null>;

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
  getSubscriptionByStripeIds(
    subscriptionId: string,
    customerId: string,
    includeUnlinked?: boolean
  ): Promise<Subscription | undefined>;
  createSubscription(subscription: InsertSubscription): Promise<Subscription>;
  updateSubscription(id: string, data: Partial<InsertSubscription>): Promise<Subscription>;
  reconcileStripeSubscription<T>(
    subscription: Subscription,
    readChanges: (locked: Subscription) => Promise<{
      result: T;
      data?: Partial<InsertSubscription>;
    }>
  ): Promise<T | undefined>;

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
    excludeIds?: string[]
  ): Promise<RecurringInvoice | undefined>;
  createRecurringInvoice(data: InsertRecurringInvoice): Promise<RecurringInvoice>;
  updateRecurringInvoice(id: string, data: Partial<RecurringInvoice>): Promise<RecurringInvoice>;
  deleteRecurringInvoice(id: string): Promise<void>;

  // Invoice Payments
  getInvoicePaymentsByInvoiceId(invoiceId: string): Promise<InvoicePayment[]>;
  getInvoicePaymentsByCompanyId(companyId: string): Promise<InvoicePayment[]>;
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
  safeDeleteInvoice(id: string, actorId: string): Promise<void>;
  /**
   * Get journal entries that originated from an invoice.
   */
  getJournalEntriesBySource(
    companyId: string,
    source: string,
    sourceId: string
  ): Promise<JournalEntry[]>;

  // Products / Inventory
  getProductsByCompanyId(companyId: string): Promise<Product[]>;
  getProduct(id: string): Promise<Product | undefined>;
  createProduct(data: InsertProduct): Promise<Product>;
  updateProduct(id: string, data: Partial<Product>): Promise<Product>;
  // Stock changes go through server/services/inventory (costing + ledger, W4-B).
  deleteProduct(id: string): Promise<void>;

  // Inventory Movements
  getInventoryMovementsByProductId(productId: string): Promise<InventoryMovement[]>;
  getInventoryMovementsByCompanyId(companyId: string): Promise<InventoryMovement[]>;

  // Payment Chasing (Phase 4)
  createPaymentChase(data: InsertPaymentChase): Promise<PaymentChase>;
  getPaymentChasesByCompanyId(
    companyId: string,
    opts?: { invoiceId?: string; sinceDays?: number }
  ): Promise<PaymentChase[]>;
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
    minSecondsBetween: number
  ): Promise<boolean>;
  setInvoiceDoNotChase(invoiceId: string, value: boolean): Promise<void>;

  getChaseTemplatesForCompany(companyId: string): Promise<ChaseTemplate[]>;
  getChaseTemplate(
    level: number,
    language: string,
    companyId: string | null
  ): Promise<ChaseTemplate | undefined>;
  createChaseTemplate(data: InsertChaseTemplate): Promise<ChaseTemplate>;
  updateChaseTemplate(
    id: string,
    companyId: string,
    data: Partial<InsertChaseTemplate>
  ): Promise<ChaseTemplate | undefined>;
  deleteChaseTemplate(id: string, companyId: string): Promise<boolean>;

  getChaseConfig(companyId: string): Promise<ChaseConfig | undefined>;
  upsertChaseConfig(companyId: string, data: Partial<InsertChaseConfig>): Promise<ChaseConfig>;
}

/** W5-E: filter for audit-log reads. */
export interface AuditLogFilter {
  actions?: string[];
  /** e.g. "auth." or "mfa." */
  actionPrefix?: string;
  userId?: string;
  resourceType?: string;
  from?: Date;
  to?: Date;
  limit?: number;
  offset?: number;
}
