// Source inspection is intentional: this is a guard over ALL public marketing copy (the string
// values of the EN and AR marketing catalogs and the source of every file under
// client/src/components/marketing/). Much of that copy never renders on a single route (feature
// flags, legacy tuples, other pages, comments that become copy later), so a render-based test
// cannot cover it. It pins the hard rules in docs/site-rebuild/REBUILD-BRIEF.md section 0: no
// ZATCA/Saudi/KSA references, no claims of a direct bank connection, and no named e-invoicing providers.
// Scope: every marketing*.json catalog (EN and AR), the marketing components, and the public
// pages that live outside that folder (trust, privacy, terms, cookies, pricing, landing,
// services, migration guides, e-invoicing hub and compare pages).
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();

const BANNED: { label: string; pattern: RegExp }[] = [
  { label: "ZATCA", pattern: /ZATCA/i },
  { label: "Saudi", pattern: /Saudi/i },
  { label: "KSA", pattern: /\bKSA\b/i },
  { label: "bank feed", pattern: /bank feed/i },
  { label: "live bank", pattern: /live bank/i },
  { label: "connect your bank", pattern: /connect your bank/i },
  { label: "bank feeds", pattern: /bank[\s-]+feeds?/i },
  { label: "bank sync", pattern: /bank sync/i },
  { label: "direct filing", pattern: /direct filing/i },
  { label: "A-Cube", pattern: /A-Cube/i },
  { label: "ACube", pattern: /ACube/i },
  { label: "A Cube", pattern: /A Cube/i },
  { label: "Complyance", pattern: /Complyance/i },
  { label: "زاتكا", pattern: /زاتكا/ },
  { label: "السعودية", pattern: /السعودية/ },
  { label: "السعودي", pattern: /السعودي/ },
  { label: "هيئة الزكاة", pattern: /هيئة الزكاة/ },
  { label: "كومبليانس", pattern: /كومبليانس/ },
  { label: "كومبلاينس", pattern: /كومبلاينس/ },
  { label: "إيه كيوب", pattern: /إيه كيوب/ },
  { label: "أيه كيوب", pattern: /أيه كيوب/ },
  { label: "اي كيوب", pattern: /اي كيوب/ },
  { label: "ربط حسابك البنكي", pattern: /ربط حسابك البنكي/ },
  { label: "ربط البنك", pattern: /ربط البنك/ },
];

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

function hits(text: string): string[] {
  return BANNED.filter(({ pattern }) => pattern.test(text)).map(({ label }) => label);
}

/** Public pages outside client/src/components/marketing (their copy ships to anonymous visitors). */
const PUBLIC_PAGE_FILES = [
  "TrustSecurity",
  "PrivacyPolicy",
  "TermsOfService",
  "CookiePolicy",
  "Pricing",
  "MuhasibLanding",
  "Services",
  "MigrationGuides",
  "legal/legalAr",
].map((name) => `client/src/pages/${name}.tsx`);

function marketingCatalogs(locale: string): string[] {
  return readdirSync(join(repoRoot, `client/src/locales/${locale}`)).filter((name) =>
    /^marketing[A-Za-z]*\.json$/.test(name)
  );
}

describe("marketing copy guard", () => {
  it.each(["en", "ar"] as const)(
    "every %s marketing*.json catalog value carries no banned claims",
    (locale) => {
      const names = marketingCatalogs(locale);
      // marketing.json, marketingHome.json and marketingMeta.json at least.
      expect(names.length).toBeGreaterThanOrEqual(3);
      const offenders = names.flatMap((name) => {
        const catalog = JSON.parse(
          readFileSync(join(repoRoot, `client/src/locales/${locale}/${name}`), "utf8")
        ) as Record<string, string>;
        return Object.entries(catalog).flatMap(([key, value]) =>
          hits(value).map((label) => `${name} ${key}: ${label}`)
        );
      });
      expect(offenders).toEqual([]);
    }
  );

  it("public pages outside the marketing folder carry no banned claims", () => {
    const offenders = PUBLIC_PAGE_FILES.flatMap((file) =>
      hits(readFileSync(join(repoRoot, file), "utf8")).map((label) => `${file}: ${label}`)
    );
    expect(offenders).toEqual([]);
  });

  it("marketing components (ts, tsx, css) carry no banned claims", () => {
    const files = walk(join(repoRoot, "client/src/components/marketing")).filter((file) =>
      /\.(tsx?|css)$/.test(file)
    );
    expect(files.length).toBeGreaterThan(0);
    const offenders = files.flatMap((file) =>
      hits(readFileSync(file, "utf8")).map((label) => `${file.replace(repoRoot, "")}: ${label}`)
    );
    expect(offenders).toEqual([]);
  });
});
