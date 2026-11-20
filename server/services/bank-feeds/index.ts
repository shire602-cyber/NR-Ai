/**
 * Bank feeds to the external boundary (W3-C: R06-14, R06-19).
 *
 *  - connect refuses with 503 BANK_FEED_NOT_CONFIGURED when the provider has no credentials
 *  - the OAuth state is random, stored as a SHA-256 hash, single-use, 10-minute expiry, bound to
 *    company + user + provider, and verified on callback (400 INVALID_OAUTH_STATE otherwise)
 *  - the redirect URI must be on an allow-list (BANK_FEED_REDIRECT_URIS, else FRONTEND_URL /
 *    AUTH_PUBLIC_URL + /bank-feeds/callback)
 *  - tokens are stored only through storage.createBankConnection / updateBankConnectionTokens,
 *    which encrypt with server/services/secret-vault.ts; API responses never include them
 *  - scheduled sync (job "bankFeeds.sync") dedupes by provider transaction id and emits
 *    bank.sync_failed on failure
 */
import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { db } from "../../db";
import { DomainError } from "../../errors";
import { storage } from "../../storage";
import { createLogger } from "../../config/logger";
import { getCapability, type CapabilityStatus } from "../../../shared/capabilities";
import { BANK_RECONCILIATION_COPY } from "../../../shared/bank-reconciliation-copy";
import { fromFils } from "../../../shared/money";
import {
  bankAccounts,
  bankConnections,
  bankFeedOauthStates,
  bankImportBatches,
  bankTransactions,
  type BankConnection,
} from "../../../shared/schema";
import type { BankFeedProviderId } from "../../../shared/validators/banking";
import { emitDomainEvent } from "../../platform/domain-events";
import { listJobs, registerJob } from "../../platform/job-registry";
import { BANK_FEED_ADAPTERS } from "./adapters";
import { BankFeedProviderError, type BankFeedAdapter, type FeedTokens } from "./types";

export { setBankFeedFetch } from "./http";
export { BANK_FEED_ADAPTERS } from "./adapters";
export type { BankFeedAdapter, FeedTokens, FeedTransaction, FeedAccount } from "./types";

const log = createLogger("bank-feeds");
const STATE_TTL_MS = 10 * 60 * 1000;

export function getAdapter(provider: string): BankFeedAdapter {
  const adapter = BANK_FEED_ADAPTERS[provider];
  if (!adapter) throw new DomainError("BANK_FEED_UNKNOWN_PROVIDER", 400);
  return adapter;
}

function assertConfigured(adapter: BankFeedAdapter): void {
  if (!adapter.isConfigured()) {
    throw new DomainError(
      "BANK_FEED_NOT_CONFIGURED",
      503,
      { provider: adapter.id, capability: adapter.capability },
      BANK_RECONCILIATION_COPY.en
    );
  }
}

export interface ProviderStatus {
  id: BankFeedProviderId;
  label: string;
  configured: boolean;
  status: CapabilityStatus;
  message: { en: string; ar: string };
  externalAction: { en: string; ar: string };
}

/** Honest status per provider, from shared/capabilities.ts. */
export function providerStatuses(): ProviderStatus[] {
  return Object.values(BANK_FEED_ADAPTERS).map((a) => {
    const cap = getCapability(a.capability);
    const configured = a.isConfigured();
    return {
      id: a.id,
      label: a.label,
      configured,
      status: configured ? cap.status : "requires_external",
      message: configured
        ? cap.status === "sandbox"
          ? {
              en: "Sandbox credentials — test data only",
              ar: "بيانات اعتماد تجريبية — بيانات اختبار فقط",
            }
          : { en: "Configured", ar: "مُعد" }
        : BANK_RECONCILIATION_COPY,
      externalAction: cap.externalAction,
    };
  });
}

/** Exact redirect URIs the connect flow may send the user back to. */
export function allowedRedirectUris(): string[] {
  const explicit = (process.env.BANK_FEED_REDIRECT_URIS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (explicit.length) return explicit;
  const out: string[] = [];
  for (const base of [process.env.FRONTEND_URL, process.env.AUTH_PUBLIC_URL]) {
    if (!base) continue;
    try {
      out.push(new URL("/bank-feeds/callback", base).toString());
    } catch {
      /* ignore malformed env */
    }
  }
  return out;
}

function assertAllowedRedirect(uri: string): void {
  const allowed = allowedRedirectUris();
  if (!allowed.includes(uri)) {
    throw new DomainError(
      "REDIRECT_URI_NOT_ALLOWED",
      400,
      { allowed },
      BANK_RECONCILIATION_COPY.en
    );
  }
}

const hashState = (state: string) => createHash("sha256").update(state).digest("hex");

export async function startConnect(input: {
  companyId: string;
  userId: string;
  provider: BankFeedProviderId;
  redirectUrl: string;
  bankAccountId?: string;
}): Promise<{ authUrl: string; state: string; expiresAt: string; provider: string }> {
  const adapter = getAdapter(input.provider);
  assertConfigured(adapter);
  assertAllowedRedirect(input.redirectUrl);
  if (input.bankAccountId) {
    const ba = await storage.getBankAccountById(input.bankAccountId, input.companyId);
    if (!ba) throw new DomainError("BANK_ACCOUNT_NOT_FOUND", 404);
  }
  const state = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + STATE_TTL_MS);
  await db.insert(bankFeedOauthStates).values({
    companyId: input.companyId,
    userId: input.userId,
    provider: adapter.id,
    stateHash: hashState(state),
    redirectUri: input.redirectUrl,
    bankAccountId: input.bankAccountId ?? null,
    expiresAt,
  });
  return {
    authUrl: adapter.authorizeUrl({ state, redirectUri: input.redirectUrl }),
    state,
    expiresAt: expiresAt.toISOString(),
    provider: adapter.id,
  };
}

/** Public view of a connection: never the tokens. */
export function sanitizeConnection(c: BankConnection) {
  const { accessToken: _a, refreshToken: _r, ...rest } = c;
  void _a;
  void _r;
  return { ...rest, hasToken: Boolean(c.accessToken) };
}

export async function completeCallback(input: {
  companyId: string;
  userId: string;
  provider: BankFeedProviderId;
  code: string;
  state: string;
}): Promise<{ connections: ReturnType<typeof sanitizeConnection>[] }> {
  const adapter = getAdapter(input.provider);
  // Consume the state first (single use), then check configuration.
  const [row] = await db
    .update(bankFeedOauthStates)
    .set({ usedAt: new Date() })
    .where(
      and(
        eq(bankFeedOauthStates.stateHash, hashState(input.state)),
        eq(bankFeedOauthStates.companyId, input.companyId),
        eq(bankFeedOauthStates.userId, input.userId),
        eq(bankFeedOauthStates.provider, adapter.id),
        isNull(bankFeedOauthStates.usedAt),
        gt(bankFeedOauthStates.expiresAt, new Date())
      )
    )
    .returning();
  if (!row) {
    throw new DomainError("INVALID_OAUTH_STATE", 400, undefined, BANK_RECONCILIATION_COPY.en);
  }
  assertConfigured(adapter);
  let tokens: FeedTokens;
  let accounts;
  try {
    tokens = await adapter.exchangeCode({ code: input.code, redirectUri: row.redirectUri });
    accounts = await adapter.listAccounts(tokens);
  } catch (err) {
    throw providerFailure(adapter, err);
  }
  if (accounts.length === 0) throw new DomainError("BANK_FEED_NO_ACCOUNTS", 422);
  const out = [];
  for (const account of accounts) {
    const connection = await storage.createBankConnection({
      companyId: input.companyId,
      provider: adapter.id,
      connectionType: "open_banking",
      bankName: account.bankName,
      accountName: account.name,
      bankAccountId: accounts.length === 1 ? row.bankAccountId : null,
      externalAccountId: account.externalId,
      accountNumberLast4: account.last4,
      iban: account.iban,
      consentId: tokens.consentId ?? null,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      tokenExpiresAt: tokens.expiresAt,
      autoSync: true,
      status: "active",
    });
    out.push(sanitizeConnection(connection));
  }
  return { connections: out };
}

function providerFailure(adapter: BankFeedAdapter, err: unknown): DomainError {
  const status = err instanceof BankFeedProviderError ? err.status : 0;
  log.warn(
    { provider: adapter.id, status, err: (err as Error).message },
    "Bank feed provider call failed"
  );
  return new DomainError(
    "BANK_FEED_PROVIDER_ERROR",
    502,
    { provider: adapter.id, providerStatus: status },
    BANK_RECONCILIATION_COPY.en
  );
}

export interface SyncResult {
  connectionId: string;
  fetched: number;
  imported: number;
  duplicates: number;
  rejected: number;
  batchId: string | null;
}

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
}

/** Sync one connection. Duplicates (same provider transaction id) are skipped. */
export async function syncConnection(
  connection: BankConnection,
  opts: { from?: string; to?: string; actorId?: string | null } = {}
): Promise<SyncResult> {
  const adapter = getAdapter(connection.provider);
  assertConfigured(adapter);
  if (!connection.bankAccountId) {
    throw new DomainError(
      "BANK_FEED_ACCOUNT_NOT_LINKED",
      409,
      undefined,
      BANK_RECONCILIATION_COPY.en
    );
  }
  const ba = await storage.getBankAccountById(connection.bankAccountId, connection.companyId);
  if (!ba) throw new DomainError("BANK_ACCOUNT_NOT_FOUND", 404);
  if (!connection.accessToken || !connection.externalAccountId) {
    throw new DomainError("BANK_FEED_RECONNECT_REQUIRED", 409);
  }
  let tokens: FeedTokens = {
    accessToken: connection.accessToken,
    refreshToken: connection.refreshToken,
    expiresAt: connection.tokenExpiresAt,
  };
  try {
    if (tokens.expiresAt && tokens.expiresAt.getTime() - Date.now() < 5 * 60 * 1000) {
      const refreshed = await adapter.refresh(tokens);
      if (refreshed) {
        tokens = refreshed;
        await storage.updateBankConnectionTokens(connection.id, {
          accessToken: refreshed.accessToken,
          refreshToken: refreshed.refreshToken,
          tokenExpiresAt: refreshed.expiresAt,
        });
      }
    }
    const from =
      opts.from ??
      (connection.lastSyncedAt
        ? connection.lastSyncedAt.toISOString().slice(0, 10)
        : isoDaysAgo(30));
    const to = opts.to ?? new Date().toISOString().slice(0, 10);
    const { transactions, rejected } = await adapter.fetchTransactions(
      tokens,
      connection.externalAccountId,
      from,
      to
    );
    const [batch] = await db
      .insert(bankImportBatches)
      .values({
        companyId: connection.companyId,
        bankAccountId: ba.id,
        source: "feed",
        fileName: `${adapter.label} ${from}..${to}`,
        format: adapter.id,
        rowCount: transactions.length + rejected.length,
        createdBy: opts.actorId ?? null,
      })
      .returning();
    let imported = 0;
    if (transactions.length > 0) {
      const rows = await db
        .insert(bankTransactions)
        .values(
          transactions.map((t) => ({
            companyId: connection.companyId,
            bankConnectionId: connection.id,
            bankStatementAccountId: ba.id,
            bankAccountId: ba.glAccountId,
            transactionDate: new Date(`${t.date}T00:00:00.000Z`),
            description: t.description,
            amount: Number(fromFils(t.amountFils)),
            balance: t.balanceFils === null ? null : Number(fromFils(t.balanceFils)),
            reference: t.reference,
            externalId: t.externalId,
            importSource: "api",
            importBatchId: batch.id,
            matchStatus: "unmatched",
            isReconciled: false,
          }))
        )
        .onConflictDoNothing()
        .returning({ id: bankTransactions.id });
      imported = rows.length;
    }
    await db
      .update(bankImportBatches)
      .set({
        importedCount: imported,
        skippedCount: transactions.length - imported + rejected.length,
      })
      .where(eq(bankImportBatches.id, batch.id));
    await storage.updateBankConnection(connection.id, {
      lastSyncedAt: new Date(),
      status: "active",
      lastError: null,
    });
    return {
      connectionId: connection.id,
      fetched: transactions.length,
      imported,
      duplicates: transactions.length - imported,
      rejected: rejected.length,
      batchId: batch.id,
    };
  } catch (err) {
    if (err instanceof DomainError && err.statusCode < 500) throw err;
    const reason = err instanceof BankFeedProviderError ? `HTTP ${err.status}` : "sync_error";
    await storage.updateBankConnectionTokens(connection.id, {
      status: "error",
      lastError: `Sync failed (${reason}). Reconnect if this persists.`,
    });
    emitDomainEvent("bank.sync_failed", {
      companyId: connection.companyId,
      entityId: connection.id,
      provider: adapter.id,
      reason,
    });
    throw err instanceof DomainError ? err : providerFailure(adapter, err);
  }
}

/** Scheduled sync: every active, auto-sync feed whose provider is configured. */
export async function runScheduledBankFeedSync(): Promise<{ synced: number; failed: number }> {
  const rows: BankConnection[] = await db
    .select()
    .from(bankConnections)
    .where(
      and(
        eq(bankConnections.autoSync, true),
        eq(bankConnections.status, "active"),
        sql`${bankConnections.provider} IN ('lean', 'tarabut', 'wio')`
      )
    );
  let synced = 0;
  let failed = 0;
  for (const raw of rows) {
    const adapter = BANK_FEED_ADAPTERS[raw.provider];
    if (!adapter?.isConfigured() || !raw.bankAccountId) continue;
    const connection = await storage.getBankConnection(raw.id);
    if (!connection) continue;
    try {
      await syncConnection(connection);
      synced++;
    } catch (err) {
      failed++;
      log.warn(
        { connectionId: raw.id, err: (err as Error).message },
        "Scheduled bank feed sync failed"
      );
    }
  }
  return { synced, failed };
}

export function registerBankFeedJobs(): void {
  if (listJobs().some((j) => j.name === "bankFeeds.sync")) return;
  registerJob({
    name: "bankFeeds.sync",
    cron: "41 */6 * * *",
    description: "Sync configured open-banking feeds (dedupe by provider transaction id)",
    run: async () => {
      await runScheduledBankFeedSync();
    },
  });
}

/** Link a feed connection to a managed bank account of the same company. */
export async function linkConnection(
  companyId: string,
  connectionId: string,
  bankAccountId: string
): Promise<BankConnection> {
  const [ba] = await db
    .select({ id: bankAccounts.id })
    .from(bankAccounts)
    .where(and(eq(bankAccounts.id, bankAccountId), eq(bankAccounts.companyId, companyId)));
  if (!ba) throw new DomainError("BANK_ACCOUNT_NOT_FOUND", 404);
  const updated = await storage.updateBankConnection(connectionId, { bankAccountId });
  if (!updated) throw new DomainError("BANK_CONNECTION_NOT_FOUND", 404);
  return updated;
}
