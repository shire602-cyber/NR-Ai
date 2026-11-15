import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { randomUUID } from "crypto";
import { storage } from "../storage";
import { getEnv } from "../config/env";
import { createLogger } from "../config/logger";
import { getAccessTokenFromRequest } from "../services/auth-cookies.service";
import { isSessionActive, isTokenBlacklisted } from "../services/auth-tokens.service";

const log = createLogger("auth");

/**
 * Authenticated user attached to request.
 */
export interface AuthUser {
  id: string;
  email: string;
  isAdmin: boolean;
  userType: "admin" | "customer" | "client" | "client_portal";
  firmRole: "firm_owner" | "firm_admin" | null;
}

/**
 * Extend Express Request to include authenticated user.
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
    interface Request {
      subscription?: any; // Cached subscription for feature gating
      /** refresh_sessions.id the access token was issued under (null for legacy tokens). */
      authSessionId?: string | null;
      /** Normalised company_users.role, set by companyRolePolicy on company-scoped routes. */
      companyRole?: string;
      /** W5-E: epoch ms of the last MFA verification on this session (null = none). */
      authMfaAt?: number | null;
    }
  }
}

/** "mfa_pending" (W5-E) is only accepted by POST /auth/mfa/verify-login. */
export type TokenType = "access" | "refresh" | "mfa_pending";

/**
 * JWT token payload shape.
 */
export interface JwtPayload {
  userId: string;
  email: string;
  /** R17-04: "access" for API credentials; "refresh" is only valid at /auth/refresh. */
  type?: TokenType;
  /** refresh_sessions.id (R01-13). */
  sid?: string;
  /** users.token_version at issue time (R01-06). Missing means 0. */
  tv?: number;
  jti?: string;
  /** W5-E: epoch ms when this session last passed an MFA check. */
  mfa?: number;
  iat?: number;
  exp?: number;
}

export type AuthFailureCode =
  | "TOKEN_EXPIRED"
  | "TOKEN_INVALID"
  | "TOKEN_TYPE_INVALID"
  | "TOKEN_REVOKED"
  | "SESSION_REVOKED"
  | "USER_NOT_FOUND"
  | "AUTH_FAILED";

export interface AuthFailure {
  status: 401;
  code: AuthFailureCode;
  message: string;
}

export interface AuthSuccess {
  user: Express.User;
  sessionId: string | null;
  mfaAt?: number | null;
}

const AUTH_RESULT = Symbol.for("muhasib.authResult");

function isFailure(r: AuthSuccess | AuthFailure): r is AuthFailure {
  return "code" in r;
}

/** The credential this request presents: httpOnly cookie first, then Bearer. */
export function getRequestToken(req: Request): string | null {
  const authHeader = req.headers.authorization;
  const bearerToken = authHeader?.startsWith("Bearer ") ? authHeader.substring(7) : null;
  return getAccessTokenFromRequest(req) || bearerToken;
}

async function verifyAccessCredential(token: string): Promise<AuthSuccess | AuthFailure> {
  let decoded: JwtPayload;
  try {
    decoded = jwt.verify(token, getEnv().JWT_SECRET) as JwtPayload;
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      return { status: 401, code: "TOKEN_EXPIRED", message: "Token expired" };
    }
    return { status: 401, code: "TOKEN_INVALID", message: "Invalid token" };
  }

  // R17-04: a refresh token (or any other JWT signed with the same key) must
  // never authenticate an API call. Access tokens minted before the `type`
  // claim existed are refused as well; clients recover through /auth/refresh.
  if (decoded.type !== "access" || typeof decoded.userId !== "string") {
    return { status: 401, code: "TOKEN_TYPE_INVALID", message: "Access token required" };
  }

  // Revocation check: a token presented at logout is on the denylist.
  if (await isTokenBlacklisted(token)) {
    return { status: 401, code: "TOKEN_REVOKED", message: "Token has been revoked" };
  }

  // Always fetch user from DB — never trust JWT claims for authorization
  const user = await storage.getUser(decoded.userId);
  if (!user) {
    return { status: 401, code: "USER_NOT_FOUND", message: "User not found" };
  }

  // R01-06: password reset/change and "log out all devices" bump the version.
  if ((decoded.tv ?? 0) !== (user.tokenVersion ?? 0)) {
    return { status: 401, code: "TOKEN_REVOKED", message: "Token has been revoked" };
  }

  // R01-13: revoking a device session revokes its access token too.
  if (decoded.sid && !(await isSessionActive(decoded.sid))) {
    return { status: 401, code: "SESSION_REVOKED", message: "Session has been revoked" };
  }

  return {
    user: {
      id: user.id,
      email: user.email,
      isAdmin: user.isAdmin === true,
      userType: (user.userType as AuthUser["userType"]) || "customer",
      firmRole: (user.firmRole as AuthUser["firmRole"]) ?? null,
    },
    sessionId: decoded.sid ?? null,
    mfaAt: typeof decoded.mfa === "number" ? decoded.mfa : null,
  };
}

/**
 * Authenticate the request without writing a response. Returns null when no
 * credential is presented. The result is memoised on the request so the
 * central company policy and the route's own authMiddleware share a single
 * verification.
 */
export async function authenticateRequest(req: Request): Promise<AuthSuccess | AuthFailure | null> {
  const cached = (req as any)[AUTH_RESULT] as AuthSuccess | AuthFailure | null | undefined;
  if (cached !== undefined) return cached;
  const token = getRequestToken(req);
  let result: AuthSuccess | AuthFailure | null = null;
  if (token) {
    try {
      result = await verifyAccessCredential(token);
    } catch (error) {
      log.error({ error }, "Auth middleware error");
      result = { status: 401, code: "AUTH_FAILED", message: "Authentication failed" };
    }
  }
  (req as any)[AUTH_RESULT] = result;
  return result;
}

/** The authenticated user, or null (no credential, or a rejected one). */
export async function optionalAuthUser(req: Request): Promise<Express.User | null> {
  const result = await authenticateRequest(req);
  return result && !isFailure(result) ? result.user : null;
}

/** Forget a memoised authentication result (after issuing new tokens). */
export function clearAuthenticationCache(req: Request): void {
  delete (req as any)[AUTH_RESULT];
}

/**
 * Extract and verify JWT token from httpOnly cookie or Authorization header.
 * Fetches the actual user from DB to prevent JWT claim tampering.
 */
export async function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const result = await authenticateRequest(req);
  if (!result) {
    res.status(401).json({ message: "Authentication required", code: "AUTH_REQUIRED" });
    return;
  }
  if (isFailure(result)) {
    res.status(result.status).json({ message: result.message, code: result.code });
    return;
  }
  // Use server-side data (prevents privilege escalation via JWT tampering)
  req.user = result.user;
  req.authSessionId = result.sessionId;
  req.authMfaAt = result.mfaAt ?? null;
  next();
}

/**
 * Require admin role. Must be used AFTER authMiddleware.
 */
export function adminMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ message: "Authentication required" });
    return;
  }
  if (!req.user.isAdmin) {
    res.status(403).json({ message: "Admin access required" });
    return;
  }
  next();
}

/**
 * Require client userType. Admins can also access for support.
 */
export function requireClient(req: Request, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ message: "Authentication required" });
    return;
  }
  if (req.user.userType === "client" || req.user.isAdmin) {
    next();
  } else {
    res.status(403).json({ message: "Access restricted to managed clients" });
  }
}

/**
 * Require customer userType. Admins can also access for support.
 */
export function requireCustomer(req: Request, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ message: "Authentication required" });
    return;
  }
  if (req.user.userType === "customer" || req.user.isAdmin) {
    next();
  } else {
    res.status(403).json({ message: "Access restricted to SaaS customers" });
  }
}

/**
 * Factory: require one of the given user types. Admins always allowed.
 */
export function requireUserType(...allowedTypes: string[]) {
  return function (req: Request, res: Response, next: NextFunction): void {
    if (!req.user) {
      res.status(401).json({ message: "Authentication required" });
      return;
    }
    if (req.user.isAdmin || allowedTypes.includes(req.user.userType)) {
      next();
    } else {
      res.status(403).json({
        message: `Access restricted to: ${allowedTypes.join(", ")}`,
      });
    }
  };
}

/**
 * Require that the authenticated user has access to the company referenced
 * by the request. Reads companyId from req.params, then req.body, then
 * req.query unless a source is provided.
 */
export function requireCompanyAccess(paramSource?: "params" | "body" | "query") {
  return async function (req: Request, res: Response, next: NextFunction): Promise<void> {
    if (!req.user) {
      res.status(401).json({ message: "Authentication required" });
      return;
    }

    const candidate =
      paramSource === "params"
        ? req.params?.companyId
        : paramSource === "body"
          ? req.body?.companyId
          : paramSource === "query"
            ? (req.query?.companyId as string | undefined)
            : (req.params?.companyId ??
              req.body?.companyId ??
              (req.query?.companyId as string | undefined));

    if (!candidate || typeof candidate !== "string") {
      res.status(400).json({ message: "Company ID required" });
      return;
    }

    const allowed = await storage.hasCompanyAccess(req.user.id, candidate);
    if (!allowed) {
      log.warn(
        { userId: req.user.id, companyId: candidate, path: req.path },
        "requireCompanyAccess denied"
      );
      res.status(403).json({ message: "Access denied to this company" });
      return;
    }

    next();
  };
}

export const ACCESS_TOKEN_TTL = "24h";
export const REFRESH_TOKEN_TTL = "7d";
export const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

interface TokenSubject {
  id: string;
  email: string;
  isAdmin?: boolean;
  userType?: string;
  firmRole?: string | null;
  tokenVersion?: number | null;
}

/**
 * Generate an access JWT (type "access") bound to a session and token version.
 */
export function generateToken(
  user: TokenSubject,
  sessionId?: string,
  claims: { mfaAt?: number | null } = {}
): string {
  const env = getEnv();
  return jwt.sign(
    {
      userId: user.id,
      email: user.email,
      isAdmin: user.isAdmin === true,
      userType: user.userType || "customer",
      firmRole: user.firmRole ?? null,
      type: "access",
      tv: user.tokenVersion ?? 0,
      ...(sessionId ? { sid: sessionId } : {}),
      ...(typeof claims.mfaAt === "number" ? { mfa: claims.mfaAt } : {}),
      jti: randomUUID(),
    },
    env.JWT_SECRET,
    { expiresIn: ACCESS_TOKEN_TTL }
  );
}

/**
 * Generate a refresh token (longer-lived). Only /auth/refresh accepts it.
 */
export function generateRefreshToken(
  user: TokenSubject,
  sessionId?: string,
  claims: { mfaAt?: number | null } = {}
): string {
  const env = getEnv();
  return jwt.sign(
    {
      userId: user.id,
      email: user.email,
      type: "refresh",
      tv: user.tokenVersion ?? 0,
      ...(sessionId ? { sid: sessionId } : {}),
      ...(typeof claims.mfaAt === "number" ? { mfa: claims.mfaAt } : {}),
      jti: randomUUID(),
    },
    env.JWT_SECRET,
    { expiresIn: REFRESH_TOKEN_TTL }
  );
}

/**
 * Decode a token without verifying its signature. Used by /auth/logout
 * so we can read the jti + exp of a token we're about to revoke even if
 * its signature is past expiry (no point adding an already-expired token
 * to the denylist, but the logout should still succeed).
 */
export function decodeTokenUnsafe(token: string): JwtPayload | null {
  try {
    const decoded = jwt.decode(token) as JwtPayload | null;
    return decoded;
  } catch {
    return null;
  }
}

/** Verify any token signed with JWT_SECRET (signature + expiry only). */
export function verifySignedToken(token: string): JwtPayload | null {
  try {
    return jwt.verify(token, getEnv().JWT_SECRET) as JwtPayload;
  } catch {
    return null;
  }
}

/**
 * Verify a refresh token and return the payload.
 */
export function verifyRefreshToken(token: string): JwtPayload | null {
  const decoded = verifySignedToken(token);
  if (!decoded || decoded.type !== "refresh") return null;
  return decoded;
}

/** W5-E: lifetime of the short-lived token between password and MFA code. */
export const MFA_PENDING_TTL = "5m";

/**
 * MFA-pending token: proves the password step only. Its type is "mfa_pending", so
 * authMiddleware refuses it (TOKEN_TYPE_INVALID) and only /auth/mfa/verify-login accepts it.
 */
export function generateMfaPendingToken(user: TokenSubject): string {
  return jwt.sign(
    {
      userId: user.id,
      email: user.email,
      type: "mfa_pending",
      tv: user.tokenVersion ?? 0,
      jti: randomUUID(),
    },
    getEnv().JWT_SECRET,
    { expiresIn: MFA_PENDING_TTL }
  );
}

export function verifyMfaPendingToken(token: string): JwtPayload | null {
  const decoded = verifySignedToken(token);
  if (!decoded || decoded.type !== "mfa_pending" || typeof decoded.userId !== "string") {
    return null;
  }
  return decoded;
}
