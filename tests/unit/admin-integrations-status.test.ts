import { describe, expect, it } from "vitest";
import { adminIntegrationStatus } from "../../server/services/admin-integrations";

describe("STEP1 F6: admin integration status comes from the server environment", () => {
  it("reports unconfigured when nothing is set", () => {
    expect(adminIntegrationStatus({})).toEqual({
      stripe: { configured: false },
      openai: { configured: false },
      googleSheets: { configured: false },
    });
  });

  it("reports configured per integration, and never echoes a secret", () => {
    const status = adminIntegrationStatus({
      STRIPE_SECRET_KEY: "sk_live_x",
      OPENAI_API_KEY: "  ",
      GOOGLE_CLIENT_ID: "a",
      GOOGLE_CLIENT_SECRET: "b",
      GOOGLE_REFRESH_TOKEN: "c",
    });
    expect(status.stripe.configured).toBe(true);
    expect(status.openai.configured).toBe(false);
    expect(status.googleSheets.configured).toBe(true);
    expect(JSON.stringify(status)).not.toContain("sk_live_x");
  });

  it("needs both halves of the Google service-account credentials", () => {
    expect(
      adminIntegrationStatus({ GOOGLE_SERVICE_ACCOUNT_EMAIL: "x@y" }).googleSheets.configured
    ).toBe(false);
    expect(
      adminIntegrationStatus({
        GOOGLE_SERVICE_ACCOUNT_EMAIL: "x@y",
        GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: "k",
      }).googleSheets.configured
    ).toBe(true);
  });
});
