import type { Request, Response } from "express";
import { Router } from "express";
import type { Express } from "express";
import bcrypt from "bcryptjs";
import { randomBytes, createHash, randomUUID } from "crypto";
import { z } from "zod";

import { storage } from "../storage";
import { getEnv } from "../config/env";
import {
  authMiddleware,
  clearAuthenticationCache,
  generateToken,
  generateRefreshToken,
  verifyRefreshToken,
  verifySignedToken,
  REFRESH_TOKEN_TTL_MS,
} from "../middleware/auth";
import {
  clearAuthCookies,
  getAccessTokenFromRequest,
  getRefreshTokenFromRequest,
  setAuthCookies,
} from "../services/auth-cookies.service";
import {
  blacklistToken,
  createRefreshSession,
  getRefreshSession,
  hashToken,
  isTokenBlacklisted,
  listActiveSessions,
  revokeAllUserTokens,
  revokeRefreshSession,
  rotateRefreshSession,
} from "../services/auth-tokens.service";
import { hasEmailProvider, sendEmail, sendPasswordResetEmail } from "../services/email.service";
import { asyncHandler } from "../middleware/errorHandler";
import { validate } from "../middleware/validate";
import { strictBody } from "../http/strict-body";
import { forgotPasswordSchema, resetPasswordSchema } from "../../shared/validators";
import { zEmail, zText, zUuid } from "../../shared/validators/primitives";
import { getCapability } from "../../shared/capabilities";
import { createDefaultAccountsForCompany } from "../defaultChartOfAccounts";
import { createLogger } from "../config/logger";
import { isPlaceholderPasswordHash, passwordPolicySchema } from "../auth";
import {
  LockoutTracker,
  clientIp,
  credentialKey,
  loginLockoutRules,
  type LockoutStatus,
} from "../middleware/rateLimit";
import {
  consumeOAuthState,
  createOAuthAuthorizationUrl,
  exchangeOAuthCallback,
  getAuthIdentity,
  getOAuthProviderInfo,
  getUserByNormalizedOAuthEmail,
  isOAuthProviderId,
  linkAuthIdentity,
  markOAuthLogin,
  oauthCallbackFailureUrl,
  oauthCallbackSuccessUrl,
  oauthRedirectUri,
  type OAuthIdentityProfile,
} from "../services/oauth.service";

const log = createLogger("auth");

function publicUser(user: any) {
  const {
    passwordHash: _passwordHash,
    password: _password,
    tokenVersion: _tokenVersion,
    ...safeUser
  } = user;
  return safeUser;
}

// =============================================
// Sessions and tokens
// =============================================

interface TokenUser {
  id: string;
  email: string;
  isAdmin?: boolean;
  userType?: string;
  firmRole?: string | null;
  tokenVersion?: number | null;
}

function sessionMeta(req: Request) {
  return { userAgent: req.get("user-agent") ?? null, ipAddress: clientIp(req) };
}

/**
 * Start a new device session: one refresh_sessions row, an access token and
 * a refresh token that both carry its id (`sid`) and the user's current
 * token version (`tv`).
 */
export async function issueAuthTokens(req: Request, res: Response, user: TokenUser) {
  const sessionId = randomUUID();
  const refreshToken = generateRefreshToken(user, sessionId);
  await createRefreshSession(
    user.id,
    refreshToken,
    new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
    sessionMeta(req),
    sessionId
  );
  const token = generateToken(user, sessionId);
  setAuthCookies(res, token, refreshToken);
  return { token, refreshToken, sessionId };
}

async function auditSecurityEvent(
  req: Request,
  action: string,
  userId: string | null,
  details: Record<string, unknown>
): Promise<void> {
  try {
    await storage.createAuditLog({
      userId,
      action,
      resourceType: "user",
      resourceId: userId,
      details: JSON.stringify(details),
      ipAddress: clientIp(req),
      userAgent: req.get("user-agent") ?? null,
    });
  } catch (err) {
    log.warn({ err, action }, "Failed to write security audit log");
  }
}

async function createOAuthCustomer(req: Request, profile: OAuthIdentityProfile) {
  const passwordHash = await bcrypt.hash(randomBytes(32).toString("hex"), 10);
  const user = await storage.createUser({
    name: profile.name,
    email: profile.email,
    userType: "customer",
    isAdmin: false,
    passwordHash,
    emailVerified: true,
    avatarUrl: profile.picture,
  } as any);
  await provisionCustomerCompany(user.id, `${profile.name}'s Company`);
  return user;
}

async function resolveOAuthUser(
  req: Request,
  profile: OAuthIdentityProfile
): Promise<{ user: any; mode: "existing_identity" | "linked_existing" | "created_customer" }> {
  const identity = await getAuthIdentity(profile);
  if (identity) {
    const user = await storage.getUser(identity.userId);
    if (!user) throw new Error("OAuth identity is linked to a missing user");
    await markOAuthLogin(user.id, profile);
    return { user: (await storage.getUser(user.id)) ?? user, mode: "existing_identity" };
  }

  const existingUser = await getUserByNormalizedOAuthEmail(profile.email);
  if (existingUser) {
    await linkAuthIdentity(existingUser.id, profile);
    await markOAuthLogin(existingUser.id, profile);
    return {
      user: (await storage.getUser(existingUser.id)) ?? existingUser,
      mode: "linked_existing",
    };
  }

  const createdUser = await createOAuthCustomer(req, profile);
  await linkAuthIdentity(createdUser.id, profile);
  await markOAuthLogin(createdUser.id, profile);
  return { user: (await storage.getUser(createdUser.id)) ?? createdUser, mode: "created_customer" };
}

function callbackUrlFromRequest(req: Request, provider: "google" | "microsoft"): URL {
  const url = new URL(oauthRedirectUri(req, provider));
  for (const [key, value] of Object.entries(req.query)) {
    if (Array.isArray(value)) {
      for (const entry of value) {
        if (typeof entry === "string") url.searchParams.append(key, entry);
      }
    } else if (typeof value === "string") {
      url.searchParams.set(key, value);
    }
  }
  return url;
}

// =============================================
// Helpers (migrated from monolith routes.ts)
// =============================================

/**
 * Seed Chart of Accounts for a newly created company.
 */
async function seedChartOfAccounts(
  companyId: string
): Promise<{ created: number; alreadyExisted: boolean }> {
  const hasAccounts = await storage.companyHasAccounts(companyId);
  if (hasAccounts) {
    log.info({ companyId }, "Company already has accounts, skipping seed");
    return { created: 0, alreadyExisted: true };
  }

  const defaultAccounts = createDefaultAccountsForCompany(companyId);

  try {
    const createdAccounts = await storage.createBulkAccounts(defaultAccounts as any);
    log.info({ companyId, count: createdAccounts.length }, "Seeded chart of accounts");
    return { created: createdAccounts.length, alreadyExisted: false };
  } catch (error: any) {
    if (error.message?.includes("PARTIAL_INSERT")) {
      log.error({ companyId, message: error.message }, "Partial COA insert detected");
      throw new Error(
        "PARTIAL_CHART: Chart of Accounts partially created due to race condition. Please contact support."
      );
    }
    throw error;
  }
}

/** Company + owner membership + chart of accounts + free plan for a new customer. */
async function provisionCustomerCompany(
  userId: string,
  companyName: string,
  extra: { trnVatNumber?: string } = {}
) {
  const company = await storage.createCompany({
    name: companyName,
    baseCurrency: "AED",
    locale: "en",
    companyType: "customer", // Self-signup companies are customer type (not managed by NR)
    ...(extra.trnVatNumber ? { trnVatNumber: extra.trnVatNumber } : {}),
  } as any);

  await storage.createCompanyUser({ companyId: company.id, userId, role: "owner" });
  await seedChartOfAccounts(company.id);

  const now = new Date();
  const periodEnd = new Date(now);
  periodEnd.setFullYear(periodEnd.getFullYear() + 100); // Free tier never expires
  await storage.createSubscription({
    companyId: company.id,
    planId: "free",
    planName: "Free",
    status: "active",
    currentPeriodStart: now,
    currentPeriodEnd: periodEnd,
    maxUsers: 1,
    maxInvoices: 20,
    maxReceipts: 20,
    aiCreditsRemaining: 10,
  } as any);
  return company;
}

function isUniqueViolation(err: unknown): boolean {
  return (err as { code?: string } | null)?.code === "23505";
}

// ─── Request schemas ──────────────────────────────────────────────────────

const registerBodySchema = z.object({
  name: zText(100, { min: 1 }),
  email: zEmail,
  password: passwordPolicySchema,
  companyName: zText(200).optional(),
  trn: z
    .string()
    .trim()
    .regex(/^\d{15}$/, "TRN must be exactly 15 digits")
    .optional(),
  phone: zText(40).optional(),
});
type RegisterBody = z.output<typeof registerBodySchema>;

const loginBodySchema = z.object({
  email: z.string().max(320),
  password: z.string().max(1024),
});

const changePasswordBodySchema = z.object({
  currentPassword: z.string().min(1).max(1024),
  newPassword: passwordPolicySchema,
});

const acceptAdminInvitationSchema = z.object({
  name: zText(100, { min: 1 }),
  password: passwordPolicySchema,
});

/**
 * R17-14: registration answers the same way whether or not the email is
 * already registered: 200 with this message. A NEW address additionally
 * gets a signed-in session (so login-after-register keeps working); an
 * existing address gets no session and its owner is told by email when a
 * provider is configured. The remaining signal (session present or not) is
 * a documented trade-off until email verification gates sessions.
 */
const GENERIC_REGISTER_MESSAGE =
  "If this email can be used, your account is ready. Check your inbox if you already have an account.";

function retryAfterBody(message: string, code: string, retryAfterMs: number) {
  return {
    message,
    code,
    details: { retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)) },
  };
}

// =============================================
// Route registration
// =============================================

export function registerAuthRoutes(app: Express): void {
  const router = Router();

  // Per-app trackers (rebuilt with the app; in-memory per instance).
  const loginLockout = new LockoutTracker(loginLockoutRules());
  const changePasswordLockout = new LockoutTracker(loginLockoutRules());
  const forgotPasswordBudget = new LockoutTracker(loginLockoutRules());
  const resetPasswordLockout = new LockoutTracker(loginLockoutRules());

  // Dummy bcrypt hash generated once at startup. Used when the email is
  // unknown so we still spend CPU on a comparison — this removes the
  // timing signal that distinguishes "no such user" from "wrong password".
  const DUMMY_HASH = bcrypt.hashSync("account_enumeration_placeholder", 10);

  async function onLockout(
    req: Request,
    email: string,
    user: { id: string; email: string } | undefined,
    status: LockoutStatus
  ): Promise<void> {
    const retryAfterSeconds = Math.ceil(status.retryAfterMs / 1000);
    await auditSecurityEvent(req, "auth.lockout", user?.id ?? null, {
      email,
      failures: status.failures,
      retryAfterSeconds,
    });
    if (!user) return;
    try {
      await storage.createNotification({
        userId: user.id,
        companyId: null,
        type: "system",
        title: "Sign-in temporarily locked",
        message: `Several failed sign-in attempts were made on your account. Sign-in is paused for about ${Math.ceil(retryAfterSeconds / 60)} minute(s). If this was not you, reset your password.`,
        priority: "high",
        actionUrl: "/settings",
      } as any);
    } catch (err) {
      log.warn({ err, userId: user.id }, "Failed to create lockout notification");
    }
    if (hasEmailProvider()) {
      void sendEmail(
        user.email,
        "Failed sign-in attempts on your account",
        "We paused sign-in to your account after several failed password attempts. If this was not you, reset your password now."
      ).catch(() => undefined);
    }
  }

  // =====================================
  // Auth Routes
  // =====================================

  // Customer self-signup (SaaS customers only - clients must use invitation)
  router.post(
    "/auth/register",
    strictBody(registerBodySchema),
    asyncHandler(async (req: Request, res: Response) => {
      const { ...body } = req.body as RegisterBody;
      const existingUser = await storage.getUserByEmail(body.email);
      const claimable =
        !!existingUser &&
        isPlaceholderPasswordHash(existingUser.passwordHash) &&
        (await storage.getCompaniesByUserId(existingUser.id)).length === 0;

      // Hash first in every branch so timing does not reveal the outcome.
      const passwordHash = await bcrypt.hash(body.password, 10);

      if (existingUser && !claimable) {
        await auditSecurityEvent(req, "auth.register_existing", existingUser.id, {
          email: body.email,
        });
        if (hasEmailProvider()) {
          void sendEmail(
            existingUser.email,
            "Someone tried to create an account with your email",
            "Someone tried to register a new Muhasib account with this email address. You already have an account: sign in, or use 'Forgot password' if you cannot."
          ).catch(() => undefined);
        }
        return res.json({ message: GENERIC_REGISTER_MESSAGE });
      }

      // SECURITY: Force userType to 'customer' - never trust client-supplied userType.
      let user;
      try {
        if (claimable && existingUser) {
          await storage.updateUserPassword(existingUser.id, passwordHash);
          user = await storage.updateUser(existingUser.id, { name: body.name });
        } else {
          user = await storage.createUser({
            name: body.name,
            email: body.email,
            phone: body.phone,
            userType: "customer", // FORCED: Self-signup users are always customers
            isAdmin: false, // FORCED: Self-signup users cannot be admins
            passwordHash,
          } as any);
        }
      } catch (err) {
        if (isUniqueViolation(err)) return res.json({ message: GENERIC_REGISTER_MESSAGE });
        throw err;
      }

      // R01-07: honour the supplied company name.
      const companyName = body.companyName?.trim() || `${body.name}'s Company`;
      const company = await provisionCustomerCompany(user.id, companyName, {
        trnVatNumber: body.trn,
      });

      const fresh = (await storage.getUser(user.id)) ?? user;
      const { token, refreshToken } = await issueAuthTokens(req, res, fresh);

      res.json({
        message: GENERIC_REGISTER_MESSAGE,
        token,
        refreshToken,
        user: {
          id: fresh.id,
          email: fresh.email,
          name: fresh.name,
          isAdmin: false,
          userType: "customer",
        },
        company: {
          id: company.id,
          name: company.name,
        },
      });
    })
  );

  // Login with per email+IP progressive lockout (R01-12): 5 failures in 15
  // minutes, then 10 in an hour. Attempts made while locked are refused with
  // 429 and are not counted, so retrying never extends the lockout.
  router.post(
    "/auth/login",
    strictBody(loginBodySchema),
    asyncHandler(async (req: Request, res: Response) => {
      const { email, password } = req.body as z.output<typeof loginBodySchema>;
      const key = credentialKey(req, email);
      const lock = loginLockout.status(key);
      if (lock.locked) {
        res.setHeader("Retry-After", String(Math.ceil(lock.retryAfterMs / 1000)));
        return res
          .status(429)
          .json(
            retryAfterBody(
              "Too many failed sign-in attempts for this email. Please wait before trying again.",
              "ACCOUNT_LOCKED",
              lock.retryAfterMs
            )
          );
      }

      const user = await storage.getUserByEmail(email);
      const usable = user && !isPlaceholderPasswordHash(user.passwordHash);
      // Always compare against *some* hash so the timing is constant.
      const isValid = usable
        ? await bcrypt.compare(password, user.passwordHash)
        : (await bcrypt.compare(password, DUMMY_HASH), false);

      if (!user || !isValid) {
        const after = loginLockout.recordFailure(key);
        if (after.lockedNow) await onLockout(req, email.trim().toLowerCase(), user, after);
        return res
          .status(401)
          .json({ message: "Invalid credentials", code: "INVALID_CREDENTIALS" });
      }
      loginLockout.reset(key);

      // Ensure isAdmin is a proper boolean
      const isAdminBoolean =
        user.isAdmin === true || (user.isAdmin as any) === "true" || (user.isAdmin as any) === 1;

      const { token, refreshToken } = await issueAuthTokens(req, res, user);

      res.json({
        token,
        refreshToken,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          isAdmin: isAdminBoolean,
          userType: user.userType || "customer", // Include userType in response
        },
      });
    })
  );

  router.get(
    "/auth/oauth/providers",
    asyncHandler(async (_req: Request, res: Response) => {
      res.json({ providers: getOAuthProviderInfo() });
    })
  );

  // R01-15: SSO configuration status for the login page. SAML is not
  // implemented; it is reported as requiring external IdP metadata.
  router.get(
    "/auth/sso/status",
    asyncHandler(async (_req: Request, res: Response) => {
      res.json(ssoStatus());
    })
  );

  router.get(
    "/auth/oauth/:provider/start",
    asyncHandler(async (req: Request, res: Response) => {
      const provider = req.params.provider;
      if (!isOAuthProviderId(provider)) {
        return res.status(404).json({ message: "Unknown OAuth provider" });
      }

      try {
        const redirectTo = await createOAuthAuthorizationUrl(provider, req, req.query.next);
        log.info({ provider, ip: req.ip }, "OAuth login started");
        return res.redirect(redirectTo.toString());
      } catch (err) {
        log.warn({ err, provider, ip: req.ip }, "OAuth login start failed");
        return res.redirect(oauthCallbackFailureUrl());
      }
    })
  );

  router.get(
    "/auth/oauth/:provider/callback",
    asyncHandler(async (req: Request, res: Response) => {
      const provider = req.params.provider;
      if (!isOAuthProviderId(provider)) {
        return res.redirect(oauthCallbackFailureUrl());
      }

      try {
        const state = await consumeOAuthState(provider, req.query.state);
        const profile = await exchangeOAuthCallback(
          provider,
          callbackUrlFromRequest(req, provider),
          state
        );
        const { user, mode } = await resolveOAuthUser(req, profile);

        await issueAuthTokens(req, res, user);
        await auditSecurityEvent(req, "login", user.id, {
          method: "oauth",
          provider: profile.provider,
          mode,
          email: profile.email,
        });
        log.info({ provider, userId: user.id, mode }, "OAuth login completed");

        return res.redirect(oauthCallbackSuccessUrl(state.nextPath));
      } catch (err) {
        log.warn({ err, provider, ip: req.ip }, "OAuth login callback failed");
        clearAuthCookies(res);
        return res.redirect(oauthCallbackFailureUrl());
      }
    })
  );

  // Refresh token endpoint. Rotates within the same device session; reusing
  // a superseded refresh token revokes the whole session (theft detection).
  const handleRefreshToken = asyncHandler(async (req: Request, res: Response) => {
    const bodyToken = (req.body as { refreshToken?: unknown } | undefined)?.refreshToken;
    const refreshToken =
      (typeof bodyToken === "string" && bodyToken) || getRefreshTokenFromRequest(req);

    if (!refreshToken) {
      return res.status(400).json({ message: "Refresh token is required" });
    }

    const payload = verifyRefreshToken(refreshToken);
    if (!payload) {
      return res.status(401).json({ message: "Invalid or expired refresh token" });
    }

    if (await isTokenBlacklisted(refreshToken)) {
      if (payload.sid) await revokeRefreshSession(payload.sid, { reuse: true });
      return res
        .status(401)
        .json({ message: "Refresh token has been revoked", code: "TOKEN_REVOKED" });
    }

    // Verify user still exists in DB
    const user = await storage.getUser(payload.userId);
    if (!user) {
      return res.status(401).json({ message: "User not found" });
    }
    if ((payload.tv ?? 0) !== (user.tokenVersion ?? 0)) {
      return res
        .status(401)
        .json({ message: "Refresh token has been revoked", code: "TOKEN_REVOKED" });
    }

    const meta = sessionMeta(req);
    let sessionId = payload.sid;
    if (sessionId) {
      const session = await getRefreshSession(sessionId);
      const presented = hashToken(refreshToken);
      if (!session || session.userId !== user.id || session.revokedAt) {
        return res
          .status(401)
          .json({ message: "Session has been revoked", code: "SESSION_REVOKED" });
      }
      if (session.tokenHash !== presented) {
        if (session.replacedByTokenHash === presented) {
          await revokeRefreshSession(sessionId, { reuse: true });
          log.warn({ userId: user.id, sessionId }, "Refresh token reuse detected; session revoked");
        }
        return res
          .status(401)
          .json({ message: "Refresh token has been revoked", code: "TOKEN_REVOKED" });
      }
    }

    // Rotation: the consumed token can never be replayed.
    await blacklistToken(refreshToken);
    if (!sessionId) {
      // Legacy refresh token (issued before sessions): start a session now.
      sessionId = randomUUID();
      const newRefresh = generateRefreshToken(user, sessionId);
      await createRefreshSession(
        user.id,
        newRefresh,
        new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
        meta,
        sessionId
      );
      const newToken = generateToken(user, sessionId);
      setAuthCookies(res, newToken, newRefresh);
      return res.json({ token: newToken, refreshToken: newRefresh });
    }
    const newRefreshToken = generateRefreshToken(user, sessionId);
    await rotateRefreshSession(
      sessionId,
      refreshToken,
      newRefreshToken,
      new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
      meta
    );
    const newToken = generateToken(user, sessionId);
    setAuthCookies(res, newToken, newRefreshToken);

    res.json({
      token: newToken,
      refreshToken: newRefreshToken,
    });
  });

  router.post("/auth/refresh-token", handleRefreshToken);
  router.post("/auth/refresh", handleRefreshToken);

  // =====================================
  // PASSWORD RESET
  // =====================================

  const hashResetToken = (token: string): string =>
    createHash("sha256").update(token).digest("hex");

  // Request a password reset link. Always returns 200 so callers cannot
  // discover whether a specific email is registered. Every request counts
  // against an email+IP budget (5 per 15 minutes).
  router.post(
    "/auth/forgot-password",
    validate({ body: forgotPasswordSchema }),
    asyncHandler(async (req: Request, res: Response) => {
      const { email } = req.body as { email: string };
      const key = credentialKey(req, email);
      const budget = forgotPasswordBudget.status(key);
      if (budget.locked) {
        res.setHeader("Retry-After", String(Math.ceil(budget.retryAfterMs / 1000)));
        return res
          .status(429)
          .json(
            retryAfterBody(
              "Too many reset requests for this email. Please wait before trying again.",
              "RATE_LIMITED",
              budget.retryAfterMs
            )
          );
      }
      forgotPasswordBudget.recordFailure(key);

      const user = await storage.getUserByEmail(email);
      const genericResponse = {
        message: "If that email is registered, a reset link has been sent.",
      };

      if (!user) {
        return res.json(genericResponse);
      }

      const rawToken = randomBytes(32).toString("hex");
      const tokenHash = hashResetToken(rawToken);
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

      await storage.deletePasswordResetTokensForUser(user.id);
      await storage.createPasswordResetToken({ userId: user.id, tokenHash, expiresAt });

      const env = getEnv();
      // Canonical public URL: FRONTEND_URL first, AUTH_PUBLIC_URL as fallback
      // (same precedence as OAuth redirects in oauth.service.ts).
      const appUrl = (env.FRONTEND_URL || env.AUTH_PUBLIC_URL || "").replace(/\/+$/, "");
      const resetUrl = `${appUrl}/reset-password?token=${rawToken}`;

      log.info({ userId: user.id }, "Password reset requested");

      if (env.NODE_ENV !== "production") {
        return res.json({ ...genericResponse, devResetUrl: resetUrl });
      }

      if (!appUrl) {
        log.error("FRONTEND_URL/AUTH_PUBLIC_URL not set; cannot build password reset link");
      } else if (!hasEmailProvider()) {
        log.error(
          "No email provider configured (RESEND_API_KEY or SMTP_*); password reset email not sent"
        );
      } else {
        // Failures stay server-side: the response is identical either way so
        // callers can't probe which emails exist or whether delivery worked.
        try {
          await sendPasswordResetEmail(user.email, resetUrl);
        } catch (err) {
          log.error({ err, userId: user.id }, "Failed to send password reset email");
        }
      }

      return res.json(genericResponse);
    })
  );

  router.post(
    "/auth/reset-password",
    validate({ body: resetPasswordSchema }),
    asyncHandler(async (req: Request, res: Response) => {
      const { token, password } = req.body as { token: string; password: string };
      const key = `reset|${clientIp(req)}`;
      const lock = resetPasswordLockout.status(key);
      if (lock.locked) {
        res.setHeader("Retry-After", String(Math.ceil(lock.retryAfterMs / 1000)));
        return res
          .status(429)
          .json(
            retryAfterBody(
              "Too many invalid reset attempts. Please wait before trying again.",
              "RATE_LIMITED",
              lock.retryAfterMs
            )
          );
      }
      passwordPolicySchema.parse(password);

      const tokenHash = hashResetToken(token);
      const record = await storage.findValidPasswordResetToken(tokenHash);

      if (!record) {
        resetPasswordLockout.recordFailure(key);
        return res.status(400).json({
          message: "This reset link is invalid or has expired. Please request a new one.",
          code: "RESET_TOKEN_INVALID",
        });
      }

      const passwordHash = await bcrypt.hash(password, 10);
      await storage.updateUserPassword(record.userId, passwordHash);
      await storage.markPasswordResetTokenUsed(record.id);
      await storage.deletePasswordResetTokensForUser(record.userId);
      // R01-06: every device signed in before the reset is signed out.
      await revokeAllUserTokens(record.userId);
      await auditSecurityEvent(req, "auth.password_reset", record.userId, {});

      log.info({ userId: record.userId }, "Password reset completed");

      res.json({
        message:
          "Your password has been reset and every other session was signed out. You can now sign in with your new password.",
      });
    })
  );

  // R01-13: change password while signed in. Revokes every other session and
  // token, then starts a fresh session for this device.
  router.post(
    "/auth/change-password",
    authMiddleware as any,
    strictBody(changePasswordBodySchema),
    asyncHandler(async (req: Request, res: Response) => {
      const userId = req.user!.id;
      const { currentPassword, newPassword } = req.body as z.output<
        typeof changePasswordBodySchema
      >;
      const key = `cp|${userId}`;
      const lock = changePasswordLockout.status(key);
      if (lock.locked) {
        res.setHeader("Retry-After", String(Math.ceil(lock.retryAfterMs / 1000)));
        return res
          .status(429)
          .json(
            retryAfterBody(
              "Too many failed attempts. Please wait before trying again.",
              "ACCOUNT_LOCKED",
              lock.retryAfterMs
            )
          );
      }
      const user = await storage.getUser(userId);
      if (!user) return res.status(401).json({ message: "User not found" });
      const ok =
        !isPlaceholderPasswordHash(user.passwordHash) &&
        (await bcrypt.compare(currentPassword, user.passwordHash));
      if (!ok) {
        changePasswordLockout.recordFailure(key);
        return res
          .status(400)
          .json({ message: "Current password is incorrect", code: "CURRENT_PASSWORD_INVALID" });
      }
      if (await bcrypt.compare(newPassword, user.passwordHash)) {
        return res.status(400).json({
          message: "Choose a password different from the current one",
          code: "PASSWORD_UNCHANGED",
        });
      }
      changePasswordLockout.reset(key);

      await storage.updateUserPassword(userId, await bcrypt.hash(newPassword, 10));
      await revokeAllUserTokens(userId);
      await auditSecurityEvent(req, "auth.password_change", userId, {});
      clearAuthenticationCache(req);

      const fresh = (await storage.getUser(userId))!;
      const { token, refreshToken } = await issueAuthTokens(req, res, fresh);
      res.json({
        message: "Password changed. Every other session was signed out.",
        token,
        refreshToken,
      });
    })
  );

  // R01-13: list and revoke device sessions.
  router.get(
    "/auth/sessions",
    authMiddleware as any,
    asyncHandler(async (req: Request, res: Response) => {
      const sessions = await listActiveSessions(req.user!.id);
      res.json({
        sessions: sessions.map((s) => ({ ...s, current: s.id === req.authSessionId })),
      });
    })
  );

  router.delete(
    "/auth/sessions/:sessionId",
    authMiddleware as any,
    asyncHandler(async (req: Request, res: Response) => {
      const parsed = zUuid.safeParse(req.params.sessionId);
      if (!parsed.success) {
        return res.status(404).json({ message: "Session not found", code: "NOT_FOUND" });
      }
      const revoked = await revokeRefreshSession(parsed.data, { userId: req.user!.id });
      if (!revoked) {
        return res.status(404).json({ message: "Session not found", code: "NOT_FOUND" });
      }
      await auditSecurityEvent(req, "auth.session_revoked", req.user!.id, {
        sessionId: parsed.data,
      });
      if (parsed.data === req.authSessionId) clearAuthCookies(res);
      res.json({ ok: true, current: parsed.data === req.authSessionId });
    })
  );

  router.post(
    "/auth/logout-all",
    authMiddleware as any,
    asyncHandler(async (req: Request, res: Response) => {
      await revokeAllUserTokens(req.user!.id);
      await auditSecurityEvent(req, "auth.logout_all", req.user!.id, {});
      clearAuthCookies(res);
      res.json({ ok: true });
    })
  );

  router.get(
    "/auth/me",
    authMiddleware as any,
    asyncHandler(async (req: Request, res: Response) => {
      const userId = (req as any).user.id;
      const user = await storage.getUser(userId);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }
      res.json(publicUser(user));
    })
  );

  // Logout endpoint — revokes the device session plus the access and refresh
  // tokens presented. Malformed tokens are a no-op (we still return 200 so
  // the client proceeds with its local cleanup).
  router.post(
    "/auth/logout",
    asyncHandler(async (req: Request, res: Response) => {
      const revokeIfValid = async (raw: string | undefined) => {
        if (!raw) return;
        const decoded = verifySignedToken(raw);
        if (!decoded?.exp) return; // invalid or already expired
        await blacklistToken(raw);
        if (decoded.sid) await revokeRefreshSession(decoded.sid, { userId: decoded.userId });
      };

      const authHeader = req.headers.authorization;
      const accessToken =
        getAccessTokenFromRequest(req) ||
        (authHeader?.startsWith("Bearer ") ? authHeader.substring(7) : undefined);
      const bodyToken = (req.body as { refreshToken?: unknown } | undefined)?.refreshToken;
      const refreshToken: string | undefined =
        (typeof bodyToken === "string" && bodyToken) ||
        getRefreshTokenFromRequest(req) ||
        undefined;

      await revokeIfValid(accessToken);
      await revokeIfValid(refreshToken);
      clearAuthCookies(res);

      res.json({ ok: true });
    })
  );

  // =====================================
  // PUBLIC - INVITATION ACCEPTANCE (admin-created client invitations)
  // =====================================

  // Verify invitation token (public endpoint)
  router.get(
    "/invitations/verify/:token",
    asyncHandler(async (req: Request, res: Response) => {
      const { token } = req.params;
      const invitation = await storage.getInvitationByToken(token);

      if (!invitation) {
        return res.status(404).json({ message: "Invitation not found" });
      }

      if (invitation.status !== "pending") {
        return res.status(400).json({ message: `Invitation has been ${invitation.status}` });
      }

      if (new Date() > invitation.expiresAt) {
        return res.status(400).json({ message: "Invitation has expired" });
      }

      // Get company details if associated
      let company = null;
      if (invitation.companyId) {
        company = await storage.getCompany(invitation.companyId);
      }

      res.json({
        email: invitation.email,
        role: invitation.role,
        userType: invitation.userType,
        company: company ? { id: company.id, name: company.name } : null,
      });
    })
  );

  // Accept invitation and create account (public endpoint)
  router.post(
    "/invitations/accept/:token",
    strictBody(acceptAdminInvitationSchema),
    asyncHandler(async (req: Request, res: Response) => {
      const { token } = req.params;
      const { name, password } = req.body as z.output<typeof acceptAdminInvitationSchema>;

      const invitation = await storage.getInvitationByToken(token);

      if (!invitation) {
        return res.status(404).json({ message: "Invitation not found" });
      }

      if (invitation.status !== "pending") {
        return res.status(400).json({ message: `Invitation has been ${invitation.status}` });
      }

      if (new Date() > invitation.expiresAt) {
        return res.status(400).json({ message: "Invitation has expired" });
      }

      // Check if user already exists
      const existingUser = await storage.getUserByEmail(invitation.email);
      if (existingUser) {
        return res.status(400).json({ message: "User already exists with this email" });
      }

      // Create user with appropriate userType from invitation.
      // Only pass passwordHash — never the raw password.
      const passwordHash = await bcrypt.hash(password, 10);
      const user = await storage.createUser({
        email: invitation.email,
        name,
        isAdmin: invitation.role === "staff" || invitation.userType === "admin",
        userType: invitation.userType || "client",
        passwordHash,
      } as any);

      // If company associated, add user to company and set company type
      if (invitation.companyId) {
        await storage.createCompanyUser({
          companyId: invitation.companyId,
          userId: user.id,
          role: "owner", // Client users are owners of their company view
        });

        // Set company type based on user type (client companies are managed by NR)
        if (invitation.userType === "client") {
          await storage.updateCompany(invitation.companyId, {
            companyType: "client",
          });
        }
      }

      // Mark invitation as accepted
      await storage.updateInvitation(invitation.id, {
        status: "accepted",
        acceptedAt: new Date(),
      });

      // Log activity
      await storage.createActivityLog({
        userId: user.id,
        companyId: invitation.companyId || null,
        action: "create",
        entityType: "user",
        entityId: user.id,
        description: `User registered via invitation: ${user.email}`,
      });

      const { token: jwtToken, refreshToken } = await issueAuthTokens(req, res, user);

      res.json({ user: publicUser(user), token: jwtToken, refreshToken });
    })
  );

  // Mount all auth routes under /api
  app.use("/api", router);
}

/** OAuth providers + SAML capability, for the login page and the admin endpoint. */
export function ssoStatus() {
  const saml = getCapability("saml");
  return {
    providers: getOAuthProviderInfo().map((p) => ({
      id: p.id,
      label: p.label,
      configured: p.configured,
      status: p.configured ? "live" : "disabled",
    })),
    saml: {
      id: "saml",
      // No SAML implementation exists yet: even with IdP metadata in env the
      // flow is not built, so the status stays requires_external.
      status: "requires_external" as const,
      implemented: false,
      configuredEnv: saml.status === "live",
      label: saml.label,
      externalAction: saml.externalAction,
    },
  };
}
