import type { Express, Request, Response } from "express";
import { authMiddleware, requireCustomer } from "../middleware/auth";
import { asyncHandler } from "../middleware/errorHandler";
import { requireFeature } from "../middleware/featureGate";
import { requirePermission } from "../middleware/companyRolePolicy";
import { assertTrialAccess } from "../middleware/trialAccessPolicy";
import { strictBody } from "../http/strict-body";
import { parsedBody } from "../http/parsed-body";
import { DomainError } from "../errors";
import { storage } from "../storage";
import { bankStatementCopy } from "../../shared/bank-statement-copy";
import {
  bankAuthorizationHandoffBody,
  bankAuthorizationResumeBody,
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
  resolveCallbackCompany,
  sanitizeConnection,
  startConnect,
  syncConnection,
} from "../services/bank-feeds";
import {
  clearCompletedReturn,
  recordReturnReceipt,
  type ReturnHandoff,
  readReturnHandoff,
  stageReturnHandoff,
} from "../services/bank-feeds/return-handoff";
import { getAvailableProviders, isOpenBankingConfigured } from "../services/open-banking.service";
import { importBankStatement, parseCSVBankStatement } from "../services/bank-import.service";
import { createLogger } from "../config/logger";
import { z } from "zod";
import { zUuid } from "../../shared/validators/primitives";
import { parseReportDate, uaeToday } from "../reporting";
import { bankAccountBalances } from "../services/fx/bank-balances";
import { requireCompanyMfaEnrollment } from "../services/security/policy";

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
    throw new DomainError("BANK_CONNECTION_NOT_FOUND", 404, undefined, bankStatementCopy.en);
  if (!(await storage.hasCompanyAccess(userId(req), connection.companyId)))
    throw new DomainError("BANK_CONNECTION_NOT_FOUND", 404, undefined, bankStatementCopy.en);
  return connection;
}

const connectionImportBody = z.object({ csvContent: z.string().min(1).max(5_000_000) }).strict();
const connectionLinkBody = z.object({ bankAccountId: zUuid }).strict();
type CallbackBody = z.output<typeof bankFeedCallbackBody>;
type ReadyReturn = Extract<ReturnHandoff, { kind: "pending" | "completed" }>;

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

  // Manual statement association. External authorizations are recorded by the callback.
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
      logger.info({ connectionId: connection.id, companyId }, "Statement association created");
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
      res.json({ message: "Record deleted" });
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

  // ─── Financial-data authorization and processing ────────────────────────

  app.get(
    "/api/bank/providers",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (_req: Request, res: Response) => {
      res.json({
        providers: getAvailableProviders(),
        isConfigured: isOpenBankingConfigured(),
        statuses: providerStatuses(),
        csvImport: { available: true, message: bankStatementCopy },
        redirectUris: allowedRedirectUris(),
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

  // This accepts the processor's return before sign-in. The resume route authenticates and
  // authorizes the initiating user before consuming the saved state or contacting the processor.
  app.post(
    "/api/bank-connections/handoff",
    strictBody(bankAuthorizationHandoffBody),
    asyncHandler(async (req, res) => {
      const { search, returnId, tabKey } =
        parsedBody<z.output<typeof bankAuthorizationHandoffBody>>(req);
      await stageReturnHandoff(req, { returnId, tabKey }, search);
      res.set("Cache-Control", "no-store").json({ returnId });
    })
  );

  const finishAuthorization = asyncHandler(async (req, res) => {
    const { companyId } = req.params;
    await assertAccess(req, companyId);
    const handoff: ReadyReturn | undefined = res.locals.statementReturn;
    if (res.locals.acknowledgeStatementReturn) {
      if (handoff?.kind !== "completed") {
        throw new DomainError("AUTHORIZATION_RETRY", 409, undefined, bankStatementCopy.en);
      }
      await clearCompletedReturn(req, handoff);
      res.json({ acknowledged: true });
      return;
    }
    if (handoff?.kind === "completed") {
      res.status(200).json(handoff.receipt.result);
      return;
    }
    const body = handoff?.callback ?? parsedBody<CallbackBody>(req);
    const result = await completeCallback(
      { ...body, companyId, userId: userId(req) },
      req.sessionStore,
      Boolean(handoff)
    );
    if (handoff)
      await recordReturnReceipt(req, handoff, { companyId, userId: userId(req), result });
    logger.info({ companyId, count: result.connections.length }, "Authorization return processed");
    res.status(201).json(result);
  });

  const resolveOrigin = asyncHandler(async (req, res, next) => {
    const handoff: ReadyReturn | undefined = res.locals.statementReturn;
    let companyId: string;
    if (handoff?.kind === "completed") {
      if (handoff.receipt.userId !== userId(req)) {
        throw new DomainError("INVALID_OAUTH_STATE", 400, undefined, bankStatementCopy.en);
      }
      companyId = handoff.receipt.companyId;
    } else {
      const body = handoff?.callback ?? parsedBody<CallbackBody>(req);
      companyId = await resolveCallbackCompany({ ...body, userId: userId(req) });
    }
    await assertAccess(req, companyId);
    await assertTrialAccess(companyId, req.user!);
    req.params.companyId = companyId;
    next();
  });
  const finishForOrigin = [
    resolveOrigin,
    requireCompanyMfaEnrollment,
    requireFeature("bankImport"),
    requirePermission("settings.company"),
    finishAuthorization,
  ];

  app.post(
    "/api/bank-connections/callback/resume",
    authMiddleware,
    requireCustomer,
    strictBody(bankAuthorizationResumeBody),
    asyncHandler(async (req, res, next) => {
      res.set("Cache-Control", "no-store");
      const { returnId, tabKey, acknowledge } =
        parsedBody<z.output<typeof bankAuthorizationResumeBody>>(req);
      const handoff = await readReturnHandoff(req, { returnId, tabKey });
      if (handoff.kind === "pending" || handoff.kind === "completed") {
        res.locals.statementReturn = handoff;
        res.locals.acknowledgeStatementReturn = acknowledge;
        next();
      } else {
        res.json({ outcome: handoff.kind });
      }
    }),
    ...finishForOrigin
  );

  app.post(
    "/api/bank-connections/callback",
    authMiddleware,
    requireCustomer,
    strictBody(bankFeedCallbackBody),
    ...finishForOrigin
  );

  app.post(
    "/api/companies/:companyId/bank-connections/callback",
    authMiddleware,
    requireCustomer,
    requireFeature("bankImport"),
    requirePermission("settings.company"),
    strictBody(bankFeedCallbackBody),
    finishAuthorization
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
        throw new DomainError("BANK_FEED_NOT_SUPPORTED", 400, undefined, bankStatementCopy.en);
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
      throw new DomainError("BANK_FEED_BALANCE_UNAVAILABLE", 503, undefined, bankStatementCopy.en);
    })
  );
}
