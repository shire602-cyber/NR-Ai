import type { Express, Request, Response } from "express";
import { createServer, type Server } from "http";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { storage } from "./storage";
import { insertUserSchema, insertCompanySchema, insertAccountSchema, insertInvoiceSchema, insertJournalEntrySchema, categorizationRequestSchema } from "@shared/schema";

const JWT_SECRET = process.env.SESSION_SECRET || "dev-secret-change-in-production";
const JWT_EXPIRES_IN = "24h";

// Authentication middleware
async function authMiddleware(req: Request, res: Response, next: Function) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Unauthorized' });
  }

  const token = authHeader.substring(7);
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as { userId: string; email: string };
    (req as any).user = { id: decoded.userId, email: decoded.email };
    next();
  } catch (error) {
    return res.status(401).json({ message: 'Invalid or expired token' });
  }
}

// UAE Chart of Accounts seed data
const UAE_SEED_COA = [
  { code: "1000", nameEn: "Cash", nameAr: "نقد", type: "asset" },
  { code: "1100", nameEn: "Bank", nameAr: "بنك", type: "asset" },
  { code: "1200", nameEn: "Accounts Receivable", nameAr: "حسابات مدينة", type: "asset" },
  { code: "2000", nameEn: "Accounts Payable", nameAr: "حسابات دائنة", type: "liability" },
  { code: "2100", nameEn: "VAT Payable", nameAr: "ضريبة مستحقة", type: "liability" },
  { code: "2200", nameEn: "VAT Receivable", nameAr: "ضريبة مستردة", type: "asset" },
  { code: "3000", nameEn: "Owner's Equity", nameAr: "حقوق الملكية", type: "equity" },
  { code: "4000", nameEn: "Sales Revenue", nameAr: "إيرادات المبيعات", type: "income" },
  { code: "4100", nameEn: "Other Income", nameAr: "إيرادات أخرى", type: "income" },
  { code: "5000", nameEn: "COGS", nameAr: "تكلفة البضاعة المباعة", type: "expense" },
  { code: "5100", nameEn: "Rent Expense", nameAr: "مصروف الإيجار", type: "expense" },
  { code: "5200", nameEn: "Utilities Expense", nameAr: "مصروف المرافق", type: "expense" },
  { code: "5300", nameEn: "Marketing Expense", nameAr: "مصروف التسويق", type: "expense" },
  { code: "5400", nameEn: "Office Supplies", nameAr: "مستلزمات مكتبية", type: "expense" },
];

async function seedChartOfAccounts(companyId: string) {
  for (const account of UAE_SEED_COA) {
    const exists = await storage.getAccountByCode(companyId, account.code);
    if (!exists) {
      await storage.createAccount({
        companyId,
        code: account.code,
        nameEn: account.nameEn,
        nameAr: account.nameAr,
        type: account.type,
        isActive: true,
      });
    }
  }
}

export async function registerRoutes(app: Express): Promise<Server> {
  // =====================================
  // Auth Routes
  // =====================================
  
  app.post("/api/auth/register", async (req: Request, res: Response) => {
    try {
      const validated = insertUserSchema.parse(req.body);
      
      // Check if user exists
      const existingUser = await storage.getUserByEmail(validated.email);
      if (existingUser) {
        return res.status(400).json({ message: 'Email already registered' });
      }

      // Hash password
      const passwordHash = await bcrypt.hash(validated.password, 10);
      
      // Create user with hashed password
      const user = await storage.createUser({
        ...validated,
        passwordHash,
      } as any);

      // Generate token
      const token = jwt.sign({ userId: user.id, email: user.email }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
      
      res.json({
        token,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
        },
      });
    } catch (error: any) {
      res.status(400).json({ message: error.message || 'Registration failed' });
    }
  });

  app.post("/api/auth/login", async (req: Request, res: Response) => {
    try {
      const { email, password } = req.body;
      
      const user = await storage.getUserByEmail(email);
      if (!user) {
        return res.status(401).json({ message: 'Invalid credentials' });
      }

      const isValid = await bcrypt.compare(password, user.passwordHash);
      if (!isValid) {
        return res.status(401).json({ message: 'Invalid credentials' });
      }

      const token = jwt.sign({ userId: user.id, email: user.email }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
      
      res.json({
        token,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
        },
      });
    } catch (error: any) {
      res.status(401).json({ message: 'Login failed' });
    }
  });

  // =====================================
  // Company Routes
  // =====================================
  
  app.get("/api/companies", authMiddleware, async (req: Request, res: Response) => {
    try {
      const userId = (req as any).user.id;
      const companies = await storage.getCompaniesByUserId(userId);
      res.json(companies);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/companies", authMiddleware, async (req: Request, res: Response) => {
    try {
      const userId = (req as any).user.id;
      const validated = insertCompanySchema.parse(req.body);
      
      // Check if company name exists
      const existing = await storage.getCompanyByName(validated.name);
      if (existing) {
        return res.status(400).json({ message: 'Company name already exists' });
      }

      const company = await storage.createCompany(validated);
      
      // Associate user with company as owner
      await storage.createCompanyUser({
        companyId: company.id,
        userId,
        role: 'owner',
      });

      // Seed Chart of Accounts
      await seedChartOfAccounts(company.id);
      
      res.json(company);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  // =====================================
  // Account Routes
  // =====================================
  
  app.get("/api/companies/:companyId/accounts", authMiddleware, async (req: Request, res: Response) => {
    try {
      const { companyId } = req.params;
      const accounts = await storage.getAccountsByCompanyId(companyId);
      res.json(accounts);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/companies/:companyId/accounts", authMiddleware, async (req: Request, res: Response) => {
    try {
      const { companyId } = req.params;
      const validated = insertAccountSchema.parse({ ...req.body, companyId });
      
      // Check if account code exists
      const existing = await storage.getAccountByCode(companyId, validated.code);
      if (existing) {
        return res.status(400).json({ message: 'Account code already exists' });
      }

      const account = await storage.createAccount(validated);
      res.json(account);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  // =====================================
  // Invoice Routes
  // =====================================
  
  app.get("/api/companies/:companyId/invoices", authMiddleware, async (req: Request, res: Response) => {
    try {
      const { companyId } = req.params;
      const invoices = await storage.getInvoicesByCompanyId(companyId);
      res.json(invoices);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/invoices/:id", authMiddleware, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const invoice = await storage.getInvoice(id);
      
      if (!invoice) {
        return res.status(404).json({ message: 'Invoice not found' });
      }
      
      // Fetch invoice lines
      const lines = await storage.getInvoiceLinesByInvoiceId(id);
      
      res.json({ ...invoice, lines });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/invoices", authMiddleware, async (req: Request, res: Response) => {
    try {
      const { companyId, lines, ...invoiceData } = req.body;
      
      // Calculate totals
      let subtotal = 0;
      let vatAmount = 0;
      
      for (const line of lines) {
        const lineTotal = line.quantity * line.unitPrice;
        subtotal += lineTotal;
        vatAmount += lineTotal * (line.vatRate || 0.05);
      }
      
      const total = subtotal + vatAmount;
      
      // Create invoice
      const invoice = await storage.createInvoice({
        ...invoiceData,
        companyId,
        subtotal,
        vatAmount,
        total,
      });
      
      // Create invoice lines
      for (const line of lines) {
        await storage.createInvoiceLine({
          invoiceId: invoice.id,
          ...line,
        });
      }
      
      res.json(invoice);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  // =====================================
  // Receipt Routes
  // =====================================
  
  app.get("/api/companies/:companyId/receipts", authMiddleware, async (req: Request, res: Response) => {
    try {
      const { companyId } = req.params;
      const userId = (req as any).user.id;
      
      // Check if user has access to this company
      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: 'Access denied' });
      }
      
      const receipts = await storage.getReceiptsByCompanyId(companyId);
      res.json(receipts);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });
  
  app.post("/api/companies/:companyId/receipts", authMiddleware, async (req: Request, res: Response) => {
    try {
      const { companyId } = req.params;
      const userId = (req as any).user.id;
      
      // Check if user has access to this company
      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: 'Access denied' });
      }
      
      const receiptData = req.body;
      
      const receipt = await storage.createReceipt({
        ...receiptData,
        uploadedBy: userId,
      });
      
      res.json(receipt);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  // =====================================
  // Journal Entry Routes
  // =====================================
  
  app.get("/api/journal", authMiddleware, async (req: Request, res: Response) => {
    try {
      const { companyId } = req.query;
      if (!companyId) {
        return res.status(400).json({ message: 'Company ID required' });
      }
      
      const entries = await storage.getJournalEntriesByCompanyId(companyId as string);
      
      // Fetch lines and accounts for each entry
      const entriesWithLines = await Promise.all(
        entries.map(async (entry) => {
          const lines = await storage.getJournalLinesByEntryId(entry.id);
          const linesWithAccounts = await Promise.all(
            lines.map(async (line) => {
              const account = await storage.getAccount(line.accountId);
              return { ...line, account };
            })
          );
          return { ...entry, lines: linesWithAccounts };
        })
      );
      
      res.json(entriesWithLines);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/journal", authMiddleware, async (req: Request, res: Response) => {
    try {
      const userId = (req as any).user.id;
      const { companyId, lines, ...entryData } = req.body;
      
      // Validate debits equal credits
      let totalDebit = 0;
      let totalCredit = 0;
      
      for (const line of lines) {
        totalDebit += line.debit || 0;
        totalCredit += line.credit || 0;
      }
      
      if (Math.abs(totalDebit - totalCredit) > 0.01) {
        return res.status(400).json({ message: 'Debits must equal credits' });
      }
      
      // Create journal entry
      const entry = await storage.createJournalEntry({
        ...entryData,
        companyId,
        createdBy: userId,
      });
      
      // Create journal lines
      for (const line of lines) {
        await storage.createJournalLine({
          entryId: entry.id,
          accountId: line.accountId,
          debit: line.debit || 0,
          credit: line.credit || 0,
        });
      }
      
      res.json({ id: entry.id, status: 'posted' });
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  // =====================================
  // AI Categorization Route
  // =====================================
  
  app.post("/api/ai/categorize", authMiddleware, async (req: Request, res: Response) => {
    try {
      const validated = categorizationRequestSchema.parse(req.body);
      
      // Get company's Chart of Accounts
      const accounts = await storage.getAccountsByCompanyId(validated.companyId);
      const expenseAccounts = accounts.filter(a => a.type === 'expense');
      
      // Simple rule-based matching (will be replaced with OpenAI in Task 3)
      const description = validated.description.toLowerCase();
      
      let suggestedAccountCode = '5400'; // Default to Office Supplies
      let confidence = 0.25;
      let reason = 'Fallback to Office Supplies';
      
      // Business rules for UAE expenses
      if (description.includes('uber') || description.includes('taxi') || description.includes('careem') || description.includes('transport')) {
        suggestedAccountCode = '5300';
        confidence = 0.75;
        reason = 'Transportation expense pattern detected';
      } else if (description.includes('facebook') || description.includes('google ads') || description.includes('tiktok') || description.includes('marketing') || description.includes('advertising')) {
        suggestedAccountCode = '5300';
        confidence = 0.80;
        reason = 'Marketing/advertising expense pattern detected';
      } else if (description.includes('du ') || description.includes('etisalat') || description.includes('utility') || description.includes('dewa') || description.includes('electricity') || description.includes('water')) {
        suggestedAccountCode = '5200';
        confidence = 0.85;
        reason = 'Utilities expense pattern detected';
      } else if (description.includes('rent') || description.includes('lease')) {
        suggestedAccountCode = '5100';
        confidence = 0.90;
        reason = 'Rent expense pattern detected';
      } else if (description.includes('stationery') || description.includes('paper') || description.includes('ink') || description.includes('pens') || description.includes('supplies')) {
        suggestedAccountCode = '5400';
        confidence = 0.70;
        reason = 'Office supplies pattern detected';
      }
      
      // Find the account name
      const account = accounts.find(a => a.code === suggestedAccountCode);
      const suggestedAccountName = account ? account.nameEn : 'Office Supplies';
      
      res.json({
        suggestedAccountCode,
        suggestedAccountName,
        confidence,
        reason,
      });
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  // =====================================
  // Dashboard Stats Routes
  // =====================================
  
  app.get("/api/companies/:companyId/dashboard/stats", authMiddleware, async (req: Request, res: Response) => {
    try {
      const { companyId } = req.params;
      const invoices = await storage.getInvoicesByCompanyId(companyId);
      const entries = await storage.getJournalEntriesByCompanyId(companyId);
      const accounts = await storage.getAccountsByCompanyId(companyId);
      
      // Calculate from journal entries
      const balances = new Map<string, number>();
      for (const entry of entries) {
        const lines = await storage.getJournalLinesByEntryId(entry.id);
        for (const line of lines) {
          const account = accounts.find(a => a.id === line.accountId);
          if (!account) continue;
          
          const current = balances.get(account.type) || 0;
          if (account.type === 'income') {
            balances.set('income', current + line.credit - line.debit);
          } else if (account.type === 'expense') {
            balances.set('expense', current + line.debit - line.credit);
          }
        }
      }
      
      const revenue = balances.get('income') || 0;
      const expenses = balances.get('expense') || 0;
      const outstanding = invoices.filter(inv => inv.status === 'sent' || inv.status === 'draft')
        .reduce((sum, inv) => sum + inv.total, 0);
      
      res.json({
        revenue,
        expenses,
        outstanding,
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/companies/:companyId/dashboard/expense-breakdown", authMiddleware, async (req: Request, res: Response) => {
    try {
      const { companyId } = req.params;
      const entries = await storage.getJournalEntriesByCompanyId(companyId);
      const accounts = await storage.getAccountsByCompanyId(companyId);
      const expenseAccounts = accounts.filter(a => a.type === 'expense');
      
      const balances = new Map<string, number>();
      for (const entry of entries) {
        const lines = await storage.getJournalLinesByEntryId(entry.id);
        for (const line of lines) {
          const account = accounts.find(a => a.id === line.accountId);
          if (!account || account.type !== 'expense') continue;
          
          const current = balances.get(account.code) || 0;
          balances.set(account.code, current + line.debit - line.credit);
        }
      }
      
      const breakdown = expenseAccounts
        .map(account => ({
          name: account.nameEn,
          value: balances.get(account.code) || 0,
        }))
        .filter(item => item.value > 0)
        .sort((a, b) => b.value - a.value)
        .slice(0, 5); // Top 5 expenses
      
      res.json(breakdown);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/companies/:companyId/dashboard/monthly-trends", authMiddleware, async (req: Request, res: Response) => {
    try {
      const { companyId } = req.params;
      const invoices = await storage.getInvoicesByCompanyId(companyId);
      const entries = await storage.getJournalEntriesByCompanyId(companyId);
      const accounts = await storage.getAccountsByCompanyId(companyId);
      
      // Get last 6 months
      const months = Array.from({ length: 6 }, (_, i) => {
        const date = new Date();
        date.setMonth(date.getMonth() - (5 - i));
        return {
          month: date.toLocaleDateString('en-US', { month: 'short' }),
          monthNum: date.getMonth(),
          yearNum: date.getFullYear(),
        };
      });

      const trends = await Promise.all(months.map(async ({ month, monthNum, yearNum }) => {
        // Calculate revenue from invoices
        const revenue = invoices
          .filter(inv => {
            const invDate = new Date(inv.date);
            return invDate.getMonth() === monthNum && invDate.getFullYear() === yearNum;
          })
          .reduce((sum, inv) => sum + (inv.subtotal || 0), 0);

        // Calculate expenses from journal entries
        let expenses = 0;
        for (const entry of entries) {
          const entryDate = new Date(entry.date);
          if (entryDate.getMonth() === monthNum && entryDate.getFullYear() === yearNum) {
            const lines = await storage.getJournalLinesByEntryId(entry.id);
            for (const line of lines) {
              const account = accounts.find(a => a.id === line.accountId);
              if (account && account.type === 'expense') {
                expenses += line.debit - line.credit;
              }
            }
          }
        }

        return { month, revenue, expenses };
      }));

      res.json(trends);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // =====================================
  // Reports Routes
  // =====================================
  
  app.get("/api/companies/:companyId/reports/pl", authMiddleware, async (req: Request, res: Response) => {
    try {
      const { companyId } = req.params;
      const accounts = await storage.getAccountsByCompanyId(companyId);
      const entries = await storage.getJournalEntriesByCompanyId(companyId);
      
      // Calculate balances for each account
      const balances = new Map<string, number>();
      
      for (const entry of entries) {
        const lines = await storage.getJournalLinesByEntryId(entry.id);
        for (const line of lines) {
          const account = accounts.find(a => a.id === line.accountId);
          if (!account) continue;
          
          const current = balances.get(account.code) || 0;
          if (account.type === 'income') {
            balances.set(account.code, current + line.credit - line.debit);
          } else if (account.type === 'expense') {
            balances.set(account.code, current + line.debit - line.credit);
          }
        }
      }
      
      const revenue = accounts
        .filter(a => a.type === 'income')
        .map(a => ({
          accountCode: a.code,
          accountName: a.nameEn,
          amount: balances.get(a.code) || 0,
        }))
        .filter(item => item.amount > 0);
      
      const expenses = accounts
        .filter(a => a.type === 'expense')
        .map(a => ({
          accountCode: a.code,
          accountName: a.nameEn,
          amount: balances.get(a.code) || 0,
        }))
        .filter(item => item.amount > 0);
      
      const totalRevenue = revenue.reduce((sum, item) => sum + item.amount, 0);
      const totalExpenses = expenses.reduce((sum, item) => sum + item.amount, 0);
      const netProfit = totalRevenue - totalExpenses;
      
      res.json({
        revenue,
        expenses,
        totalRevenue,
        totalExpenses,
        netProfit,
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/companies/:companyId/reports/balance-sheet", authMiddleware, async (req: Request, res: Response) => {
    try {
      const { companyId } = req.params;
      const accounts = await storage.getAccountsByCompanyId(companyId);
      const entries = await storage.getJournalEntriesByCompanyId(companyId);
      
      // Calculate balances
      const balances = new Map<string, number>();
      
      for (const entry of entries) {
        const lines = await storage.getJournalLinesByEntryId(entry.id);
        for (const line of lines) {
          const account = accounts.find(a => a.id === line.accountId);
          if (!account) continue;
          
          const current = balances.get(account.code) || 0;
          if (account.type === 'asset' || account.type === 'expense') {
            balances.set(account.code, current + line.debit - line.credit);
          } else {
            balances.set(account.code, current + line.credit - line.debit);
          }
        }
      }
      
      const assets = accounts
        .filter(a => a.type === 'asset')
        .map(a => ({
          accountCode: a.code,
          accountName: a.nameEn,
          amount: balances.get(a.code) || 0,
        }));
      
      const liabilities = accounts
        .filter(a => a.type === 'liability')
        .map(a => ({
          accountCode: a.code,
          accountName: a.nameEn,
          amount: balances.get(a.code) || 0,
        }));
      
      const equity = accounts
        .filter(a => a.type === 'equity')
        .map(a => ({
          accountCode: a.code,
          accountName: a.nameEn,
          amount: balances.get(a.code) || 0,
        }));
      
      const totalAssets = assets.reduce((sum, item) => sum + item.amount, 0);
      const totalLiabilities = liabilities.reduce((sum, item) => sum + item.amount, 0);
      const totalEquity = equity.reduce((sum, item) => sum + item.amount, 0);
      
      res.json({
        assets,
        liabilities,
        equity,
        totalAssets,
        totalLiabilities,
        totalEquity,
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/companies/:companyId/reports/vat-summary", authMiddleware, async (req: Request, res: Response) => {
    try {
      const { companyId } = req.params;
      const invoices = await storage.getInvoicesByCompanyId(companyId);
      
      let salesSubtotal = 0;
      let salesVAT = 0;
      
      for (const invoice of invoices) {
        if (invoice.status !== 'void') {
          salesSubtotal += invoice.subtotal;
          salesVAT += invoice.vatAmount;
        }
      }
      
      // Purchases VAT would come from bills/expenses (simplified for now)
      const purchasesSubtotal = 0;
      const purchasesVAT = 0;
      
      const netVATPayable = salesVAT - purchasesVAT;
      
      res.json({
        period: 'Current Period',
        salesSubtotal,
        salesVAT,
        purchasesSubtotal,
        purchasesVAT,
        netVATPayable,
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // =====================================
  // Dashboard Routes
  // =====================================
  
  app.get("/api/dashboard/stats", authMiddleware, async (req: Request, res: Response) => {
    try {
      const { companyId } = req.query;
      if (!companyId) {
        return res.json({ revenue: 0, expenses: 0, outstanding: 0 });
      }
      
      const invoices = await storage.getInvoicesByCompanyId(companyId as string);
      const accounts = await storage.getAccountsByCompanyId(companyId as string);
      const entries = await storage.getJournalEntriesByCompanyId(companyId as string);
      
      // Calculate revenue and expenses from journal entries
      const balances = new Map<string, number>();
      for (const entry of entries) {
        const lines = await storage.getJournalLinesByEntryId(entry.id);
        for (const line of lines) {
          const account = accounts.find(a => a.id === line.accountId);
          if (!account) continue;
          const current = balances.get(account.type) || 0;
          if (account.type === 'income') {
            balances.set('income', current + line.credit - line.debit);
          } else if (account.type === 'expense') {
            balances.set('expense', current + line.debit - line.credit);
          }
        }
      }
      
      const outstanding = invoices
        .filter(inv => inv.status === 'sent' || inv.status === 'draft')
        .reduce((sum, inv) => sum + inv.total, 0);
      
      res.json({
        revenue: balances.get('income') || 0,
        expenses: balances.get('expense') || 0,
        outstanding,
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/dashboard/recent-invoices", authMiddleware, async (req: Request, res: Response) => {
    try {
      const { companyId } = req.query;
      if (!companyId) {
        return res.json([]);
      }
      
      const invoices = await storage.getInvoicesByCompanyId(companyId as string);
      res.json(invoices.slice(0, 5));
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/dashboard/expense-breakdown", authMiddleware, async (req: Request, res: Response) => {
    try {
      const { companyId } = req.query;
      if (!companyId) {
        return res.json([]);
      }
      
      const accounts = await storage.getAccountsByCompanyId(companyId as string);
      const entries = await storage.getJournalEntriesByCompanyId(companyId as string);
      
      const balances = new Map<string, { name: string; value: number }>();
      
      for (const entry of entries) {
        const lines = await storage.getJournalLinesByEntryId(entry.id);
        for (const line of lines) {
          const account = accounts.find(a => a.id === line.accountId);
          if (!account || account.type !== 'expense') continue;
          
          const current = balances.get(account.code) || { name: account.nameEn, value: 0 };
          current.value += line.debit - line.credit;
          balances.set(account.code, current);
        }
      }
      
      const data = Array.from(balances.values())
        .filter(item => item.value > 0)
        .sort((a, b) => b.value - a.value)
        .slice(0, 5);
      
      res.json(data);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}
