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

const envSchema = z.object({
  // === Required ===
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  SESSION_SECRET: z.string().min(32, "SESSION_SECRET must be at least 32 characters"),
  JWT_SECRET: z.string().min(32, "JWT_SECRET must be at least 32 characters"),

  // === Server ===
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.string().transform(Number).pipe(z.number().int().min(1).max(65535)).default(5000),
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
  // Legacy single-model override. Prefer the per-task variables below (R05-21); when set it
  // only applies to tasks that have no explicit AI_MODEL_<TASK> value.
  AI_MODEL: z.string().optional(),
  AI_MODEL_CATEGORIZE: z.string().optional(), // small/cheap model for categorisation
  AI_MODEL_OCR: z.string().optional(), // vision model for receipt extraction
  AI_MODEL_ADVISORY: z.string().optional(), // strong model for CFO advice / forecasting
  AI_MODEL_NL: z.string().optional(), // natural-language assistant / gateway
  // Default per-company monthly metering caps (R05-26); rows in ai_usage_limits override.
  AI_MONTHLY_TOKEN_CAP: z.coerce.number().int().min(0).optional(),
  AI_MONTHLY_COST_CAP_USD: z.coerce.number().min(0).optional(),
  // Mask personal names, TRNs and IBANs before prompts leave the server (R17-26).
  AI_REDACT_PII: z.enum(["true", "false"]).optional(),

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
  STRIPE_PRICE_STARTER_MONTHLY: z.string().optional(),
  STRIPE_PRICE_STARTER_YEARLY: z.string().optional(),
  STRIPE_PRICE_PROFESSIONAL_MONTHLY: z.string().optional(),
  STRIPE_PRICE_PROFESSIONAL_YEARLY: z.string().optional(),
  STRIPE_PRICE_ENTERPRISE_MONTHLY: z.string().optional(),
  STRIPE_PRICE_ENTERPRISE_YEARLY: z.string().optional(),

  // === Web Push (VAPID) ===
  VAPID_PUBLIC_KEY: z.string().optional(),
  VAPID_PRIVATE_KEY: z.string().optional(),
  VAPID_SUBJECT: z.string().optional(),

  // === Logging ===
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),

  // === Database / migrations ===
  AUTO_MIGRATE_ON_BOOT: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),

  // === Background jobs ===
  // On by default. Only the exact value "false" stops the cron scheduler and the
  // outbox pollers (staging sets it so Railway can sleep the idle service).
  BACKGROUND_JOBS_ENABLED: z
    .string()
    .optional()
    .transform((v) => v !== "false"),

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
  // Production refuses to boot on local-disk receipt storage unless this is "true" (R05-07).
  ALLOW_LOCAL_STORAGE: z.enum(["true", "false"]).optional(),
  // Per-company receipt storage quota in MB (R05-20). Default 2048.
  COMPANY_STORAGE_QUOTA_MB: z.coerce.number().int().min(1).optional(),
  // Optional ClamAV daemon for upload scanning (R05-20). Unset => scanning reports requires_external.
  CLAMAV_HOST: z.string().optional(),
  CLAMAV_PORT: z.coerce.number().int().min(1).max(65535).optional(),

  // === Session store ===
  // When set, Express sessions are persisted in Redis so they survive
  // deploys and can be shared across replicas. When unset, the server
  // falls back to an in-process MemoryStore (fine for single-instance
  // development, sessions are lost on every restart in production).
  REDIS_URL: z.string().url().optional(),
});

export type Env = z.infer<typeof envSchema>;

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

  if (result.data.NODE_ENV === "production" && !process.env.TURNSTILE_SECRET_KEY?.trim()) {
    process.stderr.write(
      "WARNING: TURNSTILE_SECRET_KEY is unset. Public registration and password reset are accepting requests without CAPTCHA.\n"
    );
  }

  _env = result.data;
  return result.data;
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
