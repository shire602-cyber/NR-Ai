import { describe, it, expect } from "vitest";
import { billingConfigProblem, envSchema } from "../../server/config/env";

describe("billingConfigProblem", () => {
  it("refuses production with enforcement on and no Stripe keys", () => {
    const msg = billingConfigProblem({ NODE_ENV: "production", BILLING_ENFORCEMENT: "true" });
    expect(msg).toMatch(/BILLING_ENFORCEMENT/);
    expect(msg).toMatch(/STRIPE_SECRET_KEY/);
    expect(msg).toMatch(/STRIPE_WEBHOOK_SECRET/);
  });

  it("names only what is missing", () => {
    const msg = billingConfigProblem({
      NODE_ENV: "production",
      BILLING_ENFORCEMENT: "true",
      STRIPE_SECRET_KEY: "sk_test_x",
    });
    expect(msg).toMatch(/STRIPE_WEBHOOK_SECRET/);
    expect(msg).not.toMatch(/STRIPE_SECRET_KEY/);
  });

  it("is fine when enforcement is on and Stripe is configured", () => {
    expect(
      billingConfigProblem({
        NODE_ENV: "production",
        BILLING_ENFORCEMENT: "true",
        STRIPE_SECRET_KEY: "sk_test_x",
        STRIPE_WEBHOOK_SECRET: "whsec_x",
      })
    ).toBeNull();
  });

  it("does not apply when enforcement is off or outside production", () => {
    expect(billingConfigProblem({ NODE_ENV: "production" })).toBeNull();
    expect(billingConfigProblem({ NODE_ENV: "production", BILLING_ENFORCEMENT: "false" })).toBeNull();
    expect(billingConfigProblem({ NODE_ENV: "development", BILLING_ENFORCEMENT: "true" })).toBeNull();
  });
});

describe("envSchema additions", () => {
  const base = {
    DATABASE_URL: "postgresql://u:p@h:5432/d",
    SESSION_SECRET: "a".repeat(32),
    JWT_SECRET: "b".repeat(32),
  };

  it("accepts an unset or blank SENTRY_DSN and a valid one", () => {
    expect(envSchema.safeParse(base).success).toBe(true);
    expect(envSchema.safeParse({ ...base, SENTRY_DSN: "" }).success).toBe(true);
    const ok = envSchema.safeParse({ ...base, SENTRY_DSN: "https://k@o1.ingest.sentry.io/1", SENTRY_ENVIRONMENT: "prod" });
    expect(ok.success).toBe(true);
  });

  it("rejects a SENTRY_DSN that is not a URL", () => {
    expect(envSchema.safeParse({ ...base, SENTRY_DSN: "not a url" }).success).toBe(false);
  });

  it("validates BILLING_GRANDFATHER_BEFORE as a date when present", () => {
    expect(envSchema.safeParse({ ...base, BILLING_GRANDFATHER_BEFORE: "2026-10-01" }).success).toBe(true);
    expect(envSchema.safeParse({ ...base, BILLING_GRANDFATHER_BEFORE: "" }).success).toBe(true);
    expect(envSchema.safeParse({ ...base, BILLING_GRANDFATHER_BEFORE: "soon" }).success).toBe(false);
  });
});
