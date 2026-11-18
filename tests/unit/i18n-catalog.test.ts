// Source inspection is intentional: this is the hard-coded-copy guard. It scans every page and
// component source file for JSX text that bypasses the catalogs, which is a property of the
// source itself, not of any rendered output.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
// @ts-expect-error - plain .mjs script without type declarations
import { scanComponents, scanPages } from "../../scripts/i18n-scan.mjs";
import { formatMessage, isLocaleLoaded, loadLocale, t } from "../../client/src/lib/i18n";

// S5: namespace catalogs are code-split (one lazy chunk per namespace and locale).
beforeAll(async () => {
  expect(isLocaleLoaded("ar")).toBe(false);
  await Promise.all([loadLocale("en"), loadLocale("ar")]);
});

const repoRoot = process.cwd();
const localesDir = join(repoRoot, "client", "src", "locales");

type Catalog = Record<string, string>;

function loadNamespaces(locale: "en" | "ar"): Record<string, Catalog> {
  const dir = join(localesDir, locale);
  const out: Record<string, Catalog> = {};
  for (const file of readdirSync(dir).filter((name) => name.endsWith(".json"))) {
    out[file.replace(/\.json$/, "")] = JSON.parse(readFileSync(join(dir, file), "utf8"));
  }
  return out;
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...walk(path));
    else if (/\.tsx?$/.test(path)) out.push(path);
  }
  return out;
}

const placeholders = (value: string) => [...value.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe("i18n catalogs", () => {
  const en = loadNamespaces("en");
  const ar = loadNamespaces("ar");

  it("R18-02: every namespace exists in both en and ar", () => {
    expect(Object.keys(ar).sort()).toEqual(Object.keys(en).sort());
    expect(Object.keys(en).length).toBeGreaterThan(0);
  });

  it("R18-02: every en key has a non-empty ar value (and no stray ar keys)", () => {
    for (const [namespace, catalog] of Object.entries(en)) {
      const arabic = ar[namespace];
      const missing = Object.keys(catalog).filter((key) => !(key in arabic));
      const extra = Object.keys(arabic).filter((key) => !(key in catalog));
      expect(missing, `${namespace}: ar is missing keys`).toEqual([]);
      expect(extra, `${namespace}: ar has keys without an en source`).toEqual([]);
      for (const [key, value] of Object.entries(catalog)) {
        expect(value.trim(), `en ${key}`).not.toBe("");
        expect(arabic[key].trim(), `ar ${key}`).not.toBe("");
      }
    }
  });

  it("R18-02: Arabic values contain Arabic script (not an English copy)", () => {
    const allowedLatin = new Set(["shell.brandName"]);
    for (const [namespace, catalog] of Object.entries(ar)) {
      for (const [key, value] of Object.entries(catalog)) {
        if (allowedLatin.has(key)) continue;
        expect(value, `${namespace}/${key}`).toMatch(/[؀-ۿ]/);
      }
    }
  });

  it("R18-02: interpolation placeholders match between en and ar (word order lives in the template)", () => {
    for (const [namespace, catalog] of Object.entries(en)) {
      for (const [key, value] of Object.entries(catalog)) {
        expect(placeholders(ar[namespace][key]), `${namespace}/${key}`).toEqual(
          placeholders(value)
        );
      }
    }
  });

  it("R18-02: keys are unique across namespaces so later workers cannot collide", () => {
    const seen = new Map<string, string>();
    for (const [namespace, catalog] of Object.entries(en)) {
      for (const key of Object.keys(catalog)) {
        expect(seen.has(key), `${key} is in both ${seen.get(key)} and ${namespace}`).toBe(false);
        seen.set(key, namespace);
      }
    }
  });

  it("R18-02: namespace catalogs are merged into the runtime dictionary for both locales", () => {
    expect(t.en["shell.skipToContent"]).toBe("Skip to main content");
    expect(t.ar["shell.skipToContent"]).toMatch(/[؀-ۿ]/);
    expect(t.en["onboarding.skip"]).toBeTruthy();
    expect(t.ar["pages.cancel"]).toBe("إلغاء");
    // legacy base keys keep working
    expect(t.en.dashboard).toBe("Dashboard");
  });

  it("R18-02: every catalog key referenced from client source exists", () => {
    const namespaces = Object.keys(en);
    const pattern = new RegExp(`["'\`]((?:${namespaces.join("|")})\\.[A-Za-z0-9.]+)["'\`]`, "g");
    const all = new Set(Object.values(en).flatMap((catalog) => Object.keys(catalog)));
    const missing: string[] = [];
    for (const file of walk(join(repoRoot, "client", "src"))) {
      if (file.includes(`${join("client", "src", "locales")}`)) continue;
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(pattern)) {
        const key = match[1];
        // skip prefixes of dynamic keys such as `onboarding.step.${key}.title`
        if (key.endsWith(".")) continue;
        if (!all.has(key)) missing.push(`${file.replace(repoRoot + "/", "")}: ${key}`);
      }
    }
    expect(missing).toEqual([]);
  });

  // Fable N2: `t["cashFlowForecast.emptyTitle"]` rendered an empty state with no text because
  // the key was in neither catalog. The check above only sees keys whose first segment is a
  // namespace file name; this one covers every lookup form (`t["…"]`, `t("…")`, `k="…"`,
  // `translateNow("…")`) for any key prefix the catalogs use, in both languages.
  it("N2: every key looked up from client source exists in the en and ar catalogs", () => {
    const enKeys = new Set(Object.values(en).flatMap((catalog) => Object.keys(catalog)));
    const arKeys = new Set(Object.values(ar).flatMap((catalog) => Object.keys(catalog)));
    const lookup =
      /(?:\bt\[\s*|\bt\(\s*|\btranslateNow\(\s*|\bk=\{?\s*)["'`]([A-Za-z][A-Za-z0-9]*\.[A-Za-z0-9.]*[A-Za-z0-9])["'`]/g;
    const missing: string[] = [];
    for (const file of walk(join(repoRoot, "client", "src"))) {
      if (file.includes(`${join("client", "src", "locales")}`)) continue;
      // Doc-comment usage examples (` * <Alert title={t["x.title"]}>`) are not lookups.
      const source = readFileSync(file, "utf8")
        .split("\n")
        .filter((line) => !/^\s*(\*|\/\/)/.test(line))
        .join("\n");
      for (const match of source.matchAll(lookup)) {
        const key = match[1];
        const where = `${file.replace(repoRoot + "/", "")}: ${key}`;
        if (!enKeys.has(key)) missing.push(`${where} (en)`);
        if (!arKeys.has(key)) missing.push(`${where} (ar)`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("R18-02: dynamic onboarding step keys resolve for every step in both locales", () => {
    for (const step of [
      "welcome",
      "company",
      "accounts",
      "invoice",
      "receipt",
      "reports",
      "ai",
      "reminders",
    ]) {
      for (const part of ["title", "description", "action"]) {
        expect(t.en[`onboarding.step.${step}.${part}`], `en ${step}.${part}`).toBeTruthy();
        expect(t.ar[`onboarding.step.${step}.${part}`], `ar ${step}.${part}`).toBeTruthy();
      }
    }
  });

  it("R18-02: formatMessage interpolates so mixed-order strings keep Arabic word order", () => {
    expect(formatMessage(t.en["onboarding.completedCount"], { done: 0, total: 8 })).toBe(
      "0/8 completed"
    );
    expect(formatMessage(t.ar["onboarding.completedCount"], { done: 0, total: 8 })).toBe(
      "اكتمل 0 من 8"
    );
    expect(formatMessage("{a} {missing}", { a: 1 })).toBe("1 {missing}");
  });
});

describe("i18n hard-coded string ratchet", () => {
  it("R18-02: hard-coded JSX strings under client/src/pages never exceed the committed baseline", () => {
    const baseline = JSON.parse(
      readFileSync(join(repoRoot, "scripts", "guard-baselines", "i18n.json"), "utf8")
    ) as { maxHardcoded: number };
    const { hardcoded } = scanPages();
    expect(hardcoded).toBeLessThanOrEqual(baseline.maxHardcoded);
  });

  it("S9: shared components have no hard-coded JSX strings and a real Arabic components catalog", () => {
    const { hardcoded, perFile } = scanComponents();
    expect(perFile).toEqual({});
    expect(hardcoded).toBe(0);
    const baseline = JSON.parse(
      readFileSync(join(repoRoot, "scripts", "guard-baselines", "i18n.json"), "utf8")
    ) as { maxHardcoded: number };
    expect(baseline.maxHardcoded).toBe(0);
    const components = loadNamespaces("ar").components;
    expect(Object.keys(components).length).toBeGreaterThan(50);
    for (const [key, value] of Object.entries(components)) {
      expect(value, `ar ${key} must be Arabic script`).toMatch(/[\u0600-\u06FF]/);
    }
  });

  it("R15-17: firm workspace pages have their visible copy translated through the pages catalog", () => {
    for (const file of [
      "client/src/pages/firm/ClientPortfolio.tsx",
      "client/src/pages/FirmCommandCenter.tsx",
      "client/src/pages/firm/StaffManagement.tsx",
    ]) {
      expect(readFileSync(join(repoRoot, file), "utf8"), file).toContain('<T k="pages.');
    }
  });
});
