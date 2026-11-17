// WP-A (spec 3.1): signed-out visitors on unknown URLs get the public 404; app sections still
// go to sign-in. Source inspection of App.tsx is intentional: the route table is declarative
// JSX that cannot be enumerated without mounting the whole app.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { APP_SECTIONS, isAppSectionPath } from "../../client/src/components/layout/app-sections";
import { isPublicPath } from "../../client/src/lib/i18n";

const app = readFileSync("client/src/App.tsx", "utf8");
const routes = [...app.matchAll(/<Route path="([^"]+)"/g)].map((m) => m[1]);

describe("app sections (public 404 vs sign-in)", () => {
  it("every authenticated App.tsx route lives under a known app section", () => {
    const missing = routes
      .filter((r) => !isPublicPath(r) && !/^\/(view|portal|auth|verify-email)\b/.test(r))
      .filter((r) => !isAppSectionPath(r));
    expect(missing).toEqual([]);
  });

  it("classifies paths", () => {
    expect(isAppSectionPath("/invoices/abc?x=1")).toBe(true);
    expect(isAppSectionPath("/settings/company")).toBe(true);
    expect(isAppSectionPath("/no-such-page")).toBe(false);
    expect(isAppSectionPath("/__ui")).toBe(false);
    expect(APP_SECTIONS.has("pricing")).toBe(false);
  });

  it("the review-only gallery route is never a literal production route", () => {
    expect(routes).not.toContain("/__ui");
    expect(app).toMatch(/import\.meta\.env\.VITE_UI_GALLERY === "1"/);
  });

  it("the router renders the public 404 for signed-out unknown paths", () => {
    expect(app).toContain("!isAppSectionPath(pathname)");
    expect(app).toContain("<PublicNotFound />");
  });
});
