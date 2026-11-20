/**
 * Per-worker environment for the DB harness. Runs before every test file in
 * tests/db (see tests/db/vitest.config.ts) and BEFORE any server module is
 * imported, because server/db.ts and server/middleware/rateLimit.ts read
 * process.env at import time.
 */

// Never let server/db.ts's `import "dotenv/config"` pull the developer's .env
// (which points at a shared database and may hold real API keys).
process.env.DOTENV_CONFIG_PATH = "/nonexistent/harness.env";
process.env.DOTENV_CONFIG_QUIET = "true";

process.env.NODE_ENV = "test";
process.env.SESSION_SECRET = "harness-session-secret-at-least-32-characters";
process.env.JWT_SECRET = "harness-jwt-secret-at-least-32-characters-long";
process.env.PORT = "5199"; // validated by env schema; the harness listens on an ephemeral port
process.env.LOG_LEVEL = process.env.HARNESS_LOG_LEVEL || "fatal";
process.env.AUTO_MIGRATE_ON_BOOT = "false";
process.env.FRONTEND_URL = "http://127.0.0.1";
process.env.DB_POOL_MAX = process.env.DB_POOL_MAX || "10";
// Placeholder; the harness swaps in the per-file database before importing
// any server module.
process.env.DATABASE_URL = "postgresql://harness:harness@127.0.0.1:1/harness_unset";

// Rate limits default to "effectively off" in the harness. Tests that need
// real limits call setRateLimits({...}).
for (const [k, v] of Object.entries({
  RL_API_MAX: "1000000",
  RL_READ_MAX: "1000000",
  RL_AUTH_MAX: "1000000",
  RL_AUTH_OAUTH_MAX: "1000000",
  RL_AI_MAX: "1000000",
})) {
  process.env[k] = v;
}

// External integrations stay unconfigured so no test can reach the network.
for (const key of [
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "RESEND_API_KEY",
  "SMTP_HOST",
  "SMTP_USER",
  "SMTP_PASS",
  "S3_BUCKET",
  "BLOB_READ_WRITE_TOKEN",
  "REDIS_URL",
  "VAPID_PUBLIC_KEY",
  "VAPID_PRIVATE_KEY",
  "WIO_CLIENT_ID",
  "LEAN_APP_TOKEN",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_SERVICE_ACCOUNT_EMAIL",
  "OAUTH_GOOGLE_CLIENT_ID",
  "OAUTH_MICROSOFT_CLIENT_ID",
  "BILLING_ENFORCEMENT",
  "EMAIL_INTAKE_ENABLED",
  "SENTRY_DSN",
]) {
  delete process.env[key];
}

// zod 3-compatible validation messages, as installed by the server entry (R17-27).
import "../../shared/zod-config";
