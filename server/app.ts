import "dotenv/config";
// The process runs in UTC: timestamp columns carry no zone (server/config/pin-timezone.ts).
import "./config/pin-timezone";
// zod 3-compatible validation messages, before any schema parses (R17-27).
import "../shared/zod-config";

import express from "express";
import {
  EMAIL_INTAKE_LIMIT,
  EMAIL_INTAKE_PATH,
  LARGE_JSON_LIMIT,
  RAW_WEBHOOK_PREFIXES,
  SMALL_JSON_LIMIT,
  usesLargeJson,
  VAT_EVIDENCE_JSON_LIMIT,
  VAT_EVIDENCE_SCAN_PATH,
} from "./http/body-limits";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import passport from "passport";
import compression from "compression";
import cookieParser from "cookie-parser";

import { getEnv } from "./config/env";
import { authCookieBaseOptions } from "./config/cookies";
import { applySecurityMiddleware } from "./middleware/security";
import { requestId } from "./middleware/requestId";
import { requestLogger } from "./middleware/requestLogger";
import {
  globalErrorHandler,
  notFoundHandler,
  requestTransportErrorHandler,
} from "./middleware/errorHandler";
import { csrfProtection, csrfTokenHandler, csrfErrorHandler } from "./middleware/csrf";
import { registerRoutes } from "./routes";
import { pingDb, pool } from "./db";
import { createHealthHandler } from "./routes/admin-health.routes";
import "./auth";

export async function createApp({ vercel = false } = {}) {
  const env = getEnv();
  const app = express();

  // ─── Trust proxy (required behind reverse proxy / Railway / Render) ──
  // R01-09: applySecurityMiddleware sets it from TRUST_PROXY_HOPS (default 1,
  // warning in production when unset) before anything reads req.ip.

  // ─── Correlation ID — must run before logging / security so every
  //     request log line and rate-limit warn carries the same trace ID.
  app.use(requestId);

  // Prevent shared caching across cookies, tokens and tenants. Vercel's CDN
  // directive still applies if an individual route sets a browser cache policy.
  if (vercel) {
    app.use((_req, res, next) => {
      res.set({
        "Cache-Control": "private, no-store",
        "CDN-Cache-Control": "no-store",
        "Vercel-CDN-Cache-Control": "no-store",
      });
      next();
    });
  }

  // ─── Security middleware (helmet, CORS, rate limiting) ──────
  applySecurityMiddleware(app);

  // ─── Response compression ────────────────────────────────────
  app.use(compression());

  // ─── Body parsing ────────────────────────────────────────────
  // Most endpoints accept small JSON. A handful of image-upload routes
  // (OCR + receipts) accept base64 data URLs and need a larger limit.
  // Route list shared with the DB test harness (server/http/body-limits.ts).
  const largeJson = express.json({ limit: LARGE_JSON_LIMIT });
  const smallJson = express.json({ limit: SMALL_JSON_LIMIT });
  const vatEvidenceJson = express.json({ limit: VAT_EVIDENCE_JSON_LIMIT });

  // The inbound email webhook needs the EXACT raw bytes to verify its HMAC
  // signature, so it gets a raw-body parser and is skipped by the JSON parser.
  app.use(EMAIL_INTAKE_PATH, express.raw({ type: "*/*", limit: EMAIL_INTAKE_LIMIT }));
  // W4-D: payment-gateway and email-delivery webhooks are verified over the raw bytes too.
  // E1: A-Cube webhooks are signed over the raw bytes (HTTP Message Signatures + content-digest).
  // RAW_WEBHOOK_PREFIXES (server/http/body-limits.ts): W4-D gateways, A-Cube, Complyance, Stripe.
  app.use([...RAW_WEBHOOK_PREFIXES], express.raw({ type: "*/*", limit: "1mb" }));

  app.use((req, res, next) => {
    if (EMAIL_INTAKE_PATH.test(req.path)) return next(); // raw body handled above
    if (RAW_WEBHOOK_PREFIXES.some((p) => req.path.startsWith(`${p}/`))) return next();
    if (VAT_EVIDENCE_SCAN_PATH.test(req.path)) return vatEvidenceJson(req, res, next);
    const useLarge = usesLargeJson(req.path);
    return (useLarge ? largeJson : smallJson)(req, res, next);
  });
  app.use(express.urlencoded({ extended: false, limit: "1mb" }));

  // R17-12: malformed JSON (400 INVALID_JSON), oversize bodies (413) and CORS
  // rejections from applySecurityMiddleware, including preflight
  // (403 ORIGIN_NOT_ALLOWED), are client errors. Answer them here, before
  // session/auth/CSRF, instead of letting them surface as a 500.
  app.use(requestTransportErrorHandler);

  // ─── Cookie parser (must run before CSRF + session) ─────────
  app.use(cookieParser(env.SESSION_SECRET));

  // ─── Session configuration ───────────────────────────────────
  const PgSession = connectPgSimple(session);
  app.use(
    session({
      store: new PgSession({
        pool,
        tableName: "session",
        createTableIfMissing: !vercel,
        ...(vercel ? { pruneSessionInterval: false } : {}),
      }),
      secret: env.SESSION_SECRET,
      resave: false,
      saveUninitialized: false,
      cookie: {
        ...authCookieBaseOptions(),
        maxAge: 24 * 60 * 60 * 1000, // 24 hours
      },
    })
  );

  // ─── Passport initialization ─────────────────────────────────
  app.use(passport.initialize());
  app.use(passport.session());

  // ─── Request logging ─────────────────────────────────────────
  app.use(requestLogger);

  // ─── CSRF token endpoint (public, sets cookie + returns header token) ─
  app.get("/api/csrf-token", csrfTokenHandler);

  // ─── CSRF protection on state-changing requests ─────────────
  // Skips Bearer-auth requests and a small allowlist (login/register/portal).
  app.use(csrfProtection);

  // ─── Health check (before auth, always accessible) ───────────
  // Liveness probe — process is up. Cheap; safe for orchestrators.
  app.get("/health/live", (_req, res) => {
    res.status(200).json({ status: "ok", uptime: process.uptime() });
  });

  // Railway healthcheck endpoint. This must stay DB-free so deploy readiness is
  // about whether the HTTP server is alive, not whether downstream services are.
  app.get("/api/version", (_req, res) => {
    res.status(200).json({
      status: "ok",
      version: process.env.APP_VERSION || "1.0.0",
      commit:
        process.env.VERCEL_GIT_COMMIT_SHA ||
        process.env.RAILWAY_GIT_COMMIT_SHA ||
        process.env.COMMIT_SHA ||
        null,
      environment: env.NODE_ENV,
      uptime: process.uptime(),
    });
  });

  // Readiness probe — process is up and can reach the database. Minimal details
  // only; full internals stay behind authenticated operational routes.
  app.get(["/health/ready", "/readyz"], async (_req, res) => {
    const ping = await pingDb();
    res.status(ping.ok ? 200 : 503).json({
      status: ping.ok ? "ok" : "degraded",
      checks: {
        database: ping.ok ? "ok" : "error",
        databaseLatencyMs: ping.latencyMs,
      },
    });
  });

  // Readiness/full health — depends on DB. R17-13: anonymous callers get only
  // { status }; version, pid, memory and pool stats are for platform admins.
  app.get("/health", createHealthHandler(env.NODE_ENV));

  await registerRoutes(app, { retireBankingOnStartup: !vercel });

  app.use("/api", notFoundHandler);
  app.use(csrfErrorHandler);
  app.use(globalErrorHandler);

  return app;
}
