import { describe, expect, it } from "vitest";

import { isAdminOnlyRoute } from "../../client/src/lib/route-config";

describe("route config", () => {
  it("keeps admin client management restricted to admins", () => {
    expect(isAdminOnlyRoute("/admin/clients")).toBe(true);
    expect(isAdminOnlyRoute("/admin/clients/123")).toBe(true);
  });

  it("does not treat firm workspace routes as admin-only", () => {
    expect(isAdminOnlyRoute("/firm/clients")).toBe(false);
    expect(isAdminOnlyRoute("/firm/command-center")).toBe(false);
    expect(isAdminOnlyRoute("/firm/value-ops")).toBe(false);
  });
});
