// A company's connection to the payment provider (Phase 8 D1): Stripe Connect Standard onboarding, settings, status.
// Owner only: connecting, changing settings and disconnecting decide where a company's customers' money goes.

import { and, eq } from "drizzle-orm";
import { db } from "../../db";
import { paymentGatewayConnections, type PaymentGatewayConnection } from "../../../shared/schema";
import { storage } from "../../storage";
import { AppError } from "../../errors";
import { getEnv } from "../../config/env";
import { createLogger } from "../../config/logger";
import { gatewayMode, getGatewayProvider } from "./index";
import { hashState, signState, verifyState } from "./state";

const log = createLogger("gateway-connection");
const PROVIDER = "stripe";
const refuse = (statusCode: number, code: string, message: string) => new AppError({ message, statusCode, code });

/** 403 OWNER_ONLY unless the user is the company's owner (storage.getUserRole, like team management). */
export async function assertCompanyOwner(companyId: string, userId: string): Promise<void> {
  const role = await storage.getUserRole(companyId, userId);
  if (!role || role.role !== "owner") {
    throw refuse(403, "OWNER_ONLY", "Only the company owner can change online payment settings.");
  }
}

async function loadConnection(companyId: string): Promise<PaymentGatewayConnection | null> {
  const [row] = await db
    .select()
    .from(paymentGatewayConnections)
    .where(and(eq(paymentGatewayConnections.companyId, companyId), eq(paymentGatewayConnections.provider, PROVIDER)));
  return row ?? null;
}

const mask = (accountId: string | null) => (accountId ? `${accountId.slice(0, 5)}…${accountId.slice(-4)}` : null);

export interface GatewayStatus {
  /** Keys are set on this server: the provider can be used at all. */
  configured: boolean;
  mode: "stripe" | "fake" | "none";
  connection: null | { status: string; accountId: string | null; livemode: boolean; connectedAt: Date | null };
  allowPartial: boolean;
  enabled: boolean;
  /** Customers can pay this company's invoices online right now. */
  ready: boolean;
}

export async function getGatewayStatus(companyId: string): Promise<GatewayStatus> {
  const provider = getGatewayProvider();
  const conn = await loadConnection(companyId);
  const active = conn?.status === "active";
  return {
    configured: !!provider,
    mode: gatewayMode(),
    connection: conn ? { status: conn.status, accountId: mask(conn.externalAccountId), livemode: conn.livemode, connectedAt: conn.connectedAt } : null,
    allowPartial: conn?.allowPartial ?? false,
    enabled: conn?.enabled ?? true,
    ready: !!provider && active && (conn?.enabled ?? false),
  };
}

/** The active, enabled connection of a company, or null (online payment off for it). */
export async function getReadyConnection(companyId: string): Promise<PaymentGatewayConnection | null> {
  if (!getGatewayProvider()) return null;
  const conn = await loadConnection(companyId);
  return conn && conn.status === "active" && conn.enabled && conn.externalAccountId ? conn : null;
}

export async function findActiveConnectionByAccount(accountId: string): Promise<PaymentGatewayConnection | null> {
  const [row] = await db
    .select()
    .from(paymentGatewayConnections)
    .where(
      and(
        eq(paymentGatewayConnections.provider, PROVIDER),
        eq(paymentGatewayConnections.externalAccountId, accountId),
        eq(paymentGatewayConnections.status, "active")
      )
    );
  return row ?? null;
}

export async function startConnect(args: { companyId: string; userId: string; callbackUrl: string }): Promise<{ url: string }> {
  const provider = getGatewayProvider();
  if (!provider) throw refuse(503, "PAYMENT_NOT_CONFIGURED", "Online payment is not configured on this server.");
  await assertCompanyOwner(args.companyId, args.userId);
  const existing = await loadConnection(args.companyId);
  if (existing?.status === "active") throw refuse(409, "ALREADY_CONNECTED", "A Stripe account is already connected. Disconnect it first.");
  const state = signState({ companyId: args.companyId, userId: args.userId, secret: getEnv().SESSION_SECRET });
  const values = { companyId: args.companyId, provider: PROVIDER, status: "pending", stateHash: hashState(state), connectedBy: args.userId, updatedAt: new Date() };
  if (existing) {
    await db.update(paymentGatewayConnections).set(values as any).where(eq(paymentGatewayConnections.id, existing.id));
  } else {
    await db.insert(paymentGatewayConnections).values(values as any);
  }
  return { url: provider.oauthAuthorizeUrl({ state, redirectUri: args.callbackUrl }) };
}

export type ConnectOutcome = { ok: true; companyId: string } | { ok: false; reason: string; companyId?: string };

/** The provider redirected the owner back with a code: verify the signed state, exchange the code, activate. */
export async function completeConnect(args: { code: string; state: string }): Promise<ConnectOutcome> {
  const provider = getGatewayProvider();
  if (!provider) return { ok: false, reason: "not_configured" };
  const checked = verifyState(args.state, getEnv().SESSION_SECRET);
  if (!checked.ok) return { ok: false, reason: checked.reason };
  const conn = await loadConnection(checked.companyId);
  if (!conn || conn.status !== "pending" || conn.stateHash !== hashState(args.state)) {
    return { ok: false, reason: "state_not_pending", companyId: checked.companyId };
  }
  // Re-check the user is still the owner (roles can change within the 10 minutes).
  try {
    await assertCompanyOwner(checked.companyId, checked.userId);
  } catch {
    return { ok: false, reason: "not_owner", companyId: checked.companyId };
  }
  let account;
  try {
    account = await provider.exchangeOAuthCode(args.code);
  } catch (err: any) {
    log.warn({ err: err?.message }, "Stripe OAuth exchange failed");
    return { ok: false, reason: "exchange_failed", companyId: checked.companyId };
  }
  try {
    await db
      .update(paymentGatewayConnections)
      .set({
        externalAccountId: account.accountId,
        status: "active",
        livemode: account.livemode,
        stateHash: null, // one use
        connectedAt: new Date(),
        updatedAt: new Date(),
      } as any)
      .where(eq(paymentGatewayConnections.id, conn.id));
  } catch (err: any) {
    // The unique index: this Stripe account is already connected to another company.
    if (err?.code === "23505" || err?.cause?.code === "23505") return { ok: false, reason: "account_in_use", companyId: checked.companyId };
    throw err;
  }
  return { ok: true, companyId: checked.companyId };
}

export async function updateSettings(args: { companyId: string; userId: string; allowPartial?: boolean; enabled?: boolean }) {
  await assertCompanyOwner(args.companyId, args.userId);
  const conn = await loadConnection(args.companyId);
  if (!conn) throw refuse(409, "NOT_CONNECTED", "Connect a Stripe account first.");
  await db
    .update(paymentGatewayConnections)
    .set({
      ...(args.allowPartial !== undefined ? { allowPartial: args.allowPartial } : {}),
      ...(args.enabled !== undefined ? { enabled: args.enabled } : {}),
      updatedAt: new Date(),
    } as any)
    .where(eq(paymentGatewayConnections.id, conn.id));
  return getGatewayStatus(args.companyId);
}

export async function disconnect(args: { companyId: string; userId: string }) {
  await assertCompanyOwner(args.companyId, args.userId);
  const conn = await loadConnection(args.companyId);
  if (!conn) return getGatewayStatus(args.companyId);
  const provider = getGatewayProvider();
  if (provider && conn.externalAccountId && conn.status === "active") {
    await provider.deauthorize(conn.externalAccountId).catch((err) => log.warn({ err: err?.message }, "Stripe deauthorize failed; marking revoked anyway"));
  }
  await db
    .update(paymentGatewayConnections)
    .set({ status: "revoked", stateHash: null, updatedAt: new Date() } as any)
    .where(eq(paymentGatewayConnections.id, conn.id));
  return getGatewayStatus(args.companyId);
}

/** The company revoked access on Stripe's side (account.application.deauthorized). */
export async function markRevokedByAccount(accountId: string): Promise<boolean> {
  const rows = await db
    .update(paymentGatewayConnections)
    .set({ status: "revoked", updatedAt: new Date() } as any)
    .where(
      and(
        eq(paymentGatewayConnections.provider, PROVIDER),
        eq(paymentGatewayConnections.externalAccountId, accountId),
        eq(paymentGatewayConnections.status, "active")
      )
    )
    .returning({ id: paymentGatewayConnections.id });
  return rows.length > 0;
}
