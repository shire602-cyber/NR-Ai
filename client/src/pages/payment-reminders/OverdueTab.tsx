import { useMemo, useState } from "react";
import { CheckCircle2, Clock, PauseCircle, PlayCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
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
import type { AgingRow } from "./types";

export function OverdueTab({
  rows,
  queue,
  loading,
  error,
  sending,
  onSend,
  onToggleDoNotChase,
}: {
  rows: AgingRow[];
  queue: AgingRow[];
  loading: boolean;
  error: boolean;
  sending: boolean;
  onSend: (invoiceId: string) => void;
  onToggleDoNotChase: (invoiceId: string, value: boolean) => void;
}) {
  const { t } = useTranslation();
  const tt = t as Record<string, string>;
  const [timelineFor, setTimelineFor] = useState<AgingRow["invoice"] | null>(null);
  const sorted = useMemo(() => [...rows].sort((a, b) => b.daysOverdue - a.daysOverdue), [rows]);
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
  if (error) {
    return (
      <Card className="p-5 text-small text-danger" role="alert">
        {tt["invoices.reminders.loadError"]}
      </Card>
    );
  }
  if (sorted.length === 0) {
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
    return <span className="text-small text-muted-foreground">{tt["invoices.reminders.notDue"]}</span>;
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

  return (
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
              <TableHead className="text-end">{tt["invoices.reminders.colOutstanding"]}</TableHead>
              <TableHead className="text-end">{tt["invoices.reminders.colDaysOverdue"]}</TableHead>
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
  );
}
