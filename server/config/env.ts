import { z } from "zod";

/**
 * Environment variable validation schema.
 * Validates all required and optional env vars at startup.
 * If validation fails, the server will NOT start.
 */
const sameSiteSchema = z.preprocess(
  (value) => (typeof value === "string" ? value.toLowerCase() : value),
  z.enum(["strict", "lax", "none"]).optional()
);

// Treat an empty string (a blank line in a .env file or a cleared dashboard
// variable) the same as "not set".
const blankAsUndefined = (value: unknown) =>
  typeof value === "string" && value.trim() === "" ? undefined : value;

export const envSchema = z.object({
  // === Required ===
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  SESSION_SECRET: z.string().min(32, "SESSION_SECRET must be at least 32 characters"),
  JWT_SECRET: z.string().min(32, "JWT_SECRET must be at least 32 characters"),

  // === Security ===
  // bcrypt work factor for password hashing. Existing hashes keep verifying
  // (the cost is embedded in each hash); only new hashes use this value.
  BCRYPT_COST: z.coerce.number().int().min(12).max(15).default(12),

  // === Server ===
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.string().transform(Number).pipe(z.number().int().min(1).max(65535)).default("5000"),
  FRONTEND_URL: z.string().url().optional(),
  CORS_ORIGIN: z.string().optional(),
  AUTH_COOKIE_SAMESITE: sameSiteSchema,
  AUTH_PUBLIC_URL: z.string().url().optional(),

  // === Social login / OpenID Connect ===
  OAUTH_GOOGLE_CLIENT_ID: z.string().optional(),
  OAUTH_GOOGLE_CLIENT_SECRET: z.string().optional(),
  OAUTH_MICROSOFT_CLIENT_ID: z.string().optional(),
  OAUTH_MICROSOFT_CLIENT_SECRET: z.string().optional(),

  // === AI / OpenAI ===
  OPENAI_API_KEY: z.string().optional(),
  AI_MODEL: z.string().default("gpt-3.5-turbo"),

  // === Support contact surfaced in AI prompts (optional) ===
  SUPPORT_CONTACT_NAME: z.string().optional(),
  SUPPORT_CONTACT_PHONE: z.string().optional(),

  // === AI / Anthropic (used for OCR vision if set) ===
  ANTHROPIC_API_KEY: z.string().optional(),

  // === Google Sheets Integration ===
  GOOGLE_SERVICE_ACCOUNT_EMAIL: z.string().email().optional(),
  GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: z.string().optional(),
  // OR OAuth2 flow:
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GOOGLE_REFRESH_TOKEN: z.string().optional(),

  // === Stripe Billing ===
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  // === Online invoice payment: Stripe Connect Standard (Phase 8 D1). Off without these. ===
  STRIPE_CONNECT_CLIENT_ID: z.string().optional(), // ca_... (OAuth onboarding of each company's own Stripe account)
  STRIPE_CONNECT_WEBHOOK_SECRET: z.string().optional(), // signs events of connected accounts (Connect endpoint)
  // Test-only fake gateway adapter ("1" turns it on). A production boot with it set is refused.
  PAYMENT_GATEWAY_FAKE: z.string().optional(),
  STRIPE_PRICE_STARTER_MONTHLY: z.string().optional(),
  STRIPE_PRICE_STARTER_YEARLY: z.string().optional(),
  STRIPE_PRICE_PROFESSIONAL_MONTHLY: z.string().optional(),
  STRIPE_PRICE_PROFESSIONAL_YEARLY: z.string().optional(),
  STRIPE_PRICE_ENTERPRISE_MONTHLY: z.string().optional(),
  STRIPE_PRICE_ENTERPRISE_YEARLY: z.string().optional(),

  // === Billing enforcement (owner switches, see docs/RELEASE_NOTES_PHASE2.md) ===
  // Only the exact string "true" turns enforcement on; anything else observes
  // (X-Billing-Would-Block header) without blocking.
  BILLING_ENFORCEMENT: z.string().optional(),
  // ISO date. Companies created before it stay on the top plan while set.
  BILLING_GRANDFATHER_BEFORE: z.preprocess(
    blankAsUndefined,
    z
      .string()
      .refine((v) => !Number.isNaN(new Date(v).getTime()), "must be an ISO date, e.g. 2026-10-01")
      .optional()
  ),

  // === Web Push (VAPID) ===
  VAPID_PUBLIC_KEY: z.string().optional(),
  VAPID_PRIVATE_KEY: z.string().optional(),
  VAPID_SUBJECT: z.string().optional(),

  // === Open Banking (Lean Technologies aggregator) ===
  // Off unless LEAN_APP_TOKEN (the application id) and LEAN_CLIENT_SECRET are both set. LEAN_ENV defaults to the
  // sandbox; the two base URLs override the host of each environment (docs.leantech.me, and the in-test mock).
  LEAN_APP_TOKEN: z.string().optional(),
  LEAN_CLIENT_SECRET: z.string().optional(),
  LEAN_ENV: z.enum(["sandbox", "production"]).default("sandbox"),
  LEAN_API_BASE_URL: z.string().optional(),
  LEAN_AUTH_BASE_URL: z.string().optional(),

  // === Error tracking (optional - Sentry free tier) ===
  // Unset: errors are logged only and the Sentry SDK is never loaded.
  SENTRY_DSN: z.preprocess(blankAsUndefined, z.string().url().optional()),
  SENTRY_ENVIRONMENT: z.preprocess(blankAsUndefined, z.string().max(64).optional()),

  // === Logging ===
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),

  // === Database / migrations ===
  AUTO_MIGRATE_ON_BOOT: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),

  // === Email / SMTP (optional — features gracefully degrade if not set) ===
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.string().transform(Number).pipe(z.number().int().min(1).max(65535)).optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().optional(),

  // === Email / Resend (preferred over SMTP when set) ===
  RESEND_API_KEY: z.string().optional(),
  RESEND_FROM: z.string().optional(),

  // === Email document intake (firm-internal pilot — OFF by default) ===
  // Feature flag gating the whole intake feature; only "true" enables it.
  EMAIL_INTAKE_ENABLED: z.enum(["true", "false"]).optional(),
  // Which mailbox adapter to use once one is implemented (gmail | imap |
  // inbound). Unset/"unconfigured" → the no-op source (no mailbox connected).
  EMAIL_INTAKE_PROVIDER: z.string().optional(),
  // HMAC secret for the inbound-webhook adapter (Mailgun/Postmark/etc.). When
  // set, POST /api/webhooks/email-intake verifies the provider signature.
  EMAIL_INTAKE_WEBHOOK_SECRET: z.string().optional(),

  // === Object storage for receipt images (S3-compatible: R2 / AWS S3 / etc.) ===
  // When S3_BUCKET is set, receipt images are stored durably in object storage
  // instead of the (ephemeral) local disk — required on Railway and on Vercel.
  S3_BUCKET: z.string().optional(),
  S3_ENDPOINT: z.string().optional(), // R2: https://<account>.r2.cloudflarestorage.com; AWS: leave unset
  S3_REGION: z.string().optional(), // R2: "auto"; AWS: e.g. "me-central-1"
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  // Vercel Blob (native to a Vercel stack). When set, used in preference to S3.
  BLOB_READ_WRITE_TOKEN: z.string().optional(),

  // === Session store ===
  // When set, Express sessions are persisted in Redis so they survive
  // deploys and can be shared across replicas. When unset, the server
  // falls back to an in-process MemoryStore (fine for single-instance
  // development, sessions are lost on every restart in production).
  REDIS_URL: z.string().url().optional(),
});

export type Env = z.infer<typeof envSchema>;

/**
 * Misconfiguration that must stop a production boot: enforcement is on but
 * there is no way to take payment, which would paywall every tenant behind a
 * dead upgrade button. Returns a message, or null when fine.
 */
export function billingConfigProblem(env: {
  NODE_ENV?: string;
  BILLING_ENFORCEMENT?: string;
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
}): string | null {
  if (env.NODE_ENV !== "production" || env.BILLING_ENFORCEMENT !== "true") return null;
  const missing = ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"].filter(
    (key) => !env[key as "STRIPE_SECRET_KEY" | "STRIPE_WEBHOOK_SECRET"]
  );
  if (missing.length === 0) return null;
  return (
    `BILLING_ENFORCEMENT=true but ${missing.join(" and ")} ${missing.length > 1 ? "are" : "is"} not set. ` +
    "Enforcing plans with no way to pay would lock every customer out. " +
    "Set the Stripe variables first, or unset BILLING_ENFORCEMENT."
  );
}

let _env: Env | null = null;

/**
 * Validate and parse environment variables.
 * Call once at startup. Throws if validation fails.
 */
export function validateEnv(): Env {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    const errors = result.error.flatten().fieldErrors;
    const errorMessages = Object.entries(errors)
      .map(([key, msgs]) => `  ${key}: ${(msgs || []).join(", ")}`)
      .join("\n");

    process.stderr.write(`\nEnvironment validation failed:\n\n${errorMessages}\n\n`);
    process.stderr.write("Please check your .env file or environment variables.\n");
    process.exit(1);
  }

  const billingProblem = billingConfigProblem(result.data);
  if (billingProblem) {
    process.stderr.write(`\nEnvironment validation failed:\n\n  ${billingProblem}\n\n`);
    process.exit(1);
  }

  if (isFakeGatewayInProduction(result.data)) {
    process.stderr.write(
      "\nEnvironment validation failed:\n\n  PAYMENT_GATEWAY_FAKE=1 is a test-only switch and must not be set in production: " +
        "it would accept unsigned-by-Stripe payments as real money.\n\n"
    );
    process.exit(1);
  }

  _env = result.data;
  return result.data;
}

/** The fake payment gateway must never run in production (it settles invoices without a real charge). */
export function isFakeGatewayInProduction(env: { NODE_ENV?: string; PAYMENT_GATEWAY_FAKE?: string }): boolean {
  return env.NODE_ENV === "production" && env.PAYMENT_GATEWAY_FAKE === "1";
}

/**
 * Get validated environment.
 * Auto-validates on first call (lazy initialization).
 * This prevents module evaluation ordering issues in bundled builds.
 */
export function getEnv(): Env {
  if (!_env) {
    validateEnv();
  }
  return _env!;
}

/**
 * Check if we're in production mode.
 */
export function isProduction(): boolean {
  return getEnv().NODE_ENV === "production";
}

/**
 * Check if we're in development mode.
 */
export function isDevelopment(): boolean {
  return getEnv().NODE_ENV === "development";
}

/**
 * Check if we're in test mode.
 */
export function isTest(): boolean {
  return getEnv().NODE_ENV === "test";
}
