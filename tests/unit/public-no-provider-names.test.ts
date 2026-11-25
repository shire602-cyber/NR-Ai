// Source scan on purpose: public pages (marketing site, pricing, help, trust, legal, auth screens,
// static public assets) must never name an e-invoicing provider (ASP). Owner rule, EN and AR.
// Logged-in screens (settings, e-invoicing setup) are excluded and may keep the provider choice.
// When a new provider is integrated, add its Latin and Arabic spellings to PROVIDER_PATTERNS.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..");

// Dashes, spaces, dots and zero-width / soft-hyphen characters between word parts.
const SEP = "[\\s\\-\\u2010-\\u2015\\u00ad\\u200b-\\u200d\\u2060._]*";
const PROVIDER_PATTERNS: RegExp[] = [
  new RegExp(`\\ba${SEP}cube\\b`, "i"),
  /complyance/i,
  new RegExp(`\\bbee${SEP}aura\\b`, "i"),
  /كيوب/,
  /ك[وُ]?مبل[اآ]ي?[اآ]?نس|ك[وُ]?مبل[اآ]ي?نز/,
  /بي\s*[اأإآ]?ورا|بيئورا/,
];

export function namesProvider(text: string): RegExp | undefined {
  const normalized = text.normalize("NFKC");
  return PROVIDER_PATTERNS.find((re) => re.test(normalized));
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

const PUBLIC_PAGES = [
  "Pricing", "Services", "DemoWorkspace", "HelpCenter", "TrustSecurity", "MigrationGuides",
  "PrivacyPolicy", "TermsOfService", "CookiePolicy", "Login", "Register", "ForgotPassword",
  "ResetPassword",
];

const files = [
  ...walk(join(ROOT, "client/src/components/marketing")),
  ...["en", "ar"].flatMap((l) =>
    readdirSync(join(ROOT, "client/src/locales", l))
      .filter((f) => /^marketing.*\.json$/.test(f))
      .map((f) => join(ROOT, "client/src/locales", l, f))
  ),
  ...PUBLIC_PAGES.map((p) => join(ROOT, "client/src/pages", `${p}.tsx`)).filter(existsSync),
  ...walk(join(ROOT, "client/public")),
  join(ROOT, "client/index.html"),
  join(ROOT, "client/src/PublicApp.tsx"),
].filter((f) => /\.(tsx?|jsx?|json|css|html|txt|xml|md|webmanifest)$/.test(f));

describe("public site names no e-invoicing provider", () => {
  it("covers marketing, pricing, help, trust and public assets", () => {
    const rel = files.map((f) => f.slice(ROOT.length + 1).replace(/\\/g, "/"));
    expect(rel).toContain("client/src/pages/Pricing.tsx");
    expect(rel).toContain("client/src/pages/HelpCenter.tsx");
    expect(rel).toContain("client/src/pages/TrustSecurity.tsx");
    expect(rel).toContain("client/index.html");
    expect(rel.some((f) => f.startsWith("client/public/"))).toBe(true);
    expect(rel.some((f) => f.startsWith("client/src/locales/ar/marketing"))).toBe(true);
    expect(files.length).toBeGreaterThan(20);
  });

  it.each([
    "A-Cube", "ACube", "A Cube", "A\u2011Cube", "A\u200bCube", "Complyance", "COMPLYANCE",
    "Bee Aura", "BeeAura", "bee-aura", "\u0623\u0643\u064a\u0648\u0628", "\u0625\u064a \u0643\u064a\u0648\u0628",
    "\u0622\u064a \u0643\u064a\u0648\u0628", "\u0643\u0648\u0645\u0628\u0644\u0627\u064a\u0646\u0633",
    "\u0628\u064a \u0623\u0648\u0631\u0627",
  ])("guard catches %s", (name) => {
    expect(namesProvider(`Works with ${name} for e-invoicing`)).toBeDefined();
  });

  it("does not flag neutral copy", () => {
    expect(namesProvider("Delivered through an accredited service provider. Compliance built in.")).toBeUndefined();
    expect(namesProvider("\u0648\u062a\u062a\u0645 \u0639\u0628\u0631 \u0645\u0632\u0648\u0651\u062f \u062e\u062f\u0645\u0629 \u0645\u0639\u062a\u0645\u062f")).toBeUndefined();
  });

  it.each(files.map((f) => [f.slice(ROOT.length + 1), f]))("%s", (_n, f) => {
    const hit = namesProvider(readFileSync(f, "utf8"));
    expect(hit, `provider name matched ${hit}`).toBeUndefined();
  });
});