import type { Express, Request, Response } from "express";
import { createServer, type Server } from "http";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import OpenAI from "openai";
import { storage } from "./storage";
import { 
  insertUserSchema, 
  insertCompanySchema, 
  insertAccountSchema, 
  insertInvoiceSchema, 
  insertJournalEntrySchema, 
  categorizationRequestSchema, 
  insertWaitlistSchema,
  insertNotificationSchema,
  insertRegulatoryNewsSchema,
  insertReminderSettingSchema,
  insertReminderLogSchema,
  insertUserOnboardingSchema,
  insertReferralCodeSchema,
  insertReferralSchema,
  insertUserFeedbackSchema,
  insertAnalyticsEventSchema
} from "@shared/schema";
import { z } from "zod";
import * as googleSheets from "./integrations/googleSheets";

const JWT_SECRET = process.env.SESSION_SECRET || "dev-secret-change-in-production";
const JWT_EXPIRES_IN = "24h";

// Initialize AI client using OpenRouter with ultra-cheap Llama 3.2 model
// This uses Replit's AI Integrations service, which provides OpenRouter-compatible API access without requiring your own API key.
const openai = new OpenAI({
  baseURL: process.env.AI_INTEGRATIONS_OPENROUTER_BASE_URL,
  apiKey: process.env.AI_INTEGRATIONS_OPENROUTER_API_KEY,
});

// Llama 3.2 3B - Absolute cheapest AI model available (~20x cheaper than DeepSeek)
// Pricing: $0.06 input / $0.08 output per 1M tokens (vs DeepSeek's $0.56/$1.10)
// Using 3B version for better quality while staying ultra-cheap
const AI_MODEL = "meta-llama/llama-3.2-3b-instruct";

// Authentication middleware
async function authMiddleware(req: Request, res: Response, next: Function) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Unauthorized' });
  }

  const token = authHeader.substring(7);
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as { 
      userId: string; 
      email: string;
      isAdmin?: boolean;
      userType?: string;
    };
    
    // Fetch actual user from database to get authoritative userType (prevents JWT tampering)
    const user = await storage.getUser(decoded.userId);
    if (!user) {
      return res.status(401).json({ message: 'User not found' });
    }
    
    // Use server-side user data, not JWT claims (security: prevents privilege escalation)
    (req as any).user = { 
      id: user.id, 
      email: user.email,
      isAdmin: user.isAdmin === true,
      userType: user.userType || 'customer'
    };
    next();
  } catch (error) {
    return res.status(401).json({ message: 'Invalid or expired token' });
  }
}

// Admin authorization middleware
async function adminMiddleware(req: Request, res: Response, next: Function) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Unauthorized' });
  }

  const token = authHeader.substring(7);
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as { userId: string; email: string };
    const user = await storage.getUser(decoded.userId);
    
    if (!user || !user.isAdmin) {
      return res.status(403).json({ message: 'Admin access required' });
    }
    
    (req as any).user = { 
      id: user.id, 
      email: user.email, 
      isAdmin: true,
      userType: user.userType || 'admin'
    };
    next();
  } catch (error) {
    return res.status(401).json({ message: 'Invalid or expired token' });
  }
}

// Client-only middleware - restricts access to managed client portal features
function requireClientMiddleware(req: Request, res: Response, next: Function) {
  const user = (req as any).user;
  if (!user) {
    return res.status(401).json({ message: 'Authentication required' });
  }
  // Admins can access client routes for support purposes
  if (user.userType === 'client' || user.isAdmin) {
    next();
  } else {
    return res.status(403).json({ message: 'Access restricted to managed clients' });
  }
}

// Customer-only middleware - restricts access to full SaaS features
function requireCustomerMiddleware(req: Request, res: Response, next: Function) {
  const user = (req as any).user;
  if (!user) {
    return res.status(401).json({ message: 'Authentication required' });
  }
  // Admins can access customer routes for support purposes, customers have full access
  if (user.userType === 'customer' || user.isAdmin) {
    next();
  } else {
    return res.status(403).json({ message: 'Access restricted to SaaS customers' });
  }
}

// Flexible userType requirement middleware factory
function requireUserType(...allowedTypes: string[]) {
  return function(req: Request, res: Response, next: Function) {
    const user = (req as any).user;
    if (!user) {
      return res.status(401).json({ message: 'Authentication required' });
    }
    // Admins can access all routes
    if (user.isAdmin || allowedTypes.includes(user.userType)) {
      next();
    } else {
      return res.status(403).json({ 
        message: `Access restricted to: ${allowedTypes.join(', ')}` 
      });
    }
  };
}

// UAE Chart of Accounts seed data
const UAE_SEED_COA = [
  { nameEn: "Cash", nameAr: "نقد", type: "asset" },
  { nameEn: "Bank", nameAr: "بنك", type: "asset" },
  { nameEn: "Accounts Receivable", nameAr: "حسابات مدينة", type: "asset" },
  { nameEn: "Accounts Payable", nameAr: "حسابات دائنة", type: "liability" },
  { nameEn: "VAT Payable", nameAr: "ضريبة مستحقة", type: "liability" },
  { nameEn: "VAT Receivable", nameAr: "ضريبة مستردة", type: "asset" },
  { nameEn: "Owner's Equity", nameAr: "حقوق الملكية", type: "equity" },
  { nameEn: "Sales Revenue", nameAr: "إيرادات المبيعات", type: "income" },
  { nameEn: "Other Income", nameAr: "إيرادات أخرى", type: "income" },
  { nameEn: "COGS", nameAr: "تكلفة البضاعة المباعة", type: "expense" },
  { nameEn: "Rent Expense", nameAr: "مصروف الإيجار", type: "expense" },
  { nameEn: "Utilities Expense", nameAr: "مصروف المرافق", type: "expense" },
  { nameEn: "Marketing Expense", nameAr: "مصروف التسويق", type: "expense" },
  { nameEn: "Office Supplies", nameAr: "مستلزمات مكتبية", type: "expense" },
  { nameEn: "Travel Expenses", nameAr: "مصروفات السفر", type: "expense" },
];

async function seedChartOfAccounts(companyId: string) {
  for (const account of UAE_SEED_COA) {
    const accounts = await storage.getAccountsByCompanyId(companyId);
    const exists = accounts.find(a => a.nameEn === account.nameEn);
    if (!exists) {
      await storage.createAccount({
        companyId,
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
  
  // Customer self-signup (SaaS customers only - clients must use invitation)
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
      
      // SECURITY: Force userType to 'customer' - never trust client-supplied userType
      // Self-signup users can only be customers. Clients/admins must use invitation flow.
      // NOTE: Do NOT pass raw password to storage - only pass the hash
      const user = await storage.createUser({
        name: validated.name,
        email: validated.email,
        userType: 'customer', // FORCED: Self-signup users are always customers
        isAdmin: false, // FORCED: Self-signup users cannot be admins
        passwordHash,
      } as any);

      // Auto-create a default company for this user (marked as 'customer' type)
      const companyName = `${validated.name}'s Company`;
      const company = await storage.createCompany({
        name: companyName,
        baseCurrency: 'AED',
        locale: 'en',
        companyType: 'customer', // Self-signup companies are customer type (not managed by NR)
      });

      // Associate user with company as owner
      await storage.createCompanyUser({
        companyId: company.id,
        userId: user.id,
        role: 'owner',
      });

      // Seed Chart of Accounts for new company
      await seedChartOfAccounts(company.id);

      // Create free tier subscription for new customer
      const now = new Date();
      const periodEnd = new Date(now);
      periodEnd.setFullYear(periodEnd.getFullYear() + 100); // Free tier never expires
      
      await storage.createSubscription({
        companyId: company.id,
        planId: 'free',
        planName: 'Free',
        status: 'active',
        currentPeriodStart: now,
        currentPeriodEnd: periodEnd,
      });

      // Generate token - customers are not admins
      const token = jwt.sign({ userId: user.id, email: user.email, isAdmin: false, userType: 'customer' }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
      
      res.json({
        token,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          isAdmin: false,
          userType: 'customer',
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

      // Ensure isAdmin is a proper boolean
      const isAdminBoolean = user.isAdmin === true || user.isAdmin === 'true' || user.isAdmin === 1;
      const token = jwt.sign({ 
        userId: user.id, 
        email: user.email, 
        isAdmin: isAdminBoolean,
        userType: user.userType || 'customer'
      }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
      
      res.json({
        token,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          isAdmin: isAdminBoolean,
          userType: user.userType || 'customer', // Include userType in response
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

  // Seed Chart of Accounts for company
  // Customer-only: Seed chart of accounts
  app.post("/api/companies/:id/seed-accounts", authMiddleware, requireCustomerMiddleware, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const userId = (req as any).user.id;

      // Check if user has access to this company
      const hasAccess = await storage.hasCompanyAccess(userId, id);
      if (!hasAccess) {
        return res.status(403).json({ message: 'Access denied' });
      }

      // Seed Chart of Accounts
      await seedChartOfAccounts(id);
      
      const accountsWithBalances = await storage.getAccountsWithBalances(id);
      res.json({ 
        message: 'Chart of Accounts seeded successfully',
        accounts: accountsWithBalances
      });
    } catch (error: any) {
      console.error('[Seed Accounts] Error seeding accounts:', error);
      res.status(400).json({ message: error.message });
    }
  });

  // =====================================
  // Account Routes
  // =====================================
  
  // Customer-only: Full chart of accounts access
  app.get("/api/companies/:companyId/accounts", authMiddleware, requireCustomerMiddleware, async (req: Request, res: Response) => {
    try {
      const { companyId } = req.params;
      const userId = (req as any).user.id;
      
      // Verify company access
      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: 'Access denied' });
      }
      
      const accounts = await storage.getAccountsByCompanyId(companyId);
      res.json(accounts);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Customer-only: Create accounts
  app.post("/api/companies/:companyId/accounts", authMiddleware, requireCustomerMiddleware, async (req: Request, res: Response) => {
    try {
      const { companyId } = req.params;
      const userId = (req as any).user.id;
      
      // Verify company access
      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: 'Access denied' });
      }
      
      const validated = insertAccountSchema.parse({ ...req.body, companyId });

      const account = await storage.createAccount(validated);
      res.json(account);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  // Customer-only: Update accounts
  app.put("/api/accounts/:id", authMiddleware, requireCustomerMiddleware, async (req: Request, res: Response) => {
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

      const updatedAccount = await storage.updateAccount(id, req.body);
      res.json(updatedAccount);
    } catch (error: any) {
      console.error('[Accounts] Error updating account:', error);
      res.status(500).json({ message: error.message });
    }
  });

  // Customer-only: Delete accounts
  app.delete("/api/accounts/:id", authMiddleware, requireCustomerMiddleware, async (req: Request, res: Response) => {
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

  // Get accounts with balances for Chart of Accounts
  // Customer-only: Accounts with balances
  app.get("/api/companies/:companyId/accounts-with-balances", authMiddleware, requireCustomerMiddleware, async (req: Request, res: Response) => {
    try {
      const { companyId } = req.params;
      const userId = (req as any).user.id;
      
      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: 'Access denied' });
      }
      
      const { dateStart, dateEnd } = req.query;
      let dateRange: { start: Date; end: Date } | undefined;
      
      if (dateStart && dateEnd) {
        dateRange = {
          start: new Date(dateStart as string),
          end: new Date(dateEnd as string)
        };
      }
      
      const accountsWithBalances = await storage.getAccountsWithBalances(companyId, dateRange);
      res.json(accountsWithBalances);
    } catch (error: any) {
      console.error('[Accounts] Error getting accounts with balances:', error);
      res.status(500).json({ message: error.message });
    }
  });

  // Get account ledger
  // Customer-only: Account ledger
  app.get("/api/accounts/:id/ledger", authMiddleware, requireCustomerMiddleware, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const userId = (req as any).user.id;
      
      const account = await storage.getAccount(id);
      if (!account) {
        return res.status(404).json({ message: 'Account not found' });
      }
      
      const hasAccess = await storage.hasCompanyAccess(userId, account.companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: 'Access denied' });
      }
      
      const { dateStart, dateEnd, search, limit, offset } = req.query;
      
      const options: {
        dateStart?: Date;
        dateEnd?: Date;
        search?: string;
        limit?: number;
        offset?: number;
      } = {};
      
      if (dateStart) options.dateStart = new Date(dateStart as string);
      if (dateEnd) options.dateEnd = new Date(dateEnd as string);
      if (search) options.search = search as string;
      if (limit) options.limit = parseInt(limit as string);
      if (offset) options.offset = parseInt(offset as string);
      
      const ledger = await storage.getAccountLedger(id, options);
      res.json(ledger);
    } catch (error: any) {
      console.error('[Accounts] Error getting account ledger:', error);
      res.status(500).json({ message: error.message });
    }
  });

  // =====================================
  // Invoice Routes
  // =====================================
  
  // Customer-only: Full bookkeeping invoices (clients use simplified portal)
  app.get("/api/companies/:companyId/invoices", authMiddleware, requireCustomerMiddleware, async (req: Request, res: Response) => {
    try {
      const { companyId } = req.params;
      const userId = (req as any).user.id;
      
      // Verify company access
      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: 'Access denied' });
      }
      
      const invoices = await storage.getInvoicesByCompanyId(companyId);
      res.json(invoices);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Customer-only: Get single invoice
  app.get("/api/invoices/:id", authMiddleware, requireCustomerMiddleware, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const userId = (req as any).user.id;
      
      const invoice = await storage.getInvoice(id);
      
      if (!invoice) {
        return res.status(404).json({ message: 'Invoice not found' });
      }
      
      // Verify company access
      const hasAccess = await storage.hasCompanyAccess(userId, invoice.companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: 'Access denied' });
      }
      
      // Fetch invoice lines
      const lines = await storage.getInvoiceLinesByInvoiceId(id);
      
      res.json({ ...invoice, lines });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Check for similar invoices
  // Customer-only: Check for similar invoices
  app.post("/api/companies/:companyId/invoices/check-similar", authMiddleware, requireCustomerMiddleware, async (req: Request, res: Response) => {
    try {
      const { companyId } = req.params;
      const userId = (req as any).user.id;
      const { customerName, total, date } = req.body;
      
      // Check if user has access to this company
      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: 'Access denied' });
      }
      
      const invoices = await storage.getInvoicesByCompanyId(companyId);
      
      // Find similar invoices
      const similarInvoices = invoices.filter(invoice => {
        // Check if customer name is similar (case-insensitive partial match)
        const customerMatch = customerName && invoice.customerName && 
          invoice.customerName.toLowerCase().includes(customerName.toLowerCase()) ||
          customerName.toLowerCase().includes(invoice.customerName?.toLowerCase() || '');
        
        // Check if total is within 10% range
        const amountMatch = total && invoice.total &&
          Math.abs(invoice.total - total) / total < 0.1;
        
        // Check if date is within 7 days
        let dateMatch = false;
        if (date && invoice.date) {
          const checkDate = new Date(date);
          const invoiceDate = new Date(invoice.date);
          const daysDiff = Math.abs((checkDate.getTime() - invoiceDate.getTime()) / (1000 * 60 * 60 * 24));
          dateMatch = daysDiff <= 7;
        }
        
        // Return if at least 2 criteria match
        const matchCount = [customerMatch, amountMatch, dateMatch].filter(Boolean).length;
        return matchCount >= 2;
      });
      
      res.json({
        hasSimilar: similarInvoices.length > 0,
        similarInvoices: similarInvoices.slice(0, 5).map(invoice => ({
          id: invoice.id,
          number: invoice.number,
          customerName: invoice.customerName,
          total: invoice.total,
          date: invoice.date,
          status: invoice.status,
        })),
      });
    } catch (error: any) {
      console.error('[Invoices] Error checking similar invoices:', error);
      res.status(500).json({ message: error.message || 'Failed to check similar invoices' });
    }
  });

  // Customer-only: Create invoices
  app.post("/api/companies/:companyId/invoices", authMiddleware, requireCustomerMiddleware, async (req: Request, res: Response) => {
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
      const accountsReceivable = accounts.find(a => a.nameEn === 'Accounts Receivable');
      const salesRevenue = accounts.find(a => a.nameEn === 'Sales Revenue');
      const vatPayable = accounts.find(a => a.nameEn === 'VAT Payable');
      
      if (accountsReceivable && salesRevenue) {
        // Generate entry number atomically via storage helper
        const entryNumber = await storage.generateEntryNumber(companyId, invoiceDate);
        
        const entry = await storage.createJournalEntry({
          companyId: companyId,
          date: invoiceDate,
          memo: `Sales Invoice ${invoice.number} - ${invoice.customerName}`,
          entryNumber,
          status: 'draft', // Wait for manual posting
          source: 'invoice',
          sourceId: invoice.id,
          createdBy: userId,
          postedBy: null,
          postedAt: null,
        });

        // Debit: Accounts Receivable (total)
        await storage.createJournalLine({
          entryId: entry.id,
          accountId: accountsReceivable.id,
          debit: total,
          credit: 0,
          description: `Invoice ${invoice.number} - ${invoice.customerName}`,
        });

        // Credit: Sales Revenue (subtotal)
        await storage.createJournalLine({
          entryId: entry.id,
          accountId: salesRevenue.id,
          debit: 0,
          credit: subtotal,
          description: `Sales revenue - Invoice ${invoice.number}`,
        });

        // Credit: VAT Payable (vat amount) - if there's VAT
        if (vatAmount > 0 && vatPayable) {
          await storage.createJournalLine({
            entryId: entry.id,
            accountId: vatPayable.id,
            debit: 0,
            credit: vatAmount,
            description: `VAT output - Invoice ${invoice.number}`,
          });
        }

        console.log('[Invoices] Revenue recognition journal entry created:', entryNumber, 'for invoice:', invoice.id);
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

  // Post invoice journal entries
  // Customer-only: Post invoice to journal
  app.post("/api/invoices/:id/post", authMiddleware, requireCustomerMiddleware, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const userId = (req as any).user.id;
      
      // Get invoice
      const invoice = await storage.getInvoice(id);
      if (!invoice) {
        return res.status(404).json({ message: 'Invoice not found' });
      }

      // Check access
      const hasAccess = await storage.hasCompanyAccess(userId, invoice.companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: 'Access denied' });
      }

      // Get all draft entries for this invoice
      const entries = await storage.getJournalEntriesByCompanyId(invoice.companyId);
      const invoiceEntries = entries.filter(e => e.sourceId === id && e.status === 'draft');

      if (invoiceEntries.length === 0) {
        return res.status(400).json({ message: 'No draft entries to post' });
      }

      // Post all draft entries
      for (const entry of invoiceEntries) {
        await storage.updateJournalEntry(entry.id, {
          status: 'posted',
          postedBy: userId,
          postedAt: new Date(),
        });
      }

      res.json({ message: 'Invoice entries posted successfully', count: invoiceEntries.length });
    } catch (error: any) {
      console.error('[Invoices] Error posting entries:', error);
      res.status(500).json({ message: error.message || 'Failed to post entries' });
    }
  });

  // Customer-only: Update invoice
  app.put("/api/invoices/:id", authMiddleware, requireCustomerMiddleware, async (req: Request, res: Response) => {
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

  // Customer-only: Delete invoice
  app.delete("/api/invoices/:id", authMiddleware, requireCustomerMiddleware, async (req: Request, res: Response) => {
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

  // Customer-only: Update invoice status
  app.patch("/api/invoices/:id/status", authMiddleware, requireCustomerMiddleware, async (req: Request, res: Response) => {
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
        if (paymentAccount.type !== 'asset') {
          return res.status(400).json({ message: 'Payment account must be a cash or bank account' });
        }

        const accounts = await storage.getAccountsByCompanyId(invoice.companyId);
        const accountsReceivable = accounts.find(a => a.nameEn === 'Accounts Receivable');
        
        if (accountsReceivable) {
          // Generate entry number atomically via storage helper
          const now = new Date();
          const entryNumber = await storage.generateEntryNumber(invoice.companyId, now);
          
          const entry = await storage.createJournalEntry({
            companyId: invoice.companyId,
            date: now,
            memo: `Payment received for Invoice ${invoice.number}`,
            entryNumber,
            status: 'draft',
            source: 'payment',
            sourceId: invoice.id,
            createdBy: userId,
            postedBy: null,
            postedAt: null,
          });

          // Debit: Selected payment account (total)
          await storage.createJournalLine({
            entryId: entry.id,
            accountId: paymentAccountId,
            debit: invoice.total,
            credit: 0,
            description: `Payment received - Invoice ${invoice.number}`,
          });

          // Credit: Accounts Receivable (total)
          await storage.createJournalLine({
            entryId: entry.id,
            accountId: accountsReceivable.id,
            debit: 0,
            credit: invoice.total,
            description: `Clear A/R - Invoice ${invoice.number}`,
          });

          console.log('[Invoices] Payment journal entry created:', entryNumber, 'for invoice:', id, 'to account:', paymentAccount.nameEn);
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
  
  // Customer-only: Full receipts/expenses access
  app.get("/api/companies/:companyId/receipts", authMiddleware, requireCustomerMiddleware, async (req: Request, res: Response) => {
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
  
  // Check for similar transactions
  // Customer-only: Check for similar receipts/transactions
  app.post("/api/companies/:companyId/receipts/check-similar", authMiddleware, requireCustomerMiddleware, async (req: Request, res: Response) => {
    try {
      const { companyId } = req.params;
      const userId = (req as any).user.id;
      const { merchant, amount, date } = req.body;
      
      // Check if user has access to this company
      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: 'Access denied' });
      }
      
      const receipts = await storage.getReceiptsByCompanyId(companyId);
      
      // Find similar transactions
      const similarTransactions = receipts.filter(receipt => {
        // Check if merchant name is similar (case-insensitive partial match)
        const merchantMatch = merchant && receipt.merchant && 
          receipt.merchant.toLowerCase().includes(merchant.toLowerCase()) ||
          merchant.toLowerCase().includes(receipt.merchant?.toLowerCase() || '');
        
        // Check if amount is within 10% range
        const amountMatch = amount && receipt.amount &&
          Math.abs(receipt.amount - amount) / amount < 0.1;
        
        // Check if date is within 7 days
        let dateMatch = false;
        if (date && receipt.date) {
          const checkDate = new Date(date);
          const receiptDate = new Date(receipt.date);
          const daysDiff = Math.abs((checkDate.getTime() - receiptDate.getTime()) / (1000 * 60 * 60 * 24));
          dateMatch = daysDiff <= 7;
        }
        
        // Return if at least 2 criteria match
        const matchCount = [merchantMatch, amountMatch, dateMatch].filter(Boolean).length;
        return matchCount >= 2;
      });
      
      res.json({
        hasSimilar: similarTransactions.length > 0,
        similarTransactions: similarTransactions.slice(0, 5).map(receipt => ({
          id: receipt.id,
          merchant: receipt.merchant,
          amount: receipt.amount,
          date: receipt.date,
          category: receipt.category,
        })),
      });
    } catch (error: any) {
      console.error('[Receipts] Error checking similar transactions:', error);
      res.status(500).json({ message: error.message || 'Failed to check similar transactions' });
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
        companyId, // Add companyId from URL params
        uploadedBy: userId,
      });
      
      console.log('[Receipts] Receipt created successfully:', receipt.id);
      res.json(receipt);
    } catch (error: any) {
      console.error('[Receipts] Error creating receipt:', error);
      res.status(400).json({ message: error.message || 'Failed to create receipt' });
    }
  });

  // Customer-only: Update receipt
  app.put("/api/receipts/:id", authMiddleware, requireCustomerMiddleware, async (req: Request, res: Response) => {
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

  // Customer-only: Delete receipt
  app.delete("/api/receipts/:id", authMiddleware, requireCustomerMiddleware, async (req: Request, res: Response) => {
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

  // Customer-only: Post receipt to journal entry
  app.post("/api/receipts/:id/post", authMiddleware, requireCustomerMiddleware, async (req: Request, res: Response) => {
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

      // Parse date safely
      let entryDate: Date;
      try {
        const parsed = new Date(receipt.date || new Date());
        if (isNaN(parsed.getTime())) {
          entryDate = new Date();
        } else {
          entryDate = parsed;
        }
      } catch (e) {
        entryDate = new Date();
      }

      // Generate entry number atomically via storage helper
      const entryNumber = await storage.generateEntryNumber(receipt.companyId, entryDate);
      
      // Create journal entry for the receipt
      const entry = await storage.createJournalEntry({
        companyId: receipt.companyId,
        date: entryDate,
        memo: `Receipt: ${receipt.merchant || 'Expense'} - ${receipt.category || 'General'}`,
        entryNumber,
        status: 'posted',
        source: 'receipt',
        sourceId: receipt.id,
        createdBy: userId,
        postedBy: userId,
        postedAt: new Date(),
      });

      // Debit: Expense Account (total amount including VAT)
      await storage.createJournalLine({
        entryId: entry.id,
        accountId: expenseAccount.id,
        debit: totalAmount,
        credit: 0,
        description: `${receipt.merchant || 'Expense'} - ${receipt.category || 'General'}`,
      });

      // Credit: Payment Account (cash/bank)
      await storage.createJournalLine({
        entryId: entry.id,
        accountId: paymentAccount.id,
        debit: 0,
        credit: totalAmount,
        description: `Payment for ${receipt.merchant || 'expense'}`,
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
  
  // Customer-only: Full journal entries access
  app.get("/api/companies/:companyId/journal", authMiddleware, requireCustomerMiddleware, async (req: Request, res: Response) => {
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

  // Customer-only: Create journal entries
  app.post("/api/companies/:companyId/journal", authMiddleware, requireCustomerMiddleware, async (req: Request, res: Response) => {
    try {
      const { companyId } = req.params;
      const userId = (req as any).user.id;
      const { lines, date, status = 'draft', ...entryData } = req.body;
      
      // Check if user has access to this company
      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: 'Access denied' });
      }
      
      // Validate at least 2 lines
      if (!lines || lines.length < 2) {
        return res.status(400).json({ message: 'Journal entry must have at least 2 lines' });
      }
      
      // Validate debits equal credits
      let totalDebit = 0;
      let totalCredit = 0;
      
      for (const line of lines) {
        totalDebit += Number(line.debit) || 0;
        totalCredit += Number(line.credit) || 0;
      }
      
      // Ensure at least one debit and one credit
      if (totalDebit === 0 || totalCredit === 0) {
        return res.status(400).json({ message: 'Entry must have at least one debit and one credit' });
      }
      
      if (Math.abs(totalDebit - totalCredit) > 0.01) {
        return res.status(400).json({ message: `Debits (${totalDebit.toFixed(2)}) must equal credits (${totalCredit.toFixed(2)})` });
      }
      
      // Convert date string to Date object if it's a string
      const entryDate = typeof date === 'string' ? new Date(date) : date;
      
      // Generate entry number atomically via storage helper
      const entryNumber = await storage.generateEntryNumber(companyId, entryDate);
      
      // Determine if posting immediately
      const isPosting = status === 'posted';
      
      // Create journal entry
      const entry = await storage.createJournalEntry({
        ...entryData,
        date: entryDate,
        companyId,
        createdBy: userId,
        entryNumber,
        status: isPosting ? 'posted' : 'draft',
        source: entryData.source || 'manual',
        sourceId: entryData.sourceId || null,
        postedBy: isPosting ? userId : null,
        postedAt: isPosting ? new Date() : null,
      });
      
      // Create journal lines
      for (const line of lines) {
        await storage.createJournalLine({
          entryId: entry.id,
          accountId: line.accountId,
          debit: Number(line.debit) || 0,
          credit: Number(line.credit) || 0,
          description: line.description || null,
        });
      }
      
      res.json({ 
        id: entry.id, 
        entryNumber: entry.entryNumber,
        status: entry.status,
        message: isPosting ? 'Journal entry posted successfully' : 'Journal entry saved as draft'
      });
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  // Customer-only: Get journal entry
  app.get("/api/journal/:id", authMiddleware, requireCustomerMiddleware, async (req: Request, res: Response) => {
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

  // Customer-only: Update journal entry
  app.put("/api/journal/:id", authMiddleware, requireCustomerMiddleware, async (req: Request, res: Response) => {
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

      // IMMUTABILITY: Posted entries cannot be edited - must be reversed instead
      if (entry.status === 'posted') {
        return res.status(400).json({ 
          message: 'Posted journal entries cannot be edited. Use reversal to correct posted entries.',
          code: 'ENTRY_POSTED'
        });
      }

      // Void entries cannot be edited
      if (entry.status === 'void') {
        return res.status(400).json({ 
          message: 'Void journal entries cannot be edited.',
          code: 'ENTRY_VOID'
        });
      }

      // Validate at least 2 lines
      if (!lines || lines.length < 2) {
        return res.status(400).json({ message: 'Journal entry must have at least 2 lines' });
      }

      // Validate debits equal credits
      let totalDebit = 0;
      let totalCredit = 0;

      for (const line of lines) {
        totalDebit += Number(line.debit) || 0;
        totalCredit += Number(line.credit) || 0;
      }

      // Ensure at least one debit and one credit
      if (totalDebit === 0 || totalCredit === 0) {
        return res.status(400).json({ message: 'Entry must have at least one debit and one credit' });
      }

      if (Math.abs(totalDebit - totalCredit) > 0.01) {
        return res.status(400).json({ message: `Debits (${totalDebit.toFixed(2)}) must equal credits (${totalCredit.toFixed(2)})` });
      }

      // Convert date string to Date object if it's a string
      const entryDate = typeof date === 'string' ? new Date(date) : date;

      // Update journal entry with audit trail
      const updatedEntry = await storage.updateJournalEntry(id, {
        ...entryData,
        date: entryDate,
        updatedBy: userId,
        updatedAt: new Date(),
      });

      // Delete existing lines and create new ones
      await storage.deleteJournalLinesByEntryId(id);
      for (const line of lines) {
        await storage.createJournalLine({
          entryId: id,
          accountId: line.accountId,
          debit: Number(line.debit) || 0,
          credit: Number(line.credit) || 0,
          description: line.description || null,
        });
      }

      console.log('[Journal] Draft journal entry updated successfully:', id);
      res.json({ id: updatedEntry.id, status: updatedEntry.status, message: 'Draft entry updated successfully' });
    } catch (error: any) {
      console.error('[Journal] Error updating journal entry:', error);
      res.status(400).json({ message: error.message });
    }
  });

  // Customer-only: Post a draft journal entry (makes it immutable)
  app.post("/api/journal/:id/post", authMiddleware, requireCustomerMiddleware, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const userId = (req as any).user.id;

      const entry = await storage.getJournalEntry(id);
      if (!entry) {
        return res.status(404).json({ message: 'Journal entry not found' });
      }

      const hasAccess = await storage.hasCompanyAccess(userId, entry.companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: 'Access denied' });
      }

      if (entry.status !== 'draft') {
        // Only draft entries can be posted - posted entries are immutable, void entries cannot be re-activated
        const errorMessage = entry.status === 'posted' 
          ? 'Entry is already posted and cannot be modified'
          : 'Void entries cannot be posted or reactivated';
        return res.status(400).json({ message: errorMessage, code: `ENTRY_${entry.status.toUpperCase()}` });
      }

      // Validate debits = credits before posting
      const lines = await storage.getJournalLinesByEntryId(id);
      let totalDebit = 0;
      let totalCredit = 0;
      for (const line of lines) {
        totalDebit += Number(line.debit) || 0;
        totalCredit += Number(line.credit) || 0;
      }

      if (Math.abs(totalDebit - totalCredit) > 0.01) {
        return res.status(400).json({ message: 'Cannot post: Debits must equal credits' });
      }

      const updatedEntry = await storage.updateJournalEntry(id, {
        status: 'posted',
        postedBy: userId,
        postedAt: new Date(),
      });

      console.log('[Journal] Entry posted successfully:', id);
      res.json({ id: updatedEntry.id, status: 'posted', message: 'Entry posted successfully' });
    } catch (error: any) {
      console.error('[Journal] Error posting entry:', error);
      res.status(500).json({ message: error.message });
    }
  });

  // Customer-only: Reverse a posted journal entry (creates a new reversing entry)
  app.post("/api/journal/:id/reverse", authMiddleware, requireCustomerMiddleware, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const userId = (req as any).user.id;
      const { reason } = req.body;

      const entry = await storage.getJournalEntry(id);
      if (!entry) {
        return res.status(404).json({ message: 'Journal entry not found' });
      }

      const hasAccess = await storage.hasCompanyAccess(userId, entry.companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: 'Access denied' });
      }

      if (entry.status !== 'posted') {
        return res.status(400).json({ message: 'Only posted entries can be reversed' });
      }

      // Get original lines
      const originalLines = await storage.getJournalLinesByEntryId(id);

      // Generate reversal entry number atomically via storage helper
      const now = new Date();
      const reversalNumber = await storage.generateEntryNumber(entry.companyId, now);

      // Create reversing entry with swapped debits/credits
      const reversalEntry = await storage.createJournalEntry({
        companyId: entry.companyId,
        date: now,
        memo: `Reversal of ${entry.entryNumber}: ${reason || 'No reason provided'}`,
        entryNumber: reversalNumber,
        status: 'posted',
        source: 'reversal',
        sourceId: id,
        reversedEntryId: id,
        reversalReason: reason || null,
        createdBy: userId,
        postedBy: userId,
        postedAt: new Date(),
      });

      // Create reversed lines (swap debits and credits)
      for (const line of originalLines) {
        await storage.createJournalLine({
          entryId: reversalEntry.id,
          accountId: line.accountId,
          debit: line.credit, // Swap
          credit: line.debit, // Swap
          description: `Reversal: ${line.description || ''}`,
        });
      }

      // Mark original entry as void
      await storage.updateJournalEntry(id, {
        status: 'void',
        updatedBy: userId,
        updatedAt: new Date(),
      });

      console.log('[Journal] Entry reversed:', id, '-> new entry:', reversalEntry.id);
      res.json({ 
        originalId: id,
        reversalId: reversalEntry.id,
        reversalNumber: reversalEntry.entryNumber,
        message: 'Entry reversed successfully'
      });
    } catch (error: any) {
      console.error('[Journal] Error reversing entry:', error);
      res.status(500).json({ message: error.message });
    }
  });

  // Customer-only: Delete journal entry
  app.delete("/api/journal/:id", authMiddleware, requireCustomerMiddleware, async (req: Request, res: Response) => {
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

      // IMMUTABILITY: Posted entries cannot be deleted - must be reversed
      if (entry.status === 'posted') {
        return res.status(400).json({ 
          message: 'Posted entries cannot be deleted. Use the reverse action to void this entry.',
          code: 'ENTRY_POSTED'
        });
      }

      // Void entries should not be deleted either (audit trail)
      if (entry.status === 'void') {
        return res.status(400).json({ 
          message: 'Void entries cannot be deleted (required for audit trail).',
          code: 'ENTRY_VOID'
        });
      }

      // Only draft entries can be deleted
      await storage.deleteJournalEntry(id);
      console.log('[Journal] Draft entry deleted:', id);
      res.json({ message: 'Draft entry deleted successfully' });
    } catch (error: any) {
      console.error('[Journal] Error deleting journal entry:', error);
      res.status(500).json({ message: error.message });
    }
  });

  // =====================================
  // AI Categorization Route
  // =====================================
  
  // Customer-only: AI expense categorization
  app.post("/api/ai/categorize", authMiddleware, requireCustomerMiddleware, async (req: Request, res: Response) => {
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
  });

  // AI Bank Statement Parser Route
  app.post("/api/ai/parse-bank-statement", authMiddleware, async (req: Request, res: Response) => {
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
  });

  // =====================================
  // AI-Driven Automation Features
  // =====================================

  // Enhanced AI Batch Transaction Categorization
  app.post("/api/ai/batch-categorize", authMiddleware, requireCustomerMiddleware, async (req: Request, res: Response) => {
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
  });

  // Anomaly & Duplicate Detection
  app.post("/api/ai/detect-anomalies", authMiddleware, requireCustomerMiddleware, async (req: Request, res: Response) => {
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
  });

  // Get Anomaly Alerts
  app.get("/api/companies/:companyId/anomaly-alerts", authMiddleware, requireCustomerMiddleware, async (req: Request, res: Response) => {
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
  });

  // Resolve Anomaly Alert
  app.post("/api/anomaly-alerts/:id/resolve", authMiddleware, requireCustomerMiddleware, async (req: Request, res: Response) => {
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
  });

  // AI-Assisted Bank Reconciliation
  app.post("/api/ai/reconcile", authMiddleware, requireCustomerMiddleware, async (req: Request, res: Response) => {
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
  });

  // Apply Reconciliation Match
  app.post("/api/bank-transactions/:id/reconcile", authMiddleware, async (req: Request, res: Response) => {
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
  });

  // Bank Transactions CRUD
  app.get("/api/companies/:companyId/bank-transactions", authMiddleware, requireCustomerMiddleware, async (req: Request, res: Response) => {
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
  });

  app.post("/api/companies/:companyId/bank-transactions", authMiddleware, requireCustomerMiddleware, async (req: Request, res: Response) => {
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
  });

  // Import bank transactions from CSV
  app.post("/api/companies/:companyId/bank-transactions/import", authMiddleware, requireCustomerMiddleware, async (req: Request, res: Response) => {
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
  });

  // Predictive Cash Flow Forecasting
  app.post("/api/ai/forecast-cashflow", authMiddleware, requireCustomerMiddleware, async (req: Request, res: Response) => {
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
  });

  // Get stored forecasts
  app.get("/api/companies/:companyId/forecasts", authMiddleware, async (req: Request, res: Response) => {
    try {
      const { companyId } = req.params;
      const forecasts = await storage.getCashFlowForecastsByCompanyId(companyId);
      res.json(forecasts);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Transaction Classification Feedback (for ML learning)
  app.post("/api/ai/classification-feedback", authMiddleware, async (req: Request, res: Response) => {
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
  });

  // =====================================
  // Natural Language Gateway Routes
  // =====================================

  // Main Natural Language Query Endpoint
  app.post("/api/ai/nl-gateway", authMiddleware, async (req: Request, res: Response) => {
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

RESPONSE FORMAT:
Respond naturally in conversational language. Include:
1. Direct answer to the question
2. Relevant context or insights if helpful
3. Suggestions for follow-up questions or actions if appropriate

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
  });

  // Autocomplete endpoints for smart suggestions
  app.get("/api/autocomplete/accounts", authMiddleware, async (req: Request, res: Response) => {
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
  });

  app.get("/api/autocomplete/customers", authMiddleware, async (req: Request, res: Response) => {
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
  });

  app.get("/api/autocomplete/merchants", authMiddleware, async (req: Request, res: Response) => {
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
  });

  app.get("/api/autocomplete/descriptions", authMiddleware, async (req: Request, res: Response) => {
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
  });

  // Smart suggestions based on context
  app.post("/api/ai/smart-suggest", authMiddleware, async (req: Request, res: Response) => {
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
        totalInvoices: invoices.length,
        totalEntries: entries.length,
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
          
          const current = balances.get(account.id) || 0;
          balances.set(account.id, current + line.debit - line.credit);
        }
      }
      
      const breakdown = expenseAccounts
        .map(account => ({
          name: account.nameEn,
          value: balances.get(account.id) || 0,
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
      const { startDate, endDate } = req.query;
      
      const accounts = await storage.getAccountsByCompanyId(companyId);
      let entries = await storage.getJournalEntriesByCompanyId(companyId);
      
      // Filter entries by date range if provided
      if (startDate || endDate) {
        const start = startDate ? new Date(startDate as string) : null;
        const end = endDate ? new Date(endDate as string) : null;
        
        entries = entries.filter(entry => {
          const entryDate = new Date(entry.date);
          if (start && entryDate < start) return false;
          if (end && entryDate > end) return false;
          return true;
        });
      }
      
      // Calculate balances for each account
      const balances = new Map<string, number>();
      
      for (const entry of entries) {
        const lines = await storage.getJournalLinesByEntryId(entry.id);
        for (const line of lines) {
          const account = accounts.find(a => a.id === line.accountId);
          if (!account) continue;
          
          const current = balances.get(account.id) || 0;
          if (account.type === 'income') {
            balances.set(account.id, current + line.credit - line.debit);
          } else if (account.type === 'expense') {
            balances.set(account.id, current + line.debit - line.credit);
          }
        }
      }
      
      const revenue = accounts
        .filter(a => a.type === 'income')
        .map(a => ({
          accountName: a.nameEn,
          amount: balances.get(a.id) || 0,
        }))
        .filter(item => item.amount > 0);
      
      const expenses = accounts
        .filter(a => a.type === 'expense')
        .map(a => ({
          accountName: a.nameEn,
          amount: balances.get(a.id) || 0,
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
      const { startDate, endDate } = req.query;
      
      const accounts = await storage.getAccountsByCompanyId(companyId);
      let entries = await storage.getJournalEntriesByCompanyId(companyId);
      
      // Filter entries by date range if provided
      if (startDate || endDate) {
        const start = startDate ? new Date(startDate as string) : null;
        const end = endDate ? new Date(endDate as string) : null;
        
        entries = entries.filter(entry => {
          const entryDate = new Date(entry.date);
          if (start && entryDate < start) return false;
          if (end && entryDate > end) return false;
          return true;
        });
      }
      
      // Calculate balances
      const balances = new Map<string, number>();
      
      for (const entry of entries) {
        const lines = await storage.getJournalLinesByEntryId(entry.id);
        for (const line of lines) {
          const account = accounts.find(a => a.id === line.accountId);
          if (!account) continue;
          
          const current = balances.get(account.id) || 0;
          if (account.type === 'asset' || account.type === 'expense') {
            balances.set(account.id, current + line.debit - line.credit);
          } else {
            balances.set(account.id, current + line.credit - line.debit);
          }
        }
      }
      
      const assets = accounts
        .filter(a => a.type === 'asset')
        .map(a => ({
          accountName: a.nameEn,
          amount: balances.get(a.id) || 0,
        }));
      
      const liabilities = accounts
        .filter(a => a.type === 'liability')
        .map(a => ({
          accountName: a.nameEn,
          amount: balances.get(a.id) || 0,
        }));
      
      const equity = accounts
        .filter(a => a.type === 'equity')
        .map(a => ({
          accountName: a.nameEn,
          amount: balances.get(a.id) || 0,
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
      const { startDate, endDate } = req.query;
      
      let invoices = await storage.getInvoicesByCompanyId(companyId);
      let receipts = await storage.getReceiptsByCompanyId(companyId);
      
      // Filter invoices by date range if provided
      if (startDate || endDate) {
        const start = startDate ? new Date(startDate as string) : null;
        const end = endDate ? new Date(endDate as string) : null;
        
        invoices = invoices.filter(invoice => {
          const invoiceDate = new Date(invoice.date);
          if (start && invoiceDate < start) return false;
          if (end && invoiceDate > end) return false;
          return true;
        });
        
        receipts = receipts.filter(receipt => {
          const receiptDate = new Date(receipt.date);
          if (start && receiptDate < start) return false;
          if (end && receiptDate > end) return false;
          return true;
        });
      }
      
      let salesSubtotal = 0;
      let salesVAT = 0;
      
      for (const invoice of invoices) {
        if (invoice.status !== 'void') {
          salesSubtotal += invoice.subtotal;
          salesVAT += invoice.vatAmount;
        }
      }
      
      // Calculate purchases VAT from posted receipts/expenses
      // Note: receipt.amount is the subtotal (VAT-exclusive), receipt.vatAmount is the VAT component
      let purchasesSubtotal = 0;
      let purchasesVAT = 0;
      
      for (const receipt of receipts) {
        if (receipt.posted) {
          // receipt.amount = subtotal (VAT-exclusive)
          // receipt.vatAmount = VAT amount (separate field)
          purchasesSubtotal += (receipt.amount || 0);
          purchasesVAT += (receipt.vatAmount || 0);
        }
      }
      
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
        return res.json({ revenue: 0, expenses: 0, outstanding: 0, totalInvoices: 0, totalEntries: 0 });
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
        totalInvoices: invoices.length,
        totalEntries: entries.length,
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
          
          const current = balances.get(account.id) || { name: account.nameEn, value: 0 };
          current.value += line.debit - line.credit;
          balances.set(account.id, current);
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

  // =====================================
  // Integration Routes
  // =====================================
  
  // Get integration status
  app.get("/api/integrations/status", authMiddleware, async (req: Request, res: Response) => {
    try {
      const googleSheetsConnected = await googleSheets.isGoogleSheetsConnected();
      
      res.json({
        googleSheets: {
          connected: googleSheetsConnected,
          name: 'Google Sheets',
          description: 'Export financial data to spreadsheets',
        },
        xero: {
          connected: false,
          name: 'Xero',
          description: 'Sync with Xero accounting',
          comingSoon: true,
        },
        quickbooks: {
          connected: false,
          name: 'QuickBooks Online',
          description: 'Sync with QuickBooks',
          comingSoon: true,
        },
        whatsapp: {
          connected: false,
          name: 'WhatsApp',
          description: 'Extract receipts from chats',
          comingSoon: true,
        },
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });
  
  // Get sync history
  app.get("/api/integrations/sync-history", authMiddleware, async (req: Request, res: Response) => {
    try {
      const { companyId, integrationType } = req.query;
      if (!companyId) {
        return res.status(400).json({ message: 'Company ID required' });
      }
      
      let syncs;
      if (integrationType) {
        syncs = await storage.getIntegrationSyncsByType(companyId as string, integrationType as string);
      } else {
        syncs = await storage.getIntegrationSyncsByCompanyId(companyId as string);
      }
      
      res.json(syncs);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });
  
  // List available Google Sheets spreadsheets
  app.get("/api/integrations/google-sheets/spreadsheets", authMiddleware, async (req: Request, res: Response) => {
    try {
      const isConnected = await googleSheets.isGoogleSheetsConnected();
      if (!isConnected) {
        return res.status(400).json({ message: 'Google Sheets not connected' });
      }
      
      const spreadsheets = await googleSheets.listSpreadsheets();
      res.json(spreadsheets);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });
  
  // Export invoices to Google Sheets
  // Customer-only: Export invoices to Google Sheets
  app.post("/api/integrations/google-sheets/export/invoices", authMiddleware, requireCustomerMiddleware, async (req: Request, res: Response) => {
    try {
      const { companyId, spreadsheetId } = req.body;
      if (!companyId) {
        return res.status(400).json({ message: 'Company ID required' });
      }
      
      const isConnected = await googleSheets.isGoogleSheetsConnected();
      if (!isConnected) {
        return res.status(400).json({ message: 'Google Sheets not connected' });
      }
      
      // Fetch invoices
      const invoices = await storage.getInvoicesByCompanyId(companyId);
      
      // Export to sheet
      const result = await googleSheets.exportInvoicesToSheet(invoices, spreadsheetId);
      
      // Log the sync
      await storage.createIntegrationSync({
        companyId,
        integrationType: 'google_sheets',
        syncType: 'export',
        dataType: 'invoices',
        status: 'completed',
        recordCount: invoices.length,
        externalId: result.spreadsheetId,
        externalUrl: result.url,
      });
      
      res.json({
        message: 'Invoices exported successfully',
        ...result,
        recordCount: invoices.length,
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });
  
  // Export expenses to Google Sheets
  // Customer-only: Export expenses to Google Sheets
  app.post("/api/integrations/google-sheets/export/expenses", authMiddleware, requireCustomerMiddleware, async (req: Request, res: Response) => {
    try {
      const { companyId, spreadsheetId } = req.body;
      if (!companyId) {
        return res.status(400).json({ message: 'Company ID required' });
      }
      
      const isConnected = await googleSheets.isGoogleSheetsConnected();
      if (!isConnected) {
        return res.status(400).json({ message: 'Google Sheets not connected' });
      }
      
      // Fetch receipts/expenses
      const expenses = await storage.getReceiptsByCompanyId(companyId);
      
      // Export to sheet
      const result = await googleSheets.exportExpensesToSheet(expenses, spreadsheetId);
      
      // Log the sync
      await storage.createIntegrationSync({
        companyId,
        integrationType: 'google_sheets',
        syncType: 'export',
        dataType: 'expenses',
        status: 'completed',
        recordCount: expenses.length,
        externalId: result.spreadsheetId,
        externalUrl: result.url,
      });
      
      res.json({
        message: 'Expenses exported successfully',
        ...result,
        recordCount: expenses.length,
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });
  
  // Export journal entries to Google Sheets
  // Customer-only: Export journal entries to Google Sheets
  app.post("/api/integrations/google-sheets/export/journal-entries", authMiddleware, requireCustomerMiddleware, async (req: Request, res: Response) => {
    try {
      const { companyId, spreadsheetId } = req.body;
      if (!companyId) {
        return res.status(400).json({ message: 'Company ID required' });
      }
      
      const isConnected = await googleSheets.isGoogleSheetsConnected();
      if (!isConnected) {
        return res.status(400).json({ message: 'Google Sheets not connected' });
      }
      
      // Fetch journal entries with lines
      const entries = await storage.getJournalEntriesByCompanyId(companyId);
      const accounts = await storage.getAccountsByCompanyId(companyId);
      
      // Enrich entries with lines and account info
      const enrichedEntries = await Promise.all(entries.map(async (entry, index) => {
        const lines = await storage.getJournalLinesByEntryId(entry.id);
        return {
          entryNumber: index + 1,
          date: entry.date instanceof Date ? entry.date.toISOString().split('T')[0] : entry.date,
          description: entry.memo || '',
          lines: lines.map(line => {
            const account = accounts.find(a => a.id === line.accountId);
            return {
              accountName: account?.nameEn || '',
              debit: line.debit,
              credit: line.credit,
            };
          }),
        };
      }));
      
      // Export to sheet
      const result = await googleSheets.exportJournalEntriesToSheet(enrichedEntries, spreadsheetId);
      
      // Log the sync
      await storage.createIntegrationSync({
        companyId,
        integrationType: 'google_sheets',
        syncType: 'export',
        dataType: 'journal_entries',
        status: 'completed',
        recordCount: entries.length,
        externalId: result.spreadsheetId,
        externalUrl: result.url,
      });
      
      res.json({
        message: 'Journal entries exported successfully',
        ...result,
        recordCount: entries.length,
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });
  
  // Export chart of accounts to Google Sheets
  // Customer-only: Export chart of accounts to Google Sheets
  app.post("/api/integrations/google-sheets/export/chart-of-accounts", authMiddleware, requireCustomerMiddleware, async (req: Request, res: Response) => {
    try {
      const { companyId, spreadsheetId } = req.body;
      if (!companyId) {
        return res.status(400).json({ message: 'Company ID required' });
      }
      
      const isConnected = await googleSheets.isGoogleSheetsConnected();
      if (!isConnected) {
        return res.status(400).json({ message: 'Google Sheets not connected' });
      }
      
      // Fetch accounts
      const accounts = await storage.getAccountsByCompanyId(companyId);
      
      // Export to sheet
      const result = await googleSheets.exportChartOfAccountsToSheet(accounts, spreadsheetId);
      
      // Log the sync
      await storage.createIntegrationSync({
        companyId,
        integrationType: 'google_sheets',
        syncType: 'export',
        dataType: 'chart_of_accounts',
        status: 'completed',
        recordCount: accounts.length,
        externalId: result.spreadsheetId,
        externalUrl: result.url,
      });
      
      res.json({
        message: 'Chart of Accounts exported successfully',
        ...result,
        recordCount: accounts.length,
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Import invoices from Google Sheets
  app.post("/api/integrations/google-sheets/import/invoices", authMiddleware, async (req: Request, res: Response) => {
    try {
      const { companyId, sheetUrl } = req.body;
      if (!companyId || !sheetUrl) {
        return res.status(400).json({ message: 'Company ID and sheet URL required' });
      }
      
      const isConnected = await googleSheets.isGoogleSheetsConnected();
      if (!isConnected) {
        return res.status(400).json({ message: 'Google Sheets not connected' });
      }
      
      // Extract spreadsheet ID from URL
      const match = sheetUrl.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
      if (!match) {
        return res.status(400).json({ message: 'Invalid Google Sheets URL' });
      }
      
      const spreadsheetId = match[1];
      
      // Import invoices from sheet
      const invoices = await googleSheets.importInvoicesFromSheet(spreadsheetId);
      
      // Create invoices in database
      let createdCount = 0;
      for (const invoiceData of invoices) {
        try {
          const invoice = await storage.createInvoice({
            companyId,
            number: invoiceData.invoiceNumber,
            customerName: invoiceData.customerName,
            customerTrn: invoiceData.customerTrn,
            date: new Date(invoiceData.issueDate),
            subtotal: invoiceData.subtotal,
            vatAmount: invoiceData.vatAmount,
            total: invoiceData.total,
            status: invoiceData.status || 'draft',
          });
          createdCount++;
        } catch (err) {
          console.error('Error creating invoice:', err);
        }
      }
      
      // Log the sync
      await storage.createIntegrationSync({
        companyId,
        integrationType: 'google_sheets',
        syncType: 'import',
        dataType: 'invoices',
        status: 'completed',
        recordCount: createdCount,
        externalUrl: sheetUrl,
      });
      
      res.json({
        message: 'Invoices imported successfully',
        recordCount: createdCount,
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Import expenses from Google Sheets
  app.post("/api/integrations/google-sheets/import/expenses", authMiddleware, async (req: Request, res: Response) => {
    try {
      const userId = (req as any).user?.id;
      const { companyId, sheetUrl } = req.body;
      if (!companyId || !sheetUrl || !userId) {
        return res.status(400).json({ message: 'Company ID, sheet URL, and user authentication required' });
      }
      
      const isConnected = await googleSheets.isGoogleSheetsConnected();
      if (!isConnected) {
        return res.status(400).json({ message: 'Google Sheets not connected' });
      }
      
      // Extract spreadsheet ID from URL
      const match = sheetUrl.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
      if (!match) {
        return res.status(400).json({ message: 'Invalid Google Sheets URL' });
      }
      
      const spreadsheetId = match[1];
      
      // Import expenses from sheet
      const expenses = await googleSheets.importExpensesFromSheet(spreadsheetId);
      
      // Create expenses in database
      let createdCount = 0;
      for (const expenseData of expenses) {
        try {
          const receipt = await storage.createReceipt({
            companyId,
            date: expenseData.date,
            merchant: expenseData.merchant,
            category: expenseData.category,
            amount: expenseData.amount,
            vatAmount: expenseData.vatAmount,
            uploadedBy: userId,
            posted: false,
            currency: 'AED'
          });
          createdCount++;
        } catch (err) {
          console.error('Error creating expense:', err);
        }
      }
      
      // Log the sync
      await storage.createIntegrationSync({
        companyId,
        integrationType: 'google_sheets',
        syncType: 'import',
        dataType: 'expenses',
        status: 'completed',
        recordCount: createdCount,
        externalUrl: sheetUrl,
      });
      
      res.json({
        message: 'Expenses imported successfully',
        recordCount: createdCount,
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Custom export to Google Sheets (for filtered/custom data from frontend)
  // Customer-only: Custom export to Google Sheets
  app.post("/api/integrations/google-sheets/export/custom", authMiddleware, requireCustomerMiddleware, async (req: Request, res: Response) => {
    try {
      const { companyId, title, sheets } = req.body;
      if (!companyId || !title || !sheets) {
        return res.status(400).json({ message: 'Company ID, title, and sheets data required' });
      }
      
      const isConnected = await googleSheets.isGoogleSheetsConnected();
      if (!isConnected) {
        return res.status(400).json({ message: 'Google Sheets not connected' });
      }
      
      // Export custom data to sheet
      const result = await googleSheets.exportCustomDataToSheet(title, sheets);
      
      // Log the sync
      await storage.createIntegrationSync({
        companyId,
        integrationType: 'google_sheets',
        syncType: 'export',
        dataType: 'custom',
        status: 'completed',
        recordCount: sheets.reduce((total: number, sheet: any) => total + (sheet.rows?.length || 0), 0),
        externalId: result.spreadsheetId,
        externalUrl: result.url,
      });
      
      res.json({
        message: 'Data exported successfully',
        ...result,
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // ===========================
  // WhatsApp Integration Routes
  // ===========================

  // WhatsApp Webhook Verification (GET) - For Meta webhook setup
  app.get("/api/webhooks/whatsapp", async (req: Request, res: Response) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    // For initial setup, we accept any verification token
    // In production, this should validate against stored webhook_verify_token
    if (mode === 'subscribe') {
      console.log('WhatsApp webhook verified');
      return res.status(200).send(challenge);
    }

    res.status(403).json({ message: 'Forbidden' });
  });

  // WhatsApp Webhook (POST) - Receive messages
  app.post("/api/webhooks/whatsapp", async (req: Request, res: Response) => {
    try {
      const body = req.body;

      // Acknowledge receipt immediately (WhatsApp requires quick response)
      res.status(200).send('EVENT_RECEIVED');

      // Process messages asynchronously
      if (body.object === 'whatsapp_business_account') {
        for (const entry of body.entry || []) {
          for (const change of entry.changes || []) {
            if (change.field === 'messages') {
              const value = change.value;
              const messages = value.messages || [];
              
              for (const message of messages) {
                await processWhatsAppMessage(message, value.metadata);
              }
            }
          }
        }
      }
    } catch (error) {
      console.error('WhatsApp webhook error:', error);
      // Still return 200 to prevent retries
      res.status(200).send('ERROR_LOGGED');
    }
  });

  // Process incoming WhatsApp message
  async function processWhatsAppMessage(message: any, metadata: any) {
    try {
      const phoneNumberId = metadata?.phone_number_id;
      
      // Find company by phone number ID
      // For now, we'll use a simple approach - in production, map phone numbers to companies
      const messageData = {
        waMessageId: message.id,
        from: message.from,
        to: phoneNumberId,
        messageType: message.type,
        content: message.text?.body || null,
        mediaId: message.image?.id || message.document?.id || null,
        direction: 'inbound' as const,
        status: 'received' as const,
      };

      console.log('Received WhatsApp message:', messageData);
      
      // TODO: In full implementation:
      // 1. Look up company by phone number ID
      // 2. Download media if present
      // 3. Run OCR on images
      // 4. Use AI to categorize expenses
      // 5. Create receipt/expense entry

    } catch (error) {
      console.error('Error processing WhatsApp message:', error);
    }
  }

  // Get WhatsApp configuration
  app.get("/api/integrations/whatsapp/config", authMiddleware, async (req: Request, res: Response) => {
    try {
      const userId = (req as any).user?.id;
      if (!userId) {
        return res.status(401).json({ message: 'Unauthorized' });
      }

      const companies = await storage.getCompaniesByUserId(userId);
      if (companies.length === 0) {
        return res.status(404).json({ message: 'No company found' });
      }

      const companyId = companies[0].id;
      const config = await storage.getWhatsappConfig(companyId);

      if (!config) {
        return res.json({
          configured: false,
          isActive: false,
          companyId,
        });
      }

      // Don't expose sensitive tokens
      res.json({
        configured: true,
        isActive: config.isActive,
        phoneNumberId: config.phoneNumberId,
        businessAccountId: config.businessAccountId,
        hasAccessToken: !!config.accessToken,
        companyId,
        configId: config.id,
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Save WhatsApp configuration
  app.post("/api/integrations/whatsapp/config", authMiddleware, async (req: Request, res: Response) => {
    try {
      const userId = (req as any).user?.id;
      if (!userId) {
        return res.status(401).json({ message: 'Unauthorized' });
      }

      const { phoneNumberId, accessToken, webhookVerifyToken, businessAccountId } = req.body;
      
      const companies = await storage.getCompaniesByUserId(userId);
      if (companies.length === 0) {
        return res.status(404).json({ message: 'No company found' });
      }

      const companyId = companies[0].id;
      const existingConfig = await storage.getWhatsappConfig(companyId);

      if (existingConfig) {
        // Update existing config
        const updated = await storage.updateWhatsappConfig(existingConfig.id, {
          phoneNumberId,
          accessToken,
          webhookVerifyToken,
          businessAccountId,
          isActive: true,
        });
        res.json({ message: 'WhatsApp configuration updated', configId: updated.id });
      } else {
        // Create new config
        const config = await storage.createWhatsappConfig({
          companyId,
          phoneNumberId,
          accessToken,
          webhookVerifyToken,
          businessAccountId,
          isActive: true,
        });
        res.json({ message: 'WhatsApp configuration created', configId: config.id });
      }
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Toggle WhatsApp integration on/off
  app.patch("/api/integrations/whatsapp/toggle", authMiddleware, async (req: Request, res: Response) => {
    try {
      const userId = (req as any).user?.id;
      if (!userId) {
        return res.status(401).json({ message: 'Unauthorized' });
      }

      const companies = await storage.getCompaniesByUserId(userId);
      if (companies.length === 0) {
        return res.status(404).json({ message: 'No company found' });
      }

      const companyId = companies[0].id;
      const config = await storage.getWhatsappConfig(companyId);

      if (!config) {
        return res.status(404).json({ message: 'WhatsApp not configured' });
      }

      const updated = await storage.updateWhatsappConfig(config.id, {
        isActive: !config.isActive,
      });

      res.json({ 
        message: updated.isActive ? 'WhatsApp integration enabled' : 'WhatsApp integration disabled',
        isActive: updated.isActive 
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Get WhatsApp message history
  app.get("/api/integrations/whatsapp/messages", authMiddleware, async (req: Request, res: Response) => {
    try {
      const userId = (req as any).user?.id;
      if (!userId) {
        return res.status(401).json({ message: 'Unauthorized' });
      }

      const companies = await storage.getCompaniesByUserId(userId);
      if (companies.length === 0) {
        return res.status(404).json({ message: 'No company found' });
      }

      const companyId = companies[0].id;
      const messages = await storage.getWhatsappMessagesByCompanyId(companyId);

      res.json(messages);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Get WhatsApp integration status (for dashboard)
  app.get("/api/integrations/whatsapp/status", authMiddleware, async (req: Request, res: Response) => {
    try {
      const userId = (req as any).user?.id;
      if (!userId) {
        return res.status(401).json({ message: 'Unauthorized' });
      }

      const companies = await storage.getCompaniesByUserId(userId);
      if (companies.length === 0) {
        return res.json({ connected: false, configured: false });
      }

      const companyId = companies[0].id;
      const config = await storage.getWhatsappConfig(companyId);

      if (!config) {
        return res.json({ connected: false, configured: false });
      }

      res.json({
        connected: config.isActive,
        configured: true,
        phoneNumberId: config.phoneNumberId,
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // ===========================
  // OCR Processing Endpoint
  // ===========================

  // Process receipt image with OCR and AI categorization
  app.post("/api/ocr/process", authMiddleware, async (req: Request, res: Response) => {
    try {
      const userId = (req as any).user?.id;
      if (!userId) {
        return res.status(401).json({ message: 'Unauthorized' });
      }

      // Validate and get company for scoping
      const companies = await storage.getCompaniesByUserId(userId);
      if (companies.length === 0) {
        return res.status(404).json({ message: 'No company found' });
      }
      const companyId = companies[0].id;

      const { messageId, mediaId, content, imageData } = req.body;

      // Validate input
      const sanitizedContent = content ? String(content).slice(0, 10000) : '';
      const sanitizedMessageId = messageId ? String(messageId).slice(0, 100) : null;
      const sanitizedMediaId = mediaId ? String(mediaId).slice(0, 100) : null;

      // Default extraction results
      let rawText = sanitizedContent;
      let extractedData = {
        merchant: 'Unknown Merchant',
        date: new Date().toISOString().split('T')[0],
        amount: 0,
        vatAmount: 0,
        category: 'Office Supplies',
        confidence: 0.5,
        rawText: rawText,
        companyId: companyId,
        messageId: sanitizedMessageId,
      };

      // Valid expense categories for UAE businesses
      const validCategories = [
        'Office Supplies', 'Utilities', 'Travel', 'Meals', 
        'Rent', 'Marketing', 'Equipment', 'Professional Services',
        'Insurance', 'Maintenance', 'Communication', 'Other'
      ];

      // Try to use AI to extract structured data from text
      if (sanitizedContent) {
        try {
          const aiResponse = await openai.chat.completions.create({
            model: AI_MODEL,
            messages: [
              {
                role: "system",
                content: `You are a receipt data extraction assistant for UAE businesses. Extract the following information from receipt text:
                - merchant: The store/business name
                - date: The transaction date (YYYY-MM-DD format, use today if not found)
                - amount: The subtotal amount before VAT in AED (number only, exclude VAT)
                - vatAmount: The VAT amount in AED (number only, assume 5% of amount if not specified)
                - category: Categorize as one of: ${validCategories.join(', ')}
                
                Important: All amounts should be in AED. If the receipt shows a different currency, convert to AED.
                Respond in JSON format only with these exact field names.`
              },
              {
                role: "user",
                content: `Extract receipt data from this text:\n\n${sanitizedContent}`
              }
            ],
            response_format: { type: "json_object" },
            max_tokens: 500,
          });

          const aiResult = JSON.parse(aiResponse.choices[0]?.message?.content || '{}');
          
          // Validate and sanitize AI response
          const parsedAmount = parseFloat(aiResult.amount);
          const parsedVat = parseFloat(aiResult.vatAmount);
          const category = validCategories.includes(aiResult.category) ? aiResult.category : 'Other';
          
          // Validate date format
          let parsedDate = extractedData.date;
          if (aiResult.date && /^\d{4}-\d{2}-\d{2}$/.test(aiResult.date)) {
            parsedDate = aiResult.date;
          }

          extractedData = {
            merchant: aiResult.merchant ? String(aiResult.merchant).slice(0, 200) : extractedData.merchant,
            date: parsedDate,
            amount: !isNaN(parsedAmount) && parsedAmount >= 0 ? parsedAmount : 0,
            vatAmount: !isNaN(parsedVat) && parsedVat >= 0 ? parsedVat : 0,
            category: category,
            confidence: 0.9,
            rawText: sanitizedContent,
            companyId: companyId,
            messageId: sanitizedMessageId,
          };
        } catch (aiError: any) {
          console.log('AI extraction error:', aiError.message || 'Unknown error');
          // Return default data with lower confidence
          extractedData.confidence = 0.3;
        }
      }

      res.json(extractedData);
    } catch (error: any) {
      console.error('OCR processing error:', error);
      res.status(500).json({ message: error.message || 'Failed to process receipt' });
    }
  });

  // Test message for WhatsApp webhook (for development)
  app.post("/api/integrations/whatsapp/test-message", authMiddleware, async (req: Request, res: Response) => {
    try {
      const userId = (req as any).user?.id;
      if (!userId) {
        return res.status(401).json({ message: 'Unauthorized' });
      }

      const companies = await storage.getCompaniesByUserId(userId);
      if (companies.length === 0) {
        return res.status(404).json({ message: 'No company found' });
      }

      const companyId = companies[0].id;
      const { from, messageType, content, mediaId } = req.body;

      // Validate input
      const sanitizedFrom = from ? String(from).slice(0, 20).replace(/[^+\d]/g, '') : '+971501234567';
      const sanitizedMessageType = ['text', 'image', 'document'].includes(messageType) ? messageType : 'text';
      const sanitizedContent = content ? String(content).slice(0, 5000) : 'Test receipt message';
      const sanitizedMediaId = mediaId ? String(mediaId).slice(0, 100) : null;

      // Generate unique waMessageId with random suffix to prevent duplicates
      const waMessageId = `test_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

      // Create a test message with validated and sanitized data
      const message = await storage.createWhatsappMessage({
        companyId,
        waMessageId,
        from: sanitizedFrom,
        to: 'business_number',
        messageType: sanitizedMessageType,
        content: sanitizedContent,
        mediaId: sanitizedMediaId,
        direction: 'inbound',
        status: 'received',
      });

      res.json({ 
        message: 'Test message created',
        data: message 
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // =====================================
  // Advanced Analytics Routes
  // =====================================

  // Get cash flow forecasts
  app.get("/api/analytics/forecasts", authMiddleware, async (req: Request, res: Response) => {
    try {
      const userId = (req as any).user?.id;
      const { companyId, period } = req.query;
      
      if (!companyId) {
        return res.status(400).json({ message: 'Company ID required' });
      }
      
      // Verify user access to company
      const companyUsers = await storage.getCompanyUsersByCompanyId(companyId as string);
      if (!companyUsers.some(cu => cu.userId === userId)) {
        return res.status(403).json({ message: 'Access denied to this company' });
      }
      
      // Get forecasts from storage
      const forecasts = await storage.getCashFlowForecasts(companyId as string);
      res.json(forecasts);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Generate AI forecast
  app.post("/api/analytics/generate-forecast", authMiddleware, async (req: Request, res: Response) => {
    try {
      const userId = (req as any).user?.id;
      const { companyId, period } = req.body;
      
      if (!companyId) {
        return res.status(400).json({ message: 'Company ID required' });
      }
      
      // Verify access
      const companyUsers = await storage.getCompanyUsersByCompanyId(companyId);
      if (!companyUsers.some(cu => cu.userId === userId)) {
        return res.status(403).json({ message: 'Access denied' });
      }
      
      // Get historical data
      const invoices = await storage.getInvoicesByCompanyId(companyId);
      const receipts = await storage.getReceiptsByCompanyId(companyId);
      const journalEntries = await storage.getJournalEntriesByCompanyId(companyId);
      
      // Calculate monthly trends
      const monthlyData: { [key: string]: { inflow: number; outflow: number } } = {};
      
      invoices.forEach(inv => {
        const month = new Date(inv.date).toISOString().slice(0, 7);
        if (!monthlyData[month]) monthlyData[month] = { inflow: 0, outflow: 0 };
        monthlyData[month].inflow += inv.total || 0;
      });
      
      receipts.forEach(rec => {
        if (rec.date) {
          const month = rec.date.slice(0, 7);
          if (!monthlyData[month]) monthlyData[month] = { inflow: 0, outflow: 0 };
          monthlyData[month].outflow += (rec.amount || 0) + (rec.vatAmount || 0);
        }
      });
      
      // Generate simple forecast based on averages
      const months = Object.keys(monthlyData).sort();
      const avgInflow = months.length > 0 
        ? months.reduce((sum, m) => sum + monthlyData[m].inflow, 0) / months.length 
        : 0;
      const avgOutflow = months.length > 0 
        ? months.reduce((sum, m) => sum + monthlyData[m].outflow, 0) / months.length 
        : 0;
      
      // Create forecast for next 3 months
      const periodMonths = period === '3months' ? 3 : period === '6months' ? 6 : 12;
      const forecasts = [];
      let runningBalance = avgInflow - avgOutflow;
      
      for (let i = 1; i <= periodMonths; i++) {
        const forecastDate = new Date();
        forecastDate.setMonth(forecastDate.getMonth() + i);
        
        const forecast = await storage.createCashFlowForecast({
          companyId,
          forecastDate,
          forecastType: 'monthly',
          predictedInflow: avgInflow * (1 + Math.random() * 0.1 - 0.05), // +/- 5% variation
          predictedOutflow: avgOutflow * (1 + Math.random() * 0.1 - 0.05),
          predictedBalance: runningBalance,
          confidenceLevel: 0.85 - (i * 0.02), // Confidence decreases over time
        });
        
        forecasts.push(forecast);
        runningBalance += avgInflow - avgOutflow;
      }
      
      res.json({ message: 'Forecasts generated', count: forecasts.length });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Get budget vs actual
  app.get("/api/analytics/budget-vs-actual", authMiddleware, async (req: Request, res: Response) => {
    try {
      const userId = (req as any).user?.id;
      const { companyId, year, month } = req.query;
      
      if (!companyId) {
        return res.status(400).json({ message: 'Company ID required' });
      }
      
      // Verify access
      const companyUsers = await storage.getCompanyUsersByCompanyId(companyId as string);
      if (!companyUsers.some(cu => cu.userId === userId)) {
        return res.status(403).json({ message: 'Access denied' });
      }
      
      // Get budgets and actuals
      const budgets = await storage.getBudgetsByCompanyId(companyId as string, 
        parseInt(year as string) || new Date().getFullYear(),
        parseInt(month as string) || new Date().getMonth() + 1
      );
      
      const accounts = await storage.getAccountsByCompanyId(companyId as string);
      const journalLines = await storage.getJournalLinesByCompanyId(companyId as string);
      
      // Calculate actual amounts per account
      const actualsByAccount: { [key: string]: number } = {};
      journalLines.forEach(line => {
        if (!actualsByAccount[line.accountId]) actualsByAccount[line.accountId] = 0;
        actualsByAccount[line.accountId] += (line.debit || 0) - (line.credit || 0);
      });
      
      // Combine budget and actual data
      const result = accounts.map(account => {
        const budget = budgets.find(b => b.accountId === account.id);
        const actual = actualsByAccount[account.id] || 0;
        const budgeted = budget?.budgetAmount || 0;
        
        return {
          accountId: account.id,
          accountName: account.nameEn,
          accountType: account.type,
          budgeted,
          actual: Math.abs(actual),
          variance: Math.abs(actual) - budgeted,
          variancePercent: budgeted > 0 ? ((Math.abs(actual) - budgeted) / budgeted) * 100 : 0,
        };
      }).filter(a => a.budgeted > 0 || a.actual > 0);
      
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Get KPIs
  app.get("/api/analytics/kpis", authMiddleware, async (req: Request, res: Response) => {
    try {
      const userId = (req as any).user?.id;
      const { companyId } = req.query;
      
      if (!companyId) {
        return res.status(400).json({ message: 'Company ID required' });
      }
      
      // Get stored KPIs
      const kpis = await storage.getFinancialKpis(companyId as string);
      res.json(kpis);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Get AI insights
  app.get("/api/analytics/insights", authMiddleware, async (req: Request, res: Response) => {
    try {
      const userId = (req as any).user?.id;
      const { companyId } = req.query;
      
      if (!companyId) {
        return res.status(400).json({ message: 'Company ID required' });
      }
      
      // Generate dynamic insights based on data
      const invoices = await storage.getInvoicesByCompanyId(companyId as string);
      const receipts = await storage.getReceiptsByCompanyId(companyId as string);
      
      const totalRevenue = invoices.reduce((sum, inv) => sum + (inv.total || 0), 0);
      const totalExpenses = receipts.reduce((sum, rec) => sum + ((rec.amount || 0) + (rec.vatAmount || 0)), 0);
      const outstanding = invoices.filter(inv => inv.status !== 'paid').reduce((sum, inv) => sum + (inv.total || 0), 0);
      
      const insights = [];
      
      // Profit margin insight
      if (totalRevenue > 0) {
        const margin = ((totalRevenue - totalExpenses) / totalRevenue) * 100;
        if (margin > 20) {
          insights.push({
            id: '1',
            type: 'trend',
            title: 'Strong Profit Margin',
            description: `Your profit margin of ${margin.toFixed(1)}% is above industry average.`,
            impact: 'Healthy financial position',
            priority: 'low',
            actionable: false,
          });
        } else if (margin < 10) {
          insights.push({
            id: '2',
            type: 'warning',
            title: 'Low Profit Margin Alert',
            description: `Your profit margin of ${margin.toFixed(1)}% is below recommended levels.`,
            impact: 'May need cost optimization',
            priority: 'high',
            actionable: true,
            action: 'Review expenses',
          });
        }
      }
      
      // Outstanding invoices insight
      if (outstanding > 0) {
        insights.push({
          id: '3',
          type: 'opportunity',
          title: 'Outstanding Collections',
          description: `You have AED ${outstanding.toFixed(2)} in unpaid invoices.`,
          impact: `Potential AED ${outstanding.toFixed(2)} recovery`,
          priority: outstanding > 50000 ? 'high' : 'medium',
          actionable: true,
          action: 'Send reminders',
        });
      }
      
      res.json(insights);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // =====================================
  // E-Commerce Integration Routes
  // =====================================

  // Get e-commerce integrations
  app.get("/api/integrations/ecommerce", authMiddleware, async (req: Request, res: Response) => {
    try {
      const userId = (req as any).user?.id;
      const { companyId } = req.query;
      
      if (!companyId) {
        return res.status(400).json({ message: 'Company ID required' });
      }
      
      const integrations = await storage.getEcommerceIntegrations(companyId as string);
      res.json(integrations || []);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Get e-commerce transactions (MUST be before :integrationId route)
  app.get("/api/integrations/ecommerce/transactions", authMiddleware, async (req: Request, res: Response) => {
    try {
      const { companyId } = req.query;
      
      if (!companyId) {
        return res.status(400).json({ message: 'Company ID required' });
      }
      
      const transactions = await storage.getEcommerceTransactions(companyId as string);
      res.json(transactions || []);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Connect e-commerce integration
  app.post("/api/integrations/ecommerce/connect", authMiddleware, async (req: Request, res: Response) => {
    try {
      const userId = (req as any).user?.id;
      const { companyId, platform, apiKey, shopDomain, accessToken } = req.body;
      
      if (!companyId || !platform) {
        return res.status(400).json({ message: 'Company ID and platform required' });
      }
      
      // Verify access
      const companyUsers = await storage.getCompanyUsersByCompanyId(companyId);
      if (!companyUsers.some(cu => cu.userId === userId)) {
        return res.status(403).json({ message: 'Access denied' });
      }
      
      const integration = await storage.createEcommerceIntegration({
        companyId,
        platform,
        isActive: true,
        apiKey: apiKey || null,
        shopDomain: shopDomain || null,
        accessToken: accessToken || null,
        syncStatus: 'never',
      });
      
      res.json(integration);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Sync e-commerce integration
  app.post("/api/integrations/ecommerce/:integrationId/sync", authMiddleware, async (req: Request, res: Response) => {
    try {
      const { integrationId } = req.params;
      const userId = (req as any).user?.id;
      
      // Verify integration exists and user has access
      const integration = await storage.getEcommerceIntegration(integrationId);
      if (!integration) {
        return res.status(404).json({ message: 'Integration not found' });
      }
      
      // Update sync status
      await storage.updateEcommerceIntegration(integrationId, {
        syncStatus: 'syncing',
        lastSyncAt: new Date(),
      });
      
      // In a real implementation, this would fetch data from the platform
      // For now, we'll simulate a successful sync
      setTimeout(async () => {
        await storage.updateEcommerceIntegration(integrationId, {
          syncStatus: 'success',
        });
      }, 2000);
      
      res.json({ message: 'Sync started' });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Toggle e-commerce integration
  app.patch("/api/integrations/ecommerce/:integrationId/toggle", authMiddleware, async (req: Request, res: Response) => {
    try {
      const { integrationId } = req.params;
      const { isActive } = req.body;
      
      const integration = await storage.getEcommerceIntegration(integrationId);
      if (!integration) {
        return res.status(404).json({ message: 'Integration not found' });
      }
      
      await storage.updateEcommerceIntegration(integrationId, { isActive });
      res.json({ message: 'Integration updated' });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // =====================================
  // NOTIFICATIONS & SMART REMINDERS
  // =====================================

  // Get user notifications
  app.get("/api/notifications", authMiddleware, async (req: Request, res: Response) => {
    try {
      const userId = (req as any).user?.id;
      const notifications = await storage.getNotificationsByUserId(userId);
      const unreadCount = await storage.getUnreadNotificationCount(userId);
      res.json({ notifications, unreadCount });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Mark notification as read
  app.patch("/api/notifications/:id/read", authMiddleware, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const notification = await storage.markNotificationAsRead(id);
      res.json(notification);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Mark all notifications as read
  app.post("/api/notifications/read-all", authMiddleware, async (req: Request, res: Response) => {
    try {
      const userId = (req as any).user?.id;
      await storage.markAllNotificationsAsRead(userId);
      res.json({ message: 'All notifications marked as read' });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Dismiss notification
  app.patch("/api/notifications/:id/dismiss", authMiddleware, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const notification = await storage.dismissNotification(id);
      res.json(notification);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Create notification (for current user only - system notifications should be created server-side)
  app.post("/api/notifications", authMiddleware, async (req: Request, res: Response) => {
    try {
      const userId = (req as any).user?.id;
      
      // Validate input with comprehensive schema
      const validationSchema = z.object({
        companyId: z.string().uuid().optional(),
        type: z.enum(['deadline', 'payment_due', 'overdue', 'regulatory', 'referral', 'system']),
        title: z.string().min(1).max(200),
        message: z.string().min(1).max(2000),
        priority: z.enum(['low', 'normal', 'high', 'urgent']).default('normal'),
        actionUrl: z.string().url().optional().nullable(),
        relatedEntityType: z.string().max(50).optional().nullable(),
        relatedEntityId: z.string().uuid().optional().nullable(),
      });
      
      const validated = validationSchema.parse(req.body);
      
      // Verify user has access to the company if specified
      if (validated.companyId) {
        const hasAccess = await storage.hasCompanyAccess(userId, validated.companyId);
        if (!hasAccess) {
          return res.status(403).json({ message: 'Access denied to this company' });
        }
      }
      
      // Users can only create notifications for themselves
      const notification = await storage.createNotification({
        ...validated,
        userId,
        isRead: false,
        isDismissed: false,
      });
      res.json(notification);
    } catch (error: any) {
      if (error.name === 'ZodError') {
        return res.status(400).json({ 
          message: 'Invalid request data', 
          errors: error.errors.map((e: any) => ({ field: e.path.join('.'), message: e.message }))
        });
      }
      res.status(500).json({ message: error.message });
    }
  });

  // =====================================
  // REGULATORY NEWS FEED
  // =====================================

  // Get regulatory news
  app.get("/api/regulatory-news", authMiddleware, async (req: Request, res: Response) => {
    try {
      const news = await storage.getRegulatoryNews();
      res.json(news);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Create regulatory news (admin only - this endpoint is for internal use only)
  // In production, this would be restricted to admin users via role check
  app.post("/api/regulatory-news", authMiddleware, async (req: Request, res: Response) => {
    try {
      const userId = (req as any).user?.id;
      
      // Check if user is an owner/admin of any company (simple authorization)
      const companyUsers = await storage.getCompanyUsersByUserId(userId);
      const isAdmin = companyUsers.some(cu => cu.role === 'owner' || cu.role === 'cfo');
      
      if (!isAdmin) {
        return res.status(403).json({ message: 'Admin access required to create regulatory news' });
      }
      
      // Validate input
      const validationSchema = insertRegulatoryNewsSchema.pick({
        category: true,
        title: true,
        summary: true,
        content: true,
        source: true,
        sourceUrl: true,
        effectiveDate: true,
        importance: true,
      });
      
      const validated = validationSchema.parse(req.body);
      
      const news = await storage.createRegulatoryNews({
        ...validated,
        publishedAt: new Date(),
        isActive: true,
      });
      res.json(news);
    } catch (error: any) {
      if (error.name === 'ZodError') {
        return res.status(400).json({ message: 'Invalid request data', errors: error.errors });
      }
      res.status(500).json({ message: error.message });
    }
  });

  // =====================================
  // REMINDER SETTINGS (Late Payment Reminders)
  // =====================================

  // Get reminder settings
  app.get("/api/companies/:companyId/reminder-settings", authMiddleware, async (req: Request, res: Response) => {
    try {
      const { companyId } = req.params;
      const userId = (req as any).user?.id;
      
      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: 'Access denied' });
      }
      
      const settings = await storage.getReminderSettingsByCompanyId(companyId);
      res.json(settings);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Create reminder setting
  app.post("/api/companies/:companyId/reminder-settings", authMiddleware, async (req: Request, res: Response) => {
    try {
      const { companyId } = req.params;
      const userId = (req as any).user?.id;
      
      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: 'Access denied' });
      }
      
      // Validate input
      const validationSchema = z.object({
        reminderType: z.enum(['invoice_overdue', 'invoice_due_soon', 'vat_deadline', 'payment_followup']),
        isEnabled: z.boolean().default(true),
        daysBeforeDue: z.number().min(0).max(90).optional(),
        daysAfterDue: z.number().min(0).max(365).optional(),
        repeatIntervalDays: z.number().min(1).max(30).optional(),
        maxReminders: z.number().min(1).max(10).optional(),
        sendEmail: z.boolean().optional(),
        sendSms: z.boolean().optional(),
        sendInApp: z.boolean().optional(),
        emailSubject: z.string().max(200).optional(),
        emailTemplate: z.string().max(5000).optional(),
      });
      
      const validated = validationSchema.parse(req.body);
      
      const setting = await storage.createReminderSetting({
        ...validated,
        companyId,
      });
      res.json(setting);
    } catch (error: any) {
      if (error.name === 'ZodError') {
        return res.status(400).json({ message: 'Invalid request data', errors: error.errors });
      }
      res.status(500).json({ message: error.message });
    }
  });

  // Update reminder setting
  app.patch("/api/reminder-settings/:id", authMiddleware, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const setting = await storage.updateReminderSetting(id, req.body);
      res.json(setting);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Get reminder logs
  app.get("/api/companies/:companyId/reminder-logs", authMiddleware, async (req: Request, res: Response) => {
    try {
      const { companyId } = req.params;
      const userId = (req as any).user?.id;
      
      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: 'Access denied' });
      }
      
      const logs = await storage.getReminderLogsByCompanyId(companyId);
      res.json(logs);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Send manual reminder
  app.post("/api/invoices/:invoiceId/send-reminder", authMiddleware, async (req: Request, res: Response) => {
    try {
      const { invoiceId } = req.params;
      const userId = (req as any).user?.id;
      
      const invoice = await storage.getInvoice(invoiceId);
      if (!invoice) {
        return res.status(404).json({ message: 'Invoice not found' });
      }
      
      const hasAccess = await storage.hasCompanyAccess(userId, invoice.companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: 'Access denied' });
      }

      // Create in-app notification for the reminder
      await storage.createNotification({
        userId,
        companyId: invoice.companyId,
        type: 'payment_due',
        title: 'Payment Reminder Sent',
        message: `Reminder sent for invoice ${invoice.number} to ${invoice.customerName}`,
        priority: 'normal',
        relatedEntityType: 'invoice',
        relatedEntityId: invoiceId,
        actionUrl: `/invoices/${invoiceId}`,
      });

      // Log the reminder
      const log = await storage.createReminderLog({
        companyId: invoice.companyId,
        reminderType: 'invoice_overdue',
        relatedEntityType: 'invoice',
        relatedEntityId: invoiceId,
        channel: 'in_app',
        status: 'sent',
        attemptNumber: 1,
        sentAt: new Date(),
      });
      
      res.json({ message: 'Reminder sent successfully', log });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // =====================================
  // USER ONBOARDING
  // =====================================

  // Get user onboarding progress
  app.get("/api/onboarding", authMiddleware, async (req: Request, res: Response) => {
    try {
      const userId = (req as any).user?.id;
      let onboarding = await storage.getUserOnboarding(userId);
      
      // Create default onboarding if not exists
      if (!onboarding) {
        onboarding = await storage.createUserOnboarding({
          userId,
          hasCompletedWelcome: false,
          hasCreatedCompany: false,
          hasSetupChartOfAccounts: false,
          hasCreatedFirstInvoice: false,
          hasUploadedFirstReceipt: false,
          hasViewedReports: false,
          hasExploredAI: false,
          hasConfiguredReminders: false,
          currentStep: 0,
          totalSteps: 8,
          isOnboardingComplete: false,
          showTips: true,
          showTour: true,
        });
      }
      
      res.json(onboarding);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Update onboarding progress
  app.patch("/api/onboarding", authMiddleware, async (req: Request, res: Response) => {
    try {
      const userId = (req as any).user?.id;
      
      // Calculate current step based on completed steps
      const data = req.body;
      let currentStep = 0;
      if (data.hasCompletedWelcome) currentStep = 1;
      if (data.hasCreatedCompany) currentStep = 2;
      if (data.hasSetupChartOfAccounts) currentStep = 3;
      if (data.hasCreatedFirstInvoice) currentStep = 4;
      if (data.hasUploadedFirstReceipt) currentStep = 5;
      if (data.hasViewedReports) currentStep = 6;
      if (data.hasExploredAI) currentStep = 7;
      if (data.hasConfiguredReminders) currentStep = 8;
      
      const isComplete = currentStep >= 8;
      
      const onboarding = await storage.updateUserOnboarding(userId, {
        ...data,
        currentStep,
        isOnboardingComplete: isComplete,
        completedAt: isComplete ? new Date() : undefined,
      });
      
      res.json(onboarding);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Complete onboarding step
  app.post("/api/onboarding/complete-step", authMiddleware, async (req: Request, res: Response) => {
    try {
      const userId = (req as any).user?.id;
      
      // Validate input with comprehensive schema
      const validationSchema = z.object({
        step: z.enum(['welcome', 'company', 'accounts', 'invoice', 'receipt', 'reports', 'ai', 'reminders']),
      });
      
      const validated = validationSchema.parse(req.body);
      const { step } = validated;
      
      const stepMap: Record<string, string> = {
        welcome: 'hasCompletedWelcome',
        company: 'hasCreatedCompany',
        accounts: 'hasSetupChartOfAccounts',
        invoice: 'hasCreatedFirstInvoice',
        receipt: 'hasUploadedFirstReceipt',
        reports: 'hasViewedReports',
        ai: 'hasExploredAI',
        reminders: 'hasConfiguredReminders',
      };
      
      const field = stepMap[step];
      if (!field) {
        return res.status(400).json({ message: 'Invalid step', errors: [{ field: 'step', message: 'Step must be one of: welcome, company, accounts, invoice, receipt, reports, ai, reminders' }] });
      }
      
      const onboarding = await storage.updateUserOnboarding(userId, {
        [field]: true,
      });
      
      res.json(onboarding);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Dismiss tip
  app.post("/api/onboarding/dismiss-tip", authMiddleware, async (req: Request, res: Response) => {
    try {
      const userId = (req as any).user?.id;
      
      // Validate input
      const validationSchema = z.object({
        tipId: z.string().min(1, 'Tip ID is required'),
      });
      
      const validated = validationSchema.parse(req.body);
      const { tipId } = validated;
      
      const onboarding = await storage.getUserOnboarding(userId);
      const dismissedTips = onboarding?.dismissedTips ? JSON.parse(onboarding.dismissedTips) : [];
      
      if (!dismissedTips.includes(tipId)) {
        dismissedTips.push(tipId);
      }
      
      const updated = await storage.updateUserOnboarding(userId, {
        dismissedTips: JSON.stringify(dismissedTips),
      });
      
      res.json(updated);
    } catch (error: any) {
      if (error.name === 'ZodError') {
        return res.status(400).json({ message: 'Invalid request data', errors: error.errors });
      }
      res.status(500).json({ message: error.message });
    }
  });

  // Get help tips for page
  app.get("/api/help-tips", authMiddleware, async (req: Request, res: Response) => {
    try {
      const { page } = req.query;
      const userId = (req as any).user?.id;
      
      const onboarding = await storage.getUserOnboarding(userId);
      const dismissedTips = onboarding?.dismissedTips ? JSON.parse(onboarding.dismissedTips) : [];
      
      let tips;
      if (page) {
        tips = await storage.getHelpTipsByPage(page as string);
      } else {
        tips = await storage.getAllHelpTips();
      }
      
      // Filter out dismissed tips
      tips = tips.filter(tip => !dismissedTips.includes(tip.tipKey));
      
      res.json({ tips, showTips: onboarding?.showTips ?? true });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // =====================================
  // REFERRAL SYSTEM
  // =====================================

  // Get user's referral code
  app.get("/api/referral/my-code", authMiddleware, async (req: Request, res: Response) => {
    try {
      const userId = (req as any).user?.id;
      let referralCode = await storage.getReferralCodeByUserId(userId);
      
      // Auto-generate referral code if not exists
      if (!referralCode) {
        const code = `REF-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
        referralCode = await storage.createReferralCode({
          userId,
          code,
          isActive: true,
          referrerRewardType: 'credit',
          referrerRewardValue: 50, // AED 50 credit
          refereeRewardType: 'discount',
          refereeRewardValue: 20, // 20% discount
          totalReferrals: 0,
          successfulReferrals: 0,
          totalRewardsEarned: 0,
        });
      }
      
      res.json(referralCode);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Get referral stats
  app.get("/api/referral/stats", authMiddleware, async (req: Request, res: Response) => {
    try {
      const userId = (req as any).user?.id;
      const referralCode = await storage.getReferralCodeByUserId(userId);
      const referrals = await storage.getReferralsByReferrerId(userId);
      
      const stats = {
        code: referralCode?.code || null,
        totalReferrals: referralCode?.totalReferrals || 0,
        successfulReferrals: referralCode?.successfulReferrals || 0,
        pendingReferrals: referrals.filter(r => r.status === 'pending' || r.status === 'signed_up').length,
        totalRewardsEarned: referralCode?.totalRewardsEarned || 0,
        recentReferrals: referrals.slice(0, 10),
      };
      
      res.json(stats);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Validate referral code (for signup)
  app.get("/api/referral/validate/:code", async (req: Request, res: Response) => {
    try {
      const { code } = req.params;
      const referralCode = await storage.getReferralCodeByCode(code);
      
      if (!referralCode || !referralCode.isActive) {
        return res.status(404).json({ valid: false, message: 'Invalid or expired referral code' });
      }
      
      if (referralCode.expiresAt && new Date(referralCode.expiresAt) < new Date()) {
        return res.status(400).json({ valid: false, message: 'Referral code has expired' });
      }
      
      res.json({
        valid: true,
        discount: referralCode.refereeRewardValue,
        discountType: referralCode.refereeRewardType,
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Track referral signup
  app.post("/api/referral/track-signup", async (req: Request, res: Response) => {
    try {
      // Validate input
      const validationSchema = z.object({
        code: z.string().min(1, 'Referral code is required'),
        refereeEmail: z.string().email('Invalid email address'),
        source: z.string().optional(),
      });
      
      const validated = validationSchema.parse(req.body);
      const { code, refereeEmail, source } = validated;
      
      const referralCode = await storage.getReferralCodeByCode(code);
      if (!referralCode || !referralCode.isActive) {
        return res.status(400).json({ message: 'Invalid referral code' });
      }
      
      // Create referral record
      const referral = await storage.createReferral({
        referralCodeId: referralCode.id,
        referrerId: referralCode.userId,
        refereeEmail,
        status: 'pending',
        signupSource: source || 'link',
        referrerRewardStatus: 'pending',
        refereeRewardStatus: 'pending',
        referrerRewardAmount: referralCode.referrerRewardValue,
        refereeRewardAmount: referralCode.refereeRewardValue,
      });
      
      // Update referral code stats
      await storage.updateReferralCode(referralCode.id, {
        totalReferrals: (referralCode.totalReferrals || 0) + 1,
      });
      
      // Notify referrer
      await storage.createNotification({
        userId: referralCode.userId,
        type: 'referral',
        title: 'New Referral Signup!',
        message: `Someone signed up using your referral code. They'll need to complete a qualifying action for you to earn your reward.`,
        priority: 'normal',
        actionUrl: '/referrals',
      });
      
      res.json(referral);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // =====================================
  // USER FEEDBACK
  // =====================================

  // Submit feedback
  app.post("/api/feedback", authMiddleware, async (req: Request, res: Response) => {
    try {
      const userId = (req as any).user?.id;
      
      // Validate input with comprehensive schema
      const validationSchema = z.object({
        feedbackType: z.enum(['bug', 'feature_request', 'improvement', 'praise', 'other']),
        category: z.string().max(50).optional().nullable(),
        pageContext: z.string().max(500).optional().nullable(),
        rating: z.number().int().min(1).max(5).optional().nullable(),
        title: z.string().max(200).optional().nullable(),
        message: z.string().min(10, 'Message must be at least 10 characters').max(5000),
        allowContact: z.boolean().default(true),
        contactEmail: z.string().email('Invalid email format').optional().nullable(),
      });
      
      const validated = validationSchema.parse(req.body);
      
      const feedback = await storage.createUserFeedback({
        userId,
        feedbackType: validated.feedbackType,
        category: validated.category,
        pageContext: validated.pageContext,
        rating: validated.rating,
        title: validated.title,
        message: validated.message,
        status: 'new',
        allowContact: validated.allowContact,
        contactEmail: validated.contactEmail,
      });
      
      res.json(feedback);
    } catch (error: any) {
      if (error.name === 'ZodError') {
        return res.status(400).json({ 
          message: 'Invalid request data', 
          errors: error.errors.map((e: any) => ({ field: e.path.join('.'), message: e.message }))
        });
      }
      res.status(500).json({ message: error.message });
    }
  });

  // Get user's feedback
  app.get("/api/feedback", authMiddleware, async (req: Request, res: Response) => {
    try {
      const userId = (req as any).user?.id;
      const feedback = await storage.getUserFeedback(userId);
      res.json(feedback);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // =====================================
  // ANALYTICS
  // =====================================

  // Track analytics event
  app.post("/api/analytics/event", authMiddleware, async (req: Request, res: Response) => {
    try {
      const userId = (req as any).user?.id;
      
      // Validate input with comprehensive schema
      const validationSchema = z.object({
        eventType: z.enum(['page_view', 'feature_use', 'error', 'conversion', 'custom']),
        eventName: z.string().min(1).max(100),
        pageUrl: z.string().max(2000).optional().nullable(),
        pageTitle: z.string().max(500).optional().nullable(),
        properties: z.record(z.unknown()).optional().nullable(),
        value: z.number().optional().nullable(),
        deviceType: z.string().max(50).optional().nullable(),
        browser: z.string().max(100).optional().nullable(),
        language: z.string().max(10).optional().nullable(),
      });
      
      const validated = validationSchema.parse(req.body);
      
      const event = await storage.createAnalyticsEvent({
        userId,
        eventType: validated.eventType,
        eventName: validated.eventName,
        pageUrl: validated.pageUrl,
        pageTitle: validated.pageTitle,
        properties: validated.properties ? JSON.stringify(validated.properties) : null,
        value: validated.value,
        deviceType: validated.deviceType,
        browser: validated.browser,
        language: validated.language,
      });
      
      res.json(event);
    } catch (error: any) {
      if (error.name === 'ZodError') {
        return res.status(400).json({ 
          message: 'Invalid request data', 
          errors: error.errors.map((e: any) => ({ field: e.path.join('.'), message: e.message }))
        });
      }
      res.status(500).json({ message: error.message });
    }
  });

  // Get analytics dashboard data
  app.get("/api/analytics/dashboard", authMiddleware, async (req: Request, res: Response) => {
    try {
      const { startDate, endDate } = req.query;
      
      // Get all events (in production, filter by date range)
      const events = await storage.getAnalyticsEvents();
      const metrics = await storage.getFeatureUsageMetrics();
      
      // Aggregate data for dashboard
      const pageViews = events.filter(e => e.eventType === 'page_view').length;
      const featureUses = events.filter(e => e.eventType === 'feature_use').length;
      const errors = events.filter(e => e.eventType === 'error').length;
      
      // Group by event name
      const eventsByName: Record<string, number> = {};
      events.forEach(e => {
        eventsByName[e.eventName] = (eventsByName[e.eventName] || 0) + 1;
      });
      
      // Group by page
      const pagesByUrl: Record<string, number> = {};
      events.filter(e => e.eventType === 'page_view').forEach(e => {
        if (e.pageUrl) {
          pagesByUrl[e.pageUrl] = (pagesByUrl[e.pageUrl] || 0) + 1;
        }
      });
      
      res.json({
        summary: {
          totalPageViews: pageViews,
          totalFeatureUses: featureUses,
          totalErrors: errors,
          totalEvents: events.length,
        },
        eventsByName,
        pagesByUrl,
        recentEvents: events.slice(0, 50),
        featureMetrics: metrics,
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Get feature usage report
  app.get("/api/analytics/feature-usage", authMiddleware, async (req: Request, res: Response) => {
    try {
      const { feature } = req.query;
      const metrics = await storage.getFeatureUsageMetrics(feature as string | undefined);
      res.json(metrics);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // =====================================
  // UPCOMING DEADLINES (Smart Reminders)
  // =====================================

  // Get upcoming deadlines
  app.get("/api/deadlines", authMiddleware, async (req: Request, res: Response) => {
    try {
      const userId = (req as any).user?.id;
      const { companyId } = req.query;
      
      if (!companyId) {
        return res.status(400).json({ message: 'Company ID required' });
      }
      
      const hasAccess = await storage.hasCompanyAccess(userId, companyId as string);
      if (!hasAccess) {
        return res.status(403).json({ message: 'Access denied' });
      }
      
      const company = await storage.getCompany(companyId as string);
      const invoices = await storage.getInvoicesByCompanyId(companyId as string);
      
      const deadlines: any[] = [];
      const today = new Date();
      
      // VAT Return deadlines (based on filing frequency)
      if (company?.trnVatNumber) {
        const filingFrequency = company.vatFilingFrequency || 'Quarterly';
        let nextDeadline = new Date();
        
        if (filingFrequency === 'Monthly') {
          nextDeadline.setMonth(nextDeadline.getMonth() + 1);
          nextDeadline.setDate(28); // Due by 28th of next month
        } else if (filingFrequency === 'Quarterly') {
          const currentQuarter = Math.floor(today.getMonth() / 3);
          nextDeadline.setMonth((currentQuarter + 1) * 3 + 1); // Month after quarter end
          nextDeadline.setDate(28);
        }
        
        deadlines.push({
          id: 'vat-return',
          type: 'vat_return',
          title: 'VAT Return Due',
          description: `Submit VAT return for ${filingFrequency.toLowerCase()} period`,
          dueDate: nextDeadline.toISOString(),
          daysRemaining: Math.ceil((nextDeadline.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)),
          priority: Math.ceil((nextDeadline.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)) <= 7 ? 'high' : 'normal',
          actionUrl: '/reports',
        });
      }
      
      // Unpaid invoice deadlines
      const unpaidInvoices = invoices.filter(inv => inv.status === 'sent');
      unpaidInvoices.forEach(inv => {
        const invoiceDate = new Date(inv.date);
        const dueDate = new Date(invoiceDate);
        dueDate.setDate(dueDate.getDate() + 30); // Assume 30-day payment terms
        
        const daysRemaining = Math.ceil((dueDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
        const isOverdue = daysRemaining < 0;
        
        deadlines.push({
          id: `invoice-${inv.id}`,
          type: isOverdue ? 'invoice_overdue' : 'invoice_due',
          title: isOverdue ? `Invoice ${inv.number} Overdue` : `Invoice ${inv.number} Due Soon`,
          description: `${inv.customerName} - AED ${inv.total.toFixed(2)}`,
          dueDate: dueDate.toISOString(),
          daysRemaining,
          priority: isOverdue ? 'urgent' : (daysRemaining <= 7 ? 'high' : 'normal'),
          actionUrl: `/invoices/${inv.id}`,
          relatedEntityType: 'invoice',
          relatedEntityId: inv.id,
        });
      });
      
      // Sort by priority and due date
      deadlines.sort((a, b) => {
        const priorityOrder = { urgent: 0, high: 1, normal: 2, low: 3 };
        const priorityDiff = priorityOrder[a.priority as keyof typeof priorityOrder] - priorityOrder[b.priority as keyof typeof priorityOrder];
        if (priorityDiff !== 0) return priorityDiff;
        return a.daysRemaining - b.daysRemaining;
      });
      
      res.json(deadlines);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // =====================================
  // BANK TRANSACTIONS / RECONCILIATION (Additional Routes)
  // =====================================

  // Auto-reconcile bank transactions
  app.post("/api/companies/:companyId/bank-transactions/auto-reconcile", authMiddleware, async (req: Request, res: Response) => {
    try {
      const userId = (req as any).user?.id;
      const { companyId } = req.params;
      
      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: 'Access denied' });
      }
      
      const unreconciledTxns = await storage.getUnreconciledBankTransactions(companyId);
      const journalEntries = await storage.getJournalEntriesByCompanyId(companyId);
      const receipts = await storage.getReceiptsByCompanyId(companyId);
      const invoices = await storage.getInvoicesByCompanyId(companyId);
      
      let matchedCount = 0;
      
      for (const txn of unreconciledTxns) {
        // Skip transactions without valid descriptions
        const txnDesc = txn.description?.toLowerCase() || '';
        if (!txnDesc) continue;
        
        // Try to find matching journal entries
        for (const je of journalEntries) {
          const jeDesc = je.description?.toLowerCase() || '';
          const txnSearchTerm = txnDesc.substring(0, 20);
          
          // Check for description match or date proximity
          const descMatch = jeDesc && txnSearchTerm && jeDesc.includes(txnSearchTerm);
          const jeDate = je.date ? new Date(je.date).getTime() : 0;
          const txnDate = txn.transactionDate ? new Date(txn.transactionDate).getTime() : 0;
          const dateProximity = jeDate && txnDate && Math.abs(jeDate - txnDate) < 86400000 * 3;
          
          if (descMatch || dateProximity) {
            // Potential match - check amounts through journal lines
            const lines = await storage.getJournalLinesByEntryId(je.id);
            const totalAmount = lines.reduce((sum, l) => sum + (l.debit || 0), 0);
            if (Math.abs(totalAmount - Math.abs(txn.amount || 0)) < 0.01) {
              await storage.reconcileBankTransaction(txn.id, je.id, 'journal');
              matchedCount++;
              break;
            }
          }
        }
      }
      
      res.json({ matchedCount, totalUnreconciled: unreconciledTxns.length });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Get match suggestions for a bank transaction
  app.get("/api/bank-transactions/:id/match-suggestions", authMiddleware, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const userId = (req as any).user?.id;
      
      // Get the bank transaction by ID
      const txn = await storage.getBankTransactionById(id);
      
      if (!txn) {
        return res.json([]);
      }
      
      // Verify user has access to the company that owns this transaction
      const hasAccess = await storage.hasCompanyAccess(userId, txn.companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: 'Access denied' });
      }
      
      const suggestions: any[] = [];
      const journalEntries = await storage.getJournalEntriesByCompanyId(txn.companyId);
      const receipts = await storage.getReceiptsByCompanyId(txn.companyId);
      const invoices = await storage.getInvoicesByCompanyId(txn.companyId);
      
      // Check journal entries
      for (const je of journalEntries) {
        const lines = await storage.getJournalLinesByEntryId(je.id);
        const totalAmount = lines.reduce((sum, l) => sum + l.debit, 0);
        if (Math.abs(totalAmount - Math.abs(txn.amount)) < 1) {
          suggestions.push({
            type: 'journal',
            id: je.id,
            description: je.description,
            amount: totalAmount,
            date: je.date,
            confidence: 0.8
          });
        }
      }
      
      // Check receipts
      for (const receipt of receipts) {
        if (receipt.amount && Math.abs(receipt.amount - Math.abs(txn.amount)) < 1) {
          suggestions.push({
            type: 'receipt',
            id: receipt.id,
            description: receipt.merchant || 'Receipt',
            amount: receipt.amount,
            date: receipt.date || receipt.createdAt,
            confidence: 0.7
          });
        }
      }
      
      // Check invoices
      for (const inv of invoices) {
        if (Math.abs(inv.total - Math.abs(txn.amount)) < 1) {
          suggestions.push({
            type: 'invoice',
            id: inv.id,
            description: `Invoice ${inv.number} - ${inv.customerName}`,
            amount: inv.total,
            date: inv.date,
            confidence: 0.75
          });
        }
      }
      
      suggestions.sort((a, b) => b.confidence - a.confidence);
      res.json(suggestions.slice(0, 5));
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // =====================================
  // VAT RETURNS
  // =====================================

  // Get VAT returns by company
  app.get("/api/companies/:companyId/vat-returns", authMiddleware, async (req: Request, res: Response) => {
    try {
      const userId = (req as any).user?.id;
      const { companyId } = req.params;
      
      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: 'Access denied' });
      }
      
      const vatReturns = await storage.getVatReturnsByCompanyId(companyId);
      res.json(vatReturns);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Generate VAT return (FTA VAT 201 format with emirate breakdown)
  app.post("/api/companies/:companyId/vat-returns/generate", authMiddleware, async (req: Request, res: Response) => {
    try {
      const userId = (req as any).user?.id;
      const { companyId } = req.params;
      const { periodStart, periodEnd } = req.body;
      
      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: 'Access denied' });
      }
      
      // Calculate VAT from invoices and receipts
      const invoices = await storage.getInvoicesByCompanyId(companyId);
      const receipts = await storage.getReceiptsByCompanyId(companyId);
      
      const startDate = new Date(periodStart);
      const endDate = new Date(periodEnd);
      
      // Calculate output tax from invoices
      const periodInvoices = invoices.filter(inv => {
        const invDate = new Date(inv.date);
        return invDate >= startDate && invDate <= endDate;
      });
      
      const totalSales = periodInvoices.reduce((sum, inv) => sum + inv.subtotal, 0);
      const outputTax = periodInvoices.reduce((sum, inv) => sum + inv.vatAmount, 0);
      
      // Calculate input tax from receipts
      const periodReceipts = receipts.filter(rec => {
        const recDate = new Date(rec.date || rec.createdAt);
        return recDate >= startDate && recDate <= endDate;
      });
      
      const totalExpenses = periodReceipts.reduce((sum, rec) => sum + (rec.amount || 0), 0);
      const inputTax = periodReceipts.reduce((sum, rec) => sum + (rec.vatAmount || 0), 0);
      
      // Due date is 28 days after period end
      const dueDate = new Date(endDate);
      dueDate.setDate(dueDate.getDate() + 28);
      
      // For now, put all sales in Dubai (most common emirate for businesses)
      // Users can manually adjust the emirate breakdown if needed
      const vatReturn = await storage.createVatReturn({
        companyId,
        periodStart: startDate,
        periodEnd: endDate,
        dueDate,
        status: 'draft',
        vatStagger: 'quarterly',
        // Emirate breakdown - default to Dubai for all sales
        box1aAbuDhabiAmount: 0,
        box1aAbuDhabiVat: 0,
        box1aAbuDhabiAdj: 0,
        box1bDubaiAmount: totalSales,
        box1bDubaiVat: outputTax,
        box1bDubaiAdj: 0,
        box1cSharjahAmount: 0,
        box1cSharjahVat: 0,
        box1cSharjahAdj: 0,
        box1dAjmanAmount: 0,
        box1dAjmanVat: 0,
        box1dAjmanAdj: 0,
        box1eUmmAlQuwainAmount: 0,
        box1eUmmAlQuwainVat: 0,
        box1eUmmAlQuwainAdj: 0,
        box1fRasAlKhaimahAmount: 0,
        box1fRasAlKhaimahVat: 0,
        box1fRasAlKhaimahAdj: 0,
        box1gFujairahAmount: 0,
        box1gFujairahVat: 0,
        box1gFujairahAdj: 0,
        // Other output categories
        box2TouristRefundAmount: 0,
        box2TouristRefundVat: 0,
        box3ReverseChargeAmount: 0,
        box3ReverseChargeVat: 0,
        box4ZeroRatedAmount: 0,
        box5ExemptAmount: 0,
        box6ImportsAmount: 0,
        box6ImportsVat: 0,
        box7ImportsAdjAmount: 0,
        box7ImportsAdjVat: 0,
        // Output totals
        box8TotalAmount: totalSales,
        box8TotalVat: outputTax,
        box8TotalAdj: 0,
        // Input categories
        box9ExpensesAmount: totalExpenses,
        box9ExpensesVat: inputTax,
        box9ExpensesAdj: 0,
        box10ReverseChargeAmount: 0,
        box10ReverseChargeVat: 0,
        // Input totals
        box11TotalAmount: totalExpenses,
        box11TotalVat: inputTax,
        box11TotalAdj: 0,
        // Net VAT calculation
        box12TotalDueTax: outputTax,
        box13RecoverableTax: inputTax,
        box14PayableTax: outputTax - inputTax,
        // Legacy fields for backward compatibility
        box1SalesStandard: totalSales,
        box2SalesOtherEmirates: 0,
        box3SalesTaxExempt: 0,
        box4SalesExempt: 0,
        box5TotalOutputTax: outputTax,
        box6ExpensesStandard: totalExpenses,
        box7ExpensesTouristRefund: 0,
        box8TotalInputTax: inputTax,
        box9NetTax: outputTax - inputTax,
        createdBy: userId,
      });
      
      res.status(201).json(vatReturn);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Submit VAT return
  app.post("/api/vat-returns/:id/submit", authMiddleware, async (req: Request, res: Response) => {
    try {
      const userId = (req as any).user?.id;
      const { id } = req.params;
      const { adjustmentAmount, adjustmentReason, notes } = req.body;
      
      const vatReturn = await storage.updateVatReturn(id, {
        status: 'submitted',
        adjustmentAmount: adjustmentAmount || 0,
        adjustmentReason: adjustmentReason || null,
        notes: notes || null,
        submittedBy: userId,
        submittedAt: new Date(),
      });
      
      res.json(vatReturn);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Update VAT return (for editing draft returns)
  app.patch("/api/vat-returns/:id", authMiddleware, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const updateData = req.body;
      
      const vatReturn = await storage.updateVatReturn(id, {
        ...updateData,
        updatedAt: new Date(),
      });
      
      res.json(vatReturn);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // =====================================
  // TEAM MANAGEMENT
  // =====================================

  // Get team members for a company
  app.get("/api/companies/:companyId/team", authMiddleware, async (req: Request, res: Response) => {
    try {
      const userId = (req as any).user?.id;
      const { companyId } = req.params;
      
      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: 'Access denied' });
      }
      
      const teamMembers = await storage.getCompanyUserWithUser(companyId);
      res.json(teamMembers);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Invite team member
  app.post("/api/companies/:companyId/team/invite", authMiddleware, async (req: Request, res: Response) => {
    try {
      const userId = (req as any).user?.id;
      const { companyId } = req.params;
      const { email, role } = req.body;
      
      const userRole = await storage.getUserRole(companyId, userId);
      if (!userRole || userRole.role !== 'owner') {
        return res.status(403).json({ message: 'Only company owners can invite team members' });
      }
      
      // Check if user exists
      let invitedUser = await storage.getUserByEmail(email);
      if (!invitedUser) {
        // Create a placeholder user that will be activated when they sign up
        invitedUser = await storage.createUser({
          email,
          name: email.split('@')[0],
          passwordHash: '', // Empty password - needs to be set on registration
        } as any);
      }
      
      // Check if already a member
      const existingAccess = await storage.hasCompanyAccess(invitedUser.id, companyId);
      if (existingAccess) {
        return res.status(400).json({ message: 'User is already a team member' });
      }
      
      // Add to company
      const companyUser = await storage.createCompanyUser({
        companyId,
        userId: invitedUser.id,
        role: role || 'employee',
      });
      
      res.status(201).json(companyUser);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Update team member role
  app.put("/api/companies/:companyId/team/:memberId", authMiddleware, async (req: Request, res: Response) => {
    try {
      const userId = (req as any).user?.id;
      const { companyId, memberId } = req.params;
      const { role } = req.body;
      
      const userRole = await storage.getUserRole(companyId, userId);
      if (!userRole || userRole.role !== 'owner') {
        return res.status(403).json({ message: 'Only company owners can update roles' });
      }
      
      const companyUser = await storage.updateCompanyUser(memberId, { role });
      res.json(companyUser);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Remove team member
  app.delete("/api/companies/:companyId/team/:memberId", authMiddleware, async (req: Request, res: Response) => {
    try {
      const userId = (req as any).user?.id;
      const { companyId, memberId } = req.params;
      
      const userRole = await storage.getUserRole(companyId, userId);
      if (!userRole || userRole.role !== 'owner') {
        return res.status(403).json({ message: 'Only company owners can remove team members' });
      }
      
      await storage.deleteCompanyUser(memberId);
      res.status(204).send();
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // =====================================
  // ADVANCED REPORTS
  // =====================================

  // Cash flow report - supports both path segment and query param for period
  app.get("/api/reports/:companyId/cash-flow/:period?", authMiddleware, async (req: Request, res: Response) => {
    try {
      const userId = (req as any).user?.id;
      const { companyId, period: pathPeriod } = req.params;
      const period = pathPeriod || req.query.period || 'quarter'; // Support path segment, query param, or default
      
      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: 'Access denied' });
      }
      
      const journalEntries = await storage.getJournalEntriesByCompanyId(companyId);
      const accounts = await storage.getAccountsByCompanyId(companyId);
      
      // Group entries by period
      const now = new Date();
      let startDate: Date;
      let periodLength: 'month' | 'quarter' | 'year' = 'quarter';
      
      switch (period) {
        case 'month':
          startDate = new Date(now.getFullYear(), now.getMonth() - 6, 1);
          periodLength = 'month';
          break;
        case 'year':
          startDate = new Date(now.getFullYear() - 2, 0, 1);
          periodLength = 'year';
          break;
        default:
          startDate = new Date(now.getFullYear() - 1, Math.floor(now.getMonth() / 3) * 3, 1);
          periodLength = 'quarter';
      }
      
      const cashFlowData: any[] = [];
      let currentDate = new Date(startDate);
      let runningBalance = 0;
      
      while (currentDate <= now) {
        let periodEnd: Date;
        let periodLabel: string;
        
        if (periodLength === 'month') {
          periodEnd = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0);
          periodLabel = currentDate.toLocaleString('default', { month: 'short', year: '2-digit' });
        } else if (periodLength === 'quarter') {
          periodEnd = new Date(currentDate.getFullYear(), currentDate.getMonth() + 3, 0);
          periodLabel = `Q${Math.floor(currentDate.getMonth() / 3) + 1} ${currentDate.getFullYear()}`;
        } else {
          periodEnd = new Date(currentDate.getFullYear(), 11, 31);
          periodLabel = currentDate.getFullYear().toString();
        }
        
        // Get entries for this period
        const periodEntries = journalEntries.filter(je => {
          const jeDate = new Date(je.date);
          return jeDate >= currentDate && jeDate <= periodEnd;
        });
        
        // Calculate cash flows (simplified)
        let operatingInflow = 0;
        let operatingOutflow = 0;
        
        for (const entry of periodEntries) {
          const lines = await storage.getJournalLinesByEntryId(entry.id);
          for (const line of lines) {
            const account = accounts.find(a => a.id === line.accountId);
            if (account) {
              if (account.type === 'income') {
                operatingInflow += line.credit;
              } else if (account.type === 'expense') {
                operatingOutflow += line.debit;
              }
            }
          }
        }
        
        const netCashFlow = operatingInflow - operatingOutflow;
        runningBalance += netCashFlow;
        
        cashFlowData.push({
          period: periodLabel,
          operatingInflow,
          operatingOutflow,
          investingInflow: 0,
          investingOutflow: 0,
          financingInflow: 0,
          financingOutflow: 0,
          netCashFlow,
          endingBalance: runningBalance,
        });
        
        // Move to next period
        if (periodLength === 'month') {
          currentDate.setMonth(currentDate.getMonth() + 1);
        } else if (periodLength === 'quarter') {
          currentDate.setMonth(currentDate.getMonth() + 3);
        } else {
          currentDate.setFullYear(currentDate.getFullYear() + 1);
        }
      }
      
      res.json(cashFlowData);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Aging report
  app.get("/api/reports/:companyId/aging", authMiddleware, async (req: Request, res: Response) => {
    try {
      const userId = (req as any).user?.id;
      const { companyId } = req.params;
      
      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: 'Access denied' });
      }
      
      const invoices = await storage.getInvoicesByCompanyId(companyId);
      const now = new Date();
      const agingData: any[] = [];
      
      // Group unpaid invoices by customer
      const unpaidInvoices = invoices.filter(inv => inv.status !== 'paid');
      const customerTotals: Record<string, any> = {};
      
      for (const inv of unpaidInvoices) {
        const invDate = new Date(inv.date);
        const daysOld = Math.floor((now.getTime() - invDate.getTime()) / (1000 * 60 * 60 * 24));
        
        if (!customerTotals[inv.customerName]) {
          customerTotals[inv.customerName] = {
            id: inv.id,
            name: inv.customerName,
            type: 'receivable',
            current: 0,
            days30: 0,
            days60: 0,
            days90: 0,
            over90: 0,
            total: 0,
          };
        }
        
        const customer = customerTotals[inv.customerName];
        customer.total += inv.total;
        
        if (daysOld <= 0) {
          customer.current += inv.total;
        } else if (daysOld <= 30) {
          customer.days30 += inv.total;
        } else if (daysOld <= 60) {
          customer.days60 += inv.total;
        } else if (daysOld <= 90) {
          customer.days90 += inv.total;
        } else {
          customer.over90 += inv.total;
        }
      }
      
      agingData.push(...Object.values(customerTotals));
      res.json(agingData);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Period comparison report - supports both path segment and query param for period  
  app.get("/api/reports/:companyId/comparison/:period?", authMiddleware, async (req: Request, res: Response) => {
    try {
      const userId = (req as any).user?.id;
      const { companyId, period: pathPeriod } = req.params;
      const period = pathPeriod || req.query.period || 'quarter';
      
      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: 'Access denied' });
      }
      
      const invoices = await storage.getInvoicesByCompanyId(companyId);
      const receipts = await storage.getReceiptsByCompanyId(companyId);
      
      const now = new Date();
      let currentStart: Date, currentEnd: Date, previousStart: Date, previousEnd: Date;
      
      if (period === 'month') {
        currentStart = new Date(now.getFullYear(), now.getMonth(), 1);
        currentEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
        previousStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        previousEnd = new Date(now.getFullYear(), now.getMonth(), 0);
      } else if (period === 'year') {
        currentStart = new Date(now.getFullYear(), 0, 1);
        currentEnd = new Date(now.getFullYear(), 11, 31);
        previousStart = new Date(now.getFullYear() - 1, 0, 1);
        previousEnd = new Date(now.getFullYear() - 1, 11, 31);
      } else { // quarter
        const currentQ = Math.floor(now.getMonth() / 3);
        currentStart = new Date(now.getFullYear(), currentQ * 3, 1);
        currentEnd = new Date(now.getFullYear(), (currentQ + 1) * 3, 0);
        previousStart = new Date(now.getFullYear(), (currentQ - 1) * 3, 1);
        previousEnd = new Date(now.getFullYear(), currentQ * 3, 0);
      }
      
      const currentInvoices = invoices.filter(inv => {
        const d = new Date(inv.date);
        return d >= currentStart && d <= currentEnd;
      });
      const previousInvoices = invoices.filter(inv => {
        const d = new Date(inv.date);
        return d >= previousStart && d <= previousEnd;
      });
      
      const currentReceipts = receipts.filter(rec => {
        const d = new Date(rec.date || rec.createdAt);
        return d >= currentStart && d <= currentEnd;
      });
      const previousReceipts = receipts.filter(rec => {
        const d = new Date(rec.date || rec.createdAt);
        return d >= previousStart && d <= previousEnd;
      });
      
      const currentRevenue = currentInvoices.reduce((sum, inv) => sum + inv.total, 0);
      const previousRevenue = previousInvoices.reduce((sum, inv) => sum + inv.total, 0);
      const currentExpenses = currentReceipts.reduce((sum, rec) => sum + (rec.amount || 0), 0);
      const previousExpenses = previousReceipts.reduce((sum, rec) => sum + (rec.amount || 0), 0);
      
      const comparison = [
        {
          metric: 'Total Revenue',
          current: currentRevenue,
          previous: previousRevenue,
          change: currentRevenue - previousRevenue,
          changePercent: previousRevenue ? ((currentRevenue - previousRevenue) / previousRevenue) * 100 : 0,
        },
        {
          metric: 'Total Expenses',
          current: currentExpenses,
          previous: previousExpenses,
          change: currentExpenses - previousExpenses,
          changePercent: previousExpenses ? ((currentExpenses - previousExpenses) / previousExpenses) * 100 : 0,
        },
        {
          metric: 'Net Profit',
          current: currentRevenue - currentExpenses,
          previous: previousRevenue - previousExpenses,
          change: (currentRevenue - currentExpenses) - (previousRevenue - previousExpenses),
          changePercent: (previousRevenue - previousExpenses) ? (((currentRevenue - currentExpenses) - (previousRevenue - previousExpenses)) / Math.abs(previousRevenue - previousExpenses)) * 100 : 0,
        },
        {
          metric: 'Invoice Count',
          current: currentInvoices.length,
          previous: previousInvoices.length,
          change: currentInvoices.length - previousInvoices.length,
          changePercent: previousInvoices.length ? ((currentInvoices.length - previousInvoices.length) / previousInvoices.length) * 100 : 0,
        },
        {
          metric: 'Avg Invoice Value',
          current: currentInvoices.length ? currentRevenue / currentInvoices.length : 0,
          previous: previousInvoices.length ? previousRevenue / previousInvoices.length : 0,
          change: (currentInvoices.length ? currentRevenue / currentInvoices.length : 0) - (previousInvoices.length ? previousRevenue / previousInvoices.length : 0),
          changePercent: (previousInvoices.length && previousRevenue / previousInvoices.length) ? (((currentInvoices.length ? currentRevenue / currentInvoices.length : 0) - (previousRevenue / previousInvoices.length)) / (previousRevenue / previousInvoices.length)) * 100 : 0,
        },
      ];
      
      res.json(comparison);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // =====================================
  // ADMIN ROUTES (Requires Admin Role)
  // =====================================

  // Get admin settings
  app.get("/api/admin/settings", adminMiddleware, async (req: Request, res: Response) => {
    try {
      const settings = await storage.getAdminSettings();
      res.json(settings);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Update admin setting
  app.put("/api/admin/settings", adminMiddleware, async (req: Request, res: Response) => {
    try {
      const { key, value } = req.body;
      if (!key || value === undefined) {
        return res.status(400).json({ message: 'Key and value required' });
      }
      
      const existing = await storage.getAdminSettingByKey(key);
      if (existing) {
        const setting = await storage.updateAdminSetting(key, value);
        res.json(setting);
      } else {
        const setting = await storage.createAdminSetting({
          key,
          value,
          category: 'system',
        });
        res.json(setting);
      }
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Get subscription plans
  app.get("/api/admin/plans", adminMiddleware, async (req: Request, res: Response) => {
    try {
      const plans = await storage.getSubscriptionPlans();
      res.json(plans);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Create subscription plan
  app.post("/api/admin/plans", adminMiddleware, async (req: Request, res: Response) => {
    try {
      const plan = await storage.createSubscriptionPlan(req.body);
      res.status(201).json(plan);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Update subscription plan
  app.put("/api/admin/plans/:id", adminMiddleware, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const plan = await storage.updateSubscriptionPlan(id, req.body);
      res.json(plan);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Delete subscription plan
  app.delete("/api/admin/plans/:id", adminMiddleware, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      await storage.deleteSubscriptionPlan(id);
      res.status(204).send();
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Get all users (admin)
  app.get("/api/admin/users", adminMiddleware, async (req: Request, res: Response) => {
    try {
      const users = await storage.getAllUsers();
      res.json(users.map(u => ({
        id: u.id,
        name: u.name,
        email: u.email,
        createdAt: u.createdAt,
      })));
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Get all companies (admin)
  app.get("/api/admin/companies", adminMiddleware, async (req: Request, res: Response) => {
    try {
      const companies = await storage.getAllCompanies();
      res.json(companies);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Update company (admin)
  app.patch("/api/admin/companies/:companyId", adminMiddleware, async (req: Request, res: Response) => {
    try {
      const { companyId } = req.params;
      const updates = req.body;
      
      const company = await storage.getCompany(companyId);
      if (!company) {
        return res.status(404).json({ message: 'Company not found' });
      }
      
      const updatedCompany = await storage.updateCompany(companyId, updates);
      res.json(updatedCompany);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Get audit logs
  app.get("/api/admin/audit-logs", adminMiddleware, async (req: Request, res: Response) => {
    try {
      const limit = parseInt(req.query.limit as string) || 100;
      const logs = await storage.getAuditLogs(limit);
      res.json(logs);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Get admin stats
  app.get("/api/admin/stats", adminMiddleware, async (req: Request, res: Response) => {
    try {
      const users = await storage.getAllUsers();
      const companies = await storage.getAllCompanies();
      
      res.json({
        totalUsers: users.length,
        activeUsers: users.length,
        totalCompanies: companies.length,
        totalInvoices: 0,
        totalReceipts: 0,
        monthlyRevenue: 0,
        aiCreditsUsed: 0,
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // =====================================
  // AUTOMATIC REGULATORY NEWS FETCHING
  // =====================================
  
  // Function to fetch UAE regulatory/tax news using OpenAI with retry logic
  async function fetchAndStoreRegulatoryNews(retryCount = 0): Promise<void> {
    const MAX_RETRIES = 3;
    const RETRY_DELAY_MS = 5000; // 5 seconds
    
    // Check if OpenAI API key is available
    if (!process.env.OPENAI_API_KEY) {
      console.warn('[Regulatory News] OpenAI API key not configured, skipping news fetch');
      return;
    }
    
    try {
      console.log('[Regulatory News] Starting automatic news fetch...');
      
      const currentDate = new Date().toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      });
      
      const completion = await openai.chat.completions.create({
        model: AI_MODEL,
        messages: [
          {
            role: "system",
            content: `You are a UAE tax and regulatory news aggregator for accountants and bookkeepers. 
Generate 3-5 realistic and timely news items about UAE tax, accounting, and financial regulations.
Focus on:
- Federal Tax Authority (FTA) announcements
- VAT updates and clarifications
- Corporate tax changes
- Excise tax news
- Tax compliance deadlines
- New regulations affecting businesses
- Ministry of Finance updates
- Free zone regulations

Return a JSON array of news items with this structure:
{
  "news": [
    {
      "title": "News headline",
      "titleAr": "Arabic translation of headline",
      "summary": "Brief 2-3 sentence summary",
      "summaryAr": "Arabic translation of summary", 
      "content": "Detailed content (3-4 paragraphs)",
      "contentAr": "Arabic translation of content",
      "category": "vat" | "corporate_tax" | "customs" | "labor" | "general",
      "source": "Federal Tax Authority" | "Ministry of Finance" | "UAE Government" | "FTA Clarification",
      "sourceUrl": "https://tax.gov.ae/en/legislation.aspx",
      "importance": "low" | "normal" | "high" | "critical",
      "effectiveDate": "YYYY-MM-DD or null"
    }
  ]
}

Make the news items realistic, current, and relevant to UAE businesses. Include recent dates.`
          },
          {
            role: "user",
            content: `Generate the latest UAE tax and financial regulatory news as of ${currentDate}. Include any recent FTA updates, VAT clarifications, corporate tax announcements, or compliance deadlines.`
          }
        ],
        response_format: { type: "json_object" },
        temperature: 0.7,
      });
      
      const response = JSON.parse(completion.choices[0].message.content || '{"news":[]}');
      const newsItems = response.news || [];
      
      let storedCount = 0;
      for (const item of newsItems) {
        try {
          await storage.createRegulatoryNews({
            title: item.title,
            titleAr: item.titleAr,
            summary: item.summary,
            summaryAr: item.summaryAr,
            content: item.content,
            contentAr: item.contentAr,
            category: item.category || 'general',
            source: item.source,
            sourceUrl: item.sourceUrl,
            importance: item.importance || 'normal',
            effectiveDate: item.effectiveDate ? new Date(item.effectiveDate) : null,
            publishedAt: new Date(),
            isActive: true,
          });
          storedCount++;
        } catch (storeError: any) {
          console.error('[Regulatory News] Error storing news item:', storeError.message);
        }
      }
      
      console.log(`[Regulatory News] Successfully stored ${storedCount} news items`);
    } catch (error: any) {
      console.error(`[Regulatory News] Error fetching news (attempt ${retryCount + 1}/${MAX_RETRIES}):`, error.message);
      
      // Retry with exponential backoff
      if (retryCount < MAX_RETRIES - 1) {
        const delay = RETRY_DELAY_MS * Math.pow(2, retryCount);
        console.log(`[Regulatory News] Retrying in ${delay / 1000} seconds...`);
        setTimeout(() => {
          fetchAndStoreRegulatoryNews(retryCount + 1).catch(() => {
            // Silently handle final retry failure
          });
        }, delay);
      } else {
        console.error('[Regulatory News] Max retries reached, will try again in next scheduled run');
      }
    }
  }
  
  // Manual trigger for news fetch
  app.post("/api/regulatory-news/fetch", authMiddleware, async (req: Request, res: Response) => {
    try {
      await fetchAndStoreRegulatoryNews();
      const news = await storage.getRegulatoryNews();
      res.json({ success: true, count: news.length, news });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });
  
  // Set up automatic news fetching every 30 minutes
  const NEWS_FETCH_INTERVAL = 30 * 60 * 1000; // 30 minutes in milliseconds
  
  // Initial fetch on server start (after a brief delay)
  setTimeout(() => {
    fetchAndStoreRegulatoryNews();
  }, 5000);
  
  // Schedule recurring fetch every 30 minutes
  setInterval(() => {
    fetchAndStoreRegulatoryNews();
  }, NEWS_FETCH_INTERVAL);
  
  console.log('[Regulatory News] Automatic news fetching enabled - runs every 30 minutes');

  // =====================================
  // CLIENT PORTAL - DOCUMENT VAULT
  // =====================================
  
  // Get all documents for a company
  app.get("/api/companies/:companyId/documents", authMiddleware, async (req: Request, res: Response) => {
    try {
      const { companyId } = req.params;
      const documents = await storage.getDocuments(companyId);
      res.json(documents);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Upload document (stub - would need file upload middleware in production)
  app.post("/api/companies/:companyId/documents", authMiddleware, async (req: Request, res: Response) => {
    try {
      const { companyId } = req.params;
      const userId = (req as any).user.id;
      
      // For now, accept document metadata directly
      // In production, this would handle file uploads to storage
      const documentData = {
        companyId,
        name: req.body.name || 'Uploaded Document',
        nameAr: req.body.nameAr || null,
        category: req.body.category || 'other',
        description: req.body.description || null,
        fileUrl: req.body.fileUrl || '/uploads/placeholder.pdf',
        fileName: req.body.fileName || 'document.pdf',
        fileSize: req.body.fileSize || null,
        mimeType: req.body.mimeType || 'application/pdf',
        expiryDate: req.body.expiryDate ? new Date(req.body.expiryDate) : null,
        reminderDays: req.body.reminderDays || 30,
        reminderSent: false,
        tags: req.body.tags || null,
        isArchived: false,
        uploadedBy: userId,
      };
      
      const document = await storage.createDocument(documentData);
      res.status(201).json(document);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Delete document
  app.delete("/api/documents/:documentId", authMiddleware, async (req: Request, res: Response) => {
    try {
      const { documentId } = req.params;
      await storage.deleteDocument(documentId);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // =====================================
  // CLIENT PORTAL - TAX RETURN ARCHIVE
  // =====================================
  
  // Get tax return archive for a company
  app.get("/api/companies/:companyId/tax-returns-archive", authMiddleware, async (req: Request, res: Response) => {
    try {
      const { companyId } = req.params;
      const returns = await storage.getTaxReturnArchive(companyId);
      res.json(returns);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Add tax return to archive
  app.post("/api/companies/:companyId/tax-returns-archive", authMiddleware, async (req: Request, res: Response) => {
    try {
      const { companyId } = req.params;
      const userId = (req as any).user.id;
      
      const returnData = {
        companyId,
        returnType: req.body.returnType || 'vat',
        periodLabel: req.body.periodLabel,
        periodStart: new Date(req.body.periodStart),
        periodEnd: new Date(req.body.periodEnd),
        filingDate: new Date(req.body.filingDate),
        ftaReferenceNumber: req.body.ftaReferenceNumber || null,
        taxAmount: parseFloat(req.body.taxAmount) || 0,
        paymentStatus: req.body.paymentStatus || 'paid',
        fileUrl: req.body.fileUrl || null,
        fileName: req.body.fileName || null,
        notes: req.body.notes || null,
        filedBy: userId,
      };
      
      const taxReturn = await storage.createTaxReturnArchive(returnData);
      res.status(201).json(taxReturn);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // =====================================
  // CLIENT PORTAL - COMPLIANCE TASKS
  // =====================================
  
  // Get compliance tasks for a company
  app.get("/api/companies/:companyId/compliance-tasks", authMiddleware, async (req: Request, res: Response) => {
    try {
      const { companyId } = req.params;
      const tasks = await storage.getComplianceTasks(companyId);
      res.json(tasks);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Create compliance task
  app.post("/api/companies/:companyId/compliance-tasks", authMiddleware, async (req: Request, res: Response) => {
    try {
      const { companyId } = req.params;
      const userId = (req as any).user.id;
      
      const taskData = {
        companyId,
        title: req.body.title,
        titleAr: req.body.titleAr || null,
        description: req.body.description || null,
        category: req.body.category || 'other',
        priority: req.body.priority || 'medium',
        status: 'pending',
        dueDate: new Date(req.body.dueDate),
        reminderDate: req.body.reminderDate ? new Date(req.body.reminderDate) : null,
        reminderSent: false,
        isRecurring: req.body.isRecurring || false,
        recurrencePattern: req.body.recurrencePattern || null,
        completedAt: null,
        completedBy: null,
        assignedTo: req.body.assignedTo || null,
        createdBy: userId,
        relatedDocumentId: req.body.relatedDocumentId || null,
        relatedVatReturnId: req.body.relatedVatReturnId || null,
        notes: req.body.notes || null,
      };
      
      const task = await storage.createComplianceTask(taskData);
      res.status(201).json(task);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Update compliance task
  app.patch("/api/compliance-tasks/:taskId", authMiddleware, async (req: Request, res: Response) => {
    try {
      const { taskId } = req.params;
      const userId = (req as any).user.id;
      
      const updates: any = {};
      if (req.body.status) {
        updates.status = req.body.status;
        if (req.body.status === 'completed') {
          updates.completedAt = new Date();
          updates.completedBy = userId;
        }
      }
      if (req.body.priority) updates.priority = req.body.priority;
      if (req.body.dueDate) updates.dueDate = new Date(req.body.dueDate);
      if (req.body.notes !== undefined) updates.notes = req.body.notes;
      
      const task = await storage.updateComplianceTask(taskId, updates);
      res.json(task);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Delete compliance task
  app.delete("/api/compliance-tasks/:taskId", authMiddleware, async (req: Request, res: Response) => {
    try {
      const { taskId } = req.params;
      await storage.deleteComplianceTask(taskId);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // =====================================
  // CLIENT PORTAL - MESSAGES
  // =====================================
  
  // Get messages for a company
  app.get("/api/companies/:companyId/messages", authMiddleware, async (req: Request, res: Response) => {
    try {
      const { companyId } = req.params;
      const messages = await storage.getMessages(companyId);
      res.json(messages);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Send message
  app.post("/api/companies/:companyId/messages", authMiddleware, async (req: Request, res: Response) => {
    try {
      const { companyId } = req.params;
      const userId = (req as any).user.id;
      
      const messageData = {
        companyId,
        threadId: req.body.threadId || null,
        subject: req.body.subject || null,
        content: req.body.content,
        senderId: userId,
        recipientId: req.body.recipientId || null,
        isRead: false,
        readAt: null,
        attachmentUrl: req.body.attachmentUrl || null,
        attachmentName: req.body.attachmentName || null,
        messageType: req.body.messageType || 'general',
        isArchived: false,
      };
      
      const message = await storage.createMessage(messageData);
      res.status(201).json(message);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // =====================================
  // CLIENT PORTAL - NEWS FEED
  // =====================================
  
  // Get news items
  app.get("/api/news", authMiddleware, async (req: Request, res: Response) => {
    try {
      const news = await storage.getNewsItems();
      res.json(news);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // =====================================
  // ADMIN PANEL - DASHBOARD & STATS
  // =====================================
  
  // Get admin dashboard stats
  app.get("/api/admin/stats", adminMiddleware, async (req: Request, res: Response) => {
    try {
      const users = await storage.getAllUsers();
      const companies = await storage.getAllCompanies();
      const invitations = await storage.getInvitations();
      const activityLogs = await storage.getActivityLogs(10);
      
      const pendingInvitations = invitations.filter(i => i.status === 'pending').length;
      const activeClients = companies.length;
      const totalUsers = users.length;
      const adminUsers = users.filter(u => u.isAdmin).length;
      
      res.json({
        totalClients: activeClients,
        totalUsers,
        adminUsers,
        clientUsers: totalUsers - adminUsers,
        pendingInvitations,
        recentActivity: activityLogs,
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // =====================================
  // ADMIN PANEL - CLIENT (COMPANY) MANAGEMENT
  // =====================================
  
  // Get all clients (companies) - Admin only
  // Get all companies with stats (supports filtering by companyType)
  app.get("/api/admin/clients", adminMiddleware, async (req: Request, res: Response) => {
    try {
      const { type } = req.query; // 'client' | 'customer' | undefined (all)
      
      let companies;
      if (type === 'client') {
        companies = await storage.getClientCompanies();
      } else if (type === 'customer') {
        companies = await storage.getCustomerCompanies();
      } else {
        companies = await storage.getAllCompanies();
      }
      
      // Get user counts per company
      const clientsWithStats = await Promise.all(
        companies.map(async (company) => {
          const companyUsers = await storage.getCompanyUsersByCompanyId(company.id);
          const documents = await storage.getDocuments(company.id);
          const invoices = await storage.getInvoicesByCompanyId(company.id);
          
          return {
            ...company,
            userCount: companyUsers.length,
            documentCount: documents.length,
            invoiceCount: invoices.length,
          };
        })
      );
      
      res.json(clientsWithStats);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Get specific client details with all related data - Admin only
  app.get("/api/admin/clients/:clientId", adminMiddleware, async (req: Request, res: Response) => {
    try {
      const { clientId } = req.params;
      const company = await storage.getCompany(clientId);
      
      if (!company) {
        return res.status(404).json({ message: "Client not found" });
      }
      
      const companyUsers = await storage.getCompanyUserWithUser(clientId);
      const documents = await storage.getDocuments(clientId);
      const invoices = await storage.getInvoicesByCompanyId(clientId);
      const receipts = await storage.getReceiptsByCompanyId(clientId);
      const journalEntries = await storage.getJournalEntriesByCompanyId(clientId);
      const complianceTasks = await storage.getComplianceTasks(clientId);
      const clientNotes = await storage.getClientNotes(clientId);
      const activityLogs = await storage.getActivityLogsByCompany(clientId, 50);
      
      res.json({
        company,
        users: companyUsers,
        documents,
        invoices,
        receipts,
        journalEntries,
        complianceTasks,
        clientNotes,
        activityLogs,
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Create new client (company) - Admin only
  app.post("/api/admin/clients", adminMiddleware, async (req: Request, res: Response) => {
    try {
      const userId = (req as any).user.id;
      
      const company = await storage.createCompany({
        name: req.body.name,
        baseCurrency: req.body.baseCurrency || "AED",
        locale: req.body.locale || "en",
        companyType: req.body.companyType || "client", // 'client' for NR-managed, 'customer' for SaaS
        legalStructure: req.body.legalStructure,
        industry: req.body.industry,
        registrationNumber: req.body.registrationNumber,
        businessAddress: req.body.businessAddress,
        contactPhone: req.body.contactPhone,
        contactEmail: req.body.contactEmail,
        websiteUrl: req.body.websiteUrl,
        logoUrl: req.body.logoUrl,
        trnVatNumber: req.body.trnVatNumber,
        taxRegistrationType: req.body.taxRegistrationType,
        vatFilingFrequency: req.body.vatFilingFrequency,
        corporateTaxId: req.body.corporateTaxId,
      });
      
      // Seed chart of accounts for the new company
      await seedChartOfAccounts(company.id);
      
      // Log activity
      await storage.createActivityLog({
        userId,
        companyId: company.id,
        action: 'create',
        entityType: 'company',
        entityId: company.id,
        description: `Created new client: ${company.name}`,
      });
      
      res.status(201).json(company);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Update client (company) - Admin only
  app.patch("/api/admin/clients/:clientId", adminMiddleware, async (req: Request, res: Response) => {
    try {
      const { clientId } = req.params;
      const userId = (req as any).user.id;
      
      const company = await storage.updateCompany(clientId, req.body);
      
      // Log activity
      await storage.createActivityLog({
        userId,
        companyId: clientId,
        action: 'update',
        entityType: 'company',
        entityId: clientId,
        description: `Updated client: ${company.name}`,
      });
      
      res.json(company);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Delete client (company) - Admin only
  app.delete("/api/admin/clients/:clientId", adminMiddleware, async (req: Request, res: Response) => {
    try {
      const { clientId } = req.params;
      const userId = (req as any).user.id;
      
      const company = await storage.getCompany(clientId);
      if (!company) {
        return res.status(404).json({ message: "Client not found" });
      }
      
      await storage.deleteCompany(clientId);
      
      // Log activity
      await storage.createActivityLog({
        userId,
        action: 'delete',
        entityType: 'company',
        entityId: clientId,
        description: `Deleted client: ${company.name}`,
      });
      
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // =====================================
  // ADMIN PANEL - USER MANAGEMENT
  // =====================================
  
  // Get all users - Admin only
  app.get("/api/admin/users", adminMiddleware, async (req: Request, res: Response) => {
    try {
      const users = await storage.getAllUsers();
      
      // Return users without password hashes
      const safeUsers = users.map(({ passwordHash, ...user }) => user);
      res.json(safeUsers);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Update user (admin can promote to admin, change details) - Admin only
  app.patch("/api/admin/users/:userId", adminMiddleware, async (req: Request, res: Response) => {
    try {
      const { userId: targetUserId } = req.params;
      const adminUserId = (req as any).user.id;
      
      const updates: any = {};
      if (req.body.name) updates.name = req.body.name;
      if (req.body.email) updates.email = req.body.email;
      if (typeof req.body.isAdmin === 'boolean') updates.isAdmin = req.body.isAdmin;
      
      const user = await storage.updateUser(targetUserId, updates);
      
      // Log activity
      await storage.createActivityLog({
        userId: adminUserId,
        action: 'update',
        entityType: 'user',
        entityId: targetUserId,
        description: `Updated user: ${user.email}`,
        metadata: JSON.stringify({ changes: Object.keys(updates) }),
      });
      
      const { passwordHash, ...safeUser } = user;
      res.json(safeUser);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Delete user - Admin only
  app.delete("/api/admin/users/:userId", adminMiddleware, async (req: Request, res: Response) => {
    try {
      const { userId: targetUserId } = req.params;
      const adminUserId = (req as any).user.id;
      
      // Prevent admin from deleting themselves
      if (targetUserId === adminUserId) {
        return res.status(400).json({ message: "Cannot delete your own account" });
      }
      
      const user = await storage.getUser(targetUserId);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }
      
      await storage.deleteUser(targetUserId);
      
      // Log activity
      await storage.createActivityLog({
        userId: adminUserId,
        action: 'delete',
        entityType: 'user',
        entityId: targetUserId,
        description: `Deleted user: ${user.email}`,
      });
      
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // =====================================
  // ADMIN PANEL - CLIENT INVITATIONS
  // =====================================
  
  // Get all invitations - Admin only
  app.get("/api/admin/invitations", adminMiddleware, async (req: Request, res: Response) => {
    try {
      const invitations = await storage.getInvitations();
      res.json(invitations);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Create invitation - Admin only
  app.post("/api/admin/invitations", adminMiddleware, async (req: Request, res: Response) => {
    try {
      const adminUserId = (req as any).user.id;
      
      // Check if email already has pending invitation
      const existing = await storage.getInvitationByEmail(req.body.email);
      if (existing && existing.status === 'pending') {
        return res.status(400).json({ message: "Pending invitation already exists for this email" });
      }
      
      // Generate secure token
      const token = require('crypto').randomBytes(32).toString('hex');
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 7); // 7 days expiry
      
      const invitation = await storage.createInvitation({
        email: req.body.email,
        companyId: req.body.companyId || null,
        role: req.body.role || 'client',
        userType: req.body.userType || 'client', // admin | client | customer
        token,
        invitedBy: adminUserId,
        status: 'pending',
        expiresAt,
      });
      
      // Log activity
      await storage.createActivityLog({
        userId: adminUserId,
        companyId: req.body.companyId || null,
        action: 'invite',
        entityType: 'invitation',
        entityId: invitation.id,
        description: `Sent invitation to ${req.body.email}`,
      });
      
      res.status(201).json(invitation);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Revoke invitation - Admin only
  app.patch("/api/admin/invitations/:invitationId/revoke", adminMiddleware, async (req: Request, res: Response) => {
    try {
      const { invitationId } = req.params;
      const adminUserId = (req as any).user.id;
      
      const invitation = await storage.updateInvitation(invitationId, { status: 'revoked' });
      
      // Log activity
      await storage.createActivityLog({
        userId: adminUserId,
        action: 'update',
        entityType: 'invitation',
        entityId: invitationId,
        description: `Revoked invitation for ${invitation.email}`,
      });
      
      res.json(invitation);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Resend invitation - Admin only
  app.post("/api/admin/invitations/:invitationId/resend", adminMiddleware, async (req: Request, res: Response) => {
    try {
      const { invitationId } = req.params;
      const adminUserId = (req as any).user.id;
      
      // Generate new token and extend expiry
      const token = require('crypto').randomBytes(32).toString('hex');
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 7);
      
      const invitation = await storage.updateInvitation(invitationId, {
        token,
        expiresAt,
        status: 'pending',
      });
      
      // Log activity
      await storage.createActivityLog({
        userId: adminUserId,
        action: 'update',
        entityType: 'invitation',
        entityId: invitationId,
        description: `Resent invitation to ${invitation.email}`,
      });
      
      res.json(invitation);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Delete invitation - Admin only
  app.delete("/api/admin/invitations/:invitationId", adminMiddleware, async (req: Request, res: Response) => {
    try {
      const { invitationId } = req.params;
      await storage.deleteInvitation(invitationId);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // =====================================
  // ADMIN PANEL - ACTIVITY LOGS
  // =====================================
  
  // Get all activity logs - Admin only
  app.get("/api/admin/activity-logs", adminMiddleware, async (req: Request, res: Response) => {
    try {
      const limit = parseInt(req.query.limit as string) || 100;
      const logs = await storage.getActivityLogs(limit);
      res.json(logs);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Get activity logs for specific company - Admin only
  app.get("/api/admin/clients/:clientId/activity-logs", adminMiddleware, async (req: Request, res: Response) => {
    try {
      const { clientId } = req.params;
      const limit = parseInt(req.query.limit as string) || 100;
      const logs = await storage.getActivityLogsByCompany(clientId, limit);
      res.json(logs);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // =====================================
  // ADMIN PANEL - CLIENT NOTES (Internal)
  // =====================================
  
  // Get notes for a client - Admin only
  app.get("/api/admin/clients/:clientId/notes", adminMiddleware, async (req: Request, res: Response) => {
    try {
      const { clientId } = req.params;
      const notes = await storage.getClientNotes(clientId);
      res.json(notes);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Create note for a client - Admin only
  app.post("/api/admin/clients/:clientId/notes", adminMiddleware, async (req: Request, res: Response) => {
    try {
      const { clientId } = req.params;
      const authorId = (req as any).user.id;
      
      const note = await storage.createClientNote({
        companyId: clientId,
        authorId,
        content: req.body.content,
        isPinned: req.body.isPinned || false,
      });
      
      res.status(201).json(note);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Update note - Admin only
  app.patch("/api/admin/notes/:noteId", adminMiddleware, async (req: Request, res: Response) => {
    try {
      const { noteId } = req.params;
      const note = await storage.updateClientNote(noteId, req.body);
      res.json(note);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Delete note - Admin only
  app.delete("/api/admin/notes/:noteId", adminMiddleware, async (req: Request, res: Response) => {
    try {
      const { noteId } = req.params;
      await storage.deleteClientNote(noteId);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // =====================================
  // ADMIN PANEL - MANAGE DOCUMENTS FOR CLIENTS
  // =====================================
  
  // Admin upload document for client
  app.post("/api/admin/clients/:clientId/documents", adminMiddleware, async (req: Request, res: Response) => {
    try {
      const { clientId } = req.params;
      const userId = (req as any).user.id;
      
      const documentData = {
        companyId: clientId,
        name: req.body.name,
        nameAr: req.body.nameAr || null,
        category: req.body.category,
        description: req.body.description || null,
        fileUrl: req.body.fileUrl || '/uploads/placeholder.pdf',
        fileName: req.body.fileName || 'document.pdf',
        fileSize: req.body.fileSize || null,
        mimeType: req.body.mimeType || 'application/pdf',
        expiryDate: req.body.expiryDate ? new Date(req.body.expiryDate) : null,
        reminderDays: req.body.reminderDays || 30,
        reminderSent: false,
        tags: req.body.tags || null,
        isArchived: false,
        uploadedBy: userId,
      };
      
      const document = await storage.createDocument(documentData);
      
      // Log activity
      await storage.createActivityLog({
        userId,
        companyId: clientId,
        action: 'create',
        entityType: 'document',
        entityId: document.id,
        description: `Admin uploaded document: ${document.name}`,
      });
      
      res.status(201).json(document);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // =====================================
  // PUBLIC - INVITATION ACCEPTANCE
  // =====================================
  
  // Verify invitation token (public endpoint)
  app.get("/api/invitations/verify/:token", async (req: Request, res: Response) => {
    try {
      const { token } = req.params;
      const invitation = await storage.getInvitationByToken(token);
      
      if (!invitation) {
        return res.status(404).json({ message: "Invitation not found" });
      }
      
      if (invitation.status !== 'pending') {
        return res.status(400).json({ message: `Invitation has been ${invitation.status}` });
      }
      
      if (new Date() > invitation.expiresAt) {
        return res.status(400).json({ message: "Invitation has expired" });
      }
      
      // Get company details if associated
      let company = null;
      if (invitation.companyId) {
        company = await storage.getCompany(invitation.companyId);
      }
      
      res.json({
        email: invitation.email,
        role: invitation.role,
        userType: invitation.userType,
        company: company ? { id: company.id, name: company.name } : null,
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Accept invitation and create account (public endpoint)
  app.post("/api/invitations/accept/:token", async (req: Request, res: Response) => {
    try {
      const { token } = req.params;
      const { name, password } = req.body;
      
      const invitation = await storage.getInvitationByToken(token);
      
      if (!invitation) {
        return res.status(404).json({ message: "Invitation not found" });
      }
      
      if (invitation.status !== 'pending') {
        return res.status(400).json({ message: `Invitation has been ${invitation.status}` });
      }
      
      if (new Date() > invitation.expiresAt) {
        return res.status(400).json({ message: "Invitation has expired" });
      }
      
      // Check if user already exists
      const existingUser = await storage.getUserByEmail(invitation.email);
      if (existingUser) {
        return res.status(400).json({ message: "User already exists with this email" });
      }
      
      // Create user with appropriate userType from invitation
      const passwordHash = await bcrypt.hash(password, 10);
      const user = await storage.createUser({
        email: invitation.email,
        name,
        password,
        isAdmin: invitation.role === 'staff' || invitation.userType === 'admin',
        userType: invitation.userType || 'client',
        passwordHash,
      } as any);
      
      // If company associated, add user to company and set company type
      if (invitation.companyId) {
        await storage.createCompanyUser({
          companyId: invitation.companyId,
          userId: user.id,
          role: 'owner', // Client users are owners of their company view
        });
        
        // Set company type based on user type (client companies are managed by NR)
        if (invitation.userType === 'client') {
          await storage.updateCompany(invitation.companyId, {
            companyType: 'client',
          });
        }
      }
      
      // Mark invitation as accepted
      await storage.updateInvitation(invitation.id, {
        status: 'accepted',
        acceptedAt: new Date(),
      });
      
      // Log activity
      await storage.createActivityLog({
        userId: user.id,
        companyId: invitation.companyId || null,
        action: 'create',
        entityType: 'user',
        entityId: user.id,
        description: `User registered via invitation: ${user.email}`,
      });
      
      // Generate token for immediate login
      const isAdminBoolean = user.isAdmin === true;
      const jwtToken = jwt.sign(
        { 
          userId: user.id, 
          email: user.email,
          isAdmin: isAdminBoolean,
          userType: user.userType || invitation.userType || 'client'
        },
        JWT_SECRET,
        { expiresIn: JWT_EXPIRES_IN }
      );
      
      const { passwordHash: _, ...safeUser } = user;
      res.json({ user: safeUser, token: jwtToken });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // =====================================
  // ADMIN PANEL - AI SETTINGS
  // =====================================
  
  // Get AI settings - Admin only
  app.get("/api/admin/settings", adminMiddleware, async (req: Request, res: Response) => {
    try {
      // Return current AI configuration
      res.json({
        aiEnabled: !!process.env.OPENAI_API_KEY,
        categorization: {
          enabled: true,
          model: AI_MODEL,
        },
        anomalyDetection: {
          enabled: true,
          sensitivity: 'medium',
        },
        newsAutoFetch: {
          enabled: true,
          intervalMinutes: 30,
        },
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}
