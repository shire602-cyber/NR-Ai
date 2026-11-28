import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// F15 N1: a 60-character company name (Latin or Arabic) must truncate in the mobile
// header instead of overflowing under the search / bell / badge cluster.
const switcher = readFileSync("client/src/components/CompanySwitcher.tsx", "utf8");
const app = readFileSync("client/src/App.tsx", "utf8");

describe("compact company switcher truncation", () => {
  it("truncates the label, keeps it shrinkable, and exposes the full name", () => {
    const compact = switcher.slice(switcher.indexOf("button-company-switcher-compact") - 400);
    expect(compact).toMatch(/overflow-hidden/);
    expect(compact).toMatch(/min-w-0 truncate/);
    expect(compact).toMatch(/title=\{active\.name\}/);
    expect(switcher).toMatch(/block min-w-0 truncate[\s\S]*title=\{active\.name\}/);
  });
  it("gives the switcher wrapper a bounded flex width in the header", () => {
    expect(app).toMatch(/min-w-0 flex-1 md:hidden">\s*<CompanySwitcher variant="compact"/);
  });
});
