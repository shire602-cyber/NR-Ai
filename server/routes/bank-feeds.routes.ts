import type { Express, Request, Response } from "express";
import { z } from "zod";
import { authMiddleware, requireCompanyAccess, requireCustomer } from "../middleware/auth";
import { asyncHandler } from "../middleware/errorHandler";
import { requireFeature } from "../middleware/featureGate";
import { validate } from "../middleware/validate";
import { pool } from "../db";
import { getEnv } from "../config/env";
import { storage } from "../storage";
import { AppError } from "../errors";
import { encryptSecret } from "../services/secret-vault";
import { assertCanPostBanking } from "../services/bank-access";
import { toPublicBankConnection } from "../services/bank-connection-view";
import { signFeedState, stateIssuedDay, verifyFeedState } from "../services/bank-feed-state";
import { assertEntityOwned, ensureProviderCustomer, latestEntitiesForCompany } from "../services/bank-feed-link.service";
import { getLeanClient, ProviderError } from "../services/open-banking.service";
import { recordAudit } from "../services/audit.service";

const uuid = z.string().uuid();
const companyParams = z.object({ companyId: uuid }).passthrough();

const accountsSchema = z.object({ state: z.string().min(10).max(1000), entityId: z.string().min(8).max(64).optional() });
const connectionSchema = accountsSchema.extend({
  entityId: z.string().min(8).max(64),
  externalAccountId: z.string().min(1).max(128),
  bankAccountId: uuid,
  autoSync: z.boolean().default(true),
});

const notConfigured = () =>
  new AppError({ message: "Bank feeds are not configured.", statusCode: 400, code: "BANK_PROVIDER_NOT_CONFIGURED" });

const stateInvalid = () => new AppError({ message: "The bank link session is invalid or expired. Start again.", statusCode: 400, code: "STATE_INVALID" });

function secret(): string {
  return (getEnv() as any).SESSION_SECRET as string;
}

/** Verifies the state and returns the day the Link session started (the start of the entity window). */
function checkState(state: string, companyId: string, userId: string): string {
  if (!verifyFeedState(state, { companyId, userId, secret: secret() }).ok) throw stateInvalid();
  return stateIssuedDay(state) ?? new Date().toISOString().slice(0, 10);
}

/** Provider failures are a 502 for the caller; nothing of the provider's own message or token reaches the response. */
function asProviderFailure<T>(p: Promise<T>): Promise<T> {
  return p.catch((err) => {
    if (err instanceof ProviderError) throw new AppError({ message: "The bank provider could not be reached.", statusCode: 502, code: "BANK_PROVIDER_ERROR" });
    throw err;
  });
}

export function registerBankFeedRoutes(app: Express) {
  const guard = [authMiddleware, requireCustomer, requireFeature("bankImport"), validate({ params: companyParams }), requireCompanyAccess("params")];

  // Start a Link session: the browser gets the app token, a customer-scoped token and a signed state.
  app.post(
    "/api/companies/:companyId/bank-feeds/lean/session",
    ...guard,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const userId = req.user!.id;
      await assertCanPostBanking(userId, companyId);
      const client = getLeanClient();
      if (!client) throw notConfigured();
      const body = await asProviderFailure(
        (async () => {
          const customerId = await ensureProviderCustomer(client, companyId);
          return { customerId, accessToken: await client.customerToken(customerId) };
        })()
      );
      res.json({
        appToken: client.appToken,
        customerId: body.customerId,
        accessToken: body.accessToken,
        sandbox: client.environment === "sandbox",
        state: signFeedState({ companyId, userId, secret: secret() }),
      });
    })
  );

  // After the Link flow: the accounts behind the entity the browser reports (checked to be this company's).
  app.post(
    "/api/companies/:companyId/bank-feeds/lean/accounts",
    ...guard,
    validate({ body: accountsSchema }),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const userId = req.user!.id;
      await assertCanPostBanking(userId, companyId);
      const client = getLeanClient();
      if (!client) throw notConfigured();
      const since = checkState(req.body.state, companyId, userId);
      const out = await asProviderFailure(
        (async () => {
          let entityId: string = req.body.entityId;
          if (entityId) {
            entityId = await assertEntityOwned(client, companyId, entityId, since);
          } else {
            // the browser does not have to know the entity id: find what Link just created for this company's customer
            const found = await latestEntitiesForCompany(client, companyId, since);
            if (found.length === 0) {
              throw new AppError({ message: "The bank login is not ready yet. Finish the link and try again.", statusCode: 409, code: "ENTITY_NOT_READY" });
            }
            if (found.length > 1) {
              return { entities: found.map((e) => ({ id: e.id, bankName: e.bankName, createdAt: e.createdAt })) };
            }
            entityId = found[0].id;
          }
          return { entityId, accounts: await client.listAccounts(entityId) };
        })()
      );
      res.json(out);
    })
  );

  // Connect one provider account to one managed bank account.
  app.post(
    "/api/companies/:companyId/bank-feeds/connections",
    ...guard,
    validate({ body: connectionSchema }),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const userId = req.user!.id;
      await assertCanPostBanking(userId, companyId);
      const client = getLeanClient();
      if (!client) throw notConfigured();
      const { state, entityId, externalAccountId, bankAccountId, autoSync } = req.body;
      const since = checkState(state, companyId, userId);

      const bank = await storage.getBankAccountById(bankAccountId);
      if (!bank || bank.companyId !== companyId) throw new AppError({ message: "Bank account not found", statusCode: 404, code: "BANK_ACCOUNT_NOT_FOUND" });

      const account = await asProviderFailure(
        (async () => {
          const owned = await assertEntityOwned(client, companyId, entityId, since);
          const accounts = await client.listAccounts(owned);
          return accounts.find((a) => a.externalId === externalAccountId);
        })()
      );
      if (!account) throw new AppError({ message: "That account is not part of this bank login.", statusCode: 403, code: "BANK_ENTITY_NOT_OWNED" });
      if (account.currency !== (bank.currency || "AED").toUpperCase()) {
        throw new AppError({ message: `The bank account is in ${account.currency} but this ledger bank account is in ${bank.currency}.`, statusCode: 422, code: "CURRENCY_MISMATCH" });
      }
      const dupe = await pool.query(
        `SELECT 1 FROM bank_connections WHERE company_id = $1 AND provider = 'lean' AND external_account_id = $2 AND status <> 'disconnected' LIMIT 1`,
        [companyId, externalAccountId]
      );
      if (dupe.rowCount) throw new AppError({ message: "This bank account is already connected.", statusCode: 409, code: "BANK_ACCOUNT_ALREADY_CONNECTED" });

      const created = await storage.createBankConnection({
        companyId,
        provider: "lean",
        connectionType: "open_banking",
        status: "active",
        bankName: account.bankName,
        accountName: account.name || bank.nameEn,
        accountNumberLast4: account.last4 || null,
        iban: account.iban || null,
        externalAccountId,
        bankAccountId,
        autoSync,
      } as any);
      await pool.query(`UPDATE bank_connections SET provider_entity_id = $2, environment = $3 WHERE id = $1`, [created.id, encryptSecret(entityId), client.environment]);
      await recordAudit({ userId, companyId, action: "bank.feed_connect", entityType: "bank_connection", entityId: created.id, after: { provider: "lean", bankAccountId, autoSync }, req });
      const fresh = await storage.getBankConnection(created.id);
      res.status(201).json(toPublicBankConnection(fresh ?? created));
    })
  );
}
