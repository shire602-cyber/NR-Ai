import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function read(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("Mobile launch UX guards", () => {
  it("keeps invoices usable without a desktop-width table", () => {
    const source = read("client/src/pages/Invoices.tsx");

    expect(source).toContain('data-testid="mobile-invoice-list"');
    expect(source).toContain("mobile-select-status");
    expect(source).toContain("mobile-button-edit-invoice");
    expect(source).toContain('className="hidden md:block"');
  });

  it("keeps bank reconciliation usable on narrow screens", () => {
    const source = read("client/src/pages/BankReconciliation.tsx");

    expect(source).toContain('data-testid="mobile-bank-transaction-list"');
    expect(source).toContain("mobile-button-match");
    expect(source).toContain("hidden rounded-md border overflow-x-auto md:block");
  });

  it("keeps VAT return history exportable on narrow screens", () => {
    const source = read("client/src/pages/VATFiling.tsx");

    expect(source).toContain('data-testid="mobile-vat-return-list"');
    expect(source).toContain("mobile-button-view-vat");
    expect(source).toContain("handleExportExcel");
  });

  it("keeps receipt review and saved receipt rows responsive", () => {
    const source = read("client/src/pages/Receipts.tsx");

    expect(source).toContain("flex flex-col gap-4 sm:flex-row");
    expect(source).toContain("grid grid-cols-1 gap-3 sm:grid-cols-2");
    expect(source).toContain("flex flex-col gap-3 p-4 border rounded-lg");
  });

  it("keeps report workspaces reachable from mobile navigation", () => {
    const source = read("client/src/components/MobileNav.tsx");

    expect(source).toContain("reportPersonaWorkspaces.map");
    expect(source).toContain("workspace.navLabel");
    expect(source).toContain("workspace.automationNavLabel");
    expect(source).toContain("reportWorkspaceHref(workspace)");
    expect(source).toContain('reportSectionHref(workspace, "automation-command-center")');
    expect(source).toContain("reportDecisionShortcuts.map");
    expect(source).toContain("reportDecisionShortcutHref(shortcut)");
    expect(source).toContain("reportAutomationTriggerRules.map");
    expect(source).toContain("reportAutomationTriggerRuleHref(rule)");
    expect(source).toContain("reportDeliverySubscriptions.map");
    expect(source).toContain("reportDeliverySubscriptionHref(subscription)");
    expect(source).toContain("reportAutomationStarters.map");
    expect(source).toContain("reportAutomationStarterHref(starter)");
    expect(source).toContain("reportPackTemplates.map");
    expect(source).toContain("reportPackTemplateHref(template)");
    expect(source).toContain("reportComparisonPresets.map");
    expect(source).toContain("reportComparisonPresetHref(preset)");
    expect(source).toContain('location.startsWith(href + "?")');
  });
});
