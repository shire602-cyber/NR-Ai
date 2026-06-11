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

  // === Open Banking (Wio Bank) ===
  WIO_CLIENT_ID: z.string().optional(),
  WIO_CLIENT_SECRET: z.string().optional(),
  WIO_API_BASE_URL: z.string().optional(),

  // === Open Banking (Lean Technologies aggregator) ===
  LEAN_APP_TOKEN: z.string().optional(),
  LEAN_API_BASE_URL: z.string().optional(),

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
