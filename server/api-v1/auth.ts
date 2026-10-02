/**
 * apiKeyAuth: Bearer `muh_...` -> key row -> (company live, creator active and
 * still owner/accountant/cfo). Failure is always 401 API_KEY_INVALID plus a
 * request-log row; the reason is never revealed to the caller.
 */
import type { NextFunction, Request, Response } from "express";
import { pool } from "../db";
import { createLogger } from "../config/logger";
import { API_V1_DISPATCH, type ApiV1DispatchMarker } from "../middleware/auth";
import { KEY_HOLDER_ROLES, keyMatches, parseApiKey, parseScopes } from "./keys";
import type { V1Context } from "./context";
import { errorEnvelope } from "./response";
import { authFailureRetryAfter, recordAuthFailure } from "./limits";

const log = createLogger("api-v1-auth");

const LAST_USED_REFRESH_MS = 60_000;

function invalid(req: Request, res: Response) {
  const ip = req.ip || "unknown";
  if (!recordAuthFailure(ip)) {
    res.setHeader("Retry-After", String(authFailureRetryAfter(ip)));
    return res.status(429).json(errorEnvelope(req, 429, "RATE_LIMITED", "Too many failed authentication attempts"));
  }
  res.setHeader("WWW-Authenticate", 'Bearer realm="muhasib-api"');
  return res.status(401).json(errorEnvelope(req, 401, "API_KEY_INVALID", "The API key is missing, invalid, revoked or expired"));
}

export async function apiKeyAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const header = req.headers.authorization;
    const presented = typeof header === "string" && /^Bearer /i.test(header) ? header.slice(7).trim() : null;
    const parsed = parseApiKey(presented);
    if (!parsed) {
      invalid(req, res);
      return;
    }

    const { rows } = await pool.query(
      `SELECT ak.id, ak.key_hash, ak.key_prefix, ak.company_id, ak.created_by, ak.scopes, ak.is_active,
              ak.revoked_at, ak.expires_at, (ak.expires_at IS NULL OR ak.expires_at > (now() AT TIME ZONE 'UTC')) AS not_expired, ak.last_used_at, ak.rate_limit_per_minute, ak.rate_limit_per_day,
              c.deleted_at AS company_deleted_at, c.require_two_factor, u.is_active AS user_active, cu.role AS member_role,
              EXISTS (SELECT 1 FROM user_totp t WHERE t.user_id = ak.created_by AND t.enabled_at IS NOT NULL) AS creator_has_totp
         FROM api_keys ak
         JOIN companies c ON c.id = ak.company_id
         LEFT JOIN users u ON u.id = ak.created_by
         LEFT JOIN company_users cu ON cu.company_id = ak.company_id AND cu.user_id = ak.created_by
        WHERE ak.key_prefix = $1`,
      [parsed.prefix]
    );
    const row = rows[0];
    if (!row || !keyMatches(presented!, row.key_hash)) {
      invalid(req, res);
      return;
    }
    // From here the key is known: the log row can carry its id even when we refuse it.
    res.locals.v1KeyId = row.id;
    res.locals.v1CompanyId = row.company_id;

    const live =
      row.is_active === true &&
      !row.revoked_at &&
      row.not_expired === true &&
      !row.company_deleted_at &&
      row.user_active === true &&
      (KEY_HOLDER_ROLES as readonly string[]).includes(row.member_role);
    if (!live) {
      invalid(req, res);
      return;
    }

    // The company demands 2FA from its owners/accountants/CFOs: a key minted by someone without it
    // would be a way around that rule.
    if (row.require_two_factor === true && row.creator_has_totp !== true) {
      res.status(403).json(
        errorEnvelope(req, 403, "TWO_FACTOR_REQUIRED", "This company requires two-factor authentication; the key's creator has not enabled it")
      );
      return;
    }

    const context: V1Context = {
      keyId: row.id,
      keyPrefix: row.key_prefix,
      companyId: row.company_id,
      userId: row.created_by,
      scopes: parseScopes(row.scopes),
      ratePerMinute: row.rate_limit_per_minute,
      ratePerDay: row.rate_limit_per_day,
    };
    req.v1 = context;
    res.locals.v1UserId = row.created_by;
    const marker: ApiV1DispatchMarker = { userId: row.created_by, apiKeyId: row.id };
    (req as any)[API_V1_DISPATCH] = marker;

    if (!row.last_used_at || Date.now() - new Date(row.last_used_at).getTime() > LAST_USED_REFRESH_MS) {
      pool.query(`UPDATE api_keys SET last_used_at = now() WHERE id = $1`, [row.id]).catch((err: unknown) =>
        log.warn({ err }, "Could not update api key last_used_at")
      );
    }
    next();
  } catch (err) {
    log.error({ err }, "API key authentication failed unexpectedly");
    res.status(500).json(errorEnvelope(req, 500, "INTERNAL_ERROR", "Authentication could not be completed"));
  }
}
