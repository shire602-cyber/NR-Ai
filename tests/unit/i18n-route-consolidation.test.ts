import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isCustomerOnlyRoute, mergeLegacySearch } from "../../client/src/lib/route-config";

const repoRoot = process.cwd();
const read = (path: string) => readFileSync(join(repoRoot, path), "utf8");
const app = read("client/src/App.tsx");
const sidebar = read("client/src/components/layout/AppSidebar.tsx");

/** The `<RedirectTo to="..."/>` target declared for a legacy route path. */
function redirectTargetFor(path: string): string | null {
  const escaped = path.replace(/[/.]/g, "\\$&");
  const match = app.match(
    new RegExp(
      `<Route path="${escaped}">\\s*(?:\\{[^}]*=>\\s*)?<RedirectTo to=\\{?[\`"]([^\`"]+)[\`"]`
    )
  );
  return match ? match[1] : null;
}

describe("consolidated navigation redirects", () => {
  it("R18-09: the five AI pages redirect into one /ai hub with tabs", () => {
    expect(redirectTargetFor("/ai-cfo")).toBe("/ai?tab=cfo");
    expect(redirectTargetFor("/ai-features")).toBe("/ai?tab=features");
    expect(redirectTargetFor("/smart-assistant")).toBe("/ai?tab=assistant");
    expect(redirectTargetFor("/ai-chat")).toBe("/ai?tab=chat");
    expect(redirectTargetFor("/ai-inbox")).toBe("/ai?tab=inbox");
    expect(app).toContain('<Route path="/ai" component={AIHub} />');

    const hub = read("client/src/pages/AIHub.tsx");
    for (const id of ["cfo", "features", "assistant", "chat", "inbox"]) {
      expect(hub).toContain(`id: "${id}"`);
    }
    // existing pages are embedded as-is, not rewritten
    for (const page of ["AICFO", "AIFeatures", "SmartAssistant", "AIChat", "AIInbox"]) {
      expect(hub).toContain(`import("@/pages/${page}")`);
    }
  });

  it("R20-08: /accounts and /integrations redirect to their canonical pages", () => {
    expect(redirectTargetFor("/accounts")).toBe("/chart-of-accounts");
    expect(redirectTargetFor("/integrations")).toBe("/integrations-hub");
    // the per-account ledger route is a different, longer path and stays routed
    expect(app).toContain('<Route path="/accounts/:id/ledger" component={AccountLedger} />');
    expect(sidebar).toContain('url: "/integrations-hub"');
    expect(sidebar).not.toContain('url: "/integrations"');
  });

  it("R20-08: analytics pages are tabs of one /analytics route without touching the Reports sidebar item", () => {
    expect(app).toContain('<Route path="/analytics" component={AnalyticsHub} />');
    expect(redirectTargetFor("/advanced-analytics")).toBe("/analytics?view=advanced");
    expect(redirectTargetFor("/advanced-reports")).toBe("/analytics?view=reports");
    const hub = read("client/src/pages/AnalyticsHub.tsx");
    expect(hub).toContain('param="view"');
    for (const page of ["Analytics", "AdvancedAnalytics", "AdvancedReports"]) {
      expect(hub).toContain(`import("@/pages/${page}")`);
    }
    // AGENTS.md: Reports stays one direct /reports item with no children
    expect(sidebar).toContain('key: "reports"');
    expect(sidebar).toContain('url: "/reports"');
    expect(sidebar).not.toContain("/advanced-reports");
    expect(sidebar).not.toContain("/analytics");
  });

  it("R15-09: legacy /admin/clients pages redirect to /firm/clients and the admin entry is deduplicated", () => {
    expect(redirectTargetFor("/admin/clients")).toBe("/firm/clients");
    expect(redirectTargetFor("/admin/clients/:id")).toBe("/firm/clients/${params.id}");
    expect(redirectTargetFor("/admin/clients/:id/documents")).toBe("/firm/clients/${params.id}");
    expect(redirectTargetFor("/admin/clients/:id/tasks")).toBe("/firm/clients/${params.id}");
    expect(redirectTargetFor("/admin")).toBe("/admin/users");
    // the second, duplicated `/admin` route entry is gone
    expect(app.match(/<Route path="\/admin"/g)?.length).toBe(1);
    expect(app.match(/<Route path="\/admin\/users"/g)?.length).toBe(1);
    expect(sidebar).not.toContain('url: "/admin/clients"');
    expect(sidebar).not.toContain('titleKey: "systemSettings", url: "/admin"');
  });

  it("R15-09: the orphan WhatsApp dashboard and the superseded legacy pages are deleted", () => {
    for (const file of [
      "client/src/pages/WhatsAppDashboard.tsx",
      "client/src/pages/Accounts.tsx",
      "client/src/pages/ClientManagement.tsx",
      "client/src/pages/ClientDetails.tsx",
      "client/src/pages/ClientDocuments.tsx",
      "client/src/pages/ClientTasks.tsx",
    ]) {
      expect(existsSync(join(repoRoot, file)), file).toBe(false);
    }
    // WhatsApp stays NR-firm only: nothing in the customer shell routes to it
    expect(app).not.toMatch(/whatsapp/i);
    expect(sidebar).not.toMatch(/whatsapp/i);
  });

  it("R18-09: /ai is a customer-only route like the pages it replaces", () => {
    expect(isCustomerOnlyRoute("/ai")).toBe(true);
    expect(isCustomerOnlyRoute("/ai-cfo")).toBe(true);
  });

  it("R18-09: the sidebar exposes one direct AI hub entry", () => {
    expect(sidebar).toMatch(
      /key: "ai",\s*titleKey: "ai\.hubTitle",[\s\S]*?url: "\/ai",\s*items: \[\]/
    );
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

  it("R18-09: the mobile More sheet and command palette point at the hub, not the retired routes", () => {
    expect(read("client/src/components/MobileNav.tsx")).toContain('href: "/ai"');
    expect(read("client/src/components/CommandPalette.tsx")).toContain('href: "/ai?tab=chat"');
    expect(read("client/src/pages/Dashboard.tsx")).toContain('<Link href="/ai?tab=cfo">');
  });
});
