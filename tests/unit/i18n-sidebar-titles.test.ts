import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { t } from "../../client/src/lib/i18n";

const sidebar = readFileSync(
  join(process.cwd(), "client", "src", "components", "layout", "AppSidebar.tsx"),
  "utf8"
);

describe("sidebar translations", () => {
  const titleKeys = [...new Set([...sidebar.matchAll(/titleKey: "([^"]+)"/g)].map((m) => m[1]))];

  it("R18-02: every sidebar title key resolves to a translated string in both locales", () => {
    expect(titleKeys.length).toBeGreaterThan(40);
    const missing = titleKeys.filter((key) => !t.en[key] || !t.ar[key]);
    expect(missing).toEqual([]);
  });

  it("R18-02: sidebar group labels are translated, not hard-coded English", () => {
    for (const key of [
      "sidebarOverview",
      "sidebarOperations",
      "sidebarWorkspace",
      "sidebarDocuments",
      "sidebarInsights",
    ]) {
      expect(sidebar).toContain(`t["shell.${key}"]`);
    }
    expect(sidebar).not.toMatch(/>\s*(Overview|Operations|Workspace|Documents|Insights)\s*</);
  });
});
