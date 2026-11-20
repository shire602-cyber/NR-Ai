import { describe, expect, it } from "vitest";
import { isCustomerOnlyRoute, mergeLegacySearch } from "../../client/src/lib/route-config";

// Redirect wiring in App.tsx lives in page-source-guards.test.ts; sidebar entries are asserted by
// rendering in sidebar-nav-behaviour.test.ts. These are the pure route helpers.
describe("consolidated navigation helpers", () => {
  it("R18-09: /ai is a customer-only route like the pages it replaces", () => {
    expect(isCustomerOnlyRoute("/ai")).toBe(true);
    expect(isCustomerOnlyRoute("/ai-cfo")).toBe(true);
  });

  it("R18-09: legacy deep links keep their query string through the redirect", () => {
    expect(mergeLegacySearch("/analytics?view=reports", "?tab=comparison")).toBe(
      "/analytics?tab=comparison&view=reports"
    );
    expect(mergeLegacySearch("/ai?tab=chat", "")).toBe("/ai?tab=chat");
    expect(mergeLegacySearch("/chart-of-accounts", "?q=cash")).toBe("/chart-of-accounts?q=cash");
    // the destination parameter wins over a stale legacy one
    expect(mergeLegacySearch("/ai?tab=cfo", "?tab=old")).toBe("/ai?tab=cfo");
  });
});
