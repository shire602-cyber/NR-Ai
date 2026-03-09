import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { storage } from '../storage';
import { getEnv } from '../config/env';
import { createLogger } from '../config/logger';

const log = createLogger('auth');

/**
 * Authenticated user attached to request.
 */
export interface AuthUser {
  id: string;
  email: string;
  isAdmin: boolean;
  userType: 'admin' | 'customer' | 'client';
}

/**
 * Extend Express Request to include authenticated user.
 */
declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
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
 * Generate a JWT token for a user.
 */
export function generateToken(user: { id: string; email: string }): string {
  const env = getEnv();
  return jwt.sign(
    { userId: user.id, email: user.email },
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
