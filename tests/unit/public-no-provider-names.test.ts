// Source scan on purpose: public pages (marketing site, pricing, help, trust, legal, auth screens,
// static public assets incl. the sample invoice PDF) must never name our e-invoicing delivery
// providers. Owner rule, EN and AR. Logged-in screens (settings, e-invoicing setup) are excluded
// and may keep the provider choice. When a new delivery provider is integrated, add its Latin and
// Arabic spellings to PROVIDER_PATTERNS.
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
  /\u0643\u064a\u0648\u0628/, // kyub (A-Cube)
  /\u0643\u0648?\u0645\u0628\u0644[\u0627\u0622]?\u064a?[\u0627\u0622]?\u0646[\u0633\u0632]/, // komblayans (Complyance)
  new RegExp(`\\u0628\\u064a${SEP}[\\u0627\\u0623\\u0625\\u0622]?\\u0648\\u0631\\u0627|\\u0628\\u064a\\u0626\\u0648\\u0631\\u0627`), // bee aura
];

// NFKC, then drop Arabic diacritics and tatweel so vowel marks cannot hide a name.
export function namesProvider(text: string): RegExp | undefined {
  const normalized = text.normalize("NFKC").replace(/[\u064b-\u065f\u0670\u0640]/g, "");
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

const all = [
  ...walk(join(ROOT, "client/src/components/marketing")),
  ...["en", "ar"].flatMap((l) =>
    readdirSync(join(ROOT, "client/src/locales", l))
      .filter((f) => /^marketing.*\.json$/.test(f))
      .map((f) => join(ROOT, "client/src/locales", l, f))
  ),
  ...PUBLIC_PAGES.map((p) => join(ROOT, "client/src/pages", `${p}.tsx`)).filter(existsSync),
  ...walk(join(ROOT, "client/src/pages/legal")),
  ...walk(join(ROOT, "client/public")),
  join(ROOT, "client/index.html"),
  join(ROOT, "client/src/PublicApp.tsx"),
];
const files = all.filter((f) => /\.(tsx?|jsx?|json|css|html|txt|xml|md|webmanifest)$/.test(f));
const pdfs = all.filter((f) => f.endsWith(".pdf"));
const rel = (f: string) => f.slice(ROOT.length + 1).replace(/\\/g, "/");

describe("public site names no e-invoicing provider", () => {
  it("covers marketing, pricing, help, trust, legal and public assets", () => {
    const r = all.map(rel);
    for (const f of [
      "client/src/pages/Pricing.tsx",
      "client/src/pages/HelpCenter.tsx",
      "client/src/pages/TrustSecurity.tsx",
      "client/src/pages/legal/legalAr.tsx",
      "client/public/samples/muhasib-sample-invoice.pdf",
      "client/index.html",
    ]) {
      expect(r).toContain(f);
    }
    expect(r.some((f) => f.startsWith("client/src/locales/ar/marketing"))).toBe(true);
    expect(files.length).toBeGreaterThan(20);
  });

  it.each([
    "A-Cube", "ACube", "A Cube", "A\u2011Cube", "A\u200bCube", "Complyance", "COMPLYANCE",
    "Bee Aura", "BeeAura", "bee-aura",
    "\u0623\u0643\u064a\u0648\u0628", // akyub
    "\u0625\u064a \u0643\u064a\u0648\u0628", // ii kyub
    "\u0622\u064a \u0643\u064a\u064f\u0648\u0628", // aay kyub with damma
    "\u0643\u0648\u0645\u0628\u0644\u0627\u064a\u0646\u0633", // komblayns
    "\u0643\u0648\u0645\u0628\u0644\u064a\u0627\u0646\u0633", // kombliyans
    "\u0628\u064a \u0623\u0648\u0631\u0627", // bi awra
    "\u0628\u064a-\u0623\u0648\u0631\u0627", // bi-awra
  ])("guard catches %s", (name) => {
    expect(namesProvider(`Works with ${name} for e-invoicing`)).toBeDefined();
  });

  it("does not flag neutral copy", () => {
    expect(namesProvider("Delivered through an accredited service provider. Compliance built in.")).toBeUndefined();
    expect(
      namesProvider("\u0648\u062a\u062a\u0645 \u0639\u0628\u0631 \u0645\u0632\u0648\u0651\u062f \u062e\u062f\u0645\u0629 \u0645\u0639\u062a\u0645\u062f")
    ).toBeUndefined();
  });

  it.each(files.map((f) => [rel(f), f]))("%s", (_n, f) => {
    const hit = namesProvider(readFileSync(f, "utf8"));
    expect(hit, `provider name matched ${hit}`).toBeUndefined();
  });

  it.each(pdfs.map((f) => [rel(f), f]))("pdf text %s", async (_n, f) => {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const doc = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(f)), useSystemFonts: true }).promise;
    let text = "";
    for (let i = 1; i <= doc.numPages; i++) {
      const content = await (await doc.getPage(i)).getTextContent();
      text += content.items.map((item) => ("str" in item ? item.str : "")).join(" ");
    }
    expect(text.length).toBeGreaterThan(100);
    const hit = namesProvider(text);
    expect(hit, `provider name matched ${hit}`).toBeUndefined();
  });
});