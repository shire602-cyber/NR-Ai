import { useQuery } from "@tanstack/react-query";
import { FileText, AlertCircle, CheckCircle2, FolderOpen, Calendar, Receipt } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { apiRequest } from "@/lib/queryClient";
import { format } from "date-fns";
import { Loader2 } from "lucide-react";
import { messages as pageMessages } from "./PortalDashboard.i18n";

function formatAed(n: number) {
  return new Intl.NumberFormat("en-AE", {
    style: "currency",
    currency: "AED",
    maximumFractionDigits: 0,
  }).format(n);
}

function VatBadge({ vat }: { vat: { status: string; dueDate: string } | null }) {
  const tr = pageMessages.useT();

  if (!vat) return <Badge variant="outline">{tr("noVatReturn")}</Badge>;
  const due = new Date(vat.dueDate);
  const days = Math.ceil((due.getTime() - Date.now()) / 86400000);
  if (vat.status === "filed" || vat.status === "submitted") {
    return (
      <Badge className="bg-success-subtle text-success-subtle-foreground border-success/30">
        {tr("filed")}
      </Badge>
    );
  }
  if (days < 0) return <Badge variant="destructive">{tr("overdue")}</Badge>;
  if (days <= 14)
    return (
      <Badge className="bg-warning-subtle text-warning-subtle-foreground border-warning/30">
        {tr("due", { format: format(due, "MMM d") })}
      </Badge>
    );
  return <Badge variant="outline">{tr("due", { format: format(due, "MMM d") })}</Badge>;
}

export default function PortalDashboard() {
  const tr = pageMessages.useT();

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
  const payables = data?.payables ?? null;
  const vatStatus = data?.vatStatus ?? null;
  const recentInvoices: any[] = data?.recentInvoices ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-foreground">{tr("overview")}</h2>
        <p className="text-sm text-muted-foreground mt-1">{tr("yourAccountSummaryAtAGlance")}</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        <Card>
          <CardContent className="pt-5">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  {tr("outstanding")}
                </p>
                <p className="text-2xl font-bold text-foreground mt-1">
                  {formatAed(inv.outstandingTotal ?? 0)}
                </p>
                <p className="text-xs text-muted-foreground/70 mt-1">
                  {tr.plural("invoicesCount", inv.outstanding ?? 0)}
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
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  {tr("payables")}
                </p>
                <p className="text-2xl font-bold text-foreground mt-1" data-testid="portal-payables-total">
                  {formatAed(payables?.outstandingTotal ?? 0)}
                </p>
                <p className="text-xs text-muted-foreground/70 mt-1">
                  {Number(payables?.unappliedCredits ?? 0) > 0
                    ? tr("payablesAfterCredits", { amount: formatAed(payables.unappliedCredits) })
                    : tr("owedToSuppliers")}
                </p>
              </div>
              <Receipt className="w-5 h-5 text-chart-3 mt-1" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-5">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  {tr("totalPaid")}
                </p>
                <p className="text-2xl font-bold text-foreground mt-1">
                  {formatAed(inv.paidTotal ?? 0)}
                </p>
                <p className="text-xs text-muted-foreground/70 mt-1">
                  {tr.plural("invoicesCount", inv.paid ?? 0)}
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
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  {tr("documents")}
                </p>
                <p className="text-2xl font-bold text-foreground mt-1">
                  {data?.documents?.total ?? 0}
                </p>
                <p className="text-xs text-muted-foreground/70 mt-1">{tr("uploadedFiles")}</p>
              </div>
              <FolderOpen className="w-5 h-5 text-info mt-1" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-5">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  {tr("vatStatus")}
                </p>
                <div className="mt-2">
                  <VatBadge vat={vatStatus} />
                </div>
                {vatStatus?.dueDate && (
                  <p className="text-xs text-muted-foreground/70 mt-1">
                    {tr("periodEnd", {
                      format: format(
                        new Date(vatStatus.periodEnd ?? vatStatus.dueDate),
                        "MMM d, yyyy"
                      ),
                    })}
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
            {tr("recentInvoices")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {recentInvoices.length === 0 ? (
            <p className="text-sm text-muted-foreground/70 py-4 text-center">
              {tr("noInvoicesYet")}
            </p>
          ) : (
            <div className="divide-y divide-border">
              {recentInvoices.map((inv: any) => (
                <div key={inv.id} className="flex items-center justify-between py-3">
                  <div>
                    <p className="text-sm font-medium text-foreground">{inv.number}</p>
                    <p className="text-xs text-muted-foreground/70">
                      {inv.createdAt ? format(new Date(inv.createdAt), "MMM d, yyyy") : "—"}
                    </p>
                  </div>
                  <div className="text-end">
                    <p className="text-sm font-semibold text-foreground">
                      {formatAed(Number(inv.total) || 0)}
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
