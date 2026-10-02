/**
 * D5 account security: TOTP two-factor, session list/revoke, change password
 * and the company "require 2FA" switch.
 */
import type { Express, Request, Response } from "express";
import bcrypt from "bcryptjs";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "../db";
import { companies } from "../../shared/schema";
import { storage } from "../storage";
import { authMiddleware, generateToken } from "../middleware/auth";
import { requireRole } from "../middleware/rbac";
import { asyncHandler } from "../middleware/errorHandler";
import { buildLimiter } from "../middleware/rateLimit";
import { BCRYPT_COST } from "../config/bcrypt";
import { authCookieBaseOptions } from "../config/cookies";
import { createLogger } from "../config/logger";
import { recordAudit } from "../services/audit.service";
import { issueSessionTokens } from "../services/auth-issue";
import { ACCESS_TOKEN_TTL_SECONDS, accessCookieName } from "../services/auth-cookies.service";
import { isUserDeactivated } from "../services/portal-invitations";
import { listSessions, revokeSession, revokeUserSessions } from "../services/sessions";
import {
  CHALLENGE_COOKIE,
  TwoFactorAlreadyEnabledError,
  beginEnrolment,
  companiesRequiringTwoFactor,
  confirmEnrolment,
  consumeChallengeToken,
  consumeRecoveryCode,
  disableTwoFactor,
  isTwoFactorEnabled,
  readChallengeToken,
  recoveryCodesRemaining,
  regenerateRecoveryCodes,
  verifyChallengeToken,
  verifyTotpCode,
} from "../services/two-factor";
import { passwordSchema } from "./auth.routes";

const log = createLogger("two-factor");

const TWO_FACTOR_MAX_ATTEMPTS_PER_MINUTE = 5;

function cookieValue(req: Request, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) {
      try {
        return decodeURIComponent(v.join("="));
      } catch {
        return v.join("=");
      }
    }
  }
  return undefined;
}

function challengeFrom(req: Request): string | undefined {
  const fromBody = (req.body as { challengeToken?: unknown } | undefined)?.challengeToken;
  if (typeof fromBody === "string" && fromBody) return fromBody;
  return cookieValue(req, CHALLENGE_COOKIE);
}

/** Per-user bucket for every attempt to guess a second-factor code: 5 failures a minute. */
const twoFactorAttemptLimiter = buildLimiter({
  windowMs: 60_000,
  max: TWO_FACTOR_MAX_ATTEMPTS_PER_MINUTE,
  message: "Too many verification attempts. Please wait a minute and try again.",
  skipSuccessfulRequests: true,
  keyGenerator: (req) => {
    if (req.user?.id) return `2fa:${req.user.id}`;
    const challenge = readChallengeToken(challengeFrom(req));
    if (challenge) return `2fa:${challenge.userId}`;
    return `2fa-ip:${req.ip || "unknown"}`;
  },
});

const codeSchema = z.string().regex(/^\d{6}$/, "Enter the 6-digit code");

const verifyBodySchema = z
  .object({
    challengeToken: z.string().max(2000).optional(),
    code: codeSchema.optional(),
    recoveryCode: z.string().min(8).max(32).optional(),
  })
  .refine((b) => !!b.code !== !!b.recoveryCode, { message: "Provide either code or recoveryCode" });

const passwordAndCodeSchema = z.object({
  password: z.string().min(1).max(200),
  code: codeSchema,
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: z.string().max(1000),
  code: codeSchema.optional(),
});

function bad(res: Response, status: number, code: string, message: string) {
  return res.status(status).json({ message, code });
}

const REPLAYED_MESSAGE = "That code was already used. Wait for the next one.";

async function checkPasswordAndCode(
  req: Request,
  res: Response,
  body: { password: string; code: string }
): Promise<boolean> {
  const user = await storage.getUser(req.user!.id);
  if (!user || !(await bcrypt.compare(body.password, user.passwordHash))) {
    bad(res, 401, "PASSWORD_INVALID", "Password is incorrect");
    return false;
  }
  const result = await verifyTotpCode(user.id, body.code);
  if (!result.ok) {
    bad(res, 401, result.code, result.code === "TOTP_REPLAYED" ? REPLAYED_MESSAGE : "The code is not valid");
    return false;
  }
  return true;
}

export function registerTwoFactorRoutes(app: Express): void {
  // ── Login second step ───────────────────────────────────────────────
  app.post(
    "/api/auth/2fa/verify",
    twoFactorAttemptLimiter,
    asyncHandler(async (req: Request, res: Response) => {
      const parsed = verifyBodySchema.safeParse(req.body ?? {});
      if (!parsed.success) return bad(res, 400, "VALIDATION_ERROR", "Provide a 6-digit code or a recovery code");
      const challengeToken = challengeFrom(req);
      const challenge = await verifyChallengeToken(challengeToken);
      if (!challenge) return bad(res, 401, "CHALLENGE_EXPIRED", "Your sign-in attempt expired. Sign in again.");

      const user = await storage.getUser(challenge.userId);
      if (!user || isUserDeactivated(user)) {
        return bad(res, 401, "CHALLENGE_EXPIRED", "Your sign-in attempt expired. Sign in again.");
      }

      if (parsed.data.code) {
        const result = await verifyTotpCode(user.id, parsed.data.code);
        if (!result.ok) {
          return bad(res, 401, result.code, result.code === "TOTP_REPLAYED" ? REPLAYED_MESSAGE : "The code is not valid");
        }
      } else if (!(await consumeRecoveryCode(user.id, parsed.data.recoveryCode!))) {
        return bad(res, 401, "RECOVERY_CODE_INVALID", "That recovery code is not valid or was already used");
      }

      await consumeChallengeToken(challengeToken!);
      res.clearCookie(CHALLENGE_COOKIE, { ...authCookieBaseOptions(), path: "/api/auth/2fa" });
      const { token, refreshToken, twoFactorEnrolmentRequired } = await issueSessionTokens(req, res, user, {
        notifyNewDevice: true,
      });
      await recordAudit({
        userId: user.id,
        action: parsed.data.recoveryCode ? "2fa.recovery_login" : "2fa.login",
        entityType: "user",
        entityId: user.id,
        req,
      });
      res.json({
        token,
        refreshToken,
        ...(twoFactorEnrolmentRequired ? { twoFactorEnrolmentRequired: true } : {}),
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          isAdmin: user.isAdmin === true,
          userType: user.userType || "customer",
        },
      });
    })
  );

  // ── Status and enrolment ────────────────────────────────────────────
  app.get(
    "/api/auth/2fa/status",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const userId = req.user!.id;
      res.json({
        enabled: await isTwoFactorEnabled(userId),
        recoveryCodesRemaining: await recoveryCodesRemaining(userId),
        requiredByCompanies: await companiesRequiringTwoFactor(userId),
      });
    })
  );

  app.post(
    "/api/auth/2fa/enrol",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      try {
        res.json(await beginEnrolment({ id: req.user!.id, email: req.user!.email }));
      } catch (err) {
        if (err instanceof TwoFactorAlreadyEnabledError) {
          return bad(res, 409, "TOTP_ALREADY_ENABLED", "Two-factor authentication is already enabled");
        }
        throw err;
      }
    })
  );

  app.post(
    "/api/auth/2fa/enrol/verify",
    authMiddleware,
    twoFactorAttemptLimiter,
    asyncHandler(async (req: Request, res: Response) => {
      const parsed = z.object({ code: codeSchema }).safeParse(req.body ?? {});
      if (!parsed.success) return bad(res, 400, "VALIDATION_ERROR", "Enter the 6-digit code");
      const userId = req.user!.id;
      const result = await confirmEnrolment(userId, parsed.data.code);
      if (!result.ok) {
        if (result.code === "NO_PENDING_ENROLMENT") return bad(res, 409, "NO_PENDING_ENROLMENT", "Start enrolment first");
        return bad(res, 401, result.code, "The code is not valid");
      }
      await revokeUserSessions(userId, "2fa_enabled", req.sessionId);
      await recordAudit({ userId, action: "2fa.enable", entityType: "user", entityId: userId, req });

      // A token confined to enrolment is replaced by a normal one on the same session.
      let token: string | undefined;
      if (req.tokenScope === "2fa_enrol") {
        const user = await storage.getUser(userId);
        if (user) {
          token = generateToken(user, { sid: req.sessionId ?? undefined });
          res.cookie(accessCookieName(), token, {
            ...authCookieBaseOptions(),
            maxAge: ACCESS_TOKEN_TTL_SECONDS * 1000,
          });
        }
      }
      res.json({ enabled: true, recoveryCodes: result.recoveryCodes, ...(token ? { token } : {}) });
    })
  );

  app.post(
    "/api/auth/2fa/disable",
    authMiddleware,
    twoFactorAttemptLimiter,
    asyncHandler(async (req: Request, res: Response) => {
      const parsed = passwordAndCodeSchema.safeParse(req.body ?? {});
      if (!parsed.success) return bad(res, 400, "VALIDATION_ERROR", "Password and a 6-digit code are required");
      const userId = req.user!.id;
      if (!(await isTwoFactorEnabled(userId))) {
        return bad(res, 409, "TOTP_NOT_ENABLED", "Two-factor authentication is not enabled");
      }
      if ((await companiesRequiringTwoFactor(userId)).length > 0) {
        return bad(res, 403, "TWO_FACTOR_REQUIRED_BY_COMPANY", "A company you belong to requires two-factor authentication");
      }
      if (!(await checkPasswordAndCode(req, res, parsed.data))) return;
      await disableTwoFactor(userId);
      await revokeUserSessions(userId, "2fa_disabled", req.sessionId);
      await recordAudit({ userId, action: "2fa.disable", entityType: "user", entityId: userId, req });
      res.json({ enabled: false });
    })
  );

  app.post(
    "/api/auth/2fa/recovery-codes",
    authMiddleware,
    twoFactorAttemptLimiter,
    asyncHandler(async (req: Request, res: Response) => {
      const parsed = passwordAndCodeSchema.safeParse(req.body ?? {});
      if (!parsed.success) return bad(res, 400, "VALIDATION_ERROR", "Password and a 6-digit code are required");
      const userId = req.user!.id;
      if (!(await isTwoFactorEnabled(userId))) {
        return bad(res, 409, "TOTP_NOT_ENABLED", "Two-factor authentication is not enabled");
      }
      if (!(await checkPasswordAndCode(req, res, parsed.data))) return;
      const recoveryCodes = await regenerateRecoveryCodes(userId);
      await revokeUserSessions(userId, "recovery_codes_regenerated", req.sessionId);
      await recordAudit({ userId, action: "2fa.recovery_codes_regenerated", entityType: "user", entityId: userId, req });
      res.json({ recoveryCodes });
    })
  );

  // ── Sessions ────────────────────────────────────────────────────────
  app.get(
    "/api/auth/sessions",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      res.json(await listSessions(req.user!.id, req.sessionId));
    })
  );

  app.delete(
    "/api/auth/sessions",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const revoked = await revokeUserSessions(req.user!.id, "revoked_by_user", req.sessionId);
      await recordAudit({
        userId: req.user!.id,
        action: "session.revoke_others",
        entityType: "user",
        entityId: req.user!.id,
        after: { revoked },
        req,
      });
      res.json({ revoked });
    })
  );

  app.delete(
    "/api/auth/sessions/:id",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const id = req.params.id;
      if (!/^[0-9a-f-]{36}$/i.test(id)) return bad(res, 404, "SESSION_NOT_FOUND", "Session not found");
      const revoked = await revokeSession(req.user!.id, id, "revoked_by_user");
      if (!revoked) return bad(res, 404, "SESSION_NOT_FOUND", "Session not found");
      await recordAudit({ userId: req.user!.id, action: "session.revoke", entityType: "session", entityId: id, req });
      res.status(204).end();
    })
  );

  // ── Change password ─────────────────────────────────────────────────
  app.post(
    "/api/auth/change-password",
    authMiddleware,
    twoFactorAttemptLimiter,
    asyncHandler(async (req: Request, res: Response) => {
      const parsed = changePasswordSchema.safeParse(req.body ?? {});
      if (!parsed.success) return bad(res, 400, "VALIDATION_ERROR", "Current and new password are required");
      const pw = passwordSchema.safeParse(parsed.data.newPassword);
      if (!pw.success) {
        return res.status(400).json({ message: pw.error.issues[0]?.message ?? "Invalid password", code: "WEAK_PASSWORD" });
      }
      const user = await storage.getUser(req.user!.id);
      if (!user || !(await bcrypt.compare(parsed.data.currentPassword, user.passwordHash))) {
        return bad(res, 401, "PASSWORD_INVALID", "Current password is incorrect");
      }
      if (await isTwoFactorEnabled(user.id)) {
        if (!parsed.data.code) return bad(res, 401, "TOTP_INVALID", "Enter your authenticator code to change your password");
        const result = await verifyTotpCode(user.id, parsed.data.code);
        if (!result.ok) return bad(res, 401, result.code, "The code is not valid");
      }
      await storage.updateUserPassword(user.id, await bcrypt.hash(parsed.data.newPassword, BCRYPT_COST));
      await storage.deletePasswordResetTokensForUser(user.id);
      const revoked = await revokeUserSessions(user.id, "password_changed", req.sessionId);
      await recordAudit({
        userId: user.id,
        action: "password.change",
        entityType: "user",
        entityId: user.id,
        after: { revokedSessions: revoked },
        req,
      });
      log.info({ userId: user.id, revoked }, "Password changed");
      res.json({ message: "Password changed", revokedSessions: revoked });
    })
  );

  // ── Company switch: require 2FA from owners/accountants/CFOs ────────
  app.patch(
    "/api/companies/:companyId/security",
    authMiddleware,
    requireRole("owner"),
    asyncHandler(async (req: Request, res: Response) => {
      const parsed = z.object({ requireTwoFactor: z.boolean() }).strict().safeParse(req.body ?? {});
      if (!parsed.success) return bad(res, 400, "VALIDATION_ERROR", "requireTwoFactor must be true or false");
      const { companyId } = req.params;
      const [row] = await db
        .update(companies)
        .set({ requireTwoFactor: parsed.data.requireTwoFactor })
        .where(eq(companies.id, companyId))
        .returning({ id: companies.id, requireTwoFactor: companies.requireTwoFactor });
      if (!row) return bad(res, 404, "NOT_FOUND", "Company not found");
      // Turning the rule on: sessions of owners/accountants/CFOs without TOTP end now, so their next
      // sign-in gets an enrol-only token instead of full access.
      let revokedSessions = 0;
      if (row.requireTwoFactor) {
        const res2: any = await db.execute(sql`
          UPDATE refresh_sessions SET revoked_at = now(), revoked_reason = 'company_requires_2fa'
           WHERE revoked_at IS NULL AND user_id IN (
             SELECT cu.user_id FROM company_users cu
              WHERE cu.company_id = ${companyId} AND cu.role IN ('owner', 'accountant', 'cfo')
                AND NOT EXISTS (SELECT 1 FROM user_totp t WHERE t.user_id = cu.user_id AND t.enabled_at IS NOT NULL))`);
        revokedSessions = res2.rowCount ?? 0;
      }
      await recordAudit({
        userId: req.user!.id,
        companyId,
        action: "company.require_two_factor",
        entityType: "company",
        entityId: companyId,
        after: { requireTwoFactor: row.requireTwoFactor },
        req,
      });
      res.json({ requireTwoFactor: row.requireTwoFactor, revokedSessions });
    })
  );
}
