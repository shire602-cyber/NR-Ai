import { type Express, type Request, type Response } from "express";
import { parsedBody } from "../http/parsed-body";
import { strictBody } from "../http/strict-body";
import {
  sheetsCustomExportBody,
  sheetsExportBody,
  sheetsImportBody,
} from "../../shared/validators/route-bodies";
import { parseIsoDate } from "../../shared/validators/primitives";
import { db } from "../db";
import { ValidationError } from "../errors";
import { storage } from "../storage";
import * as googleSheets from "../integrations/googleSheets";
import type { LedgerTx } from "../ledger/types";
import { authMiddleware, requireCompanyAccess, requireCustomer } from "../middleware/auth";
import { asyncHandler } from "../middleware/errorHandler";
import { insertWaitlistSchema } from "../../shared/schema";
import { createLogger } from "../config/logger";
import { getCapability } from "../../shared/capabilities";
import { connectorStatuses } from "../services/connectors/oauth";
import { assertPeriodNotLocked, lockPeriodPolicy } from "../services/period-lock.service";

const log = createLogger("integrations");

type SheetImportKind = "invoices" | "expenses";

function sheetImportDate(value: string, kind: SheetImportKind): string {
  const input = value.trim();
  const slashDate = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(input);
  let candidate = input;
  if (slashDate) {
    const [, first, second, year] = slashDate;
    // The invoice importer historically used US slash dates; expenses used day first.
    const [month, day] = kind === "invoices" ? [first, second] : [second, first];
    const fullYear = year.length === 4 ? year : `${Number(year) < 50 ? "20" : "19"}${year}`;
    candidate = `${fullYear}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }
  const date = parseIsoDate(candidate);
  if (!date) throw new ValidationError("Spreadsheet rows must have valid calendar dates.");
  return date;
}

async function saveSheetImport<Row>(
  input: {
    companyId: string;
    sheetUrl: string;
    dataType: SheetImportKind;
    rows: Row[];
    dateOf: (row: Row) => string;
  },
  create: (row: Row, date: Date, tx: LedgerTx) => Promise<unknown>
): Promise<number> {
  const { companyId, sheetUrl, dataType, rows, dateOf } = input;
  return db.transaction(async (tx) => {
    await lockPeriodPolicy(tx, companyId, "shared");
    const prepared = rows.map((row) => ({ row, date: sheetImportDate(dateOf(row), dataType) }));
    for (const date of new Set(prepared.map((entry) => entry.date))) {
      await assertPeriodNotLocked(companyId, date, tx);
    }

    let createdCount = 0;
    for (const { row, date } of prepared) {
      try {
        // Keep the import's row-level failure handling without aborting the outer transaction.
        await tx.transaction((rowTx) => create(row, new Date(date), rowTx));
        createdCount++;
      } catch {
        log.warn({ dataType }, "Could not save spreadsheet import row");
      }
    }

    await storage.createIntegrationSync(
      {
        companyId,
        integrationType: "google_sheets",
        syncType: "import",
        dataType,
        status: "completed",
        recordCount: createdCount,
        externalUrl: sheetUrl,
      },
      tx
    );
    return createdCount;
  });
}

export function registerIntegrationRoutes(app: Express) {
  // =====================================
  // Waitlist Routes (Public)
  // =====================================

  app.post(
    "/api/waitlist",
    asyncHandler(async (req: Request, res: Response) => {
      const validated = insertWaitlistSchema.parse(req.body);

      // Check if email already exists
      const existing = await storage.getWaitlistByEmail(validated.email);
      if (existing) {
        return res.status(400).json({
          code: "WAITLIST_EMAIL_EXISTS",
          message: "Email already registered for waitlist",
        });
      }

      const entry = await storage.createWaitlistEntry(validated);

      res.json({
        message: "Successfully added to waitlist!",
        email: entry.email,
      });
    })
  );

  // =====================================
  // Integration Routes
  // =====================================

  // Get integration status (R19-09): only integrations with code behind them, each with an
  // honest status. Accounting / POS connectors report `requires_external` until their
  // provider app is registered; their data comes in through the CSV migration import.
  app.get(
    "/api/integrations/status",
    authMiddleware,
    asyncHandler(async (_req: Request, res: Response) => {
      const googleSheetsConnected = await googleSheets.isGoogleSheetsConnected();
      res.json({
        googleSheets: {
          connected: googleSheetsConnected,
          name: "Google Sheets",
          description: "Export financial data to spreadsheets",
        },
        ecommerce: (["shopify", "stripe_payouts"] as const).map((id) => {
          const cap = getCapability(id);
          return {
            id,
            label: cap.label,
            // Per-merchant credentials: the platform app registration is optional.
            status: "available_with_merchant_credentials",
            platformCapability: cap.status,
          };
        }),
        connectors: connectorStatuses(),
        migrationImport: {
          status: "live",
          sources: ["xero", "quickbooks", "zoho", "wafeq", "generic"],
        },
      });
    })
  );

  // Get sync history
  app.get(
    "/api/integrations/sync-history",
    authMiddleware,
    requireCompanyAccess("query"),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId, integrationType } = req.query;
      if (!companyId) {
        return res
          .status(400)
          .json({ code: "COMPANY_ID_REQUIRED", message: "Company ID required" });
      }

      let syncs;
      if (integrationType) {
        syncs = await storage.getIntegrationSyncsByType(
          companyId as string,
          integrationType as string
        );
      } else {
        syncs = await storage.getIntegrationSyncsByCompanyId(companyId as string);
      }

      res.json(syncs);
    })
  );

  // List available Google Sheets spreadsheets
  app.get(
    "/api/integrations/google-sheets/spreadsheets",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const isConnected = await googleSheets.isGoogleSheetsConnected();
      if (!isConnected) {
        return res
          .status(400)
          .json({ code: "GOOGLE_SHEETS_NOT_CONNECTED", message: "Google Sheets not connected" });
      }

      const spreadsheets = await googleSheets.listSpreadsheets();
      res.json(spreadsheets);
    })
  );

  // Export invoices to Google Sheets
  // Customer-only: Export invoices to Google Sheets
  app.post(
    "/api/integrations/google-sheets/export/invoices",
    authMiddleware,
    requireCustomer,
    requireCompanyAccess("body"),
    strictBody(sheetsExportBody, { allowServerOwned: ["companyId"] }),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId, spreadsheetId } = parsedBody<{
        companyId: string;
        spreadsheetId?: string;
      }>(req);
      if (!companyId) {
        return res
          .status(400)
          .json({ code: "COMPANY_ID_REQUIRED", message: "Company ID required" });
      }

      const isConnected = await googleSheets.isGoogleSheetsConnected();
      if (!isConnected) {
        return res
          .status(400)
          .json({ code: "GOOGLE_SHEETS_NOT_CONNECTED", message: "Google Sheets not connected" });
      }

      // Fetch invoices
      const invoices = await storage.getInvoicesByCompanyId(companyId);

      // Export to sheet
      const result = await googleSheets.exportInvoicesToSheet(invoices, spreadsheetId);

      // Log the sync
      await storage.createIntegrationSync({
        companyId,
        integrationType: "google_sheets",
        syncType: "export",
        dataType: "invoices",
        status: "completed",
        recordCount: invoices.length,
        externalId: result.spreadsheetId,
        externalUrl: result.url,
      });

      res.json({
        message: "Invoices exported successfully",
        ...result,
        recordCount: invoices.length,
      });
    })
  );

  // Export expenses to Google Sheets
  // Customer-only: Export expenses to Google Sheets
  app.post(
    "/api/integrations/google-sheets/export/expenses",
    authMiddleware,
    requireCustomer,
    requireCompanyAccess("body"),
    strictBody(sheetsExportBody, { allowServerOwned: ["companyId"] }),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId, spreadsheetId } = parsedBody<{
        companyId: string;
        spreadsheetId?: string;
      }>(req);
      if (!companyId) {
        return res
          .status(400)
          .json({ code: "COMPANY_ID_REQUIRED", message: "Company ID required" });
      }

      const isConnected = await googleSheets.isGoogleSheetsConnected();
      if (!isConnected) {
        return res
          .status(400)
          .json({ code: "GOOGLE_SHEETS_NOT_CONNECTED", message: "Google Sheets not connected" });
      }

      // Fetch receipts/expenses
      const expenses = await storage.getReceiptsByCompanyId(companyId);

      // Export to sheet
      const result = await googleSheets.exportExpensesToSheet(expenses, spreadsheetId);

      // Log the sync
      await storage.createIntegrationSync({
        companyId,
        integrationType: "google_sheets",
        syncType: "export",
        dataType: "expenses",
        status: "completed",
        recordCount: expenses.length,
        externalId: result.spreadsheetId,
        externalUrl: result.url,
      });

      res.json({
        message: "Expenses exported successfully",
        ...result,
        recordCount: expenses.length,
      });
    })
  );

  // Export journal entries to Google Sheets
  // Customer-only: Export journal entries to Google Sheets
  app.post(
    "/api/integrations/google-sheets/export/journal-entries",
    authMiddleware,
    requireCustomer,
    requireCompanyAccess("body"),
    strictBody(sheetsExportBody, { allowServerOwned: ["companyId"] }),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId, spreadsheetId } = parsedBody<{
        companyId: string;
        spreadsheetId?: string;
      }>(req);
      if (!companyId) {
        return res
          .status(400)
          .json({ code: "COMPANY_ID_REQUIRED", message: "Company ID required" });
      }

      const isConnected = await googleSheets.isGoogleSheetsConnected();
      if (!isConnected) {
        return res
          .status(400)
          .json({ code: "GOOGLE_SHEETS_NOT_CONNECTED", message: "Google Sheets not connected" });
      }

      // Fetch journal entries with lines — single batched join instead of one
      // round-trip per entry.
      const [entries, accounts] = await Promise.all([
        storage.getJournalEntriesByCompanyId(companyId),
        storage.getAccountsByCompanyId(companyId),
      ]);
      const allLines = await storage.getJournalLinesByEntryIds(entries.map((e) => e.id));
      const accountById = new Map(accounts.map((a) => [a.id, a]));
      const linesByEntryId = new Map<string, typeof allLines>();
      for (const line of allLines) {
        const list = linesByEntryId.get(line.entryId) ?? [];
        list.push(line);
        linesByEntryId.set(line.entryId, list);
      }

      const enrichedEntries = entries.map((entry, index) => ({
        entryNumber: index + 1,
        date: entry.date instanceof Date ? entry.date.toISOString().split("T")[0] : entry.date,
        description: entry.memo || "",
        lines: (linesByEntryId.get(entry.id) ?? []).map((line) => ({
          accountName: accountById.get(line.accountId)?.nameEn || "",
          debit: line.debit,
          credit: line.credit,
        })),
      }));

      // Export to sheet
      const result = await googleSheets.exportJournalEntriesToSheet(enrichedEntries, spreadsheetId);

      // Log the sync
      await storage.createIntegrationSync({
        companyId,
        integrationType: "google_sheets",
        syncType: "export",
        dataType: "journal_entries",
        status: "completed",
        recordCount: entries.length,
        externalId: result.spreadsheetId,
        externalUrl: result.url,
      });

      res.json({
        message: "Journal entries exported successfully",
        ...result,
        recordCount: entries.length,
      });
    })
  );

  // Export chart of accounts to Google Sheets
  // Customer-only: Export chart of accounts to Google Sheets
  app.post(
    "/api/integrations/google-sheets/export/chart-of-accounts",
    authMiddleware,
    requireCustomer,
    requireCompanyAccess("body"),
    strictBody(sheetsExportBody, { allowServerOwned: ["companyId"] }),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId, spreadsheetId } = parsedBody<{
        companyId: string;
        spreadsheetId?: string;
      }>(req);
      if (!companyId) {
        return res
          .status(400)
          .json({ code: "COMPANY_ID_REQUIRED", message: "Company ID required" });
      }

      const isConnected = await googleSheets.isGoogleSheetsConnected();
      if (!isConnected) {
        return res
          .status(400)
          .json({ code: "GOOGLE_SHEETS_NOT_CONNECTED", message: "Google Sheets not connected" });
      }

      // Fetch accounts
      const accounts = await storage.getAccountsByCompanyId(companyId);

      // Export to sheet
      const result = await googleSheets.exportChartOfAccountsToSheet(accounts, spreadsheetId);

      // Log the sync
      await storage.createIntegrationSync({
        companyId,
        integrationType: "google_sheets",
        syncType: "export",
        dataType: "chart_of_accounts",
        status: "completed",
        recordCount: accounts.length,
        externalId: result.spreadsheetId,
        externalUrl: result.url,
      });

      res.json({
        message: "Chart of Accounts exported successfully",
        ...result,
        recordCount: accounts.length,
      });
    })
  );

  // Import invoices from Google Sheets
  app.post(
    "/api/integrations/google-sheets/import/invoices",
    authMiddleware,
    requireCompanyAccess("body"),
    strictBody(sheetsImportBody, { allowServerOwned: ["companyId"] }),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId, sheetUrl } = parsedBody<{ companyId: string; sheetUrl: string }>(req);
      if (!companyId || !sheetUrl) {
        return res
          .status(400)
          .json({ code: "SHEET_URL_REQUIRED", message: "Company ID and sheet URL required" });
      }

      const isConnected = await googleSheets.isGoogleSheetsConnected();
      if (!isConnected) {
        return res
          .status(400)
          .json({ code: "GOOGLE_SHEETS_NOT_CONNECTED", message: "Google Sheets not connected" });
      }

      // Extract spreadsheet ID from URL
      const match = sheetUrl.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
      if (!match) {
        return res
          .status(400)
          .json({ code: "INVALID_SHEETS_URL", message: "Invalid Google Sheets URL" });
      }

      const spreadsheetId = match[1];

      // Import invoices from sheet
      const invoices = await googleSheets.importInvoicesFromSheet(spreadsheetId);

      const createdCount = await saveSheetImport(
        {
          companyId,
          sheetUrl,
          dataType: "invoices",
          rows: invoices,
          dateOf: (row) => row.issueDate,
        },
        (invoiceData, date, tx) =>
          storage.createInvoice(
            {
              companyId,
              number: invoiceData.invoiceNumber,
              customerName: invoiceData.customerName,
              customerTrn: invoiceData.customerTrn,
              date,
              subtotal: invoiceData.subtotal,
              vatAmount: invoiceData.vatAmount,
              total: invoiceData.total,
              status: invoiceData.status || "draft",
            },
            tx
          )
      );

      res.json({
        message: "Invoices imported successfully",
        recordCount: createdCount,
      });
    })
  );

  // Import expenses from Google Sheets
  app.post(
    "/api/integrations/google-sheets/import/expenses",
    authMiddleware,
    requireCompanyAccess("body"),
    strictBody(sheetsImportBody, { allowServerOwned: ["companyId"] }),
    asyncHandler(async (req: Request, res: Response) => {
      const userId = req.user?.id;
      const { companyId, sheetUrl } = parsedBody<{ companyId: string; sheetUrl: string }>(req);
      if (!companyId || !sheetUrl || !userId) {
        return res.status(400).json({
          code: "SHEET_URL_REQUIRED",
          message: "Company ID, sheet URL, and user authentication required",
        });
      }

      const isConnected = await googleSheets.isGoogleSheetsConnected();
      if (!isConnected) {
        return res
          .status(400)
          .json({ code: "GOOGLE_SHEETS_NOT_CONNECTED", message: "Google Sheets not connected" });
      }

      // Extract spreadsheet ID from URL
      const match = sheetUrl.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
      if (!match) {
        return res
          .status(400)
          .json({ code: "INVALID_SHEETS_URL", message: "Invalid Google Sheets URL" });
      }

      const spreadsheetId = match[1];

      // Import expenses from sheet
      const expenses = await googleSheets.importExpensesFromSheet(spreadsheetId);

      const createdCount = await saveSheetImport(
        { companyId, sheetUrl, dataType: "expenses", rows: expenses, dateOf: (row) => row.date },
        (expenseData, date, tx) =>
          storage.createReceipt(
            {
              companyId,
              date,
              merchant: expenseData.merchant,
              category: expenseData.category,
              amount: expenseData.amount,
              vatAmount: expenseData.vatAmount,
              uploadedBy: userId,
              posted: false,
              currency: "AED",
            },
            tx
          )
      );

      res.json({
        message: "Expenses imported successfully",
        recordCount: createdCount,
      });
    })
  );

  // Custom export to Google Sheets (for filtered/custom data from frontend)
  // Customer-only: Custom export to Google Sheets
  app.post(
    "/api/integrations/google-sheets/export/custom",
    authMiddleware,
    requireCustomer,
    requireCompanyAccess("body"),
    strictBody(sheetsCustomExportBody, { allowServerOwned: ["companyId"] }),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId, title, sheets } = parsedBody<{
        companyId: string;
        title: string;
        sheets: Array<{ name: string; headers: string[]; rows: (string | number | null)[][] }>;
      }>(req);
      if (!companyId || !title || !sheets) {
        return res.status(400).json({
          code: "SHEETS_EXPORT_INPUT_REQUIRED",
          message: "Company ID, title, and sheets data required",
        });
      }

      const isConnected = await googleSheets.isGoogleSheetsConnected();
      if (!isConnected) {
        return res
          .status(400)
          .json({ code: "GOOGLE_SHEETS_NOT_CONNECTED", message: "Google Sheets not connected" });
      }

      // Export custom data to sheet
      const result = await googleSheets.exportCustomDataToSheet(title, sheets);

      // Log the sync
      await storage.createIntegrationSync({
        companyId,
        integrationType: "google_sheets",
        syncType: "export",
        dataType: "custom",
        status: "completed",
        recordCount: sheets.reduce(
          (total: number, sheet: { rows?: unknown[] }) => total + (sheet.rows?.length || 0),
          0
        ),
        externalId: result.spreadsheetId,
        externalUrl: result.url,
      });

      res.json({
        message: "Data exported successfully",
        ...result,
      });
    })
  );
}
