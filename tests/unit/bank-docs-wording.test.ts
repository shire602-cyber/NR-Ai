import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { findBankLaunchClaim } from "../e2e/lib/bank-launch-wording.mjs";

// Documentation and example comments have no rendered app entry point. Search their sources,
// including old QA reports and audits, because their text is still read as launch guidance.
const docs = readdirSync("docs", { recursive: true })
  .filter((file) => /\.(?:md|json)$/u.test(file))
  .map((file) => path.join("docs", file))
  .sort();
const examples = [".env.example", "deploy/backup.env.example"];
const reportScripts = [
  "tests/e2e/benchmark-audit.mjs",
  "docs/archive/teardown-evidence/harness.mjs",
];

function findJsonClaim(source: string) {
  let claim: string | undefined;
  JSON.parse(source, (_key, value: unknown) => {
    if (typeof value === "string") claim ??= findBankLaunchClaim(value);
    return value;
  });
  return claim;
}

describe("CSV-only banking wording", () => {
  // Assemble the negative fixtures that would otherwise trigger the tracked-source scan.
  it.each([
    "Open banking support",
    "Open-Banking",
    "open‑banking",
    ["live", "BANK-FEEDS"].join(" "),
    "bank feeds",
    "Bank-feed integration",
    "Bank account connections",
    ["Bank", "feeds will be available later"].join(" "),
    "Banking: coming soon",
    "Banking: coming\nsoon",
    "Banking\r\ncoming soon",
    "Banking will become\navailable later",
    "Coming soon\nBanking",
    "Banking\nThis service will be available later",
    "A live feed for your bank",
    "الخدمات المصرفية المفتوحة",
    "خدمات مصرفية مفتوحة",
    "الربط البَنكيّ",
    "الربط المصرفي المباشر",
    "تغذية بنكية مباشرة",
    "ربط الحسابات مع المصارف",
    "مزامنة المعاملات المصرفية",
    "البنك: تتوفر الميزة لاحقًا",
    "البنك:\nتتوفر الميزة لاحقًا",
    "البنك\nتتوفر الميزة\nلاحقاً",
    "قريبًا\nالخدمات المصرفية",
    "قريباً تتوفّر الميزة للبنوك",
    "يمكن استخدام هذه الخدمة المصرفية لاحقاً",
  ])("detects retired claims in %s", (copy) => {
    expect(findBankLaunchClaim(copy)).toBeTruthy();
  });

  it.each([
    "Upload a CSV exported from your bank.",
    "Bank reconciliation is available. WhatsApp is coming soon.",
    "Bank reconciliation\nWhatsApp is coming soon",
    "Coming soon for payroll\nBank reconciliation",
    "Bank reconciliation\n\nComing soon",
    "Banking.\nComing soon",
    "Bank reconciliation\n" + "more details ".repeat(6) + "\navailable later",
    "A live feed of regulatory news is available.",
    "The open-bankingWebhook example is a code identifier.",
    "BANK_FEED_REDIRECT_URIS=https://app.example.com/bank-feeds/callback",
    "Configuration ID bank_feed_lean is an internal diagnostic.",
    "GET /api/bank/providers and POST /api/companies/:id/bank-connections/callback",
    "The old `/bank-feeds` route redirects to CSV upload.",
    "مسار رفع كشف الحساب البنكي بصيغة CSV",
    "أضف شعار شركتك لاحقًا.",
    "سيتوفر تطبيق الهاتف قريبًا.",
    "استورد كشف الحساب البنكي. يمكنك ربط واتساب لاحقًا.",
    "انتقل إلى التسوية البنكية\nخيارات التصميم متاحة لاحقا",
    "تتوفر ميزة الهاتف قريباً\nالتسوية البنكية",
    "التسوية البنكية\n\nلاحقًا",
  ])("allows CSV guidance, technical references and unrelated launch timing in %s", (copy) => {
    expect(findBankLaunchClaim(copy)).toBeUndefined();
  });

  it("checks decoded copy from a captured QA screen", () => {
    const capture = JSON.stringify({ body: "Home\nBank-feed dashboard\nReports" });
    expect(findJsonClaim(capture)).toBe("Bank-feed");
  });

  it("keeps documentation, example config and QA report sources free of retired claims", () => {
    const violations = [...docs, ...examples, ...reportScripts].flatMap((file) => {
      const source = readFileSync(file, "utf8");
      const claim = file.endsWith(".json") ? findJsonClaim(source) : findBankLaunchClaim(source);
      return claim ? [`${file}: ${claim}`] : [];
    });

    expect(violations).toEqual([]);
  });
});
