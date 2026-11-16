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
        <SectionHeader eyebrow="Activity" title="Recent" />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card className="border-card-border">
            <CardHeader className="flex-row items-center justify-between space-y-0 pb-3 border-b border-border/60">
              <CardTitle className="flex items-center gap-2 text-[13px] uppercase tracking-[0.12em] font-semibold text-muted-foreground">
                <FileText className="w-3.5 h-3.5" />
                {t.recentInvoices ?? "Recent invoices"}
              </CardTitle>
              <Link href="/invoices">
                <Button
                  variant="ghost"
                  size="sm"
                  className="gap-1 text-accent hover:text-accent -me-2"
                >
                  <T k="pageLabels.viewAll2" />
                  <ArrowRight className="w-3.5 h-3.5" />
                </Button>
              </Link>
            </CardHeader>
            <CardContent className="pt-3">
              {invoicesLoading ? (
                <div className="space-y-2">
                  {[1, 2, 3].map((i) => (
                    <Skeleton key={i} className="h-14 w-full" />
                  ))}
                </div>
              ) : recentInvoices && recentInvoices.length > 0 ? (
                <ul className="divide-y divide-border/50">
                  {recentInvoices.slice(0, 5).map((invoice: any) => (
                    <li
                      key={invoice.id}
                      className="flex items-center justify-between gap-3 py-3 group"
                      data-testid={`invoice-${invoice.id}`}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-info-subtle text-info-subtle-foreground flex-shrink-0 group-hover:scale-[1.04] transition-transform">
                          <FileText className="w-4 h-4" strokeWidth={1.75} />
                        </div>
                        <div className="min-w-0">
                          <div className="text-[13.5px] font-medium tracking-tight text-foreground truncate">
                            {invoice.customerName}
                          </div>
                          <div className="text-[11.5px] text-muted-foreground font-mono tabular-nums">
                            INV-{invoice.number}
                          </div>
                        </div>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <div className="text-[14px] font-mono font-semibold tabular-nums text-foreground">
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
                  title="No invoices yet"
                  body="Create your first invoice to get started."
                  actionLabel="Create invoice"
                  actionHref="/invoices"
                />
              )}
            </CardContent>
          </Card>

          <Card className="border-card-border">
            <CardHeader className="flex-row items-center justify-between space-y-0 pb-3 border-b border-border/60">
              <CardTitle className="flex items-center gap-2 text-[13px] uppercase tracking-[0.12em] font-semibold text-muted-foreground">
                <Clock className="w-3.5 h-3.5" />
                <T k="pageLabels.recentActivity" />
              </CardTitle>
              <Link href="/journal">
                <Button
                  variant="ghost"
                  size="sm"
                  className="gap-1 text-accent hover:text-accent -me-2"
                >
                  <T k="pageLabels.viewAll2" />
                  <ArrowRight className="w-3.5 h-3.5" />
                </Button>
              </Link>
            </CardHeader>
            <CardContent className="pt-3">
              {journalEntries && journalEntries.length > 0 ? (
                <ul className="divide-y divide-border/50">
                  {journalEntries.slice(0, 5).map((entry: any) => (
                    <li key={entry.id} className="flex items-center gap-3 py-3 group">
                      <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-success-subtle text-success-subtle-foreground flex-shrink-0 group-hover:scale-[1.04] transition-transform">
                        <CheckCircle2 className="w-4 h-4" strokeWidth={1.75} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-[13.5px] font-medium tracking-tight text-foreground truncate">
                          {entry.memo || "Journal entry"}
                        </div>
                        <div className="text-[11.5px] text-muted-foreground font-mono tabular-nums">
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
                  title="No transactions yet"
                  body="Your double-entry ledger is waiting for its first entry."
                  actionLabel="Create journal entry"
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
