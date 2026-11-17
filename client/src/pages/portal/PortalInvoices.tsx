import { T } from "@/components/layout/T";
import { useQuery } from "@tanstack/react-query";
import { FileDown, FileText, Loader2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { RowActionButton, RowActions } from "@/components/ui/row-actions";
import { MiddleTruncate } from "@/components/ui/middle-truncate";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { apiRequest } from "@/lib/queryClient";
import { DateText } from "@/components/documents/DateText";
import { MoneyCell } from "@/components/ui/money";
import { StatusBadge, type StatusTone } from "@/components/ui/status-badge";
import { useTranslation } from "@/lib/i18n";
import { getAuthHeaders } from "@/lib/auth";
import { apiUrl } from "@/lib/api";

const STATUS_TONE: Record<string, StatusTone> = {
  paid: "success",
  unpaid: "warning",
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
    <div className="mx-auto max-w-[960px] space-y-6">
      <PageHeader title={t["portal.doc.invoices"]} description={t["portal.doc.invoicesHint"]} />

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center h-32">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          ) : invoices.length === 0 ? (
            <EmptyState
              icon={FileText}
              title={t["portal.doc.noInvoicesTitle"]}
              description={t["portal.doc.noInvoicesBody"]}
            />
          ) : (
            <Table className="row-cards">
              <TableHeader>
                <TableRow>
                  <TableHead>
                    <T k="portal.doc.invoiceCol" />
                  </TableHead>
                  <TableHead>
                    <T k="portal.doc.date" />
                  </TableHead>
                  <TableHead>
                    <T k="portal.doc.dueDate" />
                  </TableHead>
                  <TableHead data-numeric="">
                    <T k="portal.doc.amountDue" />
                  </TableHead>
                  <TableHead>
                    <T k="portal.doc.status" />
                  </TableHead>
                  <TableHead>
                    <span className="sr-only">{t.actions}</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {invoices.map((inv: any) => (
                  <TableRow key={inv.id}>
                    <TableCell data-cell="title" className="font-medium text-foreground">
                      <MiddleTruncate text={String(inv.number ?? "")} />
                    </TableCell>
                    <TableCell
                      data-nowrap=""
                      data-cell="meta"
                      data-keep=""
                      className="text-muted-foreground"
                    >
                      {inv.date ? <DateText value={inv.date} locale={locale} /> : "—"}
                    </TableCell>
                    <TableCell data-nowrap="" className="text-muted-foreground">
                      {inv.dueDate ? <DateText value={inv.dueDate} locale={locale} /> : "—"}
                    </TableCell>
                    <MoneyCell
                      amount={Number(inv.amountDue) || 0}
                      currency={inv.currency ?? "AED"}
                      className="font-semibold text-foreground"
                      data-cell="amount"
                    />
                    <TableCell data-nowrap="" data-cell="status">
                      <StatusBadge tone={STATUS_TONE[inv.paymentStatus] ?? "neutral"}>
                        {t[`portal.payStatus.${inv.paymentStatus}`] ?? t["portal.doc.status"]}
                      </StatusBadge>
                    </TableCell>
                    <TableCell data-cell="actions">
                      <RowActions collapseOnMobile>
                        <RowActionButton
                          label={t["portal.doc.downloadPdf"]}
                          icon={FileDown}
                          onClick={() => downloadPdf(inv.id, inv.number)}
                        />
                      </RowActions>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
