import { describe, expect, it } from "vitest";
import {
  commonRoutes,
  customerOnlyRoutes,
  isCustomerOnlyRoute,
  isFirmOnlyRoute,
} from "../../client/src/lib/route-config";

// Sidebar placement is asserted in sidebar-nav-behaviour.test.ts, the firm-gated APIs in
// tests/db/firm-gated-surfaces.test.ts, the App route in page-source-guards.test.ts.
describe("Document chasing surface boundary", () => {
  it("does not expose a generic SaaS/customer document-chasing route", () => {
    expect(customerOnlyRoutes).not.toContain("/document-chasing");
    expect(commonRoutes).not.toContain("/document-chasing");
    expect(isCustomerOnlyRoute("/document-chasing")).toBe(false);
    expect(isFirmOnlyRoute("/firm/document-chasing")).toBe(true);
  });
});
