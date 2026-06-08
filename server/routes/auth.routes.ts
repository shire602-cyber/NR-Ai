import bcrypt from 'bcryptjs';
import { createHash,randomBytes } from 'crypto';
import type { Express,Request,Response } from 'express';
import { Router } from 'express';
import { z } from 'zod';

import { eq } from 'drizzle-orm';
import { insertUserSchema,users } from '../../shared/schema';
import {
forgotPasswordSchema,
resetPasswordSchema,
loginSchema as sharedLoginSchema,
trnSchema,
} from '../../shared/validators';
import { getEnv } from '../config/env';
import { createLogger } from '../config/logger';
import { db } from '../db';
import { createDefaultAccountsForCompany } from '../defaultChartOfAccounts';
import {
authMiddleware,
generateToken,
} from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';
import { validate } from '../middleware/validate';
import {
clearAuthCookies,
getAccessTokenFromRequest,
getRefreshTokenFromRequest,
sessionMetaFromRequest,
setAuthCookies,
} from '../services/auth-cookies.service';
import {
blacklistToken,
consumeEmailVerificationToken,
createEmailVerificationToken,
createRefreshSession,
revokeRefreshSession,
rotateRefreshSession,
} from '../services/auth-tokens.service';
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
import { storage } from '../storage';

const log = createLogger('auth');

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
    log.info({ companyId, count: createdAccounts.length }, 'Created chart of accounts');
    return { created: createdAccounts.length, alreadyExisted: false };
  } catch (error: any) {
    if (error.message?.includes('PARTIAL_INSERT')) {
      log.error({ companyId, err: error.message }, 'Partial insert detected during COA seed');
      throw new Error(
        'PARTIAL_CHART: Chart of Accounts partially created due to race condition. Please contact support.'
      );
    }
    throw error;
  }
}

async function issueAuthCookies(user: { id: string; email: string; isAdmin?: boolean; userType?: string; firmRole?: string | null }, req: Request, res: Response): Promise<void> {
  const accessToken = generateToken(user);
  const refresh = await createRefreshSession(user.id, sessionMetaFromRequest(req));
  setAuthCookies(res, accessToken, refresh.token, refresh.expiresAt);
}

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

async function recordReferralSignupFromRegistration(input: {
  code: string | undefined;
  refereeUserId: string;
  refereeEmail: string;
}): Promise<void> {
  const code = input.code?.trim();
  if (!code) return;

  const referralCode = await storage.getReferralCodeByCode(code);
  if (!referralCode || !referralCode.isActive) return;
  if (referralCode.expiresAt && new Date(referralCode.expiresAt) < new Date()) return;
  if (referralCode.userId === input.refereeUserId) return;

  const refereeEmail = input.refereeEmail.trim().toLowerCase();
  const existing = await storage.getReferralByCodeAndEmail(referralCode.id, refereeEmail);
  if (existing) {
    if (!existing.refereeId || existing.status === 'pending') {
      await storage.updateReferral(existing.id, {
        refereeId: input.refereeUserId,
        status: 'signed_up',
      });
    }
    return;
  }

  await storage.createReferral({
    referralCodeId: referralCode.id,
    referrerId: referralCode.userId,
    refereeId: input.refereeUserId,
    refereeEmail,
    status: 'signed_up',
    signupSource: 'registration',
    referrerRewardStatus: 'pending',
    refereeRewardStatus: 'pending',
    referrerRewardAmount: referralCode.referrerRewardValue,
    refereeRewardAmount: referralCode.refereeRewardValue,
  });

  await storage.updateReferralCode(referralCode.id, {
    totalReferrals: (referralCode.totalReferrals || 0) + 1,
  });

  await storage.createNotification({
    userId: referralCode.userId,
    type: 'referral',
    title: 'New referral signup',
    message: 'A new user signed up using your referral code.',
    priority: 'normal',
    actionUrl: '/referrals',
  });
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

// Stronger password validation: 8+ characters
const passwordSchema = z.string().min(8, 'Password must be at least 8 characters');

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

      // Optional TRN at signup. We accept it here (instead of forcing the user
      // through onboarding first) so the auto-created company is seeded with a
      // valid value. Format is enforced via the shared schema.
      const trnFromBody = (req.body as any)?.trn as string | undefined;
      let trn: string | undefined;
      if (typeof trnFromBody === 'string' && trnFromBody.trim() !== '') {
        const trnParse = trnSchema.safeParse(trnFromBody.trim());
        if (!trnParse.success) {
          return res.status(400).json({
            message: trnParse.error.issues[0]?.message || 'Invalid TRN',
            field: 'trn',
          });
        }
        trn = trnParse.data;
      }
      const referralCodeFromBody = typeof (req.body as any)?.referralCode === 'string'
        ? (req.body as any).referralCode
        : typeof (req.body as any)?.referral === 'string'
          ? (req.body as any).referral
          : undefined;

      // Check if user exists. Return a generic message either way to prevent
      // email enumeration via differing 200/400 responses.
      const existingUser = await storage.getUserByEmail(validated.email);
      if (existingUser) {
        return res.status(400).json({
          message:
            'Unable to create account. Please try again or use a different email.',
        });
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
        trnVatNumber: trn,
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
      });

      try {
        await recordReferralSignupFromRegistration({
          code: referralCodeFromBody,
          refereeUserId: user.id,
          refereeEmail: user.email,
        });
      } catch (err) {
        log.error({ err, userId: user.id }, 'Failed to record referral signup');
      }

      // Issue email verification token. The token is logged for now —
      // when a transactional-email provider is wired up this should be
      // delivered via email instead.
      try {
        const verificationToken = await createEmailVerificationToken(user.id);
        log.info(
          { userId: user.id, email: user.email },
          `Email verification pending — verify URL: /verify-email/${verificationToken}`,
        );
      } catch (err) {
        log.error({ err, userId: user.id }, 'Failed to issue email verification token');
      }

      await issueAuthCookies(user, req, res);

      res.json({
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          isAdmin: false,
          userType: 'customer',
          firmRole: user.firmRole ?? null,
          emailVerified: false,
        },
        company: {
          id: company.id,
          name: company.name,
        },
      });
    })
  );

  // Login — body validated up-front via shared schema before reaching handler.
  router.post(
    '/auth/login',
    validate({ body: sharedLoginSchema }),
    asyncHandler(async (req: Request, res: Response) => {
      const { email, password } = req.body as { email: string; password: string };

      const user = await storage.getUserByEmail(email);
      if (!user) {
        return res.status(401).json({ message: 'Invalid credentials' });
      }

      const isValid = await bcrypt.compare(password, user.passwordHash);
      if (!isValid) {
        return res.status(401).json({ message: 'Invalid credentials' });
      }

      // Ensure isAdmin is a proper boolean
      const isAdminBoolean =
        user.isAdmin === true ||
        (user.isAdmin as any) === 'true' ||
        (user.isAdmin as any) === 1;

      await issueAuthCookies(user, req, res);

      res.json({
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          isAdmin: isAdminBoolean,
          userType: user.userType || 'customer', // Include userType in response
          firmRole: user.firmRole ?? null,
          emailVerified: user.emailVerified === true,
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

        await issueAuthCookies(user, req, res);
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

  // Refresh token handler (shared by both /auth/refresh-token and /auth/refresh)
  const handleRefreshToken = asyncHandler(async (req: Request, res: Response) => {
    const refreshToken = getRefreshTokenFromRequest(req);
    if (!refreshToken) {
      return res.status(401).json({ message: 'Invalid or expired refresh token' });
    }

    const rotated = await rotateRefreshSession(refreshToken, sessionMetaFromRequest(req));
    if (!rotated.ok) {
      clearAuthCookies(res);
      const message =
        rotated.reason === 'reused'
          ? 'Refresh token reuse detected. Please sign in again.'
          : 'Invalid or expired refresh token';
      return res.status(401).json({ message });
    }

    const user = await storage.getUser(rotated.userId);
    if (!user) {
      clearAuthCookies(res);
      return res.status(401).json({ message: 'User not found' });
    }

    const newToken = generateToken(user);
    setAuthCookies(res, newToken, rotated.token, rotated.expiresAt);

    res.json({ ok: true });
  });

  // Refresh token endpoint (canonical path)
  router.post('/auth/refresh-token', handleRefreshToken);

  // Alias for frontend compatibility: POST /api/auth/refresh
  router.post('/auth/refresh', handleRefreshToken);

  // =====================================
  // PASSWORD RESET
  // =====================================

  // Hash a raw token before storing or looking up — DB only ever sees the digest.
  const hashResetToken = (token: string): string =>
    createHash('sha256').update(token).digest('hex');

  // Request a password reset link. Always returns 200 to prevent email enumeration.
  router.post(
    '/auth/forgot-password',
    validate({ body: forgotPasswordSchema }),
    asyncHandler(async (req: Request, res: Response) => {
      const { email } = req.body as { email: string };
      const user = await storage.getUserByEmail(email);

      // Generic response — never reveal whether the email exists
      const genericResponse = {
        message: 'If that email is registered, a reset link has been sent.',
      };

      if (!user) {
        return res.json(genericResponse);
      }

      // Issue a one-time token; raw token only exists in memory long enough
      // to email the user. The DB stores only the SHA-256 digest.
      const rawToken = randomBytes(32).toString('hex');
      const tokenHash = hashResetToken(rawToken);
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

      // Invalidate any prior outstanding tokens so only the latest one works.
      await storage.deletePasswordResetTokensForUser(user.id);
      await storage.createPasswordResetToken({
        userId: user.id,
        tokenHash,
        expiresAt,
      });

      const env = getEnv();
      const appUrl = (env as any).APP_URL || (env as any).PUBLIC_URL || '';
      const resetUrl = `${appUrl}/reset-password?token=${rawToken}`;

      log.info({ userId: user.id, email }, 'Password reset requested');

      // TODO(email): wire to outbound email service when configured.
      // In non-production, return the URL so QA can verify the flow.
      const isProd = (env as any).NODE_ENV === 'production';
      if (!isProd) {
        return res.json({
          ...genericResponse,
          devResetUrl: resetUrl,
        });
      }

      return res.json(genericResponse);
    }),
  );

  // Consume a reset token and set a new password.
  router.post(
    '/auth/reset-password',
    validate({ body: resetPasswordSchema }),
    asyncHandler(async (req: Request, res: Response) => {
      const { token, password } = req.body as { token: string; password: string };

      const tokenHash = hashResetToken(token);
      const record = await storage.findValidPasswordResetToken(tokenHash);

      if (!record) {
        return res.status(400).json({ message: 'This reset link is invalid or has expired. Please request a new one.' });
      }

      const newHash = await bcrypt.hash(password, 10);
      await storage.updateUserPassword(record.userId, newHash);
      await storage.markPasswordResetTokenUsed(record.id);
      // Revoke any other outstanding reset tokens — one successful reset
      // invalidates the whole batch.
      await storage.deletePasswordResetTokensForUser(record.userId);

      log.info({ userId: record.userId }, 'Password reset completed');

      res.json({ message: 'Your password has been reset. You can now sign in with your new password.' });
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

      // Create user with appropriate userType from invitation
      const passwordHash = await bcrypt.hash(password, 10);
      const user = await storage.createUser({
        email: invitation.email,
        name,
        password,
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

      await issueAuthCookies(user, req, res);
      res.json({ user: publicUser(user) });
    })
  );

  // Current user profile
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
    })
  );

  // Logout — server-side JWT invalidation via the token_blacklist table.
  router.post(
    '/auth/logout',
    authMiddleware as any,
    asyncHandler(async (req: Request, res: Response) => {
      const authHeader = req.headers.authorization;
      const accessToken =
        getAccessTokenFromRequest(req) ||
        (authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : null);
      const refreshToken = getRefreshTokenFromRequest(req);

      if (accessToken) {
        try {
          await blacklistToken(accessToken);
        } catch (err) {
          log.error({ err }, 'Failed to blacklist token on logout');
        }
      }

      await revokeRefreshSession(refreshToken).catch((err) => {
        log.error({ err }, 'Failed to revoke refresh session on logout');
      });
      clearAuthCookies(res);

      res.json({ message: 'Logged out successfully' });
    })
  );

  // ─── Email verification ────────────────────────────────────────────

  router.post(
    '/auth/verify-email/:token',
    asyncHandler(async (req: Request, res: Response) => {
      const { token } = req.params;
      const userId = await consumeEmailVerificationToken(token);
      if (!userId) {
        return res
          .status(400)
          .json({ message: 'Verification link is invalid or has expired' });
      }
      await db.update(users).set({ emailVerified: true }).where(eq(users.id, userId));
      res.json({ message: 'Email verified successfully' });
    })
  );

  // Resend verification email — authenticated; rate-limited at the network layer.
  router.post(
    '/auth/resend-verification',
    authMiddleware as any,
    asyncHandler(async (req: Request, res: Response) => {
      const userId = (req as any).user.id;
      const user = await storage.getUser(userId);
      if (!user) {
        return res.status(404).json({ message: 'User not found' });
      }
      if (user.emailVerified) {
        return res.json({ message: 'Email is already verified' });
      }
      try {
        const verificationToken = await createEmailVerificationToken(user.id);
        log.info(
          { userId: user.id, email: user.email },
          `Verification re-issued — verify URL: /verify-email/${verificationToken}`,
        );
      } catch (err) {
        log.error({ err, userId: user.id }, 'Failed to re-issue verification token');
      }
      res.json({ message: 'Verification email sent' });
    })
  );

  // Mount all auth routes under /api
  app.use('/api', router);
}
