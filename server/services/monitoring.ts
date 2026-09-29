// Single capture point for errors we want to be alertable in production.
//
// Always logs a structured `captured` record via pino. When SENTRY_DSN is set it
// also forwards to Sentry (free tier is enough). With no DSN the SDK is never
// imported and never called - the code path below is dead by construction.
//
// Everything that leaves the process goes through scrubForMonitoring():
// never request bodies, cookies, auth headers, tokens, TRNs, IBANs, emails or
// SQL parameters.

import { createLogger } from "../config/logger";
import { scrubForMonitoring, scrubString } from "./monitoring-scrub";

const log = createLogger("monitoring");

export interface CaptureContext {
  requestId?: string | null;
  method?: string;
  url?: string;
  userId?: string | null;
  companyId?: string | null;
  [key: string]: unknown;
}

type SentryModule = typeof import("@sentry/node");

const TAG_KEYS = ["requestId", "userId", "companyId", "method"] as const;
const SENTRY_DEFAULT_INTEGRATIONS_TO_DROP = new Set(["OnUncaughtException", "OnUnhandledRejection"]);

let sentryPromise: Promise<SentryModule | null> | null = null;

function dsn(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const value = env.SENTRY_DSN?.trim();
  return value ? value : undefined;
}

function normaliseError(error: unknown): { message: string; name?: string; stack?: string } {
  if (error instanceof Error) return { message: error.message, name: error.name, stack: error.stack };
  if (typeof error === "string") return { message: error };
  try {
    return { message: JSON.stringify(error) ?? String(error) };
  } catch {
    return { message: String(error) };
  }
}

/** Remove everything from an outgoing Sentry event that could carry customer data. */
function scrubEvent<T extends Record<string, any>>(event: T): T {
  const copy: Record<string, any> = { ...event };
  if (copy.request) {
    const { method, url } = copy.request;
    copy.request = { method, url: typeof url === "string" ? url.split("?")[0] : undefined };
  }
  if (copy.user) copy.user = copy.user.id ? { id: copy.user.id } : undefined;
  if (copy.extra) copy.extra = scrubForMonitoring(copy.extra);
  if (copy.contexts) copy.contexts = scrubForMonitoring(copy.contexts);
  if (typeof copy.message === "string") copy.message = scrubString(copy.message);
  if (copy.exception?.values) {
    copy.exception = {
      ...copy.exception,
      values: copy.exception.values.map((v: any) => ({
        ...v,
        value: typeof v.value === "string" ? scrubString(v.value) : v.value,
      })),
    };
  }
  return copy as T;
}

/**
 * Initialise Sentry. Call once at server start. No-op (and the SDK is never
 * imported) when SENTRY_DSN is not set. Safe to call more than once.
 */
export function initMonitoring(): Promise<SentryModule | null> {
  if (sentryPromise) return sentryPromise;
  const configuredDsn = dsn();
  if (!configuredDsn) {
    sentryPromise = Promise.resolve(null);
    return sentryPromise;
  }
  sentryPromise = import("@sentry/node")
    .then((Sentry) => {
      Sentry.init({
        dsn: configuredDsn,
        environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || "production",
        release: process.env.COMMIT_SHA || process.env.RAILWAY_GIT_COMMIT_SHA || undefined,
        tracesSampleRate: 0,
        // server/index.ts already forwards these two through captureException;
        // leaving Sentry's own handlers on would double-report and change exit
        // behaviour.
        integrations: (defaults) =>
          defaults.filter((i) => !SENTRY_DEFAULT_INTEGRATIONS_TO_DROP.has(i.name)),
        beforeSend: (event) => scrubEvent(event as any) as any,
        beforeBreadcrumb: () => null,
      });
      log.info("Sentry error tracking initialised");
      return Sentry;
    })
    .catch((err) => {
      log.error({ err: (err as Error)?.message }, "Sentry init failed - continuing with logs only");
      return null;
    });
  return sentryPromise;
}

/**
 * Record an error for alerting/diagnosis. Logs always; forwards (scrubbed) to
 * Sentry when SENTRY_DSN is configured. Never throws.
 */
export function captureException(error: unknown, context: CaptureContext = {}): void {
  const err = normaliseError(error);
  log.error({ err, ...context, captured: true }, `captureException: ${err.message}`);

  if (!dsn()) return;

  try {
    const tags: Record<string, string> = {};
    for (const key of TAG_KEYS) {
      const v = context[key];
      if (typeof v === "string" && v) tags[key] = v;
    }
    const extra = scrubForMonitoring(
      Object.fromEntries(Object.entries(context).filter(([k]) => !(TAG_KEYS as readonly string[]).includes(k)))
    ) as Record<string, unknown>;
    if (typeof context.url === "string") extra.url = context.url.split("?")[0];

    const safe = new Error(scrubString(err.message));
    safe.name = err.name ?? "Error";
    if (err.stack) safe.stack = scrubString(err.stack);

    void initMonitoring().then((Sentry) => {
      if (!Sentry) return;
      try {
        Sentry.captureException(safe, { tags, extra });
      } catch (sdkErr) {
        log.error({ err: (sdkErr as Error)?.message }, "Sentry.captureException failed");
      }
    });
  } catch (forwardErr) {
    log.error({ err: (forwardErr as Error)?.message }, "Failed to forward error to monitor");
  }
}

/** Wait (bounded) for queued events to be delivered - call before process.exit. */
export async function flushMonitoring(timeoutMs = 2000): Promise<void> {
  if (!dsn() || !sentryPromise) return;
  try {
    const Sentry = await sentryPromise;
    await Sentry?.flush(timeoutMs);
  } catch {
    /* best effort */
  }
}

/** Whether an external monitor is configured (for /health to report). */
export function monitoringConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(dsn(env));
}
