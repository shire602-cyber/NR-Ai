import { Link } from "wouter";
import { T } from "@/components/layout/T";
import { MarketingLayout } from "@/components/marketing/MarketingLayout";
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
      "Load the Wafeq chart of accounts, trial balance, contacts and items CSVs in the Import data wizard (preview, validate, commit).",
      "Post opening balances as one balanced opening entry on your cut-over date, with open invoices and bills tied to A/R and A/P.",
      "Import current-period bank statements and reconcile from the migration date forward.",
      "Keep historical Wafeq exports in Document Vault for audit reference.",
    ],
  },
  {
    title: "Move from Zoho Books",
    steps: [
      "Export customers, vendors, items, invoices, bills, credit notes, and account balances from Zoho.",
      "Import the Zoho trial balance, contacts, vendors, items, open invoices and open bills through the Import data wizard.",
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

const importedSystems = [
  {
    title: "Move from Xero or QuickBooks Online",
    steps: [
      "Export the chart of accounts, trial balance at your cut-over date, contacts, items, aged receivables and aged payables as CSV.",
      "Open Import data after signing in and pick the source system: column layouts are mapped automatically.",
      "Validate shows unknown accounts, unbalanced totals and control-account differences before anything is posted.",
      "Commit posts one balanced opening entry and creates open invoices and bills so A/R and A/P tie to the control accounts.",
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
    <MarketingLayout
      titleKey="marketing.seoMigrationTitle"
      descriptionKey="marketing.seoMigrationDescription"
    >
      <>
        <section className="mk-pagehead">
          <div className="mk-container">
            <p className="mk-eyebrow">
              <T k="pageLabels.migrationGuides" />
            </p>
            <h1 className="mk-h1">
              Switch from mazeed, Wafeq, Zoho Books, or Excel without losing audit trail.
            </h1>
            <p className="mk-lead">
              Start clean from a go-live date, preserve old records, and validate balances before
              posting live transactions in Muhasib.ai.
            </p>
          </div>
        </section>

        <section className="mk-container mk-inner-section">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {[...importedSystems, ...migrationPaths].map((path) => (
              <Card key={path.title} className="mk-surface-card">
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

        <section className="mk-section--sunken">
          <div className="container mx-auto grid max-w-6xl gap-8 px-4 py-14 lg:grid-cols-[0.85fr_1.15fr]">
            <div>
              <h2 className="flex items-center gap-2 text-2xl font-semibold">
                <ClipboardCheck className="h-6 w-6 text-primary" />
                <T k="pageLabels.goLiveChecklist" />
              </h2>
              <p className="mt-3 text-muted-foreground">
                This checklist is the minimum we recommend before moving real books from another
                platform.
              </p>
            </div>
            <div className="grid gap-3">
              {checklist.map((item) => (
                <div key={item} className="flex gap-3 rounded-lg border bg-background p-4 text-sm">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" />
                  <span className="text-muted-foreground">{item}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="mk-container mk-inner-section">
          <div className="grid gap-4 md:grid-cols-2">
            <Card className="mk-surface-card">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <FileSpreadsheet className="h-5 w-5 text-primary" />
                  <T k="pageLabels.supportedImportFiles" />
                </CardTitle>
              </CardHeader>
              <CardContent className="text-sm leading-6 text-muted-foreground">
                The Import data wizard loads CSV exports from Xero, QuickBooks Online, Zoho Books
                and Wafeq: chart of accounts, opening trial balance, customers, vendors, items, open
                invoices and open bills. Bank reconciliation supports CSV formats from Emirates NBD,
                ADCB, FAB, Mashreq, and generic statement layouts. Prior-system report packs from
                mazeed, Wafeq, Zoho Books, or Excel should be stored in Document Vault as read-only
                support files.
              </CardContent>
            </Card>
            <Card className="mk-surface-card">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <Landmark className="h-5 w-5 text-primary" />
                  <T k="pageLabels.bankReconciliationAfterMigration" />
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
                <T k="pageLabels.startMigration" />
                <ArrowRight className="ms-2 h-4 w-4 rtl:-scale-x-100" />
              </Button>
            </Link>
          </div>
        </section>
      </>
    </MarketingLayout>
  );
}
