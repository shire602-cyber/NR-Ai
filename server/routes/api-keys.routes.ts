/**
 * API key management (W5-B, R19-01, R19-10, R19-15).
 *
 * Keys are `muh_<64 hex>`; only the SHA-256 hash and an 8-character indexed
 * prefix are stored. They authenticate the versioned public API at /api/v1
 * (server/routes/public-api.routes.ts) with the scopes and per-minute rate
 * limit chosen here. Managing keys needs the `settings.company` permission
 * (central role policy) and the `apiAccess` plan feature.
 *
 * Update and revoke are single tenant-scoped statements: the key must belong
 * to a company the caller is a member of, else 404.
 */
import type { Express, Request, Response } from "express";
import { parsedBody } from "../http/parsed-body";
import { z } from "zod";
import { pq } from "../services/connectors/pq";
import { authMiddleware, requireCustomer } from "../middleware/auth";
import { asyncHandler } from "../middleware/errorHandler";
import { requireFeature } from "../middleware/featureGate";
import { requirePermission } from "../middleware/companyRolePolicy";
import { strictBody } from "../http/strict-body";
import { zText } from "../../shared/validators/primitives";
import { API_SCOPES, expandScopes, generateApiKey } from "../middleware/api-key-auth";
import { storage } from "../storage";
import { recordAudit } from "../services/audit.service";

const zScopes = z
  .array(z.enum(API_SCOPES))
  .min(1, "Choose at least one scope")
  .max(API_SCOPES.length)
  .transform((s) => [...new Set(s)].join(","));

const createKeyBody = z
  .object({
    name: zText(100, { min: 1 }),
    scopes: zScopes,
    rateLimitPerMinute: z.number().int().min(1).max(6000).optional(),
    expiresAt: z
      .string()
      .datetime({ offset: true })
      .refine((v) => new Date(v).getTime() > Date.now(), "Expiry must be in the future")
      .optional()
      .nullable(),
  })
  .strict();

const updateKeyBody = z
  .object({
    name: zText(100, { min: 1 }).optional(),
    scopes: zScopes.optional(),
    rateLimitPerMinute: z.number().int().min(1).max(6000).optional(),
    isActive: z.boolean().optional(),
  })
  .strict();

interface KeyRow {
  id: string;
  company_id: string;
  name: string;
  key_prefix: string;
  scopes: string;
  is_active: boolean;
  last_used_at: Date | null;
  created_by: string | null;
  created_at: Date;
  rate_limit_per_minute: number;
  expires_at: Date | null;
  revoked_at: Date | null;
}

const KEY_COLUMNS = `id, company_id, name, key_prefix, scopes, is_active, last_used_at, created_by,
  created_at, rate_limit_per_minute, expires_at, revoked_at`;

/** Masked view: never the hash, never the secret. */
function present(row: KeyRow) {
  return {
    id: row.id,
    companyId: row.company_id,
    name: row.name,
    keyPrefix: `muh_${row.key_prefix}...`,
    scopes: expandScopes(row.scopes),
    isActive: row.is_active && !row.revoked_at,
    lastUsedAt: row.last_used_at,
    createdBy: row.created_by,
    createdAt: row.created_at,
    rateLimitPerMinute: row.rate_limit_per_minute,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
  };
}

/** Companies the caller belongs to (subquery used to scope single statements). */
const MEMBER_COMPANIES = `SELECT company_id FROM company_users WHERE user_id = $2`;

export function registerApiKeyRoutes(app: Express) {
  // Scope catalogue for the Developer Settings UI.
  app.get("/api/api-keys/scopes", authMiddleware, (_req: Request, res: Response) => {
    res.json({ scopes: API_SCOPES });
  });

  app.get(
    "/api/companies/:companyId/api-keys",
    authMiddleware,
    requireCustomer,
    requirePermission("settings.company"),
    requireFeature("apiAccess"),
    asyncHandler(async (req: Request, res: Response) => {
      const { rows } = await pq<KeyRow>(
        `SELECT ${KEY_COLUMNS} FROM api_keys WHERE company_id = $1 ORDER BY created_at DESC`,
        [req.params.companyId]
      );
      res.json(rows.map(present));
    })
  );

  app.post(
    "/api/companies/:companyId/api-keys",
    authMiddleware,
    requireCustomer,
    requirePermission("settings.company"),
    requireFeature("apiAccess"),
    strictBody(createKeyBody),
    asyncHandler(async (req: Request, res: Response) => {
      const userId = req.user!.id;
      const { companyId } = req.params;
      const body = parsedBody<z.output<typeof createKeyBody>>(req);
      const key = generateApiKey();
      const { rows } = await pq<KeyRow>(
        `INSERT INTO api_keys (company_id, name, key_hash, key_prefix, scopes, created_by, is_active,
                               rate_limit_per_minute, expires_at)
              VALUES ($1, $2, $3, $4, $5, $6, true, $7, $8)
           RETURNING ${KEY_COLUMNS}`,
        [
          companyId,
          body.name,
          key.hash,
          key.prefix,
          body.scopes,
          userId,
          body.rateLimitPerMinute ?? 120,
          body.expiresAt ? new Date(body.expiresAt) : null,
        ]
      );
      await storage.createActivityLog({
        companyId,
        userId,
        action: "create",
        entityType: "api_key",
        entityId: rows[0].id,
        description: `Created API key "${body.name}" (${body.scopes})`,
      });
      // The full key is returned ONLY on creation — it can never be retrieved again.
      await recordAudit({
        userId,
        companyId,
        action: "api_key.create",
        entityType: "api_key",
        entityId: rows[0].id,
        after: { name: rows[0].name, scopes: rows[0].scopes, keyPrefix: rows[0].key_prefix },
        req,
      });
      res.status(201).json({ ...present(rows[0]), key: key.raw });
    })
  );

  app.put(
    "/api/api-keys/:id",
    authMiddleware,
    requireCustomer,
    requireFeature("apiAccess"),
    strictBody(updateKeyBody),
    asyncHandler(async (req: Request, res: Response) => {
      const body = parsedBody<z.output<typeof updateKeyBody>>(req);
      const { rows } = await pq<KeyRow>(
        `UPDATE api_keys
            SET name = COALESCE($3, name),
                scopes = COALESCE($4, scopes),
                rate_limit_per_minute = COALESCE($5, rate_limit_per_minute),
                is_active = COALESCE($6, is_active)
          WHERE id = $1 AND revoked_at IS NULL AND company_id IN (${MEMBER_COMPANIES})
          RETURNING ${KEY_COLUMNS}`,
        [
          req.params.id,
          req.user!.id,
          body.name ?? null,
          body.scopes ?? null,
          body.rateLimitPerMinute ?? null,
          body.isActive ?? null,
        ]
      );
      if (!rows[0])
        return res.status(404).json({ message: "API key not found", code: "NOT_FOUND" });
      res.json(present(rows[0]));
    })
  );

  // Revoke: the row is kept (audit trail of who used what) but can never authenticate again.
  app.delete(
    "/api/api-keys/:id",
    authMiddleware,
    requireCustomer,
    requireFeature("apiAccess"),
    asyncHandler(async (req: Request, res: Response) => {
      const { rows } = await pq<KeyRow>(
        `UPDATE api_keys SET is_active = false, revoked_at = COALESCE(revoked_at, now())
          WHERE id = $1 AND company_id IN (${MEMBER_COMPANIES})
          RETURNING ${KEY_COLUMNS}`,
        [req.params.id, req.user!.id]
      );
      if (!rows[0])
        return res.status(404).json({ message: "API key not found", code: "NOT_FOUND" });
      await storage.createActivityLog({
        companyId: rows[0].company_id,
        userId: req.user!.id,
        action: "delete",
        entityType: "api_key",
        entityId: rows[0].id,
        description: `Revoked API key "${rows[0].name}"`,
      });
      await recordAudit({
        userId: req.user!.id,
        companyId: rows[0].company_id,
        action: "api_key.revoke",
        entityType: "api_key",
        entityId: rows[0].id,
        req,
      });
      res.json({ message: "API key revoked successfully" });
    })
  );
}
