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

const migrationPaths = [
  {
    title: "Move from mazeed",
    steps: [
      "Export customers, suppliers, chart of accounts, invoices, bills, expenses, tax summaries, and report packs from mazeed.",
      "Choose a go-live date and keep pre-migration mazeed exports read-only for audit reference.",
      "Import contacts and start future invoices, receipts, and bank statements in Muhasib.ai.",
      "Recreate active recurring invoices, payment reminders, and approval routines after opening balances are agreed.",
      "Compare opening P&L, balance sheet, AR, AP, VAT, and corporate tax support schedules before using live books.",
    ],
  },
  {
    title: "Move from Wafeq",
    steps: [
      "Export customers, suppliers, invoices, bills, chart of accounts, and VAT reports from Wafeq.",
      "Import contacts through the customer contacts template.",
      "Set opening balances in the chart of accounts before posting new transactions.",
      "Import current-period bank statements and reconcile from the migration date forward.",
      "Keep historical Wafeq exports in Document Vault for audit reference.",
    ],
  },
  {
    title: "Move from Zoho Books",
    steps: [
      "Export customers, vendors, items, invoices, bills, credit notes, and account balances from Zoho.",
      "Map Zoho tax codes to UAE VAT treatment before importing live transactions.",
      "Use Muhasib.ai for future-period VAT workflows; keep prior Zoho filings as archived support.",
      "Recreate recurring invoices and payment reminders after the opening balance date.",
      "Validate P&L, balance sheet, AR, AP, and VAT control balances before go-live.",
    ],
  },
  {
    title: "Move from Excel",
    steps: [
      "Clean customer, supplier, invoice, receipt, and bank-statement sheets into one row per record.",
      "Use .xlsx or CSV files; legacy .xls files should be saved as .xlsx first.",
      "Create the company and review the default UAE chart of accounts.",
      "Import contacts and start new invoices/receipts from the go-live date.",
      "Attach prior spreadsheets in Document Vault for continuity.",
    ],
  },
];

const checklist = [
  "Pick a go-live date and stop editing old books after that date.",
  "Export all source-system reports before cancelling competitor accounts.",
  "Reconcile opening bank, AR, AP, VAT, and retained earnings balances.",
  "Run one test invoice, receipt, VAT summary, and bank import before live use.",
  "Keep source-system backups for the statutory retention period.",
];

export default function MigrationGuides() {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-background/95 backdrop-blur">
        <div className="container mx-auto flex h-16 max-w-6xl items-center justify-between px-4">
          <Link href="/" className="text-lg font-bold">
            Muhasib.ai
          </Link>
          <nav className="hidden items-center gap-6 text-sm text-muted-foreground md:flex">
            <Link href="/pricing" className="hover:text-foreground">
              Pricing
            </Link>
            <Link href="/trust" className="hover:text-foreground">
              Trust
            </Link>
            <Link href="/help" className="hover:text-foreground">
              Help
            </Link>
          </nav>
          <Link href="/register">
            <Button size="sm">Start Free</Button>
          </Link>
        </div>
      </header>

      <main>
        <section className="border-b bg-muted/30">
          <div className="container mx-auto max-w-6xl px-4 py-16">
            <Badge variant="outline" className="mb-5">
              Migration Guides
            </Badge>
            <h1 className="max-w-3xl text-4xl font-bold tracking-tight md:text-5xl">
              Switch from mazeed, Wafeq, Zoho Books, or Excel without losing audit trail.
            </h1>
            <p className="mt-5 max-w-2xl text-lg text-muted-foreground">
              Start clean from a go-live date, preserve old records, and validate balances before
              posting live transactions in Muhasib.ai.
            </p>
          </div>
        </section>

        <section className="container mx-auto max-w-6xl px-4 py-14">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {migrationPaths.map((path) => (
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
                Go-live checklist
              </h2>
              <p className="mt-3 text-muted-foreground">
                This checklist is the minimum we recommend before moving real books from another
                platform.
              </p>
            </div>
            <div className="grid gap-3">
              {checklist.map((item) => (
                <div key={item} className="flex gap-3 rounded-lg border bg-background p-4 text-sm">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
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
                  Supported import files
                </CardTitle>
              </CardHeader>
              <CardContent className="text-sm leading-6 text-muted-foreground">
                Customer/contact imports support .xlsx and CSV. Bank reconciliation supports CSV
                formats from Emirates NBD, ADCB, FAB, Mashreq, and generic statement layouts.
                Prior-system report packs from mazeed, Wafeq, Zoho Books, or Excel should be stored
                in Document Vault as read-only support files.
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <Landmark className="h-5 w-5 text-primary" />
                  Bank reconciliation after migration
                </CardTitle>
              </CardHeader>
              <CardContent className="text-sm leading-6 text-muted-foreground">
                Import bank statements from the go-live date forward, review suggested matches, and
                create journal entries only for transactions that are not already represented in the
                opening balances.
              </CardContent>
            </Card>
          </div>
          <div className="mt-8">
            <Link href="/register">
              <Button>
                Start Migration
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </Link>
          </div>
        </section>
      </main>
    </div>
  );
}
