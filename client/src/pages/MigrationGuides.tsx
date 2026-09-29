import { Link } from "wouter";
import {
  ArrowRight,
  CheckCircle2,
  ClipboardCheck,
  FileSpreadsheet,
  Landmark,
  Upload,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { messages as pageMessages } from "./MigrationGuides.i18n";

const getMigrationPaths = () => [
  {
    title: pageMessages.t("moveFromMazeed"),
    steps: [
      pageMessages.t("exportCustomersSuppliersChartOfAccounts"),
      pageMessages.t("chooseAGoLiveDateAnd"),
      pageMessages.t("importContactsAndStartFutureInvoices"),
      pageMessages.t("recreateActiveRecurringInvoicesPaymentReminders"),
      pageMessages.t("compareOpeningPLBalanceSheet"),
    ],
  },
  {
    title: pageMessages.t("moveFromWafeq"),
    steps: [
      pageMessages.t("exportCustomersSuppliersInvoicesBillsChart"),
      pageMessages.t("importContactsThroughTheCustomerContacts"),
      pageMessages.t("setOpeningBalancesInTheChart"),
      pageMessages.t("importCurrentPeriodBankStatementsAnd"),
      pageMessages.t("keepHistoricalWafeqExportsInDocument"),
    ],
  },
  {
    title: pageMessages.t("moveFromZohoBooks"),
    steps: [
      pageMessages.t("exportCustomersVendorsItemsInvoicesBills"),
      pageMessages.t("mapZohoTaxCodesToUae"),
      pageMessages.t("useMuhasibAiForFuturePeriod"),
      pageMessages.t("recreateRecurringInvoicesAndPaymentReminders"),
      pageMessages.t("validatePLBalanceSheetAr"),
    ],
  },
  {
    title: pageMessages.t("moveFromExcel"),
    steps: [
      pageMessages.t("cleanCustomerSupplierInvoiceReceiptAnd"),
      pageMessages.t("useXlsxOrCsvFilesLegacy"),
      pageMessages.t("createTheCompanyAndReviewThe"),
      pageMessages.t("importContactsAndStartNewInvoices"),
      pageMessages.t("attachPriorSpreadsheetsInDocumentVault"),
    ],
  },
];

const getChecklist = () => [
  pageMessages.t("pickAGoLiveDateAnd"),
  pageMessages.t("exportAllSourceSystemReportsBefore"),
  pageMessages.t("reconcileOpeningBankArApVat"),
  pageMessages.t("runOneTestInvoiceReceiptVat"),
  pageMessages.t("keepSourceSystemBackupsForThe"),
];

export default function MigrationGuides() {
  const tr = pageMessages.useT();

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-background/95 backdrop-blur">
        <div className="container mx-auto flex h-16 max-w-6xl items-center justify-between px-4">
          <Link href="/" className="text-lg font-bold">
            Muhasib.ai
          </Link>
          <nav className="hidden items-center gap-6 text-sm text-muted-foreground md:flex">
            <Link href="/pricing" className="hover:text-foreground">
              {tr("pricing")}
            </Link>
            <Link href="/trust" className="hover:text-foreground">
              {tr("trust")}
            </Link>
            <Link href="/help" className="hover:text-foreground">
              {tr("help")}
            </Link>
          </nav>
          <Link href="/register">
            <Button size="sm">{tr("startFree")}</Button>
          </Link>
        </div>
      </header>

      <main>
        <section className="border-b bg-muted/30">
          <div className="container mx-auto max-w-6xl px-4 py-16">
            <Badge variant="outline" className="mb-5">
              {tr("migrationGuides")}
            </Badge>
            <h1 className="max-w-3xl text-4xl font-bold tracking-tight md:text-5xl">
              {tr("switchFromMazeedWafeqZohoBooks")}
            </h1>
            <p className="mt-5 max-w-2xl text-lg text-muted-foreground">
              {tr("startCleanFromAGoLive")}
            </p>
          </div>
        </section>

        <section className="container mx-auto max-w-6xl px-4 py-14">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {getMigrationPaths().map((path) => (
              <Card key={path.title}>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-lg">
                    <Upload className="h-5 w-5 text-primary" />
                    {path.title}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ol className="space-y-3 text-sm text-muted-foreground">
                    {path.steps.map((step, index) => (
                      <li key={step} className="flex gap-3">
                        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs font-semibold text-foreground">
                          {index + 1}
                        </span>
                        <span>{step}</span>
                      </li>
                    ))}
                  </ol>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>

        <section className="border-y bg-muted/30">
          <div className="container mx-auto grid max-w-6xl gap-8 px-4 py-14 lg:grid-cols-[0.85fr_1.15fr]">
            <div>
              <h2 className="flex items-center gap-2 text-2xl font-semibold">
                <ClipboardCheck className="h-6 w-6 text-primary" />
                {tr("goLiveChecklist")}
              </h2>
              <p className="mt-3 text-muted-foreground">{tr("thisChecklistIsTheMinimumWe")}</p>
            </div>
            <div className="grid gap-3">
              {getChecklist().map((item) => (
                <div key={item} className="flex gap-3 rounded-lg border bg-background p-4 text-sm">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" />
                  <span className="text-muted-foreground">{item}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="container mx-auto max-w-6xl px-4 py-14">
          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <FileSpreadsheet className="h-5 w-5 text-primary" />
                  {tr("supportedImportFiles")}
                </CardTitle>
              </CardHeader>
              <CardContent className="text-sm leading-6 text-muted-foreground">
                {tr("customerContactImportsSupportXlsxAnd")}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <Landmark className="h-5 w-5 text-primary" />
                  {tr("bankReconciliationAfterMigration")}
                </CardTitle>
              </CardHeader>
              <CardContent className="text-sm leading-6 text-muted-foreground">
                {tr("importBankStatementsFromTheGo")}
              </CardContent>
            </Card>
          </div>
          <div className="mt-8">
            <Link href="/register">
              <Button>
                {tr("startMigration")}
                <ArrowRight className="ms-2 h-4 w-4" />
              </Button>
            </Link>
          </div>
        </section>
      </main>
    </div>
  );
}
