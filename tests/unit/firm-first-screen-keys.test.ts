/**
 * The firm landing screens boot on a narrow catalog set (shared/firm-boot.ts). A translation key
 * read at first paint from a namespace outside that set would show its raw key name until the
 * rest of the firm catalogs arrive. Keys are read through `t["ns.key"]` / `<T k="ns.key" />`, so
 * this scans the source of the two screens and of the app shell they render inside and checks
 * where each key lives.
 *
 * Source-inspection test, on purpose: rendering both screens through every state (loading, error,
 * each dialog) with fixtures for every API they call would be far heavier than this check, and
 * the browser-side check is `npm run e2e:arabic-runtime` plus the Playwright key scan in
 * `npm run e2e:firm-tools`.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { FIRM_FIRST_SCREEN_NAMESPACES } from "../../shared/firm-boot";

const root = process.cwd();
const src = path.join(root, "client/src");

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return walk(p);
    return /\.tsx?$/.test(e.name) ? [p] : [];
  });
}

function catalogKeys(locale: "en" | "ar"): Map<string, string[]> {
  const dir = path.join(src, "locales", locale);
  const owners = new Map<string, string[]>();
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".json"))) {
    const ns = file.replace(/\.json$/, "");
    const keys = Object.keys(JSON.parse(fs.readFileSync(path.join(dir, file), "utf8")));
    for (const key of keys) owners.set(key, [...(owners.get(key) ?? []), ns]);
  }
  return owners;
}

/** Sources read at first paint: the two screens, their local modules and the signed-in shell. */
function firstScreenSources(): string[] {
  return [
    path.join(src, "pages/firm/ClientPortfolio.tsx"),
    path.join(src, "pages/FirmCommandCenter.tsx"),
    ...walk(path.join(src, "pages/firm/portfolio")),
    path.join(src, "components/einvoice/FirmEInvoicingCell.tsx"),
    path.join(src, "App.tsx"),
    path.join(src, "components/MobileNav.tsx"),
    path.join(src, "components/NotificationBell.tsx"),
    path.join(src, "components/OfflineIndicator.tsx"),
    path.join(src, "components/CompanySwitcher.tsx"),
    ...walk(path.join(src, "components/layout")).filter((f) => !f.endsWith("PortalLayout.tsx")),
  ];
}

describe("firm first-screen catalogs", () => {
  const allowed = new Set<string>(FIRM_FIRST_SCREEN_NAMESPACES);
  for (const locale of ["en", "ar"] as const) {
    it(`every literal key the screens and shell read resolves inside the first-screen set (${locale})`, () => {
      const owners = catalogKeys(locale);
      const stray: string[] = [];
      for (const file of firstScreenSources()) {
        const text = fs.readFileSync(file, "utf8");
        const keys = new Set<string>();
        for (const m of text.matchAll(/\bt\["([^"]+)"\]/g)) keys.add(m[1]);
        for (const m of text.matchAll(/<T\s+k="([^"]+)"/g)) keys.add(m[1]);
        for (const key of keys) {
          const where = owners.get(key);
          // Keys defined outside the catalog files (legacy flat keys in i18n.ts) always load.
          if (!where) continue;
          if (!where.some((ns) => allowed.has(ns))) {
            stray.push(`${path.relative(root, file)}: ${key} lives only in ${where.join(", ")}`);
          }
        }
      }
      expect(stray).toEqual([]);
    });
  }
});
