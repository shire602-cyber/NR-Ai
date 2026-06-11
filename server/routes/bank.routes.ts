import type { Express, Request, Response } from "express";
import { authMiddleware, requireCustomer } from "../middleware/auth";
import { asyncHandler } from "../middleware/errorHandler";
import { requireFeature } from "../middleware/featureGate";
import { storage } from "../storage";
import {
  getBankProvider,
  getAvailableProviders,
  isOpenBankingConfigured,
  tokenNeedsRefresh,
} from "../services/open-banking.service";
import { createLogger } from "../config/logger";

const logger = createLogger("bank-routes");

export function registerBankRoutes(app: Express) {
  // =====================================
  // Bank Connection & Import Routes
  // =====================================

  // Customer-only: List bank connections by company
  app.get(
    "/api/companies/:companyId/bank-connections",
    authMiddleware,
    requireCustomer,
    requireFeature("bankImport"),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const userId = (req as any).user.id;

      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: "Access denied" });
      }

      const connections = await storage.getBankConnectionsByCompanyId(companyId);
      res.json(connections);
    })
  );

  // Customer-only: Create bank connection
  app.post(
    "/api/companies/:companyId/bank-connections",
    authMiddleware,
    requireCustomer,
    requireFeature("bankImport"),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const userId = (req as any).user.id;

      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: "Access denied" });
      }

      const connection = await storage.createBankConnection({ ...req.body, companyId });

      logger.info({ connectionId: connection.id, companyId }, "Bank connection created");
      res.status(201).json(connection);
    })
  );

  // Customer-only: Delete bank connection
  app.delete(
    "/api/bank-connections/:id",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { id } = req.params;
      const userId = (req as any).user.id;

      const connection = await storage.getBankConnection(id);
      if (!connection) {
        return res.status(404).json({ message: "Bank connection not found" });
      }

      const hasAccess = await storage.hasCompanyAccess(userId, connection.companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: "Access denied" });
      }

      await storage.deleteBankConnection(id);
      res.json({ message: "Bank connection deleted" });
    })
  );

  // Customer-only: Import bank statement (CSV)
  app.post(
    "/api/companies/:companyId/bank-connections/:id/import",
    authMiddleware,
    requireCustomer,
    requireFeature("bankImport"),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId, id } = req.params;
      const userId = (req as any).user.id;

      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: "Access denied" });
      }

      const connection = await storage.getBankConnection(id);
      if (!connection) {
        return res.status(404).json({ message: "Bank connection not found" });
      }

      if (connection.companyId !== companyId) {
        return res.status(403).json({ message: "Bank connection does not belong to this company" });
      }

      const { csvContent } = req.body;
      if (!csvContent || typeof csvContent !== "string") {
        return res.status(400).json({ message: "CSV content is required" });
      }

      // Parse CSV content
      const lines = csvContent.trim().split("\n");
      if (lines.length < 2) {
        return res
          .status(400)
          .json({ message: "CSV must contain a header row and at least one data row" });
      }

      const headers = lines[0].split(",").map((h) => h.trim().toLowerCase());
      const dateIdx = headers.findIndex((h) => h === "date");
      const descIdx = headers.findIndex(
        (h) => h === "description" || h === "memo" || h === "narrative"
      );
      const amountIdx = headers.findIndex((h) => h === "amount");
      const debitIdx = headers.findIndex((h) => h === "debit");
      const creditIdx = headers.findIndex((h) => h === "credit");
      const refIdx = headers.findIndex((h) => h === "reference" || h === "ref");

      if (dateIdx === -1) {
        return res.status(400).json({ message: 'CSV must contain a "date" column' });
      }

      if (amountIdx === -1 && (debitIdx === -1 || creditIdx === -1)) {
        return res.status(400).json({
          message: 'CSV must contain an "amount" column, or both "debit" and "credit" columns',
        });
      }

      const transactions = [];
      const errors = [];

      for (let i = 1; i < lines.length; i++) {
        const row = lines[i].split(",").map((c) => c.trim());
        if (row.length < 2 || row.every((c) => !c)) continue; // Skip empty rows

        try {
          const date = new Date(row[dateIdx]);
          if (isNaN(date.getTime())) {
            errors.push(`Row ${i + 1}: Invalid date "${row[dateIdx]}"`);
            continue;
          }

          let amount: number;
          if (amountIdx !== -1) {
            amount = parseFloat(row[amountIdx].replace(/[^0-9.-]/g, ""));
          } else {
            const debit = parseFloat(row[debitIdx].replace(/[^0-9.-]/g, "") || "0");
            const credit = parseFloat(row[creditIdx].replace(/[^0-9.-]/g, "") || "0");
            amount = credit - debit; // positive = credit (inflow), negative = debit (outflow)
          }

          if (isNaN(amount)) {
            errors.push(`Row ${i + 1}: Invalid amount`);
            continue;
          }

          const description = descIdx !== -1 ? row[descIdx] : "";
          const reference = refIdx !== -1 ? row[refIdx] : "";

          const transaction = await storage.createBankTransaction({
            bankConnectionId: id,
            companyId,
            transactionDate: date,
            description,
            amount,
            reference,
          });

          transactions.push(transaction);
        } catch (err) {
          errors.push(`Row ${i + 1}: ${(err as Error).message}`);
        }
      }

      logger.info(
        { connectionId: id, imported: transactions.length },
        "Bank transactions imported"
      );
      res.json({
        imported: transactions.length,
        errors: errors.length > 0 ? errors : undefined,
        transactions,
      });
    })
  );

  // =====================================
  // Open Banking / Wio Bank API Routes
  // =====================================

  // Get available bank providers
  app.get(
    "/api/bank/providers",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (_req: Request, res: Response) => {
      res.json({
        providers: getAvailableProviders(),
        isConfigured: isOpenBankingConfigured(),
      });
    })
  );

  // Initiate bank connection via Open Banking (get auth URL)
  app.post(
    "/api/companies/:companyId/bank-connections/connect",
    authMiddleware,
    requireCustomer,
    requireFeature("bankImport"),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const userId = (req as any).user.id;
      const { provider: providerName, redirectUrl } = req.body;

      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: "Access denied" });
      }

      if (!providerName || !redirectUrl) {
        return res.status(400).json({ message: "Provider name and redirect URL are required" });
      }

      const provider = getBankProvider(providerName);
      if (!provider) {
        return res.status(400).json({ message: `Bank provider "${providerName}" not available` });
      }

      const authUrl = await provider.getAuthUrl(companyId, redirectUrl);
      res.json({ authUrl, provider: providerName });
    })
  );

  // Handle OAuth callback from bank provider
  app.post(
    "/api/companies/:companyId/bank-connections/callback",
    authMiddleware,
    requireCustomer,
    requireFeature("bankImport"),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const userId = (req as any).user.id;
      const { provider: providerName, code, state } = req.body;

      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: "Access denied" });
      }

      const provider = getBankProvider(providerName);
      if (!provider) {
        return res.status(400).json({ message: `Bank provider "${providerName}" not available` });
      }

      // Exchange code for tokens
      const tokens = await provider.handleCallback(code, state || companyId);

      // Fetch accounts from the bank
      const bankAccounts = await provider.fetchAccounts(tokens.accessToken);

      if (bankAccounts.length === 0) {
        return res.status(400).json({ message: "No bank accounts found" });
      }

      // Create a bank connection for each account
      const connections = [];
      for (const account of bankAccounts) {
        const connection = await storage.createBankConnection({
          companyId,
          bankName: account.bankName,
          accountNumberLast4: account.last4,
          connectionType: "api",
          status: "active",
          provider: providerName,
          externalAccountId: account.externalId,
          iban: account.iban,
          consentId: tokens.consentId || null,
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken,
          tokenExpiresAt: tokens.expiresAt,
          autoSync: true,
        });
        connections.push(connection);
      }

      logger.info({ connectionCount: connections.length, providerName }, "Bank accounts connected");
      res.status(201).json({ connections, accounts: bankAccounts });
    })
  );

  // Sync transactions from connected bank account
  app.post(
    "/api/bank-connections/:id/sync",
    authMiddleware,
    requireCustomer,
    requireFeature("bankImport"),
    asyncHandler(async (req: Request, res: Response) => {
      const { id } = req.params;
      const userId = (req as any).user.id;
      const { fromDate, toDate } = req.body;

      const connection = await storage.getBankConnection(id);
      if (!connection) {
        return res.status(404).json({ message: "Bank connection not found" });
      }

      const hasAccess = await storage.hasCompanyAccess(userId, connection.companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: "Access denied" });
      }

      if (connection.connectionType !== "api" || !connection.provider) {
        return res.status(400).json({ message: "This connection does not support API sync" });
      }

      const provider = getBankProvider(connection.provider);
      if (!provider) {
        return res.status(400).json({ message: "Provider not available" });
      }

      // Refresh token if needed
      let accessToken = connection.accessToken;
      if (tokenNeedsRefresh(connection.tokenExpiresAt) && connection.refreshToken) {
        try {
          const newTokens = await provider.refreshToken(connection.refreshToken);
          await storage.updateBankConnectionTokens(id, {
            accessToken: newTokens.accessToken,
            refreshToken: newTokens.refreshToken,
            tokenExpiresAt: newTokens.expiresAt,
          });
          accessToken = newTokens.accessToken;
        } catch (err) {
          await storage.updateBankConnectionTokens(id, {
            status: "error",
            lastError: "Token refresh failed. Please reconnect.",
          });
          return res.status(401).json({ message: "Bank connection expired. Please reconnect." });
        }
      }

      if (!accessToken) {
        return res.status(401).json({ message: "No access token. Please reconnect." });
      }

      // Fetch transactions
      const from = fromDate ? new Date(fromDate) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const to = toDate ? new Date(toDate) : new Date();

      const bankTransactions = await provider.fetchTransactions(
        accessToken,
        connection.externalAccountId || "",
        from,
        to
      );

      // Import transactions (deduplicate by reference)
      let imported = 0;
      for (const tx of bankTransactions) {
        try {
          await storage.createBankTransaction({
            companyId: connection.companyId,
            bankAccountId: connection.bankAccountId,
            bankConnectionId: id,
            transactionDate: tx.date,
            description: tx.description,
            amount: tx.amount,
            reference: tx.reference || tx.externalId,
            importSource: "api",
          });
          imported++;
        } catch {
          // Skip duplicates (unique constraint on reference)
        }
      }

      // Update last sync time
      await storage.updateBankConnection(id, { lastSyncedAt: new Date() });

      logger.info(
        { connectionId: id, imported, provider: connection.provider },
        "Bank transactions synced"
      );
      res.json({ synced: imported, total: bankTransactions.length });
    })
  );

  // Get balance for connected bank account
  app.get(
    "/api/bank-connections/:id/balance",
    authMiddleware,
    requireCustomer,
    requireFeature("bankImport"),
    asyncHandler(async (req: Request, res: Response) => {
      const { id } = req.params;
      const userId = (req as any).user.id;

      const connection = await storage.getBankConnection(id);
      if (!connection) {
        return res.status(404).json({ message: "Bank connection not found" });
      }

      const hasAccess = await storage.hasCompanyAccess(userId, connection.companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: "Access denied" });
      }

      if (connection.connectionType !== "api" || !connection.provider || !connection.accessToken) {
        return res
          .status(400)
          .json({ message: "This connection does not support balance fetching" });
      }

      const provider = getBankProvider(connection.provider);
      if (!provider) {
        return res.status(400).json({ message: "Provider not available" });
      }

      const balance = await provider.fetchBalance(
        connection.accessToken,
        connection.externalAccountId || ""
      );

      res.json(balance);
    })
  );
}
