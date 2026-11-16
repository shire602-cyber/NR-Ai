// Source inspection is intentional: this is the unsupported-claims guard for public marketing,
// legal and help copy. It scans the shipped source/catalog text for banned compliance and security
// claims across pages that cannot all be rendered without API data.
import { readFileSync } from "node:fs";
import { readDashboardSource } from "./dashboardSource";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

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
  "client/src/pages/MuhasibLanding.tsx",
  "client/src/components/auth/AuthLayout.tsx",
  // LandingPage.tsx and Landing.tsx were alternative landing pages that no
  // route ever rendered; they were deleted. MuhasibLanding.tsx (above) is the
  // one actually served, so this guard now scans the live page only.
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
      for (const bannedClaim of bannedLaunchClaims) {
        expect(source, `${file} contains ${bannedClaim}`).not.toMatch(bannedClaim);
      }
    }
  });

  it("keeps authenticated SaaS chrome and dashboard copy claim-safe", () => {
    const appSource = readRepoFile("client/src/App.tsx");
    const dashboardSource = readDashboardSource();
    const onboardingWizardSource = readRepoFile("client/src/components/Onboarding.tsx");
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
      ["client/src/components/Onboarding.tsx", onboardingWizardSource],
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
    expect(en["marketing.trustOperatorBody"]).toContain("Najma Al Raeda Accounting LLC");
    // Data residency stays a statement of what is documented, not a hosting claim.
    expect(en["marketing.trustResidencyBody"]).toMatch(/being finalised with counsel/);
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
      "Switch from Mazeed, Wafeq, Zoho Books, or Excel without losing audit trail."
    );
    expect(migrationText).toContain("Prior-system report packs from Mazeed, Wafeq, Zoho Books");
    expect(helpSource).toContain("Migration review covers Mazeed, Wafeq, Zoho Books, and Excel");
  });

  it("keeps a public sample-data demo path for launch buyers", () => {
    const demoSource = readRepoFileWithCatalog("client/src/pages/DemoWorkspace.tsx");

    for (const expectedDemoSignal of [
      "Sample company workspace",
      "Pearl Trading LLC",
      "CSV statement import, no live feed needed",
      "Export VAT 201 workbook",
    ]) {
      expect(demoSource).toContain(expectedDemoSignal);
    }
  });

  it("advertises the free-plan invoice limit the gate and the Free migration row enforce", () => {
    const gate = readRepoFile("server/middleware/featureGate.ts");
    const limits = gate.slice(gate.indexOf("const TIER_LIMITS"));
    const freeBlock = limits.match(/free:\s*\{([^}]*)\}/)?.[1] ?? "";
    const enforced = Number(freeBlock.match(/maxInvoicesPerMonth:\s*(\d+)/)?.[1]);
    expect(Number.isInteger(enforced) && enforced > 0).toBe(true);

    // The 0113 Free row (trigger + backfill) carries the same figure in its VALUES list.
    const migration = readRepoFile("migrations/0113_s5_platform.sql");
    expect(migration).toMatch(
      new RegExp(`'active', now\\(\\), now\\(\\) \\+ interval '100 years', 1, ${enforced}, `)
    );

    const advertised = [
      { file: "client/src/locales/en/marketing.json", pattern: /(\d+) invoices a month/ },
      { file: "client/src/locales/ar/marketing.json", pattern: /(\d+) فاتورة شهرياً/ },
      { file: "client/src/pages/Pricing.tsx", pattern: /"(\d+) invoices\/month"/ },
      { file: "client/src/pages/Pricing.tsx", pattern: /"(\d+) فاتورة\/شهر"/ },
      { file: "client/src/components/PricingSummary.tsx", pattern: /"(\d+) invoices\/mo"/ },
      { file: "client/src/components/PricingSummary.tsx", pattern: /"(\d+) فاتورة\/شهر"/ },
    ];
    for (const { file, pattern } of advertised) {
      const m = readRepoFile(file).match(pattern);
      expect(m, `${file} should state the free invoice limit`).not.toBeNull();
      expect(Number(m?.[1]), file).toBe(enforced);
    }
  });
});
