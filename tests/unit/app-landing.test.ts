import { describe, expect, it } from "vitest";
import { landingPathFor, skipsOnboardingRedirect } from "../../client/src/lib/app-landing";

describe("STEP1 F7: default landing page after sign-in", () => {
  it("customers land on the dashboard", () => {
    expect(landingPathFor({ userType: "customer" })).toBe("/dashboard");
    expect(landingPathFor(null)).toBe("/dashboard");
  });
  it("portal users land on their portal", () => {
    expect(landingPathFor({ userType: "client_portal" })).toBe("/client-portal/dashboard");
  });
  it("platform admins land on the admin console, not their company's onboarding", () => {
    expect(landingPathFor({ userType: "customer", isAdmin: true })).toBe("/admin/users");
  });
  it("NR firm staff land on the firm command center", () => {
    for (const firmRole of ["firm_owner", "firm_admin", "preparer", "reviewer", "viewer"]) {
      expect(landingPathFor({ userType: "customer", firmRole }), firmRole).toBe(
        "/firm/command-center"
      );
    }
    expect(landingPathFor({ firmRole: "not_a_role" })).toBe("/dashboard");
  });
});

describe("STEP1 F11: onboarding redirect exemptions (item 10)", () => {
  it("never bounces the wizard itself or the NR consoles to onboarding", () => {
    for (const p of ["/onboarding", "/admin", "/admin/users", "/firm/clients", "/firm"]) {
      expect(skipsOnboardingRedirect(p), p).toBe(true);
    }
  });
  it("still sends ordinary customer pages through onboarding", () => {
    for (const p of ["/dashboard", "/invoices", "/administration", "/firmware", "/reports"]) {
      expect(skipsOnboardingRedirect(p), p).toBe(false);
    }
  });
});
