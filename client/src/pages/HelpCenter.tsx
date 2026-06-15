import { Link } from "wouter";
import {
  ArrowRight,
  Banknote,
  BookOpen,
  FileSpreadsheet,
  HelpCircle,
  LifeBuoy,
  Mail,
  Receipt,
  ShieldCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

const guides = [
  {
    icon: BookOpen,
    title: "Set up your company",
    text: "Add trade license details, TRN, emirate, fiscal year, currency, and the UAE chart of accounts.",
  },
  {
    icon: Receipt,
    title: "Create VAT-ready invoices",
    text: "Create invoices, credit notes, payment records, and downloadable PDFs with clear VAT totals.",
  },
  {
    icon: FileSpreadsheet,
    title: "Import receipts and contacts",
    text: "Upload receipts, export to Excel, and import customers from .xlsx or CSV templates.",
  },
  {
    icon: Banknote,
    title: "Reconcile bank statements",
    text: "Import CSV/PDF statements, review suggested matches, and create entries for unmatched transactions.",
  },
];

const slaItems = [
  "Launch onboarding support for setup, migration, VAT workflow questions, and first-month close.",
  "Email support for free and starter users; priority onboarding support for professional and enterprise users.",
  "Enterprise support terms, response windows, and uptime commitments are confirmed during activation.",
  "Critical accounting workflow issues are triaged ahead of feature requests during launch.",
];

export default function HelpCenter() {
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
            <Link href="/migration-guides" className="hover:text-foreground">
              Migrate
            </Link>
          </nav>
          <a href="mailto:support@muhasib.ai?subject=Muhasib.ai%20support">
            <Button size="sm" variant="outline">
              Contact Support
            </Button>
          </a>
        </div>
      </header>

      <main>
        <section className="border-b bg-muted/30">
          <div className="container mx-auto max-w-6xl px-4 py-16">
            <Badge variant="outline" className="mb-5">
              Help Center
            </Badge>
            <h1 className="max-w-3xl text-4xl font-bold tracking-tight md:text-5xl">
              Launch support for UAE accounting teams moving fast.
            </h1>
            <p className="mt-5 max-w-2xl text-lg text-muted-foreground">
              Practical setup guides for invoices, VAT workflows, bank reconciliation, imports, and
              month-end routines. During launch, paid plans are activated with guided onboarding.
            </p>
          </div>
        </section>

        <section className="container mx-auto max-w-6xl px-4 py-14">
          <div className="grid gap-4 md:grid-cols-2">
            {guides.map((guide) => {
              const Icon = guide.icon;
              return (
                <Card key={guide.title}>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-3 text-lg">
                      <Icon className="h-5 w-5 text-primary" />
                      {guide.title}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="text-sm leading-6 text-muted-foreground">
                    {guide.text}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </section>

        <section className="border-y bg-muted/30">
          <div className="container mx-auto grid max-w-6xl gap-8 px-4 py-14 lg:grid-cols-[0.9fr_1.1fr]">
            <div>
              <h2 className="flex items-center gap-2 text-2xl font-semibold">
                <LifeBuoy className="h-6 w-6 text-primary" />
                Support and SLA posture
              </h2>
              <p className="mt-3 text-muted-foreground">
                We keep launch promises specific. Formal SLA terms are not implied for every plan;
                they are confirmed for enterprise customers during setup.
              </p>
            </div>
            <div className="grid gap-3">
              {slaItems.map((item) => (
                <div key={item} className="flex gap-3 rounded-lg border bg-background p-4 text-sm">
                  <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                  <span className="text-muted-foreground">{item}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="container mx-auto max-w-6xl px-4 py-14">
          <div className="rounded-lg border p-6">
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <div>
                <h2 className="flex items-center gap-2 text-xl font-semibold">
                  <HelpCircle className="h-5 w-5 text-primary" />
                  Need help choosing the right path?
                </h2>
                <p className="mt-2 text-sm text-muted-foreground">
                  Ask for a guided migration review before importing live books.
                </p>
              </div>
              <div className="flex flex-wrap gap-3">
                <a href="mailto:support@muhasib.ai?subject=Migration%20review">
                  <Button>
                    <Mail className="mr-2 h-4 w-4" />
                    Request Review
                  </Button>
                </a>
                <Link href="/migration-guides">
                  <Button variant="outline">
                    Migration Guides
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Button>
                </Link>
              </div>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
