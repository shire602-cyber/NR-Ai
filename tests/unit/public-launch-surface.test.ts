import { execFileSync } from "node:child_process";
// Source inspection is intentional: this is the unsupported-claims guard for public marketing,
// legal and help copy. It scans the shipped source/catalog text for banned compliance and security
// claims across pages that cannot all be rendered without API data.
import { readdirSync, readFileSync } from "node:fs";
import { readDashboardSource } from "./dashboardSource";
import { join } from "node:path";
import { DOMParser } from "@xmldom/xmldom";
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { findBankFeedMention, findUnsupportedBankFeedClaim } from "../e2e/lib/bank-feed-claims.mjs";
import { BANK_RECONCILIATION_COPY } from "../../shared/bank-reconciliation-copy";
import { pdfToText } from "./pdf-test-helpers";
import { unsupportedStatementCopy } from "../helpers/statement-copy.mjs";

const repoRoot = process.cwd();

function readRepoFile(path: string): string {
  return readFileSync(join(repoRoot, path), "utf8");
}

// S6a: page copy moved into the en catalogs; text assertions accept source or catalog copy.
// D1b: the public pages' body copy lives in the marketing catalog (en + ar).
function readRepoFileWithCatalog(path: string): string {
  return [
    readRepoFile(path),
    readRepoFile("client/src/locales/en/pageLabels.json"),
    readRepoFile("client/src/locales/en/marketing.json"),
  ].join("\n");
}

const publicLaunchFiles = [
  "client/index.html",
  "client/src/components/marketing/phase/PhaseSite.tsx",
  "client/src/components/marketing/phase/content.ts",
  "client/src/components/marketing/phase/Forms.tsx",
  "client/src/components/marketing/phase/editorial/pages.ts",
  "client/src/components/marketing/phase/editorial/details.ts",
  "client/src/components/auth/AuthLayout.tsx",
  "client/src/dev/UiGallery.tsx",
  "client/src/pages/Register.tsx",
  "client/src/pages/Services.tsx",
  "client/src/pages/Pricing.tsx",
  "client/src/pages/Subscription.tsx",
  "client/src/pages/VATFiling.tsx",
  "client/src/pages/PrivacyPolicy.tsx",
  "client/src/pages/TrustSecurity.tsx",
  "client/src/pages/HelpCenter.tsx",
  "client/src/pages/MigrationGuides.tsx",
  "client/src/pages/DemoWorkspace.tsx",
  // D1b: public page copy (landing, help, trust, migration, demo) is catalog-driven.
  "client/src/locales/en/marketing.json",
  "client/src/locales/ar/marketing.json",
];

const bannedLaunchClaims = [
  /FTA-compliant/i,
  /FTA Compliant/i,
  /FTA Registered/i,
  /FTA[-\s]?registered/i,
  /UAE-compliant/i,
  /VAT-compliant/i,
  /bank-grade/i,
  /bank-level/i,
  /SLA guarantee/i,
  /SLA-backed/i,
  /24\/7 support/i,
  /direct EmaraTax/i,
  /FTA[-\s]?native/i,
  /FTA VAT 201 filing/i,
  /VAT 201 filing/i,
  /Pre-filed/i,
  /FTA · Live/i,
  /FTA filing/i,
  /FTA Accredited/i,
  /Generate and submit/i,
  /No manual entry/i,
  /Let AI Do the Rest/i,
  /all data automatically/i,
  /reports generated automatically/i,
  /Untouched/i,
  /Securely link your.*bank account/i,
  /via encrypted feeds/i,
  /\blive\s+bank\s+feeds?\b/i,
  /الربط\s+البنكي\s+المباشر/,
  /accredited provider (?:per deployment|configured for your deployment)/i,
  /لكل\s+نسخة\s+من\s+التطبيق/,
  /Photo,\s+email\s+forward,\s+or\s+bank\s+feed/i,
  /sync a bank line/i,
  unsupportedStatementCopy,
  /compliant with FTA/i,
  /SOC 2 Type II/i,
  /Trusted by 500\+ UAE businesses/i,
  /Join 500\+ UAE businesses/i,
  /500\+ UAE businesses/i,
  /UAE businesses on Muhasib/i,
  /hundreds of UAE businesses/i,
  /In VAT filed last quarter/i,
  /AI categorisation accuracy/i,
  /AI categorization accuracy/i,
  /99(?:\.8)?%/i,
  /99%\+/i,
  /95%\+/i,
  /50,000\+/i,
  /87%/i,
  /98%/i,
  /25\+\s*hours/i,
  /20\+\s*hours/i,
  /filings meet every regulatory requirement/i,
];

describe("Public SaaS launch surface", () => {
  it("describes CSV import in both copies of the archived roadmap", async () => {
    // Read the document contents because the Word and PDF assets are shipped as binaries.
    const roadmap = join(
      repoRoot,
      "docs/archive/root/Muhasib-Netmara-Audit-and-Competitive-Roadmap"
    );
    const word = await JSZip.loadAsync(readFileSync(`${roadmap}.docx`));
    const xml = await word.file("word/document.xml")!.async("string");
    const document = new DOMParser().parseFromString(xml, "application/xml");
    const wordText = Array.from(document.getElementsByTagName("w:p"), (p) => p.textContent).join(
      "\n"
    );

    const pdfText = await pdfToText(readFileSync(`${roadmap}.pdf`));
    for (const [format, text] of [
      ["Word", wordText],
      ["PDF", pdfText],
    ]) {
      const words = text.replace(/\s+/g, " ");
      expect(words.includes(BANK_RECONCILIATION_COPY.en), format).toBe(true);
      expect(/\bbank\s+feeds?\b|\bopen\s+banking\b/i.test(words), format).toBe(false);
    }
  });

  it("keeps obsolete receipt and banking wording out of the catalogs and intake copy", () => {
    for (const locale of ["en", "ar"]) {
      const forms = JSON.parse(readRepoFile(`client/src/locales/${locale}/forms.json`));
      expect(forms).not.toHaveProperty(["forms.claim.receiptUrlHint"]);
      const pageLabels = JSON.parse(readRepoFile(`client/src/locales/${locale}/pageLabels.json`));
      expect(pageLabels, locale).not.toHaveProperty([
        "pageLabels.automaticTransactionImportEliminatesManualDataEntry",
      ]);
      const banking = JSON.parse(readRepoFile(`client/src/locales/${locale}/banking.json`));
      const toasts = JSON.parse(readRepoFile(`client/src/locales/${locale}/toasts.json`));
      expect(banking).not.toHaveProperty(["banking.rulesDescription"]);
      expect(banking["banking.rulesCreateDesc"]).toContain("CSV");
      expect(toasts).not.toHaveProperty(["toasts.newsletterFeatureWillBeAvailableSoonConfigure"]);
    }
    expect(readRepoFile("server/services/email-intake.ts")).not.toMatch(/\bbank\s+feeds?\b/i);
    expect(readRepoFile("shared/server-copy.ts")).not.toMatch(/\bReconnect it under Banking\b/i);
  });

  it("keeps the core launch, auth, and legal pages publicly routable", () => {
    const appSource = readRepoFile("client/src/App.tsx");

    for (const path of [
      "/register",
      "/login",
      "/forgot-password",
      "/trust",
      "/help",
      "/migration-guides",
      "/demo",
      "/privacy",
      "/terms",
      "/cookies",
    ]) {
      expect(appSource, `${path} should be included in the public-route gate`).toContain(
        `pathname === "${path}"`
      );
      expect(appSource, `${path} should have a public route`).toContain(
        `<Route path="${path}" component=`
      );
    }
  });

  it("keeps launch SEO metadata claim-safe and buyer-oriented", () => {
    const indexSource = readRepoFile("client/index.html");

    expect(indexSource).toContain("AI-Assisted Accounting Software for UAE SMEs");
    expect(indexSource).toContain("VAT workflows");
    expect(indexSource).toContain("guided onboarding for launch customers");

    for (const bannedClaim of bannedLaunchClaims) {
      expect(indexSource).not.toMatch(bannedClaim);
    }
  });

  it("does not reintroduce unsupported public compliance or security claims", () => {
    for (const file of publicLaunchFiles) {
      const source = readRepoFile(file);
      for (const bannedClaim of [...bannedLaunchClaims, /\bbank\s+feeds?\b/i]) {
        expect(source, `${file} contains ${bannedClaim}`).not.toMatch(bannedClaim);
      }
      expect(
        findBankFeedMention(source),
        `${file} contains an unsupported banking claim`
      ).toBeNull();
    }
  });

  it("documents a CSV upload and removes the retired transaction setting from both catalogs", () => {
    // The archived teardown and unused catalog entries have no runtime surface to render.
    const teardown = readRepoFile("docs/archive/root/Muhasib-Teardown-2026-08-07.md");
    expect(teardown).toContain(BANK_RECONCILIATION_COPY.en);
    expect(teardown).not.toMatch(/add (?:direct )?bank \w+ later/i);
    for (const locale of ["en", "ar"]) {
      const labels = JSON.parse(readRepoFile(`client/src/locales/${locale}/pageLabels.json`));
      expect(labels).not.toHaveProperty(["pageLabels.syncNewTransactionsEveryHour"]);
      const prefix = `client/src/locales/${locale}`;
      const onboarding = JSON.parse(readRepoFile(`${prefix}/onboarding.json`));
      expect(onboarding).not.toHaveProperty(["onboarding.bankConnectedDescription"]);
      const keys = [
        ["marketing", "marketing.faq3A"],
        ["banking", "banking.emptyTransactionsDescription"],
        ["serverErrors", "serverErrors.BANK_FEED_NOT_CONFIGURED"],
      ];
      for (const [catalog, key] of keys) {
        const source = JSON.parse(readRepoFile(`${prefix}/${catalog}.json`));
        expect(source[key], `${locale} ${key}`).toMatch(/CSV/);
      }
    }
  });

  it("omits future-feature wording from toast catalogs and release notes", () => {
    const obsoleteToast = "toasts.newsletterFeatureWillBeAvailableSoonConfigure";
    const futureClaims = [
      /\bcoming\s+soon\b/i,
      /\bwill\s+be\s+available\s+soon\b/i,
      /ستتوفر[^.\n]*قريب/,
    ];
    for (const locale of ["en", "ar"]) {
      const path = `client/src/locales/${locale}/toasts.json`;
      const catalog: Record<string, string> = JSON.parse(readRepoFile(path));
      expect(catalog).not.toHaveProperty([obsoleteToast]);
      for (const claim of futureClaims) {
        expect(Object.values(catalog).join("\n"), path).not.toMatch(claim);
      }
    }
    const releaseNotes = "docs/release/SUPERSEDED-PRS.md";
    for (const claim of futureClaims) {
      expect(readRepoFile(releaseNotes), releaseNotes).not.toMatch(claim);
    }
  });

  it("omits unsupported banking claims from tracked source and documentation", () => {
    const claims = [
      /\blive[\s-]*bank[\s-]*feeds?\b/i,
      /\bautomatic\s+bank\s+transaction\s+sync\b/i,
      /\bbank[\s-]+feeds?\b[^\n.]{0,60}\b(?:coming|later|soon)\b/i,
      /\bbank\s+account\s+is\s+(?:already\s+)?connected\b/i,
      /حسابك\s+البنكي\s+(?:مرتبط|متصل)/,
      /الربط\s+البنكي\s+المباشر|(?:الربط|المزامنة)\s+البنكي(?:ة)?[^\n.]{0,60}(?:قريب|لاحق)/,
    ];
    const files = execFileSync("git", ["ls-files", "-z"], { cwd: repoRoot, encoding: "utf8" })
      .split("\0")
      .filter((file) => /\.(?:md|tsx?|json|mjs|cjs|js|html|txt|ya?ml|sql)$/i.test(file));
    const matches = files.flatMap((file) => {
      const source = readRepoFile(file);
      const rules = [...claims];
      if (file.startsWith("client/src/locales/")) {
        rules.push(/\bbank\s+feeds?\b|الربط\s+البنكي/i);
      }
      if (file.startsWith("migrations/") || file.endsWith("/benchmark-run.json")) {
        rules.push(/\bcoming\s+soon\b/i, /الرفع\s+قريب/);
      }
      return rules.flatMap((rule) => {
        const match = rule.exec(source);
        return match ? [`${file}:${source.slice(0, match.index).split("\n").length}`] : [];
      });
    });
    expect(matches).toEqual([]);
  });

  it("keeps authenticated SaaS chrome and dashboard copy claim-safe", () => {
    const appSource = readRepoFile("client/src/App.tsx");
    const dashboardSource = readDashboardSource();
    // WQ7 (3.4): the floating tour (components/Onboarding.tsx) was retired and deleted.
    const onboardingPageSource = readRepoFile("client/src/pages/Onboarding.tsx");

    // D2b (CTO checkpoint 10): the "UAE Tax Ready" top-bar chip implied a certification and
    // was removed from the authenticated chrome and its catalog.
    const shellCatalog = readRepoFile("client/src/locales/en/shell.json");
    expect(appSource).not.toContain("shell.uaeTaxReady");
    expect(shellCatalog).not.toContain("UAE Tax Ready");
    for (const [file, source] of [
      ["client/src/locales/en/shell.json", shellCatalog],
      [
        "client/src/locales/en/onboarding.json",
        readRepoFile("client/src/locales/en/onboarding.json"),
      ],
      [
        "client/src/locales/en/dashboard.json",
        readRepoFile("client/src/locales/en/dashboard.json"),
      ],
      ["client/src/App.tsx", appSource],
      ["client/src/pages/Dashboard.tsx", dashboardSource],
      ["client/src/pages/Onboarding.tsx", onboardingPageSource],
    ] as const) {
      for (const bannedClaim of bannedLaunchClaims) {
        expect(source, `${file} contains ${bannedClaim}`).not.toMatch(bannedClaim);
      }
      expect(
        findUnsupportedBankFeedClaim(source),
        `${file} contains an unsupported banking claim`
      ).toBeNull();
    }
  });

  it("keeps certification and SLA language explicitly truthful", () => {
    // S6a/S6b: page copy moved into the pageLabels catalog; page source plus catalog is the claim surface.
    const trustSource = readRepoFileWithCatalog("client/src/pages/TrustSecurity.tsx");
    const helpSource = readRepoFileWithCatalog("client/src/pages/HelpCenter.tsx");
    const pricingSource = readRepoFileWithCatalog("client/src/pages/Pricing.tsx");

    expect(trustSource).toMatch(
      /We do not\s+claim SOC 2, ISO 27001, or FTA accreditation until those reviews are complete\./
    );
    expect(trustSource).toContain("External certifications are roadmap items, not current claims.");
    expect(trustSource).toContain("Backup and restore proof");
    expect(trustSource).toContain("Incident process");
    expect(trustSource).toContain("Privacy and DPA posture");
    expect(helpSource).toContain("Support and SLA posture");
    expect(pricingSource).toContain("Enterprise support terms");
  });

  it("keeps the trust, help and services pages customer-facing (R3, CTO 8/9)", () => {
    const trustPage = readRepoFile("client/src/pages/TrustSecurity.tsx");
    const helpPage = readRepoFile("client/src/pages/HelpCenter.tsx");
    const servicesPage = readRepoFile("client/src/pages/Services.tsx");
    const en = JSON.parse(readRepoFile("client/src/locales/en/marketing.json")) as Record<
      string,
      string
    >;

    // Internal release-gate / CI notes are not customer copy.
    for (const key of [
      "pageLabels.launchPosture",
      "pageLabels.launchVerificationEvidence",
      "pageLabels.internalReleaseGate",
      "marketing.trustPosture",
      "marketing.trustEvidence",
    ]) {
      expect(trustPage, `trust page still renders ${key}`).not.toContain(key);
    }
    // Leads with customer controls, then who operates the service and how to reach them.
    expect(trustPage.indexOf("trustControlsTitle")).toBeLessThan(
      trustPage.indexOf("trustWhoTitle")
    );
    for (const id of ["trust-data-residency", "trust-support-contact"]) {
      expect(trustPage).toContain(id);
    }
    expect(trustPage).toContain("MARKETING_BRAND.supportEmail");
    // Owner-confirmed facts (T1): operator name, UAE hosting, named support contact, services terms.
    const ar = JSON.parse(readRepoFile("client/src/locales/ar/marketing.json")) as Record<
      string,
      string
    >;
    expect(en["marketing.trustOperatorBody"]).toContain(
      "Najma Al Raeda Accounting and Bookkeeping"
    );
    expect(ar["marketing.trustOperatorBody"]).toContain("نجمة الرائدة للمحاسبة ومسك الدفاتر");
    expect(JSON.stringify(en)).not.toContain("Accounting LLC");
    expect(en["marketing.trustResidencyBody"]).toContain(
      "Customer data is hosted in the United Arab Emirates."
    );
    expect(ar["marketing.trustResidencyBody"]).toContain("الإمارات العربية المتحدة");
    expect(en["marketing.trustSupportContact"]).toContain("Sara, customer support");
    expect(ar["marketing.trustSupportContact"]).toContain("سارة");
    expect(en["marketing.svcFact1"]).toContain("Licensed since 2017");
    expect(en["marketing.svcFact4"]).toMatch(/Free consultation, no commitment/);
    expect(en["marketing.svcFact5"]).toMatch(/within 24 hours/);
    expect(ar["marketing.svcFact4"]).toContain("مجانية");
    expect(ar["marketing.svcFact5"]).toContain("24");
    // The services page (positive marketing claims) carries no certification claims or invented
    // social proof; the trust page names certifications only as "not claimed" roadmap items.
    const svcCopy = JSON.stringify(
      Object.fromEntries(Object.entries(en).filter(([k]) => k.startsWith("marketing.svc")))
    );
    for (const banned of [
      /ISO\s?27001/i,
      /SOC\s?2/i,
      /FTA[- ]accredited/i,
      /\d+\s?\+?\s?(customers|users)/i,
    ]) {
      expect(svcCopy).not.toMatch(banned);
    }
    expect(en["marketing.trustAuditTitle"]).toBe("Hash-chained audit log");
    expect(en["marketing.trustControl3Title"]).toBe("Two-factor authentication");

    // Help: customer hero, brand casing.
    expect(helpPage).not.toContain("launchSupportForUAEAccountingTeamsMovingFast");
    expect(JSON.stringify(en)).not.toMatch(/\bmazeed\b/);

    // Services: rebuilt on the home section system, no roadmap or hype blocks.
    expect(servicesPage).toContain("@/components/marketing/Sections");
    for (const banned of [
      ["Coming", "Soon"].join(" "),
      "Voice Commands",
      "AI CFO",
      "Powered by AI",
      "Cutting-edge",
    ]) {
      expect(servicesPage).not.toContain(banned);
      expect(JSON.stringify(en)).not.toContain(banned);
    }
    expect(servicesPage).toContain('data-testid="button-book-consultation"');
  });

  it("exposes customer-facing help and migration coverage for launch buyers", () => {
    const helpSource = readRepoFileWithCatalog("client/src/pages/HelpCenter.tsx");
    const migrationSource = readRepoFileWithCatalog("client/src/pages/MigrationGuides.tsx");
    const migrationText = migrationSource.replace(/\s+/g, " ");

    for (const expectedHelpTopic of [
      "Set up your company",
      "Create VAT-ready invoices",
      "Import receipts and contacts",
      "Reconcile bank statements",
      "Migrate from Mazeed or Wafeq",
    ]) {
      expect(helpSource).toContain(expectedHelpTopic);
    }

    for (const expectedMigrationTopic of [
      "Move from Mazeed",
      "Move from Wafeq",
      "Move from Zoho Books",
      "Move from Excel",
    ]) {
      expect(migrationSource).toContain(expectedMigrationTopic);
    }

    expect(migrationSource).toContain(
      "Switch from Mazeed, Wafeq, Zoho Books, or Excel without losing your audit trail."
    );
    expect(migrationText).toContain("Prior-system report packs from Mazeed, Wafeq, Zoho Books");
    expect(helpSource).toContain("Migration review covers Mazeed, Wafeq, Zoho Books, and Excel");
  });

  it("keeps a public sample-data demo path for launch buyers", () => {
    const demoSource = readRepoFileWithCatalog("client/src/pages/DemoWorkspace.tsx");

    for (const expectedDemoSignal of [
      "Sample company workspace",
      "Pearl Trading LLC",
      "CSV statement import",
      "Export VAT 201 workbook",
    ]) {
      expect(demoSource).toContain(expectedDemoSignal);
    }
  });

  const words = (...parts: string[]) => parts.join(" ");
  const legacyBankingTerm = words("bank", "feeds");
  const legacyArabicTerm = words("الربط", "البنكي");
  const formerConnectPrompt = words("connect", "your", "bank");

  it.each([
    words("Connect", "your", "bank in seconds"),
    "Review transactions via encrypted feeds",
    words("Live", legacyBankingTerm, "are available now."),
    words("Live", legacyBankingTerm, "are coming later."),
    words("Bank", "feeds are coming soon."),
    words("We will support live", legacyBankingTerm + "."),
    "اربط حسابك البنكي واستورد المعاملات.",
    "يمكنك ربط حسابك البنكي مباشرة.",
    "زامن معاملاتك البنكية تلقائيًا.",
    words(legacyArabicTerm, "المباشر متاح الآن."),
    words("سيتوفر", legacyArabicTerm, "المباشر لاحقًا."),
    "سنربط حسابك بالبنك قريباً.",
  ])("flags an unsupported banking claim: %s", (copy) => {
    expect(findUnsupportedBankFeedClaim(copy)).not.toBeNull();
  });

  it.each(["Can it connect to my bank directly?", "هل يتصل مباشرة بحسابي البنكي؟"])(
    "rejects the former banking FAQ question: %s",
    (copy) => {
      expect(findUnsupportedBankFeedClaim(copy)).not.toBeNull();
      expect(findBankFeedMention(copy)).not.toBeNull();
    }
  );

  it.each([
    words("CSV statement import, no live", "feed needed"),
    "Upload a CSV exported from your bank, review suggested matches, and reconcile against your books.",
    words("Live", legacyBankingTerm, "are not supported."),
    words("UAE", legacyBankingTerm, "are not supported."),
    words("We don't support UAE", legacyBankingTerm + "."),
    words("Do not", formerConnectPrompt + "; upload a CSV statement."),
    "ارفع كشف حسابك البنكي بصيغة CSV، وراجع المطابقات المقترحة، ثم طابقها مع دفاترك.",
    words(legacyArabicTerm, "المباشر غير متاح."),
    "لا يمكنك ربط حسابك البنكي مباشرة.",
  ])("accepts manual CSV or an honest negation: %s", (copy) => {
    expect(findUnsupportedBankFeedClaim(copy)).toBeNull();
  });

  it("does not let an honest negation mask a later positive claim", () => {
    const copy = words(
      "UAE",
      legacyBankingTerm,
      "are not supported. Securely link",
      "your",
      "bank account today."
    );
    expect(findUnsupportedBankFeedClaim(copy)).toBe(words("Securely link", "your", "bank account"));
  });

  it.each([
    words("Bank", "feeds"),
    "Live syncing is not available for it.",
    words("A bank-feed", "connection is unavailable."),
    "Try open-banking next month.",
    legacyArabicTerm,
    "المزامنة المباشرة غير متاحة له.",
    "لا يوجد ربطٌ مصرفيّ.",
    "الخدمات المصرفية المفتوحة",
    "ربط مباشر",
    "تفعيل الربط المباشر قريبًا",
    "سنربط حسابك بالبنك قريباً",
  ])("rejects a mention on statement-import surfaces: %s", (copy) => {
    expect(findBankFeedMention(copy)).not.toBeNull();
  });

  it.each(["en", "ar"])("keeps all %s catalog values use statement-import wording", (locale) => {
    const directory = `client/src/locales/${locale}`;
    const mentions: string[] = [];
    for (const file of readdirSync(join(repoRoot, directory))) {
      if (!file.endsWith(".json")) continue;
      const catalog = JSON.parse(readRepoFile(`${directory}/${file}`)) as Record<string, unknown>;
      for (const [key, value] of Object.entries(catalog)) {
        if (typeof value === "string" && findBankFeedMention(value)) {
          mentions.push(`${file}: ${key}`);
        }
      }
    }
    expect(mentions).toEqual([]);
  });

  it.each([
    "docs/EMAIL_INTAKE_PILOT.md",
    "docs/EXTERNAL_DEPENDENCIES.md",
    "docs/archive/2026-06/AUDIT.md",
    "docs/archive/2026-06/COMPETITIVE_ROADMAP.md",
    "docs/archive/2026-06/DEVELOPMENT_STATUS.md",
    "docs/archive/2026-06/LAUNCH_READINESS.md",
    "docs/archive/2026-06/NEXT_STEPS.md",
    "docs/archive/2026-06/PRODUCTION_HARDENING.md",
    "docs/archive/codex/CODEX_TASK_PROMPT.md",
    "docs/archive/root/COMPETITIVE_AUDIT_2026.md",
  ])("keeps first-party launch and rollout guidance focused on statement import in %s", (file) => {
    expect(findBankFeedMention(readRepoFile(file))).toBeNull();
  });

  it.each([
    "docs/archive/root/Muhasib-Teardown-2026-08-07.md",
    "docs/archive/root/Muhasib-Rebuild-Plan.md",
    "docs/qa/2026-06-21-benchmark-audit/03-cfo-audit-report.md",
  ])("omits obsolete banking comparisons in %s", (file) => {
    expect(readRepoFile(file)).not.toMatch(
      /\bUAE\s+bank\s+feeds?\b|\bbank\s+feeds?\s+(?:and|with)\s+rules\b/i
    );
  });

  it.each(["en", "ar"] as const)("uses the same CSV wording in %s customer copy", (locale) => {
    const load = (namespace: string): Record<string, string> =>
      JSON.parse(readRepoFile(`client/src/locales/${locale}/${namespace}.json`));
    const banking = load("banking");
    const errors = load("serverErrors");
    const marketing = load("marketing");
    const csv = BANK_RECONCILIATION_COPY[locale];
    const faq =
      locale === "en" ? "How do I reconcile my bank statement?" : "كيف أطابق كشف حسابي البنكي؟";
    const phase = readRepoFile("client/src/components/marketing/phase/PhaseSite.tsx");
    const gallery = readRepoFile("client/src/dev/UiGallery.tsx");

    expect(marketing["marketing.faq3Q"]).toBe(faq);
    expect(marketing).not.toHaveProperty(["marketing.prRowAiReceiptsNote"]);
    expect(phase).toContain(faq);
    expect(gallery).toContain(
      "description={L(BANK_RECONCILIATION_COPY.en, BANK_RECONCILIATION_COPY.ar)}"
    );
    expect(gallery).not.toMatch(/connect your bank|اربط حسابك البنكي/i);
    expect(load("portal")).not.toHaveProperty(["portal.eventType.bank.sync_failed"]);
    expect(load("components")).not.toHaveProperty([
      "components.srv.notification.bankSyncFailed.title",
    ]);
    const providerErrors = Object.entries(errors).filter(([key]) =>
      key.startsWith("serverErrors.BANK_FEED_")
    );
    expect(providerErrors).not.toHaveLength(0);
    for (const [key, message] of providerErrors) expect(message, key).toBe(csv);
    expect([
      banking["banking.emptyTransactionsDescription"],
      marketing["marketing.bankBody"],
      marketing["marketing.faq3A"],
      marketing["marketing.helpGuide4Body"],
      marketing["marketing.prEveryBankBody"],
    ]).toEqual(Array(5).fill(csv));
  });

  it("documents CSV reconciliation without an availability claim about bank providers", () => {
    const audit = readRepoFile("docs/archive/root/muhasibaisource20260611-audit.md");
    expect(audit).not.toMatch(/no\s+live\s+bank\s+feeds/i);
    expect(audit).toContain(BANK_RECONCILIATION_COPY.en);
  });

  // X6b: the old test here compared advertised free-plan limits with source text. Pricing, the
  // trial banner and the Subscription page are now covered by rendering them
  // (tests/unit/trial-pricing.test.ts), which also pins the public trial claim to TRIAL_DAYS.
});
