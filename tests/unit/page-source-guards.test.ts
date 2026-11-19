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
  it("R18-09 / WP-E: the former AI pages redirect into one /assistant route with three tabs", () => {
    expect(redirectTargetFor("/ai")).toBe("/assistant");
    expect(redirectTargetFor("/ai-cfo")).toBe("/assistant?tab=ask");
    expect(redirectTargetFor("/ai-features")).toBe("/assistant?tab=automations");
    expect(redirectTargetFor("/smart-assistant")).toBe("/assistant?tab=ask");
    expect(redirectTargetFor("/ai-chat")).toBe("/assistant?tab=ask");
    expect(redirectTargetFor("/ai-inbox")).toBe("/assistant?tab=review");
    expect(app).toContain('<Route path="/assistant" component={AIHub} />');

    const hub = read("client/src/pages/AIHub.tsx");
    for (const panel of ["AskPanel", "ReviewPanel", "AutomationsPanel"]) {
      expect(hub).toContain(`import("@/pages/assistant/${panel}")`);
    }
  });

  it("R20-08: /accounts and /integrations redirect to their canonical pages", () => {
    expect(redirectTargetFor("/accounts")).toBe("/chart-of-accounts");
    expect(redirectTargetFor("/integrations")).toBe("/integrations-hub");
    expect(app).toContain('<Route path="/accounts/:id/ledger" component={AccountLedger} />');
  });

  it("R20-08 / spec 3.11: the analytics routes stay and forward to Reports > Insights", () => {
    expect(app).toContain('<Route path="/analytics" component={AnalyticsHub} />');
    expect(redirectTargetFor("/advanced-analytics")).toBe("/analytics?view=advanced");
    expect(redirectTargetFor("/advanced-reports")).toBe("/analytics?view=reports");
    // The hub forwards (behaviour covered in reports-insights.test.ts); the three old pages,
    // including the product-telemetry "Usage Analytics" page, are gone.
    const hub = read("client/src/pages/AnalyticsHub.tsx");
    expect(hub).toContain("analyticsRedirectTarget(search)");
    for (const page of ["Analytics", "AdvancedAnalytics", "AdvancedReports"]) {
      expect(hub).not.toContain(`import("@/pages/${page}")`);
    }
  });

  it("R15-09: legacy /admin/clients pages redirect to /firm/clients and the admin entry is deduplicated", () => {
    expect(redirectTargetFor("/admin/clients")).toBe("/firm/clients");
    expect(redirectTargetFor("/admin/clients/:id")).toBe("/firm/clients/${params.id}");
    // WP-E2: documents and tasks are real tabs of the client profile.
    expect(redirectTargetFor("/admin/clients/:id/documents")).toBe(
      "/firm/clients/${params.id}?tab=documents"
    );
    expect(redirectTargetFor("/admin/clients/:id/tasks")).toBe(
      "/firm/clients/${params.id}?tab=tasks"
    );
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
    // WP-A/WP-E: the More sheet renders the shared nav config (Assistant entry → /assistant).
    expect(read("client/src/components/MobileNav.tsx")).toContain("useNavGroups");
    expect(read("client/src/components/layout/nav-config.ts")).toContain('url: "/assistant"');
    expect(read("client/src/components/CommandPalette.tsx")).toContain('href: "/ai?tab=chat"');
    // DF3 (Fable P-b): the dashboard menu links straight to the Assistant.
    expect(readDashboardSource()).toContain('<Link href="/assistant">');
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

  it("keeps the mobile More sheet a navigation list (WP-A, Fable spec 3.5)", () => {
    // Spec 3.5 deleted the catalog "Report shortcuts" collapsible: report workspaces are reached
    // from the Reports tab of the bottom bar. The sheet renders the sidebar's nav config as one
    // column of 44 px rows (rendered behaviour: tests/unit/launch-fix-x1-client.test.ts).
    const source = read("client/src/components/MobileNav.tsx");
    const styles = read("client/src/styles/mobile.css");
    expect(source).toContain("useNavGroups");
    expect(source).not.toContain("reportPersonaWorkspaces");
    expect(source).toContain('href: "/reports"');
    expect(styles).toMatch(/\.mobile-nav-more-row \{[\s\S]*?min-height: 44px/);
    expect(styles).not.toContain(".mobile-nav-indicator");
  });
});

{
  const source = read("client/src/pages/BankReconciliation.tsx");

  describe("Bank import launch UX", () => {
    it("keeps a sample CSV path for buyers without live bank feeds", () => {
      expect(source).toContain("muhasib-sample-bank-statement.csv");
      expect(source).toContain('t["bankReconciliation.liveBankFeedsAreNot"]');
      // Step 1 / F4: the supported-format lines are catalog copy (en and ar), not page literals.
      for (const key of ["formatCsv", "formatDelimiters", "formatDrCr", "formatPdf"]) {
        expect(source).toContain(`banking.import.${key}`);
      }
      const bankingEn = JSON.parse(readFileSync("client/src/locales/en/banking.json", "utf8"));
      expect(bankingEn["banking.import.formatCsv"]).toContain("Arabic/English generic");
      expect(bankingEn["banking.import.formatDelimiters"]).toBe(
        "Comma, semicolon, and tab-delimited Excel exports are supported"
      );
      expect(bankingEn["banking.import.formatDrCr"]).toBe(
        "Amount + Dr/Cr type columns are supported"
      );
      expect(source).toContain('data-testid="button-download-sample-bank-csv"');
    });

    it("keeps duplicate import feedback visible to users", () => {
      expect(source).toContain("skippedDuplicates");
      // X6b: the copy moved into the toast catalogs (English and Arabic).
      for (const loc of ["en", "ar"]) {
        const catalog = JSON.parse(
          readFileSync(`client/src/locales/${loc}/toasts.json`, "utf8")
        ) as Record<string, string>;
        expect(catalog["toasts.importedMatchingPrepared"]).toBeTruthy();
        expect(catalog["toasts.importedSkippedDuplicates"]).toBeTruthy();
      }
      expect(source).toContain("toasts.importedMatchingPrepared");
    });
  });

  describe("Bank import column mapper (R06-23)", () => {
    it("R06-23 previews the statement and exposes a column mapper with en + ar strings", () => {
      expect(source).toContain("/bank-statements/preview");
      expect(source).toContain('data-testid="panel-statement-mapper"');
      expect(source).toContain("select-map-");
      expect(source).toContain('data-testid="select-statement-date-order"');
      expect(source).toContain('data-testid="checkbox-acknowledge-ambiguity"');
      // The mapper copy lives in the banking catalog, in both languages (F4).
      expect(source).toContain("banking.import.columnMapping");
      for (const [loc, text] of [
        ["ar", "ربط الأعمدة"],
        ["en", "Column mapping"],
      ]) {
        const catalog = JSON.parse(readFileSync(`client/src/locales/${loc}/banking.json`, "utf8"));
        expect(catalog["banking.import.columnMapping"]).toBe(text);
      }
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
  it("WQ7: the old floating tour is retired (Get started on the dashboard replaces it)", () => {
    // Source check: the retired component must not come back as a file or an App import, and
    // there is no rendered behaviour left to assert on.
    expect(existsSync(join(repoRoot, "client/src/components/Onboarding.tsx"))).toBe(false);
    expect(read("client/src/App.tsx")).not.toMatch(/components\/Onboarding["']/);
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
    // The href is a literal fallback: a read-only workspace gets the plan action instead
    // (useReadOnlyPlanCta, behaviour-tested in step4-plan-states.test.ts).
    expect(dashboard).toContain('"/invoices?new=1"');
    expect(invoices).toContain('.get("new") === "1"');
  });
});
