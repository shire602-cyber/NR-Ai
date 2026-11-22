/**
 * Financial-data adapter processing (W3-C: R06-14, R06-19).
 *
 *  - authorization requires processor configuration (503 BANK_FEED_NOT_CONFIGURED otherwise)
 *  - the OAuth state is random, stored as a SHA-256 hash, single-use, 10-minute expiry, bound to
 *    company + user + provider, and verified on callback (400 INVALID_OAUTH_STATE otherwise)
 *  - the redirect URI must be on an allow-list (BANK_FEED_REDIRECT_URIS, else FRONTEND_URL /
 *    AUTH_PUBLIC_URL + the registered authorization return paths)
 *  - tokens are stored only through storage.createBankConnection / updateBankConnectionTokens,
 *    which encrypt with server/services/secret-vault.ts; API responses never include them
 *  - scheduled processing (job "bankFeeds.sync") deduplicates by external transaction ID
 *    and emits bank.sync_failed on failure
 */
import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { Store } from "express-session";
import { and, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import { db } from "../../db";
import { DomainError } from "../../errors";
import { storage } from "../../storage";
import { createLogger } from "../../config/logger";
import { bankStatementCopy } from "../../../shared/bank-statement-copy";
import {
  BANK_AUTHORIZATION_RETURN_PATH,
  LEGACY_BANK_AUTHORIZATION_RETURN_PATH,
} from "../../../shared/bank-authorization-paths";
import { getCapability, type CapabilityStatus } from "../../../shared/capabilities";
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
import {
  BankFeedProviderError,
  type BankFeedAdapter,
  type FeedAccount,
  type FeedTokens,
} from "./types";
import { readReturnSession, writeReturnSession } from "./return-session";

export { setBankFeedFetch } from "./http";
export { BANK_FEED_ADAPTERS } from "./adapters";
export type { BankFeedAdapter, FeedTokens, FeedTransaction, FeedAccount } from "./types";

const log = createLogger("financial-data-adapters");
const STATE_TTL_MS = 10 * 60 * 1000;

export function getAdapter(provider: string): BankFeedAdapter {
  const adapter = BANK_FEED_ADAPTERS[provider];
  if (!adapter)
    throw new DomainError("BANK_FEED_UNKNOWN_PROVIDER", 400, undefined, bankStatementCopy.en);
  return adapter;
}

function assertConfigured(adapter: BankFeedAdapter): void {
  if (!adapter.isConfigured()) {
    throw new DomainError(
      "BANK_FEED_NOT_CONFIGURED",
      503,
      { provider: adapter.id, capability: adapter.capability },
      bankStatementCopy.en
    );
  }
}

export interface ProviderStatus {
  id: BankFeedProviderId;
  configured: boolean;
  status: CapabilityStatus;
}

/** Customer readiness fields for each provider. */
export function providerStatuses(): ProviderStatus[] {
  return Object.values(BANK_FEED_ADAPTERS).map((a) => {
    const cap = getCapability(a.capability);
    const configured = a.isConfigured();
    return {
      id: a.id,
      configured,
      status: configured ? cap.status : "requires_external",
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
      out.push(
        new URL(BANK_AUTHORIZATION_RETURN_PATH, base).toString(),
        new URL(LEGACY_BANK_AUTHORIZATION_RETURN_PATH, base).toString()
      );
    } catch {
      /* ignore malformed env */
    }
  }
  return out;
}

function assertAllowedRedirect(uri: string): void {
  const allowed = allowedRedirectUris();
  if (!allowed.includes(uri)) {
    throw new DomainError("REDIRECT_URI_NOT_ALLOWED", 400, { allowed }, bankStatementCopy.en);
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
  return {
    ...rest,
    lastError: c.lastError ? bankStatementCopy.en : null,
    hasToken: Boolean(c.accessToken),
  };
}

type CallbackStateScope = {
  userId: string;
  provider?: BankFeedProviderId;
  state: string;
};

function unexpiredCallbackState(state: string) {
  return and(
    eq(bankFeedOauthStates.stateHash, hashState(state)),
    gt(bankFeedOauthStates.expiresAt, new Date())
  );
}

export async function pendingCallbackExpiry(state: string): Promise<Date | undefined> {
  const [row] = await db
    .select({ expiresAt: bankFeedOauthStates.expiresAt })
    .from(bankFeedOauthStates)
    .where(and(unexpiredCallbackState(state), isNull(bankFeedOauthStates.usedAt)))
    .limit(1);
  return row?.expiresAt;
}

function activeCallbackState(input: CallbackStateScope) {
  return and(
    unexpiredCallbackState(input.state),
    eq(bankFeedOauthStates.userId, input.userId),
    input.provider ? eq(bankFeedOauthStates.provider, input.provider) : undefined
  );
}

export async function resolveCallbackCompany(input: CallbackStateScope): Promise<string> {
  const [row] = await db
    .select({ companyId: bankFeedOauthStates.companyId })
    .from(bankFeedOauthStates)
    .where(activeCallbackState(input))
    .limit(1);
  if (!row) throw new DomainError("INVALID_OAUTH_STATE", 400, undefined, bankStatementCopy.en);
  return row.companyId;
}

export type CallbackResult = { connections: ReturnType<typeof sanitizeConnection>[] };
type StoredTokens = Omit<FeedTokens, "expiresAt"> & { expiresAt: string | null };
type PreparedAccount = FeedAccount & { id: string };
type CallbackProgress = { codeHash: string } & (
  | { kind: "exchanging"; startedAt: number }
  | { kind: "restart" }
  | { kind: "exchanged"; tokens: StoredTokens }
  | { kind: "discovering"; tokens: StoredTokens; startedAt: number; claimId: string }
  | { kind: "prepared"; tokens: StoredTokens; accounts: PreparedAccount[] }
  | { kind: "completed"; ids: string[] }
);

function invalidCallbackState(): DomainError {
  return new DomainError("INVALID_OAUTH_STATE", 400, undefined, bankStatementCopy.en);
}

export async function completeCallback(
  input: CallbackStateScope & { companyId: string; code: string },
  store: Store,
  allowReplay = false
): Promise<CallbackResult> {
  const codeHash = hashState(input.code);
  const key = `statement-progress:${hashState(input.state)}`;
  const scoped = () =>
    and(activeCallbackState(input), eq(bankFeedOauthStates.companyId, input.companyId));
  const assertCode = (progress: CallbackProgress | undefined) => {
    if (progress && progress.codeHash !== codeHash) throw invalidCallbackState();
  };

  // A durable claim precedes the external request, with the DB lock released during HTTP.
  const { row, previous } = await db.transaction(async (tx) => {
    const [row] = await tx.select().from(bankFeedOauthStates).where(scoped()).for("update");
    if (!row || (row.usedAt && !allowReplay)) throw invalidCallbackState();
    const previous = await readReturnSession<CallbackProgress>(store, key);
    assertCode(previous);
    if (!previous) {
      if (row.usedAt) throw invalidCallbackState();
      assertConfigured(getAdapter(row.provider));
      await writeReturnSession(
        store,
        key,
        { codeHash, kind: "exchanging", startedAt: Date.now() },
        row.expiresAt
      );
    }
    return { row, previous };
  });

  let progress = previous;
  const saveProgress = (value: CallbackProgress) =>
    writeReturnSession(store, key, value, row.expiresAt);

  if (!progress) {
    const adapter = getAdapter(row.provider);
    let received: FeedTokens;
    try {
      received = await adapter.exchangeCode({ code: input.code, redirectUri: row.redirectUri });
    } catch (err) {
      await saveProgress({ codeHash, kind: "restart" });
      throw providerFailure(adapter, err);
    }
    progress = {
      codeHash,
      kind: "exchanged",
      tokens: { ...received, expiresAt: received.expiresAt?.toISOString() ?? null },
    };
    await saveProgress(progress);
  }

  if (progress.kind === "exchanging") {
    if (!allowReplay) throw invalidCallbackState();
    if (Date.now() - progress.startedAt < 60_000) {
      throw new DomainError("AUTHORIZATION_RETRY", 503, undefined, bankStatementCopy.en);
    }
    throw new DomainError("AUTHORIZATION_RESTART", 409, undefined, bankStatementCopy.en);
  }
  if (progress.kind === "restart") {
    throw new DomainError("AUTHORIZATION_RESTART", 409, undefined, bankStatementCopy.en);
  }

  let result: { ids: string[]; connections: CallbackResult["connections"] };
  try {
    const discovery = await db.transaction(async (tx) => {
      const [current] = await tx.select().from(bankFeedOauthStates).where(scoped()).for("update");
      if (!current) throw invalidCallbackState();
      const saved = await readReturnSession<CallbackProgress>(store, key);
      assertCode(saved);
      if (current.usedAt || saved?.kind === "prepared") return;
      if (saved?.kind !== "exchanged" && saved?.kind !== "discovering") {
        throw invalidCallbackState();
      }
      if (saved.kind === "discovering" && Date.now() - saved.startedAt < 60_000) {
        if (!allowReplay) throw invalidCallbackState();
        throw new DomainError("AUTHORIZATION_RETRY", 503, undefined, bankStatementCopy.en);
      }
      const claim = {
        codeHash,
        kind: "discovering" as const,
        tokens: saved.tokens,
        startedAt: Date.now(),
        claimId: randomUUID(),
      };
      await saveProgress(claim);
      return claim;
    });

    if (discovery) {
      // Only the claim and its outcome need the row lock. The provider request can be slow.
      const adapter = getAdapter(row.provider);
      const { expiresAt, ...tokens } = discovery.tokens;
      let accounts: FeedAccount[] | undefined;
      let failure: DomainError | undefined;
      try {
        accounts = await adapter.listAccounts({
          ...tokens,
          expiresAt: expiresAt ? new Date(expiresAt) : null,
        });
      } catch (err) {
        failure = providerFailure(adapter, err);
      }
      await db.transaction(async (tx) => {
        const [current] = await tx.select().from(bankFeedOauthStates).where(scoped()).for("update");
        if (!current) {
          throw new DomainError("AUTHORIZATION_RESTART", 409, undefined, bankStatementCopy.en);
        }
        const saved = await readReturnSession<CallbackProgress>(store, key);
        if (saved?.kind !== "discovering" || saved.claimId !== discovery.claimId) {
          throw new DomainError("AUTHORIZATION_RETRY", 503, undefined, bankStatementCopy.en);
        }
        if (accounts?.length) {
          // Persist result IDs even if a later account write rolls back.
          await saveProgress({
            codeHash,
            kind: "prepared",
            tokens: saved.tokens,
            accounts: accounts.map((item) => ({ ...item, id: randomUUID() })),
          });
        } else {
          await saveProgress({ codeHash, kind: "exchanged", tokens: saved.tokens });
        }
      });
      if (failure) throw failure;
      if (!accounts?.length) {
        throw new DomainError("BANK_FEED_NO_ACCOUNTS", 422, undefined, bankStatementCopy.en);
      }
    }

    result = await db.transaction(async (tx) => {
      const [current] = await tx.select().from(bankFeedOauthStates).where(scoped()).for("update");
      if (!current) throw invalidCallbackState();
      const saved = await readReturnSession<CallbackProgress>(store, key);
      assertCode(saved);
      if (current.usedAt) {
        if (!allowReplay || (saved?.kind !== "completed" && saved?.kind !== "prepared")) {
          throw invalidCallbackState();
        }
        const ids = saved.kind === "completed" ? saved.ids : saved.accounts.map((item) => item.id);
        const connections = await tx
          .select()
          .from(bankConnections)
          .where(
            and(eq(bankConnections.companyId, row.companyId), inArray(bankConnections.id, ids))
          );
        const byId = new Map(connections.map((item) => [item.id, sanitizeConnection(item)]));
        return { ids, connections: ids.flatMap((id) => byId.get(id) ?? []) };
      }

      if (saved?.kind !== "prepared") throw invalidCallbackState();
      const prepared = saved;

      const connections: CallbackResult["connections"] = [];
      for (const account of prepared.accounts) {
        const connection = await storage.createBankConnection(
          {
            id: account.id,
            companyId: input.companyId,
            provider: row.provider,
            connectionType: "open_banking",
            bankName: account.bankName,
            accountName: account.name,
            bankAccountId: prepared.accounts.length === 1 ? row.bankAccountId : null,
            externalAccountId: account.externalId,
            accountNumberLast4: account.last4,
            iban: account.iban,
            consentId: prepared.tokens.consentId ?? null,
            accessToken: prepared.tokens.accessToken,
            refreshToken: prepared.tokens.refreshToken,
            tokenExpiresAt: prepared.tokens.expiresAt ? new Date(prepared.tokens.expiresAt) : null,
            autoSync: true,
            status: "active",
          },
          tx
        );
        connections.push(sanitizeConnection(connection));
      }
      await tx
        .update(bankFeedOauthStates)
        .set({ usedAt: new Date() })
        .where(eq(bankFeedOauthStates.id, row.id));
      return { ids: prepared.accounts.map((item) => item.id), connections };
    });
  } catch (err) {
    if (err instanceof DomainError) throw err;
    throw new DomainError("AUTHORIZATION_RETRY", 503, undefined, bankStatementCopy.en);
  }

  // IDs and usedAt already recover a committed result if this cleanup is unavailable.
  await saveProgress({ codeHash, kind: "completed", ids: result.ids }).catch(() =>
    log.warn("Could not replace authorization snapshot with completed IDs")
  );
  return { connections: result.connections };
}

function providerFailure(adapter: BankFeedAdapter, err: unknown): DomainError {
  const status = err instanceof BankFeedProviderError ? err.status : 0;
  log.warn({ provider: adapter.id, status }, "Financial-data adapter request failed");
  return new DomainError(
    "BANK_FEED_PROVIDER_ERROR",
    502,
    { provider: adapter.id, providerStatus: status },
    bankStatementCopy.en
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

/** Process statement transactions, deduplicating by external transaction ID. */
export async function syncConnection(
  connection: BankConnection,
  opts: { from?: string; to?: string; actorId?: string | null } = {}
): Promise<SyncResult> {
  const adapter = getAdapter(connection.provider);
  assertConfigured(adapter);
  if (!connection.bankAccountId) {
    throw new DomainError("BANK_FEED_ACCOUNT_NOT_LINKED", 409, undefined, bankStatementCopy.en);
  }
  const ba = await storage.getBankAccountById(connection.bankAccountId, connection.companyId);
  if (!ba) throw new DomainError("BANK_ACCOUNT_NOT_FOUND", 404);
  if (!connection.accessToken || !connection.externalAccountId) {
    throw new DomainError("BANK_FEED_RECONNECT_REQUIRED", 409, undefined, bankStatementCopy.en);
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
      lastError: bankStatementCopy.en,
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

/** Process transactions for active, opted-in authorizations with a configured adapter. */
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
        { connectionId: raw.id, code: err instanceof DomainError ? err.code : undefined },
        "Scheduled transaction processing failed"
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
    description: "Refresh transactions for existing configured connections",
    run: async () => {
      await runScheduledBankFeedSync();
    },
  });
}

/** Associate an import source with an account in the same company. */
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
  if (!updated)
    throw new DomainError("BANK_CONNECTION_NOT_FOUND", 404, undefined, bankStatementCopy.en);
  return updated;
}
