import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { localizeNotification } from "../../client/src/lib/notification-display";
import { useI18n } from "../../client/src/lib/i18n";

const root = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8");

describe("R2 final-round fixes", () => {
  it("renders server money strings through the one money formatter (item 5)", () => {
    useI18n.setState({ locale: "ar" });
    const ar = localizeNotification(
      { title: "t", message: "Payment of AED 15000.00 received for invoice INV-1" },
      {}
    );
    expect(ar.message).toContain("15,000.00");
    expect(ar.message).toContain("د.إ");
    expect(ar.message).not.toContain("15000.00");
    useI18n.setState({ locale: "en" });
    const en = localizeNotification(
      { title: "t", message: "Payment of AED 15000.00 received for invoice INV-1" },
      {}
    );
    expect(en.message).toContain("AED");
    expect(en.message).toContain("15,000.00");
  });

  it("statements and corporate tax use the shared DatePicker, not native date inputs (item 7)", () => {
    for (const f of [
      "client/src/pages/FinancialStatements.tsx",
      "client/src/pages/CorporateTax.tsx",
    ]) {
      const src = read(f);
      expect(src).not.toContain('type="date"');
      expect(src).toContain("DatePicker");
    }
  });

  it("passes Arabic account names through statements, cash flow and the dashboard breakdown (item 7)", () => {
    expect(read("server/reporting/statements.ts")).toContain("accountNameAr: a?.nameAr ?? null");
    expect(read("server/services/dashboard-stats.service.ts")).toContain("nameAr: l.accountNameAr");
    expect(read("client/src/pages/FinancialStatements.tsx")).toContain("item.accountNameAr");
    expect(read("client/src/pages/dashboard/DashboardCharts.tsx")).toContain("entry.nameAr");
  });

  it("prices and firm amounts go through the money formatter (item 5)", () => {
    // WP-B: both pages render plans through the one PlanCard, which formats every price.
    expect(read("client/src/components/marketing/PlanCard.tsx")).toContain(
      "formatMoneyParts(amount"
    );
    expect(read("client/src/pages/Pricing.tsx")).toContain("<PlanCard");
    expect(read("client/src/pages/MuhasibLanding.tsx")).toContain("<PlanCard");
    expect(read("client/src/pages/firm/portfolio/helpers.ts")).toContain("formatAedText");
    expect(read("client/src/pages/VATFiling.tsx")).not.toContain("formatCurrency(");
  });

  it("isolates the percentage in Arabic VAT labels and hides number spinners (item 11)", () => {
    const ar = JSON.parse(read("client/src/locales/ar/invoices.json"));
    expect(ar["invoices.supply.standard_rated"]).toContain("⁦5%⁩");
    expect(read("client/src/index.css")).toContain(
      'input[type="number"]::-webkit-inner-spin-button'
    );
  });

  it("segmented tabs fade at the clipped edge and snap (item 15)", () => {
    const src = read("client/src/components/ui/tabs.tsx");
    expect(src).toContain("maskImage");
    expect(src).toContain("snap-x");
  });

  it("invoice list derives an overdue badge and due column (item 18)", () => {
    const src = read("client/src/pages/Invoices.tsx");
    expect(src).toContain("invoiceOverdueDays");
    expect(src).toContain("invoices.colDue");
    for (const lang of ["en", "ar"]) {
      const cat = JSON.parse(read(`client/src/locales/${lang}/invoices.json`));
      for (const k of [
        "invoices.colDue",
        "invoices.colBalance",
        "invoices.overdueDays",
        "invoices.overdueDay",
      ]) {
        expect(cat[k]).toBeTruthy();
      }
    }
  });

  it("charts mirror in RTL (item 20)", () => {
    expect(read("client/src/pages/dashboard/DashboardCharts.tsx")).toContain(
      'reversed={locale === "ar"}'
    );
    expect(read("client/src/pages/dashboard/KpiCard.tsx")).toContain("reversed");
  });

  it("row-cards keep dates whole and elide document numbers in the middle (item 22)", () => {
    expect(read("client/src/styles/mobile.css")).toContain("[data-keep][data-keep]");
    expect(read("client/src/pages/BillPay.tsx")).toContain("MiddleTruncate");
  });

  it("mobile journal card keeps number and date on one line (item 3) and demo tabs form a 2x2 grid (item 4)", () => {
    expect(read("client/src/pages/Journal.tsx")).toContain(
      "whitespace-nowrap font-medium tabular-nums"
    );
    expect(read("client/src/pages/DemoWorkspace.tsx")).toContain(
      "grid-cols-2 gap-1 sm:grid-cols-4"
    );
  });

  it("KPI tiles stay equal height: the reconciliation bar overlays the tile (item 25)", () => {
    expect(read("client/src/components/ui/stat-card.tsx")).toContain("visualOverlay");
    expect(read("client/src/pages/BankReconciliation.tsx")).toContain("visualOverlay");
  });
});
