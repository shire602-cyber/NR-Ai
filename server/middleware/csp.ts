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
export function buildCspDirectives() {
  const prod = isProduction();
  // helmet hands raw http types to its directive callback, not express types.
  const nonceFn = (_req: IncomingMessage, res: ServerResponse): string => {
    const expressRes = res as unknown as Response;
    return `'nonce-${(expressRes.locals?.cspNonce as string) ?? ""}'`;
  };

  return {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: prod ? ["'self'", nonceFn] : ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
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
 * How to finish the job:
 *   1. Deploy. Exercise the app normally for a week.
 *   2. Grep the logs for "CSP violation reported" with
 *      effectiveDirective "style-src-elem" / "style-src-attr".
 *   3. Zero violations  -> promote these directives into buildCspDirectives()
 *                          and delete the report-only policy.
 *      Some violations  -> they name the exact file and line injecting the
 *                          style; nonce or remove those, then re-check.
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
    directives: {
      // Only the style directives differ; everything else mirrors the enforced
      // policy so a violation here unambiguously means "the style split broke".
      defaultSrc: ["'self'"],
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
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
      reportUri: ["/api/csp-report"],
    },
  };
}

/**
 * CSP violation report endpoint. The browser POSTs JSON describing the
 * blocked resource. We log a structured warning so it shows up in pino output
 * and any downstream log aggregator without spamming at error level.
 */
export function cspReportHandler(req: Request, res: Response): void {
  const report = (req.body && (req.body["csp-report"] || req.body)) || {};
  log.warn(
    {
      blockedUri: report["blocked-uri"],
      violatedDirective: report["violated-directive"],
      effectiveDirective: report["effective-directive"],
      documentUri: report["document-uri"],
      sourceFile: report["source-file"],
      lineNumber: report["line-number"],
      ip: req.ip,
      ua: req.headers["user-agent"],
    },
    "CSP violation reported"
  );
  res.status(204).end();
}
