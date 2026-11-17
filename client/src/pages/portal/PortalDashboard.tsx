import { T } from "@/components/layout/T";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { FileText, FolderOpen } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatCard } from "@/components/ui/stat-card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge, type StatusTone } from "@/components/ui/status-badge";
import { Money, MoneyCell } from "@/components/ui/money";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { apiRequest } from "@/lib/queryClient";
import { formatMessage, useTranslation } from "@/lib/i18n";
import { formatDate } from "@/lib/format-date";

const PAY_TONE: Record<string, StatusTone> = {
  paid: "success",
  partially_paid: "warning",
  overdue: "danger",
  unpaid: "warning",
  credit: "neutral",
};

interface PortalDocumentRow {
  id: string;
  name: string;
  createdAt: string | null;
}

/**
 * Client portal overview (WP-F, spec 3.18): four StatCards, recent invoices as a table and the
 * documents shared with the accountant. Content width 960, centred.
 */
export default function PortalDashboard() {
  const { t, locale } = useTranslation();
  const { data, isLoading } = useQuery({
    queryKey: ["portal-dashboard"],
    queryFn: () => apiRequest("GET", "/api/client-portal/dashboard"),
  });
  const { data: documents = [] } = useQuery<PortalDocumentRow[]>({
    queryKey: ["portal-documents"],
    queryFn: () => apiRequest("GET", "/api/client-portal/documents"),
  });

  const inv = data?.invoices ?? {};
  const recentInvoices: any[] = data?.recentInvoices ?? [];
  const hasInvoices = (inv.total ?? recentInvoices.length) > 0;
  const countHint = (n: number) =>
    n === 1
      ? t["portal.invoiceCountOne"]
      : formatMessage(t["portal.invoiceCountMany"], { count: n });

  return (
    <div className="mx-auto max-w-[960px] space-y-6">
      <PageHeader title={t["portal.doc.overview"]} description={t["portal.doc.overviewHint"]} />

      {(isLoading || hasInvoices) && (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatCard
            label={<T k="portal.doc.outstanding" />}
            value={<Money amount={inv.outstandingTotal ?? 0} currency="AED" />}
            hint={countHint(inv.outstanding ?? 0)}
            loading={isLoading}
            testId="portal-kpi-outstanding"
          />
          <StatCard
            label={<T k="portal.doc.overdue" />}
            value={<span className="tabular-nums">{inv.overdue ?? 0}</span>}
            hint={countHint(inv.overdue ?? 0)}
            loading={isLoading}
            testId="portal-kpi-overdue"
          />
          <StatCard
            label={<T k="portal.doc.paid" />}
            value={<Money amount={inv.paidTotal ?? 0} currency="AED" />}
            hint={countHint(inv.paid ?? 0)}
            loading={isLoading}
            testId="portal-kpi-paid"
          />
          <StatCard
            label={<T k="portal.doc.documentsShared" />}
            value={<span className="tabular-nums">{data?.documents?.total ?? 0}</span>}
            hint={t["portal.uploadedFiles"]}
            href="/client-portal/documents"
            loading={isLoading}
            testId="portal-kpi-documents"
          />
        </div>
      )}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
          <CardTitle className="text-h3">
            <T k="portal.doc.recentInvoices" />
          </CardTitle>
          {recentInvoices.length > 0 && (
            <Link href="/client-portal/invoices" className="text-small font-medium text-accent">
              <T k="portal.doc.viewAll" />
            </Link>
          )}
        </CardHeader>
        <CardContent className="p-0">
          {!isLoading && recentInvoices.length === 0 ? (
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
                  <TableHead data-numeric="">
                    <T k="portal.doc.amountDue" />
                  </TableHead>
                  <TableHead>
                    <T k="portal.doc.status" />
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recentInvoices.map((row: any) => (
                  <TableRow key={row.id}>
                    <TableCell data-cell="title" className="font-medium text-foreground">
                      <bdi>{row.number}</bdi>
                    </TableCell>
                    <TableCell data-cell="meta" data-nowrap="" className="text-muted-foreground">
                      {row.date ? formatDate(row.date, locale) : "—"}
                    </TableCell>
                    <MoneyCell
                      amount={Number(row.amountDue ?? row.total) || 0}
                      currency={row.currency ?? "AED"}
                      className="font-semibold text-foreground"
                      data-cell="amount"
                    />
                    <TableCell data-cell="status" data-nowrap="">
                      <StatusBadge tone={PAY_TONE[row.paymentStatus] ?? "neutral"}>
                        {t[`portal.payStatus.${row.paymentStatus}`] ?? t["portal.doc.status"]}
                      </StatusBadge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
          <CardTitle className="text-h3">
            <T k="portal.doc.recentDocuments" />
          </CardTitle>
          {documents.length > 0 && (
            <Link href="/client-portal/documents" className="text-small font-medium text-accent">
              <T k="portal.doc.viewAll" />
            </Link>
          )}
        </CardHeader>
        <CardContent className={documents.length ? "p-0" : undefined}>
          {documents.length === 0 ? (
            <EmptyState
              size="sm"
              icon={FolderOpen}
              title={t["portal.doc.noDocumentsTitle"]}
              description={t["portal.doc.documentsHint"]}
              action={{ label: t["portal.doc.upload"], href: "/client-portal/documents" }}
            />
          ) : (
            <ul className="divide-y divide-border">
              {documents.slice(0, 5).map((d) => (
                <li key={d.id} className="flex items-center justify-between gap-4 px-5 py-3">
                  <span className="min-w-0 truncate text-small text-foreground" dir="auto">
                    {d.name}
                  </span>
                  <span className="shrink-0 text-small text-muted-foreground">
                    {d.createdAt ? formatDate(d.createdAt, locale) : "—"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
