import { T } from "@/components/layout/T";
import { useQuery } from "@tanstack/react-query";
import { FileDown, Loader2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { apiRequest } from "@/lib/queryClient";
import { formatDate } from "@/lib/format-date";
import { Money } from "@/components/ui/money";
import { StatusBadge, type StatusTone } from "@/components/ui/status-badge";
import { useTranslation } from "@/lib/i18n";
import { getAuthHeaders } from "@/lib/auth";
import { apiUrl } from "@/lib/api";

const STATUS_TONE: Record<string, StatusTone> = {
  paid: "success",
  unpaid: "info",
  partially_paid: "warning",
  overdue: "danger",
  credit: "neutral",
};

async function downloadPdf(invoiceId: string, invoiceNumber: string) {
  const res = await fetch(apiUrl(`/api/client-portal/invoices/${invoiceId}/pdf`), {
    headers: getAuthHeaders(),
  });
  if (!res.ok) return;
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `invoice-${invoiceNumber}.pdf`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function PortalInvoices() {
  const { t, locale } = useTranslation();
  const { data: invoices = [], isLoading } = useQuery<any[]>({
    queryKey: ["portal-invoices"],
    queryFn: () => apiRequest("GET", "/api/client-portal/invoices"),
  });

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold text-foreground">
          <T k="pages.invoices" />
        </h2>
        <p className="text-sm text-muted-foreground mt-1">
          <T k="pageLabels.viewAndDownloadInvoicesIssuedBy" />
        </p>
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center h-32">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          ) : invoices.length === 0 ? (
            <p className="text-sm text-muted-foreground/70 text-center py-10">
              <T k="pageLabels.noInvoicesFound" />
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted">
                    <th className="text-start px-4 py-3 font-medium text-muted-foreground">
                      <T k="portal.invoiceNumber" />
                    </th>
                    <th className="text-start px-4 py-3 font-medium text-muted-foreground">
                      <T k="portal.date" />
                    </th>
                    <th className="text-start px-4 py-3 font-medium text-muted-foreground">
                      <T k="pages.dueDate" />
                    </th>
                    <th className="text-end px-4 py-3 font-medium text-muted-foreground">
                      <T k="portal.amountDue" />
                    </th>
                    <th className="text-start px-4 py-3 font-medium text-muted-foreground">
                      <T k="pages.status" />
                    </th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {invoices.map((inv: any) => (
                    <tr key={inv.id} className="hover:bg-muted transition-colors">
                      <td className="px-4 py-3 font-medium text-foreground">{inv.number}</td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {inv.date ? formatDate(inv.date, locale) : "—"}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {inv.dueDate ? formatDate(inv.dueDate, locale) : "—"}
                      </td>
                      <td className="px-4 py-3 text-end font-semibold text-foreground">
                        <Money amount={Number(inv.amountDue) || 0} currency="AED" />
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge tone={STATUS_TONE[inv.paymentStatus] ?? "neutral"}>
                          {t[`portal.payStatus.${inv.paymentStatus}`] ?? inv.paymentStatus}
                        </StatusBadge>
                      </td>
                      <td className="px-4 py-3 text-end">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 text-info hover:text-info hover:bg-info-subtle"
                          onClick={() => downloadPdf(inv.id, inv.number)}
                        >
                          <FileDown className="w-3.5 h-3.5 me-1.5" />
                          PDF
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
