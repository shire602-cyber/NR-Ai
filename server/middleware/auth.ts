import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { randomUUID } from "crypto";
import { storage } from "../storage";
import { getEnv } from "../config/env";
import { createLogger } from "../config/logger";
import { getAccessTokenFromRequest } from "../services/auth-cookies.service";
import { isTokenBlacklisted } from "../services/auth-tokens.service";
import { isSessionActive } from "../services/sessions";
import { isUserDeactivated, isPortalUserAllowedPath } from "../services/portal-invitations";
import { EMPLOYEE_ROLE_REFUSAL, wasEmployeeRefused } from "./employee-denial";

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
      /** Session row id (`sid` claim) of the access token that authenticated this request. */
      sessionId?: string | null;
      /** Set to "2fa_enrol" while the token may only be used to enrol in 2FA. */
      tokenScope?: string | null;
      /** Set by the v1 API key middleware: the key whose creator this request runs as. */
      apiKeyId?: string | null;
    }
  }
}

/**
 * JWT token payload shape.
 */
export interface JwtPayload {
  userId: string;
  email: string;
  jti?: string;
  /** "access" | "refresh" | "2fa_challenge". Tokens minted before D5 have no type and are access tokens. */
  type?: string;
  /** Session row id (refresh_sessions.id). */
  sid?: string;
  /** "2fa_enrol": confined to /api/auth/* until the user enables TOTP. */
  scope?: string;
  iat?: number;
  exp?: number;
}

/**
 * Internal marker set by the v1 API key middleware after it has authenticated a
 * key. A request object is server-side only, so a client cannot set it; it
 * carries the key creator's user id and the key id.
 */
export const API_V1_DISPATCH = Symbol.for("muhasib.apiV1Dispatch");
export interface ApiV1DispatchMarker {
  userId: string;
  apiKeyId: string;
}

/** Paths a `2fa_enrol`-scoped token may reach. */
export function isEnrolScopeAllowedPath(urlPath: string): boolean {
  const pathOnly = urlPath.split("?")[0].split("#")[0];
  if (pathOnly.includes("..") || /%2e/i.test(pathOnly)) return false;
  return pathOnly.startsWith("/api/auth/");
}

/**
 * Verify a JWT as an ACCESS token: valid signature, and not one of the other
 * token kinds that share the secret (refresh, 2FA challenge). Pre-D5 access
 * tokens have no `type` claim and stay valid until they expire.
 */
export function verifyAccessJwt(token: string): JwtPayload {
  const decoded = jwt.verify(token, getEnv().JWT_SECRET) as JwtPayload;
  if (decoded.type !== undefined && decoded.type !== "access") {
    throw new jwt.JsonWebTokenError("Not an access token");
  }
  return decoded;
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
  const dispatch = (req as any)[API_V1_DISPATCH] as ApiV1DispatchMarker | undefined;
  if (dispatch) {
    await authenticateApiV1Dispatch(req, res, next, dispatch);
    return;
  }

  const authHeader = req.headers.authorization;
  const bearerToken = authHeader?.startsWith("Bearer ") ? authHeader.substring(7) : null;
  const cookieToken = getAccessTokenFromRequest(req);
  const token = cookieToken || bearerToken;

  if (!token) {
    res.status(401).json({ message: "Authentication required" });
    return;
  }

  try {
    // A refresh or 2FA-challenge token shares the signing secret; it must never
    // authenticate an API request (F2).
    const decoded = verifyAccessJwt(token);

    // Revocation check — a token that was present at logout (or during a
    // password change, or admin-revoked) is refused here even though its
    // signature is still valid. Tokens issued before we added the jti
    // claim have no `jti` and skip the check; they'll naturally expire.
    if (await isTokenBlacklisted(token)) {
      res.status(401).json({ message: "Token has been revoked" });
      return;
    }

    // A revoked or expired session kills its access tokens too.
    if (decoded.sid && !(await isSessionActive(decoded.sid))) {
      res.status(401).json({ message: "Session has been revoked" });
      return;
    }

    // Always fetch user from DB — never trust JWT claims for authorization
    const user = await storage.getUser(decoded.userId);
    if (!user) {
      res.status(401).json({ message: "User not found" });
      return;
    }

    // A deactivated account loses access immediately, even with a valid token.
    if (isUserDeactivated(user)) {
      res.status(401).json({ message: "Account deactivated" });
      return;
    }

    // Client-portal users are confined to the portal API (see portal-invitations).
    if (user.userType === "client_portal" && !isPortalUserAllowedPath(req.originalUrl || req.url)) {
      res.status(403).json({ message: "Client portal accounts can only use the client portal" });
      return;
    }

    // A company requires 2FA from this user and they have none yet: the token
    // can only reach /api/auth/* (enrol) until they turn it on.
    if (decoded.scope === "2fa_enrol" && !isEnrolScopeAllowedPath(req.originalUrl || req.url)) {
      res.status(403).json({
        message: "Two-factor authentication must be set up before you can continue",
        code: "TWO_FACTOR_ENROLMENT_REQUIRED",
      });
      return;
    }

    // Use server-side data (prevents privilege escalation via JWT tampering)
    req.user = {
      id: user.id,
      email: user.email,
      isAdmin: user.isAdmin === true,
      userType: (user.userType as AuthUser["userType"]) || "customer",
      firmRole: (user.firmRole as AuthUser["firmRole"]) ?? null,
    };
    req.sessionId = decoded.sid ?? null;
    req.tokenScope = decoded.scope ?? null;
    next();
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      res.status(401).json({ message: "Token expired" });
      return;
    }
    if (error instanceof jwt.JsonWebTokenError) {
      res.status(401).json({ message: "Invalid token" });
      return;
    }
    log.error({ error }, "Auth middleware error");
    res.status(401).json({ message: "Authentication failed" });
  }
}

/**
 * v1 API: the key middleware already authenticated the key; here the creator
 * is loaded fresh and checked like any other request. No token is involved.
 */
async function authenticateApiV1Dispatch(
  req: Request,
  res: Response,
  next: NextFunction,
  marker: ApiV1DispatchMarker
): Promise<void> {
  try {
    const user = await storage.getUser(marker.userId);
    if (!user || isUserDeactivated(user)) {
      res.status(401).json({ message: "API key owner is no longer active" });
      return;
    }
    req.user = {
      id: user.id,
      email: user.email,
      isAdmin: user.isAdmin === true,
      userType: (user.userType as AuthUser["userType"]) || "customer",
      firmRole: (user.firmRole as AuthUser["firmRole"]) ?? null,
    };
    req.sessionId = null;
    req.tokenScope = null;
    req.apiKeyId = marker.apiKeyId;
    next();
  } catch (error) {
    log.error({ error }, "API v1 dispatch auth error");
    res.status(401).json({ message: "Authentication failed" });
  }
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
      // An employee-role member is limited to their own HR records: say so, with the code the client keys on.
      res.status(403).json(wasEmployeeRefused() ? EMPLOYEE_ROLE_REFUSAL : { message: "Access denied to this company" });
      return;
    }

    next();
  };
}

/**
 * Generate a JWT token for a user.
 */
export function generateToken(
  user: {
    id: string;
    email: string;
    isAdmin?: boolean;
    userType?: string;
    firmRole?: string | null;
  },
  opts: { sid?: string; scope?: string } = {}
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
      jti: randomUUID(),
      ...(opts.sid ? { sid: opts.sid } : {}),
      ...(opts.scope ? { scope: opts.scope } : {}),
    },
    env.JWT_SECRET,
    { expiresIn: "24h" }
  );
}

/**
 * Generate a refresh token (longer-lived).
 */
export function generateRefreshToken(
  user: { id: string; email: string },
  opts: { sid?: string } = {}
): string {
  const env = getEnv();
  return jwt.sign(
    {
      userId: user.id,
      email: user.email,
      type: "refresh",
      jti: randomUUID(),
      ...(opts.sid ? { sid: opts.sid } : {}),
    },
    env.JWT_SECRET,
    { expiresIn: "7d" }
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

/**
 * Signature-verified decode that tolerates an expired token. Logout uses it to
 * find the session of a token whose claims must be trusted but whose lifetime
 * no longer matters.
 */
export function verifyTokenIgnoringExpiry(token: string): JwtPayload | null {
  try {
    return jwt.verify(token, getEnv().JWT_SECRET, { ignoreExpiration: true }) as JwtPayload;
  } catch {
    return null;
  }
}

/**
 * Verify a refresh token and return the payload.
 */
export function verifyRefreshToken(token: string): JwtPayload | null {
  try {
    const decoded = jwt.verify(token, getEnv().JWT_SECRET) as JwtPayload & { type?: string };
    if (decoded.type !== "refresh") return null;
    return decoded;
  } catch {
    return null;
  }
}
