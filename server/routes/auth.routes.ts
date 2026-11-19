import type { Request, Response } from "express";
import { Router } from "express";
import type { Express } from "express";
import bcrypt from "bcryptjs";
import { randomBytes, createHash, randomUUID } from "crypto";
import { z } from "zod";

import { storage } from "../storage";
import { getEnv, isProduction } from "../config/env";
import { notificationCopy } from "../../shared/server-copy";
import {
  authMiddleware,
  clearAuthenticationCache,
  generateMfaPendingToken,
  generateToken,
  generateRefreshToken,
  verifyMfaPendingToken,
  verifyRefreshToken,
  verifySignedToken,
  REFRESH_TOKEN_TTL_MS,
} from "../middleware/auth";
import {
  ACCESS_TOKEN_TTL_SECONDS,
  accessCookieName,
  clearAuthCookies,
  getAccessTokenFromRequest,
  getRefreshTokenFromRequest,
  setAuthCookies,
} from "../services/auth-cookies.service";
import { authCookieBaseOptions } from "../config/cookies";
import {
  beginEnrollment,
  confirmEnrollment,
  disableMfa,
  isMfaEnabled,
  mfaStatus,
  regenerateRecoveryCodes,
  verifySecondFactor,
} from "../services/mfa.service";
import { verifyCaptcha, captchaStatus } from "../services/security/captcha";
import {
  BREACHED_PASSWORD_MESSAGE,
  breachedPasswordStatus,
  checkBreachedPassword,
} from "../services/security/breached-password";
import {
  consumeVerificationToken,
  sendVerificationEmail,
} from "../services/security/email-verification";
import {
  emailVerificationState,
  getCompanyMfaPolicy,
  policyCoversRole,
} from "../services/security/policy";
import { recordLoginSuccess, recordSecurityEvent } from "../services/security/security-events";
import { normalizeCompanyRole } from "../../shared/permissions";
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
import { ensureFreeSubscription } from "../middleware/featureGate";
import { strictBody } from "../http/strict-body";
import { forgotPasswordSchema, resetPasswordSchema } from "../../shared/validators";
import { zEmail, zText, zUuid } from "../../shared/validators/primitives";
import { getCapability } from "../../shared/capabilities";
import type { User } from "../../shared/schema";
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

function publicUser(user: Record<string, unknown>) {
  const {
    passwordHash: _passwordHash,
    password: _password,
    tokenVersion: _tokenVersion,
    ...safeUser
  } = user;
  return safeUser;
}

/** httpOnly cookie carrying the MFA-pending token after a social sign-in. */
function mfaPendingCookie(): string {
  return isProduction() ? "__Host-muhasib-mfa" : "muhasib-mfa";
}

function readCookie(req: Request, name: string): string | null {
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name && v.length) {
      try {
        return decodeURIComponent(v.join("="));
      } catch {
        return null;
      }
    }
  }
  return null;
}

/** Companies (id + policy) whose MFA policy covers this user's role while they lack MFA. */
async function companiesRequiringMfa(userId: string): Promise<string[]> {
  const companies = await storage.getCompaniesByUserId(userId);
  const out: string[] = [];
  for (const c of companies) {
    const policy = await getCompanyMfaPolicy(c.id);
    if (policy === "none") continue;
    const membership = await storage.getUserRole(c.id, userId);
    if (policyCoversRole(policy, membership ? normalizeCompanyRole(membership.role) : null)) {
      out.push(c.id);
    }
  }
  return out;
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
export async function issueAuthTokens(
  req: Request,
  res: Response,
  user: TokenUser,
  opts: { mfaAt?: number | null } = {}
) {
  const sessionId = randomUUID();
  const claims = { mfaAt: opts.mfaAt ?? null };
  const refreshToken = generateRefreshToken(user, sessionId, claims);
  await createRefreshSession(
    user.id,
    refreshToken,
    new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
    sessionMeta(req),
    sessionId
  );
  const token = generateToken(user, sessionId, claims);
  setAuthCookies(res, token, refreshToken);
  return { token, refreshToken, sessionId };
}

/** Account-level security event (tamper-evident audit chain; see security-events.ts). */
async function auditSecurityEvent(
  req: Request,
  action: string,
  userId: string | null,
  details: Record<string, unknown>
): Promise<void> {
  await recordSecurityEvent(req, { action, userId, resourceType: "user", details });
}

function captchaFailure(res: Response, reason: string) {
  return res.status(400).json({
    message: "Please complete the bot check and try again.",
    code: "CAPTCHA_FAILED",
    details: { reason },
  });
}

async function refuseBreachedPassword(res: Response, password: string): Promise<boolean> {
  const verdict = await checkBreachedPassword(password);
  if (!verdict.breached) return false;
  res.status(400).json({
    message: BREACHED_PASSWORD_MESSAGE,
    code: "PASSWORD_BREACHED",
    details: { source: verdict.source },
  });
  return true;
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
  } as unknown as Parameters<typeof storage.createUser>[0]);
  await provisionCustomerCompany(user.id, `${profile.name}'s Company`);
  return user;
}

async function resolveOAuthUser(
  req: Request,
  profile: OAuthIdentityProfile
): Promise<{ user: User; mode: "existing_identity" | "linked_existing" | "created_customer" }> {
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
    const createdAccounts = await storage.createBulkAccounts(
      defaultAccounts as Parameters<typeof storage.createBulkAccounts>[0]
    );
    log.info({ companyId, count: createdAccounts.length }, "Seeded chart of accounts");
    return { created: createdAccounts.length, alreadyExisted: false };
  } catch (error) {
    if ((error as Error).message?.includes("PARTIAL_INSERT")) {
      log.error({ companyId, message: (error as Error).message }, "Partial COA insert detected");
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
  } as Parameters<typeof storage.createCompany>[0]);

  await storage.createCompanyUser({ companyId: company.id, userId, role: "owner" });
  await seedChartOfAccounts(company.id);

  // S5: the Free row is created by the companies INSERT trigger (migration 0113);
  // ensureFreeSubscription is idempotent, so this never creates a second row.
  await ensureFreeSubscription(company.id);
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
  /** Cloudflare Turnstile token; required only when TURNSTILE_SECRET_KEY is set. */
  captchaToken: z.string().max(4096).optional(),
});
type RegisterBody = z.output<typeof registerBodySchema>;

const loginBodySchema = z.object({
  email: z.string().max(320),
  password: z.string().max(1024),
});

const mfaCodeSchema = z.string().trim().min(6).max(32);
const mfaVerifyLoginSchema = z.object({
  /** Omitted after social sign-in: the pending token is then in the MFA cookie. */
  mfaToken: z.string().min(1).max(4096).optional(),
  code: mfaCodeSchema,
});
const mfaCodeBodySchema = z.object({ code: mfaCodeSchema });
const mfaDisableSchema = z.object({
  password: z.string().min(1).max(1024),
  code: mfaCodeSchema,
});
const verifyEmailSchema = z.object({ token: z.string().min(1).max(256) });
const loginHistoryQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
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
 * R17-14 / W5-E: registration answers byte-for-byte the same way whether or not the
 * email is already registered: 200 with this body and no session. A new address gets a
 * verification link; an existing address gets a "someone tried to register" notice. The
 * client then signs in with the password it just chose (unverified accounts can sign in;
 * see policy.ts for the grace-period gating), so the response itself is no oracle.
 */
const GENERIC_REGISTER_MESSAGE =
  "Check your email to confirm your address. If you already have an account, sign in instead.";
const NO_PROVIDER_REGISTER_MESSAGE =
  "Your account is ready; you can sign in now. Email delivery is not set up yet, so no confirmation email was sent.";
/**
 * The body depends only on whether the platform has an email provider (identical for every
 * address, so it is no enumeration oracle) and never claims an email was sent when none can be.
 */
function genericRegisterBody() {
  const emailDelivery = hasEmailProvider();
  return {
    message: emailDelivery ? GENERIC_REGISTER_MESSAGE : NO_PROVIDER_REGISTER_MESSAGE,
    verificationRequired: emailDelivery,
    emailDelivery: emailDelivery ? ("available" as const) : ("unavailable" as const),
    next: "login",
  };
}

/**
 * 429 body for the credential throttles. `messageKey` names the client catalog entry
 * (`components.authErrors.*` / `forms.serverErrors.*`) so the sentence is shown in the user's language (B14); `message`
 * stays the English text for API clients.
 */
function retryAfterBody(message: string, code: string, retryAfterMs: number, messageKey: string) {
  return {
    message,
    code,
    messageKey,
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
  const mfaLockout = new LockoutTracker(loginLockoutRules());

  /** Body of a successful sign-in (password, or password + second factor). */
  async function loginResponse(
    user: {
      id: string;
      email: string;
      name: string;
      isAdmin: unknown;
      userType: string | null;
      emailVerified: boolean;
      createdAt: Date;
    },
    token: string,
    refreshToken: string
  ) {
    const mfaRequiredBy = (await isMfaEnabled(user.id)) ? [] : await companiesRequiringMfa(user.id);
    return {
      token,
      refreshToken,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        isAdmin: user.isAdmin === true,
        userType: user.userType || "customer",
      },
      mfaEnrollmentRequired: mfaRequiredBy.length > 0,
      mfaRequiredByCompanies: mfaRequiredBy,
      emailVerification: emailVerificationState(user),
    };
  }

  /** Re-issue this session's access token with a fresh MFA time (step-up / enrolment). */
  function refreshAccessWithMfa(req: Request, res: Response, user: TokenUser): string {
    const token = generateToken(user, req.authSessionId ?? undefined, { mfaAt: Date.now() });
    res.cookie(accessCookieName(), token, {
      ...authCookieBaseOptions(),
      maxAge: ACCESS_TOKEN_TTL_SECONDS * 1000,
    });
    clearAuthenticationCache(req);
    return token;
  }

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
        ...notificationCopy(
          "notification.signInLocked.title",
          "notification.signInLocked.message",
          { minutes: Math.ceil(retryAfterSeconds / 60) }
        ),
        priority: "high",
        actionUrl: "/settings/security",
      } as Parameters<typeof storage.createNotification>[0]);
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
      const { captchaToken, ...body } = req.body as RegisterBody;
      const captcha = await verifyCaptcha(captchaToken, clientIp(req));
      if (!captcha.ok) return captchaFailure(res, captcha.reason);
      // Checked before the account lookup so the answer never depends on the email.
      if (await refuseBreachedPassword(res, body.password)) return;
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
            "Someone tried to register a new Muhasib account with this email address. You already have an account: sign in, or use 'Forgot password' if you cannot.",
            { category: "security", sensitive: true }
          ).catch(() => undefined);
        }
        return res.json(genericRegisterBody());
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
          } as Parameters<typeof storage.createUser>[0]);
        }
      } catch (err) {
        if (isUniqueViolation(err)) return res.json(genericRegisterBody());
        throw err;
      }

      // R01-07: honour the supplied company name.
      const companyName = body.companyName?.trim() || `${body.name}'s Company`;
      const company = await provisionCustomerCompany(user.id, companyName, {
        trnVatNumber: body.trn,
      });

      const mail = await sendVerificationEmail({ id: user.id, email: user.email, name: user.name });
      await auditSecurityEvent(req, "auth.register", user.id, {
        companyId: company.id,
        verificationEmail: mail.status,
      });

      // No session: identical to the existing-account answer (R17-14).
      res.json(genericRegisterBody());
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
              lock.retryAfterMs,
              "components.authErrors.loginLocked"
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
        if (user) {
          await auditSecurityEvent(req, "auth.login_failure", user.id, {
            reason: "invalid_password",
            failures: after.failures,
          });
        }
        if (after.lockedNow) await onLockout(req, email.trim().toLowerCase(), user, after);
        return res
          .status(401)
          .json({ message: "Invalid credentials", code: "INVALID_CREDENTIALS" });
      }
      loginLockout.reset(key);

      // W5-E: MFA accounts get a short-lived pending token, never a session, until the
      // second factor is verified at /auth/mfa/verify-login.
      if (await isMfaEnabled(user.id)) {
        return res.json({
          mfaRequired: true,
          mfaToken: generateMfaPendingToken(user),
          methods: ["totp", "recovery_code"],
        });
      }

      const { token, refreshToken } = await issueAuthTokens(req, res, user);
      await recordLoginSuccess(req, user, { method: "password" });
      res.json(await loginResponse(user, token, refreshToken));
    })
  );

  // W5-E: second step of an MFA sign-in. Failed codes count toward a per-user lockout.
  router.post(
    "/auth/mfa/verify-login",
    strictBody(mfaVerifyLoginSchema),
    asyncHandler(async (req: Request, res: Response) => {
      const { code, mfaToken: bodyToken } = req.body as z.output<typeof mfaVerifyLoginSchema>;
      const mfaToken = bodyToken ?? readCookie(req, mfaPendingCookie()) ?? "";
      const pending = mfaToken ? verifyMfaPendingToken(mfaToken) : null;
      if (!pending || (await isTokenBlacklisted(mfaToken))) {
        return res.status(401).json({
          message: "Your sign-in expired. Enter your password again.",
          code: "MFA_TOKEN_INVALID",
        });
      }
      const key = `mfa|${pending.userId}`;
      const lock = mfaLockout.status(key);
      if (lock.locked) {
        res.setHeader("Retry-After", String(Math.ceil(lock.retryAfterMs / 1000)));
        return res
          .status(429)
          .json(
            retryAfterBody(
              "Too many invalid codes. Please wait before trying again.",
              "ACCOUNT_LOCKED",
              lock.retryAfterMs,
              "components.authErrors.codesLocked"
            )
          );
      }
      const user = await storage.getUser(pending.userId);
      if (!user || (pending.tv ?? 0) !== (user.tokenVersion ?? 0)) {
        return res.status(401).json({
          message: "Your sign-in expired. Enter your password again.",
          code: "MFA_TOKEN_INVALID",
        });
      }
      const verdict = await verifySecondFactor(user.id, code);
      if (!verdict.ok) {
        const after = mfaLockout.recordFailure(key);
        await auditSecurityEvent(req, "auth.mfa_challenge_failed", user.id, {
          reason: verdict.code,
          failures: after.failures,
        });
        if (after.lockedNow) await onLockout(req, user.email, user, after);
        return res.status(401).json({
          message: "That code is not valid. Try the current code from your authenticator app.",
          code: verdict.code === "MFA_CODE_REUSED" ? "MFA_CODE_REUSED" : "MFA_CODE_INVALID",
        });
      }
      mfaLockout.reset(key);
      await blacklistToken(mfaToken); // the pending token is single-use
      res.clearCookie(mfaPendingCookie(), authCookieBaseOptions());
      if (verdict.method === "recovery_code") {
        await auditSecurityEvent(req, "mfa.recovery_code_used", user.id, {
          remaining: verdict.recoveryCodesRemaining,
        });
      }
      const { token, refreshToken } = await issueAuthTokens(req, res, user, {
        mfaAt: Date.now(),
      });
      await recordLoginSuccess(req, user, { method: `password+${verdict.method}` });
      res.json({
        ...(await loginResponse(user, token, refreshToken)),
        ...(verdict.method === "recovery_code"
          ? { recoveryCodesRemaining: verdict.recoveryCodesRemaining }
          : {}),
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
        return res
          .status(404)
          .json({ message: "Unknown OAuth provider", code: "UNKNOWN_OAUTH_PROVIDER" });
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

        // W5-E: social sign-in does not skip MFA. The pending token travels in a
        // short-lived httpOnly cookie; the login page asks for the code.
        if (await isMfaEnabled(user.id)) {
          clearAuthCookies(res);
          res.cookie(mfaPendingCookie(), generateMfaPendingToken(user), {
            ...authCookieBaseOptions(),
            maxAge: 5 * 60 * 1000,
          });
          return res.redirect(oauthCallbackFailureUrl().replace("oauth_error=1", "mfa=1"));
        }

        await issueAuthTokens(req, res, user);
        await recordLoginSuccess(req, user, {
          method: "oauth",
          provider: profile.provider,
          mode,
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
      return res
        .status(400)
        .json({ message: "Refresh token is required", code: "REFRESH_TOKEN_REQUIRED" });
    }

    const payload = verifyRefreshToken(refreshToken);
    if (!payload) {
      return res
        .status(401)
        .json({ message: "Invalid or expired refresh token", code: "REFRESH_TOKEN_INVALID" });
    }

    if (await isTokenBlacklisted(refreshToken)) {
      if (payload.sid) {
        const revoked = await revokeRefreshSession(payload.sid, { reuse: true });
        if (revoked) {
          await auditSecurityEvent(req, "auth.token_reuse_detected", payload.userId, {
            sessionId: payload.sid,
          });
        }
      }
      return res
        .status(401)
        .json({ message: "Refresh token has been revoked", code: "TOKEN_REVOKED" });
    }

    // Verify user still exists in DB
    const user = await storage.getUser(payload.userId);
    if (!user) {
      return res.status(401).json({ message: "User not found", code: "USER_NOT_FOUND" });
    }
    if ((payload.tv ?? 0) !== (user.tokenVersion ?? 0)) {
      return res
        .status(401)
        .json({ message: "Refresh token has been revoked", code: "TOKEN_REVOKED" });
    }

    const meta = sessionMeta(req);
    // W5-E: the session keeps its sign-in MFA time across rotations.
    const mfaClaims = { mfaAt: typeof payload.mfa === "number" ? payload.mfa : null };
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
          await auditSecurityEvent(req, "auth.token_reuse_detected", user.id, { sessionId });
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
      const newRefresh = generateRefreshToken(user, sessionId, mfaClaims);
      await createRefreshSession(
        user.id,
        newRefresh,
        new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
        meta,
        sessionId
      );
      const newToken = generateToken(user, sessionId, mfaClaims);
      setAuthCookies(res, newToken, newRefresh);
      return res.json({ token: newToken, refreshToken: newRefresh });
    }
    const newRefreshToken = generateRefreshToken(user, sessionId, mfaClaims);
    await rotateRefreshSession(
      sessionId,
      refreshToken,
      newRefreshToken,
      new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
      meta
    );
    const newToken = generateToken(user, sessionId, mfaClaims);
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
    strictBody(forgotPasswordSchema.extend({ captchaToken: z.string().max(4096).optional() })),
    asyncHandler(async (req: Request, res: Response) => {
      const { email, captchaToken } = req.body as { email: string; captchaToken?: string };
      const captcha = await verifyCaptcha(captchaToken, clientIp(req));
      if (!captcha.ok) return captchaFailure(res, captcha.reason);
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
              budget.retryAfterMs,
              "components.authErrors.resetRequestsLimited"
            )
          );
      }
      forgotPasswordBudget.recordFailure(key);

      const user = await storage.getUserByEmail(email);
      // Platform-level (not per-account), so it is no enumeration oracle: with no email
      // provider no reset email can reach anyone, and we say so neutrally.
      const emailDelivery = hasEmailProvider();
      const genericResponse = {
        message: emailDelivery
          ? "If that email is registered, a reset link has been sent."
          : "If an account exists, we'll email a reset link once email delivery is set up. Contact support@muhasib.ai for help.",
        emailDelivery: emailDelivery ? ("available" as const) : ("unavailable" as const),
      };

      if (!user) {
        return res.json(genericResponse);
      }

      const rawToken = randomBytes(32).toString("hex");
      const tokenHash = hashResetToken(rawToken);
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

      await storage.deletePasswordResetTokensForUser(user.id);
      await storage.createPasswordResetToken({ userId: user.id, tokenHash, expiresAt });
      await auditSecurityEvent(req, "auth.password_reset_requested", user.id, {});

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
              lock.retryAfterMs,
              "components.authErrors.resetAttemptsLocked"
            )
          );
      }
      passwordPolicySchema.parse(password);
      if (await refuseBreachedPassword(res, password)) return;

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
    authMiddleware,
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
              lock.retryAfterMs,
              "components.authErrors.failedAttemptsLocked"
            )
          );
      }
      const user = await storage.getUser(userId);
      if (!user) return res.status(401).json({ message: "User not found", code: "USER_NOT_FOUND" });
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
      if (await refuseBreachedPassword(res, newPassword)) return;

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
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const sessions = await listActiveSessions(req.user!.id);
      res.json({
        sessions: sessions.map((s) => ({ ...s, current: s.id === req.authSessionId })),
      });
    })
  );

  router.delete(
    "/auth/sessions/:sessionId",
    authMiddleware,
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
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      await revokeAllUserTokens(req.user!.id);
      await auditSecurityEvent(req, "auth.logout_all", req.user!.id, {});
      clearAuthCookies(res);
      res.json({ ok: true });
    })
  );

  router.get(
    "/auth/me",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const userId = req.user!.id;
      const user = await storage.getUser(userId);
      if (!user) {
        return res.status(404).json({ message: "User not found", code: "USER_NOT_FOUND" });
      }
      res.json(publicUser(user));
    })
  );

  // =====================================
  // W5-E: MFA, email verification, security overview
  // =====================================

  // Public: which abuse controls are switched on (for the register/forgot pages).
  router.get(
    "/auth/security/config",
    asyncHandler(async (_req: Request, res: Response) => {
      res.json({
        captcha: captchaStatus(),
        breachedPassword: breachedPasswordStatus(),
        mfa: { available: true, methods: ["totp", "recovery_code"] },
      });
    })
  );

  router.get(
    "/auth/security/overview",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const user = await storage.getUser(req.user!.id);
      if (!user) return res.status(401).json({ message: "User not found", code: "USER_NOT_FOUND" });
      const mfa = await mfaStatus(user.id);
      res.json({
        mfa,
        mfaRequiredByCompanies: mfa.enabled ? [] : await companiesRequiringMfa(user.id),
        emailVerification: emailVerificationState(user),
        currentSessionMfaAt: req.authMfaAt ?? null,
      });
    })
  );

  router.get(
    "/auth/mfa/status",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      res.json(await mfaStatus(req.user!.id));
    })
  );

  // Start enrolment: a pending secret + QR code. Nothing changes until confirmed.
  router.post(
    "/auth/mfa/enroll",
    authMiddleware,
    strictBody(z.object({})),
    asyncHandler(async (req: Request, res: Response) => {
      if (await isMfaEnabled(req.user!.id)) {
        return res.status(409).json({
          message: "Two-factor authentication is already on",
          code: "MFA_ALREADY_ENABLED",
        });
      }
      const start = await beginEnrollment(req.user!.id, req.user!.email);
      res.json(start);
    })
  );

  // Confirm enrolment with a code; returns the ten recovery codes exactly once.
  router.post(
    "/auth/mfa/enroll/confirm",
    authMiddleware,
    strictBody(mfaCodeBodySchema),
    asyncHandler(async (req: Request, res: Response) => {
      const { code } = req.body as z.output<typeof mfaCodeBodySchema>;
      const result = await confirmEnrollment(req.user!.id, code);
      if (!result.ok) {
        const status = result.code === "MFA_ALREADY_ENABLED" ? 409 : 400;
        return res
          .status(status)
          .json({ message: "Could not turn on two-factor authentication", code: result.code });
      }
      await auditSecurityEvent(req, "mfa.enrolled", req.user!.id, {});
      const user = (await storage.getUser(req.user!.id))!;
      const token = refreshAccessWithMfa(req, res, user);
      res.json({ enabled: true, recoveryCodes: result.recoveryCodes, token });
    })
  );

  // Turning MFA off needs the password AND a current code (or a recovery code).
  router.post(
    "/auth/mfa/disable",
    authMiddleware,
    strictBody(mfaDisableSchema),
    asyncHandler(async (req: Request, res: Response) => {
      const { password, code } = req.body as z.output<typeof mfaDisableSchema>;
      const user = await storage.getUser(req.user!.id);
      if (!user) return res.status(401).json({ message: "User not found", code: "USER_NOT_FOUND" });
      const passwordOk =
        !isPlaceholderPasswordHash(user.passwordHash) &&
        (await bcrypt.compare(password, user.passwordHash));
      if (!passwordOk) {
        return res
          .status(400)
          .json({ message: "Current password is incorrect", code: "CURRENT_PASSWORD_INVALID" });
      }
      const required = await (async () => {
        // A company that requires MFA for this user's role blocks turning it off.
        const companies = await storage.getCompaniesByUserId(user.id);
        for (const c of companies) {
          const policy = await getCompanyMfaPolicy(c.id);
          const m = await storage.getUserRole(c.id, user.id);
          if (policyCoversRole(policy, m ? normalizeCompanyRole(m.role) : null)) return c.id;
        }
        return null;
      })();
      if (required) {
        return res.status(409).json({
          message: "A company you belong to requires two-factor authentication.",
          code: "MFA_REQUIRED_BY_POLICY",
          details: { companyId: required },
        });
      }
      const verdict = await verifySecondFactor(user.id, code);
      if (!verdict.ok) {
        return res.status(400).json({ message: "That code is not valid", code: verdict.code });
      }
      await disableMfa(user.id);
      await auditSecurityEvent(req, "mfa.disabled", user.id, { method: verdict.method });
      res.json({ enabled: false });
    })
  );

  router.post(
    "/auth/mfa/recovery-codes",
    authMiddleware,
    strictBody(mfaCodeBodySchema),
    asyncHandler(async (req: Request, res: Response) => {
      const { code } = req.body as z.output<typeof mfaCodeBodySchema>;
      const verdict = await verifySecondFactor(req.user!.id, code);
      if (!verdict.ok) {
        return res.status(400).json({ message: "That code is not valid", code: verdict.code });
      }
      const recoveryCodes = await regenerateRecoveryCodes(req.user!.id);
      await auditSecurityEvent(req, "mfa.recovery_codes_regenerated", req.user!.id, {});
      res.json({ recoveryCodes });
    })
  );

  // Step-up: verify a code for a sensitive action; the access token is re-issued with a
  // fresh MFA time (same session) and also returned for Bearer clients.
  router.post(
    "/auth/mfa/step-up",
    authMiddleware,
    strictBody(mfaCodeBodySchema),
    asyncHandler(async (req: Request, res: Response) => {
      const { code } = req.body as z.output<typeof mfaCodeBodySchema>;
      const key = `mfa|${req.user!.id}`;
      const lock = mfaLockout.status(key);
      if (lock.locked) {
        res.setHeader("Retry-After", String(Math.ceil(lock.retryAfterMs / 1000)));
        return res
          .status(429)
          .json(
            retryAfterBody(
              "Too many invalid codes.",
              "ACCOUNT_LOCKED",
              lock.retryAfterMs,
              "components.authErrors.codesLocked"
            )
          );
      }
      const verdict = await verifySecondFactor(req.user!.id, code);
      if (!verdict.ok) {
        mfaLockout.recordFailure(key);
        await auditSecurityEvent(req, "auth.mfa_challenge_failed", req.user!.id, {
          reason: verdict.code,
          stepUp: true,
        });
        const status = verdict.code === "MFA_NOT_ENABLED" ? 409 : 400;
        return res.status(status).json({ message: "That code is not valid", code: verdict.code });
      }
      mfaLockout.reset(key);
      const user = (await storage.getUser(req.user!.id))!;
      const token = refreshAccessWithMfa(req, res, user);
      await auditSecurityEvent(req, "mfa.step_up", user.id, { method: verdict.method });
      res.json({ token, mfaAt: Date.now() });
    })
  );

  // Email verification: public consume, signed-in resend.
  router.post(
    "/auth/verify-email",
    strictBody(verifyEmailSchema),
    asyncHandler(async (req: Request, res: Response) => {
      const { token } = req.body as z.output<typeof verifyEmailSchema>;
      const result = await consumeVerificationToken(token);
      if (!result.ok) {
        return res.status(400).json({
          message: "This verification link is invalid or has expired. Request a new one.",
          code: result.code,
        });
      }
      await auditSecurityEvent(req, "auth.email_verified", result.userId, {});
      res.json({ verified: true });
    })
  );

  router.post(
    "/auth/verify-email/resend",
    authMiddleware,
    strictBody(z.object({})),
    asyncHandler(async (req: Request, res: Response) => {
      const user = await storage.getUser(req.user!.id);
      if (!user) return res.status(401).json({ message: "User not found", code: "USER_NOT_FOUND" });
      if (user.emailVerified) return res.json({ verified: true, sent: false });
      const key = `verify|${user.id}`;
      const budget = forgotPasswordBudget.status(key);
      if (budget.locked) {
        res.setHeader("Retry-After", String(Math.ceil(budget.retryAfterMs / 1000)));
        return res
          .status(429)
          .json(
            retryAfterBody(
              "Please wait before requesting another link.",
              "RATE_LIMITED",
              budget.retryAfterMs,
              "components.authErrors.linkRequestsLimited"
            )
          );
      }
      forgotPasswordBudget.recordFailure(key);
      const mail = await sendVerificationEmail(user);
      await auditSecurityEvent(req, "auth.email_verification_sent", user.id, {
        status: mail.status,
      });
      res.json({ verified: false, sent: mail.status === "sent", status: mail.status });
    })
  );

  // Login history: this account's sign-in and security events (newest first).
  router.get(
    "/auth/login-history",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const parsed = loginHistoryQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid query", code: "VALIDATION_ERROR" });
      }
      const rows = await storage.getUserSecurityEvents(req.user!.id, {
        limit: parsed.data.limit ?? 50,
      });
      res.json({
        events: rows
          .filter((r) => /^(auth|mfa)\./.test(r.action))
          .map((r) => ({
            id: r.id,
            action: r.action,
            at: r.createdAt,
            ipAddress: r.ipAddress,
            userAgent: r.userAgent,
          })),
      });
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
        return res
          .status(404)
          .json({ message: "Invitation not found", code: "INVITATION_NOT_FOUND" });
      }

      if (invitation.status !== "pending") {
        return res
          .status(400)
          .json({
            message: `Invitation has been ${invitation.status}`,
            code: "INVITATION_NOT_PENDING",
          });
      }

      if (new Date() > invitation.expiresAt) {
        return res
          .status(400)
          .json({ message: "Invitation has expired", code: "INVITATION_EXPIRED" });
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
        return res
          .status(404)
          .json({ message: "Invitation not found", code: "INVITATION_NOT_FOUND" });
      }

      if (invitation.status !== "pending") {
        return res
          .status(400)
          .json({
            message: `Invitation has been ${invitation.status}`,
            code: "INVITATION_NOT_PENDING",
          });
      }

      if (new Date() > invitation.expiresAt) {
        return res
          .status(400)
          .json({ message: "Invitation has expired", code: "INVITATION_EXPIRED" });
      }

      // Check if user already exists
      const existingUser = await storage.getUserByEmail(invitation.email);
      if (existingUser) {
        return res
          .status(400)
          .json({
            message: "User already exists with this email",
            code: "EMAIL_ALREADY_REGISTERED",
          });
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
      } as unknown as Parameters<typeof storage.createUser>[0]);

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
