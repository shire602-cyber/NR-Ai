import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  demoDataBlockedMessage,
  hasTransactionalActivity,
} from "../../server/services/demo-workspace.service";

const repoRoot = process.cwd();

function readRepoFile(path: string): string {
  return readFileSync(join(repoRoot, path), "utf8");
}

describe("SaaS onboarding demo workspace", () => {
  it("blocks demo sample data once transactional activity exists", () => {
    expect(
      hasTransactionalActivity({
        invoices: 0,
        receipts: 0,
        journalEntries: 0,
        bankTransactions: 0,
      })
    ).toBe(false);

    const counts = {
      invoices: 1,
      receipts: 0,
      journalEntries: 2,
      bankTransactions: 0,
    };

    expect(hasTransactionalActivity(counts)).toBe(true);
    expect(demoDataBlockedMessage(counts)).toContain(
      "Demo data can only be added before transactional activity exists"
    );
    expect(demoDataBlockedMessage(counts)).toContain("1 invoice");
    expect(demoDataBlockedMessage(counts)).toContain("2 journal entries");
  });

  it("keeps the onboarding UI wired to the guarded demo-data endpoint", () => {
    const onboardingSource = readRepoFile("client/src/pages/Onboarding.tsx");

    expect(onboardingSource).toContain("/onboarding/demo-data");
    expect(onboardingSource).toContain("onboarding-create-demo-workspace");
    expect(onboardingSource).toContain("Create demo workspace");
    expect(onboardingSource).toContain("Sample invoices, receipts, journals, and bank lines");
  });

  it("seeds buyer-useful sample books through a tenant-scoped customer route", () => {
    const routeSource = readRepoFile("server/routes/companies.routes.ts");

    expect(routeSource).toContain("/api/companies/:id/onboarding/demo-data");
    expect(routeSource).toContain("authMiddleware, requireCustomer");
    expect(routeSource).toContain("hasTransactionalActivity(activityCounts)");
    expect(routeSource).toContain("allocateInvoiceNumber");
    expect(routeSource).toContain("journalEntries: 3");
    expect(routeSource).toContain("bankTransactions: bankTransactions.length");
  });
});
