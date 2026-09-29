import { Link } from "wouter";
import {
  ArrowRight,
  Banknote,
  Building2,
  CheckCircle2,
  Download,
  FileText,
  Landmark,
  Receipt,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { messages as pageMessages } from "./DemoWorkspace.i18n";
import { useTranslation } from "@/lib/i18n";
import { CALENDAR_DATE_SHORT_FORMAT, formatDate } from "@/lib/format";

const money = (value: number) =>
  `AED ${value.toLocaleString("en-AE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

const sampleCompany = {
  name: "Pearl Trading LLC",
  trn: "100000000000003",
  period: "Q2 2026",
};

const getInvoices = () => [
  {
    number: "INV-1042",
    customer: pageMessages.t("alNoorRetailFzco"),
    date: "2026-06-12",
    subtotal: 18500,
    vat: 925,
    total: 19425,
    status: "Paid",
  },
  {
    number: "INV-1043",
    customer: pageMessages.t("dhowLogisticsLlc"),
    date: "2026-06-14",
    subtotal: 9200,
    vat: 460,
    total: 9660,
    status: "Sent",
  },
  {
    number: "INV-1044",
    customer: pageMessages.t("palmOfficeSupplies"),
    date: "2026-06-15",
    subtotal: 6300,
    vat: 315,
    total: 6615,
    status: "Draft",
  },
];

const getBankLines = () => [
  {
    date: "2026-06-15",
    description: pageMessages.t("alNoorRetailFzco2"),
    amount: 19425,
    match: "INV-1042",
    confidence: 96,
  },
  {
    date: "2026-06-14",
    description: pageMessages.t("etisalatUae"),
    amount: -1260,
    match: pageMessages.t("receiptRc338"),
    confidence: 91,
  },
  {
    date: "2026-06-13",
    description: pageMessages.t("adcbBankCharge"),
    amount: -42,
    match: pageMessages.t("suggestedExpense"),
    confidence: 78,
  },
];

const getVatRows = () => [
  { box: "1b", label: pageMessages.t("dubaiStandardRatedSupplies"), amount: 340000, vat: 17000 },
  {
    box: "9",
    label: pageMessages.t("recoverableStandardRatedExpenses"),
    amount: 118000,
    vat: 5900,
  },
  { box: "14", label: pageMessages.t("netVatPayable"), amount: 0, vat: 11100 },
];

const getCloseChecklist = () => [
  pageMessages.t("chartOfAccountsSeeded"),
  pageMessages.t("openingBankAccountAdded"),
  pageMessages.t("sampleInvoicesAndReceiptsReviewed"),
  pageMessages.t("bankStatementImportedByCsv"),
  pageMessages.t("vat201WorkbookReadyForExport"),
];

export default function DemoWorkspace() {
  const tr = pageMessages.useT();
  const { locale } = useTranslation();
  const formatDemoDate = (iso: string, withYear = true) =>
    formatDate(iso, locale, withYear ? CALENDAR_DATE_SHORT_FORMAT : { ...CALENDAR_DATE_SHORT_FORMAT, year: undefined });

  return (
    <main className="min-h-screen bg-[#FAFAF6] text-[#131820]">
      <header className="border-b border-black/10 bg-[#FAFAF6]/95 sticky top-0 z-20">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6">
          <Link href="/" className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#0D5C3D]">
              <Building2 className="h-4 w-4 text-white" />
            </div>
            <span className="font-semibold">Muhasib.ai</span>
          </Link>
          <div className="flex items-center gap-2">
            <Link href="/pricing">
              <Button variant="ghost" size="sm">
                {tr("pricing")}
              </Button>
            </Link>
            <Link href="/register">
              <Button size="sm" className="bg-[#0D5C3D] text-white hover:bg-[#0A4A31]">
                {tr("startFree")}
              </Button>
            </Link>
          </div>
        </div>
      </header>

      <section className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl space-y-3">
            <Badge className="bg-[#E6F1EC] text-[#0D5C3D] hover:bg-[#E6F1EC]">
              {tr("sampleCompanyWorkspace")}
            </Badge>
            <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
              {tr("seeTheSaasProductWithReal")}
            </h1>
            <p className="max-w-2xl text-sm leading-6 text-black/65 sm:text-base">
              {tr("exploreALaunchReadyUaeSme")}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href="/register">
              <Button className="bg-[#0D5C3D] text-white hover:bg-[#0A4A31]">
                {tr("createMyWorkspace")}
                <ArrowRight className="ms-2 h-4 w-4" />
              </Button>
            </Link>
            <Link href="/help">
              <Button variant="outline">{tr("viewHelpDocs")}</Button>
            </Link>
          </div>
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-4">
          {[
            { label: tr("receivables"), value: money(16275), icon: FileText },
            { label: tr("bankMatched"), value: "89%", icon: Landmark },
            { label: tr("vatPayable"), value: money(11100), icon: ShieldCheck },
            { label: tr("ctEstimate"), value: money(7425), icon: Banknote },
          ].map(({ label, value, icon: Icon }) => (
            <Card key={label} className="border-black/10 bg-card">
              <CardContent className="flex items-center justify-between p-4">
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-black/50">
                    {label}
                  </p>
                  <p dir="ltr" className="mt-1 font-mono text-xl font-semibold">
                    {value}
                  </p>
                </div>
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#E6F1EC]">
                  <Icon className="h-5 w-5 text-[#0D5C3D]" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
          <section className="rounded-lg border border-black/10 bg-card">
            <div className="border-b border-black/10 p-4 sm:p-5">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm font-semibold">{sampleCompany.name}</p>
                  <p className="text-xs text-black/55">
                    {tr("trn", { trn: sampleCompany.trn, period: sampleCompany.period })}
                  </p>
                </div>
                <Badge variant="outline" className="w-fit">
                  {tr("demoData")}
                </Badge>
              </div>
            </div>

            <Tabs defaultValue="invoices" className="p-4 sm:p-5">
              <TabsList className="grid w-full grid-cols-4">
                <TabsTrigger value="invoices">{tr("invoices")}</TabsTrigger>
                <TabsTrigger value="banking">{tr("banking")}</TabsTrigger>
                <TabsTrigger value="vat">{tr("vat")}</TabsTrigger>
                <TabsTrigger value="ct">{tr("ct")}</TabsTrigger>
              </TabsList>

              <TabsContent value="invoices" className="mt-5 space-y-4">
                <div className="hidden overflow-x-auto rounded-md border md:block">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{tr("invoice")}</TableHead>
                        <TableHead>{tr("customer")}</TableHead>
                        <TableHead>{tr("date")}</TableHead>
                        <TableHead className="text-end">{tr("vat")}</TableHead>
                        <TableHead className="text-end">{tr("total")}</TableHead>
                        <TableHead>{tr("status")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {getInvoices().map((invoice) => (
                        <TableRow key={invoice.number}>
                          <TableCell className="font-mono">{invoice.number}</TableCell>
                          <TableCell>{invoice.customer}</TableCell>
                          <TableCell>{formatDemoDate(invoice.date)}</TableCell>
                          <TableCell className="text-end font-mono">{money(invoice.vat)}</TableCell>
                          <TableCell className="text-end font-mono">
                            {money(invoice.total)}
                          </TableCell>
                          <TableCell>
                            <Badge variant={invoice.status === "Paid" ? "default" : "secondary"}>
                              {invoice.status}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                <div className="grid gap-3 md:hidden">
                  {getInvoices().map((invoice) => (
                    <Card key={invoice.number} className="border-black/10">
                      <CardContent className="p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p dir="ltr" className="font-mono text-sm font-semibold">
                              {invoice.number}
                            </p>
                            <p className="text-sm">{invoice.customer}</p>
                            <p className="text-xs text-black/55">{formatDemoDate(invoice.date)}</p>
                          </div>
                          <Badge variant={invoice.status === "Paid" ? "default" : "secondary"}>
                            {invoice.status}
                          </Badge>
                        </div>
                        <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
                          <div>
                            <p className="text-xs text-black/50">{tr("vat")}</p>
                            <p dir="ltr" className="font-mono">
                              {money(invoice.vat)}
                            </p>
                          </div>
                          <div>
                            <p className="text-xs text-black/50">{tr("total")}</p>
                            <p dir="ltr" className="font-mono font-semibold">
                              {money(invoice.total)}
                            </p>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </TabsContent>

              <TabsContent value="banking" className="mt-5 space-y-4">
                <div className="rounded-lg border border-[#C19E50]/30 bg-[#FFF8E6] p-4">
                  <div className="flex items-center gap-2">
                    <Sparkles className="h-4 w-4 text-[#9A762A]" />
                    <p className="text-sm font-medium">{tr("csvStatementImportNoLiveFeed")}</p>
                  </div>
                  <p className="mt-1 text-sm text-black/60">
                    {tr("sampleBankLinesAreMatchedAgainst")}
                  </p>
                </div>
                <div className="space-y-3">
                  {getBankLines().map((line) => (
                    <div
                      key={`${line.date}-${line.description}`}
                      className="rounded-md border border-black/10 p-4"
                    >
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <p className="font-medium">{line.description}</p>
                          <p className="text-xs text-black/55">
                            {tr("suggestedMatch", { date: formatDemoDate(line.date, false), match: line.match })}
                          </p>
                        </div>
                        <p
                          dir="ltr"
                          className={`font-mono font-semibold ${
                            line.amount >= 0 ? "text-[#0D5C3D]" : "text-[#B5392B]"
                          }`}
                        >
                          {money(line.amount)}
                        </p>
                      </div>
                      <div className="mt-3 flex items-center gap-3">
                        <Progress value={line.confidence} className="h-2" />
                        <span className="w-12 text-end font-mono text-xs">{line.confidence}%</span>
                      </div>
                    </div>
                  ))}
                </div>
              </TabsContent>

              <TabsContent value="vat" className="mt-5 space-y-4">
                <div className="grid gap-3">
                  {getVatRows().map((row) => (
                    <div
                      key={row.box}
                      className="grid gap-3 rounded-md border border-black/10 p-4 sm:grid-cols-[72px_minmax(0,1fr)_160px_160px]"
                    >
                      <Badge variant="outline" className="w-fit">
                        {tr("box", { box: row.box })}
                      </Badge>
                      <p className="text-sm font-medium">{row.label}</p>
                      <p className="font-mono text-sm sm:text-end">{money(row.amount)}</p>
                      <p className="font-mono text-sm font-semibold sm:text-end">
                        {money(row.vat)}
                      </p>
                    </div>
                  ))}
                </div>
                <Button variant="outline" className="gap-2">
                  <Download className="h-4 w-4" />
                  {tr("exportVat201Workbook")}
                </Button>
              </TabsContent>

              <TabsContent value="ct" className="mt-5">
                <div className="grid gap-4 sm:grid-cols-3">
                  {[
                    [tr("revenue"), money(612000)],
                    [tr("expenses"), money(154500)],
                    [tr("taxableAboveThreshold"), money(82500)],
                  ].map(([label, value]) => (
                    <Card key={label} className="border-black/10">
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm text-black/55">{label}</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <p dir="ltr" className="font-mono text-xl font-semibold">
                          {value}
                        </p>
                      </CardContent>
                    </Card>
                  ))}
                </div>
                <div className="mt-4 rounded-md border border-black/10 p-4">
                  <p className="text-sm font-medium">{tr("corporateTaxSupportSchedule")}</p>
                  <p className="mt-1 text-sm text-black/60">
                    {tr("revenueAndExpenseRowsRollInto")}
                  </p>
                </div>
              </TabsContent>
            </Tabs>
          </section>

          <aside className="space-y-4">
            <Card className="border-black/10 bg-card">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <CheckCircle2 className="h-5 w-5 text-[#0D5C3D]" />
                  {tr("launchChecklist")}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {getCloseChecklist().map((item) => (
                  <div key={item} className="flex items-start gap-2 text-sm">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[#0D5C3D]" />
                    <span>{item}</span>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card className="border-black/10 bg-[#0E1320] text-white">
              <CardContent className="space-y-4 p-5">
                <Receipt className="h-8 w-8 text-[#C19E50]" />
                <div>
                  <p className="font-semibold">{tr("wantYourOwnBooksInThis")}</p>
                  <p className="mt-1 text-sm text-white/65">
                    {tr("registerCreateACompanyThenUse")}
                  </p>
                </div>
                <Link href="/register">
                  <Button className="w-full bg-card text-[#0E1320] hover:bg-card/90">
                    {tr("startSetup")}
                  </Button>
                </Link>
              </CardContent>
            </Card>
          </aside>
        </div>
      </section>
    </main>
  );
}
