import { T } from "@/components/layout/T";
import { useQuery } from "@tanstack/react-query";
import { FileDown, Loader2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { apiRequest } from "@/lib/queryClient";
import { format } from "date-fns";
import { getAuthHeaders } from "@/lib/auth";
import { apiUrl } from "@/lib/api";

function formatAed(n: number) {
  return new Intl.NumberFormat("en-AE", {
    style: "currency",
    currency: "AED",
    maximumFractionDigits: 0,
  }).format(n);
}

const STATUS_STYLES: Record<string, string> = {
  paid: "border-success/30 text-success bg-success-subtle",
  unpaid: "border-info/30 text-info bg-info-subtle",
  partially_paid: "border-warning/30 text-warning bg-warning-subtle",
  overdue: "border-destructive/30 text-destructive bg-danger-subtle",
  credit: "border-border text-muted-foreground",
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
          <T k="s6b.viewAndDownloadInvoicesIssuedBy" />
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
              <T k="s6b.noInvoicesFound" />
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted">
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">
                      Invoice #
                    </th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">Date</th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">
                      <T k="pages.dueDate" />
                    </th>
                    <th className="text-right px-4 py-3 font-medium text-muted-foreground">
                      <T k="portal.amountDue" />
                    </th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">
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
                        {inv.date ? format(new Date(inv.date), "MMM d, yyyy") : "—"}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {inv.dueDate ? format(new Date(inv.dueDate), "MMM d, yyyy") : "—"}
                      </td>
                      <td className="px-4 py-3 text-right font-semibold text-foreground">
                        {formatAed(Number(inv.amountDue) || 0)}
                      </td>
                      <td className="px-4 py-3">
                        <Badge
                          variant="outline"
                          className={
                            STATUS_STYLES[inv.paymentStatus] ??
                            "border-border text-muted-foreground"
                          }
                        >
                          <T k={`portal.payStatus.${inv.paymentStatus}`} />
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 text-info hover:text-info hover:bg-info-subtle"
                          onClick={() => downloadPdf(inv.id, inv.number)}
                        >
                          <FileDown className="w-3.5 h-3.5 mr-1.5" />
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
