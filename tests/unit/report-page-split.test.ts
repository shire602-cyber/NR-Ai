/**
 * W5-A Reports page structure and catalog honesty (unit).
 *
 * R20-09  Reports.tsx is a thin shell over lazy feature modules.
 * R12-14  no always-hidden discovery machinery is rendered (or kept) on the page.
 * R18-10  the default view leads with statements/tax downloads; tooling sits behind "Advanced".
 * R12-13 / R12-15 / R20-10  every report and comparison metric carries a data basis, the API
 *         exposes it and indicator (non-ledger) entries are badged.
 * R12-10  delivery channels never mention Google Sheets unless the integration is live.
 * W3-E    "over budget" uses the favourable-sign convention.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  readyReportCatalog,
  reportCatalog,
  reportCatalogDataBasis,
  reportComparisonMetricBasis,
  reportComparisonPresets,
  reportDeliverySubscriptions,
} from "../../client/src/lib/reportCatalog";
import { buildReportCatalogDiscovery } from "../../server/services/report-catalog.service";
import {
  EMAIL_AND_SHEETS_DELIVERY_CHANNEL,
  EMAIL_DELIVERY_CHANNEL,
  resolveReportDeliveryChannel,
} from "../../server/services/report-delivery.service";
import { isOverBudgetLine } from "../../client/src/pages/reports/shared";

const root = process.cwd();
const read = (p: string) => readFileSync(join(root, p), "utf8");
function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(join(root, dir))) {
    const rel = `${dir}/${name}`;
    if (statSync(join(root, rel)).isDirectory()) out.push(...walk(rel));
    else if (/\.tsx?$/.test(name)) out.push(rel);
  }
  return out;
}

describe("Reports page split (R20-09)", () => {
  it("[R20-09] Reports.tsx is a thin shell that lazy-loads workspace panels", () => {
    const shell = read("client/src/pages/Reports.tsx");
    expect(shell.split("\n").length).toBeLessThan(500);
    expect(shell).toContain("useReportsPage()");
    expect(shell).toContain("ReportsPageContext.Provider");
    for (const panel of [
      "HomePanel",
      "SuitesPanel",
      "DeliveryPanel",
      "AutomationPanel",
      "ReportsPanel",
    ]) {
      expect(shell).toContain(`const ${panel} = lazy(() => import("./reports/panels/${panel}"))`);
    }
  });

  it("[R20-09] focused report tabs are lazy modules inside the Report Center panel", () => {
    const panel = read("client/src/pages/reports/panels/ReportsPanel.tsx");
    const tabs = walk("client/src/pages/reports/tabs");
    expect(tabs.length).toBe(12);
    for (const file of tabs) {
      const name = file.split("/").pop()!.replace(".tsx", "");
      expect(panel).toContain(`const ${name} = lazy(() => import("../tabs/${name}"))`);
    }
    expect(panel.split("\n").length).toBeLessThan(500);
  });
});

describe("catalog restraint (R12-14, R18-10)", () => {
  it("[R12-14] the always-hidden discovery panel and its state are gone", () => {
    const source = walk("client/src/pages/reports").map(read).join("\n");
    expect(source).not.toContain("reportDiscoveryPanelClass");
    expect(source).not.toContain("reportWorkflowFinderResults");
    expect(source).not.toContain("buildReportCoverageMap(filteredReports)");
  });

  it("[R18-10] the Report Center leads with statements and tax, tooling behind Advanced", () => {
    const panel = read("client/src/pages/reports/panels/ReportsPanel.tsx");
    expect(panel.indexOf("<StatementsQuickPanel")).toBeGreaterThan(-1);
    expect(panel.indexOf("<StatementsQuickPanel")).toBeLessThan(
      panel.indexOf('aria-label="Report Center"')
    );
    const parts = read("client/src/pages/reports/StatementParts.tsx");
    expect(parts).toContain('data-testid="button-reports-advanced-tools"');
    expect(parts).toContain("/reports/share-pack");
    expect(parts).toContain("/reports/faf?");
    const shared = read("client/src/pages/reports/shared.tsx");
    const order = shared.slice(shared.indexOf("reportViewerCategoryOrder = ["));
    expect(order.indexOf('"Accountant & Taxes"')).toBeLessThan(
      order.indexOf('"Sales & Receivables"')
    );
  });

  it("[R18-10] new Report Center copy exists in en and ar", () => {
    const en = JSON.parse(read("client/src/locales/en/reportCenter.json"));
    const ar = JSON.parse(read("client/src/locales/ar/reportCenter.json"));
    for (const key of [
      "reportCenter.advancedTools",
      "reportCenter.statementsAndTax",
      "reportCenter.combinedViewUnconsolidated",
      "reportCenter.indicator",
      "reportCenter.ftaAuditFileHint",
    ]) {
      expect(en[key]).toBeTruthy();
      expect(ar[key]).toMatch(/[؀-ۿ]/);
    }
  });
});

describe("data basis (R12-13, R12-15, R20-10)", () => {
  it("[R12-13] every catalog report declares ledger | documents | snapshot_proxy", () => {
    for (const report of reportCatalog) {
      expect(["ledger", "documents", "snapshot_proxy"]).toContain(report.dataBasis);
    }
    for (const id of [
      "profit-loss",
      "balance-sheet",
      "trial-balance",
      "cash-flow",
      "general-ledger",
    ]) {
      expect(reportCatalogDataBasis(id)).toBe("ledger");
    }
    expect(reportCatalogDataBasis("invoice-status")).toBe("documents");
    expect(reportCatalogDataBasis("cash-flow-forecast")).toBe("snapshot_proxy");
    expect(reportCatalogDataBasis("consolidated-statements")).toBe("snapshot_proxy");
  });

  it("[R12-15] comparison metrics carry a basis and the API exposes it with consistent counts", () => {
    expect(reportComparisonMetricBasis("revenue")).toBe("ledger");
    expect(reportComparisonMetricBasis("open-receivables")).toBe("documents");
    expect(reportComparisonMetricBasis("cash-runway-days")).toBe("snapshot_proxy");
    expect(reportComparisonMetricBasis("consolidated-revenue")).toBe("snapshot_proxy");
    const discovery = buildReportCatalogDiscovery();
    const s = discovery.summary;
    expect(s.ledgerReportCount + s.indicatorReportCount).toBe(s.reportCount);
    expect(s.readyReportCount).toBe(readyReportCatalog.length);
    expect(s.liveReportCount + s.apiReportCount + s.plannedReportCount).toBe(s.reportCount);
    for (const report of discovery.reports) {
      expect(report.indicator).toBe(report.dataBasis !== "ledger");
    }
    const preset = discovery.comparisonPresets[0];
    expect(preset.metricBases.length).toBe(preset.metricIds.length);
    expect(reportComparisonPresets.length).toBeGreaterThan(0);
  });

  it("[R20-10] the Report Center badges indicator reports and indicator comparison rows", () => {
    const panel = read("client/src/pages/reports/panels/ReportsPanel.tsx");
    expect(panel).toContain("<DataBasisBadge");
    expect(panel).toContain("reportCatalogDataBasis(option.reportId)");
    const comparisons = read("client/src/pages/reports/panels/ComparisonsPanel.tsx");
    expect(comparisons).toContain("reportComparisonMetricBasis(row.id)");
  });
});

describe("delivery channel honesty (R12-10)", () => {
  it("[R12-10] channels mention Google Sheets only when the integration is live", () => {
    for (const sub of reportDeliverySubscriptions) {
      expect(sub.channel).not.toMatch(/sheets/i);
      expect(resolveReportDeliveryChannel(sub, null, false)).toBe(EMAIL_DELIVERY_CHANNEL);
    }
    const sheets = reportDeliverySubscriptions.find((s) => s.googleSheetsCopy)!;
    expect(resolveReportDeliveryChannel(sheets, null, true)).toBe(
      EMAIL_AND_SHEETS_DELIVERY_CHANNEL
    );
    expect(resolveReportDeliveryChannel(sheets, "Google Sheets", false)).toBe(
      EMAIL_DELIVERY_CHANNEL
    );
  });
});

describe("budget sign convention (W3-E carry-over)", () => {
  it("counts over-budget spend, not under-target income", () => {
    const line = (accountType: string, budget: number, actual: number) => ({
      accountType,
      totals: { budget, actual, variance: 0, variancePercent: 0 },
    });
    expect(isOverBudgetLine(line("expense", 100, 150))).toBe(true);
    expect(isOverBudgetLine(line("expense", 100, 80))).toBe(false);
    // Income below budget has a negative (unfavourable) variance but is not "over budget".
    expect(isOverBudgetLine(line("income", 100, 50))).toBe(false);
  });
});
