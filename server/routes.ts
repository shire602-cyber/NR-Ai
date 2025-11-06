import type { Express, Request, Response } from "express";
import { createServer, type Server } from "http";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import OpenAI from "openai";
import { storage } from "./storage";
import { insertUserSchema, insertCompanySchema, insertAccountSchema, insertInvoiceSchema, insertJournalEntrySchema, categorizationRequestSchema, insertWaitlistSchema } from "@shared/schema";

const JWT_SECRET = process.env.SESSION_SECRET || "dev-secret-change-in-production";
const JWT_EXPIRES_IN = "24h";

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

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
  // Health Check Route
  // =====================================
  
  app.get("/health", async (req: Request, res: Response) => {
    try {
      res.status(200).json({
        ok: true,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      res.status(503).json({
        ok: false,
        timestamp: new Date().toISOString()
      });
    }
  });

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

      // Auto-create a default company for this user
      const companyName = `${validated.name}'s Company`;
      const company = await storage.createCompany({
        name: companyName,
        baseCurrency: 'AED',
        locale: 'en',
      });

      // Associate user with company as owner
      await storage.createCompanyUser({
        companyId: company.id,
        userId: user.id,
        role: 'owner',
      });

      // Seed Chart of Accounts for new company
      await seedChartOfAccounts(company.id);

      // Generate token
      const token = jwt.sign({ userId: user.id, email: user.email }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
      
      res.json({
        token,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
        },
        company: {
          id: company.id,
          name: company.name,
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

  app.get("/api/companies/:id", authMiddleware, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const userId = (req as any).user.id;

      // Check if user has access to this company
      const hasAccess = await storage.hasCompanyAccess(userId, id);
      if (!hasAccess) {
        return res.status(403).json({ message: 'Access denied' });
      }

      const company = await storage.getCompany(id);
      if (!company) {
        return res.status(404).json({ message: 'Company not found' });
      }

      res.json(company);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.patch("/api/companies/:id", authMiddleware, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const userId = (req as any).user.id;

      // Check if user has access to this company
      const hasAccess = await storage.hasCompanyAccess(userId, id);
      if (!hasAccess) {
        return res.status(403).json({ message: 'Access denied' });
      }

      // Prepare update data with proper type conversions
      const updateData = { ...req.body };
      
      // Convert taxRegistrationDate to Date if it exists and is not already a Date
      if (updateData.taxRegistrationDate) {
        if (typeof updateData.taxRegistrationDate === 'string') {
          updateData.taxRegistrationDate = new Date(updateData.taxRegistrationDate);
        } else if (!(updateData.taxRegistrationDate instanceof Date)) {
          // If it's not a string or Date, try to coerce it
          updateData.taxRegistrationDate = new Date(updateData.taxRegistrationDate);
        }
      } else {
        // If taxRegistrationDate is undefined or null, ensure it's properly set
        delete updateData.taxRegistrationDate;
      }

      const company = await storage.updateCompany(id, updateData);
      console.log('[Company Profile] Company updated:', company.id);
      res.json(company);
    } catch (error: any) {
      console.error('[Company Profile] Error updating company:', error);
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

  app.put("/api/accounts/:id", authMiddleware, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const userId = (req as any).user.id;

      // Get account to verify it exists and get company access
      const account = await storage.getAccount(id);
      if (!account) {
        return res.status(404).json({ message: 'Account not found' });
      }

      // Check if user has access to this company
      const hasAccess = await storage.hasCompanyAccess(userId, account.companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: 'Access denied' });
      }

      // If updating code, check if new code already exists
      if (req.body.code && req.body.code !== account.code) {
        const existing = await storage.getAccountByCode(account.companyId, req.body.code);
        if (existing) {
          return res.status(400).json({ message: 'Account code already exists' });
        }
      }

      const updatedAccount = await storage.updateAccount(id, req.body);
      res.json(updatedAccount);
    } catch (error: any) {
      console.error('[Accounts] Error updating account:', error);
      res.status(500).json({ message: error.message });
    }
  });

  app.delete("/api/accounts/:id", authMiddleware, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const userId = (req as any).user.id;

      // Get account to verify it exists and get company access
      const account = await storage.getAccount(id);
      if (!account) {
        return res.status(404).json({ message: 'Account not found' });
      }

      // Check if user has access to this company
      const hasAccess = await storage.hasCompanyAccess(userId, account.companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: 'Access denied' });
      }

      // Check if account has any transactions
      const hasTransactions = await storage.accountHasTransactions(id);
      if (hasTransactions) {
        return res.status(400).json({ 
          message: 'Cannot delete account with existing transactions. Please remove all journal entries using this account first.' 
        });
      }

      await storage.deleteAccount(id);
      res.json({ message: 'Account deleted successfully' });
    } catch (error: any) {
      console.error('[Accounts] Error deleting account:', error);
      res.status(500).json({ message: error.message });
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

  app.post("/api/companies/:companyId/invoices", authMiddleware, async (req: Request, res: Response) => {
    try {
      const { companyId } = req.params;
      const userId = (req as any).user.id;
      const { lines, date, ...invoiceData } = req.body;
      
      // Check if user has access to this company
      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: 'Access denied' });
      }
      
      // Calculate totals
      let subtotal = 0;
      let vatAmount = 0;
      
      for (const line of lines) {
        const lineTotal = line.quantity * line.unitPrice;
        subtotal += lineTotal;
        vatAmount += lineTotal * (line.vatRate || 0.05);
      }
      
      const total = subtotal + vatAmount;
      
      // Convert date string to Date object if it's a string
      const invoiceDate = typeof date === 'string' ? new Date(date) : date;
      
      console.log('[Invoices] Creating invoice:', { 
        companyId, 
        userId,
        number: invoiceData.number,
        date: invoiceDate,
        subtotal,
        vatAmount,
        total,
        linesCount: lines.length
      });
      
      // Create invoice
      const invoice = await storage.createInvoice({
        ...invoiceData,
        date: invoiceDate,
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
      
      // Revenue recognition: create journal entry immediately when invoice is raised
      const accounts = await storage.getAccountsByCompanyId(companyId);
      const accountsReceivable = accounts.find(a => a.code === '1200');
      const salesRevenue = accounts.find(a => a.code === '4000');
      const vatPayable = accounts.find(a => a.code === '2100');
      
      if (accountsReceivable && salesRevenue) {
        const entry = await storage.createJournalEntry({
          companyId: companyId,
          date: invoiceDate,
          memo: `Sales Invoice ${invoice.number} - ${invoice.customerName}`,
          createdBy: userId,
        });

        // Debit: Accounts Receivable (total)
        await storage.createJournalLine({
          entryId: entry.id,
          accountId: accountsReceivable.id,
          debit: total,
          credit: 0,
        });

        // Credit: Sales Revenue (subtotal)
        await storage.createJournalLine({
          entryId: entry.id,
          accountId: salesRevenue.id,
          debit: 0,
          credit: subtotal,
        });

        // Credit: VAT Payable (vat amount) - if there's VAT
        if (vatAmount > 0 && vatPayable) {
          await storage.createJournalLine({
            entryId: entry.id,
            accountId: vatPayable.id,
            debit: 0,
            credit: vatAmount,
          });
        }

        console.log('[Invoices] Revenue recognition journal entry created for invoice:', invoice.id);
      } else {
        console.warn('[Invoices] Could not create revenue recognition entry - missing accounts');
      }
      
      console.log('[Invoices] Invoice created successfully:', invoice.id);
      res.json(invoice);
    } catch (error: any) {
      console.error('[Invoices] Error creating invoice:', error);
      res.status(400).json({ message: error.message || 'Failed to create invoice' });
    }
  });

  app.put("/api/invoices/:id", authMiddleware, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const userId = (req as any).user.id;
      const { lines, date, ...invoiceData } = req.body;

      // Get invoice to verify it exists and get company access
      const invoice = await storage.getInvoice(id);
      if (!invoice) {
        return res.status(404).json({ message: 'Invoice not found' });
      }

      // Check if user has access to this company
      const hasAccess = await storage.hasCompanyAccess(userId, invoice.companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: 'Access denied' });
      }

      // Calculate totals
      let subtotal = 0;
      let vatAmount = 0;

      for (const line of lines) {
        const lineTotal = line.quantity * line.unitPrice;
        subtotal += lineTotal;
        vatAmount += lineTotal * (line.vatRate || 0.05);
      }

      const total = subtotal + vatAmount;

      // Convert date string to Date object if it's a string
      const invoiceDate = typeof date === 'string' ? new Date(date) : date;

      // Update invoice
      const updatedInvoice = await storage.updateInvoice(id, {
        ...invoiceData,
        date: invoiceDate,
        subtotal,
        vatAmount,
        total,
      });

      // Delete existing lines and create new ones
      await storage.deleteInvoiceLinesByInvoiceId(id);
      for (const line of lines) {
        await storage.createInvoiceLine({
          invoiceId: id,
          ...line,
        });
      }

      console.log('[Invoices] Invoice updated successfully:', id);
      res.json(updatedInvoice);
    } catch (error: any) {
      console.error('[Invoices] Error updating invoice:', error);
      res.status(400).json({ message: error.message || 'Failed to update invoice' });
    }
  });

  app.delete("/api/invoices/:id", authMiddleware, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const userId = (req as any).user.id;

      // Get invoice to verify it exists and get company access
      const invoice = await storage.getInvoice(id);
      if (!invoice) {
        return res.status(404).json({ message: 'Invoice not found' });
      }

      // Check if user has access to this company
      const hasAccess = await storage.hasCompanyAccess(userId, invoice.companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: 'Access denied' });
      }

      await storage.deleteInvoice(id);
      res.json({ message: 'Invoice deleted successfully' });
    } catch (error: any) {
      console.error('[Invoices] Error deleting invoice:', error);
      res.status(500).json({ message: error.message });
    }
  });

  app.patch("/api/invoices/:id/status", authMiddleware, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { status, paymentAccountId } = req.body;
      const userId = (req as any).user.id;

      // Validate status
      const validStatuses = ['draft', 'sent', 'paid', 'void'];
      if (!status || !validStatuses.includes(status)) {
        return res.status(400).json({ message: 'Invalid status. Must be one of: draft, sent, paid, void' });
      }

      // Get invoice to verify it exists and get company access
      const invoice = await storage.getInvoice(id);
      if (!invoice) {
        return res.status(404).json({ message: 'Invoice not found' });
      }

      // Check if user has access to this company
      const hasAccess = await storage.hasCompanyAccess(userId, invoice.companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: 'Access denied' });
      }

      const oldStatus = invoice.status;
      const updatedInvoice = await storage.updateInvoiceStatus(id, status);
      
      console.log(`[Invoices] Status transition: ${oldStatus} -> ${status} for invoice ${id}`);
      
      // Payment recording when invoice is marked as paid
      // Note: Revenue is already recognized when invoice is created
      if (status === 'paid' && oldStatus !== 'paid') {
        // Validate payment account is provided
        if (!paymentAccountId) {
          return res.status(400).json({ message: 'Payment account is required when marking invoice as paid' });
        }

        // Validate payment account belongs to company
        const paymentAccount = await storage.getAccount(paymentAccountId);
        if (!paymentAccount || paymentAccount.companyId !== invoice.companyId) {
          return res.status(400).json({ message: 'Invalid payment account' });
        }

        // Validate payment account is an asset account (cash/bank)
        if (!['1000', '1100'].includes(paymentAccount.code)) {
          return res.status(400).json({ message: 'Payment account must be a cash or bank account' });
        }

        const accounts = await storage.getAccountsByCompanyId(invoice.companyId);
        const accountsReceivable = accounts.find(a => a.code === '1200');
        
        if (accountsReceivable) {
          const entry = await storage.createJournalEntry({
            companyId: invoice.companyId,
            date: new Date(),
            memo: `Payment received for Invoice ${invoice.number}`,
            createdBy: userId,
          });

          // Debit: Selected payment account (total)
          await storage.createJournalLine({
            entryId: entry.id,
            accountId: paymentAccountId,
            debit: invoice.total,
            credit: 0,
          });

          // Credit: Accounts Receivable (total)
          await storage.createJournalLine({
            entryId: entry.id,
            accountId: accountsReceivable.id,
            debit: 0,
            credit: invoice.total,
          });

          console.log('[Invoices] Payment journal entry created for invoice:', id, 'to account:', paymentAccount.nameEn);
        } else {
          return res.status(500).json({ message: 'Accounts Receivable account not found' });
        }
      }

      console.log('[Invoices] Invoice status updated:', id, status);
      res.json(updatedInvoice);
    } catch (error: any) {
      console.error('[Invoices] Error updating invoice status:', error);
      res.status(500).json({ message: error.message || 'Failed to update invoice status' });
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
      
      console.log('[Receipts] Creating receipt:', { 
        companyId, 
        userId, 
        merchant: receiptData.merchant,
        amount: receiptData.amount,
        hasImageData: !!receiptData.imageData,
        imageDataLength: receiptData.imageData?.length
      });
      
      const receipt = await storage.createReceipt({
        ...receiptData,
        uploadedBy: userId,
      });
      
      console.log('[Receipts] Receipt created successfully:', receipt.id);
      res.json(receipt);
    } catch (error: any) {
      console.error('[Receipts] Error creating receipt:', error);
      res.status(400).json({ message: error.message || 'Failed to create receipt' });
    }
  });

  app.put("/api/receipts/:id", authMiddleware, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const userId = (req as any).user.id;

      // Convert empty category string to null (UUID field cannot accept empty strings)
      if (req.body.category === '') {
        req.body.category = null;
      }
      
      const updatedReceipt = await storage.updateReceipt(id, req.body);
      console.log('[Receipts] Receipt updated successfully:', id);
      res.json(updatedReceipt);
    } catch (error: any) {
      console.error('[Receipts] Error updating receipt:', error);
      res.status(400).json({ message: error.message || 'Failed to update receipt' });
    }
  });

  app.delete("/api/receipts/:id", authMiddleware, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const userId = (req as any).user.id;

      await storage.deleteReceipt(id);
      res.json({ message: 'Receipt deleted successfully' });
    } catch (error: any) {
      console.error('[Receipts] Error deleting receipt:', error);
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/receipts/:id/post", authMiddleware, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const userId = (req as any).user.id;
      const { accountId, paymentAccountId } = req.body;

      // Validate required fields
      if (!accountId || !paymentAccountId) {
        return res.status(400).json({ message: 'Expense account and payment account are required' });
      }

      // Get receipt
      const receipt = await storage.getReceipt(id);
      if (!receipt) {
        return res.status(404).json({ message: 'Receipt not found' });
      }

      // Check if already posted
      if (receipt.posted) {
        return res.status(400).json({ message: 'Receipt has already been posted' });
      }

      // Check if user has access to this company
      const hasAccess = await storage.hasCompanyAccess(userId, receipt.companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: 'Access denied' });
      }

      // Validate amount is present and positive
      const totalAmount = (receipt.amount || 0) + (receipt.vatAmount || 0);
      if (totalAmount <= 0) {
        return res.status(400).json({ message: 'Receipt amount must be greater than zero' });
      }

      // Get accounts to validate they exist and are correct types
      const expenseAccount = await storage.getAccount(accountId);
      const paymentAccount = await storage.getAccount(paymentAccountId);

      if (!expenseAccount || !paymentAccount) {
        return res.status(404).json({ message: 'Account not found' });
      }

      // CRITICAL: Validate accounts belong to the same company as the receipt
      if (expenseAccount.companyId !== receipt.companyId) {
        return res.status(403).json({ message: 'Expense account must belong to the same company as the receipt' });
      }

      if (paymentAccount.companyId !== receipt.companyId) {
        return res.status(403).json({ message: 'Payment account must belong to the same company as the receipt' });
      }

      // Validate account types
      if (expenseAccount.type !== 'expense') {
        return res.status(400).json({ message: 'Selected account must be an expense account' });
      }

      if (paymentAccount.type !== 'asset') {
        return res.status(400).json({ message: 'Payment account must be a cash or bank account (asset)' });
      }

      // TODO: Wrap in database transaction to ensure atomicity
      // For now, we'll proceed with the journal entry creation
      // In production, this should be wrapped in a transaction

      // Create journal entry for the receipt
      const entry = await storage.createJournalEntry({
        companyId: receipt.companyId,
        date: receipt.date ? new Date(receipt.date) : new Date(),
        memo: `Receipt: ${receipt.merchant || 'Expense'} - ${receipt.category || 'General'}`,
        createdBy: userId,
      });

      // Debit: Expense Account (total amount including VAT)
      await storage.createJournalLine({
        entryId: entry.id,
        accountId: expenseAccount.id,
        debit: totalAmount,
        credit: 0,
      });

      // Credit: Payment Account (cash/bank)
      await storage.createJournalLine({
        entryId: entry.id,
        accountId: paymentAccount.id,
        debit: 0,
        credit: totalAmount,
      });

      // Update receipt with posting information
      const updatedReceipt = await storage.updateReceipt(id, {
        accountId,
        paymentAccountId,
        posted: true,
        journalEntryId: entry.id,
      });

      console.log('[Receipts] Receipt posted successfully:', id, 'Journal entry:', entry.id);
      res.json(updatedReceipt);
    } catch (error: any) {
      console.error('[Receipts] Error posting receipt:', error);
      res.status(500).json({ message: error.message || 'Failed to post receipt' });
    }
  });

  // =====================================
  // Journal Entry Routes
  // =====================================
  
  app.get("/api/companies/:companyId/journal", authMiddleware, async (req: Request, res: Response) => {
    try {
      const { companyId } = req.params;
      const userId = (req as any).user.id;
      
      // Check if user has access to this company
      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: 'Access denied' });
      }
      
      const entries = await storage.getJournalEntriesByCompanyId(companyId);
      
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

  app.post("/api/companies/:companyId/journal", authMiddleware, async (req: Request, res: Response) => {
    try {
      const { companyId } = req.params;
      const userId = (req as any).user.id;
      const { lines, date, ...entryData } = req.body;
      
      // Check if user has access to this company
      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: 'Access denied' });
      }
      
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
      
      // Convert date string to Date object if it's a string
      const entryDate = typeof date === 'string' ? new Date(date) : date;
      
      // Create journal entry
      const entry = await storage.createJournalEntry({
        ...entryData,
        date: entryDate,
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

  app.get("/api/journal/:id", authMiddleware, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const userId = (req as any).user.id;

      // Get journal entry
      const entry = await storage.getJournalEntry(id);
      if (!entry) {
        return res.status(404).json({ message: 'Journal entry not found' });
      }

      // Check if user has access to this company
      const hasAccess = await storage.hasCompanyAccess(userId, entry.companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: 'Access denied' });
      }

      // Get journal lines for this entry
      const lines = await storage.getJournalLinesByEntryId(id);

      res.json({
        ...entry,
        lines,
      });
    } catch (error: any) {
      console.error('[Journal] Error fetching journal entry:', error);
      res.status(500).json({ message: error.message });
    }
  });

  app.put("/api/journal/:id", authMiddleware, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const userId = (req as any).user.id;
      const { lines, date, ...entryData } = req.body;

      // Get journal entry to verify it exists and get company access
      const entry = await storage.getJournalEntry(id);
      if (!entry) {
        return res.status(404).json({ message: 'Journal entry not found' });
      }

      // Check if user has access to this company
      const hasAccess = await storage.hasCompanyAccess(userId, entry.companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: 'Access denied' });
      }

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

      // Convert date string to Date object if it's a string
      const entryDate = typeof date === 'string' ? new Date(date) : date;

      // Update journal entry
      const updatedEntry = await storage.updateJournalEntry(id, {
        ...entryData,
        date: entryDate,
      });

      // Delete existing lines and create new ones
      await storage.deleteJournalLinesByEntryId(id);
      for (const line of lines) {
        await storage.createJournalLine({
          entryId: id,
          accountId: line.accountId,
          debit: line.debit || 0,
          credit: line.credit || 0,
        });
      }

      console.log('[Journal] Journal entry updated successfully:', id);
      res.json({ id: updatedEntry.id, status: 'posted' });
    } catch (error: any) {
      console.error('[Journal] Error updating journal entry:', error);
      res.status(400).json({ message: error.message });
    }
  });

  app.delete("/api/journal/:id", authMiddleware, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const userId = (req as any).user.id;

      // Get journal entry to verify it exists and get company access
      const entry = await storage.getJournalEntry(id);
      if (!entry) {
        return res.status(404).json({ message: 'Journal entry not found' });
      }

      // Check if user has access to this company
      const hasAccess = await storage.hasCompanyAccess(userId, entry.companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: 'Access denied' });
      }

      await storage.deleteJournalEntry(id);
      res.json({ message: 'Journal entry deleted successfully' });
    } catch (error: any) {
      console.error('[Journal] Error deleting journal entry:', error);
      res.status(500).json({ message: error.message });
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
      
      // Build account list for AI prompt
      const accountList = expenseAccounts.map(acc => 
        `${acc.code}: ${acc.nameEn}${acc.nameAr ? ` (${acc.nameAr})` : ''}`
      ).join('\n');
      
      // Use OpenAI to categorize the expense
      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
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
  });

  // AI CFO Advice Route
  app.post("/api/ai/cfo-advice", authMiddleware, async (req: Request, res: Response) => {
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
      
      // Build financial context
      const financialContext = {
        companyName: company?.name,
        totalRevenue: context?.stats?.totalRevenue || 0,
        totalExpenses: context?.stats?.totalExpenses || 0,
        netIncome: context?.profitLoss?.netIncome || 0,
        totalInvoices: invoices.length,
        outstandingInvoices: invoices.filter(i => i.status === 'sent' || i.status === 'draft').length,
        totalReceipts: receipts.length,
        accountCount: accounts.length,
      };
      
      // Use OpenAI to provide CFO advice
      const completion = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          {
            role: "system",
            content: `You are an experienced CFO and financial advisor specializing in UAE businesses. You provide strategic financial advice based on real business data.

Company Financial Context:
- Company: ${financialContext.companyName}
- Total Revenue: AED ${financialContext.totalRevenue.toLocaleString()}
- Total Expenses: AED ${financialContext.totalExpenses.toLocaleString()}
- Net Income: AED ${financialContext.netIncome.toLocaleString()}
- Total Invoices: ${financialContext.totalInvoices}
- Outstanding Invoices: ${financialContext.outstandingInvoices}
- Receipts Processed: ${financialContext.totalReceipts}
- Chart of Accounts: ${financialContext.accountCount} accounts

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

  // =====================================
  // Waitlist Routes (Public)
  // =====================================
  
  app.post("/api/waitlist", async (req: Request, res: Response) => {
    try {
      const validated = insertWaitlistSchema.parse(req.body);
      
      // Check if email already exists
      const existing = await storage.getWaitlistByEmail(validated.email);
      if (existing) {
        return res.status(400).json({ message: 'Email already registered for waitlist' });
      }

      const entry = await storage.createWaitlistEntry(validated);
      
      res.json({
        message: 'Successfully added to waitlist!',
        email: entry.email,
      });
    } catch (error: any) {
      res.status(400).json({ message: error.message || 'Failed to join waitlist' });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}
