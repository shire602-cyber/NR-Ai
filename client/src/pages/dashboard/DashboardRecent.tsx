import { localizeJournalMemo } from "@/lib/journal-memo";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/ui/badge";
import { formatDate } from "@/lib/format";
import { Money } from "@/components/ui/money";
import { FileText, BookOpen, ArrowRight } from "lucide-react";
import { Link } from "wouter";
import { CompliancePanel } from "./DashboardPlanning";
import { EmptyState } from "./EmptyState";
import { T } from "@/components/layout/T";
import type { DashboardModel } from "./useCustomerDashboardModel";

export function DashboardRecent({ m }: { m: DashboardModel }) {
  const { t, locale, recentInvoices, invoicesLoading, journalEntries } = m;
  return (
    <>
      {/* ── Recent activity ─────────────────────────────────────────────── */}
      {/* Filing pulse beside the two recent lists: one row of three (CTO 4). */}
      <section aria-label={t["dashboard.recentTitle"]}>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
          <CompliancePanel m={m} />
          <Card className="flex flex-col">
            <CardHeader className="flex-row items-center justify-between gap-2 space-y-0 pb-2">
              <CardTitle>{t["dashboard.recentSalesTitle"]}</CardTitle>
              <Button
                asChild
                variant="ghost"
                size="sm"
                className="-me-2 text-accent hover:text-accent"
              >
                <Link href="/invoices">
                  <T k="pageLabels.viewAll2" />
                  <ArrowRight className="rtl:rotate-180" aria-hidden />
                </Link>
              </Button>
            </CardHeader>
            <CardContent className="pt-0">
              {invoicesLoading ? (
                <div className="space-y-2">
                  {[1, 2, 3].map((i) => (
                    <Skeleton key={i} className="h-14 w-full" />
                  ))}
                </div>
              ) : recentInvoices && recentInvoices.length > 0 ? (
                <ul className="divide-y divide-border">
                  {recentInvoices.slice(0, 4).map((invoice: any) => (
                    <li
                      key={invoice.id}
                      className="group flex items-center justify-between gap-3 py-2.5"
                      data-testid={`invoice-${invoice.id}`}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="min-w-0">
                          <div dir="auto" className="truncate text-sm font-medium text-foreground">
                            {invoice.customerName}
                          </div>
                          <div className="truncate text-caption text-muted-foreground">
                            {/* Credit notes share this list, so every row names its type. */}
                            {invoice.invoiceType === "credit_note"
                              ? `${t["dashboard.docTypeCreditNote"]} · `
                              : `${t["dashboard.docTypeInvoice"]} · `}
                            <span dir="ltr" className="[unicode-bidi:isolate]">
                              {invoice.number}
                            </span>
                            {invoice.date ? ` · ${formatDate(invoice.date, locale)}` : null}
                          </div>
                        </div>
                      </div>
                      <div className="flex flex-shrink-0 flex-col items-end">
                        <Money
                          amount={Number(invoice.total)}
                          currency={invoice.currency}
                          className="text-sm font-semibold text-foreground"
                        />
                        <StatusBadge status={invoice.status} className="mt-0.5" />
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState
                  icon={FileText}
                  title={t["dashboard.emptyInvoicesTitle"]}
                  body={t["dashboard.emptyInvoicesBody"]}
                  actionLabel={t["dashboard.emptyInvoicesAction"]}
                  actionHref="/invoices"
                />
              )}
            </CardContent>
          </Card>

          <Card className="flex flex-col">
            <CardHeader className="flex-row items-center justify-between gap-2 space-y-0 pb-2">
              <CardTitle>
                <T k="pageLabels.recentActivity" />
              </CardTitle>
              <Button
                asChild
                variant="ghost"
                size="sm"
                className="-me-2 text-accent hover:text-accent"
              >
                <Link href="/journal">
                  <T k="pageLabels.viewAll2" />
                  <ArrowRight className="rtl:rotate-180" aria-hidden />
                </Link>
              </Button>
            </CardHeader>
            <CardContent className="pt-0">
              {journalEntries && journalEntries.length > 0 ? (
                <ul className="divide-y divide-border">
                  {journalEntries.slice(0, 4).map((entry: any) => (
                    <li key={entry.id} className="group flex items-center gap-3 py-2.5">
                      <div className="flex-1 min-w-0">
                        <div className="truncate text-sm font-medium text-foreground">
                          {localizeJournalMemo(t, entry.memo, locale, entry) ||
                            t["dashboard.journalEntryFallback"]}
                        </div>
                        <div className="text-caption text-muted-foreground">
                          {formatDate(entry.date, locale)}
                        </div>
                      </div>
                      <StatusBadge status="posted" />
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState
                  icon={BookOpen}
                  title={t["dashboard.emptyTransactionsTitle"]}
                  body={t["dashboard.emptyTransactionsBody"]}
                  actionLabel={t["dashboard.createJournalEntry"]}
                  actionHref="/journal"
                />
              )}
            </CardContent>
          </Card>
        </div>
      </section>
    </>
  );
}
