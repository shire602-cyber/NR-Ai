import { users, companies, companyUsers, accounts, journalEntries, journalLines, invoices, invoiceLines, receipts, customerContacts, waitlist, integrationSyncs, whatsappConfigs, whatsappMessages, anomalyAlerts, bankTransactions, cashFlowForecasts, transactionClassifications, budgets, ecommerceIntegrations, ecommerceTransactions, financialKpis, notifications, regulatoryNews, reminderSettings, reminderLogs, userOnboarding, helpTips, referralCodes, referrals, userFeedback, analyticsEvents, featureUsageMetrics, adminSettings, subscriptionPlans, userSubscriptions, auditLogs, vatReturns, documents, taxReturnArchive, complianceTasks, messages, newsItems, invitations, activityLogs, clientNotes, engagements, serviceInvoices, serviceInvoiceLines, ftaEmails, subscriptions, backups } from "../shared/schema.js";
import { db } from "./db.js";
import { eq, and, desc } from "drizzle-orm";
export class DatabaseStorage {
    // Users
    async getUser(id) {
        const [user] = await db.select().from(users).where(eq(users.id, id));
        return user || undefined;
    }
    async getUserByEmail(email) {
        const [user] = await db.select().from(users).where(eq(users.email, email));
        return user || undefined;
    }
    async createUser(insertUser) {
        const [user] = await db
            .insert(users)
            .values({
            ...insertUser,
            passwordHash: insertUser.passwordHash || '',
        })
            .returning();
        return user;
    }
    // Companies
    async getCompany(id) {
        const [company] = await db.select().from(companies).where(eq(companies.id, id));
        return company || undefined;
    }
    async getCompanyByName(name) {
        const [company] = await db.select().from(companies).where(eq(companies.name, name));
        return company || undefined;
    }
    async getCompaniesByUserId(userId) {
        const results = await db
            .select()
            .from(companies)
            .innerJoin(companyUsers, eq(companies.id, companyUsers.companyId))
            .where(eq(companyUsers.userId, userId));
        return results.map(r => r.companies);
    }
    async createCompany(insertCompany) {
        const [company] = await db
            .insert(companies)
            .values(insertCompany)
            .returning();
        return company;
    }
    async updateCompany(id, data) {
        const [company] = await db
            .update(companies)
            .set(data)
            .where(eq(companies.id, id))
            .returning();
        return company;
    }
    // Company Users
    async createCompanyUser(insertCompanyUser) {
        const [companyUser] = await db
            .insert(companyUsers)
            .values(insertCompanyUser)
            .returning();
        return companyUser;
    }
    async getUserRole(companyId, userId) {
        const [companyUser] = await db
            .select()
            .from(companyUsers)
            .where(and(eq(companyUsers.companyId, companyId), eq(companyUsers.userId, userId)));
        return companyUser || undefined;
    }
    async hasCompanyAccess(userId, companyId) {
        const result = await this.getUserRole(companyId, userId);
        return !!result;
    }
    async getCompanyUsersByCompanyId(companyId) {
        return await db.select().from(companyUsers).where(eq(companyUsers.companyId, companyId));
    }
    // Accounts
    async getAccount(id) {
        const [account] = await db.select().from(accounts).where(eq(accounts.id, id));
        return account || undefined;
    }
    async getAccountsByCompanyId(companyId) {
        return await db.select().from(accounts).where(eq(accounts.companyId, companyId));
    }
    async createAccount(insertAccount) {
        const [account] = await db
            .insert(accounts)
            .values(insertAccount)
            .returning();
        return account;
    }
    async updateAccount(id, data) {
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
    async deleteAccount(id) {
        await db.delete(accounts).where(eq(accounts.id, id));
    }
    async archiveAccount(id) {
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
    async getAccountByCode(companyId, code) {
        const [account] = await db
            .select()
            .from(accounts)
            .where(and(eq(accounts.companyId, companyId), eq(accounts.code, code)));
        return account || undefined;
    }
    async getVatAccounts(companyId) {
        return await db
            .select()
            .from(accounts)
            .where(and(eq(accounts.companyId, companyId), eq(accounts.isVatAccount, true)));
    }
    async createBulkAccounts(accountsData) {
        if (accountsData.length === 0)
            return [];
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
    async companyHasAccounts(companyId) {
        const existingAccounts = await db
            .select({ id: accounts.id })
            .from(accounts)
            .where(eq(accounts.companyId, companyId))
            .limit(1);
        return existingAccounts.length > 0;
    }
    async accountHasTransactions(accountId) {
        const lines = await db
            .select()
            .from(journalLines)
            .where(eq(journalLines.accountId, accountId))
            .limit(1);
        return lines.length > 0;
    }
    async getAccountsWithBalances(companyId, dateRange) {
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
            }
            else {
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
    async getAccountLedger(accountId, options) {
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
            const priorLines = postedLines.filter(l => new Date(l.date) < options.dateStart);
            const priorDebit = priorLines.reduce((sum, l) => sum + (l.debit || 0), 0);
            const priorCredit = priorLines.reduce((sum, l) => sum + (l.credit || 0), 0);
            if (['asset', 'expense'].includes(account.type)) {
                openingBalance = priorDebit - priorCredit;
            }
            else {
                openingBalance = priorCredit - priorDebit;
            }
        }
        let filteredLines = postedLines;
        if (options?.dateStart) {
            filteredLines = filteredLines.filter(l => new Date(l.date) >= options.dateStart);
        }
        if (options?.dateEnd) {
            filteredLines = filteredLines.filter(l => new Date(l.date) <= options.dateEnd);
        }
        if (options?.search) {
            const searchLower = options.search.toLowerCase();
            filteredLines = filteredLines.filter(l => l.entryNumber?.toLowerCase().includes(searchLower) ||
                l.memo?.toLowerCase().includes(searchLower) ||
                l.lineDescription?.toLowerCase().includes(searchLower));
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
            }
            else {
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
    async getJournalEntry(id) {
        const results = await db.select().from(journalEntries).where(eq(journalEntries.id, id));
        return results[0] || undefined;
    }
    async getJournalEntriesByCompanyId(companyId) {
        const results = await db
            .select()
            .from(journalEntries)
            .where(eq(journalEntries.companyId, companyId))
            .orderBy(desc(journalEntries.date));
        return results;
    }
    async createJournalEntry(insertEntry) {
        const results = await db
            .insert(journalEntries)
            .values(insertEntry)
            .returning();
        return results[0];
    }
    async updateJournalEntry(id, data) {
        const results = await db
            .update(journalEntries)
            .set(data)
            .where(eq(journalEntries.id, id))
            .returning();
        if (!results[0]) {
            throw new Error('Journal entry not found');
        }
        return results[0];
    }
    async deleteJournalEntry(id) {
        await db.delete(journalEntries).where(eq(journalEntries.id, id));
    }
    async generateEntryNumber(companyId, date) {
        const dateStr = date.toISOString().slice(0, 10).replace(/-/g, '');
        const prefix = `JE-${dateStr}`;
        // Get count of entries for this company and date prefix using SQL for atomicity
        const allEntries = await db
            .select()
            .from(journalEntries)
            .where(eq(journalEntries.companyId, companyId));
        // Filter entries that match this date prefix
        const todayEntries = allEntries.filter(e => e.entryNumber?.startsWith(prefix));
        const nextNumber = todayEntries.length + 1;
        return `${prefix}-${String(nextNumber).padStart(3, '0')}`;
    }
    // Journal Lines
    async createJournalLine(insertLine) {
        const [line] = await db
            .insert(journalLines)
            .values(insertLine)
            .returning();
        return line;
    }
    async getJournalLinesByEntryId(entryId) {
        return await db.select().from(journalLines).where(eq(journalLines.entryId, entryId));
    }
    async deleteJournalLinesByEntryId(entryId) {
        await db.delete(journalLines).where(eq(journalLines.entryId, entryId));
    }
    // Invoices
    async getInvoice(id) {
        const [invoice] = await db.select().from(invoices).where(eq(invoices.id, id));
        return invoice || undefined;
    }
    async getInvoicesByCompanyId(companyId) {
        return await db
            .select()
            .from(invoices)
            .where(eq(invoices.companyId, companyId))
            .orderBy(desc(invoices.date));
    }
    async createInvoice(insertInvoice) {
        const [invoice] = await db
            .insert(invoices)
            .values(insertInvoice)
            .returning();
        return invoice;
    }
    async updateInvoice(id, data) {
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
    async updateInvoiceStatus(id, status) {
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
    async deleteInvoice(id) {
        await db.delete(invoices).where(eq(invoices.id, id));
    }
    // Invoice Lines
    async createInvoiceLine(insertLine) {
        const [line] = await db
            .insert(invoiceLines)
            .values(insertLine)
            .returning();
        return line;
    }
    async getInvoiceLinesByInvoiceId(invoiceId) {
        return await db.select().from(invoiceLines).where(eq(invoiceLines.invoiceId, invoiceId));
    }
    async deleteInvoiceLinesByInvoiceId(invoiceId) {
        await db.delete(invoiceLines).where(eq(invoiceLines.invoiceId, invoiceId));
    }
    // Receipts
    async getReceipt(id) {
        const [receipt] = await db.select().from(receipts).where(eq(receipts.id, id));
        return receipt || undefined;
    }
    async createReceipt(insertReceipt) {
        const [receipt] = await db
            .insert(receipts)
            .values(insertReceipt)
            .returning();
        return receipt;
    }
    async getReceiptsByCompanyId(companyId) {
        return await db
            .select()
            .from(receipts)
            .where(eq(receipts.companyId, companyId))
            .orderBy(desc(receipts.createdAt));
    }
    async updateReceipt(id, data) {
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
    async deleteReceipt(id) {
        await db.delete(receipts).where(eq(receipts.id, id));
    }
    // Customer Contacts
    async getCustomerContact(id) {
        const [contact] = await db.select().from(customerContacts).where(eq(customerContacts.id, id));
        return contact;
    }
    async getCustomerContactsByCompanyId(companyId) {
        return await db.select().from(customerContacts)
            .where(and(eq(customerContacts.companyId, companyId), eq(customerContacts.isActive, true)))
            .orderBy(desc(customerContacts.createdAt));
    }
    async getCustomerContactByEmail(companyId, email) {
        const [contact] = await db.select().from(customerContacts)
            .where(and(eq(customerContacts.companyId, companyId), eq(customerContacts.email, email)));
        return contact;
    }
    async getCustomerContactByTrn(companyId, trn) {
        const [contact] = await db.select().from(customerContacts)
            .where(and(eq(customerContacts.companyId, companyId), eq(customerContacts.trnNumber, trn)));
        return contact;
    }
    async createCustomerContact(insertContact) {
        const [contact] = await db.insert(customerContacts).values(insertContact).returning();
        return contact;
    }
    async createBulkCustomerContacts(contactsData) {
        if (contactsData.length === 0)
            return [];
        const created = await db.insert(customerContacts).values(contactsData).returning();
        return created;
    }
    async updateCustomerContact(id, data) {
        const [contact] = await db.update(customerContacts)
            .set({ ...data, updatedAt: new Date() })
            .where(eq(customerContacts.id, id))
            .returning();
        if (!contact)
            throw new Error('Customer contact not found');
        return contact;
    }
    async deleteCustomerContact(id) {
        await db.delete(customerContacts).where(eq(customerContacts.id, id));
    }
    // Waitlist
    async createWaitlistEntry(insertEntry) {
        const [entry] = await db
            .insert(waitlist)
            .values(insertEntry)
            .returning();
        return entry;
    }
    async getWaitlistByEmail(email) {
        const [entry] = await db.select().from(waitlist).where(eq(waitlist.email, email));
        return entry || undefined;
    }
    // Integration Syncs
    async createIntegrationSync(insertSync) {
        const [sync] = await db
            .insert(integrationSyncs)
            .values(insertSync)
            .returning();
        return sync;
    }
    async getIntegrationSyncsByCompanyId(companyId) {
        return await db
            .select()
            .from(integrationSyncs)
            .where(eq(integrationSyncs.companyId, companyId))
            .orderBy(desc(integrationSyncs.syncedAt));
    }
    async getIntegrationSyncsByType(companyId, integrationType) {
        return await db
            .select()
            .from(integrationSyncs)
            .where(and(eq(integrationSyncs.companyId, companyId), eq(integrationSyncs.integrationType, integrationType)))
            .orderBy(desc(integrationSyncs.syncedAt));
    }
    // WhatsApp Configuration
    async getWhatsappConfig(companyId) {
        const [config] = await db
            .select()
            .from(whatsappConfigs)
            .where(eq(whatsappConfigs.companyId, companyId));
        return config || undefined;
    }
    async createWhatsappConfig(insertConfig) {
        const [config] = await db
            .insert(whatsappConfigs)
            .values(insertConfig)
            .returning();
        return config;
    }
    async updateWhatsappConfig(id, data) {
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
    async createWhatsappMessage(insertMessage) {
        const [message] = await db
            .insert(whatsappMessages)
            .values(insertMessage)
            .returning();
        return message;
    }
    async getWhatsappMessagesByCompanyId(companyId) {
        return await db
            .select()
            .from(whatsappMessages)
            .where(eq(whatsappMessages.companyId, companyId))
            .orderBy(desc(whatsappMessages.createdAt));
    }
    async updateWhatsappMessage(id, data) {
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
    async createAnomalyAlert(insertAlert) {
        const [alert] = await db
            .insert(anomalyAlerts)
            .values(insertAlert)
            .returning();
        return alert;
    }
    async getAnomalyAlertById(id) {
        const [alert] = await db
            .select()
            .from(anomalyAlerts)
            .where(eq(anomalyAlerts.id, id));
        return alert;
    }
    async getAnomalyAlertsByCompanyId(companyId) {
        return await db
            .select()
            .from(anomalyAlerts)
            .where(eq(anomalyAlerts.companyId, companyId))
            .orderBy(desc(anomalyAlerts.createdAt));
    }
    async getUnresolvedAnomalyAlerts(companyId) {
        return await db
            .select()
            .from(anomalyAlerts)
            .where(and(eq(anomalyAlerts.companyId, companyId), eq(anomalyAlerts.isResolved, false)))
            .orderBy(desc(anomalyAlerts.createdAt));
    }
    async updateAnomalyAlert(id, data) {
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
    async resolveAnomalyAlert(id, userId, note) {
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
    async createBankTransaction(insertTransaction) {
        const [transaction] = await db
            .insert(bankTransactions)
            .values(insertTransaction)
            .returning();
        return transaction;
    }
    async getBankTransactionById(id) {
        const [transaction] = await db
            .select()
            .from(bankTransactions)
            .where(eq(bankTransactions.id, id));
        return transaction;
    }
    async getBankTransactionsByCompanyId(companyId) {
        return await db
            .select()
            .from(bankTransactions)
            .where(eq(bankTransactions.companyId, companyId))
            .orderBy(desc(bankTransactions.transactionDate));
    }
    async getUnreconciledBankTransactions(companyId) {
        return await db
            .select()
            .from(bankTransactions)
            .where(and(eq(bankTransactions.companyId, companyId), eq(bankTransactions.isReconciled, false)))
            .orderBy(desc(bankTransactions.transactionDate));
    }
    async updateBankTransaction(id, data) {
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
    async reconcileBankTransaction(id, matchedId, matchType) {
        const updateData = {
            isReconciled: true,
        };
        if (matchType === 'journal') {
            updateData.matchedJournalEntryId = matchedId;
        }
        else if (matchType === 'receipt') {
            updateData.matchedReceiptId = matchedId;
        }
        else {
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
    async createCashFlowForecast(insertForecast) {
        const [forecast] = await db
            .insert(cashFlowForecasts)
            .values(insertForecast)
            .returning();
        return forecast;
    }
    async getCashFlowForecastsByCompanyId(companyId) {
        return await db
            .select()
            .from(cashFlowForecasts)
            .where(eq(cashFlowForecasts.companyId, companyId))
            .orderBy(cashFlowForecasts.forecastDate);
    }
    async deleteCashFlowForecastsByCompanyId(companyId) {
        await db.delete(cashFlowForecasts).where(eq(cashFlowForecasts.companyId, companyId));
    }
    // Transaction Classifications
    async createTransactionClassification(insertClassification) {
        const [classification] = await db
            .insert(transactionClassifications)
            .values(insertClassification)
            .returning();
        return classification;
    }
    async getTransactionClassificationsByCompanyId(companyId) {
        return await db
            .select()
            .from(transactionClassifications)
            .where(eq(transactionClassifications.companyId, companyId))
            .orderBy(desc(transactionClassifications.createdAt));
    }
    async updateTransactionClassification(id, data) {
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
    async getJournalLinesByCompanyId(companyId) {
        const results = await db
            .select()
            .from(journalLines)
            .innerJoin(journalEntries, eq(journalLines.entryId, journalEntries.id))
            .where(eq(journalEntries.companyId, companyId));
        return results.map(r => r.journal_lines);
    }
    // Budgets
    async getBudgetsByCompanyId(companyId, year, month) {
        return await db
            .select()
            .from(budgets)
            .where(and(eq(budgets.companyId, companyId), eq(budgets.year, year), eq(budgets.month, month)));
    }
    async createBudget(insertBudget) {
        const [budget] = await db
            .insert(budgets)
            .values(insertBudget)
            .returning();
        return budget;
    }
    async updateBudget(id, data) {
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
    async getEcommerceIntegrations(companyId) {
        return await db
            .select()
            .from(ecommerceIntegrations)
            .where(eq(ecommerceIntegrations.companyId, companyId))
            .orderBy(desc(ecommerceIntegrations.createdAt));
    }
    async createEcommerceIntegration(insertIntegration) {
        const [integration] = await db
            .insert(ecommerceIntegrations)
            .values(insertIntegration)
            .returning();
        return integration;
    }
    async updateEcommerceIntegration(id, data) {
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
    async deleteEcommerceIntegration(id) {
        await db.delete(ecommerceIntegrations).where(eq(ecommerceIntegrations.id, id));
    }
    // E-Commerce Transactions
    async getEcommerceTransactions(companyId) {
        const results = await db
            .select({
            ecommerceTransactions: ecommerceTransactions,
        })
            .from(ecommerceTransactions)
            .innerJoin(ecommerceIntegrations, eq(ecommerceTransactions.integrationId, ecommerceIntegrations.id))
            .where(eq(ecommerceIntegrations.companyId, companyId));
        return results.map(r => r.ecommerceTransactions);
    }
    async createEcommerceTransaction(insertTransaction) {
        const [transaction] = await db
            .insert(ecommerceTransactions)
            .values(insertTransaction)
            .returning();
        return transaction;
    }
    async updateEcommerceTransaction(id, data) {
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
    async getFinancialKpis(companyId) {
        return await db
            .select()
            .from(financialKpis)
            .where(eq(financialKpis.companyId, companyId))
            .orderBy(desc(financialKpis.calculatedAt));
    }
    async createFinancialKpi(insertKpi) {
        const [kpi] = await db
            .insert(financialKpis)
            .values(insertKpi)
            .returning();
        return kpi;
    }
    // Cash Flow Forecasts (alias for consistency)
    async getCashFlowForecasts(companyId) {
        return this.getCashFlowForecastsByCompanyId(companyId);
    }
    // Notifications
    async getNotificationsByUserId(userId) {
        return await db
            .select()
            .from(notifications)
            .where(and(eq(notifications.userId, userId), eq(notifications.isDismissed, false)))
            .orderBy(desc(notifications.createdAt));
    }
    async getUnreadNotificationCount(userId) {
        const result = await db
            .select()
            .from(notifications)
            .where(and(eq(notifications.userId, userId), eq(notifications.isRead, false), eq(notifications.isDismissed, false)));
        return result.length;
    }
    async createNotification(insertNotification) {
        const [notification] = await db
            .insert(notifications)
            .values(insertNotification)
            .returning();
        return notification;
    }
    async markNotificationAsRead(id) {
        const [notification] = await db
            .update(notifications)
            .set({ isRead: true, readAt: new Date() })
            .where(eq(notifications.id, id))
            .returning();
        return notification;
    }
    async markAllNotificationsAsRead(userId) {
        await db
            .update(notifications)
            .set({ isRead: true, readAt: new Date() })
            .where(eq(notifications.userId, userId));
    }
    async dismissNotification(id) {
        const [notification] = await db
            .update(notifications)
            .set({ isDismissed: true })
            .where(eq(notifications.id, id))
            .returning();
        return notification;
    }
    // Regulatory News
    async getRegulatoryNews() {
        return await db
            .select()
            .from(regulatoryNews)
            .where(eq(regulatoryNews.isActive, true))
            .orderBy(desc(regulatoryNews.publishedAt));
    }
    async createRegulatoryNews(insertNews) {
        const [news] = await db
            .insert(regulatoryNews)
            .values(insertNews)
            .returning();
        return news;
    }
    // Reminder Settings
    async getReminderSettingsByCompanyId(companyId) {
        return await db
            .select()
            .from(reminderSettings)
            .where(eq(reminderSettings.companyId, companyId));
    }
    async createReminderSetting(insertSetting) {
        const [setting] = await db
            .insert(reminderSettings)
            .values(insertSetting)
            .returning();
        return setting;
    }
    async updateReminderSetting(id, data) {
        const [setting] = await db
            .update(reminderSettings)
            .set({ ...data, updatedAt: new Date() })
            .where(eq(reminderSettings.id, id))
            .returning();
        return setting;
    }
    // Reminder Logs
    async getReminderLogsByCompanyId(companyId) {
        return await db
            .select()
            .from(reminderLogs)
            .where(eq(reminderLogs.companyId, companyId))
            .orderBy(desc(reminderLogs.createdAt));
    }
    async createReminderLog(insertLog) {
        const [log] = await db
            .insert(reminderLogs)
            .values(insertLog)
            .returning();
        return log;
    }
    async updateReminderLog(id, data) {
        const [log] = await db
            .update(reminderLogs)
            .set(data)
            .where(eq(reminderLogs.id, id))
            .returning();
        return log;
    }
    // User Onboarding
    async getUserOnboarding(userId) {
        const [onboarding] = await db
            .select()
            .from(userOnboarding)
            .where(eq(userOnboarding.userId, userId));
        return onboarding;
    }
    async createUserOnboarding(insertOnboarding) {
        const [onboarding] = await db
            .insert(userOnboarding)
            .values(insertOnboarding)
            .returning();
        return onboarding;
    }
    async updateUserOnboarding(userId, data) {
        const [onboarding] = await db
            .update(userOnboarding)
            .set({ ...data, updatedAt: new Date() })
            .where(eq(userOnboarding.userId, userId))
            .returning();
        return onboarding;
    }
    // Help Tips
    async getHelpTipsByPage(pageContext) {
        return await db
            .select()
            .from(helpTips)
            .where(and(eq(helpTips.pageContext, pageContext), eq(helpTips.isActive, true)))
            .orderBy(helpTips.order);
    }
    async getAllHelpTips() {
        return await db
            .select()
            .from(helpTips)
            .where(eq(helpTips.isActive, true))
            .orderBy(helpTips.order);
    }
    async createHelpTip(insertTip) {
        const [tip] = await db
            .insert(helpTips)
            .values(insertTip)
            .returning();
        return tip;
    }
    // Referral Codes
    async getReferralCodeByUserId(userId) {
        const [code] = await db
            .select()
            .from(referralCodes)
            .where(eq(referralCodes.userId, userId));
        return code;
    }
    async getReferralCodeByCode(code) {
        const [referralCode] = await db
            .select()
            .from(referralCodes)
            .where(eq(referralCodes.code, code));
        return referralCode;
    }
    async createReferralCode(insertCode) {
        const [code] = await db
            .insert(referralCodes)
            .values(insertCode)
            .returning();
        return code;
    }
    async updateReferralCode(id, data) {
        const [code] = await db
            .update(referralCodes)
            .set(data)
            .where(eq(referralCodes.id, id))
            .returning();
        return code;
    }
    // Referrals
    async getReferralsByReferrerId(referrerId) {
        return await db
            .select()
            .from(referrals)
            .where(eq(referrals.referrerId, referrerId))
            .orderBy(desc(referrals.createdAt));
    }
    async createReferral(insertReferral) {
        const [referral] = await db
            .insert(referrals)
            .values(insertReferral)
            .returning();
        return referral;
    }
    async updateReferral(id, data) {
        const [referral] = await db
            .update(referrals)
            .set(data)
            .where(eq(referrals.id, id))
            .returning();
        return referral;
    }
    // User Feedback
    async createUserFeedback(insertFeedback) {
        const [feedback] = await db
            .insert(userFeedback)
            .values(insertFeedback)
            .returning();
        return feedback;
    }
    async getUserFeedback(userId) {
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
    async updateUserFeedback(id, data) {
        const [feedback] = await db
            .update(userFeedback)
            .set(data)
            .where(eq(userFeedback.id, id))
            .returning();
        return feedback;
    }
    // Analytics Events
    async createAnalyticsEvent(insertEvent) {
        const [event] = await db
            .insert(analyticsEvents)
            .values(insertEvent)
            .returning();
        return event;
    }
    async getAnalyticsEvents(filters) {
        let query = db.select().from(analyticsEvents);
        if (filters?.userId) {
            query = query.where(eq(analyticsEvents.userId, filters.userId));
        }
        if (filters?.eventType) {
            query = query.where(eq(analyticsEvents.eventType, filters.eventType));
        }
        return await query.orderBy(desc(analyticsEvents.createdAt));
    }
    // Feature Usage Metrics
    async getFeatureUsageMetrics(featureName) {
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
    async createFeatureUsageMetric(insertMetric) {
        const [metric] = await db
            .insert(featureUsageMetrics)
            .values(insertMetric)
            .returning();
        return metric;
    }
    // Admin Settings
    async getAdminSettings() {
        return await db.select().from(adminSettings);
    }
    async getAdminSettingByKey(key) {
        const [setting] = await db.select().from(adminSettings).where(eq(adminSettings.key, key));
        return setting || undefined;
    }
    async createAdminSetting(insertSetting) {
        const [setting] = await db
            .insert(adminSettings)
            .values(insertSetting)
            .returning();
        return setting;
    }
    async updateAdminSetting(key, value) {
        const [setting] = await db
            .update(adminSettings)
            .set({ value, updatedAt: new Date() })
            .where(eq(adminSettings.key, key))
            .returning();
        return setting;
    }
    // Subscription Plans
    async getSubscriptionPlans() {
        return await db.select().from(subscriptionPlans).orderBy(subscriptionPlans.sortOrder);
    }
    async getSubscriptionPlan(id) {
        const [plan] = await db.select().from(subscriptionPlans).where(eq(subscriptionPlans.id, id));
        return plan || undefined;
    }
    async createSubscriptionPlan(insertPlan) {
        const [plan] = await db
            .insert(subscriptionPlans)
            .values(insertPlan)
            .returning();
        return plan;
    }
    async updateSubscriptionPlan(id, data) {
        const [plan] = await db
            .update(subscriptionPlans)
            .set(data)
            .where(eq(subscriptionPlans.id, id))
            .returning();
        return plan;
    }
    async deleteSubscriptionPlan(id) {
        await db.delete(subscriptionPlans).where(eq(subscriptionPlans.id, id));
    }
    // User Subscriptions
    async getUserSubscription(userId) {
        const [subscription] = await db
            .select()
            .from(userSubscriptions)
            .where(eq(userSubscriptions.userId, userId));
        return subscription || undefined;
    }
    async createUserSubscription(insertSubscription) {
        const [subscription] = await db
            .insert(userSubscriptions)
            .values(insertSubscription)
            .returning();
        return subscription;
    }
    async updateUserSubscription(id, data) {
        const [subscription] = await db
            .update(userSubscriptions)
            .set(data)
            .where(eq(userSubscriptions.id, id))
            .returning();
        return subscription;
    }
    // Audit Logs
    async getAuditLogs(limit = 100) {
        return await db
            .select()
            .from(auditLogs)
            .orderBy(desc(auditLogs.createdAt))
            .limit(limit);
    }
    async createAuditLog(insertLog) {
        const [log] = await db
            .insert(auditLogs)
            .values(insertLog)
            .returning();
        return log;
    }
    // Admin Stats
    async getAllUsers() {
        return await db.select().from(users).orderBy(desc(users.createdAt));
    }
    async getAllCompanies() {
        return await db.select().from(companies).orderBy(desc(companies.createdAt));
    }
    // VAT Returns
    async getVatReturnsByCompanyId(companyId) {
        return await db
            .select()
            .from(vatReturns)
            .where(eq(vatReturns.companyId, companyId))
            .orderBy(desc(vatReturns.periodEnd));
    }
    async getVatReturn(id) {
        const [vatReturn] = await db.select().from(vatReturns).where(eq(vatReturns.id, id));
        return vatReturn || undefined;
    }
    async createVatReturn(insertVatReturn) {
        const [vatReturn] = await db
            .insert(vatReturns)
            .values(insertVatReturn)
            .returning();
        return vatReturn;
    }
    async updateVatReturn(id, data) {
        const [vatReturn] = await db
            .update(vatReturns)
            .set({ ...data, updatedAt: new Date() })
            .where(eq(vatReturns.id, id))
            .returning();
        return vatReturn;
    }
    async deleteVatReturn(id) {
        await db.delete(vatReturns).where(eq(vatReturns.id, id));
    }
    // Team Management
    async updateCompanyUser(id, data) {
        const [companyUser] = await db
            .update(companyUsers)
            .set(data)
            .where(eq(companyUsers.id, id))
            .returning();
        return companyUser;
    }
    async deleteCompanyUser(id) {
        await db.delete(companyUsers).where(eq(companyUsers.id, id));
    }
    async getCompanyUserWithUser(companyId) {
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
    async getDocuments(companyId) {
        return await db
            .select()
            .from(documents)
            .where(eq(documents.companyId, companyId))
            .orderBy(desc(documents.createdAt));
    }
    async getDocument(id) {
        const [document] = await db.select().from(documents).where(eq(documents.id, id));
        return document || undefined;
    }
    async createDocument(insertDocument) {
        const [document] = await db
            .insert(documents)
            .values(insertDocument)
            .returning();
        return document;
    }
    async updateDocument(id, data) {
        const [document] = await db
            .update(documents)
            .set({ ...data, updatedAt: new Date() })
            .where(eq(documents.id, id))
            .returning();
        return document;
    }
    async deleteDocument(id) {
        await db.delete(documents).where(eq(documents.id, id));
    }
    // Tax Return Archive
    async getTaxReturnArchive(companyId) {
        return await db
            .select()
            .from(taxReturnArchive)
            .where(eq(taxReturnArchive.companyId, companyId))
            .orderBy(desc(taxReturnArchive.filingDate));
    }
    async getTaxReturnArchiveItem(id) {
        const [item] = await db.select().from(taxReturnArchive).where(eq(taxReturnArchive.id, id));
        return item || undefined;
    }
    async createTaxReturnArchive(insertTaxReturn) {
        const [taxReturn] = await db
            .insert(taxReturnArchive)
            .values(insertTaxReturn)
            .returning();
        return taxReturn;
    }
    // Compliance Tasks
    async getComplianceTasks(companyId) {
        return await db
            .select()
            .from(complianceTasks)
            .where(eq(complianceTasks.companyId, companyId))
            .orderBy(complianceTasks.dueDate);
    }
    async getComplianceTask(id) {
        const [task] = await db.select().from(complianceTasks).where(eq(complianceTasks.id, id));
        return task || undefined;
    }
    async createComplianceTask(insertTask) {
        const [task] = await db
            .insert(complianceTasks)
            .values(insertTask)
            .returning();
        return task;
    }
    async updateComplianceTask(id, data) {
        const [task] = await db
            .update(complianceTasks)
            .set({ ...data, updatedAt: new Date() })
            .where(eq(complianceTasks.id, id))
            .returning();
        return task;
    }
    async deleteComplianceTask(id) {
        await db.delete(complianceTasks).where(eq(complianceTasks.id, id));
    }
    // Messages
    async getMessages(companyId) {
        return await db
            .select()
            .from(messages)
            .where(eq(messages.companyId, companyId))
            .orderBy(desc(messages.createdAt));
    }
    async getMessage(id) {
        const [message] = await db.select().from(messages).where(eq(messages.id, id));
        return message || undefined;
    }
    async createMessage(insertMessage) {
        const [message] = await db
            .insert(messages)
            .values(insertMessage)
            .returning();
        return message;
    }
    async markMessageAsRead(id) {
        const [message] = await db
            .update(messages)
            .set({ isRead: true, readAt: new Date() })
            .where(eq(messages.id, id))
            .returning();
        return message;
    }
    // News Items
    async getNewsItems() {
        return await db
            .select()
            .from(newsItems)
            .where(eq(newsItems.isActive, true))
            .orderBy(desc(newsItems.publishedAt));
    }
    async createNewsItem(insertNews) {
        const [news] = await db
            .insert(newsItems)
            .values(insertNews)
            .returning();
        return news;
    }
    // Invitations (Admin)
    async getInvitations() {
        return await db
            .select()
            .from(invitations)
            .orderBy(desc(invitations.createdAt));
    }
    async getInvitationsByCompany(companyId) {
        return await db
            .select()
            .from(invitations)
            .where(eq(invitations.companyId, companyId))
            .orderBy(desc(invitations.createdAt));
    }
    async getInvitationByToken(token) {
        const [invitation] = await db
            .select()
            .from(invitations)
            .where(eq(invitations.token, token));
        return invitation || undefined;
    }
    async getInvitationByEmail(email) {
        const [invitation] = await db
            .select()
            .from(invitations)
            .where(eq(invitations.email, email));
        return invitation || undefined;
    }
    async createInvitation(insertInvitation) {
        const [invitation] = await db
            .insert(invitations)
            .values(insertInvitation)
            .returning();
        return invitation;
    }
    async updateInvitation(id, data) {
        const [invitation] = await db
            .update(invitations)
            .set(data)
            .where(eq(invitations.id, id))
            .returning();
        return invitation;
    }
    async deleteInvitation(id) {
        await db.delete(invitations).where(eq(invitations.id, id));
    }
    // Activity Logs (Admin)
    async getActivityLogs(limit = 100) {
        return await db
            .select()
            .from(activityLogs)
            .orderBy(desc(activityLogs.createdAt))
            .limit(limit);
    }
    async getActivityLogsByCompany(companyId, limit = 100) {
        return await db
            .select()
            .from(activityLogs)
            .where(eq(activityLogs.companyId, companyId))
            .orderBy(desc(activityLogs.createdAt))
            .limit(limit);
    }
    async getActivityLogsByUser(userId, limit = 100) {
        return await db
            .select()
            .from(activityLogs)
            .where(eq(activityLogs.userId, userId))
            .orderBy(desc(activityLogs.createdAt))
            .limit(limit);
    }
    async createActivityLog(insertLog) {
        const [log] = await db
            .insert(activityLogs)
            .values(insertLog)
            .returning();
        return log;
    }
    // Client Notes (Admin)
    async getClientNotes(companyId) {
        return await db
            .select()
            .from(clientNotes)
            .where(eq(clientNotes.companyId, companyId))
            .orderBy(desc(clientNotes.createdAt));
    }
    async createClientNote(insertNote) {
        const [note] = await db
            .insert(clientNotes)
            .values(insertNote)
            .returning();
        return note;
    }
    async updateClientNote(id, data) {
        const [note] = await db
            .update(clientNotes)
            .set({ ...data, updatedAt: new Date() })
            .where(eq(clientNotes.id, id))
            .returning();
        return note;
    }
    async deleteClientNote(id) {
        await db.delete(clientNotes).where(eq(clientNotes.id, id));
    }
    // Admin User Management
    async updateUser(id, data) {
        const [user] = await db
            .update(users)
            .set(data)
            .where(eq(users.id, id))
            .returning();
        return user;
    }
    async deleteUser(id) {
        await db.delete(users).where(eq(users.id, id));
    }
    // Admin Company Management
    async deleteCompany(id) {
        await db.delete(companies).where(eq(companies.id, id));
    }
    // Client Engagements
    async getEngagements() {
        return await db
            .select()
            .from(engagements)
            .orderBy(desc(engagements.createdAt));
    }
    async getEngagementsByCompany(companyId) {
        return await db
            .select()
            .from(engagements)
            .where(eq(engagements.companyId, companyId))
            .orderBy(desc(engagements.createdAt));
    }
    async getEngagement(id) {
        const [engagement] = await db
            .select()
            .from(engagements)
            .where(eq(engagements.id, id));
        return engagement || undefined;
    }
    async createEngagement(insertEngagement) {
        const [engagement] = await db
            .insert(engagements)
            .values(insertEngagement)
            .returning();
        return engagement;
    }
    async updateEngagement(id, data) {
        const [engagement] = await db
            .update(engagements)
            .set({ ...data, updatedAt: new Date() })
            .where(eq(engagements.id, id))
            .returning();
        return engagement;
    }
    async deleteEngagement(id) {
        await db.delete(engagements).where(eq(engagements.id, id));
    }
    // Service Invoices (NR billing to clients)
    async getServiceInvoices(companyId) {
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
    async getServiceInvoice(id) {
        const [invoice] = await db
            .select()
            .from(serviceInvoices)
            .where(eq(serviceInvoices.id, id));
        return invoice || undefined;
    }
    async createServiceInvoice(insertInvoice) {
        const [invoice] = await db
            .insert(serviceInvoices)
            .values(insertInvoice)
            .returning();
        return invoice;
    }
    async updateServiceInvoice(id, data) {
        const [invoice] = await db
            .update(serviceInvoices)
            .set({ ...data, updatedAt: new Date() })
            .where(eq(serviceInvoices.id, id))
            .returning();
        return invoice;
    }
    async deleteServiceInvoice(id) {
        await db.delete(serviceInvoices).where(eq(serviceInvoices.id, id));
    }
    // Service Invoice Lines
    async getServiceInvoiceLines(serviceInvoiceId) {
        return await db
            .select()
            .from(serviceInvoiceLines)
            .where(eq(serviceInvoiceLines.serviceInvoiceId, serviceInvoiceId));
    }
    async createServiceInvoiceLine(insertLine) {
        const [line] = await db
            .insert(serviceInvoiceLines)
            .values(insertLine)
            .returning();
        return line;
    }
    async deleteServiceInvoiceLines(serviceInvoiceId) {
        await db.delete(serviceInvoiceLines).where(eq(serviceInvoiceLines.serviceInvoiceId, serviceInvoiceId));
    }
    // FTA Emails
    async getFtaEmails(companyId) {
        return await db
            .select()
            .from(ftaEmails)
            .where(eq(ftaEmails.companyId, companyId))
            .orderBy(desc(ftaEmails.receivedAt));
    }
    async createFtaEmail(insertEmail) {
        const [email] = await db
            .insert(ftaEmails)
            .values(insertEmail)
            .returning();
        return email;
    }
    async updateFtaEmail(id, data) {
        const [email] = await db
            .update(ftaEmails)
            .set(data)
            .where(eq(ftaEmails.id, id))
            .returning();
        return email;
    }
    // Customer Subscriptions
    async getSubscription(companyId) {
        const [subscription] = await db
            .select()
            .from(subscriptions)
            .where(eq(subscriptions.companyId, companyId));
        return subscription || undefined;
    }
    async createSubscription(insertSubscription) {
        const [subscription] = await db
            .insert(subscriptions)
            .values(insertSubscription)
            .returning();
        return subscription;
    }
    async updateSubscription(id, data) {
        const [subscription] = await db
            .update(subscriptions)
            .set({ ...data, updatedAt: new Date() })
            .where(eq(subscriptions.id, id))
            .returning();
        return subscription;
    }
    // User type management
    async updateUserType(id, userType) {
        const [user] = await db
            .update(users)
            .set({ userType })
            .where(eq(users.id, id))
            .returning();
        return user;
    }
    async getUsersByType(userType) {
        return await db
            .select()
            .from(users)
            .where(eq(users.userType, userType))
            .orderBy(desc(users.createdAt));
    }
    async getClientCompanies() {
        return await db
            .select()
            .from(companies)
            .where(eq(companies.companyType, 'client'))
            .orderBy(desc(companies.createdAt));
    }
    async getCustomerCompanies() {
        return await db
            .select()
            .from(companies)
            .where(eq(companies.companyType, 'customer'))
            .orderBy(desc(companies.createdAt));
    }
    // Backups
    async getBackupsByCompanyId(companyId) {
        return await db
            .select()
            .from(backups)
            .where(eq(backups.companyId, companyId))
            .orderBy(desc(backups.createdAt));
    }
    async getBackup(id) {
        const [backup] = await db.select().from(backups).where(eq(backups.id, id));
        return backup || undefined;
    }
    async createBackup(insertBackup) {
        const [backup] = await db
            .insert(backups)
            .values(insertBackup)
            .returning();
        return backup;
    }
    async updateBackup(id, data) {
        const [backup] = await db
            .update(backups)
            .set(data)
            .where(eq(backups.id, id))
            .returning();
        return backup;
    }
    async deleteBackup(id) {
        await db.delete(backups).where(eq(backups.id, id));
    }
}
export const storage = new DatabaseStorage();
