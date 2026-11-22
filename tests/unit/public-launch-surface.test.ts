// Source inspection is intentional: this is the unsupported-claims guard for public marketing,
// legal and help copy. It scans the shipped source/catalog text for banned compliance and security
// claims across pages that cannot all be rendered without API data.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { readDashboardSource } from "./dashboardSource";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { bankCsvWorkflow } from "../../shared/banking-copy";

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
  "client/src/components/auth/AuthLayout.tsx",
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
  /Connect Your Bank/i,
  /Securely link your.*bank account/i,
  /via encrypted feeds/i,
  /UAE bank feeds/i,
  /الربط (?:البنكي|المصرفي) المباشر/,
  /Photo, email forward, or bank feed/i,
  /sync a bank line/i,
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
    }
  });

  it("describes CSV statement upload and reconciliation in both locales", () => {
    for (const locale of ["en", "ar"] as const) {
      const prefix = `client/src/locales/${locale}`;
      const onboarding = JSON.parse(readRepoFile(`${prefix}/onboarding.json`));
      expect(onboarding["onboarding.bankCardDesc"]).toBe(bankCsvWorkflow[locale]);
      const keys = [
        ["marketing", "marketing.faq3A"],
        ["banking", "banking.statementUpload.title"],
        ["banking", "banking.statementUpload.description"],
        ["banking", "banking.statementUpload.cta"],
        ["serverErrors", "serverErrors.BANK_FEED_NOT_CONFIGURED"],
      ];
      for (const [catalog, key] of keys) {
        const source = JSON.parse(readRepoFile(`${prefix}/${catalog}.json`));
        expect(source[key], `${locale} ${key}`).toMatch(/CSV/);
      }
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
    expect(trustPage).toContain("support@muhasib.ai");
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
      "Coming Soon",
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
      "Bank statement imported by CSV",
      "Export VAT 201 workbook",
    ]) {
      expect(demoSource).toContain(expectedDemoSignal);
    }
  });

  // X6b: the old test here compared advertised free-plan limits with source text. Pricing, the
  // trial banner and the Subscription page are now covered by rendering them
  // (tests/unit/trial-pricing.test.ts), which also pins the public trial claim to TRIAL_DAYS.
});
