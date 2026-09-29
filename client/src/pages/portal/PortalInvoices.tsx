import { useQuery } from "@tanstack/react-query";
import { FileDown, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { apiRequest } from "@/lib/queryClient";
import { format } from "date-fns";
import { getAuthHeaders } from "@/lib/auth";
import { apiUrl } from "@/lib/api";
import { messages as pageMessages } from "./PortalInvoices.i18n";

function formatAed(n: number) {
  return new Intl.NumberFormat("en-AE", {
    style: "currency",
    currency: "AED",
    maximumFractionDigits: 0,
  }).format(n);
}

const STATUS_STYLES: Record<string, string> = {
  paid: "border-success/30 text-success bg-success-subtle",
  sent: "border-info/30 text-info bg-info-subtle",
  partial: "border-warning/30 text-warning bg-warning-subtle",
  credited: "border-border text-muted-foreground bg-muted",
  draft: "border-border text-muted-foreground",
  void: "border-destructive/30 text-destructive bg-danger-subtle",
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
  const tr = pageMessages.useT();

  const { data: invoices = [], isLoading } = useQuery<any[]>({
    queryKey: ["portal-invoices"],
    queryFn: () => apiRequest("GET", "/api/client-portal/invoices"),
  });

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold text-foreground">{tr("invoices")}</h2>
        <p className="text-sm text-muted-foreground mt-1">
          {tr("viewAndDownloadInvoicesIssuedBy")}
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
              {tr("noInvoicesFound")}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted">
                    <th className="text-start px-4 py-3 font-medium text-muted-foreground">
                      {tr("invoice")}
                    </th>
                    <th className="text-start px-4 py-3 font-medium text-muted-foreground">
                      {tr("date")}
                    </th>
                    <th className="text-start px-4 py-3 font-medium text-muted-foreground">
                      {tr("dueDate")}
                    </th>
                    <th className="text-end px-4 py-3 font-medium text-muted-foreground">
                      {tr("amount")}
                    </th>
                    <th className="text-start px-4 py-3 font-medium text-muted-foreground">
                      {tr("status")}
                    </th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {invoices.map((inv: any) => (
                    <tr key={inv.id} className="hover:bg-muted transition-colors">
                      <td className="px-4 py-3 font-medium text-foreground">{inv.number}</td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {inv.date ? format(new Date(inv.date), "MMM d, yyyy") : "—"}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {inv.dueDate ? format(new Date(inv.dueDate), "MMM d, yyyy") : "—"}
                      </td>
                      <td className="px-4 py-3 text-end font-semibold text-foreground">
                        {formatAed(Number(inv.total) || 0)}
                      </td>
                      <td className="px-4 py-3">
                        <Badge
                          variant="outline"
                          className={
                            STATUS_STYLES[inv.status] ?? "border-border text-muted-foreground"
                          }
                        >
                          {inv.status}
                        </Badge>
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
