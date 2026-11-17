/**
 * Static source guards (R20-10). Every test in this file asserts on source text because the
 * property cannot be observed by rendering or calling code in a unit test:
 *  - App.tsx route/redirect wiring: App mounts the whole provider tree, router and lazy pages and
 *    cannot be rendered without a browser session and API.
 *  - Page markup guards (mobile layouts, bank import copy, onboarding, first-invoice): the pages
 *    are query-driven screens whose responsive class names / test ids only exist when real data
 *    loads; the equivalent coverage is the Playwright crawls (tests/e2e), which do not run here.
 *  - The NR-only WhatsApp scan checks that customer-facing files never mention the surface.
 * Behaviour-testable parts of the former separate files now live in
 * sidebar-nav-behaviour.test.ts and tests tests/db (firm-gated-surfaces, evidence-center-surface).
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readDashboardSource } from "./dashboardSource";

const repoRoot = process.cwd();
const read = (path: string) => readFileSync(join(repoRoot, path), "utf8");

describe("NR-only surfaces stay out of customer-facing source", () => {
  it("keeps WhatsApp out of SaaS/customer-facing pages", () => {
    const customerFacingFiles = [
      "client/src/App.tsx",
      "client/src/components/layout/AppSidebar.tsx",
      "client/src/pages/Admin.tsx",
      "client/src/pages/ClientDashboard.tsx",
      "client/src/pages/CustomerContacts.tsx",
      "client/src/pages/Invoices.tsx",
      "client/src/pages/MuhasibLanding.tsx",
      "client/src/pages/PaymentChasing.tsx",
      "client/src/pages/Pricing.tsx",
      "client/src/pages/Reminders.tsx",
    ];
    for (const file of customerFacingFiles) {
      expect(read(file), file).not.toMatch(
        /WhatsApp|whatsapp|wa\.me|SiWhatsapp|sendWhatsapp|whatsappTemplate/
      );
    }
  });

  it("mounts document chasing only under the NR firm namespace", () => {
    const appSource = read("client/src/App.tsx");
    expect(appSource).not.toMatch(/<Route\s+path=["']\/document-chasing["']/);
    expect(appSource).toMatch(/<Route\s+path=["']\/firm\/document-chasing["']/);
  });
});

const app = read("client/src/App.tsx");

/** The `<RedirectTo to="..."/>` target declared for a legacy route path. */
function redirectTargetFor(path: string): string | null {
  const escaped = path.replace(/[/.]/g, "\\$&");
  const match = app.match(
    new RegExp(
      `<Route path="${escaped}">\\s*(?:\\{[^}]*=>\\s*)?<RedirectTo to=\\{?[\`"]([^\`"]+)[\`"]`
    )
  );
  return match ? match[1] : null;
}

describe("consolidated navigation redirects (App source)", () => {
  it("R18-09: the five AI pages redirect into one /ai hub with tabs", () => {
    expect(redirectTargetFor("/ai-cfo")).toBe("/ai?tab=cfo");
    expect(redirectTargetFor("/ai-features")).toBe("/ai?tab=features");
    expect(redirectTargetFor("/smart-assistant")).toBe("/ai?tab=assistant");
    expect(redirectTargetFor("/ai-chat")).toBe("/ai?tab=chat");
    expect(redirectTargetFor("/ai-inbox")).toBe("/ai?tab=inbox");
    expect(app).toContain('<Route path="/ai" component={AIHub} />');

    const hub = read("client/src/pages/AIHub.tsx");
    for (const id of ["cfo", "features", "assistant", "chat", "inbox"]) {
      expect(hub).toContain(`id: "${id}"`);
    }
    for (const page of ["AICFO", "AIFeatures", "SmartAssistant", "AIChat", "AIInbox"]) {
      expect(hub).toContain(`import("@/pages/${page}")`);
    }
  });

  it("R20-08: /accounts and /integrations redirect to their canonical pages", () => {
    expect(redirectTargetFor("/accounts")).toBe("/chart-of-accounts");
    expect(redirectTargetFor("/integrations")).toBe("/integrations-hub");
    expect(app).toContain('<Route path="/accounts/:id/ledger" component={AccountLedger} />');
  });

  it("R20-08: analytics pages are tabs of one /analytics route", () => {
    expect(app).toContain('<Route path="/analytics" component={AnalyticsHub} />');
    expect(redirectTargetFor("/advanced-analytics")).toBe("/analytics?view=advanced");
    expect(redirectTargetFor("/advanced-reports")).toBe("/analytics?view=reports");
    const hub = read("client/src/pages/AnalyticsHub.tsx");
    expect(hub).toContain('param="view"');
    for (const page of ["Analytics", "AdvancedAnalytics", "AdvancedReports"]) {
      expect(hub).toContain(`import("@/pages/${page}")`);
    }
  });

  it("R15-09: legacy /admin/clients pages redirect to /firm/clients and the admin entry is deduplicated", () => {
    expect(redirectTargetFor("/admin/clients")).toBe("/firm/clients");
    expect(redirectTargetFor("/admin/clients/:id")).toBe("/firm/clients/${params.id}");
    expect(redirectTargetFor("/admin/clients/:id/documents")).toBe("/firm/clients/${params.id}");
    expect(redirectTargetFor("/admin/clients/:id/tasks")).toBe("/firm/clients/${params.id}");
    expect(redirectTargetFor("/admin")).toBe("/admin/users");
    expect(app.match(/<Route path="\/admin"/g)?.length).toBe(1);
    expect(app.match(/<Route path="\/admin\/users"/g)?.length).toBe(1);
  });

  it("R15-09: the orphan WhatsApp dashboard and the superseded legacy pages are deleted", () => {
    for (const file of [
      "client/src/pages/WhatsAppDashboard.tsx",
      "client/src/pages/Accounts.tsx",
      "client/src/pages/ClientManagement.tsx",
      "client/src/pages/ClientDetails.tsx",
      "client/src/pages/ClientDocuments.tsx",
      "client/src/pages/ClientTasks.tsx",
    ]) {
      expect(existsSync(join(repoRoot, file)), file).toBe(false);
    }
    expect(app).not.toMatch(/whatsapp/i);
  });

  it("R18-09: the mobile More sheet and command palette point at the hub, not the retired routes", () => {
    expect(read("client/src/components/MobileNav.tsx")).toContain('href: "/ai"');
    expect(read("client/src/components/CommandPalette.tsx")).toContain('href: "/ai?tab=chat"');
    expect(readDashboardSource()).toContain('<Link href="/ai?tab=cfo">');
  });
});

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
    // D3a: desktop table lives in the shared DataTableCard frame.
    expect(source).toContain('data-testid="bank-transaction-table"');
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
    // D3a: saved receipts are one dense row each (thumbnail, merchant/amount, date · category, actions in ⋯).
    expect(source).toContain("flex items-center gap-3 border-b border-border/70 px-4 py-2.5");
  });

  it("keeps report workspaces reachable from mobile navigation", () => {
    const source = read("client/src/components/MobileNav.tsx");
    const styles = read("client/src/styles/mobile.css");

    expect(source).toContain("interface MoreLink");
    expect(source).toContain("key?: string");
    expect(source).toContain("description?: string");
    expect(source).toContain("reportPersonaWorkspaces.map");
    expect(source).toContain("workspace.navLabel");
    expect(source).toContain("workspace.automationNavLabel");
    expect(source).toContain(
      'description: ct("workspace", workspace.persona, "focus", workspace.focus)'
    );
    expect(source).toContain('"automationOutcome"');
    expect(source).toContain('"packSchedule.automation"');
    expect(source).toContain("reportPersonaWorkspaces.flatMap");
    expect(source).toContain("report.personas.includes(workspace.persona)");
    expect(source).toContain("reportPersonaHref(report, workspace.persona)");
    expect(source).toContain("key: `report-catalog-${workspace.persona}-${report.id}`");
    expect(source).toContain(
      'label: `${ct("report", report.id, "name", report.name)} - ${wsTitle(workspace)}`'
    );
    expect(source).toContain(
      'description: `${ct("category", report.category, "label", report.category)} - ${ct("report", report.id, "comparison", report.comparison)} - ${ct("report", report.id, "automation", report.automation)}`'
    );
    expect(source).toContain("key={link.key ?? link.href}");
    expect(source).toContain("reportWorkspaceHref(workspace)");
    expect(source).toContain('reportSectionHref(workspace, "automation-command-center")');
    expect(source).toContain("reportDecisionShortcuts.map");
    expect(source).toContain("reportDecisionShortcutHref(shortcut)");
    expect(source).toContain('description: ct("shortcut", shortcut.id, "answer", shortcut.answer)');
    expect(source).toContain("reportAutomationTriggerRules.map");
    expect(source).toContain("reportAutomationTriggerRuleHref(rule)");
    expect(source).toContain(
      'description: `${ct("rule", rule.id, "condition", rule.condition)} - ${ct("rule", rule.id, "actionLabel", rule.actionLabel)}`'
    );
    expect(source).toContain("reportDeliverySubscriptions.map");
    expect(source).toContain("reportDeliverySubscriptionHref(subscription)");
    expect(source).toContain(
      'description: `${ct("delivery", subscription.id, "cadence", subscription.cadence)} - ${ct("delivery", subscription.id, "channel", subscription.channel)}`'
    );
    expect(source).toContain("reportAutomationStarters.map");
    expect(source).toContain("reportAutomationStarterHref(starter)");
    expect(source).toContain(
      'description: `${ct("starter", starter.id, "audience", starter.audience)} - ${ct("starter", starter.id, "outcome", starter.outcome)}`'
    );
    expect(source).toContain("reportPackTemplates.map");
    expect(source).toContain("reportPackTemplateHref(template)");
    expect(source).toContain(
      'description: `${ct("pack", template.id, "cadence", template.cadence)} - ${ct("pack", template.id, "delivery", template.delivery)}`'
    );
    expect(source).toContain("reportComparisonPresets.map");
    expect(source).toContain("reportComparisonPresetHref(preset)");
    expect(source).toContain(
      'description: `${ct("preset", preset.id, "baseline", preset.baseline)} - ${ct("preset", preset.id, "automationTrigger", preset.automationTrigger)}`'
    );
    expect(source).toContain("mobile-nav-more-label");
    expect(source).toContain("mobile-nav-more-description");
    expect(source).toContain("aria-label={link.description");
    expect(styles).toContain(".mobile-nav-more-description");
    expect(styles).toContain("text-overflow: ellipsis");
    expect(source).toContain('location.startsWith(href + "?")');
  });
});

{
  const source = read("client/src/pages/BankReconciliation.tsx");

  describe("Bank import launch UX", () => {
    it("keeps a sample CSV path for buyers without live bank feeds", () => {
      expect(source).toContain("muhasib-sample-bank-statement.csv");
      expect(source).toContain('t["bankReconciliation.liveBankFeedsAreNot"]');
      expect(source).toContain("Arabic/English generic");
      expect(source).toContain("Comma, semicolon, and tab-delimited Excel exports are supported");
      expect(source).toContain("Amount + Dr/Cr type columns are supported");
      expect(source).toContain('data-testid="button-download-sample-bank-csv"');
    });

    it("keeps duplicate import feedback visible to users", () => {
      expect(source).toContain("skippedDuplicates");
      expect(source).toContain("Matching suggestions are being prepared");
    });
  });

  describe("Bank import column mapper (R06-23)", () => {
    it("R06-23 previews the statement and exposes a column mapper with en + ar strings", () => {
      expect(source).toContain("/bank-statements/preview");
      expect(source).toContain('data-testid="panel-statement-mapper"');
      expect(source).toContain("select-map-");
      expect(source).toContain('data-testid="select-statement-date-order"');
      expect(source).toContain('data-testid="checkbox-acknowledge-ambiguity"');
      expect(source).toContain("ربط الأعمدة");
      expect(source).toContain("Column mapping");
      expect(source).toContain(".xlsx");
    });

    it("R06-11 ambiguity must be confirmed before importing", () => {
      expect(source).toContain("acknowledgeAmbiguity");
      expect(source).toContain("statementPreview.requiresChoice");
    });
  });
}

{
  /* R02-09: the journal UI reads the API reversal fields, `source` (not `sourceType`), and translates new strings. */
  const detail = read("client/src/pages/JournalEntryDetail.tsx", "utf8");
  const list = read("client/src/pages/Journal.tsx", "utf8");
  const en = JSON.parse(read("client/src/locales/en/journal.json", "utf8"));
  const ar = JSON.parse(read("client/src/locales/ar/journal.json", "utf8"));

  describe("R02-09 journal UI reversal state", () => {
    it("R02-09: detail page uses reversedByEntryId and reversalOf, not the reversal-only reversedEntryId", () => {
      expect(detail).toContain("entry.reversedByEntryId");
      expect(detail).toContain("entry.reversalOf");
      expect(detail).not.toMatch(/entry\.reversedEntryId\b/);
    });

    it("R02-09: reads `source`, never `sourceType`", () => {
      expect(detail).not.toContain("sourceType");
      expect(detail).toContain("entry.source");
    });

    it("R02-09: the status type matches the server (draft | posted | void) and lifecycle is derived", () => {
      expect(detail).not.toMatch(/status:\s*"draft"\s*\|\s*"posted"\s*\|\s*"reversed"/);
      expect(detail).toMatch(/status:\s*"draft"\s*\|\s*"posted"\s*\|\s*"void"/);
      expect(detail).toContain("lifecycleStatus");
      expect(list).toContain("lifecycleStatus");
    });

    it("R02-09: 'Reversal Information' and the reversal/void actions are translated", () => {
      expect(detail).not.toMatch(/>\s*Reversal Information\s*</);
      expect(detail).toContain('t["journal.reversalInformation"]');
      for (const key of [
        "journal.reversalInformation",
        "journal.reversedBy",
        "journal.reversalOf",
        "journal.reversalDate",
        "journal.void",
      ]) {
        expect(en[key], key).toBeTruthy();
        expect(ar[key], key).toMatch(/[؀-ۿ]/);
      }
    });

    it("R02-16a: the list offers a reversal-date picker and a void action; no 0.01 tolerance", () => {
      expect(list).toContain("/void`");
      expect(list).toContain("input-reversal-date-");
      expect(list).not.toContain("< 0.01");
      expect(detail).not.toContain("< 0.01");
      expect(list).not.toContain("Original entry marked as void");
      expect(list).not.toMatch(/companyId: selectedCompanyId,\n\s+lines:/);
    });
  });
}

describe("S5 chart of accounts page wiring", () => {
  it("the Chart of Accounts page wires parent selection, CSV export and CSV import", () => {
    const page = read("client/src/pages/ChartOfAccounts.tsx");
    expect(page).toContain("parentCandidates(");
    expect(page).toContain('apiRequest("PUT", `/api/accounts/${parentFor!.id}`');
    expect(page).toContain("/imports/chart-of-accounts/export");
    expect(page).toContain('navigate("/import?kind=chart_of_accounts")');
    expect(read("client/src/pages/ImportWizard.tsx")).toContain("kindFromSearch(");
  });
});

describe("S5 locale catalogs are code-split (source wiring)", () => {
  it("i18n.ts loads namespace catalogs lazily (no eager glob) and main.tsx awaits the active locale", () => {
    const src = read("client/src/lib/i18n.ts");
    expect(src).toMatch(
      /import\.meta\.glob\("\.\.\/locales\/en\/\*\.json", \{ import: "default" \}\)/
    );
    expect(src).not.toMatch(/eager:\s*true/);
    // D1b: main.tsx awaits the first route's catalogs (every namespace for app routes, the
    // route's own for public pages); the behaviour is covered by tests/unit/public-boot.test.ts.
    expect(read("client/src/main.tsx")).toContain("loadLocaleForPath(locale,");
  });
});

describe("welcome tour and onboarding redirect (source)", () => {
  it("R18-03: the tour persists a server-side dismissal once per user with a localStorage fallback", () => {
    const wizard = read("client/src/components/Onboarding.tsx");
    expect(wizard).toContain("{ tourDismissed: true }");
    expect(wizard).toContain("tourDismissedAt");
    expect(wizard).toContain("readLocalTourDismissed");
    expect(wizard).toContain("muhasib_tour_dismissed:");
    // never over the onboarding page itself
    expect(wizard).toContain('location.split("?")[0] === "/onboarding"');
    // recorded the moment it is shown, not only on an explicit skip
    expect(wizard).toMatch(/setHasAutoShown\(true\);[\s\S]*skipMutation\.mutate\(\)/);
  });

  it("R18-03: user_onboarding gains tour_dismissed_at in the Drizzle schema", () => {
    expect(read("shared/schema/platform.ts")).toContain(
      'tourDismissedAt: timestamp("tour_dismissed_at")'
    );
  });

  it("R18-08: the onboarding redirect is deterministic per-user state, not a session flag", () => {
    const app = read("client/src/App.tsx");
    expect(app).not.toContain("onboarding_redirect_seen");
    expect(app).not.toContain("sessionStorage.getItem(REDIRECT_FLAG)");
    expect(app).toContain('navigate("/onboarding")');
    // waits for in-flight company refetches so a just-finished wizard is not bounced back
    expect(app).toContain('useIsFetching({ queryKey: ["/api/companies"] })');
  });
});

describe("first-invoice experience", () => {
  const invoices = read("client/src/pages/Invoices.tsx");
  const dashboard = readDashboardSource();

  it("R18-06: the epoch-based INV-<ms> placeholder is gone and the field says it is assigned on save", () => {
    expect(invoices).not.toContain("INV-${Date.now()}");
    expect(invoices).toContain('t["invoices.numberAssignedOnSave"]');
    expect(invoices).toContain("readOnly={!editingInvoice}");
  });

  it("R18-07: a saved draft offers Issue now / Keep as draft and issues through the status endpoint", () => {
    expect(invoices).toContain('data-testid="dialog-invoice-draft-nudge"');
    expect(invoices).toContain('t["invoices.nudgeIssueNow"]');
    expect(invoices).toContain('t["invoices.nudgeKeepDraft"]');
    expect(invoices).toContain('{ id: target.id, status: "sent" }');
    expect(invoices).toContain("setDraftNudge({ id: created.id");
  });

  it("R18-13: the dashboard explains that drafts do not count as revenue", () => {
    expect(dashboard).toContain('data-testid="card-draft-not-revenue"');
    expect(dashboard).toContain('t["dashboard.draftNotRevenueTitle"]');
  });

  it("R18-12: the empty dashboard has a guided first-invoice entry that opens the New Invoice dialog", () => {
    expect(dashboard).toContain('data-testid="card-first-invoice-guide"');
    expect(dashboard).toContain('href="/invoices?new=1"');
    expect(invoices).toContain('.get("new") === "1"');
  });
});
