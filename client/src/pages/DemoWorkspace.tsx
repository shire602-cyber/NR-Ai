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
import { Money, MoneyCell } from "@/components/ui/money";
import { Progress } from "@/components/ui/progress";
import { StatusBadge, type StatusTone } from "@/components/ui/status-badge";
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
import { formatDate } from "@/lib/format";
import { formatMessage, useTranslation } from "@/lib/i18n";

// Sample data only (the same fictional company as the landing page previews).
// Names, TRN and bank narratives are sample records, so they are marked
// translate="no"; every label around them comes from the marketing catalog.
const sampleCompany = {
  name: "Pearl Trading LLC",
  trn: "100000000000003",
  period: "Q2 2026",
};

type InvoiceStatus = "paid" | "sent" | "draft";

const STATUS_TONE: Record<InvoiceStatus, StatusTone> = {
  paid: "success",
  sent: "info",
  draft: "neutral",
};

const invoices: {
  number: string;
  customer: string;
  date: string;
  vat: number;
  total: number;
  status: InvoiceStatus;
}[] = [
  {
    number: "INV-1042",
    customer: "Al Noor Retail FZCO",
    date: "2026-06-12",
    vat: 925,
    total: 19425,
    status: "paid",
  },
  {
    number: "INV-1043",
    customer: "Dhow Logistics LLC",
    date: "2026-06-14",
    vat: 460,
    total: 9660,
    status: "sent",
  },
  {
    number: "INV-1044",
    customer: "Palm Office Supplies",
    date: "2026-06-15",
    vat: 315,
    total: 6615,
    status: "draft",
  },
];

const bankLines = [
  {
    date: "2026-06-15",
    description: "AL NOOR RETAIL FZCO",
    amount: 19425,
    match: { kind: "invoice", ref: "INV-1042" },
    confidence: 96,
  },
  {
    date: "2026-06-14",
    description: "ETISALAT UAE",
    amount: -1260,
    match: { kind: "receipt", ref: "RC-338" },
    confidence: 91,
  },
  {
    date: "2026-06-13",
    description: "ADCB BANK CHARGE",
    amount: -42,
    match: { kind: "expense", ref: "" },
    confidence: 78,
  },
] as const;

const vatRows = [
  { box: "1b", key: "marketing.demoVatRow1b", amount: 340000, vat: 17000 },
  { box: "9", key: "marketing.demoVatRow9", amount: 118000, vat: 5900 },
  { box: "14", key: "marketing.demoVatRow14", amount: null, vat: 11100 },
];

const CHECKLIST = [1, 2, 3, 4, 5];

export default function DemoWorkspace() {
  const { t, locale } = useTranslation();
  const statusLabel = (status: InvoiceStatus) =>
    t[`marketing.status${status[0].toUpperCase()}${status.slice(1)}`];
  const matchLabel = (match: (typeof bankLines)[number]["match"]) =>
    match.kind === "invoice"
      ? match.ref
      : match.kind === "receipt"
        ? formatMessage(t["marketing.demoMatchReceipt"], { number: match.ref })
        : t["marketing.demoMatchExpense"];

  return (
    <MarketingLayout
      titleKey="marketing.seoDemoTitle"
      descriptionKey="marketing.seoDemoDescription"
    >
      <section className="mk-container" style={{ paddingBlock: "2.5rem 4rem" }}>
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl space-y-3">
            <StatusBadge tone="accent">
              <T k="pageLabels.sampleCompanyWorkspace" />
            </StatusBadge>
            <h1 className="mk-h1">
              <T k="pageLabels.seeTheSaaSProductWithRealAccountingContext" />
            </h1>
            <p className="max-w-2xl text-body text-muted-foreground">{t["marketing.demoLead"]}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button asChild size="lg">
              <Link href="/register">
                <T k="pageLabels.createMyWorkspace" />
                <ArrowRight className="rtl:-scale-x-100" aria-hidden="true" />
              </Link>
            </Button>
            <Button asChild variant="outline" size="lg">
              <Link href="/help">
                <T k="pageLabels.viewHelpDocs" />
              </Link>
            </Button>
          </div>
        </div>

        <div className="mt-8 grid grid-cols-2 gap-4 md:grid-cols-4">
          {[
            { key: "marketing.demoKpiReceivables", amount: 16275, icon: FileText },
            { key: "marketing.demoKpiBankMatched", percent: 89, icon: Landmark },
            { key: "marketing.demoKpiVat", amount: 11100, icon: ShieldCheck },
            { key: "marketing.demoKpiCt", amount: 7425, icon: Banknote },
          ].map(({ key, amount, percent, icon: Icon }) => (
            <Card key={key}>
              <CardContent className="flex items-start justify-between gap-3 p-4 md:p-5">
                <div className="min-w-0">
                  <p className="text-small text-muted-foreground">{t[key]}</p>
                  <p className="mt-1 text-h2 font-semibold">
                    {amount !== undefined ? (
                      <Money amount={amount} />
                    ) : (
                      <span className="money">{`${percent}%`}</span>
                    )}
                  </p>
                </div>
                <Icon className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden="true" />
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
          <section className="rounded-xl border bg-card">
            <div className="border-b p-4 sm:p-5">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm font-semibold" translate="no">
                    {sampleCompany.name}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    <span className="tabular-nums">
                      {formatMessage(t["marketing.demoTrn"], {
                        trn: sampleCompany.trn,
                        period: sampleCompany.period,
                      })}
                    </span>
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
                <TabsTrigger value="vat">{t["marketing.demoTabVat"]}</TabsTrigger>
                <TabsTrigger value="ct">{t["marketing.demoTabCt"]}</TabsTrigger>
              </TabsList>

              <TabsContent value="invoices" className="mt-5 space-y-4">
                <div className="hidden overflow-x-auto rounded-lg border md:block">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>
                          <T k="invoices.publicInvoice" />
                        </TableHead>
                        <TableHead>
                          <T k="pages.customer" />
                        </TableHead>
                        <TableHead>{t["marketing.demoColDate"]}</TableHead>
                        <TableHead data-numeric="" className="text-end">
                          {t["marketing.demoColVat"]}
                        </TableHead>
                        <TableHead data-numeric="" className="text-end">
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
                          <TableCell className="whitespace-nowrap tabular-nums" dir="ltr">
                            {invoice.number}
                          </TableCell>
                          <TableCell translate="no">{invoice.customer}</TableCell>
                          <TableCell className="whitespace-nowrap">
                            {formatDate(invoice.date, locale)}
                          </TableCell>
                          <MoneyCell amount={invoice.vat} />
                          <MoneyCell amount={invoice.total} />
                          <TableCell>
                            <StatusBadge tone={STATUS_TONE[invoice.status]}>
                              {statusLabel(invoice.status)}
                            </StatusBadge>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                <div className="grid gap-3 md:hidden">
                  {invoices.map((invoice) => (
                    <div key={invoice.number} className="rounded-lg border p-4">
                      <div className="flex items-start justify-between gap-3">
                        <p className="min-w-0 truncate text-sm font-medium" translate="no">
                          {invoice.customer}
                        </p>
                        <Money amount={invoice.total} className="text-sm font-semibold" />
                      </div>
                      <div className="mt-2 flex items-center justify-between gap-3">
                        <p className="text-xs text-muted-foreground">
                          <span dir="ltr" className="tabular-nums">
                            {invoice.number}
                          </span>
                          {" · "}
                          {formatDate(invoice.date, locale)}
                        </p>
                        <StatusBadge tone={STATUS_TONE[invoice.status]}>
                          {statusLabel(invoice.status)}
                        </StatusBadge>
                      </div>
                    </div>
                  ))}
                </div>
              </TabsContent>

              <TabsContent value="banking" className="mt-5 space-y-4">
                <div className="rounded-lg border bg-warning-subtle p-4 text-warning-subtle-foreground">
                  <div className="flex items-center gap-2">
                    <Sparkles className="h-4 w-4" aria-hidden="true" />
                    <p className="text-sm font-medium">
                      <T k="pageLabels.cSVStatementImportNoLiveFeedNeeded" />
                    </p>
                  </div>
                  <p className="mt-1 text-sm">{t["marketing.demoBankBody"]}</p>
                </div>
                <div className="divide-hairline rounded-lg border">
                  {bankLines.map((line) => (
                    <div key={`${line.date}-${line.description}`} className="p-4">
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                        <div className="min-w-0">
                          <p className="truncate font-medium" translate="no" dir="ltr">
                            {line.description}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {formatDate(line.date, locale)}
                            {" · "}
                            {formatMessage(t["marketing.demoSuggestedMatch"], {
                              match: matchLabel(line.match),
                            })}
                          </p>
                        </div>
                        <Money amount={line.amount} tone="auto" className="font-semibold" />
                      </div>
                      <div className="mt-3 flex items-center gap-3">
                        <Progress
                          value={line.confidence}
                          className="h-1.5"
                          aria-label={t["marketing.demoConfidence"]}
                        />
                        <span className="money w-10 text-end text-xs text-muted-foreground">
                          {`${line.confidence}%`}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </TabsContent>

              <TabsContent value="vat" className="mt-5 space-y-4">
                <div className="divide-hairline rounded-lg border">
                  {vatRows.map((row) => (
                    <div
                      key={row.box}
                      className="grid items-center gap-2 p-4 sm:grid-cols-[88px_minmax(0,1fr)_140px_140px]"
                    >
                      <Badge variant="outline" className="w-fit">
                        {formatMessage(t["marketing.demoBox"], { box: row.box })}
                      </Badge>
                      <p className="text-sm font-medium">{t[row.key]}</p>
                      <p className="text-sm sm:text-end">
                        {row.amount === null ? "" : <Money amount={row.amount} />}
                      </p>
                      <p className="text-sm font-semibold sm:text-end">
                        <Money amount={row.vat} />
                      </p>
                    </div>
                  ))}
                </div>
                <Button variant="outline">
                  <Download aria-hidden="true" />
                  {t["marketing.demoVatExport"]}
                </Button>
              </TabsContent>

              <TabsContent value="ct" className="mt-5">
                <div className="grid gap-4 sm:grid-cols-3">
                  {[
                    ["marketing.demoCtRevenue", 612000],
                    ["marketing.demoCtExpenses", 154500],
                    ["marketing.demoCtTaxable", 82500],
                  ].map(([key, amount]) => (
                    <div key={key} className="rounded-lg border p-4">
                      <p className="text-small text-muted-foreground">{t[key as string]}</p>
                      <p className="mt-1 text-h2 font-semibold">
                        <Money amount={amount as number} />
                      </p>
                    </div>
                  ))}
                </div>
                <div className="mt-4 rounded-lg border bg-surface-sunken p-4">
                  <p className="text-sm font-medium">
                    <T k="pageLabels.corporateTaxSupportSchedule" />
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">{t["marketing.demoCtBody"]}</p>
                </div>
              </TabsContent>
            </Tabs>
          </section>

          <aside className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <CheckCircle2 className="h-5 w-5 text-success" aria-hidden="true" />
                  <T k="pageLabels.launchChecklist" />
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {CHECKLIST.map((n) => (
                  <div key={n} className="flex items-start gap-2 text-sm">
                    <CheckCircle2
                      className="mt-0.5 h-4 w-4 shrink-0 text-success"
                      aria-hidden="true"
                    />
                    <span>{t[`marketing.demoCheck${n}`]}</span>
                  </div>
                ))}
              </CardContent>
            </Card>

            <div className="mk-demo-cta rounded-xl p-5">
              <Receipt className="h-6 w-6" aria-hidden="true" />
              <p className="mt-4 font-semibold">
                <T k="pageLabels.wantYourOwnBooksInThisShape" />
              </p>
              <p className="mt-1 text-sm">{t["marketing.demoOwnBody"]}</p>
              <Button asChild size="lg" className="mt-4 w-full">
                <Link href="/register">
                  <T k="pageLabels.startSetup" />
                </Link>
              </Button>
            </div>
          </aside>
        </div>
      </section>
    </MarketingLayout>
  );
}
