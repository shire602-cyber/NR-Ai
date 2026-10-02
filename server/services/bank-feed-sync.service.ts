// Pull booked transactions from a bank feed through the SAME import path as a file (bank-import.service): same
// de-duplication, same account checks, `external_id` = the provider's transaction id. Posts nothing.
//
// One sync per connection at a time (a lease on the row, 10 minutes). Three failed syncs in a row switch auto-sync off,
// mark the connection `error` and tell the owner. The hourly job syncs only connections with auto-sync on.

import { pool } from "../db";
import { AppError } from "../errors";
import { createLogger } from "../config/logger";
import { storage } from "../storage";
import { decryptSecret } from "./secret-vault";
import { createAndEmitNotification } from "./socket.service";
import { insertStatementLines, unprocessable, type ImportOutcome } from "./bank-import.service";
import { LeanClient, ProviderError, getLeanClient, mapLeanTransaction } from "./open-banking.service";
import type { ParsedStatementLine } from "./bank-statement-parsers";

const log = createLogger("bank-feed-sync");

export const SYNC_LEASE_MINUTES = 10;
export const MAX_CONSECUTIVE_FAILURES = 3;
export const SYNC_INTERVAL_MINUTES = 55;
const DEFAULT_LOOKBACK_DAYS = 30;
const OVERLAP_DAYS = 3;
const MAX_CONNECTIONS_PER_RUN = 100;

export interface DueCandidate {
  id: string;
  provider: string | null;
  status: string | null;
  autoSync: boolean | null;
  lastSyncedAt: Date | null;
  syncLeaseUntil: Date | null;
  consecutiveFailures: number | null;
}

/** Which connections the hourly job syncs: auto-sync on, active, not leased, under the failure limit, not synced very recently. Pure. */
export function selectDueConnections(rows: DueCandidate[], now: Date): string[] {
  return rows
    .filter((r) => r.provider === "lean" && r.status === "active" && r.autoSync === true)
    .filter((r) => (r.consecutiveFailures ?? 0) < MAX_CONSECUTIVE_FAILURES)
    .filter((r) => !r.syncLeaseUntil || r.syncLeaseUntil.getTime() < now.getTime())
    .filter((r) => !r.lastSyncedAt || now.getTime() - r.lastSyncedAt.getTime() >= SYNC_INTERVAL_MINUTES * 60_000)
    .map((r) => r.id);
}

const ymd = (d: Date): string => d.toISOString().slice(0, 10);

/** First day to ask the provider for: the requested day, else a few days before the last sync, else 30 days back. */
export function syncFromDay(args: { requested?: string | null; lastSyncedAt: Date | null; now: Date }): string {
  if (args.requested) return args.requested;
  const base = args.lastSyncedAt ? args.lastSyncedAt.getTime() - OVERLAP_DAYS * 86_400_000 : args.now.getTime() - DEFAULT_LOOKBACK_DAYS * 86_400_000;
  return ymd(new Date(base));
}

export interface SyncResult {
  imported: number;
  duplicates: number;
  total: number;
  lastSyncedAt: string;
}

async function acquireLease(connectionId: string): Promise<boolean> {
  const res = await pool.query(
    `UPDATE bank_connections SET sync_lease_until = now() + ($2 || ' minutes')::interval
      WHERE id = $1 AND (sync_lease_until IS NULL OR sync_lease_until < now()) RETURNING id`,
    [connectionId, String(SYNC_LEASE_MINUTES)]
  );
  return res.rowCount === 1;
}

const releaseLease = (connectionId: string) => pool.query(`UPDATE bank_connections SET sync_lease_until = NULL WHERE id = $1`, [connectionId]).catch(() => undefined);

async function notifyOwner(companyId: string, message: string): Promise<void> {
  try {
    const users = await storage.getCompanyUsersByCompanyId(companyId);
    const owner = users.find((u) => u.role === "owner") ?? users[0];
    if (!owner) return;
    await createAndEmitNotification({
      userId: owner.userId,
      companyId,
      type: "bank_feed_error",
      title: "Bank feed paused",
      message,
      priority: "high",
      relatedEntityType: "bank_connection",
      actionUrl: "/bank-reconciliation",
    } as any);
  } catch (err) {
    log.warn({ err: (err as Error).message }, "Could not notify the owner about a paused bank feed");
  }
}

async function recordFailure(connectionId: string, companyId: string): Promise<void> {
  const res = await pool.query(
    `UPDATE bank_connections
        SET consecutive_failures = consecutive_failures + 1, last_error = 'The bank provider could not be reached or refused the request.', updated_at = now()
      WHERE id = $1 RETURNING consecutive_failures`,
    [connectionId]
  );
  const failures = Number(res.rows[0]?.consecutive_failures ?? 0);
  if (failures >= MAX_CONSECUTIVE_FAILURES) {
    await pool.query(`UPDATE bank_connections SET auto_sync = false, status = 'error' WHERE id = $1`, [connectionId]);
    await notifyOwner(companyId, `Automatic sync of a bank feed was paused after ${failures} failed attempts. Reconnect or sync it manually.`);
  }
}

export async function syncConnection(args: { connectionId: string; companyId?: string; fromDate?: string | null; client?: LeanClient | null; now?: Date }): Promise<SyncResult> {
  const now = args.now ?? new Date();
  const connection = await storage.getBankConnection(args.connectionId);
  if (!connection || (args.companyId && connection.companyId !== args.companyId)) {
    throw new AppError({ message: "Bank connection not found", statusCode: 404, code: "BANK_CONNECTION_NOT_FOUND" });
  }
  if (connection.provider !== "lean" || connection.status === "disconnected") {
    throw new AppError({ message: "This connection does not support feed sync.", statusCode: 400, code: "SYNC_NOT_SUPPORTED" });
  }
  const bank = connection.bankAccountId ? await storage.getBankAccountById(connection.bankAccountId) : undefined;
  if (!bank || bank.companyId !== connection.companyId) {
    throw unprocessable("BANK_ACCOUNT_NOT_LINKED", "Link this connection to a bank account first.");
  }
  const entityId = decryptSecret((connection as any).providerEntityId);
  if (!entityId || !connection.externalAccountId) {
    throw new AppError({ message: "This connection has no linked bank account at the provider. Reconnect it.", statusCode: 409, code: "BANK_CONNECTION_INCOMPLETE" });
  }
  const client = args.client === undefined ? getLeanClient() : args.client;
  if (!client) throw new AppError({ message: "The bank feed provider is not configured.", statusCode: 400, code: "BANK_PROVIDER_NOT_CONFIGURED" });

  if (!(await acquireLease(connection.id))) {
    throw new AppError({ message: "A sync of this connection is already running.", statusCode: 409, code: "SYNC_IN_PROGRESS" });
  }
  try {
    const from = syncFromDay({ requested: args.fromDate, lastSyncedAt: connection.lastSyncedAt ?? null, now });
    const to = ymd(new Date(now.getTime() + 86_400_000));
    let rows: any[];
    try {
      rows = await client.listTransactions(entityId, connection.externalAccountId, from, to);
    } catch (err) {
      if (err instanceof ProviderError) await recordFailure(connection.id, connection.companyId);
      throw err;
    }

    const lines: ParsedStatementLine[] = [];
    const warnings: string[] = [];
    for (const raw of rows) {
      const mapped = mapLeanTransaction(raw);
      if (!mapped) continue;
      if (mapped.currency && mapped.currency !== (bank.currency || "AED").toUpperCase()) {
        warnings.push(`A ${mapped.currency} line was skipped: the bank account is in ${bank.currency}.`);
        continue;
      }
      lines.push(mapped.line);
    }

    let outcome: Pick<ImportOutcome, "imported" | "duplicates"> = { imported: 0, duplicates: 0 };
    if (lines.length > 0) {
      const days = lines.map((l) => l.date.getTime());
      outcome = await insertStatementLines({
        companyId: connection.companyId,
        userId: null,
        account: bank,
        source: "feed",
        lines,
        summary: { from: ymd(new Date(Math.min(...days))), to: ymd(new Date(Math.max(...days))), openingBalance: null, closingBalance: null, currency: bank.currency },
        parser: "lean",
        warnings,
      });
    }
    await pool.query(
      `UPDATE bank_connections SET last_synced_at = now(), consecutive_failures = 0, last_error = NULL, status = 'active', updated_at = now() WHERE id = $1`,
      [connection.id]
    );
    return { imported: outcome.imported, duplicates: outcome.duplicates, total: lines.length, lastSyncedAt: new Date().toISOString() };
  } finally {
    await releaseLease(connection.id);
  }
}

/** The hourly job: every due connection, one at a time, a failure never stops the rest. */
export async function runHourlyBankSync(now: Date = new Date()): Promise<{ synced: number; failed: number }> {
  if (!getLeanClient()) return { synced: 0, failed: 0 };
  const res = await pool.query(
    `SELECT bc.id, bc.provider, bc.status, bc.auto_sync, bc.last_synced_at, bc.sync_lease_until, bc.consecutive_failures
       FROM bank_connections bc JOIN companies c ON c.id = bc.company_id
      WHERE bc.provider = 'lean' AND bc.auto_sync = true AND bc.status = 'active' AND c.deleted_at IS NULL
      ORDER BY bc.last_synced_at NULLS FIRST LIMIT $1`,
    [MAX_CONNECTIONS_PER_RUN]
  );
  const due = selectDueConnections(
    res.rows.map((r: any) => ({
      id: r.id,
      provider: r.provider,
      status: r.status,
      autoSync: r.auto_sync,
      lastSyncedAt: r.last_synced_at ? new Date(r.last_synced_at) : null,
      syncLeaseUntil: r.sync_lease_until ? new Date(r.sync_lease_until) : null,
      consecutiveFailures: r.consecutive_failures,
    })),
    now
  );
  let synced = 0;
  let failed = 0;
  for (const id of due) {
    try {
      await syncConnection({ connectionId: id, now });
      synced++;
    } catch (err) {
      failed++;
      log.warn({ connectionId: id, err: (err as Error).message }, "Hourly bank sync failed");
    }
  }
  if (due.length) log.info({ due: due.length, synced, failed }, "Hourly bank sync finished");
  return { synced, failed };
}
