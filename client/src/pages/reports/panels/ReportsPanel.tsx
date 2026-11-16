// Reports > Report Center panel (focused report tabs are lazy modules in ../tabs).
// Split out of Reports.tsx (W5-A, R20-09); state comes from useReportsPage via context.
import { ArrowRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import { DataBasisBadge, StatementsQuickPanel } from "../StatementParts";
import { type ReportTab, reportCatalogDataBasis } from "@/lib/reportCatalog";
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
          <section
            className="grid items-start gap-4 md:grid-cols-2 xl:grid-cols-3"
            aria-label={t["reportCenter.reportCenter"]}
          >
            {reportViewerGroups.map((group) => (
              <Card key={group.category} className="overflow-hidden">
                <div className="flex items-baseline justify-between gap-3 px-5 pb-2 pt-4">
                  <h2 className="text-h3 font-semibold text-foreground">{group.label}</h2>
                  <span className="text-caption tabular-nums text-muted-foreground">
                    {group.options.length}
                  </span>
                </div>
                <div className="divide-hairline">
                  {group.options.map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      disabled={!option.href && !option.tab}
                      onClick={() => openReportViewerOption(option.id)}
                      className="group/report flex w-full items-center justify-between gap-3 px-5 py-2.5 text-start transition-colors duration-fast hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
                      data-testid={`button-report-center-${option.id}`}
                    >
                      <span className="min-w-0">
                        <span className="flex items-center gap-2">
                          <span className="block truncate text-body font-medium text-foreground">
                            {option.label}
                          </span>
                          <DataBasisBadge
                            basis={
                              option.reportId ? reportCatalogDataBasis(option.reportId) : undefined
                            }
                          />
                        </span>
                        <span
                          className="mt-0.5 block line-clamp-1 text-caption text-muted-foreground"
                          title={option.description}
                        >
                          {option.description}
                        </span>
                      </span>
                      <ArrowRight
                        className="h-4 w-4 shrink-0 text-muted-foreground opacity-60 transition-[opacity,transform] duration-fast group-hover/report:translate-x-0.5 group-hover/report:opacity-100 rtl:-scale-x-100 rtl:group-hover/report:-translate-x-0.5"
                        aria-hidden
                      />
                    </button>
                  ))}
                </div>
              </Card>
            ))}
          </section>
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
