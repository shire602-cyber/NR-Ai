import { describe, it, expect } from "vitest";
import { envSchema } from "../../server/config/env";

const baseEnv = {
  DATABASE_URL: "postgresql://user:pass@host:5432/db",
  SESSION_SECRET: "a".repeat(32),
  JWT_SECRET: "b".repeat(32),
};

describe("BCRYPT_COST env validation", () => {
  it("defaults to 12", () => {
    const r = envSchema.safeParse(baseEnv);
    expect(r.success && r.data.BCRYPT_COST).toBe(12);
  });

  it("rejects the old cost of 10", () => {
    expect(envSchema.safeParse({ ...baseEnv, BCRYPT_COST: "10" }).success).toBe(false);
  });

  it("accepts 13 (coerced from a string)", () => {
    const r = envSchema.safeParse({ ...baseEnv, BCRYPT_COST: "13" });
    expect(r.success && r.data.BCRYPT_COST).toBe(13);
  });

  it("rejects values above 15", () => {
    expect(envSchema.safeParse({ ...baseEnv, BCRYPT_COST: "16" }).success).toBe(false);
  });

  it("exposes the validated cost from server/config/bcrypt", async () => {
    const { BCRYPT_COST } = await import("../../server/config/bcrypt");
    expect(BCRYPT_COST).toBe(12);
  });
});
