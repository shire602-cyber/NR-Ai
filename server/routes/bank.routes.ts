import type { Express, Request, Response } from "express";
import { authMiddleware, requireCustomer } from "../middleware/auth";
import { asyncHandler } from "../middleware/errorHandler";
import { requireFeature } from "../middleware/featureGate";
import { requirePermission } from "../middleware/companyRolePolicy";
import { strictBody } from "../http/strict-body";
import { parsedBody } from "../http/parsed-body";
import { DomainError } from "../errors";
import { storage } from "../storage";
import { getCapabilitySnapshot } from "../../shared/capabilities";
import {
  bankFeedCallbackBody,
  bankFeedConnectBody,
  bankFeedSyncBody,
  manualBankConnectionBody,
} from "../../shared/validators/banking";
import {
  allowedRedirectUris,
  completeCallback,
  linkConnection,
  providerStatuses,
  registerBankFeedJobs,
  sanitizeConnection,
  startConnect,
  syncConnection,
} from "../services/bank-feeds";
import { getAvailableProviders, isOpenBankingConfigured } from "../services/open-banking.service";
import { importBankStatement, parseCSVBankStatement } from "../services/bank-import.service";
import { createLogger } from "../config/logger";
import { z } from "zod";
import { zUuid } from "../../shared/validators/primitives";
import { parseReportDate, uaeToday } from "../reporting";
import { bankAccountBalances } from "../services/fx/bank-balances";

const logger = createLogger("bank-routes");

function userId(req: Request): string {
  return (req as Request & { user: { id: string } }).user.id;
}

async function assertAccess(req: Request, companyId: string): Promise<void> {
  if (!(await storage.hasCompanyAccess(userId(req), companyId)))
    throw new DomainError("COMPANY_ACCESS_DENIED", 403, undefined, "Access denied");
}

/** Tenant-scoped connection lookup: another company's id answers 404. */
async function ownedConnection(req: Request, id: string, companyId?: string) {
  const connection = await storage.getBankConnection(id);
  if (!connection || (companyId && connection.companyId !== companyId))
    throw new DomainError("BANK_CONNECTION_NOT_FOUND", 404, undefined, "Bank connection not found");
  if (!(await storage.hasCompanyAccess(userId(req), connection.companyId)))
    throw new DomainError("BANK_CONNECTION_NOT_FOUND", 404, undefined, "Bank connection not found");
  return connection;
}

const connectionImportBody = z.object({ csvContent: z.string().min(1).max(5_000_000) }).strict();
const connectionLinkBody = z.object({ bankAccountId: zUuid }).strict();

export function registerBankRoutes(app: Express) {
  registerBankFeedJobs();

  // ─── Bank-account balances in account and base currency (W5-C, R14-16) ──

  const balanceAsOf = (req: Request): string =>
    parseReportDate(req.query.asOf, "asOf") ?? uaeToday();

  app.get(
    "/api/companies/:companyId/bank-accounts/currency-balances",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      await assertAccess(req, companyId);
      res.json(await bankAccountBalances(companyId, balanceAsOf(req)));
    })
  );

  app.get(
    "/api/companies/:companyId/bank-accounts/:accountId/currency-balance",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId, accountId } = req.params;
      await assertAccess(req, companyId);
      const all = await bankAccountBalances(companyId, balanceAsOf(req));
      const one = all.accounts.find((a) => a.bankAccountId === accountId);
      if (!one) throw new DomainError("BANK_ACCOUNT_NOT_FOUND", 404);
      res.json({ asOf: all.asOf, ...one });
    })
  );

  // ─── Connections ───────────────────────────────────────────────────────

  app.get(
    "/api/companies/:companyId/bank-connections",
    authMiddleware,
    requireCustomer,
    requireFeature("bankImport"),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      await assertAccess(req, companyId);
      const connections = await storage.getBankConnectionsByCompanyId(companyId);
      res.json(connections.map(sanitizeConnection));
    })
  );

  // Manual (statement-only) connection record. Open-banking connections come only from callback.
  app.post(
    "/api/companies/:companyId/bank-connections",
    authMiddleware,
    requireCustomer,
    requireFeature("bankImport"),
    strictBody(manualBankConnectionBody),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      await assertAccess(req, companyId);
      const body = parsedBody<z.output<typeof manualBankConnectionBody>>(req);
      if (body.bankAccountId && !(await storage.getBankAccountById(body.bankAccountId, companyId)))
        throw new DomainError("BANK_ACCOUNT_NOT_FOUND", 404);
      const connection = await storage.createBankConnection({
        companyId,
        provider: "manual",
        connectionType: "statement",
        bankName: body.bankName,
        accountName: body.accountName ?? null,
        bankAccountId: body.bankAccountId ?? null,
        iban: body.iban ?? null,
        autoSync: false,
        status: "active",
      });
      logger.info({ connectionId: connection.id, companyId }, "Bank connection created");
      res.status(201).json(sanitizeConnection(connection));
    })
  );

  app.delete(
    "/api/bank-connections/:id",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const connection = await ownedConnection(req, req.params.id);
      await storage.deleteBankConnection(connection.id);
      res.json({ message: "Bank connection deleted" });
    })
  );

  app.post(
    "/api/companies/:companyId/bank-connections/:id/link",
    authMiddleware,
    requireCustomer,
    requireFeature("bankImport"),
    strictBody(connectionLinkBody),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId, id } = req.params;
      await ownedConnection(req, id, companyId);
      const updated = await linkConnection(companyId, id, req.body.bankAccountId);
      res.json(sanitizeConnection(updated));
    })
  );

  // Statement CSV through a manual connection: the shared parser, dedupe and the linked account.
  app.post(
    "/api/companies/:companyId/bank-connections/:id/import",
    authMiddleware,
    requireCustomer,
    requireFeature("bankImport"),
    strictBody(connectionImportBody),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId, id } = req.params;
      await assertAccess(req, companyId);
      const connection = await ownedConnection(req, id, companyId);
      let parsed;
      try {
        parsed = await parseCSVBankStatement(req.body.csvContent);
      } catch {
        throw new DomainError(
          "STATEMENT_UNREADABLE",
          400,
          undefined,
          "Could not read the statement"
        );
      }
      if (parsed.length === 0)
        throw new DomainError(
          "NO_VALID_TRANSACTIONS",
          400,
          undefined,
          "No valid transactions found"
        );
      const result = await importBankStatement(companyId, connection.id, parsed, {
        bankAccountId: connection.bankAccountId,
        actorId: userId(req),
      });
      res.json(result);
    })
  );

  // ─── Open banking (to the external boundary) ────────────────────────────

  app.get(
    "/api/bank/providers",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (_req: Request, res: Response) => {
      const snapshot = getCapabilitySnapshot();
      res.json({
        providers: getAvailableProviders(),
        isConfigured: isOpenBankingConfigured(),
        statuses: providerStatuses(),
        redirectUris: allowedRedirectUris(),
        capabilities: snapshot.capabilities.filter((c) => c.id.startsWith("bank_feed_")),
      });
    })
  );

  app.post(
    "/api/companies/:companyId/bank-connections/connect",
    authMiddleware,
    requireCustomer,
    requireFeature("bankImport"),
    requirePermission("settings.company"),
    strictBody(bankFeedConnectBody),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      await assertAccess(req, companyId);
      const body = parsedBody<z.output<typeof bankFeedConnectBody>>(req);
      const result = await startConnect({
        companyId,
        userId: userId(req),
        provider: body.provider,
        redirectUrl: body.redirectUrl,
        bankAccountId: body.bankAccountId,
      });
      res.json({ authUrl: result.authUrl, provider: result.provider, expiresAt: result.expiresAt });
    })
  );

  app.post(
    "/api/companies/:companyId/bank-connections/callback",
    authMiddleware,
    requireCustomer,
    requireFeature("bankImport"),
    requirePermission("settings.company"),
    strictBody(bankFeedCallbackBody),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      await assertAccess(req, companyId);
      const body = parsedBody<z.output<typeof bankFeedCallbackBody>>(req);
      const result = await completeCallback({
        companyId,
        userId: userId(req),
        provider: body.provider,
        code: body.code,
        state: body.state,
      });
      logger.info({ companyId, count: result.connections.length }, "Bank feed connected");
      res.status(201).json(result);
    })
  );

  app.post(
    "/api/bank-connections/:id/sync",
    authMiddleware,
    requireCustomer,
    requireFeature("bankImport"),
    strictBody(bankFeedSyncBody),
    asyncHandler(async (req: Request, res: Response) => {
      const connection = await ownedConnection(req, req.params.id);
      if (connection.provider === "manual")
        throw new DomainError(
          "BANK_FEED_NOT_SUPPORTED",
          400,
          undefined,
          "This connection is statement-only"
        );
      const result = await syncConnection(connection, {
        from: req.body.fromDate,
        to: req.body.toDate,
        actorId: userId(req),
      });
      res.json({ synced: result.imported, total: result.fetched, ...result });
    })
  );

  app.get(
    "/api/bank-connections/:id/balance",
    authMiddleware,
    requireCustomer,
    requireFeature("bankImport"),
    asyncHandler(async (req: Request, _res: Response) => {
      await ownedConnection(req, req.params.id);
      throw new DomainError(
        "BANK_FEED_BALANCE_UNAVAILABLE",
        503,
        undefined,
        "To review a bank balance, upload a CSV statement for reconciliation"
      );
    })
  );
}
