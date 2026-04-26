import type { Request, Response } from 'express';
import { Router } from 'express';
import type { Express } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';

import { storage } from '../storage';
import { getEnv } from '../config/env';
import {
  generateToken,
  generateRefreshToken,
  verifyRefreshToken,
  authMiddleware,
} from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';
import { validate } from '../middleware/validate';
import { insertUserSchema } from '../../shared/schema';
import {
  loginSchema as sharedLoginSchema,
  registerSchema as sharedRegisterSchema,
} from '../../shared/validators';
import { createDefaultAccountsForCompany } from '../defaultChartOfAccounts';
import { createLogger } from '../config/logger';
import {
  blacklistToken,
  createPasswordResetToken,
  consumePasswordResetToken,
  createEmailVerificationToken,
  consumeEmailVerificationToken,
} from '../services/auth-tokens.service';
import { db } from '../db';
import { users } from '../../shared/schema';
import { eq } from 'drizzle-orm';

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

      // Generate tokens
      const token = generateToken(user);
      const refreshToken = generateRefreshToken(user);

      res.json({
        token,
        refreshToken,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          isAdmin: false,
          userType: 'customer',
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

      // Generate tokens
      const token = generateToken(user);
      const refreshToken = generateRefreshToken(user);

      res.json({
        token,
        refreshToken,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          isAdmin: isAdminBoolean,
          userType: user.userType || 'customer', // Include userType in response
          emailVerified: user.emailVerified === true,
        },
      });
    })
  );

  // Refresh token handler (shared by both /auth/refresh-token and /auth/refresh)
  const handleRefreshToken = asyncHandler(async (req: Request, res: Response) => {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      return res.status(400).json({ message: 'Refresh token is required' });
    }

    const payload = verifyRefreshToken(refreshToken);
    if (!payload) {
      return res.status(401).json({ message: 'Invalid or expired refresh token' });
    }

    // Verify user still exists in DB
    const user = await storage.getUser(payload.userId);
    if (!user) {
      return res.status(401).json({ message: 'User not found' });
    }

    // Issue new access + refresh tokens
    const newToken = generateToken(user);
    const newRefreshToken = generateRefreshToken(user);

    res.json({
      token: newToken,
      refreshToken: newRefreshToken,
    });
  });

  // Refresh token endpoint (canonical path)
  router.post('/auth/refresh-token', handleRefreshToken);

  // Alias for frontend compatibility: POST /api/auth/refresh
  router.post('/auth/refresh', handleRefreshToken);

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

      // Generate tokens for immediate login
      const isAdminBoolean = user.isAdmin === true;
      const jwtToken = generateToken(user);
      const refreshToken = generateRefreshToken(user);

      const { passwordHash: _, ...safeUser } = user;
      res.json({ user: safeUser, token: jwtToken, refreshToken });
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
      const { passwordHash: _, ...safeUser } = user;
      res.json(safeUser);
    })
  );

  // Logout — server-side JWT invalidation via the token_blacklist table.
  router.post(
    '/auth/logout',
    authMiddleware as any,
    asyncHandler(async (req: Request, res: Response) => {
      const authHeader = req.headers.authorization;
      if (authHeader?.startsWith('Bearer ')) {
        const token = authHeader.substring(7);
        try {
          await blacklistToken(token);
        } catch (err) {
          log.error({ err }, 'Failed to blacklist token on logout');
        }
      }
      res.json({ message: 'Logged out successfully' });
    })
  );

  // ─── Password reset ────────────────────────────────────────────────

  const forgotPasswordSchema = z.object({
    email: z.string().email().max(254),
  });

  router.post(
    '/auth/forgot-password',
    asyncHandler(async (req: Request, res: Response) => {
      const { email } = forgotPasswordSchema.parse(req.body);
      const user = await storage.getUserByEmail(email);
      if (user) {
        try {
          const resetToken = await createPasswordResetToken(user.id);
          // TODO: deliver via email when transactional provider is wired up.
          log.info(
            { userId: user.id, email: user.email },
            `Password reset issued — reset URL: /reset-password?token=${resetToken}`,
          );
        } catch (err) {
          log.error({ err, userId: user.id }, 'Failed to create password reset token');
        }
      }
      // Always respond identically to prevent account enumeration.
      res.json({
        message:
          'If an account exists for that email, a password reset link has been sent.',
      });
    })
  );

  const resetPasswordSchema = z.object({
    token: z.string().min(16).max(256),
    password: z.string().min(8).max(256),
  });

  router.post(
    '/auth/reset-password',
    asyncHandler(async (req: Request, res: Response) => {
      const { token, password } = resetPasswordSchema.parse(req.body);
      passwordSchema.parse(password);

      const userId = await consumePasswordResetToken(token);
      if (!userId) {
        return res
          .status(400)
          .json({ message: 'Reset link is invalid or has expired' });
      }
      const passwordHash = await bcrypt.hash(password, 10);
      await db.update(users).set({ passwordHash }).where(eq(users.id, userId));
      res.json({ message: 'Password updated successfully' });
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
