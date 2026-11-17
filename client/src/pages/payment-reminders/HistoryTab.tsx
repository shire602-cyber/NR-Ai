import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { History } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { MoneyCell } from "@/components/ui/money";
import { Skeleton } from "@/components/ui/skeleton";
import { StatCard } from "@/components/ui/stat-card";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDate } from "@/lib/format-date";
import { apiRequest } from "@/lib/queryClient";
import { formatMessage, useTranslation } from "@/lib/i18n";
import { AutomaticEmailLog } from "../Reminders";
import { recordStatusTone, type AgingRow, type ChaseRecord, type Effectiveness } from "./types";

/**
 * History (spec 3.7): the former Effectiveness tab becomes three figures above the list of
 * sent reminders; the automatic-email log from the old /reminders page follows below.
 */
export function HistoryTab({ companyId, rows }: { companyId?: string; rows: AgingRow[] }) {
  const { t, locale } = useTranslation();
  const tt = t as Record<string, string>;
  const historyQuery = useQuery<ChaseRecord[]>({
    queryKey: ["/api/chasing/history", companyId],
    queryFn: () => apiRequest("GET", `/api/chasing/history/${companyId}?sinceDays=180`),
    enabled: !!companyId,
  });
  const effQuery = useQuery<Effectiveness>({
    queryKey: ["/api/chasing/effectiveness", companyId],
    queryFn: () => apiRequest("GET", `/api/chasing/effectiveness/${companyId}?sinceDays=180`),
    enabled: !!companyId,
  });
  const invoices = useMemo(() => new Map(rows.map((r) => [r.invoice.id, r.invoice])), [rows]);
  const eff = effQuery.data;
  const history = historyQuery.data ?? [];

  return (
    <div className="space-y-8">
      {/* Figures only once something has been sent: no row of zeros. */}
      {(eff?.totalChases ?? 0) > 0 && (
        <div className="grid gap-3 sm:grid-cols-3 sm:gap-4">
          <StatCard
            testId="metric-conversion-rate"
            label={tt["invoices.reminders.metricConversion"]}
            value={
              <span className="money" dir="ltr">
                {`${((eff?.conversionRate ?? 0) * 100).toFixed(1)}%`}
              </span>
            }
            hint={formatMessage(tt["invoices.reminders.metricConversionHint"], {
              paid: eff?.paidAfterChase ?? 0,
              total: eff?.uniqueInvoices ?? 0,
            })}
          />
          <StatCard
            testId="metric-avg-days"
            label={tt["invoices.reminders.metricAvgDays"]}
            value={<span className="money">{eff?.avgDaysToPayment ?? "—"}</span>}
            hint={tt["invoices.reminders.metricAvgDaysHint"]}
          />
          <StatCard
            testId="metric-windowed"
            label={tt["invoices.reminders.metricWindow"]}
            value={
              <span className="money" dir="ltr">
                {`${eff?.paidWithin7 ?? 0} · ${eff?.paidWithin14 ?? 0} · ${eff?.paidWithin30 ?? 0}`}
              </span>
            }
            hint={tt["invoices.reminders.metricWindowHint"]}
          />
        </div>
      )}

      <Card className="overflow-hidden">
        <CardHeader className="flex-row items-baseline justify-between gap-2 space-y-0">
          <CardTitle>{tt["invoices.reminders.tabHistory"]}</CardTitle>
          <span className="text-caption text-muted-foreground">
            {tt["invoices.reminders.historyRange"]}
          </span>
        </CardHeader>
        {historyQuery.isLoading ? (
          <CardContent className="space-y-2 pt-0">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-11 w-full" />
            ))}
          </CardContent>
        ) : historyQuery.isError ? (
          <CardContent className="pt-0 text-small text-danger">
            {tt["invoices.reminders.historyError"]}
          </CardContent>
        ) : history.length === 0 ? (
          <CardContent className="pt-0">
            <EmptyState size="sm" icon={History} title={tt["invoices.reminders.emptyHistory"]} />
          </CardContent>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{tt["invoices.reminders.colSent"]}</TableHead>
                  <TableHead>{tt["invoices.reminders.colInvoice"]}</TableHead>
                  <TableHead>{tt["invoices.reminders.colStep"]}</TableHead>
                  <TableHead>{tt["invoices.reminders.colLanguage"]}</TableHead>
                  <TableHead className="text-end">{tt["invoices.reminders.colAmount"]}</TableHead>
                  <TableHead>{tt["invoices.reminders.colStatus"]}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {history.map((c) => {
                  const invoice = invoices.get(c.invoiceId);
                  return (
                    <TableRow key={c.id} data-testid={`history-row-${c.id}`}>
                      <TableCell className="whitespace-nowrap tabular-nums">
                        {formatDate(c.sentAt, locale)}
                      </TableCell>
                      <TableCell>
                        {invoice ? (
                          <>
                            <div dir="auto" className="font-medium">
                              {invoice.customerName}
                            </div>
                            <div className="text-caption text-muted-foreground">
                              <span dir="ltr" className="[unicode-bidi:isolate]">
                                {invoice.number}
                              </span>
                            </div>
                          </>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-small">
                        {tt[`invoices.reminders.level.${c.level}`] ?? c.level}
                      </TableCell>
                      <TableCell className="text-small">
                        {c.language === "ar"
                          ? tt["invoices.reminders.langAr"]
                          : tt["invoices.reminders.langEn"]}
                      </TableCell>
                      <MoneyCell amount={Number(c.amountAtSend)} currency={invoice?.currency} />
                      <TableCell>
                        <StatusBadge
                          tone={c.paidAt ? "success" : recordStatusTone(c.status)}
                          data-testid={`history-status-${c.id}`}
                        >
                          {c.paidAt
                            ? `${tt["invoices.reminders.status.paid"]} · ${formatDate(c.paidAt, locale)}`
                            : (tt[`invoices.reminders.status.${c.status}`] ??
                              tt["invoices.reminders.status.pending"])}
                        </StatusBadge>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </Card>

      <AutomaticEmailLog companyId={companyId} />
    </div>
  );
}
