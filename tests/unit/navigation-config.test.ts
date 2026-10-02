/**
 * The sidebar menu: small, honest and reachable.
 *  - no destination appears twice
 *  - every destination is a real route in App.tsx
 *  - the day-to-day menu (everything except the collapsed "More" group) stays small
 *  - nothing points at a feature that has been switched off
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  ADMIN_GROUP,
  CUSTOMER_GROUPS,
  DASHBOARD_URL,
  HIDDEN_FEATURE_ROUTES,
  MORE_GROUP,
  NRA_GROUP,
  destinationsOf,
  primaryCustomerDestinations,
} from "../../client/src/components/layout/nav-config";

const root = path.resolve(__dirname, "../..");
const appSource = fs.readFileSync(path.join(root, "client/src/App.tsx"), "utf8");
const routePaths = new Set([...appSource.matchAll(/path="([^"]+)"/g)].map((m) => m[1]));

const pathOf = (url: string) => url.split("?")[0];
const ALL_GROUPS = [...CUSTOMER_GROUPS, NRA_GROUP, ADMIN_GROUP, MORE_GROUP];
const ALL_DESTINATIONS = [DASHBOARD_URL, ...ALL_GROUPS.flatMap(destinationsOf)];

describe("sidebar navigation config", () => {
  it("has no duplicate destinations", () => {
    const seen = new Set<string>();
    const dupes = ALL_DESTINATIONS.filter((u) => (seen.has(u) ? true : (seen.add(u), false)));
    expect(dupes).toEqual([]);
  });

  it("has unique group keys", () => {
    const keys = ALL_GROUPS.map((g) => g.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("points every destination at a route that exists in App.tsx", () => {
    const missing = ALL_DESTINATIONS.filter((u) => !routePaths.has(pathOf(u)));
    expect(missing).toEqual([]);
  });

  it("keeps the day-to-day menu (excluding More) at 40 destinations or fewer", () => {
    const count = primaryCustomerDestinations().length;
    expect(count).toBeLessThanOrEqual(40);
    // Guard against the menu silently ballooning again.
    expect(CUSTOMER_GROUPS.length + 1).toBeLessThanOrEqual(12); // + Dashboard
  });

  it("puts the daily workflow first, in a fixed order, and More last", () => {
    expect(CUSTOMER_GROUPS.map((g) => g.key)).toEqual([
      "sales",
      "purchases",
      "banking",
      "accounting",
      "compliance",
      "payroll",
      "reports",
      "documents",
      "settings",
    ]);
    expect(MORE_GROUP.key).toBe("more");
  });

  it("keeps the previous sidebar entries reachable (moved to More, not dropped)", () => {
    const more = MORE_GROUP.items.map((i) => i.url);
    for (const url of [
      "/payment-chasing",
      "/invoice-templates",
      "/receipt-autopilot",
      "/inventory",
      "/reconciliation-rules",
      "/cost-centers",
      "/compliance-calendar",
      "/document-versions",
      "/company-profile",
      "/notification-preferences",
      "/backup-restore",
      "/history",
    ]) {
      expect(more, url).toContain(url);
    }
  });

  it("puts sales orders and customer advances under Sales and the sales settings under Settings", () => {
    const sales = CUSTOMER_GROUPS.find((g) => g.key === "sales");
    expect(sales?.items.map((i) => i.url)).toEqual(expect.arrayContaining(["/sales-orders", "/customer-advances"]));
    const settings = CUSTOMER_GROUPS.find((g) => g.key === "settings");
    expect(settings?.items.map((i) => i.url)).toContain("/settings/sales");
    for (const url of ["/sales-orders", "/customer-advances", "/settings/sales"]) expect(routePaths.has(url), url).toBe(true);
  });

  it("serves the public quote page without the app shell", () => {
    expect(routePaths.has("/view/quote/:token")).toBe(true);
    expect(appSource).toContain('pathname.startsWith("/view/quote/")');
  });

  it("offers a single AI entry", () => {
    const ai = ALL_DESTINATIONS.filter((u) => /^\/ai-|smart-assistant/.test(u));
    expect(ai).toEqual(["/ai-cfo"]);
  });

  it("has no entry pointing at a hidden feature", () => {
    const hidden = ALL_DESTINATIONS.filter((u) => HIDDEN_FEATURE_ROUTES.includes(pathOf(u)));
    expect(hidden).toEqual([]);
    expect(ALL_DESTINATIONS).not.toContain("/integrations-hub");
    const titleKeys = ALL_GROUPS.flatMap((g) => g.items.map((i) => i.titleKey));
    expect(titleKeys).not.toContain("apiKeys");
    expect(titleKeys).not.toContain("integrationsHub");
  });

  it("lists the cash-flow forecast under Banking and keeps reconciliation rules in More", () => {
    const banking = CUSTOMER_GROUPS.find((g) => g.key === "banking");
    expect(banking?.items.map((i) => i.url)).toEqual(["/bank-reconciliation", "/auto-reconcile", "/cashflow-forecast"]);
    expect(MORE_GROUP.items.map((i) => i.url)).toContain("/reconciliation-rules");
    expect(banking?.items.map((i) => i.url)).not.toContain("/reconciliation-rules");
  });

  it("puts Projects under Sales and Approvals under Accounting, both routed in App.tsx (Phase 8 D2)", () => {
    const sales = CUSTOMER_GROUPS.find((g) => g.key === "sales")!;
    const accounting = CUSTOMER_GROUPS.find((g) => g.key === "accounting")!;
    expect(sales.items.map((i) => i.url)).toContain("/projects");
    expect(accounting.items.map((i) => i.url)).toContain("/approvals");
    for (const path of ["/projects", "/projects/:id", "/approvals"]) expect(routePaths.has(path), path).toBe(true);
  });

  it("offers Security under Settings and Developers, Data and privacy and Import data in More, all routed (Phase 8 D5)", () => {
    const settings = CUSTOMER_GROUPS.find((g) => g.key === "settings")!;
    expect(settings.items.map((i) => i.url)).toContain("/settings/security");
    expect(MORE_GROUP.items.map((i) => i.url)).toEqual(expect.arrayContaining(["/developer-settings", "/settings/data", "/import"]));
    for (const path of ["/settings/security", "/settings/data", "/import", "/developer-settings", "/developers/api", "/help/:slug"]) {
      expect(routePaths.has(path), path).toBe(true);
    }
    // The API is real now, so its keys page is no longer a hidden feature.
    expect(HIDDEN_FEATURE_ROUTES).not.toContain("/api-keys");
  });

  it("keeps the firm section as it was", () => {
    expect(NRA_GROUP.items.map((i) => i.url)).toContain("/firm/document-chasing");
    expect(NRA_GROUP.items).toHaveLength(8);
  });
});
