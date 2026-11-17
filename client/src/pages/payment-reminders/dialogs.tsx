import { useQuery } from "@tanstack/react-query";
import { Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Money } from "@/components/ui/money";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/ui/status-badge";
import { useToast } from "@/hooks/use-toast";
import { formatDate } from "@/lib/format-date";
import { apiRequest } from "@/lib/queryClient";
import { formatMessage, translateNow, useTranslation } from "@/lib/i18n";
import { recordStatusTone, type AgingRow, type BulkSendResponse, type ChaseRecord } from "./types";

/** A prepared reminder: the customer-facing text, ready to copy into an email. */
export function ReminderReadyDialog({
  ready,
  onClose,
}: {
  ready: { body: string; language: "en" | "ar" } | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const tt = t as Record<string, string>;
  const { toast } = useToast();
  const copy = async () => {
    try {
      if (!navigator.clipboard?.writeText) throw new Error("clipboard");
      await navigator.clipboard.writeText(ready?.body ?? "");
      toast({ title: t["pages.chasingCopied"] });
    } catch {
      toast({
        title: translateNow("toasts.couldNotCopy"),
        description: translateNow("toasts.selectTextCopyManually"),
        variant: "destructive",
      });
    }
  };
  return (
    <Dialog open={!!ready} onOpenChange={(open) => !open && onClose()}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>{tt["invoices.reminders.readyTitle"]}</DialogTitle>
          <DialogDescription>{tt["invoices.reminders.readyBody"]}</DialogDescription>
        </DialogHeader>
        <div
          className="max-h-[50vh] overflow-y-auto whitespace-pre-wrap rounded-lg border border-border bg-surface-sunken p-4 text-small leading-6 text-foreground"
          dir={ready?.language === "ar" ? "rtl" : "ltr"}
          lang={ready?.language}
          data-testid="textarea-preview"
        >
          {ready?.body}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {tt["invoices.reminders.close"]}
          </Button>
          <Button onClick={copy} data-testid="button-copy-preview">
            <Copy aria-hidden />
            {tt["invoices.reminders.copy"]}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Every reminder sent for one invoice, newest first, with the message as sent. */
export function InvoiceTimelineDialog({
  invoice,
  onClose,
}: {
  invoice: AgingRow["invoice"] | null;
  onClose: () => void;
}) {
  const { t, locale } = useTranslation();
  const tt = t as Record<string, string>;
  const query = useQuery<ChaseRecord[]>({
    queryKey: ["/api/chasing/invoice", invoice?.id, "history"],
    queryFn: () => apiRequest("GET", `/api/chasing/invoice/${invoice!.id}/history`),
    enabled: !!invoice,
  });
  return (
    <Dialog open={!!invoice} onOpenChange={(open) => !open && onClose()}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>
            {formatMessage(tt["invoices.reminders.timelineTitle"], {
              number: invoice?.number ?? "",
            })}
          </DialogTitle>
          <DialogDescription dir="auto">{invoice?.customerName}</DialogDescription>
        </DialogHeader>
        {query.isLoading && <Skeleton className="h-32" />}
        {query.isError && (
          <p className="text-small text-danger">{tt["invoices.reminders.historyError"]}</p>
        )}
        {query.data && query.data.length === 0 && (
          <p className="text-small text-muted-foreground">
            {tt["invoices.reminders.timelineEmpty"]}
          </p>
        )}
        <ol className="max-h-[60vh] space-y-4 overflow-y-auto">
          {query.data?.map((c) => (
            <li
              key={c.id}
              className="border-s-2 border-border ps-4"
              data-testid={`timeline-entry-${c.id}`}
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-small font-medium text-foreground">
                  {tt[`invoices.reminders.level.${c.level}`] ?? c.level}
                </span>
                <span className="text-caption text-muted-foreground">
                  {formatDate(c.sentAt, locale)}
                </span>
                <StatusBadge tone={recordStatusTone(c.status)}>
                  {tt[`invoices.reminders.status.${c.status}`] ??
                    tt["invoices.reminders.status.pending"]}
                </StatusBadge>
              </div>
              <p
                className="mt-2 whitespace-pre-wrap text-small text-muted-foreground"
                dir={c.language === "ar" ? "rtl" : "ltr"}
                lang={c.language === "ar" ? "ar" : "en"}
              >
                {c.messageText}
              </p>
              {c.paidAt && (
                <p className="mt-2 text-caption text-success">
                  {tt["invoices.reminders.status.paid"]} · {formatDate(c.paidAt, locale)}
                </p>
              )}
            </li>
          ))}
        </ol>
      </DialogContent>
    </Dialog>
  );
}

/** Outcome of "Send due reminders": one line per invoice. */
export function BulkResultsDialog({
  results,
  rows,
  onClose,
}: {
  results: BulkSendResponse | null;
  rows: AgingRow[];
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const tt = t as Record<string, string>;
  const byId = new Map(rows.map((r) => [r.invoice.id, r]));
  return (
    <Dialog open={!!results} onOpenChange={(open) => !open && onClose()}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>{tt["invoices.reminders.bulkResultsTitle"]}</DialogTitle>
          <DialogDescription>
            {results &&
              formatMessage(tt["invoices.reminders.bulkSummary"], {
                sent: results.sent,
                skipped: results.skipped,
                failed: results.failed,
              })}
          </DialogDescription>
        </DialogHeader>
        <ul className="max-h-[50vh] divide-hairline overflow-y-auto">
          {results?.results.map((r) => {
            const row = byId.get(r.invoiceId);
            return (
              <li
                key={r.invoiceId}
                className="flex items-center justify-between gap-3 py-2.5"
                data-testid={`bulk-result-${r.invoiceId}`}
              >
                <div className="min-w-0">
                  <div dir="auto" className="truncate text-small font-medium">
                    {row?.invoice.customerName ?? ""}
                  </div>
                  <div className="text-caption text-muted-foreground">
                    <span dir="ltr" className="[unicode-bidi:isolate]">
                      {row?.invoice.number ?? ""}
                    </span>
                    {r.level > 0 ? ` · ${tt[`invoices.reminders.level.${r.level}`] ?? ""}` : ""}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {row && (
                    <Money
                      amount={row.outstanding}
                      currency={row.invoice.currency}
                      className="text-small"
                    />
                  )}
                  <StatusBadge
                    tone={
                      r.status === "sent" ? "success" : r.status === "failed" ? "danger" : "neutral"
                    }
                  >
                    {tt[`invoices.reminders.result.${r.status}`] ??
                      tt["invoices.reminders.status.pending"]}
                  </StatusBadge>
                </div>
              </li>
            );
          })}
        </ul>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {tt["invoices.reminders.close"]}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
