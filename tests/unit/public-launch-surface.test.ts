import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();

function readRepoFile(path: string): string {
  return readFileSync(join(repoRoot, path), "utf8");
}

const publicLaunchFiles = [
  "client/index.html",
  "client/src/pages/LandingPage.tsx",
  "client/src/pages/Landing.tsx",
  "client/src/pages/Pricing.tsx",
  "client/src/pages/PrivacyPolicy.tsx",
  "client/src/pages/TrustSecurity.tsx",
  "client/src/pages/HelpCenter.tsx",
  "client/src/pages/MigrationGuides.tsx",
];

const bannedLaunchClaims = [
  /FTA-compliant/i,
  /bank-grade/i,
  /bank-level/i,
  /full compliance/i,
  /fully automated/i,
  /Automated VAT\/CIT filing/i,
  /SLA guarantee/i,
  /SLA-backed/i,
  /24\/7 support/i,
  /direct EmaraTax/i,
  /FTA filing/i,
  /FTA Accredited/i,
  /FTA compliance is automatic/i,
  /regular security audits/i,
  /encrypted storage at rest/i,
  /Generate and submit/i,
  /compliant with FTA/i,
  /Connect for easy reconciliation/i,
];

describe("Public SaaS launch surface", () => {
  it("keeps the core trust/help/migration pages publicly routable", () => {
    const appSource = readRepoFile("client/src/App.tsx");

    for (const path of ["/trust", "/help", "/migration-guides"]) {
      expect(appSource, `${path} should be included in the public-route gate`).toContain(
        `location === "${path}"`
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

  it("keeps certification and SLA language explicitly truthful", () => {
    const trustSource = readRepoFile("client/src/pages/TrustSecurity.tsx");
    const helpSource = readRepoFile("client/src/pages/HelpCenter.tsx");
    const pricingSource = readRepoFile("client/src/pages/Pricing.tsx");

    expect(trustSource).toMatch(
      /We do not\s+claim SOC 2, ISO 27001, or FTA accreditation until those reviews are complete\./
    );
    expect(trustSource).toContain("External certifications are roadmap items, not current claims.");
    expect(helpSource).toContain("Support and SLA posture");
    expect(pricingSource).toContain("Enterprise SLA terms during setup");
  });

  it("exposes customer-facing help and migration coverage for launch buyers", () => {
    const helpSource = readRepoFile("client/src/pages/HelpCenter.tsx");
    const migrationSource = readRepoFile("client/src/pages/MigrationGuides.tsx");

    for (const expectedHelpTopic of [
      "Set up your company",
      "Create VAT-ready invoices",
      "Import receipts and contacts",
      "Reconcile bank statements",
    ]) {
      expect(helpSource).toContain(expectedHelpTopic);
    }

    for (const expectedMigrationTopic of [
      "Move from Wafeq",
      "Move from Zoho Books",
      "Move from Excel",
    ]) {
      expect(migrationSource).toContain(expectedMigrationTopic);
    }
  });

  it("keeps buyer-readiness audit trail reporting live and exportable", () => {
    const reportsSource = readRepoFile("client/src/pages/Reports.tsx");

    expect(reportsSource).toContain('name: "Audit Trail"');
    expect(reportsSource).toContain('status: "live"');
    expect(reportsSource).toContain('tab: "auditTrail"');
    expect(reportsSource).toContain('<TabsTrigger value="auditTrail"');
    expect(reportsSource).toContain('<TabsContent value="auditTrail"');
    expect(reportsSource).toContain("prepareAuditTrailForExport");
    expect(reportsSource).toContain("/activity-logs?limit=200");
  });

  it("keeps buyer-readiness inventory movement reporting live and exportable", () => {
    const reportsSource = readRepoFile("client/src/pages/Reports.tsx");
    const reportRoutesSource = readRepoFile("server/routes/reports.routes.ts");

    expect(reportsSource).toContain('name: "Inventory Movement"');
    expect(reportsSource).toContain('tab: "inventoryMovement"');
    expect(reportsSource).toContain('<TabsTrigger value="inventoryMovement"');
    expect(reportsSource).toContain('<TabsContent value="inventoryMovement"');
    expect(reportsSource).toContain("prepareInventoryMovementForExport");
    expect(reportRoutesSource).toContain("/api/companies/:id/reports/inventory-movement");
  });

  it("keeps expense-claim and WPS readiness reports live and exportable", () => {
    const reportsSource = readRepoFile("client/src/pages/Reports.tsx");
    const reportRoutesSource = readRepoFile("server/routes/reports.routes.ts");
    const reportPacksSource = readRepoFile("server/services/report-pack-schedules.service.ts");
    const payrollSource = readRepoFile("server/routes/payroll.routes.ts");

    for (const expected of [
      'name: "Expense Claims"',
      'tab: "expenseClaims"',
      '<TabsTrigger value="expenseClaims"',
      '<TabsContent value="expenseClaims"',
      "prepareExpenseClaimsForExport",
      'name: "WPS / SIF Summary"',
      'tab: "wpsSif"',
      '<TabsTrigger value="wpsSif"',
      '<TabsContent value="wpsSif"',
      "prepareWpsSifSummaryForExport",
    ]) {
      expect(reportsSource).toContain(expected);
    }

    expect(reportRoutesSource).toContain("/api/companies/:id/reports/expense-claims");
    expect(reportRoutesSource).toContain("/api/companies/:id/reports/wps-sif-summary");
    expect(reportPacksSource).toContain("Expense Claims");
    expect(reportPacksSource).toContain("WPS / SIF Summary");
    expect(payrollSource).toContain("company.mohre_establishment_id");
    expect(payrollSource).toContain("company.wps_employer_iban");
  });

  it("keeps WhatsApp and internal document chasing out of the public launch pages", () => {
    for (const file of publicLaunchFiles) {
      const source = readRepoFile(file);
      expect(source, `${file} should not mention WhatsApp`).not.toMatch(/WhatsApp|whatsapp/i);
      expect(source, `${file} should not expose document chasing`).not.toMatch(
        /document chasing|document-chasing/i
      );
    }
  });
});
