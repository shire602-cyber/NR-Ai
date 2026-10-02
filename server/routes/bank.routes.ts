import type { Express, Request, Response } from "express";
import { z } from "zod";
import { authMiddleware, requireCompanyAccess, requireCustomer } from "../middleware/auth";
import { asyncHandler } from "../middleware/errorHandler";
import { requireFeature } from "../middleware/featureGate";
import { validate } from "../middleware/validate";
import { pool } from "../db";
import { storage } from "../storage";
import { AppError } from "../errors";
import { createLogger } from "../config/logger";
import { getEnv } from "../config/env";
import { decryptSecret } from "../services/secret-vault";
import { toPublicBankConnection } from "../services/bank-connection-view";
import { assertCanPostBanking } from "../services/bank-access";
import { getAvailableProviders, getLeanClient, isOpenBankingConfigured, providerEnvironment, ProviderError } from "../services/open-banking.service";
import { signFeedState } from "../services/bank-feed-state";
import { ensureProviderCustomer } from "../services/bank-feed-link.service";
import { syncConnection } from "../services/bank-feed-sync.service";
import { importStatementFile } from "../services/bank-import.service";
import { recordAudit } from "../services/audit.service";

const logger = createLogger("bank-routes");

const uuid = z.string().uuid();
const companyParams = z.object({ companyId: uuid }).passthrough();
const companyConnParams = z.object({ companyId: uuid, id: uuid }).passthrough();
const connParams = z.object({ id: uuid }).passthrough();

const manualConnectionSchema = z.object({
  bankName: z.string().max(120).nullish(),
  accountName: z.string().max(120).nullish(),
  accountNumberLast4: z.string().max(4).nullish(),
  iban: z.string().max(64).nullish(),
  bankAccountId: uuid.nullish(),
});

const syncSchema = z.object({ fromDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }).passthrough();

const clean = (v: string | null | undefined, max: number): string | null => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);

export function registerBankRoutes(app: Express) {
  const guard = [authMiddleware, requireCustomer, requireFeature("bankImport"), validate({ params: companyParams }), requireCompanyAccess("params")];

  /** A connection of the caller's company, or 404 (another company's connection is indistinguishable from a missing one). */
  async function ownConnection(req: Request) {
    const connection = await storage.getBankConnection(req.params.id);
    if (!connection || !(await storage.hasCompanyAccess(req.user!.id, connection.companyId))) {
      throw new AppError({ message: "Bank connection not found", statusCode: 404, code: "BANK_CONNECTION_NOT_FOUND" });
    }
    return connection;
  }

  // Connections never carry tokens, consent ids or the provider's entity id in a response.
  app.get(
    "/api/companies/:companyId/bank-connections",
    ...guard,
    asyncHandler(async (req: Request, res: Response) => {
      const connections = await storage.getBankConnectionsByCompanyId(req.params.companyId);
      res.json(connections.map(toPublicBankConnection));
    })
  );

  // Manual statement source only. Feed connections are created by POST /bank-feeds/connections after a signed link flow.
  app.post(
    "/api/companies/:companyId/bank-connections",
    ...guard,
    validate({ body: manualConnectionSchema }),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const body = req.body as z.infer<typeof manualConnectionSchema>;
      let bankAccountId: string | null = null;
      if (body.bankAccountId) {
        const bankAccount = await storage.getBankAccountById(body.bankAccountId);
        if (!bankAccount || bankAccount.companyId !== companyId) throw new AppError({ message: "Bank account not found", statusCode: 404, code: "BANK_ACCOUNT_NOT_FOUND" });
        bankAccountId = bankAccount.id;
      }
      const connection = await storage.createBankConnection({
        companyId,
        provider: "manual",
        connectionType: "statement",
        status: "active",
        autoSync: false,
        bankName: clean(body.bankName, 120),
        accountName: clean(body.accountName, 120),
        accountNumberLast4: clean(body.accountNumberLast4, 4),
        iban: clean(body.iban, 64),
        bankAccountId,
      } as any);
      logger.info({ connectionId: connection.id, companyId }, "Bank connection created");
      res.status(201).json(toPublicBankConnection(connection));
    })
  );

  // Disconnect: secrets are removed, the row and every imported transaction stay.
  app.delete(
    "/api/bank-connections/:id",
    authMiddleware,
    requireCustomer,
    validate({ params: connParams }),
    asyncHandler(async (req: Request, res: Response) => {
      const connection = await ownConnection(req);
      await assertCanPostBanking(req.user!.id, connection.companyId);
      await pool.query(
        `UPDATE bank_connections
            SET status = 'disconnected', auto_sync = false, access_token = NULL, refresh_token = NULL, provider_entity_id = NULL,
                consent_id = NULL, token_expires_at = NULL, sync_lease_until = NULL, updated_at = now()
          WHERE id = $1`,
        [connection.id]
      );
      await recordAudit({ userId: req.user!.id, companyId: connection.companyId, action: "bank.feed_disconnect", entityType: "bank_connection", entityId: connection.id, req });
      res.json({ message: "Bank connection disconnected" });
    })
  );

  // Statement text for a connection that is linked to a bank account: the same import path as every other statement.
  app.post(
    "/api/companies/:companyId/bank-connections/:id/import",
    authMiddleware,
    requireCustomer,
    requireFeature("bankImport"),
    validate({ params: companyConnParams, body: z.object({ csvContent: z.string().min(1).max(7_000_000), fileName: z.string().max(255).optional() }) }),
    requireCompanyAccess("params"),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId, id } = req.params;
      const connection = await storage.getBankConnection(id);
      if (!connection || connection.companyId !== companyId) throw new AppError({ message: "Bank connection not found", statusCode: 404, code: "BANK_CONNECTION_NOT_FOUND" });
      const account = connection.bankAccountId ? await storage.getBankAccountById(connection.bankAccountId) : undefined;
      if (!account || account.companyId !== companyId) {
        throw new AppError({ message: "Link this connection to a bank account first.", statusCode: 422, code: "BANK_ACCOUNT_NOT_LINKED" });
      }
      const outcome = await importStatementFile({ companyId, userId: req.user!.id, account, content: req.body.csvContent, fileName: req.body.fileName, format: "auto" });
      const { insertedIds: _ids, ...body } = outcome;
      res.json({ ...body, imported: outcome.imported });
    })
  );

  // Providers the company may use: [] unless a feed provider is configured.
  app.get(
    "/api/bank/providers",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (_req: Request, res: Response) => {
      res.json({ providers: getAvailableProviders(), isConfigured: isOpenBankingConfigured(), environment: providerEnvironment() });
    })
  );

  // Legacy "connect": 400 when no provider is set, otherwise the same Link session as POST /bank-feeds/lean/session.
  app.post(
    "/api/companies/:companyId/bank-connections/connect",
    ...guard,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const userId = req.user!.id;
      await assertCanPostBanking(userId, companyId);
      const client = getLeanClient();
      if (!client) throw new AppError({ message: "Bank feeds are not configured.", statusCode: 400, code: "BANK_PROVIDER_NOT_CONFIGURED" });
      try {
        const customerId = await ensureProviderCustomer(client, companyId);
        res.json({
          provider: "lean",
          appToken: client.appToken,
          customerId,
          accessToken: await client.customerToken(customerId),
          sandbox: client.environment === "sandbox",
          state: signFeedState({ companyId, userId, secret: (getEnv() as any).SESSION_SECRET }),
        });
      } catch (err) {
        if (err instanceof ProviderError) throw new AppError({ message: "The bank provider could not be reached.", statusCode: 502, code: "BANK_PROVIDER_ERROR" });
        throw err;
      }
    })
  );

  // Retired: it used to treat any `code` as the provider's entity id, so a user could attach another tenant's bank.
  app.post(
    "/api/companies/:companyId/bank-connections/callback",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (_req: Request, res: Response) => {
      res.status(410).json({ message: "This callback is retired. Use the bank feed link flow.", code: "USE_BANK_FEEDS" });
    })
  );

  // Sync booked transactions through the statement import path. Posts nothing.
  app.post(
    "/api/bank-connections/:id/sync",
    authMiddleware,
    requireCustomer,
    requireFeature("bankImport"),
    validate({ params: connParams, body: syncSchema }),
    asyncHandler(async (req: Request, res: Response) => {
      const connection = await ownConnection(req);
      await assertCanPostBanking(req.user!.id, connection.companyId);
      try {
        const result = await syncConnection({ connectionId: connection.id, companyId: connection.companyId, fromDate: req.body.fromDate ?? null });
        res.json(result);
      } catch (err) {
        if (err instanceof ProviderError) throw new AppError({ message: "The bank provider could not be reached.", statusCode: 502, code: "BANK_PROVIDER_ERROR" });
        throw err;
      }
    })
  );

  app.get(
    "/api/bank-connections/:id/balance",
    authMiddleware,
    requireCustomer,
    requireFeature("bankImport"),
    validate({ params: connParams }),
    asyncHandler(async (req: Request, res: Response) => {
      const connection = await ownConnection(req);
      const client = getLeanClient();
      const entityId = decryptSecret((connection as any).providerEntityId);
      if (connection.provider !== "lean" || !client || !entityId || !connection.externalAccountId || connection.status === "disconnected") {
        throw new AppError({ message: "This connection does not support balance fetching", statusCode: 400, code: "BALANCE_NOT_SUPPORTED" });
      }
      try {
        res.json(await client.fetchBalance(entityId, connection.externalAccountId));
      } catch (err) {
        if (err instanceof ProviderError) throw new AppError({ message: "The bank provider could not be reached.", statusCode: 502, code: "BANK_PROVIDER_ERROR" });
        throw err;
      }
    })
  );
}
