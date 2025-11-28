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
  Waitlist, InsertWaitlist,
  IntegrationSync, InsertIntegrationSync,
  WhatsappConfig, InsertWhatsappConfig,
  WhatsappMessage, InsertWhatsappMessage,
  AnomalyAlert, InsertAnomalyAlert,
  BankTransaction, InsertBankTransaction,
  CashFlowForecast, InsertCashFlowForecast,
  TransactionClassification, InsertTransactionClassification
} from "@shared/schema";
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
  waitlist,
  integrationSyncs,
  whatsappConfigs,
  whatsappMessages,
  anomalyAlerts,
  bankTransactions,
  cashFlowForecasts,
  transactionClassifications
} from "@shared/schema";
import { db } from "./db";
import { eq, and, desc } from "drizzle-orm";

export interface IStorage {
  // Users
  getUser(id: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  
  // Companies
  getCompany(id: string): Promise<Company | undefined>;
  getCompanyByName(name: string): Promise<Company | undefined>;
  getCompaniesByUserId(userId: string): Promise<Company[]>;
  createCompany(company: InsertCompany): Promise<Company>;
  updateCompany(id: string, data: Partial<InsertCompany>): Promise<Company>;
  
  // Company Users
  createCompanyUser(companyUser: InsertCompanyUser): Promise<CompanyUser>;
  getUserRole(companyId: string, userId: string): Promise<CompanyUser | undefined>;
  hasCompanyAccess(userId: string, companyId: string): Promise<boolean>;
  
  // Accounts
  getAccount(id: string): Promise<Account | undefined>;
  getAccountsByCompanyId(companyId: string): Promise<Account[]>;
  createAccount(account: InsertAccount): Promise<Account>;
  updateAccount(id: string, data: Partial<InsertAccount>): Promise<Account>;
  deleteAccount(id: string): Promise<void>;
  accountHasTransactions(accountId: string): Promise<boolean>;
  
  // Journal Entries
  getJournalEntry(id: string): Promise<JournalEntry | undefined>;
  getJournalEntriesByCompanyId(companyId: string): Promise<JournalEntry[]>;
  createJournalEntry(entry: InsertJournalEntry): Promise<JournalEntry>;
  updateJournalEntry(id: string, data: Partial<InsertJournalEntry>): Promise<JournalEntry>;
  deleteJournalEntry(id: string): Promise<void>;
  
  // Journal Lines
  createJournalLine(line: InsertJournalLine): Promise<JournalLine>;
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
  createReceipt(receipt: InsertReceipt): Promise<Receipt>;
  getReceiptsByCompanyId(companyId: string): Promise<Receipt[]>;
  updateReceipt(id: string, data: Partial<InsertReceipt>): Promise<Receipt>;
  deleteReceipt(id: string): Promise<void>;
  
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
  getAnomalyAlertsByCompanyId(companyId: string): Promise<AnomalyAlert[]>;
  getUnresolvedAnomalyAlerts(companyId: string): Promise<AnomalyAlert[]>;
  updateAnomalyAlert(id: string, data: Partial<InsertAnomalyAlert>): Promise<AnomalyAlert>;
  resolveAnomalyAlert(id: string, userId: string, note?: string): Promise<AnomalyAlert>;

  // Bank Transactions
  createBankTransaction(transaction: InsertBankTransaction): Promise<BankTransaction>;
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

  async accountHasTransactions(accountId: string): Promise<boolean> {
    const lines = await db
      .select()
      .from(journalLines)
      .where(eq(journalLines.accountId, accountId))
      .limit(1);
    return lines.length > 0;
  }

  // Journal Entries
  async getJournalEntry(id: string): Promise<JournalEntry | undefined> {
    const [entry] = await db.select().from(journalEntries).where(eq(journalEntries.id, id));
    return entry || undefined;
  }

  async getJournalEntriesByCompanyId(companyId: string): Promise<JournalEntry[]> {
    return await db
      .select()
      .from(journalEntries)
      .where(eq(journalEntries.companyId, companyId))
      .orderBy(desc(journalEntries.date));
  }

  async createJournalEntry(insertEntry: InsertJournalEntry): Promise<JournalEntry> {
    const [entry] = await db
      .insert(journalEntries)
      .values(insertEntry)
      .returning();
    return entry;
  }

  async updateJournalEntry(id: string, data: Partial<InsertJournalEntry>): Promise<JournalEntry> {
    const [entry] = await db
      .update(journalEntries)
      .set(data)
      .where(eq(journalEntries.id, id))
      .returning();
    if (!entry) {
      throw new Error('Journal entry not found');
    }
    return entry;
  }

  async deleteJournalEntry(id: string): Promise<void> {
    await db.delete(journalEntries).where(eq(journalEntries.id, id));
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
}

export const storage = new DatabaseStorage();
