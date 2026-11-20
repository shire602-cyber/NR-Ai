/**
 * E-commerce integrations (W5-B, R19-03, R19-08, R19-14).
 *
 * Real adapters to the external boundary — nothing is "simulated":
 *   shopify         merchant Admin API token; orders -> draft invoices, refunds -> draft credit notes
 *   stripe_payouts  merchant secret/restricted key; balance transactions -> bank-style lines
 *
 * A connection is stored only after the platform accepted the credentials
 * (connection_status = connected). Credentials are encrypted with the secret
 * vault. Sync on a connection that is not connected, or when the platform
 * cannot be reached, answers 503 and records sync_status = failed; success is
 * recorded only after the import finished.
 */
import { and, eq, isNull, sql } from "drizzle-orm";
import { db, pool } from "../../db";
import {
  ecommerceIntegrations,
  ecommerceTransactions,
  invoices,
  type EcommerceIntegration,
} from "../../../shared/schema";
import { DomainError } from "../../errors";
import { decryptSecret, encryptSecret } from "../secret-vault";
import { createLogger } from "../../config/logger";
import { PlatformUnreachableError } from "./http";
import { PlatformAuthError, PlatformError, type AdapterContext, type SyncCounts } from "./types";
import { normaliseShopDomain, syncShopify, verifyShopify } from "./shopify";
import { syncStripePayouts, verifyStripeKey } from "./stripe-payouts";

export { setEcommerceHttpClient } from "./http";

const log = createLogger("ecommerce");

export const ECOMMERCE_PLATFORMS = ["shopify", "stripe_payouts"] as const;
export type EcommercePlatform = (typeof ECOMMERCE_PLATFORMS)[number];

export interface ConnectInput {
  platform: EcommercePlatform;
  shopDomain?: string | null;
  accessToken?: string | null;
  apiKey?: string | null;
}

function mapPlatformError(err: unknown): never {
  if (err instanceof PlatformAuthError) {
    throw new DomainError("INVALID_CREDENTIALS", 400, undefined, err.message);
  }
  if (err instanceof PlatformUnreachableError) {
    throw new DomainError(
      "PLATFORM_UNREACHABLE",
      503,
      undefined,
      "The platform could not be reached from this server. Nothing was connected or synced."
    );
  }
  if (err instanceof PlatformError) {
    throw new DomainError("PLATFORM_ERROR", 502, undefined, err.message);
  }
  throw err;
}

/** Verify credentials with the platform, then store an encrypted, connected integration. */
export async function connectIntegration(
  companyId: string,
  input: ConnectInput
): Promise<EcommerceIntegration> {
  let shopDomain: string | null = null;
  let accountName: string;
  try {
    if (input.platform === "shopify") {
      shopDomain = normaliseShopDomain(input.shopDomain ?? "");
      if (!shopDomain) {
        throw new DomainError(
          "INVALID_SHOP_DOMAIN",
          400,
          { fields: { shopDomain: ["Use your-store.myshopify.com"] } },
          "Enter the shop's myshopify.com domain"
        );
      }
      if (!input.accessToken) {
        throw new DomainError("ACCESS_TOKEN_REQUIRED", 400, {
          fields: { accessToken: ["Required"] },
        });
      }
      accountName = (await verifyShopify(shopDomain, input.accessToken)).name;
    } else {
      if (!input.apiKey) {
        throw new DomainError("API_KEY_REQUIRED", 400, { fields: { apiKey: ["Required"] } });
      }
      accountName = (await verifyStripeKey(input.apiKey)).name;
    }
  } catch (err) {
    if (err instanceof DomainError) throw err;
    mapPlatformError(err);
  }

  const values = {
    companyId,
    platform: input.platform,
    isActive: true,
    shopDomain,
    accessToken: encryptSecret(input.platform === "shopify" ? input.accessToken : null),
    apiKey: encryptSecret(input.platform === "stripe_payouts" ? input.apiKey : null),
    syncStatus: "never",
    syncError: null,
    connectionStatus: "connected",
    verifiedAt: new Date(),
    externalAccountName: accountName!,
    updatedAt: new Date(),
  };
  // One connection per platform (and shop) per company: reconnecting replaces the credentials.
  const [existing] = await db
    .select()
    .from(ecommerceIntegrations)
    .where(
      and(
        eq(ecommerceIntegrations.companyId, companyId),
        eq(ecommerceIntegrations.platform, input.platform),
        shopDomain ? eq(ecommerceIntegrations.shopDomain, shopDomain) : sql`true`
      )
    );
  if (existing) {
    const [row] = await db
      .update(ecommerceIntegrations)
      .set(values)
      .where(eq(ecommerceIntegrations.id, existing.id))
      .returning();
    return row;
  }
  const [row] = await db.insert(ecommerceIntegrations).values(values).returning();
  return row;
}

function makeContext(
  integration: EcommerceIntegration,
  actorUserId: string | null
): AdapterContext {
  const companyId = integration.companyId;
  return {
    companyId,
    actorUserId,
    integration,
    credentials: {
      accessToken: decryptSecret(integration.accessToken),
      apiKey: decryptSecret(integration.apiKey),
    },
    async recordTransaction(input) {
      const rows = await db
        .insert(ecommerceTransactions)
        .values({
          companyId,
          integrationId: integration.id,
          platform: integration.platform,
          externalId: input.externalId,
          transactionType: input.transactionType,
          amount: Number(input.amount),
          currency: input.currency.toUpperCase(),
          customerName: input.customerName ?? null,
          customerEmail: input.customerEmail ?? null,
          description: input.description ?? null,
          status: input.status,
          platformFees: input.platformFees == null ? null : Number(input.platformFees),
          netAmount: input.netAmount == null ? null : Number(input.netAmount),
          transactionDate: new Date(input.transactionDate),
          metadata: input.metadata ? JSON.stringify(input.metadata) : null,
        })
        .onConflictDoNothing()
        .returning({ id: ecommerceTransactions.id });
      return rows[0]?.id ?? null;
    },
    async linkDocument(externalId, invoiceId, status) {
      await db
        .update(ecommerceTransactions)
        .set({ invoiceId, ...(status ? { status } : {}) })
        .where(
          and(
            eq(ecommerceTransactions.integrationId, integration.id),
            eq(ecommerceTransactions.externalId, externalId)
          )
        );
    },
    async linkBankTransaction(externalId, bankTransactionId) {
      await db
        .update(ecommerceTransactions)
        .set({ bankTransactionId })
        .where(
          and(
            eq(ecommerceTransactions.integrationId, integration.id),
            eq(ecommerceTransactions.externalId, externalId)
          )
        );
    },
    async documentFor(externalId) {
      const [row] = await db
        .select({ id: invoices.id, status: invoices.status })
        .from(ecommerceTransactions)
        .innerJoin(invoices, eq(invoices.id, ecommerceTransactions.invoiceId))
        .where(
          and(
            eq(ecommerceTransactions.integrationId, integration.id),
            eq(ecommerceTransactions.externalId, externalId)
          )
        );
      return row ?? null;
    },
    async pendingRefunds() {
      const rows = await db
        .select()
        .from(ecommerceTransactions)
        .where(
          and(
            eq(ecommerceTransactions.integrationId, integration.id),
            eq(ecommerceTransactions.transactionType, "refund"),
            isNull(ecommerceTransactions.invoiceId)
          )
        );
      return rows.map((r: typeof ecommerceTransactions.$inferSelect) => ({
        id: r.id,
        externalId: r.externalId,
        transactionDate: r.transactionDate,
        metadata: r.metadata ? (JSON.parse(r.metadata) as Record<string, unknown>) : {},
      }));
    },
  };
}

/**
 * Run a sync to completion. 503 when not connected or unreachable; the row
 * records `success` only after every page was imported.
 */
export async function syncIntegration(
  integration: EcommerceIntegration,
  actorUserId: string | null
): Promise<SyncCounts & { status: "success" }> {
  if (integration.connectionStatus !== "connected" || !integration.isActive) {
    throw new DomainError(
      "INTEGRATION_NOT_CONNECTED",
      503,
      { connectionStatus: integration.connectionStatus },
      "This integration is not connected. Connect it with valid credentials first."
    );
  }
  const claimed = await pool.query(
    `UPDATE ecommerce_integrations SET sync_status = 'syncing', sync_error = NULL, updated_at = now()
      WHERE id = $1 AND COALESCE(sync_status, 'never') <> 'syncing' RETURNING id`,
    [integration.id]
  );
  if (!claimed.rows.length) {
    throw new DomainError("SYNC_IN_PROGRESS", 409, undefined, "A sync is already running");
  }
  const startedAt = new Date();
  try {
    const ctx = makeContext(integration, actorUserId);
    const counts =
      integration.platform === "shopify" ? await syncShopify(ctx) : await syncStripePayouts(ctx);
    await db
      .update(ecommerceIntegrations)
      .set({ syncStatus: "success", lastSyncAt: startedAt, syncError: null, updatedAt: new Date() })
      .where(eq(ecommerceIntegrations.id, integration.id));
    return { ...counts, status: "success" };
  } catch (err) {
    const auth = err instanceof PlatformAuthError;
    await db
      .update(ecommerceIntegrations)
      .set({
        syncStatus: "failed",
        syncError: (err as Error).message?.slice(0, 500) ?? "sync failed",
        ...(auth ? { connectionStatus: "error", isActive: false } : {}),
        updatedAt: new Date(),
      })
      .where(eq(ecommerceIntegrations.id, integration.id));
    log.warn(
      { integrationId: integration.id, err: (err as Error).message },
      "E-commerce sync failed"
    );
    if (auth) {
      throw new DomainError(
        "INVALID_CREDENTIALS",
        503,
        undefined,
        "The platform no longer accepts the stored credentials. Reconnect the integration."
      );
    }
    mapPlatformError(err);
  }
}
