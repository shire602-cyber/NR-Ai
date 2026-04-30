import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { storage } from '../storage';
import { getEnv } from '../config/env';
import { createLogger } from '../config/logger';
import { isTokenBlacklisted } from '../services/auth-tokens.service';

const log = createLogger('auth');

/**
 * Authenticated user attached to request.
 */
export interface AuthUser {
  id: string;
  email: string;
  isAdmin: boolean;
  userType: 'admin' | 'customer' | 'client' | 'client_portal';
  firmRole: 'firm_owner' | 'firm_admin' | null;
}

/**
 * Augment Express.User so Passport's Request.user picks up our fields.
 */
declare global {
  namespace Express {
    interface User {
      id: string;
      email: string;
      isAdmin: boolean;
      userType: string;
      firmRole: string | null;
    }
  }
}

/**
 * JWT token payload shape.
 */
interface JwtPayload {
  userId: string;
  email: string;
  iat?: number;
  exp?: number;
}

/**
 * Extract and verify JWT token from Authorization header.
 * Fetches the actual user from DB to prevent JWT claim tampering.
 */
export async function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ message: 'Authentication required' });
    return;
  }

  const token = authHeader.substring(7);
  try {
    const decoded = jwt.verify(token, getEnv().JWT_SECRET) as JwtPayload;

    // Reject tokens that have been logged out (blacklisted)
    if (await isTokenBlacklisted(token)) {
      res.status(401).json({ message: 'Token has been revoked' });
      return;
    }

    // Always fetch user from DB — never trust JWT claims for authorization
    const user = await storage.getUser(decoded.userId);
    if (!user) {
      res.status(401).json({ message: 'User not found' });
      return;
    }

    // Use server-side data (prevents privilege escalation via JWT tampering)
    req.user = {
      id: user.id,
      email: user.email,
      isAdmin: user.isAdmin === true,
      userType: (user.userType as AuthUser['userType']) || 'customer',
      firmRole: (user.firmRole as AuthUser['firmRole']) ?? null,
    };
    next();
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      res.status(401).json({ message: 'Token expired' });
      return;
    }
    if (error instanceof jwt.JsonWebTokenError) {
      res.status(401).json({ message: 'Invalid token' });
      return;
    }
    log.error({ error }, 'Auth middleware error');
    res.status(401).json({ message: 'Authentication failed' });
  }
}

/**
 * Require admin role. Must be used AFTER authMiddleware.
 */
export function adminMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  if (!req.user) {
    res.status(401).json({ message: 'Authentication required' });
    return;
  }
  if (!req.user.isAdmin) {
    res.status(403).json({ message: 'Admin access required' });
    return;
  }
  next();
}

/**
 * Require client userType. Admins can also access for support.
 */
export function requireClient(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  if (!req.user) {
    res.status(401).json({ message: 'Authentication required' });
    return;
  }
  if (req.user.userType === 'client' || req.user.isAdmin) {
    next();
  } else {
    res.status(403).json({ message: 'Access restricted to managed clients' });
  }
}

/**
 * Require customer userType. Admins can also access for support.
 */
export function requireCustomer(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  if (!req.user) {
    res.status(401).json({ message: 'Authentication required' });
    return;
  }
  if (req.user.userType === 'customer' || req.user.isAdmin) {
    next();
  } else {
    res.status(403).json({ message: 'Access restricted to SaaS customers' });
  }
}

/**
 * Factory: require one of the given user types. Admins always allowed.
 */
export function requireUserType(...allowedTypes: string[]) {
  return function (req: Request, res: Response, next: NextFunction): void {
    if (!req.user) {
      res.status(401).json({ message: 'Authentication required' });
      return;
    }
    if (req.user.isAdmin || allowedTypes.includes(req.user.userType)) {
      next();
    } else {
      res.status(403).json({
        message: `Access restricted to: ${allowedTypes.join(', ')}`,
      });
    }
  };
}

/**
 * Require that the authenticated user has access to the company referenced
 * by the request. Reads companyId from req.params, then req.body, then
 * req.query (in that order). Admins are NOT bypassed — admin-only routes
 * should use requireAdmin instead.
 *
 * Returns 400 if no companyId can be resolved, 403 if the user is not a
 * member of that company. Designed to be mounted after authMiddleware on
 * any handler that previously did the check ad-hoc, so that uncited routes
 * (and future routes) cannot leak cross-tenant data by omission.
 */
export function requireCompanyAccess(
  paramSource?: 'params' | 'body' | 'query',
) {
  return async function (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    if (!req.user) {
      res.status(401).json({ message: 'Authentication required' });
      return;
    }

    const candidate =
      paramSource === 'params'
        ? req.params?.companyId
        : paramSource === 'body'
          ? req.body?.companyId
          : paramSource === 'query'
            ? (req.query?.companyId as string | undefined)
            : (req.params?.companyId ??
              req.body?.companyId ??
              (req.query?.companyId as string | undefined));

    if (!candidate || typeof candidate !== 'string') {
      res.status(400).json({ message: 'Company ID required' });
      return;
    }

    const allowed = await storage.hasCompanyAccess(req.user.id, candidate);
    if (!allowed) {
      log.warn(
        { userId: req.user.id, companyId: candidate, path: req.path },
        'requireCompanyAccess denied',
      );
      res.status(403).json({ message: 'Access denied to this company' });
      return;
    }

    next();
  };
}

/**
 * Generate a JWT token for a user.
 */
export function generateToken(user: { id: string; email: string; isAdmin?: boolean; userType?: string; firmRole?: string | null }): string {
  const env = getEnv();
  return jwt.sign(
    {
      userId: user.id,
      email: user.email,
      isAdmin: user.isAdmin === true,
      userType: user.userType || 'customer',
      firmRole: user.firmRole ?? null,
    },
    env.JWT_SECRET,
    { expiresIn: '24h' }
  );
}

/**
 * Generate a refresh token (longer-lived).
 */
export function generateRefreshToken(user: { id: string; email: string }): string {
  const env = getEnv();
  return jwt.sign(
    { userId: user.id, email: user.email, type: 'refresh' },
    env.JWT_SECRET,
    { expiresIn: '7d' }
  );
}

/**
 * Verify a refresh token and return the payload.
 */
export function verifyRefreshToken(token: string): JwtPayload | null {
  try {
    const decoded = jwt.verify(token, getEnv().JWT_SECRET) as JwtPayload & { type?: string };
    if (decoded.type !== 'refresh') return null;
    return decoded;
  } catch {
    return null;
  }
}
