import type { Express, Request, Response } from "express";
import { eq } from "drizzle-orm";
import { storage } from "../storage";
import { authMiddleware, requireCustomer } from "../middleware/auth";
import { asyncHandler } from "../middleware/errorHandler";
import {
  insertCompanySchema,
  companyPreferencesSchema,
  bankAccounts as bankAccountsTable,
  bankTransactions as bankTransactionsTable,
  customerContacts as customerContactsTable,
  invoiceLines as invoiceLinesTable,
  invoices as invoicesTable,
  journalEntries as journalEntriesTable,
  journalLines as journalLinesTable,
  receipts as receiptsTable,
  type Account,
} from "../../shared/schema";
import { ZodError } from "zod";
import { createDefaultAccountsForCompany } from "../defaultChartOfAccounts";
import { createLogger } from '../config/logger';
import { db } from "../db";
import { ACCOUNT_CODES } from "../constants";
import { allocateInvoiceNumber } from "../services/invoice-numbering.service";
import {
  demoDataBlockedMessage,
  hasTransactionalActivity,
  type DemoActivityCounts,
} from "../services/demo-workspace.service";

const log = createLogger('companies');

/**
 * Translate a Postgres-driver error from a companies write into an HTTP
 * response. Returns true (and writes the response) when the error matches a
 * known SQLSTATE; returns false to let the caller re-throw for the global
 * handler to render a generic 500.
 *
 * Why this is its own helper: the onboarding wizard's "Save & Continue"
 * surfaces whatever the API returns. A bare 500 with "Internal Server Error"
 * leaves the user stuck with no actionable message and leaves us with no
 * structured log either. We catch the common write-time failures
 * (unique violation, NOT NULL violation, CHECK violation, value too long,
 * invalid input syntax for type) and surface them as 4xx with a hint about
 * which field the user needs to change. Schema drift (column does not exist)
 * is logged as a 5xx with explicit context so it lands in alerts and we can
 * tell it apart from a generic crash.
 */
export function handleCompanyWriteError(
  err: any,
  ctx: { route: string; id?: string; userId?: string },
  res: Response,
): boolean {
  const code: string | undefined = err?.code;

  // Always emit a structured log so production can tell apart 23505 from
  // 42703 from a connection drop. Includes the constraint/column the driver
  // gives us so we don't have to guess from the message text.
  log.warn(
    {
      ...ctx,
      pgCode: code,
      pgConstraint: err?.constraint,
      pgColumn: err?.column,
      pgDetail: err?.detail,
      pgTable: err?.table,
      err: err?.message,
    },
    'Company write failed',
  );

  switch (code) {
    case '23505': // unique_violation
      res.status(409).json({
        message: 'That value is already taken by another tenant. Please pick a different one.',
        field: err?.constraint?.includes('name') ? 'name' : undefined,
      });
      return true;
    case '23502': // not_null_violation
      res.status(400).json({
        message: `Required field is missing: ${err?.column ?? 'unknown'}`,
        field: err?.column,
      });
      return true;
    case '23514': // check_violation
      res.status(400).json({
        message: `Value rejected by validation rule: ${err?.constraint ?? 'check constraint'}`,
      });
      return true;
    case '22001': // string_data_right_truncation (value too long)
      res.status(400).json({
        message: 'One of the values you entered is too long for this field.',
      });
      return true;
    case '22P02': // invalid_text_representation (e.g. bad uuid)
      res.status(400).json({
        message: 'One of the values you entered is not valid for this field.',
      });
      return true;
    case '42703': // undefined_column — schema/DB drift
    case '42P01': // undefined_table
      // The schema-guard in server/db.ts is meant to prevent this; if we
      // still hit it in production we want it to land loudly in alerts so
      // we can add the missing column there.
      log.error(
        { ...ctx, pgCode: code, err: err?.message },
        'Schema drift: companies write referenced a missing column/table',
      );
      return false;
    default:
      return false;
  }
}

/**
 * Seed Chart of Accounts for a company using the default UAE chart.
 */
async function seedChartOfAccounts(companyId: string): Promise<{ created: number; alreadyExisted: boolean }> {
  // Check if company already has accounts
  const hasAccounts = await storage.companyHasAccounts(companyId);
  if (hasAccounts) {
    log.info({ companyId }, 'Company already has accounts, skipping seed');
    return { created: 0, alreadyExisted: true };
  }

  // Create all default accounts for this company
  const defaultAccounts = createDefaultAccountsForCompany(companyId);

  try {
    const createdAccounts = await storage.createBulkAccounts(defaultAccounts as any);
    log.info({ companyId, count: createdAccounts.length }, 'Created chart of accounts');
    return { created: createdAccounts.length, alreadyExisted: false };
  } catch (error: any) {
    if (error.message?.includes('PARTIAL_INSERT')) {
      log.error({ companyId, err: error.message }, 'Partial insert detected during COA seed');
      throw new Error('PARTIAL_CHART: Chart of Accounts partially created due to race condition. Please contact support.');
    }
    throw error;
  }
}

function demoDate(daysFromToday: number): Date {
  const date = new Date();
  date.setUTCHours(12, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() + daysFromToday);
  return date;
}

function money(value: number): number {
  return Math.round(value * 100) / 100;
}

function requireDemoAccounts(accounts: Account[]): {
  bank: Account;
  ar: Account;
  inputVat: Account;
  outputVat: Account;
  capital: Account;
  revenue: Account;
  officeSupplies: Account;
} {
  const byCode = new Map(accounts.map((account) => [account.code, account]));
  const required = {
    bank: byCode.get("1020"),
    ar: byCode.get(ACCOUNT_CODES.AR),
    inputVat: byCode.get("1050"),
    outputVat: byCode.get(ACCOUNT_CODES.VAT_OUTPUT),
    capital: byCode.get("3010"),
    revenue: byCode.get(ACCOUNT_CODES.REVENUE) ?? byCode.get(ACCOUNT_CODES.REVENUE_ALT),
    officeSupplies: byCode.get("5050"),
  };

  const missing = Object.entries(required)
    .filter(([, account]) => !account)
    .map(([key]) => key);
  if (missing.length > 0) {
    throw Object.assign(new Error(`Demo seed missing required accounts: ${missing.join(", ")}`), {
      status: 500,
    });
  }

  return required as {
    bank: Account;
    ar: Account;
    inputVat: Account;
    outputVat: Account;
    capital: Account;
    revenue: Account;
    officeSupplies: Account;
  };
}

export function registerCompanyRoutes(app: Express) {
  // =====================================
  // Company Routes
  // =====================================

  app.get("/api/companies", authMiddleware, asyncHandler(async (req: Request, res: Response) => {
    const { id: userId, firmRole } = (req as any).user;
    const companies = await storage.getAccessibleCompanies(userId, firmRole);
    res.json(companies);
  }));

  app.post("/api/companies", authMiddleware, asyncHandler(async (req: Request, res: Response) => {
    const userId = (req as any).user.id;
    const validated = insertCompanySchema.parse(req.body);

    // Check if company name exists
    const existing = await storage.getCompanyByName(validated.name);
    if (existing) {
      return res.status(400).json({ message: 'Company name already exists' });
    }

    let company;
    try {
      company = await storage.createCompany(validated);
    } catch (err: any) {
      if (handleCompanyWriteError(err, { route: 'POST /api/companies', userId }, res)) {
        return;
      }
      throw err;
    }

    // Associate user with company as owner
    await storage.createCompanyUser({
      companyId: company.id,
      userId,
      role: 'owner',
    });

    // Seed Chart of Accounts
    await seedChartOfAccounts(company.id);

    res.json(company);
  }));

  app.get("/api/companies/:id", authMiddleware, asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const { id: userId, firmRole } = (req as any).user;

    // Check if user has access to this company (or via firm role)
    const hasAccess = await storage.hasCompanyAccess(userId, id, firmRole);
    if (!hasAccess) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const company = await storage.getCompany(id);
    if (!company) {
      return res.status(404).json({ message: 'Company not found' });
    }

    res.json(company);
  }));

  // PUT is an alias for PATCH — some clients send PUT for full updates
  app.put("/api/companies/:id", authMiddleware, asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const { id: userId, firmRole } = (req as any).user;

    const hasAccess = await storage.hasCompanyAccess(userId, id, firmRole);
    if (!hasAccess) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const updateData = { ...req.body };
    if (updateData.taxRegistrationDate) {
      if (typeof updateData.taxRegistrationDate === 'string') {
        updateData.taxRegistrationDate = new Date(updateData.taxRegistrationDate);
      } else if (!(updateData.taxRegistrationDate instanceof Date)) {
        updateData.taxRegistrationDate = new Date(updateData.taxRegistrationDate);
      }
    } else {
      delete updateData.taxRegistrationDate;
    }

    try {
      const company = await storage.updateCompany(id, updateData);
      res.json(company);
    } catch (err: any) {
      if (handleCompanyWriteError(err, { route: 'PUT /api/companies/:id', id, userId }, res)) {
        return;
      }
      throw err;
    }
  }));

  app.patch("/api/companies/:id", authMiddleware, asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const { id: userId, firmRole } = (req as any).user;

    // Check if user has access to this company (or via firm role)
    const hasAccess = await storage.hasCompanyAccess(userId, id, firmRole);
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

    try {
      const company = await storage.updateCompany(id, updateData);
      log.info({ id: company.id }, 'Company profile updated');
      res.json(company);
    } catch (err: any) {
      if (handleCompanyWriteError(err, { route: 'PATCH /api/companies/:id', id, userId }, res)) {
        return;
      }
      throw err;
    }
  }));

  // QuickBooks-style company preferences page — strictly validated PATCH.
  // Kept separate from PATCH /api/companies/:id so other callers that send
  // unrelated fields (e.g. tax registration date, company type) keep working.
  app.patch("/api/companies/:id/preferences", authMiddleware, asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const userId = (req as any).user.id;

    const hasAccess = await storage.hasCompanyAccess(userId, id);
    if (!hasAccess) {
      return res.status(403).json({ message: 'Access denied' });
    }

    let validated;
    try {
      validated = companyPreferencesSchema.parse(req.body);
    } catch (err) {
      if (err instanceof ZodError) {
        return res.status(400).json({
          message: 'Invalid company preferences',
          errors: err.flatten().fieldErrors,
        });
      }
      throw err;
    }

    // Strip undefined keys so we never overwrite existing values with NULL
    const updateData: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(validated)) {
      if (value !== undefined) updateData[key] = value;
    }

    const company = await storage.updateCompany(id, updateData as any);
    log.info({ id: company.id }, 'Company preferences updated');
    res.json(company);
  }));

  // Seed a buyer-friendly demo workspace for first-time SaaS onboarding.
  // Guarded so sample data cannot be mixed into books that already have real
  // transactional activity.
  app.post("/api/companies/:id/onboarding/demo-data", authMiddleware, requireCustomer, asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const userId = (req as any).user.id;

    const hasAccess = await storage.hasCompanyAccess(userId, id);
    if (!hasAccess) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const company = await storage.getCompany(id);
    if (!company) {
      return res.status(404).json({ message: 'Company not found' });
    }

    const [existingInvoices, existingReceipts, existingJournalEntries, existingBankTransactions] =
      await Promise.all([
        storage.getInvoicesByCompanyId(id),
        storage.getReceiptsByCompanyId(id),
        storage.getJournalEntriesByCompanyId(id),
        storage.getBankTransactionsByCompanyId(id),
      ]);
    const activityCounts: DemoActivityCounts = {
      invoices: existingInvoices.length,
      receipts: existingReceipts.length,
      journalEntries: existingJournalEntries.length,
      bankTransactions: existingBankTransactions.length,
    };

    if (hasTransactionalActivity(activityCounts)) {
      return res.status(409).json({
        message: demoDataBlockedMessage(activityCounts),
        counts: activityCounts,
      });
    }

    await seedChartOfAccounts(id);
    const accounts = await storage.getAccountsByCompanyId(id);
    const demoAccounts = requireDemoAccounts(accounts);
    const existingBankAccounts = await storage.getBankAccountsByCompanyId(id);

    const openingDate = demoDate(-30);
    const invoiceDate = demoDate(-18);
    const receiptDate = demoDate(-12);
    const paymentDate = demoDate(-7);
    const bankFeeDate = demoDate(-4);
    const dueDate = demoDate(12);

    const invoiceSubtotal = 8000;
    const invoiceVat = money(invoiceSubtotal * 0.05);
    const invoiceTotal = money(invoiceSubtotal + invoiceVat);
    const expenseSubtotal = 750;
    const expenseVat = money(expenseSubtotal * 0.05);
    const expenseTotal = money(expenseSubtotal + expenseVat);

    const openingEntryNumber = await storage.generateEntryNumber(id, openingDate);
    const invoiceEntryNumber = await storage.generateEntryNumber(id, invoiceDate);
    const receiptEntryNumber = await storage.generateEntryNumber(id, receiptDate);

    const seeded = await db.transaction(async (tx: typeof db) => {
      const [customer] = await tx.insert(customerContactsTable).values({
        companyId: id,
        name: "Banyan Cafe LLC",
        email: "accounts@banyancafe.example",
        phone: "+971 4 555 0190",
        trnNumber: "100234567800003",
        address: "Al Quoz, Dubai, UAE",
        city: "Dubai",
        country: "UAE",
        paymentTerms: 30,
        isActive: true,
      }).returning();

      const [vendor] = await tx.insert(customerContactsTable).values({
        companyId: id,
        name: "Palm Office Supplies LLC",
        email: "billing@palmoffice.example",
        phone: "+971 4 555 0144",
        trnNumber: "100345678900003",
        address: "Deira, Dubai, UAE",
        city: "Dubai",
        country: "UAE",
        paymentTerms: 15,
        notes: "Demo supplier contact",
        isActive: true,
      }).returning();

      const bankAccount = existingBankAccounts[0] ?? (await tx.insert(bankAccountsTable).values({
        companyId: id,
        nameEn: "Demo Trading Main AED",
        bankName: "Emirates NBD",
        accountNumber: "001234567890",
        iban: "AE070331234567890123456",
        currency: "AED",
        glAccountId: demoAccounts.bank.id,
        isActive: true,
      }).returning())[0];

      const invoiceNumber = await allocateInvoiceNumber(id, "invoice", invoiceDate, tx);
      const [invoice] = await tx.insert(invoicesTable).values({
        companyId: id,
        number: invoiceNumber,
        customerName: customer.name,
        customerTrn: customer.trnNumber,
        customerAddress: customer.address,
        date: invoiceDate,
        dueDate,
        paymentTerms: "net30",
        currency: "AED",
        exchangeRate: 1,
        baseCurrencyAmount: invoiceTotal,
        subtotal: invoiceSubtotal,
        vatAmount: invoiceVat,
        total: invoiceTotal,
        status: "sent",
        invoiceType: "invoice",
        reverseCharge: false,
        contactId: customer.id,
      }).returning();

      await tx.insert(invoiceLinesTable).values({
        invoiceId: invoice.id,
        description: "Monthly bookkeeping and VAT review package",
        quantity: 1,
        unitPrice: invoiceSubtotal,
        vatRate: 0.05,
        vatSupplyType: "standard_rated",
      });

      const [openingEntry] = await tx.insert(journalEntriesTable).values({
        companyId: id,
        entryNumber: openingEntryNumber,
        date: openingDate,
        memo: "Demo opening owner funding",
        status: "posted",
        source: "system",
        createdBy: userId,
        postedBy: userId,
        postedAt: openingDate,
      }).returning();

      await tx.insert(journalLinesTable).values([
        {
          entryId: openingEntry.id,
          accountId: demoAccounts.bank.id,
          debit: 20000,
          credit: 0,
          description: "Demo owner funding deposited to bank",
        },
        {
          entryId: openingEntry.id,
          accountId: demoAccounts.capital.id,
          debit: 0,
          credit: 20000,
          description: "Demo owner capital",
        },
      ]);

      const [invoiceEntry] = await tx.insert(journalEntriesTable).values({
        companyId: id,
        entryNumber: invoiceEntryNumber,
        date: invoiceDate,
        memo: `Sales Invoice ${invoice.number} - ${invoice.customerName}`,
        status: "posted",
        source: "invoice",
        sourceId: invoice.id,
        createdBy: userId,
        postedBy: userId,
        postedAt: invoiceDate,
      }).returning();

      await tx.insert(journalLinesTable).values([
        {
          entryId: invoiceEntry.id,
          accountId: demoAccounts.ar.id,
          debit: invoiceTotal,
          credit: 0,
          description: `Invoice ${invoice.number} - ${invoice.customerName}`,
        },
        {
          entryId: invoiceEntry.id,
          accountId: demoAccounts.revenue.id,
          debit: 0,
          credit: invoiceSubtotal,
          description: `Sales revenue - Invoice ${invoice.number}`,
        },
        {
          entryId: invoiceEntry.id,
          accountId: demoAccounts.outputVat.id,
          debit: 0,
          credit: invoiceVat,
          description: `VAT output - Invoice ${invoice.number}`,
        },
      ]);

      const [receipt] = await tx.insert(receiptsTable).values({
        companyId: id,
        merchant: vendor.name,
        date: receiptDate,
        amount: expenseSubtotal,
        vatAmount: expenseVat,
        currency: "AED",
        exchangeRate: 1,
        baseCurrencyAmount: expenseSubtotal,
        category: "Office Supplies",
        accountId: demoAccounts.officeSupplies.id,
        paymentAccountId: demoAccounts.bank.id,
        posted: true,
        autoPosted: false,
        reverseCharge: false,
        rawText: "Demo receipt for onboarding sample data",
        uploadedBy: userId,
      }).returning();

      const [receiptEntry] = await tx.insert(journalEntriesTable).values({
        companyId: id,
        entryNumber: receiptEntryNumber,
        date: receiptDate,
        memo: `Expense Receipt - ${receipt.merchant}`,
        status: "posted",
        source: "receipt",
        sourceId: receipt.id,
        createdBy: userId,
        postedBy: userId,
        postedAt: receiptDate,
      }).returning();

      await tx.insert(journalLinesTable).values([
        {
          entryId: receiptEntry.id,
          accountId: demoAccounts.officeSupplies.id,
          debit: expenseSubtotal,
          credit: 0,
          description: `Expense - ${receipt.merchant}`,
        },
        {
          entryId: receiptEntry.id,
          accountId: demoAccounts.inputVat.id,
          debit: expenseVat,
          credit: 0,
          description: `Input VAT - ${receipt.merchant}`,
        },
        {
          entryId: receiptEntry.id,
          accountId: demoAccounts.bank.id,
          debit: 0,
          credit: expenseTotal,
          description: `Paid expense - ${receipt.merchant}`,
        },
      ]);

      await tx
        .update(receiptsTable)
        .set({ journalEntryId: receiptEntry.id })
        .where(eq(receiptsTable.id, receipt.id));

      const bankTransactions = await tx.insert(bankTransactionsTable).values([
        {
          companyId: id,
          bankAccountId: demoAccounts.bank.id,
          bankStatementAccountId: bankAccount.id,
          transactionDate: openingDate,
          description: "Owner funding transfer",
          amount: 20000,
          balance: 20000,
          reference: "DEMO-CAPITAL",
          matchStatus: "unmatched",
          isReconciled: false,
          importSource: "demo",
        },
        {
          companyId: id,
          bankAccountId: demoAccounts.bank.id,
          bankStatementAccountId: bankAccount.id,
          transactionDate: paymentDate,
          description: `Customer payment - ${invoice.number}`,
          amount: invoiceTotal,
          balance: 28400,
          reference: "DEMO-CUST-PAY",
          matchStatus: "suggested",
          matchedInvoiceId: invoice.id,
          matchConfidence: 0.94,
          isReconciled: false,
          importSource: "demo",
        },
        {
          companyId: id,
          bankAccountId: demoAccounts.bank.id,
          bankStatementAccountId: bankAccount.id,
          transactionDate: receiptDate,
          description: `Supplier payment - ${receipt.merchant}`,
          amount: -expenseTotal,
          balance: 27612.5,
          reference: "DEMO-SUP-PAY",
          matchStatus: "suggested",
          matchedReceiptId: receipt.id,
          matchConfidence: 0.91,
          isReconciled: false,
          importSource: "demo",
        },
        {
          companyId: id,
          bankAccountId: demoAccounts.bank.id,
          bankStatementAccountId: bankAccount.id,
          transactionDate: bankFeeDate,
          description: "Monthly bank charges",
          amount: -25,
          balance: 27587.5,
          reference: "DEMO-BANK-FEE",
          matchStatus: "unmatched",
          isReconciled: false,
          importSource: "demo",
        },
      ]).returning();

      return {
        contacts: 2,
        bankAccounts: existingBankAccounts.length > 0 ? 0 : 1,
        invoices: 1,
        invoiceLines: 1,
        receipts: 1,
        journalEntries: 3,
        bankTransactions: bankTransactions.length,
        bankAccountId: bankAccount.id,
      };
    });

    log.info({ companyId: id, userId, seeded }, 'Demo onboarding workspace seeded');
    res.status(201).json({
      message: 'Demo workspace created with sample invoices, receipts, journals, and bank statement lines.',
      created: seeded,
    });
  }));

  // Mark company onboarding as complete
  app.post("/api/companies/:id/onboarding/complete", authMiddleware, requireCustomer, asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const userId = (req as any).user.id;

    const hasAccess = await storage.hasCompanyAccess(userId, id);
    if (!hasAccess) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const company = await storage.updateCompany(id, { onboardingCompleted: true });
    res.json(company);
  }));

  // List bank accounts for a company
  app.get("/api/companies/:id/bank-accounts", authMiddleware, requireCustomer, asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const userId = (req as any).user.id;

    const hasAccess = await storage.hasCompanyAccess(userId, id);
    if (!hasAccess) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const accounts = await storage.getBankAccountsByCompanyId(id);
    res.json(accounts);
  }));

  // Create a bank account for a company
  app.post("/api/companies/:id/bank-accounts", authMiddleware, requireCustomer, asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const userId = (req as any).user.id;

    const hasAccess = await storage.hasCompanyAccess(userId, id);
    if (!hasAccess) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const account = await storage.createBankAccount({ ...req.body, companyId: id });
    res.status(201).json(account);
  }));

  // Seed Chart of Accounts for company
  // Customer-only: Seed chart of accounts
  app.post("/api/companies/:id/seed-accounts", authMiddleware, requireCustomer, asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const { id: userId, firmRole } = (req as any).user;

    // Check if user has access to this company (or via firm role)
    const hasAccess = await storage.hasCompanyAccess(userId, id, firmRole);
    if (!hasAccess) {
      return res.status(403).json({ message: 'Access denied' });
    }

    // Seed Chart of Accounts
    const result = await seedChartOfAccounts(id);

    const accountsWithBalances = await storage.getAccountsWithBalances(id);

    if (result.alreadyExisted) {
      return res.status(409).json({
        message: 'Chart of Accounts already exists for this company',
        accounts: accountsWithBalances
      });
    }

    res.status(201).json({
      message: 'Chart of Accounts seeded successfully',
      accountsCreated: result.created,
      accounts: accountsWithBalances
    });
  }));
}
