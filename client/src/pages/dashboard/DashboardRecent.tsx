import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/ui/badge";
import { formatCurrency, formatDate } from "@/lib/format";
import { FileText, BookOpen, ArrowRight, Clock, CheckCircle2 } from "lucide-react";
import { Link } from "wouter";
import { SectionHeader } from "./Layout";
import { EmptyState } from "./EmptyState";
import { T } from "@/components/layout/T";
import type { DashboardModel } from "./useCustomerDashboardModel";

export function DashboardRecent({ m }: { m: DashboardModel }) {
  const { t, locale, recentInvoices, invoicesLoading, journalEntries } = m;
  return (
    <>
      {/* ── Recent activity ─────────────────────────────────────────────── */}
      <section>
        <SectionHeader eyebrow={t["dashboard.recentEyebrow"]} title={t["dashboard.recentTitle"]} />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card>
            <CardHeader className="flex-row items-center justify-between gap-2 border-b border-border py-3 md:py-3">
              <CardTitle className="flex items-center gap-2">
                <FileText className="h-4 w-4 text-muted-foreground" aria-hidden />
                {t.recentInvoices}
              </CardTitle>
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
            <CardContent className="pt-3">
              {invoicesLoading ? (
                <div className="space-y-2">
                  {[1, 2, 3].map((i) => (
                    <Skeleton key={i} className="h-14 w-full" />
                  ))}
                </div>
              ) : recentInvoices && recentInvoices.length > 0 ? (
                <ul className="divide-y divide-border">
                  {recentInvoices.slice(0, 5).map((invoice: any) => (
                    <li
                      key={invoice.id}
                      className="flex items-center justify-between gap-3 py-3 group"
                      data-testid={`invoice-${invoice.id}`}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-secondary text-muted-foreground">
                          <FileText className="w-4 h-4" strokeWidth={1.75} />
                        </div>
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium text-foreground">
                            {invoice.customerName}
                          </div>
                          <div className="money text-xs text-muted-foreground">
                            INV-{invoice.number}
                          </div>
                        </div>
                      </div>
                      <div className="flex flex-shrink-0 flex-col items-end">
                        <div className="money text-sm font-semibold text-foreground">
                          {formatCurrency(invoice.total, invoice.currency, locale)}
                        </div>
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

          <Card>
            <CardHeader className="flex-row items-center justify-between gap-2 border-b border-border py-3 md:py-3">
              <CardTitle className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-muted-foreground" aria-hidden />
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
            <CardContent className="pt-3">
              {journalEntries && journalEntries.length > 0 ? (
                <ul className="divide-y divide-border">
                  {journalEntries.slice(0, 5).map((entry: any) => (
                    <li key={entry.id} className="flex items-center gap-3 py-3 group">
                      <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-success-subtle text-success-subtle-foreground">
                        <CheckCircle2 className="w-4 h-4" strokeWidth={1.75} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="truncate text-sm font-medium text-foreground">
                          {entry.memo || t["dashboard.journalEntryFallback"]}
                        </div>
                        <div className="text-xs tabular-nums text-muted-foreground">
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
