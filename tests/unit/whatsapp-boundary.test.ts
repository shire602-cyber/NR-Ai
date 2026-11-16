import { describe, expect, it } from "vitest";
import {
  commonRoutes,
  customerOnlyRoutes,
  isAdminOnlyRoute,
  isCustomerOnlyRoute,
} from "../../client/src/lib/route-config";

// The firm-gated API checks and the customer-facing source scan moved to
// tests/db/firm-gated-surfaces.test.ts (real app) and page-source-guards.test.ts.
describe("WhatsApp surface boundary", () => {
  it("does not expose a generic customer WhatsApp route", () => {
    expect(customerOnlyRoutes).not.toContain("/whatsapp");
    expect(commonRoutes).not.toContain("/whatsapp");
    expect(isCustomerOnlyRoute("/whatsapp")).toBe(false);
    expect(isAdminOnlyRoute("/whatsapp")).toBe(false);
  });
});
