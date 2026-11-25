import { useMemo, useRef, useState } from "react";
import { CheckCircle2, Clock, PauseCircle, PlayCircle, SearchX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/empty-state";
import { MoneyCell, Money } from "@/components/ui/money";
import { RowActions } from "@/components/ui/row-actions";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useTranslation } from "@/lib/i18n";
import { InvoiceTimelineDialog } from "./dialogs";
import { filterOverdueRows } from "./filterOverdueRows";
import type { AgingRow } from "./types";

export function OverdueTab({
  rows,
  queue,
  loading,
  error,
  offline = false,
  stale = false,
  successful = false,
  onRetry,
  sending,
  onSend,
  onToggleDoNotChase,
}: {
  rows: AgingRow[];
  queue: AgingRow[];
  loading: boolean;
  /** The latest fetch failed and is not paused; shown even if a list is cached. */
  error: boolean;
  /** The fetch is paused (offline) and there are no rows to show. */
  offline?: boolean;
  /** Cached rows are shown while their refresh is paused (offline). */
  stale?: boolean;
  /**
   * The overdue query has succeeded. The empty state ("Nothing is overdue") needs this, so an
   * idle or disabled query renders nothing rather than a false all-clear.
   */
  successful?: boolean;
  onRetry?: () => void;
  sending: boolean;
  onSend: (invoiceId: string) => void;
  onToggleDoNotChase: (invoiceId: string, value: boolean) => void;
}) {
  const { t } = useTranslation();
  const tt = t as Record<string, string>;
  const [timelineFor, setTimelineFor] = useState<AgingRow["invoice"] | null>(null);
  const [search, setSearch] = useState("");
  const searchInput = useRef<HTMLInputElement>(null);
  const sorted = useMemo(
    () => [...filterOverdueRows(rows, search)].sort((a, b) => b.daysOverdue - a.daysOverdue),
    [rows, search]
  );
  // The former "Queue" tab is the Next reminder column: an invoice in the queue is due now.
  const nextById = useMemo(() => new Map(queue.map((q) => [q.invoice.id, q.nextLevel])), [queue]);
  const level = (n: number | undefined) =>
    n ? (tt[`invoices.reminders.level.${n}`] ?? String(n)) : "";

  if (loading) {
    return (
      <Card className="space-y-2 p-5">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-11 w-full" />
        ))}
      </Card>
    );
  }
  const retryButton = onRetry && (
    <Button size="sm" variant="outline" onClick={onRetry} data-testid="button-retry-overdue">
      {tt["invoices.reminders.retry"]}
    </Button>
  );
  // No rows and no connection: the fetch is paused, so an empty list is not confirmed. It
  // resumes by itself on reconnect; Retry re-asks now.
  if (offline) {
    return (
      <Card
        className="flex flex-wrap items-center justify-between gap-3 p-5 text-small"
        role="status"
        data-testid="overdue-offline"
      >
        <span className="min-w-0 space-y-1">
          <span className="block font-medium text-foreground">
            {tt["invoices.reminders.offlineTitle"]}
          </span>
          <span className="block text-muted-foreground">
            {tt["invoices.reminders.offlineBody"]}
          </span>
        </span>
        {retryButton}
      </Card>
    );
  }
  if (error) {
    return (
      <Card
        className="flex flex-wrap items-center justify-between gap-3 p-5 text-small text-danger"
        role="alert"
      >
        <span>{tt["invoices.reminders.loadError"]}</span>
        {retryButton}
      </Card>
    );
  }
  if (rows.length === 0) {
    if (!successful) return null;
    return (
      <Card>
        <EmptyState
          size="md"
          icon={CheckCircle2}
          title={tt["invoices.reminders.emptyOverdueTitle"]}
          description={tt["invoices.reminders.emptyOverdueBody"]}
        />
      </Card>
    );
  }

  const nextCell = (row: AgingRow) => {
    if (row.invoice.doNotChase) {
      return <StatusBadge tone="neutral">{tt["invoices.reminders.paused"]}</StatusBadge>;
    }
    const next = nextById.get(row.invoice.id);
    if (next) {
      return (
        <span className="inline-flex flex-wrap items-center gap-1.5">
          <StatusBadge tone="warning">{tt["invoices.reminders.dueNow"]}</StatusBadge>
          <span className="text-small text-muted-foreground">{level(next)}</span>
        </span>
      );
    }
    return (
      <span className="text-small text-muted-foreground">{tt["invoices.reminders.notDue"]}</span>
    );
  };

  const actions = (row: AgingRow) => (
    <RowActions
      menuTestId={`button-row-menu-${row.invoice.number}`}
      menu={
        <>
          <DropdownMenuItem
            onSelect={() => setTimelineFor(row.invoice)}
            data-testid={`button-history-${row.invoice.number}`}
          >
            <Clock aria-hidden />
            {tt["invoices.reminders.viewTimeline"]}
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => onToggleDoNotChase(row.invoice.id, !row.invoice.doNotChase)}
            data-testid={`button-dnc-${row.invoice.number}`}
          >
            {row.invoice.doNotChase ? <PlayCircle aria-hidden /> : <PauseCircle aria-hidden />}
            {row.invoice.doNotChase
              ? tt["invoices.reminders.resume"]
              : tt["invoices.reminders.pause"]}
          </DropdownMenuItem>
        </>
      }
    >
      <Button
        size="sm"
        variant="outline"
        onClick={() => onSend(row.invoice.id)}
        disabled={row.invoice.doNotChase || sending}
        data-testid={`button-send-${row.invoice.number}`}
      >
        {tt["invoices.reminders.send"]}
      </Button>
    </RowActions>
  );

  const noMatches = sorted.length === 0;

  return (
    <div className="space-y-3">
      {stale && (
        <div
          role="status"
          className="rounded-md border border-border px-3 py-2 text-small text-muted-foreground"
          data-testid="overdue-stale"
        >
          {tt["invoices.reminders.staleNotice"]}
        </div>
      )}
      <Input
        ref={searchInput}
        type="search"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder={tt["invoices.reminders.searchPlaceholder"]}
        aria-label={tt["invoices.reminders.searchLabel"]}
        className="max-w-sm"
        data-testid="input-search-overdue"
      />
      <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {noMatches ? tt["invoices.reminders.noMatchTitle"] : ""}
      </div>
      {noMatches ? (
        <Card>
          <EmptyState
            size="md"
            icon={SearchX}
            title={tt["invoices.reminders.noMatchTitle"]}
            description={tt["invoices.reminders.noMatchBody"]}
            action={{
              label: tt["invoices.reminders.clearSearch"],
              onClick: () => {
                setSearch("");
                searchInput.current?.focus();
              },
            }}
          />
        </Card>
      ) : (
        <>
          {/* Phones: one card per invoice. */}
          <Card className="divide-hairline md:hidden">
            {sorted.map((row) => (
              <div key={row.invoice.id} className="flex items-start justify-between gap-3 p-4">
                <div className="min-w-0 space-y-1">
                  <div dir="auto" className="truncate text-small font-medium text-foreground">
                    {row.invoice.customerName}
                  </div>
                  <div className="text-caption text-muted-foreground">
                    <span dir="ltr" className="[unicode-bidi:isolate]">
                      {row.invoice.number}
                    </span>
                    {" · "}
                    {row.daysOverdue} {tt["invoices.reminders.colDaysOverdue"]}
                  </div>
                  <div>{nextCell(row)}</div>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-2">
                  <Money
                    amount={row.outstanding}
                    currency={row.invoice.currency}
                    className="text-small font-semibold"
                  />
                  {actions(row)}
                </div>
              </div>
            ))}
          </Card>

          <Card className="hidden overflow-hidden md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{tt["invoices.reminders.colInvoice"]}</TableHead>
                  <TableHead className="text-end">
                    {tt["invoices.reminders.colOutstanding"]}
                  </TableHead>
                  <TableHead className="text-end">
                    {tt["invoices.reminders.colDaysOverdue"]}
                  </TableHead>
                  <TableHead>{tt["invoices.reminders.colLastReminder"]}</TableHead>
                  <TableHead>{tt["invoices.reminders.colNextReminder"]}</TableHead>
                  <TableHead className="w-px">
                    <span className="sr-only">{tt["invoices.reminders.colActions"]}</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sorted.map((row) => (
                  <TableRow key={row.invoice.id} data-testid={`overdue-row-${row.invoice.number}`}>
                    <TableCell>
                      <div dir="auto" className="font-medium text-foreground">
                        {row.invoice.customerName}
                      </div>
                      <div className="text-caption text-muted-foreground">
                        <span dir="ltr" className="[unicode-bidi:isolate]">
                          {row.invoice.number}
                        </span>
                      </div>
                    </TableCell>
                    <MoneyCell amount={row.outstanding} currency={row.invoice.currency} />
                    <TableCell className="text-end tabular-nums">{row.daysOverdue}</TableCell>
                    <TableCell className="text-small">
                      {row.invoice.chaseLevel ? (
                        level(row.invoice.chaseLevel)
                      ) : (
                        <span className="text-muted-foreground">
                          {tt["invoices.reminders.notSentYet"]}
                        </span>
                      )}
                    </TableCell>
                    <TableCell>{nextCell(row)}</TableCell>
                    <TableCell>{actions(row)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>

          <InvoiceTimelineDialog invoice={timelineFor} onClose={() => setTimelineFor(null)} />
        </>
      )}
    </div>
  );
}
