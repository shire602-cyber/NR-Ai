// Reports > Report Center panel (focused report tabs are lazy modules in ../tabs).
// Split out of Reports.tsx (W5-A, R20-09); state comes from useReportsPage via context.
import { StatementsQuickPanel } from "../StatementParts";
import type { ReportTab } from "@/lib/reportCatalog";
import { ReportCatalogue } from "./ReportCatalogue";
import { T } from "@/components/layout/T";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { format } from "date-fns";
import { lazy, Suspense } from "react";
import { ReportPanelFallback } from "../ReportPanelFallback";
import { useReportsPageContext } from "../context";

const ProfitLossTab = lazy(() => import("../tabs/ProfitLossTab"));
const BalanceSheetTab = lazy(() => import("../tabs/BalanceSheetTab"));
const VatTab = lazy(() => import("../tabs/VatTab"));
const CorporateTaxTab = lazy(() => import("../tabs/CorporateTaxTab"));
const SalesTab = lazy(() => import("../tabs/SalesTab"));
const BalancesTab = lazy(() => import("../tabs/BalancesTab"));
const ExpensesTab = lazy(() => import("../tabs/ExpensesTab"));
const PayrollTab = lazy(() => import("../tabs/PayrollTab"));
const TrialBalanceTab = lazy(() => import("../tabs/TrialBalanceTab"));
const LedgerTab = lazy(() => import("../tabs/LedgerTab"));
const CloseTab = lazy(() => import("../tabs/CloseTab"));
const PlanningTab = lazy(() => import("../tabs/PlanningTab"));

export default function ReportsPanel() {
  const {
    activeTab,
    dateRange,
    effectiveReportPersona,
    hasFocusedReportSelection,
    openReportViewerOption,
    reportViewerGroups,
    reportWorkspacePanelClass,
    selectedCompanyId,
    setActiveTab,
    setReportWorkspaceTab,
    t,
  } = useReportsPageContext();
  return (
    <>
      <div className={reportWorkspacePanelClass("reports", "space-y-6")}>
        {!hasFocusedReportSelection ? (
          <StatementsQuickPanel
            companyId={selectedCompanyId}
            from={dateRange.from ? format(dateRange.from, "yyyy-MM-dd") : undefined}
            to={dateRange.to ? format(dateRange.to, "yyyy-MM-dd") : undefined}
            onShowAdvanced={() => setReportWorkspaceTab("home")}
          />
        ) : null}
        {!hasFocusedReportSelection ? (
          <ReportCatalogue
            groups={reportViewerGroups}
            companyId={selectedCompanyId}
            from={dateRange.from ? format(dateRange.from, "yyyy-MM-dd") : undefined}
            to={dateRange.to ? format(dateRange.to, "yyyy-MM-dd") : undefined}
            onOpen={openReportViewerOption}
            ariaLabel={t["reportCenter.reportCenter"]}
          />
        ) : (
          <Tabs
            value={activeTab}
            onValueChange={(value) => setActiveTab(value as ReportTab, effectiveReportPersona)}
            className="space-y-6"
          >
            <TabsList className="sr-only">
              <TabsTrigger value="pl" data-testid="tab-profit-loss">
                {t.profitLoss}
              </TabsTrigger>
              <TabsTrigger value="bs" data-testid="tab-balance-sheet">
                {t.balanceSheet}
              </TabsTrigger>
              <TabsTrigger value="vat" data-testid="tab-vat-summary">
                {t.vatSummary}
              </TabsTrigger>
              <TabsTrigger value="tax" data-testid="tab-corporate-tax">
                <T k="reportCenter.corporateTax" />
              </TabsTrigger>
              <TabsTrigger value="sales" data-testid="tab-invoice-status">
                <T k="reportCenter.sales" />
              </TabsTrigger>
              <TabsTrigger value="balances" data-testid="tab-balance-summaries">
                <T k="reportCenter.balances" />
              </TabsTrigger>
              <TabsTrigger value="expenses" data-testid="tab-expense-reports">
                <T k="reportCenter.expenses" />
              </TabsTrigger>
              <TabsTrigger value="payroll" data-testid="tab-payroll-reports">
                <T k="reportCenter.payroll" />
              </TabsTrigger>
              <TabsTrigger value="trial" data-testid="tab-trial-balance">
                {t.trialBalance}
              </TabsTrigger>
              <TabsTrigger value="ledger" data-testid="tab-ledger-reports">
                <T k="reportCenter.ledger" />
              </TabsTrigger>
              <TabsTrigger value="close" data-testid="tab-month-end-close-status">
                <T k="reportCenter.close" />
              </TabsTrigger>
              <TabsTrigger value="planning" data-testid="tab-planning-reports">
                <T k="reportCenter.planning" />
              </TabsTrigger>
            </TabsList>

            <TabsContent value="pl" className="space-y-6">
              <Suspense fallback={<ReportPanelFallback />}>
                <ProfitLossTab />
              </Suspense>
            </TabsContent>

            <TabsContent value="bs">
              <Suspense fallback={<ReportPanelFallback />}>
                <BalanceSheetTab />
              </Suspense>
            </TabsContent>

            <TabsContent value="vat">
              <Suspense fallback={<ReportPanelFallback />}>
                <VatTab />
              </Suspense>
            </TabsContent>

            <TabsContent value="tax" className="space-y-6">
              <Suspense fallback={<ReportPanelFallback />}>
                <CorporateTaxTab />
              </Suspense>
            </TabsContent>

            <TabsContent value="sales" className="space-y-6">
              <Suspense fallback={<ReportPanelFallback />}>
                <SalesTab />
              </Suspense>
            </TabsContent>

            <TabsContent value="balances" className="space-y-6">
              <Suspense fallback={<ReportPanelFallback />}>
                <BalancesTab />
              </Suspense>
            </TabsContent>

            <TabsContent value="expenses" className="space-y-6">
              <Suspense fallback={<ReportPanelFallback />}>
                <ExpensesTab />
              </Suspense>
            </TabsContent>

            <TabsContent value="payroll" className="space-y-6">
              <Suspense fallback={<ReportPanelFallback />}>
                <PayrollTab />
              </Suspense>
            </TabsContent>

            <TabsContent value="trial" className="space-y-6">
              <Suspense fallback={<ReportPanelFallback />}>
                <TrialBalanceTab />
              </Suspense>
            </TabsContent>

            <TabsContent value="ledger" className="space-y-6">
              <Suspense fallback={<ReportPanelFallback />}>
                <LedgerTab />
              </Suspense>
            </TabsContent>

            <TabsContent value="close" className="space-y-6">
              <Suspense fallback={<ReportPanelFallback />}>
                <CloseTab />
              </Suspense>
            </TabsContent>

            <TabsContent value="planning" className="space-y-6">
              <Suspense fallback={<ReportPanelFallback />}>
                <PlanningTab />
              </Suspense>
            </TabsContent>
          </Tabs>
        )}
      </div>
    </>
  );
}
