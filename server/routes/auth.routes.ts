import type { Request, Response } from 'express';
import { Router } from 'express';
import type { Express } from 'express';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { randomBytes, createHash } from 'crypto';
import { z } from 'zod';

import { storage } from '../storage';
import { getEnv } from '../config/env';
import {
  authMiddleware,
  generateToken,
  generateRefreshToken,
  verifyRefreshToken,
  decodeTokenUnsafe,
} from '../middleware/auth';
import {
  clearAuthCookies,
  getAccessTokenFromRequest,
  getRefreshTokenFromRequest,
  setAuthCookies,
} from '../services/auth-cookies.service';
import { blacklistToken, isTokenBlacklisted } from '../services/auth-tokens.service';
import { hasEmailProvider, sendPasswordResetEmail } from '../services/email.service';
import { asyncHandler } from '../middleware/errorHandler';
import { validate } from '../middleware/validate';
import { insertUserSchema } from '../../shared/schema';
import { forgotPasswordSchema, resetPasswordSchema } from '../../shared/validators';
import { createDefaultAccountsForCompany } from '../defaultChartOfAccounts';
import { createLogger } from '../config/logger';
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
} from '../services/oauth.service';

const log = createLogger('auth');

function publicUser(user: any) {
  const { passwordHash: _passwordHash, password: _password, ...safeUser } = user;
  return safeUser;
}

async function createOAuthCustomer(profile: OAuthIdentityProfile) {
  const passwordHash = await bcrypt.hash(randomBytes(32).toString('hex'), 10);
  const user = await storage.createUser({
    name: profile.name,
    email: profile.email,
    userType: 'customer',
    isAdmin: false,
    passwordHash,
    emailVerified: true,
    avatarUrl: profile.picture,
  } as any);

  const timestamp = Date.now().toString(36);
  const company = await storage.createCompany({
    name: `${profile.name}'s Company (${timestamp})`,
    baseCurrency: 'AED',
    locale: 'en',
    companyType: 'customer',
  });

  await storage.createCompanyUser({
    companyId: company.id,
    userId: user.id,
    role: 'owner',
  });

  await seedChartOfAccounts(company.id);

  const now = new Date();
  const periodEnd = new Date(now);
  periodEnd.setFullYear(periodEnd.getFullYear() + 100);
  await storage.createSubscription({
    companyId: company.id,
    planId: 'free',
    planName: 'Free',
    status: 'active',
    currentPeriodStart: now,
    currentPeriodEnd: periodEnd,
    maxUsers: 1,
    maxInvoices: 20,
    maxReceipts: 20,
    aiCreditsRemaining: 10,
  } as any);

  return user;
}

async function resolveOAuthUser(profile: OAuthIdentityProfile): Promise<{ user: any; mode: 'existing_identity' | 'linked_existing' | 'created_customer' }> {
  const identity = await getAuthIdentity(profile);
  if (identity) {
    const user = await storage.getUser(identity.userId);
    if (!user) throw new Error('OAuth identity is linked to a missing user');
    await markOAuthLogin(user.id, profile);
    return { user: await storage.getUser(user.id) ?? user, mode: 'existing_identity' };
  }

  const existingUser = await getUserByNormalizedOAuthEmail(profile.email);
  if (existingUser) {
    await linkAuthIdentity(existingUser.id, profile);
    await markOAuthLogin(existingUser.id, profile);
    return { user: await storage.getUser(existingUser.id) ?? existingUser, mode: 'linked_existing' };
  }

  const createdUser = await createOAuthCustomer(profile);
  await linkAuthIdentity(createdUser.id, profile);
  await markOAuthLogin(createdUser.id, profile);
  return { user: await storage.getUser(createdUser.id) ?? createdUser, mode: 'created_customer' };
}

function callbackUrlFromRequest(req: Request, provider: 'google' | 'microsoft'): URL {
  const url = new URL(oauthRedirectUri(req, provider));
  for (const [key, value] of Object.entries(req.query)) {
    if (Array.isArray(value)) {
      for (const entry of value) {
        if (typeof entry === 'string') url.searchParams.append(key, entry);
      }
    } else if (typeof value === 'string') {
      url.searchParams.set(key, value);
    }
  }
  return url;
}

async function auditOAuthLogin(req: Request, userId: string, profile: OAuthIdentityProfile, mode: string): Promise<void> {
  try {
    await storage.createAuditLog({
      userId,
      action: 'login',
      resourceType: 'user',
      resourceId: userId,
      details: JSON.stringify({
        method: 'oauth',
        provider: profile.provider,
        mode,
        email: profile.email,
      }),
      ipAddress: req.ip ?? null,
      userAgent: req.get('user-agent') ?? null,
    });
  } catch (err) {
    log.warn({ err, userId, provider: profile.provider }, 'Failed to write OAuth audit log');
  }
}

function issueAuthTokens(res: Response, user: { id: string; email: string; isAdmin?: boolean; userType?: string }) {
  const token = generateToken(user);
  const refreshToken = generateRefreshToken(user);
  setAuthCookies(res, token, refreshToken);
  return { token, refreshToken };
}

function loginRateLimitKey(req: Request): string {
  const rawEmail = (req.body as { email?: unknown } | undefined)?.email;
  const email = typeof rawEmail === 'string' ? rawEmail.trim().toLowerCase() : 'unknown';
  return `${req.ip || 'unknown'}:${email || 'unknown'}`;
}

function retryAfterSeconds(req: Request, fallbackSeconds: number): number {
  const resetTime = (req as any).rateLimit?.resetTime;
  if (resetTime instanceof Date) {
    return Math.max(1, Math.ceil((resetTime.getTime() - Date.now()) / 1000));
  }
  return fallbackSeconds;
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
    log.info({ companyId }, 'Company already has accounts, skipping seed');
    return { created: 0, alreadyExisted: true };
  }

  const defaultAccounts = createDefaultAccountsForCompany(companyId);

  try {
    const createdAccounts = await storage.createBulkAccounts(defaultAccounts as any);
    log.info({ companyId, count: createdAccounts.length }, 'Seeded chart of accounts');
    return { created: createdAccounts.length, alreadyExisted: false };
  } catch (error: any) {
    if (error.message?.includes('PARTIAL_INSERT')) {
      log.error({ companyId, message: error.message }, 'Partial COA insert detected');
      throw new Error(
        'PARTIAL_CHART: Chart of Accounts partially created due to race condition. Please contact support.'
      );
    }
    throw error;
  }
}

// Stronger password validation for a financial system:
// 8+ characters, at least one uppercase, one lowercase, one digit
const passwordSchema = z.string()
  .min(8, 'Password must be at least 8 characters')
  .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
  .regex(/[a-z]/, 'Password must contain at least one lowercase letter')
  .regex(/[0-9]/, 'Password must contain at least one digit');

// =============================================
// Route registration
// =============================================

export function registerAuthRoutes(app: Express): void {
  const router = Router();

  // =====================================
  // Auth Routes
  // =====================================

  // Customer self-signup (SaaS customers only - clients must use invitation)
  router.post(
    '/auth/register',
    asyncHandler(async (req: Request, res: Response) => {
      const validated = insertUserSchema.parse(req.body);

      // Strengthen password validation (8+ chars)
      passwordSchema.parse(validated.password);

      // Check if user exists
      const existingUser = await storage.getUserByEmail(validated.email);
      if (existingUser) {
        return res.status(400).json({ message: 'Email already registered' });
      }

      // Hash password
      const passwordHash = await bcrypt.hash(validated.password, 10);

      // SECURITY: Force userType to 'customer' - never trust client-supplied userType
      // Self-signup users can only be customers. Clients/admins must use invitation flow.
      // NOTE: Do NOT pass raw password to storage - only pass the hash
      const user = await storage.createUser({
        name: validated.name,
        email: validated.email,
        userType: 'customer', // FORCED: Self-signup users are always customers
        isAdmin: false, // FORCED: Self-signup users cannot be admins
        passwordHash,
      } as any);

      // Auto-create a default company for this user (marked as 'customer' type)
      // Add timestamp to ensure uniqueness if user re-registers
      const timestamp = Date.now().toString(36);
      const companyName = `${validated.name}'s Company`;
      const uniqueCompanyName = `${companyName} (${timestamp})`;
      const company = await storage.createCompany({
        name: uniqueCompanyName,
        baseCurrency: 'AED',
        locale: 'en',
        companyType: 'customer', // Self-signup companies are customer type (not managed by NR)
      });

      // Associate user with company as owner
      await storage.createCompanyUser({
        companyId: company.id,
        userId: user.id,
        role: 'owner',
      });

      // Seed Chart of Accounts for new company
      await seedChartOfAccounts(company.id);

      // Create free tier subscription for new customer
      const now = new Date();
      const periodEnd = new Date(now);
      periodEnd.setFullYear(periodEnd.getFullYear() + 100); // Free tier never expires

      await storage.createSubscription({
        companyId: company.id,
        planId: 'free',
        planName: 'Free',
        status: 'active',
        currentPeriodStart: now,
        currentPeriodEnd: periodEnd,
        maxUsers: 1,
        maxInvoices: 20,
        maxReceipts: 20,
        aiCreditsRemaining: 10,
      });

      const { token, refreshToken } = issueAuthTokens(res, user);

      res.json({
        token,
        refreshToken,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          isAdmin: false,
          userType: 'customer',
        },
        company: {
          id: company.id,
          name: company.name,
        },
      });
    })
  );

  // Login
  // Dummy bcrypt hash generated once at startup. Used when the email is
  // unknown so we still spend CPU on a comparison — this removes the
  // timing signal that distinguishes "no such user" from "wrong password"
  // and prevents email enumeration via response-time measurement.
  const DUMMY_HASH = bcrypt.hashSync('account_enumeration_placeholder', 10);
  const loginLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 8,
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: true,
    keyGenerator: loginRateLimitKey,
    handler: (req, res) => {
      const retryAfter = retryAfterSeconds(req, 60);
      res.setHeader('Retry-After', String(retryAfter));
      res.status(429).json({
        message: 'Too many login attempts for this email. Please wait before trying again.',
        details: { retryAfterSeconds: retryAfter },
      });
    },
  });

  router.post(
    '/auth/login',
    loginLimiter,
    asyncHandler(async (req: Request, res: Response) => {
      const { email, password } = req.body;

      const user = await storage.getUserByEmail(email);

      // Always compare against *some* hash so the timing is constant.
      const passwordToCheck = typeof password === 'string' ? password : '';
      const isValid = user
        ? await bcrypt.compare(passwordToCheck, user.passwordHash)
        : (await bcrypt.compare(passwordToCheck, DUMMY_HASH), false);

      if (!user || !isValid) {
        return res.status(401).json({ message: 'Invalid credentials' });
      }

      // Ensure isAdmin is a proper boolean
      const isAdminBoolean =
        user.isAdmin === true ||
        (user.isAdmin as any) === 'true' ||
        (user.isAdmin as any) === 1;

      const { token, refreshToken } = issueAuthTokens(res, user);

      res.json({
        token,
        refreshToken,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          isAdmin: isAdminBoolean,
          userType: user.userType || 'customer', // Include userType in response
        },
      });
    })
  );

  router.get(
    '/auth/oauth/providers',
    asyncHandler(async (_req: Request, res: Response) => {
      res.json({ providers: getOAuthProviderInfo() });
    }),
  );

  router.get(
    '/auth/oauth/:provider/start',
    asyncHandler(async (req: Request, res: Response) => {
      const provider = req.params.provider;
      if (!isOAuthProviderId(provider)) {
        return res.status(404).json({ message: 'Unknown OAuth provider' });
      }

      try {
        const redirectTo = await createOAuthAuthorizationUrl(provider, req, req.query.next);
        log.info({ provider, ip: req.ip }, 'OAuth login started');
        return res.redirect(redirectTo.toString());
      } catch (err) {
        log.warn({ err, provider, ip: req.ip }, 'OAuth login start failed');
        return res.redirect(oauthCallbackFailureUrl());
      }
    }),
  );

  router.get(
    '/auth/oauth/:provider/callback',
    asyncHandler(async (req: Request, res: Response) => {
      const provider = req.params.provider;
      if (!isOAuthProviderId(provider)) {
        return res.redirect(oauthCallbackFailureUrl());
      }

      try {
        const state = await consumeOAuthState(provider, req.query.state);
        const profile = await exchangeOAuthCallback(provider, callbackUrlFromRequest(req, provider), state);
        const { user, mode } = await resolveOAuthUser(profile);

        issueAuthTokens(res, user);
        await auditOAuthLogin(req, user.id, profile, mode);
        log.info({ provider, userId: user.id, mode }, 'OAuth login completed');

        return res.redirect(oauthCallbackSuccessUrl(state.nextPath));
      } catch (err) {
        log.warn({ err, provider, ip: req.ip }, 'OAuth login callback failed');
        clearAuthCookies(res);
        return res.redirect(oauthCallbackFailureUrl());
      }
    }),
  );

  // Refresh token endpoint
  const handleRefreshToken = asyncHandler(async (req: Request, res: Response) => {
    const refreshToken = req.body?.refreshToken || getRefreshTokenFromRequest(req);

    if (!refreshToken) {
      return res.status(400).json({ message: 'Refresh token is required' });
    }

    const payload = verifyRefreshToken(refreshToken);
    if (!payload) {
      return res.status(401).json({ message: 'Invalid or expired refresh token' });
    }

    // Revocation check — refresh tokens are long-lived (7d), so a
    // denylist hit here is the main defence against a stolen refresh
    // token being replayed after logout.
    if (await isTokenBlacklisted(refreshToken)) {
      return res.status(401).json({ message: 'Refresh token has been revoked' });
    }

    // Verify user still exists in DB
    const user = await storage.getUser(payload.userId);
    if (!user) {
      return res.status(401).json({ message: 'User not found' });
    }

    // Refresh-token rotation: revoke the one we just consumed so it
    // cannot be replayed, and issue a fresh pair.
    await blacklistToken(refreshToken);
    const newToken = generateToken(user);
    const newRefreshToken = generateRefreshToken(user);
    setAuthCookies(res, newToken, newRefreshToken);

    res.json({
      token: newToken,
      refreshToken: newRefreshToken,
    });
  });

  router.post('/auth/refresh-token', handleRefreshToken);
  router.post('/auth/refresh', handleRefreshToken);

  // =====================================
  // PASSWORD RESET
  // =====================================

  const hashResetToken = (token: string): string =>
    createHash('sha256').update(token).digest('hex');

  // Request a password reset link. Always returns 200 so callers cannot
  // discover whether a specific email is registered.
  router.post(
    '/auth/forgot-password',
    validate({ body: forgotPasswordSchema }),
    asyncHandler(async (req: Request, res: Response) => {
      const { email } = req.body as { email: string };
      const user = await storage.getUserByEmail(email);
      const genericResponse = {
        message: 'If that email is registered, a reset link has been sent.',
      };

      if (!user) {
        return res.json(genericResponse);
      }

      const rawToken = randomBytes(32).toString('hex');
      const tokenHash = hashResetToken(rawToken);
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

      await storage.deletePasswordResetTokensForUser(user.id);
      await storage.createPasswordResetToken({ userId: user.id, tokenHash, expiresAt });

      const env = getEnv();
      // Canonical public URL: FRONTEND_URL first, AUTH_PUBLIC_URL as fallback
      // (same precedence as OAuth redirects in oauth.service.ts).
      const appUrl = (env.FRONTEND_URL || env.AUTH_PUBLIC_URL || '').replace(/\/+$/, '');
      const resetUrl = `${appUrl}/reset-password?token=${rawToken}`;

      log.info({ userId: user.id, email }, 'Password reset requested');

      if (env.NODE_ENV !== 'production') {
        return res.json({ ...genericResponse, devResetUrl: resetUrl });
      }

      if (!appUrl) {
        log.error('FRONTEND_URL/AUTH_PUBLIC_URL not set; cannot build password reset link');
      } else if (!hasEmailProvider()) {
        log.error('No email provider configured (RESEND_API_KEY or SMTP_*); password reset email not sent');
      } else {
        // Failures stay server-side: the response is identical either way so
        // callers can't probe which emails exist or whether delivery worked.
        try {
          await sendPasswordResetEmail(user.email, resetUrl);
        } catch (err) {
          log.error({ err, userId: user.id }, 'Failed to send password reset email');
        }
      }

      return res.json(genericResponse);
    }),
  );

  router.post(
    '/auth/reset-password',
    validate({ body: resetPasswordSchema }),
    asyncHandler(async (req: Request, res: Response) => {
      const { token, password } = req.body as { token: string; password: string };
      passwordSchema.parse(password);

      const tokenHash = hashResetToken(token);
      const record = await storage.findValidPasswordResetToken(tokenHash);

      if (!record) {
        return res.status(400).json({
          message: 'This reset link is invalid or has expired. Please request a new one.',
        });
      }

      const passwordHash = await bcrypt.hash(password, 10);
      await storage.updateUserPassword(record.userId, passwordHash);
      await storage.markPasswordResetTokenUsed(record.id);
      await storage.deletePasswordResetTokensForUser(record.userId);

      log.info({ userId: record.userId }, 'Password reset completed');

      res.json({ message: 'Your password has been reset. You can now sign in with your new password.' });
    }),
  );

  router.get(
    '/auth/me',
    authMiddleware as any,
    asyncHandler(async (req: Request, res: Response) => {
      const userId = (req as any).user.id;
      const user = await storage.getUser(userId);
      if (!user) {
        return res.status(404).json({ message: 'User not found' });
      }
      res.json(publicUser(user));
    }),
  );

  // Logout endpoint — revokes both the access token (from Authorization
  // header) and the refresh token (from body) by adding their jti to the
  // denylist table. Expired tokens are skipped; malformed tokens are a
  // no-op (we still return 200 so the client proceeds with its local
  // cleanup). Subsequent requests using either revoked token are
  // rejected in authMiddleware.
  router.post(
    '/auth/logout',
    asyncHandler(async (req: Request, res: Response) => {
      const revokeIfValid = async (raw: string | undefined, reason: string) => {
        if (!raw) return;
        const decoded = decodeTokenUnsafe(raw);
        if (!decoded?.exp) return;
        if (decoded.exp * 1000 < Date.now()) return; // already expired
        await blacklistToken(raw);
      };

      const authHeader = req.headers.authorization;
      const accessToken =
        getAccessTokenFromRequest(req) ||
        (authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : undefined);
      const refreshToken: string | undefined = req.body?.refreshToken || getRefreshTokenFromRequest(req) || undefined;

      await revokeIfValid(accessToken, 'logout');
      await revokeIfValid(refreshToken, 'logout');
      clearAuthCookies(res);

      res.json({ ok: true });
    }),
  );

  // =====================================
  // PUBLIC - INVITATION ACCEPTANCE
  // =====================================

  // Verify invitation token (public endpoint)
  router.get(
    '/invitations/verify/:token',
    asyncHandler(async (req: Request, res: Response) => {
      const { token } = req.params;
      const invitation = await storage.getInvitationByToken(token);

      if (!invitation) {
        return res.status(404).json({ message: 'Invitation not found' });
      }

      if (invitation.status !== 'pending') {
        return res.status(400).json({ message: `Invitation has been ${invitation.status}` });
      }

      if (new Date() > invitation.expiresAt) {
        return res.status(400).json({ message: 'Invitation has expired' });
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
    '/invitations/accept/:token',
    asyncHandler(async (req: Request, res: Response) => {
      const { token } = req.params;
      const { name, password } = req.body;

      const nameSchema = z.string().min(1, 'Name is required').max(100, 'Name too long');
      nameSchema.parse(name);

      // Strengthen password validation (8+ chars)
      passwordSchema.parse(password);

      const invitation = await storage.getInvitationByToken(token);

      if (!invitation) {
        return res.status(404).json({ message: 'Invitation not found' });
      }

      if (invitation.status !== 'pending') {
        return res.status(400).json({ message: `Invitation has been ${invitation.status}` });
      }

      if (new Date() > invitation.expiresAt) {
        return res.status(400).json({ message: 'Invitation has expired' });
      }

      // Check if user already exists
      const existingUser = await storage.getUserByEmail(invitation.email);
      if (existingUser) {
        return res.status(400).json({ message: 'User already exists with this email' });
      }

      // Create user with appropriate userType from invitation.
      // Only pass passwordHash — never the raw password.
      const passwordHash = await bcrypt.hash(password, 10);
      const user = await storage.createUser({
        email: invitation.email,
        name,
        isAdmin: invitation.role === 'staff' || invitation.userType === 'admin',
        userType: invitation.userType || 'client',
        passwordHash,
      } as any);

      // If company associated, add user to company and set company type
      if (invitation.companyId) {
        await storage.createCompanyUser({
          companyId: invitation.companyId,
          userId: user.id,
          role: 'owner', // Client users are owners of their company view
        });

        // Set company type based on user type (client companies are managed by NR)
        if (invitation.userType === 'client') {
          await storage.updateCompany(invitation.companyId, {
            companyType: 'client',
          });
        }
      }

      // Mark invitation as accepted
      await storage.updateInvitation(invitation.id, {
        status: 'accepted',
        acceptedAt: new Date(),
      });

      // Log activity
      await storage.createActivityLog({
        userId: user.id,
        companyId: invitation.companyId || null,
        action: 'create',
        entityType: 'user',
        entityId: user.id,
        description: `User registered via invitation: ${user.email}`,
      });

      const { token: jwtToken, refreshToken } = issueAuthTokens(res, user);

      res.json({ user: publicUser(user), token: jwtToken, refreshToken });
    })
  );

  // Mount all auth routes under /api
  app.use('/api', router);
}
