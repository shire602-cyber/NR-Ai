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
function readRepoFileWithCatalog(path: string): string {
  return readRepoFile(path) + "\n" + readRepoFile("client/src/locales/en/pageLabels.json");
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

    // The header badge copy lives in the shell i18n catalog (R18-02).
    const shellCatalog = readRepoFile("client/src/locales/en/shell.json");
    expect(appSource).toContain('t["shell.uaeTaxReady"]');
    expect(shellCatalog).toContain("UAE Tax Ready");
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
    expect(trustSource).toContain("Launch verification evidence");
    expect(trustSource).toContain("Backup and restore proof");
    expect(trustSource).toContain("Incident process");
    expect(trustSource).toContain("Privacy and DPA posture");
    expect(helpSource).toContain("Support and SLA posture");
    expect(pricingSource).toContain("Enterprise support terms");
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
      "Migrate from mazeed or Wafeq",
    ]) {
      expect(helpSource).toContain(expectedHelpTopic);
    }

    for (const expectedMigrationTopic of [
      "Move from mazeed",
      "Move from Wafeq",
      "Move from Zoho Books",
      "Move from Excel",
    ]) {
      expect(migrationSource).toContain(expectedMigrationTopic);
    }

    expect(migrationSource).toContain(
      "Switch from mazeed, Wafeq, Zoho Books, or Excel without losing audit trail."
    );
    expect(migrationText).toContain("Prior-system report packs from mazeed, Wafeq, Zoho Books");
    expect(helpSource).toContain("Migration review covers mazeed, Wafeq, Zoho Books, and Excel");
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
});
