import { T } from "@/components/layout/T";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { FileText, AlertCircle, CheckCircle2, FolderOpen, Calendar } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { apiRequest } from "@/lib/queryClient";

import { Loader2 } from "lucide-react";
import { Money } from "@/components/ui/money";
import { formatMessage, useTranslation } from "@/lib/i18n";
import { formatDate } from "@/lib/format-date";

function VatBadge({ vat }: { vat: { status: string; dueDate: string } | null }) {
  const { t, locale } = useTranslation();
  // Captured once per mount so the countdown is stable across re-renders.
  const [now] = useState(() => Date.now());
  if (!vat)
    return (
      <Badge variant="outline">
        <T k="pageLabels.noVatReturn" />
      </Badge>
    );
  const due = new Date(vat.dueDate);
  const days = Math.ceil((due.getTime() - now) / 86400000);
  if (vat.status === "filed" || vat.status === "submitted") {
    return (
      <Badge className="bg-success-subtle text-success-subtle-foreground border-success/30">
        <T k="pages.filed" />
      </Badge>
    );
  }
  if (days < 0)
    return (
      <Badge variant="danger">
        <T k="pages.overdue" />
      </Badge>
    );
  if (days <= 14)
    return (
      <Badge className="bg-warning-subtle text-warning-subtle-foreground border-warning/30">
        {formatMessage(t["portal.dueOn"], { date: formatDate(due, locale) })}
      </Badge>
    );
  return (
    <Badge variant="outline">
      {formatMessage(t["portal.dueOn"], { date: formatDate(due, locale) })}
    </Badge>
  );
}

export default function PortalDashboard() {
  const { t, locale } = useTranslation();
  const { data, isLoading } = useQuery({
    queryKey: ["portal-dashboard"],
    queryFn: () => apiRequest("GET", "/api/client-portal/dashboard"),
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-48">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const inv = data?.invoices ?? {};
  const vatStatus = data?.vatStatus ?? null;
  const recentInvoices: any[] = data?.recentInvoices ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-foreground">
          <T k="pages.overview" />
        </h2>
        <p className="text-sm text-muted-foreground mt-1">
          <T k="pageLabels.yourAccountSummaryAtAGlance" />
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-5">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs font-medium text-muted-foreground">
                  <T k="reportCenter.outstanding" />
                </p>
                <p className="mt-1 text-h2 font-semibold tabular-nums text-foreground">
                  <Money amount={inv.outstandingTotal ?? 0} currency="AED" />
                </p>
                <p className="mt-1 text-caption text-muted-foreground">
                  {inv.outstanding === 1
                    ? t["portal.invoiceCountOne"]
                    : formatMessage(t["portal.invoiceCountMany"], { count: inv.outstanding ?? 0 })}
                </p>
              </div>
              <AlertCircle className="w-5 h-5 text-warning mt-1" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-5">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs font-medium text-muted-foreground">
                  <T k="pages.totalPaid" />
                </p>
                <p className="mt-1 text-h2 font-semibold tabular-nums text-foreground">
                  <Money amount={inv.paidTotal ?? 0} currency="AED" />
                </p>
                <p className="mt-1 text-caption text-muted-foreground">
                  {inv.paid === 1
                    ? t["portal.invoiceCountOne"]
                    : formatMessage(t["portal.invoiceCountMany"], { count: inv.paid ?? 0 })}
                </p>
              </div>
              <CheckCircle2 className="w-5 h-5 text-success mt-1" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-5">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs font-medium text-muted-foreground">
                  <T k="pages.documents" />
                </p>
                <p className="mt-1 text-h2 font-semibold tabular-nums text-foreground">
                  {data?.documents?.total ?? 0}
                </p>
                <p className="text-xs text-muted-foreground mt-1">{t["portal.uploadedFiles"]}</p>
              </div>
              <FolderOpen className="w-5 h-5 text-info mt-1" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-5">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs font-medium text-muted-foreground">
                  <T k="pages.vatStatus" />
                </p>
                <div className="mt-2">
                  <VatBadge vat={vatStatus} />
                </div>
                {vatStatus?.dueDate && (
                  <p className="mt-1 text-caption text-muted-foreground">
                    Period end: {formatDate(vatStatus.periodEnd ?? vatStatus.dueDate, locale)}
                  </p>
                )}
              </div>
              <Calendar className="w-5 h-5 text-chart-5 mt-1" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Recent invoices */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <FileText className="w-4 h-4" />
            <T k="pages.recentInvoices" />
          </CardTitle>
        </CardHeader>
        <CardContent>
          {recentInvoices.length === 0 ? (
            <p className="text-sm text-muted-foreground/70 py-4 text-center">
              <T k="portal.noInvoices" />
            </p>
          ) : (
            <div className="divide-y divide-border">
              {recentInvoices.map((inv: any) => (
                <div key={inv.id} className="flex items-center justify-between py-3">
                  <div>
                    <p className="text-sm font-medium text-foreground">{inv.number}</p>
                    <p className="text-xs text-muted-foreground/70">
                      {inv.date ? formatDate(inv.date, locale) : "—"}
                    </p>
                  </div>
                  <div className="text-end">
                    <p className="text-sm font-semibold text-foreground">
                      <Money amount={Number(inv.amountDue ?? inv.total) || 0} currency="AED" />
                    </p>
                    <Badge
                      variant="outline"
                      className={
                        inv.status === "paid"
                          ? "border-success/30 text-success bg-success-subtle"
                          : inv.status === "sent"
                            ? "border-info/30 text-info bg-info-subtle"
                            : inv.status === "partial"
                              ? "border-warning/30 text-warning bg-warning-subtle"
                              : "border-border text-muted-foreground"
                      }
                    >
                      {inv.status}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
