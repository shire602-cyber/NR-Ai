import { sizeErrorBody } from "../http/upload-errors";
import { EMAIL_INTAKE_LIMIT, EMAIL_INTAKE_PATH, LARGE_JSON_LIMIT } from "../http/body-limits";
import { portalInviteLogPath } from "../http/portal-invite-privacy";
import helmet from "helmet";
import cors from "cors";
import type { Express, Request, Response, NextFunction } from "express";
import { getEnv, isProduction } from "../config/env";
import { createLogger } from "../config/logger";
import { buildLimiter, clientIp, limiterProfiles } from "./rateLimit";
import {
  cspNonce,
  buildCspDirectives,
  buildCspReportOnlyDirectives,
  cspReportHandler,
} from "./csp";

/**
 * Paths under /api/auth/ that accept credentials or tokens an attacker could
 * brute-force. Only these consume the strict auth rate-limit budget.
 * `path` is relative to the /api/auth mount (e.g. '/login').
 */
const CREDENTIAL_AUTH_PATHS = [
  "/login",
  "/register",
  "/forgot-password",
  "/reset-password",
  "/change-password",
  // W5-E: MFA codes and verification tokens are brute-forceable too.
  "/mfa/verify-login",
  "/mfa/step-up",
  "/verify-email",
];

export function isCredentialAuthPath(path: string): boolean {
  const normalized = path.toLowerCase();
  return CREDENTIAL_AUTH_PATHS.some((p) => normalized === p || normalized.startsWith(`${p}/`));
}

/**
 * The OAuth limiter guards the actions that leave the app (start a provider
 * flow, handle the callback). The providers list is a read-only lookup that
 * every login/register/forgot-password page load fires, so it must not spend
 * the budget (it used to 429 after 30 loads and the social buttons vanished).
 */
export function isOAuthLimiterExempt(path: string): boolean {
  return /^\/providers\/?$/i.test(path);
}

const log = createLogger("security");

export type TrustProxySetting = number | false | string;

/**
 * R01-09: how many reverse-proxy hops to trust for req.ip.
 *
 * TRUST_PROXY_HOPS = "1" (Railway/Render: one load balancer), "2" (CDN + LB),
 * "0"/"false" (directly reachable, ignore X-Forwarded-For entirely), or an
 * Express trust list such as "loopback, 10.0.0.0/8". With N hops Express takes
 * the N-th address from the right of X-Forwarded-For, so entries a client
 * prepends (spoofed) never become req.ip and never create new rate-limit
 * buckets. "true" (trust everything) is refused because it makes req.ip
 * attacker-controlled. Unset defaults to 1, with a warning in production.
 */
export function parseTrustProxy(raw: string | undefined): {
  value: TrustProxySetting;
  warning?: string;
} {
  const v = (raw ?? "").trim();
  if (!v) {
    return {
      value: 1,
      warning:
        "TRUST_PROXY_HOPS is not set; trusting one proxy hop. Set it to the number of reverse proxies in front of the app (0 if none) so X-Forwarded-For cannot be spoofed.",
    };
  }
  if (/^(false|no|off)$/i.test(v)) return { value: false };
  if (/^\d+$/.test(v)) {
    const n = parseInt(v, 10);
    return { value: n === 0 ? false : n };
  }
  if (/^true$/i.test(v)) {
    return {
      value: 1,
      warning: "TRUST_PROXY_HOPS=true would trust any X-Forwarded-For value; using 1 hop instead.",
    };
  }
  return { value: v };
}

export function configureTrustProxy(
  app: Express,
  raw: string | undefined = process.env.TRUST_PROXY_HOPS
): TrustProxySetting {
  const { value, warning } = parseTrustProxy(raw);
  app.set("trust proxy", value);
  if (warning && (isProduction() || raw)) log.warn({ trustProxy: value }, warning);
  return value;
}

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

  // ─── Trust proxy (R01-09) — before anything reads req.ip ──
  configureTrustProxy(app);

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
      // R17-18: CSP says frame-ancestors 'none', so the legacy header must agree
      // (helmet defaults to SAMEORIGIN).
      frameguard: { action: "deny" },
      crossOriginEmbedderPolicy: false, // Allow embedding (PDF viewers, etc.)
    })
  );

  // D4 — second, TIGHTER style policy served as Content-Security-Policy-Report-Only.
  // It blocks nothing; browsers just report what *would* have been blocked to
  // /api/csp-report. Once the logs are clean, promote these directives into the
  // enforced policy above. See buildCspReportOnlyDirectives for the runbook.
  app.use(
    helmet.contentSecurityPolicy(
      buildCspReportOnlyDirectives() as Parameters<typeof helmet.contentSecurityPolicy>[0]
    )
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

        log.warn("Blocked CORS request from unauthorized origin");
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
        "X-Period-Lock-Reason",
        "Idempotency-Key",
      ],
      exposedHeaders: ["X-Total-Count", "X-Page", "X-Per-Page", "Retry-After", "RateLimit-Reset"],
      maxAge: 86400, // Cache preflight for 24 hours
    })
  );

  // ─── Rate Limiting (sliding window, configurable per route) ──
  // Each route group has its own shared sliding-window budget, sized via
  // env vars (RL_*). Requests carrying a valid access token count against
  // the user; anonymous traffic counts against the client IP
  // (R01-10). Requests rejected with 429 are not counted (R17-06).
  // Order matters: more specific paths must be registered before /api/.
  app.use(
    "/api/auth/oauth/",
    buildLimiter("oauth", {
      ...limiterProfiles.authOAuth,
      keyGenerator: clientIp,
      skipIf: (req) => isOAuthLimiterExempt(req.path),
    })
  );
  // Pre-auth brute-force tier for credential-bearing attempts ONLY, keyed by
  // IP. Session reads and token plumbing (/me, /refresh, /oauth/providers,
  // /logout) fire on every page load and are excluded, so several tabs
  // refreshing cannot lock a user out. Successful attempts refund their hit;
  // per-email progressive lockout lives in auth.routes (R01-12).
  app.use(
    "/api/auth/",
    buildLimiter("auth", {
      ...limiterProfiles.auth,
      keyGenerator: clientIp,
      skipSuccessfulRequests: true,
      skipIf: (req) => !isCredentialAuthPath(req.path),
    })
  );
  // STEP5: accepting a portal invitation sets a password, so it shares the credential budget.
  app.use(
    "/api/portal-invitations/",
    buildLimiter("portal-invitations", {
      ...limiterProfiles.auth,
      keyGenerator: clientIp,
      skipSuccessfulRequests: true,
      skipIf: (req) => req.method !== "POST" || !/^\/accept\/?$/i.test(req.path),
    })
  );
  app.use("/api/ai/", buildLimiter("api-ai", limiterProfiles.ai));
  app.use("/api/ocr/", buildLimiter("api-ocr", limiterProfiles.ai));
  app.use("/api/firm/bulk/ocr", buildLimiter("firm-bulk-ocr", limiterProfiles.ai));
  // Two-tier general limiter: an active dashboard fires a dozen GETs per
  // page, so reads get a generous dedicated budget while mutations keep the
  // stricter cap. A single tier throttled normal navigation, 429'd
  // /api/auth/me, and the client then treated the user as logged out.
  app.use(
    "/api/",
    buildLimiter("api-read", {
      ...limiterProfiles.read,
      skipIf: (req) => !["GET", "HEAD", "OPTIONS"].includes(req.method),
    })
  );
  app.use(
    "/api/",
    buildLimiter("api-write", {
      ...limiterProfiles.api,
      skipMethods: ["GET", "HEAD", "OPTIONS"],
    })
  );

  // ─── Request Size Limits ──────────────────────────────────
  // Reject oversized declared bodies before allocating parser buffers.
  app.use((req: Request, res: Response, next: NextFunction) => {
    const limit = EMAIL_INTAKE_PATH.test(req.path) ? EMAIL_INTAKE_LIMIT : LARGE_JSON_LIMIT;
    const contentLength = parseInt(req.headers["content-length"] || "0", 10);
    if (contentLength > limit) {
      return res.status(413).json(sizeErrorBody(req, "PAYLOAD_TOO_LARGE"));
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
        log.warn(
          { requestId: req.id, method: req.method, url: portalInviteLogPath(fullUrl) ?? undefined },
          "Suspicious request detected"
        );
        break;
      }
    }
    next();
  });

  log.info("Security middleware applied");
}
