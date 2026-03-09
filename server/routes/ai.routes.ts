import type { Request, Response } from 'express';
import { Router } from 'express';
import type { Express } from 'express';
import OpenAI from 'openai';
import { z } from 'zod';

import { storage } from '../storage';
import { authMiddleware, requireCustomer } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';
import { getEnv } from '../config/env';
import { createLogger } from '../config/logger';
import { categorizationRequestSchema } from '../../shared/schema';

const log = createLogger('ai');

// =============================================
// AI client initialisation
// =============================================

function createOpenAIClient() {
  return new OpenAI({
    apiKey: getEnv().OPENAI_API_KEY,
  });
}

function getAIModel(): string {
  return getEnv().AI_MODEL;
}

// =============================================
// Register AI routes
// =============================================

export function registerAIRoutes(app: Express) {
  const openai = createOpenAIClient();
  const AI_MODEL = getAIModel();

  // =====================================
  // AI Categorization Route
  // =====================================

  // Customer-only: AI expense categorization
  app.post("/api/ai/categorize", authMiddleware, requireCustomer, asyncHandler(async (req: Request, res: Response) => {
    try {
      const validated = categorizationRequestSchema.parse(req.body);
      const userId = (req as any).user.id;

      // Verify company access
      const hasAccess = await storage.hasCompanyAccess(userId, validated.companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: 'Access denied' });
      }

      // Get company's Chart of Accounts
      const accounts = await storage.getAccountsByCompanyId(validated.companyId);
      const expenseAccounts = accounts.filter(a => a.type === 'expense');

      // Build account list for AI prompt
      const accountList = expenseAccounts.map(acc =>
        `${acc.nameEn}${acc.nameAr ? ` (${acc.nameAr})` : ''}`
      ).join('\n');

      // Use OpenAI to categorize the expense
      const completion = await openai.chat.completions.create({
        model: AI_MODEL,
        messages: [
          {
            role: "system",
            content: `You are an expert accountant specializing in UAE business expenses. Your task is to categorize expenses into the appropriate account from the Chart of Accounts.

Available expense accounts:
${accountList}

Analyze the transaction description and amount, then respond with a JSON object containing:
- accountCode: the most appropriate account code
- accountName: the English name of the account
- confidence: a number between 0 and 1 indicating how confident you are
- reason: a brief explanation (1-2 sentences) of why you chose this account

Consider UAE-specific patterns like DEWA (utilities), Careem/Uber (transport), du/Etisalat (telecom), etc.`
          },
          {
            role: "user",
            content: `Categorize this transaction:
Description: ${validated.description}
Amount: ${validated.amount} ${validated.currency}`
          }
        ],
        response_format: { type: "json_object" },
        temperature: 0.3,
      });

      const aiResponse = JSON.parse(completion.choices[0].message.content || '{}');

      res.json({
        suggestedAccountCode: aiResponse.accountCode,
        suggestedAccountName: aiResponse.accountName,
        confidence: aiResponse.confidence,
        reason: aiResponse.reason,
      });
    } catch (error: any) {
      console.error('AI categorization error:', error);
      res.status(500).json({ message: error.message || 'AI categorization failed' });
    }
  }));

  // AI Bank Statement Parser Route
  app.post("/api/ai/parse-bank-statement", authMiddleware, asyncHandler(async (req: Request, res: Response) => {
    try {
      const { text } = req.body;

      if (!text || text.trim().length < 10) {
        return res.status(400).json({ message: 'Bank statement text is required' });
      }

      // Use OpenAI to parse bank statement transactions
      const completion = await openai.chat.completions.create({
        model: AI_MODEL,
        messages: [
          {
            role: "system",
            content: `You are an expert at parsing bank statements from UAE banks. Extract transaction data from the provided text which was extracted from a PDF bank statement.

Your task is to identify and extract all financial transactions found in the text. For each transaction, extract:
- date: The transaction date in YYYY-MM-DD format (convert from any format found)
- description: A clean description of the transaction
- amount: The transaction amount as a number (negative for debits/withdrawals, positive for credits/deposits)
- reference: Any reference number if available, otherwise null

Important notes:
- The text may be OCR output so expect some errors - try to interpret the data intelligently
- UAE banks include: ENBD, Mashreq, FAB, ADCB, RAKBANK, Dubai Islamic Bank, etc.
- Common patterns: ATM withdrawals, POS purchases, salary credits, transfers, utility payments (DEWA, du, Etisalat)
- If amounts are in parentheses or marked DR/CR, interpret correctly (DR = debit = negative)
- Dates may be in various formats: DD/MM/YYYY, DD-MMM-YYYY, etc.

Respond with a JSON object containing:
{
  "transactions": [
    { "date": "YYYY-MM-DD", "description": "...", "amount": number, "reference": "..." or null },
    ...
  ]
}

If no valid transactions can be found, return { "transactions": [] }`
          },
          {
            role: "user",
            content: `Parse the following bank statement text and extract all transactions:\n\n${text.substring(0, 15000)}`
          }
        ],
        response_format: { type: "json_object" },
        temperature: 0.2,
      });

      const aiResponse = JSON.parse(completion.choices[0].message.content || '{"transactions": []}');

      // Validate and clean up transactions
      const validTransactions = (aiResponse.transactions || []).filter((t: any) => {
        return t.date && t.description && typeof t.amount === 'number' && !isNaN(t.amount);
      }).map((t: any) => ({
        date: t.date,
        description: t.description.substring(0, 200),
        amount: t.amount.toString(),
        reference: t.reference || null,
      }));

      console.log('[AI] Parsed bank statement, found', validTransactions.length, 'transactions');

      res.json({ transactions: validTransactions });
    } catch (error: any) {
      console.error('AI bank statement parsing error:', error);
      res.status(500).json({ message: error.message || 'Failed to parse bank statement' });
    }
  }));

  // AI CFO Advice Route
  app.post("/api/ai/cfo-advice", authMiddleware, asyncHandler(async (req: Request, res: Response) => {
    try {
      const { companyId, question, context } = req.body;

      if (!companyId || !question) {
        return res.status(400).json({ message: 'Company ID and question are required' });
      }

      // Get additional company data for context
      const company = await storage.getCompany(companyId);
      const accounts = await storage.getAccountsByCompanyId(companyId);
      const invoices = await storage.getInvoicesByCompanyId(companyId);
      const receipts = await storage.getReceiptsByCompanyId(companyId);

      // Build financial context from actual data
      const financialContext = {
        companyName: company?.name,
        totalRevenue: context?.profitLoss?.totalRevenue || context?.stats?.revenue || 0,
        totalExpenses: context?.profitLoss?.totalExpenses || context?.stats?.expenses || 0,
        netProfit: context?.profitLoss?.netProfit || 0,
        totalInvoices: invoices.length,
        outstandingInvoices: invoices.filter(i => i.status === 'sent' || i.status === 'draft').length,
        outstandingAmount: invoices.filter(i => i.status === 'sent' || i.status === 'draft')
          .reduce((sum, i) => sum + i.total, 0),
        totalReceipts: receipts.length,
        postedReceipts: receipts.filter(r => r.posted).length,
        accountCount: accounts.length,
      };

      // Use OpenAI to provide CFO advice
      const completion = await openai.chat.completions.create({
        model: AI_MODEL,
        messages: [
          {
            role: "system",
            content: `You are an experienced CFO and financial advisor specializing in UAE businesses. You provide strategic financial advice based on real business data.

Company Financial Context:
- Company: ${financialContext.companyName || 'Your Business'}
- Total Revenue: AED ${(financialContext.totalRevenue || 0).toLocaleString()}
- Total Expenses: AED ${(financialContext.totalExpenses || 0).toLocaleString()}
- Net Profit: AED ${(financialContext.netProfit || 0).toLocaleString()}
- Total Invoices: ${financialContext.totalInvoices || 0}
- Outstanding Invoices: ${financialContext.outstandingInvoices || 0} (AED ${(financialContext.outstandingAmount || 0).toLocaleString()})
- Receipts Processed: ${financialContext.totalReceipts || 0} (${financialContext.postedReceipts || 0} posted)
- Chart of Accounts: ${financialContext.accountCount || 0} accounts

Your role is to:
1. Provide actionable financial advice specific to UAE businesses
2. Identify trends, risks, and opportunities in the data
3. Suggest concrete steps to improve financial health
4. Consider UAE-specific factors like VAT, corporate tax, and local business practices
5. Be concise but thorough (2-4 paragraphs)
6. Use specific numbers from the context when relevant

Keep your tone professional but friendly, like a trusted advisor.`
          },
          {
            role: "user",
            content: question
          }
        ],
        temperature: 0.7,
        max_tokens: 800,
      });

      res.json({
        advice: completion.choices[0].message.content,
        context: financialContext,
      });
    } catch (error: any) {
      console.error('AI CFO advice error:', error);
      res.status(500).json({ message: error.message || 'Failed to get AI advice' });
    }
  }));

  // =====================================
  // AI-Driven Automation Features
  // =====================================

  // Enhanced AI Batch Transaction Categorization
  app.post("/api/ai/batch-categorize", authMiddleware, requireCustomer, asyncHandler(async (req: Request, res: Response) => {
    try {
      const { companyId, transactions } = req.body;
      const userId = (req as any).user.id;

      if (!companyId || !transactions || !Array.isArray(transactions)) {
        return res.status(400).json({ message: 'Company ID and transactions array required' });
      }

      // Verify company access
      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: 'Access denied' });
      }

      const accounts = await storage.getAccountsByCompanyId(companyId);
      const expenseAccounts = accounts.filter(a => a.type === 'expense');
      const incomeAccounts = accounts.filter(a => a.type === 'income');
      const allAccounts = [...expenseAccounts, ...incomeAccounts];

      const accountList = allAccounts.map(acc =>
        `${acc.nameEn} (${acc.type})${acc.nameAr ? ` - ${acc.nameAr}` : ''}`
      ).join('\n');

      // Get previous classifications for learning context
      const previousClassifications = await storage.getTransactionClassificationsByCompanyId(companyId);
      const learningContext = previousClassifications
        .filter(c => c.wasAccepted === true)
        .slice(0, 20)
        .map(c => `"${c.description}" -> ${c.suggestedCategory}`)
        .join('\n');

      const transactionList = transactions.map((t: any, i: number) =>
        `${i + 1}. ${t.description} - Amount: ${t.amount} ${t.currency || 'AED'}`
      ).join('\n');

      const completion = await openai.chat.completions.create({
        model: AI_MODEL,
        messages: [
          {
            role: "system",
            content: `You are an expert UAE accountant specializing in transaction categorization using machine learning principles.

Available accounts:
${accountList}

${learningContext ? `Previous learned patterns (user-confirmed):
${learningContext}` : ''}

Categorize each transaction based on:
1. UAE-specific vendor patterns (DEWA, du, Etisalat, Careem, RTA, ENOC, ADNOC, etc.)
2. Amount patterns and transaction context
3. Previous user-confirmed categorizations

Respond with a JSON object:
{
  "classifications": [
    {
      "index": 0,
      "accountName": "suggested account name",
      "category": "expense or income category",
      "confidence": 0.95,
      "reason": "brief explanation",
      "flags": ["unusual_amount", "duplicate_risk"] // optional warnings
    }
  ]
}`
          },
          {
            role: "user",
            content: `Categorize these transactions:\n${transactionList}`
          }
        ],
        response_format: { type: "json_object" },
        temperature: 0.2,
      });

      const aiResponse = JSON.parse(completion.choices[0].message.content || '{}');

      // Store classifications for learning
      for (const classification of aiResponse.classifications || []) {
        const transaction = transactions[classification.index];
        if (transaction) {
          await storage.createTransactionClassification({
            companyId,
            description: transaction.description,
            merchant: transaction.merchant,
            amount: transaction.amount,
            suggestedCategory: classification.category,
            aiConfidence: classification.confidence,
            aiReason: classification.reason,
          });
        }
      }

      res.json(aiResponse);
    } catch (error: any) {
      console.error('Batch categorization error:', error);
      res.status(500).json({ message: error.message || 'Batch categorization failed' });
    }
  }));

  // Anomaly & Duplicate Detection
  app.post("/api/ai/detect-anomalies", authMiddleware, requireCustomer, asyncHandler(async (req: Request, res: Response) => {
    try {
      const { companyId } = req.body;
      const userId = (req as any).user.id;

      if (!companyId) {
        return res.status(400).json({ message: 'Company ID required' });
      }

      // Verify company access
      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: 'Access denied' });
      }

      const invoices = await storage.getInvoicesByCompanyId(companyId);
      const receipts = await storage.getReceiptsByCompanyId(companyId);
      const entries = await storage.getJournalEntriesByCompanyId(companyId);

      // Prepare transaction data for analysis
      const transactionData = {
        invoices: invoices.map(i => ({
          id: i.id,
          type: 'invoice',
          customerName: i.customerName,
          amount: i.total,
          date: i.date,
          number: i.number,
        })),
        expenses: receipts.map(r => ({
          id: r.id,
          type: 'receipt',
          merchant: r.merchant,
          amount: r.amount,
          date: r.date,
          category: r.category,
        })),
      };

      const completion = await openai.chat.completions.create({
        model: AI_MODEL,
        messages: [
          {
            role: "system",
            content: `You are an AI fraud detection and anomaly detection system for UAE business accounting.

Analyze transactions for:
1. **Duplicates**: Same amount + similar date + same vendor/customer
2. **Unusual amounts**: Transactions significantly higher/lower than typical patterns
3. **Timing anomalies**: Transactions at unusual times or frequencies
4. **Category mismatches**: Expenses that don't match their category
5. **Potential fraud indicators**: Round numbers, weekend transactions, etc.

Respond with JSON:
{
  "anomalies": [
    {
      "type": "duplicate|unusual_amount|timing|category_mismatch|potential_fraud",
      "severity": "low|medium|high|critical",
      "title": "Brief title",
      "description": "Detailed explanation",
      "entityType": "invoice|receipt",
      "entityId": "uuid",
      "duplicateOfId": "uuid if duplicate",
      "confidence": 0.85
    }
  ],
  "summary": {
    "totalAnomalies": 5,
    "criticalCount": 1,
    "potentialDuplicates": 2,
    "unusualTransactions": 2
  }
}`
          },
          {
            role: "user",
            content: `Analyze these transactions for anomalies:\n${JSON.stringify(transactionData, null, 2)}`
          }
        ],
        response_format: { type: "json_object" },
        temperature: 0.1,
      });

      const aiResponse = JSON.parse(completion.choices[0].message.content || '{}');

      // Store detected anomalies
      for (const anomaly of aiResponse.anomalies || []) {
        await storage.createAnomalyAlert({
          companyId,
          type: anomaly.type,
          severity: anomaly.severity,
          title: anomaly.title,
          description: anomaly.description,
          relatedEntityType: anomaly.entityType,
          relatedEntityId: anomaly.entityId,
          duplicateOfId: anomaly.duplicateOfId,
          aiConfidence: anomaly.confidence,
        });
      }

      res.json(aiResponse);
    } catch (error: any) {
      console.error('Anomaly detection error:', error);
      res.status(500).json({ message: error.message || 'Anomaly detection failed' });
    }
  }));

  // Get Anomaly Alerts
  app.get("/api/companies/:companyId/anomaly-alerts", authMiddleware, requireCustomer, asyncHandler(async (req: Request, res: Response) => {
    try {
      const { companyId } = req.params;
      const { resolved } = req.query;
      const userId = (req as any).user.id;

      // Verify company access
      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: 'Access denied' });
      }

      let alerts;
      if (resolved === 'false') {
        alerts = await storage.getUnresolvedAnomalyAlerts(companyId);
      } else {
        alerts = await storage.getAnomalyAlertsByCompanyId(companyId);
      }

      res.json(alerts);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  }));

  // Resolve Anomaly Alert
  app.post("/api/anomaly-alerts/:id/resolve", authMiddleware, requireCustomer, asyncHandler(async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { note } = req.body;
      const userId = (req as any).user?.id;

      // Get alert to verify company access
      const alert = await storage.getAnomalyAlertById(id);
      if (!alert) {
        return res.status(404).json({ message: 'Alert not found' });
      }

      const hasAccess = await storage.hasCompanyAccess(userId, alert.companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: 'Access denied' });
      }

      const resolvedAlert = await storage.resolveAnomalyAlert(id, userId, note);
      res.json(resolvedAlert);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  }));

  // AI-Assisted Bank Reconciliation
  app.post("/api/ai/reconcile", authMiddleware, requireCustomer, asyncHandler(async (req: Request, res: Response) => {
    try {
      const { companyId } = req.body;
      const userId = (req as any).user.id;

      if (!companyId) {
        return res.status(400).json({ message: 'Company ID required' });
      }

      // Verify company access
      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: 'Access denied' });
      }

      const bankTransactions = await storage.getUnreconciledBankTransactions(companyId);
      const invoices = await storage.getInvoicesByCompanyId(companyId);
      const receipts = await storage.getReceiptsByCompanyId(companyId);
      const journalEntries = await storage.getJournalEntriesByCompanyId(companyId);

      if (bankTransactions.length === 0) {
        return res.json({ matches: [], message: 'No unreconciled transactions' });
      }

      // Prepare data for AI matching
      const bankData = bankTransactions.map(t => ({
        id: t.id,
        date: t.transactionDate,
        description: t.description,
        amount: t.amount,
        reference: t.reference,
      }));

      const ledgerData = {
        invoices: invoices.filter(i => i.status === 'sent' || i.status === 'paid').map(i => ({
          id: i.id,
          type: 'invoice',
          customerName: i.customerName,
          amount: i.total,
          date: i.date,
          number: i.number,
        })),
        expenses: receipts.filter(r => !r.posted).map(r => ({
          id: r.id,
          type: 'receipt',
          merchant: r.merchant,
          amount: r.amount,
          date: r.date,
        })),
      };

      const completion = await openai.chat.completions.create({
        model: AI_MODEL,
        messages: [
          {
            role: "system",
            content: `You are an AI bank reconciliation assistant for UAE businesses.

Match bank transactions to ledger records based on:
1. Amount matching (exact or within AED 1 tolerance for fees)
2. Date proximity (within 3 business days)
3. Description/reference matching
4. Customer/vendor name matching

For each match, provide:
- Confidence score (0-1)
- Match reason
- Suggested action

Respond with JSON:
{
  "matches": [
    {
      "bankTransactionId": "uuid",
      "matchedEntityId": "uuid",
      "matchType": "invoice|receipt|journal",
      "confidence": 0.95,
      "reason": "Exact amount match with customer name",
      "suggestedAction": "Auto-reconcile" | "Manual review needed"
    }
  ],
  "unmatched": [
    {
      "bankTransactionId": "uuid",
      "suggestedCategory": "expense category",
      "reason": "No matching ledger entry found"
    }
  ]
}`
          },
          {
            role: "user",
            content: `Match these bank transactions to ledger entries:

Bank Transactions:
${JSON.stringify(bankData, null, 2)}

Ledger Records:
${JSON.stringify(ledgerData, null, 2)}`
          }
        ],
        response_format: { type: "json_object" },
        temperature: 0.1,
      });

      const aiResponse = JSON.parse(completion.choices[0].message.content || '{}');
      res.json(aiResponse);
    } catch (error: any) {
      console.error('Reconciliation error:', error);
      res.status(500).json({ message: error.message || 'Reconciliation failed' });
    }
  }));

  // Apply Reconciliation Match
  app.post("/api/bank-transactions/:id/reconcile", authMiddleware, asyncHandler(async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const userId = (req as any).user?.id;
      // Support both matchId (frontend) and matchedId (legacy) parameter names
      const matchId = req.body.matchId || req.body.matchedId;
      const { matchType } = req.body;

      if (!matchId || !matchType) {
        return res.status(400).json({ message: 'matchId and matchType are required' });
      }

      // Verify user has access to the company that owns this transaction
      const txn = await storage.getBankTransactionById(id);
      if (!txn) {
        return res.status(404).json({ message: 'Transaction not found' });
      }

      const hasAccess = await storage.hasCompanyAccess(userId, txn.companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: 'Access denied' });
      }

      const transaction = await storage.reconcileBankTransaction(id, matchId, matchType);
      res.json(transaction);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  }));

  // Bank Transactions CRUD
  app.get("/api/companies/:companyId/bank-transactions", authMiddleware, requireCustomer, asyncHandler(async (req: Request, res: Response) => {
    try {
      const { companyId } = req.params;
      const userId = (req as any).user.id;

      // Verify company access
      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: 'Access denied' });
      }

      const transactions = await storage.getBankTransactionsByCompanyId(companyId);
      res.json(transactions);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  }));

  app.post("/api/companies/:companyId/bank-transactions", authMiddleware, requireCustomer, asyncHandler(async (req: Request, res: Response) => {
    try {
      const { companyId } = req.params;
      const userId = (req as any).user.id;

      // Verify company access
      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: 'Access denied' });
      }

      const transaction = await storage.createBankTransaction({
        ...req.body,
        companyId,
      });
      res.json(transaction);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  }));

  // Import bank transactions from CSV
  app.post("/api/companies/:companyId/bank-transactions/import", authMiddleware, requireCustomer, asyncHandler(async (req: Request, res: Response) => {
    try {
      const { companyId } = req.params;
      const { transactions } = req.body;
      const userId = (req as any).user.id;

      // Verify company access
      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: 'Access denied' });
      }

      if (!Array.isArray(transactions)) {
        return res.status(400).json({ message: 'Transactions array required' });
      }

      const imported = [];
      for (const t of transactions) {
        const transaction = await storage.createBankTransaction({
          companyId,
          transactionDate: new Date(t.date),
          description: t.description,
          amount: parseFloat(t.amount),
          reference: t.reference,
          importSource: 'csv',
        });
        imported.push(transaction);
      }

      res.json({ imported: imported.length, transactions: imported });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  }));

  // Predictive Cash Flow Forecasting
  app.post("/api/ai/forecast-cashflow", authMiddleware, requireCustomer, asyncHandler(async (req: Request, res: Response) => {
    try {
      const { companyId, forecastMonths = 3 } = req.body;
      const userId = (req as any).user.id;

      if (!companyId) {
        return res.status(400).json({ message: 'Company ID required' });
      }

      // Verify company access
      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: 'Access denied' });
      }

      const invoices = await storage.getInvoicesByCompanyId(companyId);
      const receipts = await storage.getReceiptsByCompanyId(companyId);
      const entries = await storage.getJournalEntriesByCompanyId(companyId);

      // Calculate historical patterns
      const now = new Date();
      const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 6, 1);

      const recentInvoices = invoices.filter(i => new Date(i.date) >= sixMonthsAgo);
      const recentReceipts = receipts.filter(r => r.date && new Date(r.date) >= sixMonthsAgo);

      const monthlyInflow = recentInvoices.reduce((sum, i) => sum + i.total, 0) / 6;
      const monthlyOutflow = recentReceipts.reduce((sum, r) => sum + (r.amount || 0), 0) / 6;

      const historicalData = {
        averageMonthlyRevenue: monthlyInflow,
        averageMonthlyExpenses: monthlyOutflow,
        totalInvoices: invoices.length,
        paidInvoices: invoices.filter(i => i.status === 'paid').length,
        pendingReceivables: invoices
          .filter(i => i.status === 'sent')
          .reduce((sum, i) => sum + i.total, 0),
        recentMonths: Array.from({ length: 6 }, (_, i) => {
          const month = new Date(now.getFullYear(), now.getMonth() - i, 1);
          const monthInvoices = recentInvoices.filter(inv => {
            const d = new Date(inv.date);
            return d.getMonth() === month.getMonth() && d.getFullYear() === month.getFullYear();
          });
          const monthReceipts = recentReceipts.filter(r => {
            if (!r.date) return false;
            const d = new Date(r.date);
            return d.getMonth() === month.getMonth() && d.getFullYear() === month.getFullYear();
          });
          return {
            month: month.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
            revenue: monthInvoices.reduce((s, i) => s + i.total, 0),
            expenses: monthReceipts.reduce((s, r) => s + (r.amount || 0), 0),
          };
        }).reverse(),
      };

      const completion = await openai.chat.completions.create({
        model: AI_MODEL,
        messages: [
          {
            role: "system",
            content: `You are an AI financial forecasting system for UAE businesses.

Analyze historical financial data and provide:
1. Cash flow predictions for the next ${forecastMonths} months
2. Key trends and patterns
3. Risk factors and opportunities
4. Actionable recommendations

Consider UAE-specific factors:
- VAT payment cycles (quarterly)
- Corporate tax considerations
- Seasonal business patterns

Respond with JSON:
{
  "forecasts": [
    {
      "month": "Jan 2025",
      "predictedInflow": 50000,
      "predictedOutflow": 35000,
      "predictedBalance": 15000,
      "confidence": 0.85
    }
  ],
  "trends": [
    {
      "type": "positive|negative|neutral",
      "title": "Trend title",
      "description": "Explanation",
      "impact": "high|medium|low"
    }
  ],
  "recommendations": [
    {
      "priority": "high|medium|low",
      "title": "Recommendation",
      "description": "Action details",
      "expectedImpact": "Expected outcome"
    }
  ],
  "riskFactors": [
    {
      "severity": "high|medium|low",
      "factor": "Risk description",
      "mitigation": "Suggested action"
    }
  ]
}`
          },
          {
            role: "user",
            content: `Forecast cash flow for ${forecastMonths} months based on this data:\n${JSON.stringify(historicalData, null, 2)}`
          }
        ],
        response_format: { type: "json_object" },
        temperature: 0.3,
      });

      const aiResponse = JSON.parse(completion.choices[0].message.content || '{}');

      // Clear old forecasts and store new ones
      await storage.deleteCashFlowForecastsByCompanyId(companyId);

      for (const forecast of aiResponse.forecasts || []) {
        await storage.createCashFlowForecast({
          companyId,
          forecastDate: new Date(forecast.month),
          forecastType: 'monthly',
          predictedInflow: forecast.predictedInflow,
          predictedOutflow: forecast.predictedOutflow,
          predictedBalance: forecast.predictedBalance,
          confidenceLevel: forecast.confidence,
        });
      }

      res.json({
        ...aiResponse,
        historicalData,
      });
    } catch (error: any) {
      console.error('Cash flow forecast error:', error);
      res.status(500).json({ message: error.message || 'Forecasting failed' });
    }
  }));

  // Get stored forecasts
  app.get("/api/companies/:companyId/forecasts", authMiddleware, asyncHandler(async (req: Request, res: Response) => {
    try {
      const { companyId } = req.params;
      const forecasts = await storage.getCashFlowForecastsByCompanyId(companyId);
      res.json(forecasts);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  }));

  // Transaction Classification Feedback (for ML learning)
  app.post("/api/ai/classification-feedback", authMiddleware, asyncHandler(async (req: Request, res: Response) => {
    try {
      const { classificationId, wasAccepted, userSelectedAccountId } = req.body;

      const classification = await storage.updateTransactionClassification(classificationId, {
        wasAccepted,
        userSelectedAccountId,
      });

      res.json(classification);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  }));

  // =====================================
  // Natural Language Gateway Routes
  // =====================================

  // Main Natural Language Query Endpoint
  app.post("/api/ai/nl-gateway", authMiddleware, asyncHandler(async (req: Request, res: Response) => {
    try {
      const { companyId, message, locale = 'en', context = {} } = req.body;
      const userId = (req as any).user.id;

      if (!companyId || !message) {
        return res.status(400).json({ message: 'Company ID and message are required' });
      }

      // Verify company access
      const company = await storage.getCompany(companyId);
      if (!company) {
        return res.status(404).json({ message: 'Company not found' });
      }
      const companyUsers = await storage.getCompanyUsersByCompanyId(companyId);
      if (!companyUsers.some(cu => cu.userId === userId)) {
        return res.status(403).json({ message: 'Access denied' });
      }

      // Gather comprehensive financial context
      const accounts = await storage.getAccountsByCompanyId(companyId);
      const invoices = await storage.getInvoicesByCompanyId(companyId);
      const receipts = await storage.getReceiptsByCompanyId(companyId);
      const entries = await storage.getJournalEntriesByCompanyId(companyId);

      // Calculate account balances
      const accountBalances = new Map<string, { debit: number; credit: number; balance: number }>();
      for (const entry of entries) {
        const lines = await storage.getJournalLinesByEntryId(entry.id);
        for (const line of lines) {
          const current = accountBalances.get(line.accountId) || { debit: 0, credit: 0, balance: 0 };
          current.debit += Number(line.debit) || 0;
          current.credit += Number(line.credit) || 0;
          const account = accounts.find(a => a.id === line.accountId);
          if (account) {
            if (['asset', 'expense'].includes(account.type)) {
              current.balance = current.debit - current.credit;
            } else {
              current.balance = current.credit - current.debit;
            }
          }
          accountBalances.set(line.accountId, current);
        }
      }

      // Prepare financial summary for AI
      const financialSummary = {
        totalRevenue: Array.from(accountBalances.entries())
          .filter(([id]) => accounts.find(a => a.id === id)?.type === 'income')
          .reduce((sum, [, bal]) => sum + bal.balance, 0),
        totalExpenses: Array.from(accountBalances.entries())
          .filter(([id]) => accounts.find(a => a.id === id)?.type === 'expense')
          .reduce((sum, [, bal]) => sum + bal.balance, 0),
        totalAssets: Array.from(accountBalances.entries())
          .filter(([id]) => accounts.find(a => a.id === id)?.type === 'asset')
          .reduce((sum, [, bal]) => sum + bal.balance, 0),
        totalLiabilities: Array.from(accountBalances.entries())
          .filter(([id]) => accounts.find(a => a.id === id)?.type === 'liability')
          .reduce((sum, [, bal]) => sum + bal.balance, 0),
        invoicesSummary: {
          total: invoices.length,
          paid: invoices.filter(i => i.status === 'paid').length,
          pending: invoices.filter(i => i.status === 'sent').length,
          draft: invoices.filter(i => i.status === 'draft').length,
          totalValue: invoices.reduce((sum, i) => sum + Number(i.total), 0),
          outstandingValue: invoices.filter(i => i.status === 'sent').reduce((sum, i) => sum + Number(i.total), 0),
        },
        expensesSummary: {
          total: receipts.length,
          posted: receipts.filter(r => r.journalEntryId).length,
          pending: receipts.filter(r => !r.journalEntryId).length,
          totalAmount: receipts.reduce((sum, r) => sum + Number(r.amount || 0) + Number(r.vatAmount || 0), 0),
        },
        recentInvoices: invoices.slice(-5).map(i => ({
          number: i.number,
          customer: i.customerName,
          amount: i.total,
          status: i.status,
          date: i.date,
        })),
        recentExpenses: receipts.slice(-5).map(r => ({
          merchant: r.merchant,
          amount: (r.amount || 0) + (r.vatAmount || 0),
          category: r.category,
          date: r.date,
        })),
        accounts: accounts.map(a => ({
          name: locale === 'ar' ? a.nameAr : a.nameEn,
          type: a.type,
          balance: accountBalances.get(a.id)?.balance || 0,
        })),
      };

      // Group invoices and expenses by month for trend analysis
      const monthlyData = new Map<string, { revenue: number; expenses: number }>();
      for (const invoice of invoices) {
        const month = new Date(invoice.date).toISOString().slice(0, 7);
        const current = monthlyData.get(month) || { revenue: 0, expenses: 0 };
        current.revenue += Number(invoice.subtotal) || 0;
        monthlyData.set(month, current);
      }
      for (const receipt of receipts) {
        if (receipt.date) {
          const month = new Date(receipt.date).toISOString().slice(0, 7);
          const current = monthlyData.get(month) || { revenue: 0, expenses: 0 };
          current.expenses += (Number(receipt.amount) || 0) + (Number(receipt.vatAmount) || 0);
          monthlyData.set(month, current);
        }
      }

      const systemPrompt = `You are an intelligent bookkeeping assistant for a UAE business. You help users query and manage their financial data using natural language.

CAPABILITIES:
1. QUERY DATA: Answer questions about financial data (sales, expenses, profit, invoices, etc.)
2. PROVIDE INSIGHTS: Give analysis and recommendations based on the financial data
3. SUGGEST ACTIONS: Recommend actions the user could take (but don't execute them directly)

CURRENT FINANCIAL DATA:
${JSON.stringify(financialSummary, null, 2)}

MONTHLY TRENDS:
${JSON.stringify(Object.fromEntries(monthlyData), null, 2)}

RULES:
- Currency is AED (UAE Dirhams), format as "AED X,XXX.XX"
- UAE VAT rate is 5%
- Always be accurate with numbers from the data provided
- If asked about something not in the data, say so clearly
- Be concise but helpful
- Support both English and Arabic (respond in the language of the query)
- Format numbers properly with thousand separators
- For date ranges, interpret "this month" as current calendar month, "last month" as previous calendar month, "this year" as current calendar year
- When suggesting actions, explain what the user should do but don't claim to have done it
- IMPORTANT: When users ask for professional advice, complex accounting guidance, tax planning, or need expert consultation, always encourage them to contact NR Accounting Services at +971507042270 for personalized professional assistance

RESPONSE FORMAT:
Respond naturally in conversational language. Include:
1. Direct answer to the question
2. Relevant context or insights if helpful
3. Suggestions for follow-up questions or actions if appropriate
4. When professional advice is needed, suggest contacting NR Accounting Services at +971507042270

PROFESSIONAL ADVICE GUIDANCE:
Whenever a user asks about:
- Complex tax matters or tax planning
- Legal compliance issues
- Advanced financial strategies
- Business structure advice
- Professional accounting services
- Or any topic requiring expert consultation

Always conclude with: "For personalized professional advice on this matter, I recommend contacting NR Accounting Services at +971507042270. They can provide expert guidance tailored to your specific situation."

Current date: ${new Date().toISOString().split('T')[0]}
Company: ${company.name}`;

      const response = await openai.chat.completions.create({
        model: AI_MODEL,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: message },
        ],
        temperature: 0.7,
        max_tokens: 1000,
      });

      const assistantMessage = response.choices[0]?.message?.content || 'I could not process your request.';

      // Determine intent for UI hints
      let intent = 'query';
      const lowerMessage = message.toLowerCase();
      if (lowerMessage.includes('create') || lowerMessage.includes('add') || lowerMessage.includes('record') || lowerMessage.includes('new')) {
        intent = 'action';
      } else if (lowerMessage.includes('how') || lowerMessage.includes('why') || lowerMessage.includes('recommend') || lowerMessage.includes('suggest')) {
        intent = 'advice';
      }

      // Generate follow-up suggestions based on context
      const followUpPrompts = [];
      if (financialSummary.invoicesSummary.pending > 0) {
        followUpPrompts.push("Show me overdue invoices");
      }
      if (financialSummary.expensesSummary.pending > 0) {
        followUpPrompts.push("What expenses need to be posted?");
      }
      if (financialSummary.totalRevenue > 0) {
        followUpPrompts.push("What's my profit margin this month?");
        followUpPrompts.push("How do my expenses compare to last month?");
      }

      res.json({
        response: assistantMessage,
        intent,
        data: {
          summary: financialSummary,
          monthlyTrends: Object.fromEntries(monthlyData),
        },
        followUpPrompts: followUpPrompts.slice(0, 3),
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      console.error('NL Gateway error:', error);
      res.status(500).json({ message: error.message || 'Failed to process query' });
    }
  }));

  // Enhanced /api/ask endpoint with streaming support
  app.post("/api/ask", authMiddleware, asyncHandler(async (req: Request, res: Response) => {
    const startTime = Date.now();
    let fullResponse = '';
    let conversationId: string | undefined;
    let isStreaming = false; // Track if we're in streaming mode (headers sent)

    try {
      const userId = (req as any).user.id;

      // Validate input with Zod schema
      const validationSchema = z.object({
        message: z.string().min(1, 'Message is required').max(10000, 'Message is too long'),
        companyId: z.string().uuid('Invalid company ID format').optional(),
        model: z.enum(['gpt-3.5-turbo', 'gpt-4', 'gpt-4-turbo']).optional().default('gpt-3.5-turbo'),
        systemPrompt: z.string().max(2000, 'System prompt too long').optional(),
        stream: z.boolean().optional().default(false),
      });

      const validated = validationSchema.parse(req.body);

      // If companyId is provided, verify access
      if (validated.companyId) {
        const hasAccess = await storage.hasCompanyAccess(userId, validated.companyId);
        if (!hasAccess) {
          return res.status(403).json({ message: 'Access denied' });
        }
      }

      // Check if OpenAI API key is configured
      if (!process.env.OPENAI_API_KEY) {
        return res.status(500).json({ message: 'OpenAI API key is not configured' });
      }

      const systemPrompt = validated.systemPrompt ||
        `You are a helpful AI assistant for accounting and financial management. Provide clear, accurate, and professional responses.

IMPORTANT GUIDELINES:
- When users ask for professional advice, complex accounting guidance, tax planning, or need expert consultation, always encourage them to contact NR Accounting Services at +971507042270 for personalized professional assistance.
- For complex tax matters, legal compliance, advanced financial strategies, business structure advice, or any topic requiring expert consultation, always suggest: "For personalized professional advice on this matter, I recommend contacting NR Accounting Services at +971507042270. They can provide expert guidance tailored to your specific situation."`;

      // Setup streaming if requested
      if (validated.stream) {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering
        isStreaming = true; // Mark that headers are committed

        try {
          const stream = await openai.chat.completions.create({
            model: validated.model,
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: validated.message }
            ],
            temperature: 0.7,
            max_tokens: 2000,
            stream: true,
          });

          // Stream the response
          for await (const chunk of stream) {
            const content = chunk.choices[0]?.delta?.content || '';
            if (content) {
              fullResponse += content;
              res.write(`data: ${JSON.stringify({ content, done: false })}\n\n`);
            }
          }
        } catch (streamError: any) {
          // Error occurred during streaming - headers already sent, must use SSE format
          console.error('/api/ask streaming error:', streamError);

          // Send error as SSE message
          const errorMessage = streamError.message || 'An error occurred while streaming the response';
          res.write(`data: ${JSON.stringify({
            error: true,
            message: errorMessage,
            done: true
          })}\n\n`);
          res.end();

          // Store error conversation
          try {
            await storage.createAiConversation({
              userId,
              companyId: validated.companyId || null,
              prompt: validated.message,
              response: fullResponse || 'Error: ' + errorMessage,
              model: validated.model,
              systemPrompt: validated.systemPrompt || null,
              responseTime: Date.now() - startTime,
              error: errorMessage,
            });
          } catch (dbError) {
            console.error('Failed to store error conversation:', dbError);
          }

          return; // Exit early, response already sent
        }

        // Store conversation BEFORE sending completion signal to avoid race condition
        // The client will refetch history when it receives done: true, so we need the
        // conversation to already be in the database at that point
        const responseTime = Date.now() - startTime;
        try {
          await storage.createAiConversation({
            userId,
            companyId: validated.companyId || null,
            prompt: validated.message,
            response: fullResponse,
            model: validated.model,
            systemPrompt: validated.systemPrompt || null,
            responseTime,
          });
        } catch (dbError) {
          console.error('Failed to store conversation:', dbError);
          // Continue even if storage fails - still send completion signal
        }

        // Send completion signal after database storage completes
        res.write(`data: ${JSON.stringify({ content: '', done: true })}\n\n`);
        res.end();
      } else {
        // Non-streaming response
        const response = await openai.chat.completions.create({
          model: validated.model,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: validated.message }
          ],
          temperature: 0.7,
          max_tokens: 2000,
        });

        const assistantMessage = response.choices[0]?.message?.content || 'I could not process your request.';
        const responseTime = Date.now() - startTime;
        const tokensUsed = response.usage?.total_tokens;

        // Store conversation
        const conversation = await storage.createAiConversation({
          userId,
          companyId: validated.companyId || null,
          prompt: validated.message,
          response: assistantMessage,
          model: validated.model,
          systemPrompt: validated.systemPrompt || null,
          responseTime,
          tokensUsed: tokensUsed || null,
        });
        conversationId = conversation.id;

        res.json({
          response: assistantMessage,
          model: validated.model,
          timestamp: new Date().toISOString(),
          conversationId,
          tokensUsed,
          responseTime,
        });
      }
    } catch (error: any) {
      console.error('/api/ask error:', error);

      // Check if headers have already been sent (streaming mode)
      // If headers are committed, we cannot send JSON responses - must use SSE format
      if (isStreaming || res.headersSent) {
        // Headers already committed - send error as SSE message
        const errorMessage = error.message || 'Failed to process request';
        try {
          res.write(`data: ${JSON.stringify({
            error: true,
            message: errorMessage,
            done: true
          })}\n\n`);
          res.end();
        } catch (writeError) {
          // Response already ended or connection closed - log but don't throw
          console.error('Failed to send SSE error message:', writeError);
        }

        // Store error conversation if we have partial data
        // Use optional chaining since validated might not exist if error occurred early
        try {
          const userId = (req as any).user?.id;
          if (userId) {
            await storage.createAiConversation({
              userId,
              companyId: (validated as any)?.companyId || null,
              prompt: (validated as any)?.message || 'Unknown',
              response: fullResponse || 'Error: ' + errorMessage,
              model: (validated as any)?.model || 'gpt-3.5-turbo',
              systemPrompt: (validated as any)?.systemPrompt || null,
              responseTime: Date.now() - startTime,
              error: errorMessage,
            });
          }
        } catch (dbError) {
          console.error('Failed to store error conversation:', dbError);
        }
        return; // Exit early, response already sent
      }

      // Headers not sent yet - can send normal JSON response
      // Handle Zod validation errors
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          message: 'Validation error',
          errors: error.errors.map(e => ({ path: e.path.join('.'), message: e.message }))
        });
      }

      // Handle OpenAI API errors
      if (error.status) {
        const statusCode = error.status >= 400 && error.status < 600 ? error.status : 500;
        return res.status(statusCode).json({
          message: error.message || 'OpenAI API error',
          error: error.error?.message || error.message,
        });
      }

      res.status(500).json({ message: error.message || 'Failed to process request' });
    }
  }));

  // Get conversation history
  app.get("/api/ask/history", authMiddleware, asyncHandler(async (req: Request, res: Response) => {
    try {
      const userId = (req as any).user.id;
      const { companyId } = req.query;
      // Validate and parse limit parameter with fallback, matching pattern used elsewhere
      const limit = parseInt(req.query.limit as string) || 50;

      let conversations;
      if (companyId && typeof companyId === 'string') {
        // Verify access
        const hasAccess = await storage.hasCompanyAccess(userId, companyId);
        if (!hasAccess) {
          return res.status(403).json({ message: 'Access denied' });
        }
        conversations = await storage.getAiConversationsByCompanyId(companyId, limit);
      } else {
        conversations = await storage.getAiConversationsByUserId(userId, limit);
      }

      res.json(conversations);
    } catch (error: any) {
      console.error('/api/ask/history error:', error);
      res.status(500).json({ message: error.message || 'Failed to fetch history' });
    }
  }));

  // Autocomplete endpoints for smart suggestions
  app.get("/api/autocomplete/accounts", authMiddleware, asyncHandler(async (req: Request, res: Response) => {
    try {
      const { companyId, query, type, limit = 10 } = req.query;
      const userId = (req as any).user.id;

      if (!companyId) {
        return res.status(400).json({ message: 'Company ID is required' });
      }

      // Verify company access
      const companyUsers = await storage.getCompanyUsersByCompanyId(companyId as string);
      if (!companyUsers.some(cu => cu.userId === userId)) {
        return res.status(403).json({ message: 'Access denied' });
      }

      let accounts = await storage.getAccountsByCompanyId(companyId as string);

      // Filter by type if specified
      if (type) {
        accounts = accounts.filter(a => a.type === type);
      }

      // Filter by query if specified
      if (query) {
        const q = (query as string).toLowerCase();
        accounts = accounts.filter(a =>
          a.nameEn.toLowerCase().includes(q) ||
          (a.nameAr && a.nameAr.toLowerCase().includes(q))
        );
      }

      // Sort by relevance (exact matches first) and limit
      accounts.sort((a, b) => {
        const qLower = ((query as string) || '').toLowerCase();
        const aExact = a.nameEn.toLowerCase().startsWith(qLower) ? 0 : 1;
        const bExact = b.nameEn.toLowerCase().startsWith(qLower) ? 0 : 1;
        return aExact - bExact;
      });

      res.json(accounts.slice(0, Number(limit)).map(a => ({
        id: a.id,
        nameEn: a.nameEn,
        nameAr: a.nameAr,
        type: a.type,
        description: `${a.type.charAt(0).toUpperCase() + a.type.slice(1)} Account`,
      })));
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  }));

  app.get("/api/autocomplete/customers", authMiddleware, asyncHandler(async (req: Request, res: Response) => {
    try {
      const { companyId, query, limit = 10 } = req.query;
      const userId = (req as any).user.id;

      if (!companyId) {
        return res.status(400).json({ message: 'Company ID is required' });
      }

      // Verify company access
      const companyUsers = await storage.getCompanyUsersByCompanyId(companyId as string);
      if (!companyUsers.some(cu => cu.userId === userId)) {
        return res.status(403).json({ message: 'Access denied' });
      }

      // Get unique customers from invoices
      const invoices = await storage.getInvoicesByCompanyId(companyId as string);
      const customerMap = new Map<string, { name: string; trn: string | null; count: number }>();

      for (const invoice of invoices) {
        const key = invoice.customerName.toLowerCase();
        const existing = customerMap.get(key);
        if (existing) {
          existing.count++;
        } else {
          customerMap.set(key, {
            name: invoice.customerName,
            trn: invoice.customerTrn,
            count: 1,
          });
        }
      }

      let customers = Array.from(customerMap.values());

      // Filter by query if specified
      if (query) {
        const q = (query as string).toLowerCase();
        customers = customers.filter(c =>
          c.name.toLowerCase().includes(q) ||
          c.trn?.toLowerCase().includes(q)
        );
      }

      // Sort by frequency and limit
      customers.sort((a, b) => b.count - a.count);

      res.json(customers.slice(0, Number(limit)).map(c => ({
        name: c.name,
        trn: c.trn,
        invoiceCount: c.count,
      })));
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  }));

  app.get("/api/autocomplete/merchants", authMiddleware, asyncHandler(async (req: Request, res: Response) => {
    try {
      const { companyId, query, limit = 10 } = req.query;
      const userId = (req as any).user.id;

      if (!companyId) {
        return res.status(400).json({ message: 'Company ID is required' });
      }

      // Verify company access
      const companyUsers = await storage.getCompanyUsersByCompanyId(companyId as string);
      if (!companyUsers.some(cu => cu.userId === userId)) {
        return res.status(403).json({ message: 'Access denied' });
      }

      // Get unique merchants from receipts
      const receipts = await storage.getReceiptsByCompanyId(companyId as string);
      const merchantMap = new Map<string, { name: string; category: string | null; count: number; lastAmount: number }>();

      for (const receipt of receipts) {
        if (!receipt.merchant) continue;
        const key = receipt.merchant.toLowerCase();
        const existing = merchantMap.get(key);
        const receiptTotal = (Number(receipt.amount) || 0) + (Number(receipt.vatAmount) || 0);
        if (existing) {
          existing.count++;
          existing.lastAmount = receiptTotal;
        } else {
          merchantMap.set(key, {
            name: receipt.merchant,
            category: receipt.category,
            count: 1,
            lastAmount: receiptTotal,
          });
        }
      }

      let merchants = Array.from(merchantMap.values());

      // Filter by query if specified
      if (query) {
        const q = (query as string).toLowerCase();
        merchants = merchants.filter(m => m.name.toLowerCase().includes(q));
      }

      // Sort by frequency and limit
      merchants.sort((a, b) => b.count - a.count);

      res.json(merchants.slice(0, Number(limit)).map(m => ({
        name: m.name,
        category: m.category,
        receiptCount: m.count,
        lastAmount: m.lastAmount,
      })));
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  }));

  app.get("/api/autocomplete/descriptions", authMiddleware, asyncHandler(async (req: Request, res: Response) => {
    try {
      const { companyId, query, type, limit = 10 } = req.query;
      const userId = (req as any).user.id;

      if (!companyId) {
        return res.status(400).json({ message: 'Company ID is required' });
      }

      // Verify company access
      const companyUsers = await storage.getCompanyUsersByCompanyId(companyId as string);
      if (!companyUsers.some(cu => cu.userId === userId)) {
        return res.status(403).json({ message: 'Access denied' });
      }

      const descriptions = new Map<string, number>();

      // Collect descriptions from journal entries
      if (!type || type === 'journal') {
        const entries = await storage.getJournalEntriesByCompanyId(companyId as string);
        for (const entry of entries) {
          if (entry.memo) {
            const key = entry.memo.toLowerCase().trim();
            descriptions.set(key, (descriptions.get(key) || 0) + 1);
          }
        }
      }

      // Collect descriptions from invoice lines
      if (!type || type === 'invoice') {
        const invoices = await storage.getInvoicesByCompanyId(companyId as string);
        for (const invoice of invoices) {
          const lines = await storage.getInvoiceLinesByInvoiceId(invoice.id);
          for (const line of lines) {
            if (line.description) {
              const key = line.description.toLowerCase().trim();
              descriptions.set(key, (descriptions.get(key) || 0) + 1);
            }
          }
        }
      }

      let results = Array.from(descriptions.entries()).map(([text, count]) => ({ text, count }));

      // Filter by query if specified
      if (query) {
        const q = (query as string).toLowerCase();
        results = results.filter(d => d.text.includes(q));
      }

      // Sort by frequency and limit
      results.sort((a, b) => b.count - a.count);

      res.json(results.slice(0, Number(limit)).map(d => ({
        text: d.text.charAt(0).toUpperCase() + d.text.slice(1),
        usageCount: d.count,
      })));
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  }));

  // Smart suggestions based on context
  app.post("/api/ai/smart-suggest", authMiddleware, asyncHandler(async (req: Request, res: Response) => {
    try {
      const { companyId, context, fieldType, currentValue } = req.body;
      const userId = (req as any).user.id;

      if (!companyId || !context || !fieldType) {
        return res.status(400).json({ message: 'Company ID, context, and fieldType are required' });
      }

      // Verify company access
      const companyUsers = await storage.getCompanyUsersByCompanyId(companyId);
      if (!companyUsers.some(cu => cu.userId === userId)) {
        return res.status(403).json({ message: 'Access denied' });
      }

      const accounts = await storage.getAccountsByCompanyId(companyId);

      // Build context-aware suggestions
      const suggestions: Array<{ value: string; label: string; confidence: number; reason: string }> = [];

      if (fieldType === 'account' && context.merchant) {
        // Learn from past categorizations for this merchant
        const receipts = await storage.getReceiptsByCompanyId(companyId);
        const merchantReceipts = receipts.filter(r =>
          r.merchant?.toLowerCase() === context.merchant.toLowerCase() && r.journalEntryId
        );

        if (merchantReceipts.length > 0) {
          // Find most common account used
          const accountCounts = new Map<string, number>();
          for (const receipt of merchantReceipts) {
            if (receipt.journalEntryId) {
              const lines = await storage.getJournalLinesByEntryId(receipt.journalEntryId);
              for (const line of lines) {
                const account = accounts.find(a => a.id === line.accountId);
                if (account && account.type === 'expense') {
                  accountCounts.set(account.id, (accountCounts.get(account.id) || 0) + 1);
                }
              }
            }
          }

          const sorted = Array.from(accountCounts.entries()).sort((a, b) => b[1] - a[1]);
          for (const [accountId, count] of sorted.slice(0, 3)) {
            const account = accounts.find(a => a.id === accountId);
            if (account) {
              suggestions.push({
                value: accountId,
                label: account.nameEn,
                confidence: Math.min(0.9, count / merchantReceipts.length),
                reason: `Used ${count} times for "${context.merchant}"`,
              });
            }
          }
        }

        // Use AI for unknown merchants
        if (suggestions.length === 0 && context.merchant) {
          const expenseAccounts = accounts.filter(a => a.type === 'expense');
          const prompt = `Given a UAE business expense from merchant "${context.merchant}"${context.category ? ` categorized as "${context.category}"` : ''}, suggest the most appropriate expense account from this list:
${expenseAccounts.map(a => `- ${a.nameEn}`).join('\n')}

Respond with just the account name, nothing else.`;

          const response = await openai.chat.completions.create({
            model: AI_MODEL,
            messages: [{ role: "user", content: prompt }],
            temperature: 0.3,
            max_tokens: 50,
          });

          const suggestedName = response.choices[0]?.message?.content?.trim();
          const matchedAccount = expenseAccounts.find(a =>
            a.nameEn.toLowerCase() === suggestedName?.toLowerCase()
          );

          if (matchedAccount) {
            suggestions.push({
              value: matchedAccount.id,
              label: matchedAccount.nameEn,
              confidence: 0.7,
              reason: 'AI suggestion based on merchant name',
            });
          }
        }
      }

      if (fieldType === 'category' && context.merchant) {
        // UAE-specific expense categories
        const categories = [
          'Office Supplies', 'Utilities', 'Travel', 'Meals & Entertainment',
          'Rent', 'Marketing', 'Equipment', 'Professional Services',
          'Insurance', 'Maintenance', 'Communication', 'Other',
        ];

        const prompt = `For a UAE business expense from merchant "${context.merchant}", suggest the most appropriate expense category from: ${categories.join(', ')}

Respond with just the category name, nothing else.`;

        const response = await openai.chat.completions.create({
          model: AI_MODEL,
          messages: [{ role: "user", content: prompt }],
          temperature: 0.3,
          max_tokens: 30,
        });

        const suggestedCategory = response.choices[0]?.message?.content?.trim();
        if (suggestedCategory && categories.some(c => c.toLowerCase() === suggestedCategory.toLowerCase())) {
          suggestions.push({
            value: suggestedCategory,
            label: suggestedCategory,
            confidence: 0.8,
            reason: 'AI suggestion based on merchant type',
          });
        }
      }

      res.json({ suggestions });
    } catch (error: any) {
      console.error('Smart suggest error:', error);
      res.status(500).json({ message: error.message || 'Failed to generate suggestions' });
    }
  }));
}
