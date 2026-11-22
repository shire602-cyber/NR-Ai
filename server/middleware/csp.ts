import { portalInviteLogPath } from "../http/portal-invite-privacy";
import crypto from "crypto";
import type { Request, Response, NextFunction } from "express";
import type { IncomingMessage, ServerResponse } from "http";
import { isProduction } from "../config/env";
import { createLogger } from "../config/logger";

const log = createLogger("csp");

/**
 * Per-request nonce middleware. Attaches `res.locals.cspNonce` for templates
 * that need to inline a script (rare here; mostly available for future use).
 */
export function cspNonce(_req: Request, res: Response, next: NextFunction): void {
  res.locals.cspNonce = crypto.randomBytes(16).toString("base64");
  next();
}

/**
 * Build the Helmet contentSecurityPolicy directive set.
 *
 * Production: strict CSP — only same-origin scripts (no inline), nonces available
 * for any inline script we explicitly emit, and reports posted to /api/csp-report.
 * Development: relaxed CSP — Vite needs inline scripts and HMR over ws://, so we
 * keep the directives but allow 'unsafe-inline' and 'unsafe-eval' for scripts.
 */
// helmet hands raw http types to its directive callback, not express types.
const nonceFn = (_req: IncomingMessage, res: ServerResponse): string => {
  const expressRes = res as unknown as Response;
  return `'nonce-${(expressRes.locals?.cspNonce as string) ?? ""}'`;
};

export function buildCspDirectives() {
  const prod = isProduction();
  // W5-E: the Turnstile widget (script + iframe) is allowed only when CAPTCHA is configured.
  const turnstile = process.env.TURNSTILE_SECRET_KEY ? ["https://challenges.cloudflare.com"] : [];

  return {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: prod
        ? ["'self'", nonceFn, ...turnstile]
        : ["'self'", "'unsafe-inline'", "'unsafe-eval'", ...turnstile],
      // Broken-path sweep: bill / receipt previews show the file from a blob: URL in an iframe
      // (the PDF viewer); without blob: the fallback default-src 'self' blocked it.
      frameSrc: ["'self'", "blob:", ...turnstile],
      // D4 — the ENFORCED policy keeps `'unsafe-inline'` for styles. The client
      // uses 219 React `style={{ … }}` props across 22 files (inline style
      // ATTRIBUTES), and Radix/framer-motion inject `<style>` ELEMENTS at
      // runtime. Dropping it blind would break the UI silently.
      //
      // The tightened split is not guesswork any more: it ships alongside this
      // as a REPORT-ONLY policy (see buildCspReportOnlyDirectives below), so
      // real browsers tell us whether it is safe before we enforce it.
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"],
      imgSrc: ["'self'", "data:", "blob:", "https:"],
      connectSrc: prod
        ? ["'self'"]
        : ["'self'", "ws://localhost:*", "http://localhost:*", "ws://127.0.0.1:*"],
      workerSrc: ["'self'", "blob:"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
      reportUri: ["/api/csp-report"],
      ...(prod ? { upgradeInsecureRequests: [] } : {}),
    },
  };
}

/**
 * D4 — the TIGHTENED style policy, shipped in report-only mode.
 *
 * A CSP tightening that breaks the UI fails silently and visually, and no test
 * in this repo would catch it. So rather than guess, we serve this as a second
 * header (`Content-Security-Policy-Report-Only`) next to the enforced one.
 * Browsers evaluate it, block nothing, and POST any violation to
 * /api/csp-report.
 *
 * Exercise representative flows with the report-only header and confirm the
 * report endpoint receives browser reports. Filter "CSP violation reported"
 * log records by the `directive` field for `style-src-elem`, `style-src-attr`
 * or the `style-src` fallback. The accompanying request ID identifies the
 * report POST. Reproduce violations in browser DevTools to locate the
 * injection site. Promote the policy only after verifying the reporting path
 * and exercising the relevant flows without violations.
 *
 * `styleSrcAttr` deliberately keeps 'unsafe-inline': React's `style={{…}}`
 * needs it and removing it would require rewriting 219 call sites. The value
 * here is proving that `styleSrcElem` (runtime `<style>` injection) can be
 * locked down, which is the half that actually blocks injected-CSS attacks.
 */
export function buildCspReportOnlyDirectives() {
  const prod = isProduction();
  return {
    reportOnly: true,
    // R17-18 / R18-05: never merge helmet's default directives. They add
    // `upgrade-insecure-requests` (ignored, and logged as a console error, in a
    // report-only policy) and a script-src without the per-request nonce, which
    // made this policy differ from the enforced one. Everything is listed
    // explicitly instead.
    useDefaults: false,
    directives: {
      // Only the style directives differ; everything else mirrors the enforced
      // policy so a violation here unambiguously means "the style split broke".
      defaultSrc: ["'self'"],
      // Same script policy as the enforced header: report-only must not be more
      // permissive than what is actually enforced.
      scriptSrc: prod ? ["'self'", nonceFn] : ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
      // The -elem / -attr pair is what we are actually testing. `styleSrc` is
      // only the fallback for browsers without CSP3 support; pin it to today's
      // enforced value (rather than letting helmet merge its looser
      // "'self' https: 'unsafe-inline'" default) so any violation we log is
      // unambiguously about style-src-elem and not fallback noise.
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      styleSrcElem: ["'self'", "https://fonts.googleapis.com"],
      styleSrcAttr: ["'unsafe-inline'"],
      fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"],
      imgSrc: ["'self'", "data:", "blob:", "https:"],
      connectSrc: prod
        ? ["'self'"]
        : ["'self'", "ws://localhost:*", "http://localhost:*", "ws://127.0.0.1:*"],
      workerSrc: ["'self'", "blob:"],
      frameSrc: ["'self'", "blob:"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
      reportUri: ["/api/csp-report"],
    },
  };
}

const cspReportDirectives = new Set([
  "base-uri",
  "connect-src",
  "default-src",
  "font-src",
  "form-action",
  "frame-ancestors",
  "frame-src",
  "img-src",
  "manifest-src",
  "media-src",
  "object-src",
  "script-src",
  "script-src-attr",
  "script-src-elem",
  "style-src",
  "style-src-attr",
  "style-src-elem",
  "worker-src",
]);

/**
 * CSP violation report endpoint. Reports log the recognized directive and
 * the report request ID. Use browser diagnostics for source URLs and lines.
 */
export function cspReportHandler(req: Request, res: Response): void {
  // CSP reports may include full URLs and are also accepted from unauthenticated clients.
  const report = req.body?.["csp-report"] ?? req.body;
  const directive = report?.["effective-directive"];
  if (typeof directive === "string" && cspReportDirectives.has(directive)) {
    log.warn({ requestId: req.id, directive }, "CSP violation reported");
  } else {
    for (const field of ["document-uri", "blocked-uri", "source-file"]) {
      if (typeof report?.[field] !== "string") continue;
      const path = portalInviteLogPath(report[field]);
      if (!path) continue;
      log.warn({ requestId: req.id, path }, "CSP violation reported");
      break;
    }
  }
  res.status(204).end();
}
