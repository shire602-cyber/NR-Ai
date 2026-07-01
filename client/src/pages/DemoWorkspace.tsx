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
                Pricing
              </Button>
            </Link>
            <Link href="/register">
              <Button size="sm" className="bg-[#0D5C3D] text-white hover:bg-[#0A4A31]">
                Start Free
              </Button>
            </Link>
          </div>
        </div>
      </header>

      <section className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl space-y-3">
            <Badge className="bg-[#E6F1EC] text-[#0D5C3D] hover:bg-[#E6F1EC]">
              Sample company workspace
            </Badge>
            <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
              See the SaaS product with real accounting context.
            </h1>
            <p className="max-w-2xl text-sm leading-6 text-black/65 sm:text-base">
              Explore a launch-ready UAE SME workflow using sample invoices, receipts, bank imports,
              reconciliation suggestions, VAT 201 figures, and corporate tax workpaper totals.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href="/register">
              <Button className="bg-[#0D5C3D] text-white hover:bg-[#0A4A31]">
                Create My Workspace
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </Link>
            <Link href="/help">
              <Button variant="outline">View Help Docs</Button>
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
            <Card key={label} className="border-black/10 bg-card">
              <CardContent className="flex items-center justify-between p-4">
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-black/50">
                    {label}
                  </p>
                  <p className="mt-1 font-mono text-xl font-semibold">{value}</p>
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
                    TRN {sampleCompany.trn} · {sampleCompany.period}
                  </p>
                </div>
                <Badge variant="outline" className="w-fit">
                  Demo data
                </Badge>
              </div>
            </div>

            <Tabs defaultValue="invoices" className="p-4 sm:p-5">
              <TabsList className="grid w-full grid-cols-4">
                <TabsTrigger value="invoices">Invoices</TabsTrigger>
                <TabsTrigger value="banking">Banking</TabsTrigger>
                <TabsTrigger value="vat">VAT</TabsTrigger>
                <TabsTrigger value="ct">CT</TabsTrigger>
              </TabsList>

              <TabsContent value="invoices" className="mt-5 space-y-4">
                <div className="hidden overflow-x-auto rounded-md border md:block">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Invoice</TableHead>
                        <TableHead>Customer</TableHead>
                        <TableHead>Date</TableHead>
                        <TableHead className="text-right">VAT</TableHead>
                        <TableHead className="text-right">Total</TableHead>
                        <TableHead>Status</TableHead>
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
                    <Card key={invoice.number} className="border-black/10">
                      <CardContent className="p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="font-mono text-sm font-semibold">{invoice.number}</p>
                            <p className="text-sm">{invoice.customer}</p>
                            <p className="text-xs text-black/55">{invoice.date}</p>
                          </div>
                          <Badge variant={invoice.status === "Paid" ? "default" : "secondary"}>
                            {invoice.status}
                          </Badge>
                        </div>
                        <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
                          <div>
                            <p className="text-xs text-black/50">VAT</p>
                            <p className="font-mono">{money(invoice.vat)}</p>
                          </div>
                          <div>
                            <p className="text-xs text-black/50">Total</p>
                            <p className="font-mono font-semibold">{money(invoice.total)}</p>
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
                    <p className="text-sm font-medium">CSV statement import, no live feed needed</p>
                  </div>
                  <p className="mt-1 text-sm text-black/60">
                    Sample bank lines are matched against invoices, receipts, and expenses with
                    confidence scores before posting.
                  </p>
                </div>
                <div className="space-y-3">
                  {bankLines.map((line) => (
                    <div
                      key={`${line.date}-${line.description}`}
                      className="rounded-md border border-black/10 p-4"
                    >
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <p className="font-medium">{line.description}</p>
                          <p className="text-xs text-black/55">
                            {line.date} · Suggested match: {line.match}
                          </p>
                        </div>
                        <p
                          className={`font-mono font-semibold ${
                            line.amount >= 0 ? "text-[#0D5C3D]" : "text-[#B5392B]"
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
                      className="grid gap-3 rounded-md border border-black/10 p-4 sm:grid-cols-[72px_minmax(0,1fr)_160px_160px]"
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
                    <Card key={label} className="border-black/10">
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm text-black/55">{label}</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <p className="font-mono text-xl font-semibold">{value}</p>
                      </CardContent>
                    </Card>
                  ))}
                </div>
                <div className="mt-4 rounded-md border border-black/10 p-4">
                  <p className="text-sm font-medium">Corporate tax support schedule</p>
                  <p className="mt-1 text-sm text-black/60">
                    Revenue and expense rows roll into a draft CT estimate and can be exported as an
                    Excel workpaper for accountant review.
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
                  Launch checklist
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {closeChecklist.map((item) => (
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
                  <p className="font-semibold">Want your own books in this shape?</p>
                  <p className="mt-1 text-sm text-white/65">
                    Register, create a company, then use express onboarding to seed the UAE chart of
                    accounts and start with guided setup.
                  </p>
                </div>
                <Link href="/register">
                  <Button className="w-full bg-card text-[#0E1320] hover:bg-card/90">
                    Start setup
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
