import type { Express, Request, Response } from "express";
import { and, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";

import { db } from "../db";
import { apiKeys } from "../../shared/schema";
import { authMiddleware, requireCustomer } from "../middleware/auth";
import { requireFeature } from "../middleware/featureGate";
import { requireRole } from "../middleware/rbac";
import { asyncHandler } from "../middleware/errorHandler";
import { storage } from "../storage";
import { recordAudit } from "../services/audit.service";
import {
  DEFAULT_RATE_PER_DAY,
  DEFAULT_RATE_PER_MINUTE,
  KEY_HOLDER_ROLES,
  MAX_KEY_EXPIRY_DAYS,
  MAX_RATE_PER_DAY,
  MAX_RATE_PER_MINUTE,
  generateApiKey,
  isKnownScope,
  parseScopes,
  serializeScopes,
} from "../api-v1/keys";

const MAX_ACTIVE_KEYS_PER_COMPANY = 25;

const createKeySchema = z
  .object({
    name: z.string().trim().min(1, "Name is required").max(100),
    scopes: z
      .array(z.string())
      .min(1, "Choose at least one scope")
      .max(20)
      .refine((s) => s.every(isKnownScope), "Unknown scope"),
    expiresInDays: z.number().int().min(1).max(MAX_KEY_EXPIRY_DAYS).optional(),
    ratePerMinute: z.number().int().min(1).max(MAX_RATE_PER_MINUTE).optional(),
    ratePerDay: z.number().int().min(1).max(MAX_RATE_PER_DAY).optional(),
  })
  .strict();

type KeyRow = typeof apiKeys.$inferSelect;

/** Never expose the hash; the prefix is shown masked, the secret only once at creation. */
function presentKey(row: KeyRow) {
  const expired = !!row.expiresAt && row.expiresAt.getTime() <= Date.now();
  const status = row.revokedAt || !row.isActive ? "revoked" : expired ? "expired" : "active";
  return {
    id: row.id,
    name: row.name,
    keyPrefix: `muh_${row.keyPrefix}...`,
    scopes: parseScopes(row.scopes),
    status,
    isActive: status === "active",
    expiresAt: row.expiresAt,
    revokedAt: row.revokedAt,
    lastUsedAt: row.lastUsedAt,
    createdAt: row.createdAt,
    createdBy: row.createdBy,
    ratePerMinute: row.rateLimitPerMinute,
    ratePerDay: row.rateLimitPerDay,
  };
}

async function revokeKey(req: Request, res: Response, companyId: string, keyId: string) {
  const [row] = await db
    .update(apiKeys)
    .set({ isActive: false, revokedAt: new Date(), revokedBy: req.user!.id })
    .where(and(eq(apiKeys.id, keyId), eq(apiKeys.companyId, companyId), isNull(apiKeys.revokedAt)))
    .returning();
  if (!row) return res.status(404).json({ message: "API key not found", code: "NOT_FOUND" });
  await recordAudit({
    userId: req.user!.id,
    companyId,
    action: "api_key.revoke",
    entityType: "api_key",
    entityId: keyId,
    after: { name: row.name },
    req,
  });
  return res.json({ id: row.id, status: "revoked", revokedAt: row.revokedAt });
}

export function registerApiKeyRoutes(app: Express) {
  // =====================================
  // API KEY MANAGEMENT
  // =====================================

  // List keys for a company (masked; owner, accountant or CFO)
  app.get(
    "/api/companies/:companyId/api-keys",
    authMiddleware,
    requireCustomer,
    requireRole(...KEY_HOLDER_ROLES),
    asyncHandler(async (req: Request, res: Response) => {
      const keys = await db
        .select()
        .from(apiKeys)
        .where(eq(apiKeys.companyId, req.params.companyId))
        .orderBy(desc(apiKeys.createdAt));
      res.json(keys.map(presentKey));
    })
  );

  // Create a key. The full key is in this response and never again.
  app.post(
    "/api/companies/:companyId/api-keys",
    authMiddleware,
    requireCustomer,
    requireRole("owner", "accountant"),
    requireFeature("apiAccess"),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const parsed = createKeySchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        return res.status(400).json({
          message: parsed.error.issues[0]?.message ?? "Invalid request",
          code: "VALIDATION_ERROR",
          details: { issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) },
        });
      }

      // The key acts as its creator and may never exceed the creator's role, so the creator
      // must be a real member of this company (a firm owner with no membership cannot mint one).
      const membership = await storage.getUserRole(companyId, req.user!.id);
      if (!membership || !(KEY_HOLDER_ROLES as readonly string[]).includes(membership.role)) {
        return res.status(403).json({
          message: "Only a member of this company with the owner or accountant role can create API keys",
          code: "KEY_HOLDER_REQUIRED",
        });
      }

      const existing = await db
        .select({ id: apiKeys.id })
        .from(apiKeys)
        .where(and(eq(apiKeys.companyId, companyId), isNull(apiKeys.revokedAt)));
      if (existing.length >= MAX_ACTIVE_KEYS_PER_COMPANY) {
        return res.status(409).json({
          message: `A company can have at most ${MAX_ACTIVE_KEYS_PER_COMPANY} active API keys. Revoke one first.`,
          code: "API_KEY_LIMIT",
        });
      }

      const { name, scopes, expiresInDays, ratePerMinute, ratePerDay } = parsed.data;
      const generated = generateApiKey();
      const [row] = await db
        .insert(apiKeys)
        .values({
          companyId,
          name,
          keyHash: generated.hash,
          keyPrefix: generated.prefix,
          scopes: serializeScopes(scopes),
          createdBy: req.user!.id,
          expiresAt: expiresInDays ? new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000) : null,
          rateLimitPerMinute: ratePerMinute ?? DEFAULT_RATE_PER_MINUTE,
          rateLimitPerDay: ratePerDay ?? DEFAULT_RATE_PER_DAY,
        })
        .returning();

      await recordAudit({
        userId: req.user!.id,
        companyId,
        action: "api_key.create",
        entityType: "api_key",
        entityId: row.id,
        after: { name, scopes, expiresInDays: expiresInDays ?? null },
        req,
      });
      res.status(201).json({ ...presentKey(row), key: generated.key });
    })
  );

  // Keys are immutable: scopes, limits and expiry are fixed at creation. Revoke and create a new one.
  app.put(
    "/api/api-keys/:id",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (_req: Request, res: Response) => {
      return res.status(405).json({
        message: "API keys cannot be edited. Revoke the key and create a new one.",
        code: "API_KEY_IMMUTABLE",
      });
    })
  );

  // Revoke (soft: the row stays for the audit trail and the request log)
  app.delete(
    "/api/companies/:companyId/api-keys/:id",
    authMiddleware,
    requireCustomer,
    requireRole("owner", "accountant"),
    asyncHandler(async (req: Request, res: Response) => {
      return revokeKey(req, res, req.params.companyId, req.params.id);
    })
  );

  // Older alias: finds the key's company with one query, then applies the same role rule.
  app.delete(
    "/api/api-keys/:id",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const [key] = await db.select({ companyId: apiKeys.companyId }).from(apiKeys).where(eq(apiKeys.id, req.params.id));
      const membership = key ? await storage.getUserRole(key.companyId, req.user!.id) : undefined;
      if (!key || !membership || !["owner", "accountant"].includes(membership.role)) {
        return res.status(403).json({ message: "Access denied" });
      }
      return revokeKey(req, res, key.companyId, req.params.id);
    })
  );
}
