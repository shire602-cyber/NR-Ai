import { Link } from "wouter";
import {
  ArrowRight,
  Banknote,
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
import { T } from "@/components/layout/T";
import { MarketingLayout } from "@/components/marketing/MarketingLayout";

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

const invoices = [
  {
    number: "INV-1042",
    customer: "Al Noor Retail FZCO",
    date: "12 Jun 2026",
    subtotal: 18500,
    vat: 925,
    total: 19425,
    status: "Paid",
  },
  {
    number: "INV-1043",
    customer: "Dhow Logistics LLC",
    date: "14 Jun 2026",
    subtotal: 9200,
    vat: 460,
    total: 9660,
    status: "Sent",
  },
  {
    number: "INV-1044",
    customer: "Palm Office Supplies",
    date: "15 Jun 2026",
    subtotal: 6300,
    vat: 315,
    total: 6615,
    status: "Draft",
  },
];

const bankLines = [
  {
    date: "15 Jun",
    description: "AL NOOR RETAIL FZCO",
    amount: 19425,
    match: "INV-1042",
    confidence: 96,
  },
  {
    date: "14 Jun",
    description: "ETISALAT UAE",
    amount: -1260,
    match: "Receipt RC-338",
    confidence: 91,
  },
  {
    date: "13 Jun",
    description: "ADCB BANK CHARGE",
    amount: -42,
    match: "Suggested expense",
    confidence: 78,
  },
];

const vatRows = [
  { box: "1b", label: "Dubai standard-rated supplies", amount: 340000, vat: 17000 },
  { box: "9", label: "Recoverable standard-rated expenses", amount: 118000, vat: 5900 },
  { box: "14", label: "Net VAT payable", amount: 0, vat: 11100 },
];

const closeChecklist = [
  "Chart of accounts seeded",
  "Opening bank account added",
  "Sample invoices and receipts reviewed",
  "Bank statement imported by CSV",
  "VAT 201 workbook ready for export",
];

export default function DemoWorkspace() {
  return (
    <MarketingLayout
      titleKey="marketing.seoDemoTitle"
      descriptionKey="marketing.seoDemoDescription"
    >
      <section className="mk-container" style={{ paddingBlock: "2.5rem 4rem" }}>
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl space-y-3">
            <Badge className="bg-[color:var(--brand-subtle)] text-[color:var(--brand-subtle-ink)] hover:bg-[color:var(--brand-subtle)]">
              <T k="pageLabels.sampleCompanyWorkspace" />
            </Badge>
            <h1 className="mk-h1" style={{ fontSize: "clamp(2rem, 1.4rem + 2vw, 3rem)" }}>
              <T k="pageLabels.seeTheSaaSProductWithRealAccountingContext" />
            </h1>
            <p className="max-w-2xl text-sm leading-6 text-[color:var(--ink-2)] sm:text-base">
              Explore a launch-ready UAE SME workflow using sample invoices, receipts, bank imports,
              reconciliation suggestions, VAT 201 figures, and corporate tax workpaper totals.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href="/register">
              <Button className="bg-[color:var(--brand)] text-[color:var(--on-brand)] hover:bg-[color:var(--brand-strong)]">
                <T k="pageLabels.createMyWorkspace" />
                <ArrowRight className="ms-2 h-4 w-4 rtl:-scale-x-100" />
              </Button>
            </Link>
            <Link href="/help">
              <Button variant="outline">
                <T k="pageLabels.viewHelpDocs" />
              </Button>
            </Link>
          </div>
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-4">
          {[
            { label: "Receivables", value: money(16275), icon: FileText },
            { label: "Bank matched", value: "89%", icon: Landmark },
            { label: "VAT payable", value: money(11100), icon: ShieldCheck },
            { label: "CT estimate", value: money(7425), icon: Banknote },
          ].map(({ label, value, icon: Icon }) => (
            <Card key={label} className="border-[color:var(--hairline)] bg-[color:var(--surface)]">
              <CardContent className="flex items-center justify-between p-4">
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-[color:var(--ink-3)]">
                    {label}
                  </p>
                  <p className="mt-1 font-mono text-xl font-semibold">{value}</p>
                </div>
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[color:var(--brand-subtle)]">
                  <Icon className="h-5 w-5 text-[color:var(--brand)]" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
          <section className="rounded-lg border border-[color:var(--hairline)] bg-[color:var(--surface)]">
            <div className="border-b border-[color:var(--hairline)] p-4 sm:p-5">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm font-semibold">{sampleCompany.name}</p>
                  <p className="text-xs text-[color:var(--ink-3)]">
                    TRN {sampleCompany.trn} · {sampleCompany.period}
                  </p>
                </div>
                <Badge variant="outline" className="w-fit">
                  <T k="pageLabels.demoData" />
                </Badge>
              </div>
            </div>

            <Tabs defaultValue="invoices" className="p-4 sm:p-5">
              <TabsList className="grid w-full grid-cols-4">
                <TabsTrigger value="invoices">
                  <T k="pages.invoices" />
                </TabsTrigger>
                <TabsTrigger value="banking">
                  <T k="pageLabels.banking" />
                </TabsTrigger>
                <TabsTrigger value="vat">VAT</TabsTrigger>
                <TabsTrigger value="ct">CT</TabsTrigger>
              </TabsList>

              <TabsContent value="invoices" className="mt-5 space-y-4">
                <div className="hidden overflow-x-auto rounded-md border md:block">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>
                          <T k="invoices.publicInvoice" />
                        </TableHead>
                        <TableHead>
                          <T k="pages.customer" />
                        </TableHead>
                        <TableHead>Date</TableHead>
                        <TableHead className="text-right">VAT</TableHead>
                        <TableHead className="text-right">
                          <T k="pages.total2" />
                        </TableHead>
                        <TableHead>
                          <T k="banking.common.status" />
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {invoices.map((invoice) => (
                        <TableRow key={invoice.number}>
                          <TableCell className="font-mono">{invoice.number}</TableCell>
                          <TableCell>{invoice.customer}</TableCell>
                          <TableCell>{invoice.date}</TableCell>
                          <TableCell className="text-right font-mono">
                            {money(invoice.vat)}
                          </TableCell>
                          <TableCell className="text-right font-mono">
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
                  {invoices.map((invoice) => (
                    <Card key={invoice.number} className="border-[color:var(--hairline)]">
                      <CardContent className="p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="font-mono text-sm font-semibold">{invoice.number}</p>
                            <p className="text-sm">{invoice.customer}</p>
                            <p className="text-xs text-[color:var(--ink-3)]">{invoice.date}</p>
                          </div>
                          <Badge variant={invoice.status === "Paid" ? "default" : "secondary"}>
                            {invoice.status}
                          </Badge>
                        </div>
                        <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
                          <div>
                            <p className="text-xs text-[color:var(--ink-3)]">VAT</p>
                            <p className="font-mono">{money(invoice.vat)}</p>
                          </div>
                          <div>
                            <p className="text-xs text-[color:var(--ink-3)]">
                              <T k="pages.total2" />
                            </p>
                            <p className="font-mono font-semibold">{money(invoice.total)}</p>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </TabsContent>

              <TabsContent value="banking" className="mt-5 space-y-4">
                <div className="rounded-lg border border-[color:var(--hairline)] bg-[color:var(--warning-subtle)] p-4">
                  <div className="flex items-center gap-2">
                    <Sparkles className="h-4 w-4 text-[color:var(--warning)]" />
                    <p className="text-sm font-medium">
                      <T k="pageLabels.cSVStatementImportNoLiveFeedNeeded" />
                    </p>
                  </div>
                  <p className="mt-1 text-sm text-[color:var(--ink-2)]">
                    Sample bank lines are matched against invoices, receipts, and expenses with
                    confidence scores before posting.
                  </p>
                </div>
                <div className="space-y-3">
                  {bankLines.map((line) => (
                    <div
                      key={`${line.date}-${line.description}`}
                      className="rounded-md border border-[color:var(--hairline)] p-4"
                    >
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <p className="font-medium">{line.description}</p>
                          <p className="text-xs text-[color:var(--ink-3)]">
                            {line.date} · Suggested match: {line.match}
                          </p>
                        </div>
                        <p
                          className={`font-mono font-semibold ${
                            line.amount >= 0
                              ? "text-[color:var(--brand)]"
                              : "text-[color:var(--danger)]"
                          }`}
                        >
                          {money(line.amount)}
                        </p>
                      </div>
                      <div className="mt-3 flex items-center gap-3">
                        <Progress value={line.confidence} className="h-2" />
                        <span className="w-12 text-right font-mono text-xs">
                          {line.confidence}%
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </TabsContent>

              <TabsContent value="vat" className="mt-5 space-y-4">
                <div className="grid gap-3">
                  {vatRows.map((row) => (
                    <div
                      key={row.box}
                      className="grid gap-3 rounded-md border border-[color:var(--hairline)] p-4 sm:grid-cols-[72px_minmax(0,1fr)_160px_160px]"
                    >
                      <Badge variant="outline" className="w-fit">
                        Box {row.box}
                      </Badge>
                      <p className="text-sm font-medium">{row.label}</p>
                      <p className="font-mono text-sm sm:text-right">{money(row.amount)}</p>
                      <p className="font-mono text-sm font-semibold sm:text-right">
                        {money(row.vat)}
                      </p>
                    </div>
                  ))}
                </div>
                <Button variant="outline" className="gap-2">
                  <Download className="h-4 w-4" />
                  Export VAT 201 workbook
                </Button>
              </TabsContent>

              <TabsContent value="ct" className="mt-5">
                <div className="grid gap-4 sm:grid-cols-3">
                  {[
                    ["Revenue", money(612000)],
                    ["Expenses", money(154500)],
                    ["Taxable above threshold", money(82500)],
                  ].map(([label, value]) => (
                    <Card key={label} className="border-[color:var(--hairline)]">
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm text-[color:var(--ink-3)]">{label}</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <p className="font-mono text-xl font-semibold">{value}</p>
                      </CardContent>
                    </Card>
                  ))}
                </div>
                <div className="mt-4 rounded-md border border-[color:var(--hairline)] p-4">
                  <p className="text-sm font-medium">
                    <T k="pageLabels.corporateTaxSupportSchedule" />
                  </p>
                  <p className="mt-1 text-sm text-[color:var(--ink-2)]">
                    Revenue and expense rows roll into a draft CT estimate and can be exported as an
                    Excel workpaper for accountant review.
                  </p>
                </div>
              </TabsContent>
            </Tabs>
          </section>

          <aside className="space-y-4">
            <Card className="border-[color:var(--hairline)] bg-[color:var(--surface)]">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <CheckCircle2 className="h-5 w-5 text-[color:var(--brand)]" />
                  <T k="pageLabels.launchChecklist" />
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {closeChecklist.map((item) => (
                  <div key={item} className="flex items-start gap-2 text-sm">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[color:var(--brand)]" />
                    <span>{item}</span>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card className="border-[color:var(--hairline)] bg-[color:var(--band)] text-white">
              <CardContent className="space-y-4 p-5">
                <Receipt className="h-8 w-8 text-[#4fcf98]" />
                <div>
                  <p className="font-semibold">
                    <T k="pageLabels.wantYourOwnBooksInThisShape" />
                  </p>
                  <p className="mt-1 text-sm text-white/65">
                    Register, create a company, then use express onboarding to seed the UAE chart of
                    accounts and start with guided setup.
                  </p>
                </div>
                <Link href="/register">
                  <Button className="w-full bg-white text-[#0E1320] hover:bg-white/90">
                    <T k="pageLabels.startSetup" />
                  </Button>
                </Link>
              </CardContent>
            </Card>
          </aside>
        </div>
      </section>
    </MarketingLayout>
  );
}
