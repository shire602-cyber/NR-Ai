import helmet from "helmet";
import cors from "cors";
import type { Express, Request, Response, NextFunction } from "express";
import { getEnv, isProduction } from "../config/env";
import { createLogger } from "../config/logger";
import { buildLimiter, limiterProfiles } from "./rateLimit";
import { cspNonce, buildCspDirectives, cspReportHandler } from "./csp";

/**
 * Paths under /api/auth/ that accept credentials or tokens an attacker could
 * brute-force. Only these consume the strict auth rate-limit budget.
 * `path` is relative to the /api/auth mount (e.g. '/login').
 */
const CREDENTIAL_AUTH_PATHS = ["/login", "/register", "/forgot-password", "/reset-password"];

export function isCredentialAuthPath(path: string): boolean {
  return CREDENTIAL_AUTH_PATHS.some((p) => path === p || path.startsWith(`${p}/`));
}

const log = createLogger("security");

/**
 * Resolve the CORS allowlist from env: FRONTEND_URL (first-party default)
 * plus CORS_ORIGIN as comma-separated extra origins. Invalid entries are
 * dropped with a warning rather than silently allowed. Origins are
 * normalized to scheme://host[:port] (no path, no trailing slash) because
 * that is exactly what browsers send in the Origin header.
 */
export function resolveAllowedOrigins(
  env: {
    FRONTEND_URL?: string;
    CORS_ORIGIN?: string;
  },
  production: boolean
): string[] {
  const allowed: string[] = [];

  const add = (raw: string, source: string) => {
    const trimmed = raw.trim();
    if (!trimmed) return;
    try {
      const url = new URL(trimmed);
      if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("non-http scheme");
      if (!allowed.includes(url.origin)) allowed.push(url.origin);
    } catch {
      log.warn({ origin: trimmed, source }, "Ignoring invalid CORS origin");
    }
  };

  if (env.FRONTEND_URL) add(env.FRONTEND_URL, "FRONTEND_URL");
  for (const entry of (env.CORS_ORIGIN ?? "").split(",")) add(entry, "CORS_ORIGIN");

  if (!production) {
    for (const port of [5173, 5000, 3000]) {
      allowed.push(`http://localhost:${port}`, `http://127.0.0.1:${port}`);
    }
  }

  return allowed;
}

/**
 * Apply all security middleware to the Express app.
 * Must be called BEFORE route registration.
 */
export function applySecurityMiddleware(app: Express): void {
  const env = getEnv();

  // ─── Per-request CSP nonce (must run before helmet) ───────
  app.use(cspNonce);

  // CSP violation reports come in as POST with JSON content type — accept
  // both standard `application/csp-report` and `application/json` payloads.
  app.use("/api/csp-report", (req, res, next) => {
    const ctype = (req.headers["content-type"] || "").toLowerCase();
    if (ctype.includes("csp-report")) {
      // helmet's CSP report-uri sends application/csp-report; parse manually
      let raw = "";
      req.setEncoding("utf8");
      req.on("data", (c) => (raw += c));
      req.on("end", () => {
        try {
          req.body = raw ? JSON.parse(raw) : {};
        } catch {
          req.body = {};
        }
        next();
      });
      return;
    }
    next();
  });
  app.post("/api/csp-report", cspReportHandler);

  // ─── Helmet: Security Headers ─────────────────────────────
  // Sets X-Content-Type-Options, X-Frame-Options, X-XSS-Protection,
  // Content-Security-Policy, Strict-Transport-Security, etc.
  app.use(
    helmet({
      contentSecurityPolicy: buildCspDirectives(),
      crossOriginEmbedderPolicy: false, // Allow embedding (PDF viewers, etc.)
    })
  );

  // ─── CORS: Cross-Origin Resource Sharing ──────────────────
  // FRONTEND_URL is the first-party default; CORS_ORIGIN adds extra origins
  // (comma-separated). Dev additionally allows localhost.
  const allowedOrigins = resolveAllowedOrigins(env, isProduction());

  app.use(
    cors({
      origin: (origin, callback) => {
        // Allow requests with no origin (mobile apps, curl, server-to-server)
        if (!origin) return callback(null, true);

        if (allowedOrigins.includes(origin)) {
          return callback(null, true);
        }

        log.warn({ origin }, "Blocked CORS request from unauthorized origin");
        callback(new Error("Not allowed by CORS"));
      },
      credentials: true,
      methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      allowedHeaders: [
        "Content-Type",
        "Authorization",
        "X-Requested-With",
        "X-CSRF-Token",
        "X-XSRF-Token",
      ],
      exposedHeaders: ["X-Total-Count", "X-Page", "X-Per-Page", "Retry-After", "RateLimit-Reset"],
      maxAge: 86400, // Cache preflight for 24 hours
    })
  );

  // ─── Rate Limiting (sliding window, configurable per route) ──
  // Each limiter has its own in-memory sliding-window store, sized via
  // env vars (RL_*). Composite key (ip+userId) prevents NAT collisions.
  // Order matters: more specific paths must be registered before /api/.
  app.use("/api/auth/oauth/", buildLimiter(limiterProfiles.authOAuth));
  // Brute-force guard for credential-bearing attempts ONLY. Session reads
  // (/me, /refresh, /oauth/providers, /logout) fire on every page load, so
  // counting them here used to exhaust the 5/min budget before the user even
  // submitted the login form — locking the whole app behind 429s. Those
  // routes fall through to the general /api limiter below instead.
  // Successful attempts refund their hit, so legitimate sign-ins on a shared
  // office IP never throttle each other; only failures accumulate.
  app.use(
    "/api/auth/",
    buildLimiter({
      ...limiterProfiles.auth,
      skipSuccessfulRequests: true,
      skipIf: (req) => !isCredentialAuthPath(req.path),
    })
  );
  app.use("/api/ai/", buildLimiter(limiterProfiles.ai));
  app.use("/api/ocr/", buildLimiter(limiterProfiles.ai));
  app.use("/api/firm/bulk/ocr", buildLimiter(limiterProfiles.ai));
  // Two-tier general limiter: an active dashboard fires a dozen GETs per
  // page, so reads get a generous dedicated budget while mutations keep the
  // stricter cap. A single tier throttled normal navigation, 429'd
  // /api/auth/me, and the client then treated the user as logged out.
  app.use(
    "/api/",
    buildLimiter({
      ...limiterProfiles.read,
      skipIf: (req) => !["GET", "HEAD", "OPTIONS"].includes(req.method),
    })
  );
  app.use(
    "/api/",
    buildLimiter({
      ...limiterProfiles.api,
      skipMethods: ["GET", "HEAD", "OPTIONS"],
    })
  );

  // ─── Request Size Limits ──────────────────────────────────
  // Hard ceiling: image-upload routes allow up to 10MB; the per-route
  // body parser in index.ts enforces tighter per-route limits.
  app.use((req: Request, res: Response, next: NextFunction) => {
    const contentLength = parseInt(req.headers["content-length"] || "0", 10);
    if (contentLength > 10_485_760) {
      // 10MB
      return res.status(413).json({ message: "Request too large" });
    }
    next();
  });

  // ─── HTTPS Enforcement (production only) ──────────────────
  if (isProduction()) {
    app.use((req: Request, res: Response, next: NextFunction) => {
      const proto = req.headers["x-forwarded-proto"];
      // Only redirect if header is present AND not https, skip health checks
      if (proto && proto !== "https" && req.path !== "/health") {
        return res.redirect(301, `https://${req.hostname}${req.url}`);
      }
      next();
    });
  }

  // ─── Security Logging ─────────────────────────────────────
  app.use((req: Request, _res: Response, next: NextFunction) => {
    // Log suspicious requests
    const suspiciousPatterns = [
      /\.\.\//, // Path traversal
      /<script/i, // XSS attempt
      /union\s+select/i, // SQL injection
      /javascript:/i, // XSS in URLs
    ];

    const fullUrl = req.originalUrl || req.url;
    for (const pattern of suspiciousPatterns) {
      if (pattern.test(fullUrl) || pattern.test(JSON.stringify(req.body || ""))) {
        log.warn({ ip: req.ip, method: req.method, url: fullUrl }, "Suspicious request detected");
        break;
      }
    }
    next();
  });

  log.info("Security middleware applied");
}
