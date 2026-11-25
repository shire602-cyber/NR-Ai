import { assertUploadSize } from "../http/upload-errors";
import type { Express, Request, Response } from "express";
import { authMiddleware, requireCustomer } from "../middleware/auth";
import { asyncHandler } from "../middleware/errorHandler";
import { requireFeature } from "../middleware/featureGate";
import { requirePermission } from "../middleware/companyRolePolicy";
import { strictBody } from "../http/strict-body";
import { parsedBody } from "../http/parsed-body";
import { DomainError } from "../errors";
import { createLogger } from "../config/logger";
import { storage } from "../storage";
import { BANK_RECONCILIATION_COPY } from "../../shared/bank-reconciliation-copy";
import { manualBankConnectionBody } from "../../shared/validators/banking";
import {
  retireAutomaticBanking,
  retiredBankingError,
  sanitizeConnection,
} from "../services/bank-feeds";
import {
  assertStatementDatesValid,
  importConnectionStatement,
  linkConnectionStatement,
  parseStatementCsv,
  statementImportChoice,
} from "../services/bank-import.service";
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

const connectionImportBody = z
  .object({
    csvContent: z.string().min(1),
    acknowledgeAmbiguity: z.boolean().optional(),
  })
  .strict();
const connectionLinkBody = z.object({ bankAccountId: zUuid }).strict();

export async function registerBankRoutes(app: Express, retireOnStartup = true) {
  if (retireOnStartup) await retireAutomaticBanking();

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

  // Create a statement source for CSV uploads.
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
        status: "active",
      });
      logger.info({ connectionId: connection.id, companyId }, "Statement source created");
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
      res.json({ message: "Statement source deleted" });
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
      const { bankAccountId } = parsedBody<z.output<typeof connectionLinkBody>>(req);
      const updated = await linkConnectionStatement(companyId, id, bankAccountId, userId(req));
      if (!updated) throw new DomainError("BANK_CONNECTION_NOT_FOUND", 404);
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
      await ownedConnection(req, id, companyId);
      const { csvContent, acknowledgeAmbiguity } =
        parsedBody<z.output<typeof connectionImportBody>>(req);
      let parsed;
      try {
        const bytes = Buffer.from(csvContent, "utf8");
        assertUploadSize(bytes.length);
        parsed = parseStatementCsv(bytes);
        if (parsed.rows.length === 0 && parsed.ignored.length === 0) {
          throw new Error("CSV file must contain a header row and at least one data row");
        }
      } catch (err) {
        if (err instanceof DomainError) throw err;
        throw new DomainError(
          "STATEMENT_UNREADABLE",
          400,
          undefined,
          "Could not read the statement"
        );
      }
      assertStatementDatesValid(parsed);
      if (!parsed.rows.some((row) => row.date && row.errors.length === 0))
        throw new DomainError(
          "NO_VALID_TRANSACTIONS",
          400,
          undefined,
          "No valid transactions found"
        );
      const choice = statementImportChoice(parsed, acknowledgeAmbiguity);
      if (choice) return res.status(409).json(choice);
      const result = await importConnectionStatement(companyId, id, parsed, userId(req));
      res.json(result);
    })
  );

  app.get(
    "/api/bank/providers",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (_req: Request, res: Response) => {
      res.json({
        providers: [],
        isConfigured: false,
        statuses: [],
        redirectUris: [],
        capabilities: [],
        csvImport: { available: true, message: BANK_RECONCILIATION_COPY },
      });
    })
  );

  const retiredAuthorization = asyncHandler(async (req: Request, _res: Response) => {
    await assertAccess(req, req.params.companyId);
    throw retiredBankingError();
  });

  app.post(
    "/api/companies/:companyId/bank-connections/connect",
    authMiddleware,
    requireCustomer,
    requireFeature("bankImport"),
    requirePermission("settings.company"),
    retiredAuthorization
  );

  app.post(
    "/api/companies/:companyId/bank-connections/callback",
    authMiddleware,
    requireCustomer,
    requireFeature("bankImport"),
    requirePermission("settings.company"),
    retiredAuthorization
  );

  app.post(
    "/api/bank-connections/:id/sync",
    authMiddleware,
    requireCustomer,
    requireFeature("bankImport"),
    asyncHandler(async (req: Request, _res: Response) => {
      await ownedConnection(req, req.params.id);
      throw retiredBankingError();
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
        BANK_RECONCILIATION_COPY.en
      );
    })
  );
}
