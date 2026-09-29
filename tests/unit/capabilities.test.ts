import { describe, it, expect } from "vitest";
import { describeDisabledCapabilities } from "../../server/services/capabilities";

describe("describeDisabledCapabilities", () => {
  it("lists every capability that is off, with what stops working", () => {
    const out = describeDisabledCapabilities({
      email: false,
      errorTracking: false,
      durableStorage: false,
      billing: false,
    });
    expect(out).toHaveLength(4);
    const text = out.join("\n");
    expect(text).toMatch(/email/i);
    expect(text).toMatch(/password reset/i);
    expect(text).toMatch(/SENTRY_DSN/);
    expect(text).toMatch(/STORAGE_NOT_DURABLE|uploads/i);
    expect(text).toMatch(/STRIPE_SECRET_KEY/);
  });

  it("returns nothing when everything is configured", () => {
    expect(
      describeDisabledCapabilities({ email: true, errorTracking: true, durableStorage: true, billing: true })
    ).toEqual([]);
  });
});
