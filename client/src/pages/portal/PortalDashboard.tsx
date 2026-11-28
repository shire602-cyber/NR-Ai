import { usePortalAccountScope } from "@/lib/portal-scope";
import { T } from "@/components/layout/T";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { FileText, FolderOpen, PartyPopper, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { BalanceSummary } from "@/components/portal/BalanceSummary";
import { PORTAL_WELCOME_KEY } from "@/lib/portal-state";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge, type StatusTone } from "@/components/ui/status-badge";
import { MoneyCell } from "@/components/ui/money";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PortalLoadNotice } from "@/components/portal/PortalLoadNotice";
import { usePortalRetry } from "@/hooks/usePortalRetry";
import { portalQuery } from "@/lib/queryClient";
import { formatMessage, useTranslation } from "@/lib/i18n";
import { DateText } from "@/components/documents/DateText";

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
 * Client portal overview (WP-F, spec 3.18): the balance per currency, recent invoices as a table and the
 * documents shared with the accountant. Content width 960, centred.
 */
export default function PortalDashboard() {
  const supplier = usePortalAccountScope();
  const { t, locale } = useTranslation();
  const dashboardQuery = portalQuery("/api/client-portal/dashboard", supplier);
  const dashboard = useQuery<any>({ ...dashboardQuery });
  const { data, isPaused, isFetching } = dashboard;
  const { error, isLoading, retryPending, retry } = usePortalRetry(
    dashboardQuery.queryKey,
    dashboard
  );
  const documentsQuery = portalQuery("/api/client-portal/documents", supplier);
  const documentsResult = useQuery<PortalDocumentRow[]>({ ...documentsQuery });
  const documentsRetry = usePortalRetry(documentsQuery.queryKey, documentsResult);
  const documents = documentsResult.data ?? [];
  const documentsLoading = documentsRetry.isLoading;
  const documentsNotice =
    documentsRetry.error ||
    documentsResult.isPaused ||
    (documentsRetry.retryPending && documentsResult.isFetching);
  const dashboardNotice = error || isPaused || (retryPending && isFetching);

  const { data: company } = useQuery<{ name?: string }>({
    ...portalQuery("/api/client-portal/company", supplier),
    staleTime: 5 * 60 * 1000,
  });
  const [welcome, setWelcome] = useState(() => {
    try {
      return window.localStorage.getItem(PORTAL_WELCOME_KEY) === "1";
    } catch {
      return false;
    }
  });
  const dismissWelcome = () => {
    setWelcome(false);
    try {
      window.localStorage.removeItem(PORTAL_WELCOME_KEY);
    } catch {
      /* ignore */
    }
  };

  const inv = data?.invoices ?? {};
  const recentInvoices: any[] = data?.recentInvoices ?? [];
  const hasInvoices = (inv.total ?? recentInvoices.length) > 0;

  return (
    <div className="mx-auto max-w-[960px] space-y-6">
      <PageHeader title={t["portal.doc.overview"]} description={t["portal.doc.overviewHint"]} />

      {welcome && (
        <Card
          className="flex items-start gap-3 border-accent/40 bg-accent/5 p-4"
          data-testid="portal-welcome"
        >
          <PartyPopper className="mt-0.5 h-5 w-5 shrink-0 text-accent" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="text-body font-semibold">{t["portal.dash.welcomeTitle"]}</p>
            <p className="text-small text-muted-foreground">
              {formatMessage(t["portal.dash.welcomeBody"], {
                supplier: company?.name ?? t["portal.join.theSupplier"],
              })}
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-11 w-11 shrink-0"
            aria-label={t["portal.dash.dismiss"]}
            onClick={dismissWelcome}
          >
            <X className="h-4 w-4" aria-hidden />
          </Button>
        </Card>
      )}

      {(data?.overdueByCurrency?.length ?? 0) > 0 && (
        <Alert
          tone="danger"
          title={t["portal.dash.overdueTitle"]}
          data-testid="portal-overdue-banner"
        >
          {formatMessage(t["portal.dash.overdueBody"], { count: inv.overdue ?? 0 })}
        </Alert>
      )}

      {(isLoading || hasInvoices) && !(dashboardNotice && data === undefined) && (
        <BalanceSummary data={data} loading={isLoading} />
      )}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
          <CardTitle className="text-h3">
            <T k="portal.doc.recentInvoices" />
          </CardTitle>
          {recentInvoices.length > 0 && (
            <Link
              href="/client-portal/invoices"
              className="inline-flex min-h-11 items-center text-small font-medium text-accent"
            >
              <T k="portal.doc.viewAll" />
            </Link>
          )}
        </CardHeader>
        <CardContent className="p-0">
          {dashboardNotice && !isLoading ? (
            <PortalLoadNotice
              error={error}
              paused={isPaused}
              retrying={isFetching}
              retryPending={retryPending}
              onRetry={retry}
              compact={data !== undefined}
              resource="dashboard"
            />
          ) : null}
          {data === undefined && dashboardNotice ? null : !isLoading &&
            recentInvoices.length === 0 ? (
            <EmptyState
              headingLevel="h2"
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
                      {row.date ? <DateText value={row.date} locale={locale} /> : "—"}
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
            <Link
              href="/client-portal/documents"
              className="inline-flex min-h-11 items-center text-small font-medium text-accent"
            >
              <T k="portal.doc.viewAll" />
            </Link>
          )}
        </CardHeader>
        <CardContent className={documents.length ? "p-0" : undefined}>
          {documentsNotice && !documentsLoading ? (
            <PortalLoadNotice
              error={documentsRetry.error}
              paused={documentsResult.isPaused}
              retrying={documentsResult.isFetching}
              retryPending={documentsRetry.retryPending}
              onRetry={documentsRetry.retry}
              compact={documentsResult.data !== undefined}
              resource="documents"
            />
          ) : null}
          {documentsLoading ||
          (documentsResult.data === undefined && documentsNotice) ? null : documents.length ===
            0 ? (
            <EmptyState
              compact
              className="[&_a]:min-h-11"
              headingLevel="h2"
              icon={FolderOpen}
              title={t["portal.doc.noDocumentsTitle"]}
              description={t["portal.doc.noDocumentsBody"]}
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
                    {d.createdAt ? <DateText value={d.createdAt} locale={locale} /> : "—"}
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
