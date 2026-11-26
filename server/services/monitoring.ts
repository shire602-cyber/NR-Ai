// Single capture point for errors we want to be alertable in production.
//
// Today it logs a structured `captured` record via pino, so behaviour is
// unchanged. It also gives ONE place to forward to an external tracker
// (Sentry / Datadog) when configured — wire the forward here, not at the dozens
// of call sites. Keeping this dependency-free means we ship the seam now and
// add the SDK later by setting an env var, exactly like the ASP/e-invoice seam.

import { createLogger } from "../config/logger";

const log = createLogger("monitoring");

export interface CaptureContext {
  requestId?: string | null;
  method?: string;
  route?: string;
  code?: string;
  operational?: boolean;
  unhandled?: boolean;
  source?: "unhandledRejection" | "uncaughtException";
  fatal?: boolean;
}

function errorType(error: unknown): string {
  for (const type of [TypeError, RangeError, ReferenceError, SyntaxError, URIError]) {
    if (error instanceof type) return type.name;
  }
  return error instanceof Error ? "Error" : typeof error;
}

/**
 * Record an error for alerting/diagnosis. Logs now; forwards to an external
 * monitor when one is configured (no-op until then).
 */
export function captureException(error: unknown, context: CaptureContext = {}): void {
  // Messages and stacks can embed SQL parameters, provider responses and URLs.
  log.error({ ...context, errorType: errorType(error), captured: true }, "Captured exception");

  // Forward hook — wire an external tracker here when a DSN is configured. Kept
  // env-gated + lazy so no SDK dependency is required until you opt in.
  // if (process.env.SENTRY_DSN) { ...Sentry.captureException(error, { extra: context })... }
}

/**
 * Whether an error forwarder is actually active. captureException only logs today (no SDK is
 * wired), so this is false even when SENTRY_DSN / MONITORING_DSN is set: reporting "configured"
 * for a DSN nothing consumes would be a false assurance on /health. Flip this only together with
 * a real forwarder in captureException.
 */
const ERROR_FORWARDER_ACTIVE = false;

export function monitoringConfigured(_env: NodeJS.ProcessEnv = process.env): boolean {
  return ERROR_FORWARDER_ACTIVE;
}

/** True when a DSN is set but nothing forwards errors to it (surfaced on /health). */
export function monitoringDsnIgnored(env: NodeJS.ProcessEnv = process.env): boolean {
  return !ERROR_FORWARDER_ACTIVE && Boolean(env.SENTRY_DSN || env.MONITORING_DSN);
}
