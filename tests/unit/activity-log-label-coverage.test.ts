/**
 * F13: the activity log, the security history and the security audit trail render audit action
 * codes through `activityActionLabel` (client/src/lib/activity-log-labels.ts). A code without a
 * catalog label falls back to a humanised English phrase, which shows as English in Arabic, so
 * every action literal the server writes must have an en and an ar label.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import enCatalog from "../../client/src/locales/en/adminConsole.json";
import arCatalog from "../../client/src/locales/ar/adminConsole.json";

const en = enCatalog as Record<string, string>;
const ar = arCatalog as Record<string, string>;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (full.endsWith(".ts")) out.push(full);
  }
  return out;
}

describe("activity action label coverage", () => {
  const codes = new Set<string>();
  for (const file of walk(path.resolve(__dirname, "../../server"))) {
    const text = readFileSync(file, "utf8");
    for (const m of text.matchAll(/\baction: "([A-Za-z_]+(?:\.[A-Za-z_]+)*)"/g)) codes.add(m[1]);
  }

  it("finds the server action codes", () => {
    expect(codes.size).toBeGreaterThan(100);
  });

  it("labels every server action code in English and Arabic", () => {
    const missing = [...codes].filter(
      (code) => !en[`activityLog.action.${code}`] || !ar[`activityLog.action.${code}`]
    );
    expect(missing).toEqual([]);
  });

  it("Arabic labels are Arabic text", () => {
    for (const code of codes) {
      expect(ar[`activityLog.action.${code}`], code).toMatch(/[؀-ۿ]/);
    }
  });
});
