import { describe, expect, it, vi } from "vitest";

vi.mock("../../server/config/env", () => ({
  getEnv: () => ({ NODE_ENV: "test", SESSION_SECRET: "s".repeat(32) }),
  isProduction: () => false,
}));
vi.mock("../../server/config/logger", () => ({
  createLogger: () => ({ warn: vi.fn() }),
}));

import { isCsrfExemptPath } from "../../server/middleware/csrf";

const TOKEN = "a1".repeat(32);

describe("STEP5 CSRF exemptions (G3)", () => {
  it("the cookie-authenticated staff portal routes are NOT exempt", () => {
    for (const p of [
      "/api/portal/generate-access",
      "/api/portal/revoke-access",
      "/api/portal/contacts/00000000-0000-4000-8000-000000000000/access",
      "/api/portal/contacts/x/portal-users",
    ]) {
      expect(isCsrfExemptPath(p), p).toBe(false);
    }
  });

  it("customer token and OTP routes stay exempt (their credential is in the path or body)", () => {
    for (const p of [
      `/api/portal/${TOKEN}/invoices`,
      `/api/portal/${TOKEN}/invoices/abc/pay`,
      `/api/portal/${TOKEN}/documents`,
      "/api/portal/login/request",
      "/api/portal/login/verify",
      "/api/portal/einvoicing-approve/abc/done",
      "/api/portal/pay/abc",
      "/api/portal/public-invoices/abc/pay",
    ]) {
      expect(isCsrfExemptPath(p), p).toBe(true);
    }
  });

  it("the invitation accept and the authenticated portal are protected", () => {
    expect(isCsrfExemptPath("/api/portal-invitations/lookup")).toBe(false);
    expect(isCsrfExemptPath("/api/portal-invitations/accept")).toBe(false);
    expect(isCsrfExemptPath("/api/client-portal/messages")).toBe(false);
    expect(isCsrfExemptPath("/api/companies/x/portal-invitations/bulk")).toBe(false);
  });
});
