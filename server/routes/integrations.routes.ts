import { Router, type Express, type Request, type Response } from 'express';
import { storage } from '../storage';
import { z } from 'zod';
import * as googleSheets from '../integrations/googleSheets';
import { authMiddleware, requireCompanyAccess, requireCustomer } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';
import { insertWaitlistSchema } from '../../shared/schema';
import { createLogger } from '../config/logger';

const log = createLogger('integrations');

export function registerIntegrationRoutes(app: Express) {
  // =====================================
  // Waitlist Routes (Public)
  // =====================================

  app.post("/api/waitlist", asyncHandler(async (req: Request, res: Response) => {
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
  }));

  // =====================================
  // Integration Routes
  // =====================================

  // Get integration status
  app.get("/api/integrations/status", authMiddleware, asyncHandler(async (req: Request, res: Response) => {
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
  }));

  // Get sync history
  app.get("/api/integrations/sync-history", authMiddleware, requireCompanyAccess('query'), asyncHandler(async (req: Request, res: Response) => {
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
  }));

  // List available Google Sheets spreadsheets
  app.get("/api/integrations/google-sheets/spreadsheets", authMiddleware, asyncHandler(async (req: Request, res: Response) => {
    const isConnected = await googleSheets.isGoogleSheetsConnected();
    if (!isConnected) {
      return res.status(400).json({ message: 'Google Sheets not connected' });
    }

    const spreadsheets = await googleSheets.listSpreadsheets();
    res.json(spreadsheets);
  }));

  // Export invoices to Google Sheets
  // Customer-only: Export invoices to Google Sheets
  app.post("/api/integrations/google-sheets/export/invoices", authMiddleware, requireCustomer, requireCompanyAccess('body'), asyncHandler(async (req: Request, res: Response) => {
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
  }));

  // Export expenses to Google Sheets
  // Customer-only: Export expenses to Google Sheets
  app.post("/api/integrations/google-sheets/export/expenses", authMiddleware, requireCustomer, requireCompanyAccess('body'), asyncHandler(async (req: Request, res: Response) => {
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
  }));

  // Export journal entries to Google Sheets
  // Customer-only: Export journal entries to Google Sheets
  app.post("/api/integrations/google-sheets/export/journal-entries", authMiddleware, requireCustomer, requireCompanyAccess('body'), asyncHandler(async (req: Request, res: Response) => {
    const { companyId, spreadsheetId } = req.body;
    if (!companyId) {
      return res.status(400).json({ message: 'Company ID required' });
    }

    const isConnected = await googleSheets.isGoogleSheetsConnected();
    if (!isConnected) {
      return res.status(400).json({ message: 'Google Sheets not connected' });
    }

    // Fetch journal entries with lines — single batched join instead of one
    // round-trip per entry.
    const [entries, accounts] = await Promise.all([
      storage.getJournalEntriesByCompanyId(companyId),
      storage.getAccountsByCompanyId(companyId),
    ]);
    const allLines = await storage.getJournalLinesByEntryIds(entries.map(e => e.id));
    const accountById = new Map(accounts.map(a => [a.id, a]));
    const linesByEntryId = new Map<string, typeof allLines>();
    for (const line of allLines) {
      const list = linesByEntryId.get(line.entryId) ?? [];
      list.push(line);
      linesByEntryId.set(line.entryId, list);
    }

    const enrichedEntries = entries.map((entry, index) => ({
      entryNumber: index + 1,
      date: entry.date instanceof Date ? entry.date.toISOString().split('T')[0] : entry.date,
      description: entry.memo || '',
      lines: (linesByEntryId.get(entry.id) ?? []).map(line => ({
        accountName: accountById.get(line.accountId)?.nameEn || '',
        debit: line.debit,
        credit: line.credit,
      })),
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
  }));

  // Export chart of accounts to Google Sheets
  // Customer-only: Export chart of accounts to Google Sheets
  app.post("/api/integrations/google-sheets/export/chart-of-accounts", authMiddleware, requireCustomer, requireCompanyAccess('body'), asyncHandler(async (req: Request, res: Response) => {
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
  }));

  // Import invoices from Google Sheets
  app.post("/api/integrations/google-sheets/import/invoices", authMiddleware, requireCompanyAccess('body'), asyncHandler(async (req: Request, res: Response) => {
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
        log.error({ err }, 'Error creating invoice');
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
  }));

  // Import expenses from Google Sheets
  app.post("/api/integrations/google-sheets/import/expenses", authMiddleware, requireCompanyAccess('body'), asyncHandler(async (req: Request, res: Response) => {
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
        log.error({ err }, 'Error creating expense');
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
  }));

  // Custom export to Google Sheets (for filtered/custom data from frontend)
  // Customer-only: Custom export to Google Sheets
  app.post("/api/integrations/google-sheets/export/custom", authMiddleware, requireCustomer, requireCompanyAccess('body'), asyncHandler(async (req: Request, res: Response) => {
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
  }));
}
