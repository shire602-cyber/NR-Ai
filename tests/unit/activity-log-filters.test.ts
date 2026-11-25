import { beforeAll, describe, expect, it } from "vitest";
import { activitySearchText, matchesActionFilter } from "../../client/src/lib/activity-log-filters";
import { loadLocale, t } from "../../client/src/lib/i18n";

beforeAll(async () => {
  await Promise.all([loadLocale("en"), loadLocale("ar")]);
});

describe("activity log filters", () => {
  it("matches the verb filters against real dotted action codes", () => {
    expect(matchesActionFilter("invoice.create", "create")).toBe(true);
    expect(matchesActionFilter("auth.login_success", "login")).toBe(true);
    expect(matchesActionFilter("auth.logout_all", "logout")).toBe(true);
    expect(matchesActionFilter("invoice.update", "create")).toBe(false);
    expect(matchesActionFilter("auth.login_success", "logout")).toBe(false);
    expect(matchesActionFilter("anything", "all")).toBe(true);
  });

  it("searches the Arabic sentence in Arabic mode", () => {
    const log = {
      action: "invoice.create",
      entityType: "invoice",
      description: "Invoice INV-2026-00001 created",
    };
    const ar = t.ar as Record<string, string>;
    const text = activitySearchText(ar, log, "ar");
    expect(text).toContain(ar["activityLog.action.invoice.create"].toLowerCase());
    expect(text).toContain("inv-2026-00001");
  });
});
