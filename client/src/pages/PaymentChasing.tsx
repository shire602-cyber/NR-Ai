import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Send } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Money } from "@/components/ui/money";
import { StatCard } from "@/components/ui/stat-card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { useDefaultCompany } from "@/hooks/useDefaultCompany";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { formatMessage, translateNow, useTranslation } from "@/lib/i18n";
import { OverdueTab } from "./payment-reminders/OverdueTab";
import { ScheduleTab } from "./payment-reminders/ScheduleTab";
import { HistoryTab } from "./payment-reminders/HistoryTab";
import { BulkResultsDialog, ReminderReadyDialog } from "./payment-reminders/dialogs";
import {
  AGING_BUCKETS,
  type AgingBucket,
  type BulkSendResponse,
  type OverdueResponse,
  type QueueResponse,
} from "./payment-reminders/types";

// Above this many due reminders, "Send due reminders" asks for confirmation first.
const BULK_CONFIRM_THRESHOLD = 10;

type TabId = "overdue" | "schedule" | "history";
const TABS: TabId[] = ["overdue", "schedule", "history"];

function initialTab(): TabId {
  if (typeof window === "undefined") return "overdue";
  const tab = new URLSearchParams(window.location.search).get("tab");
  return TABS.includes(tab as TabId) ? (tab as TabId) : "overdue";
}

/**
 * Payment reminders (spec 3.7): one primary action, four aging tiles and three tabs —
 * Overdue (with the next reminder per invoice), Schedule (steps, wording, automatic emails)
 * and History. `/reminders` redirects to the Schedule tab.
 */
export default function PaymentChasing() {
  const { companyId } = useDefaultCompany();
  const { t, locale } = useTranslation();
  const tt = t as Record<string, string>;
  const { toast } = useToast();
  const [tab, setTab] = useState<TabId>(initialTab);
  const [ready, setReady] = useState<{ body: string; language: "en" | "ar" } | null>(null);
  const [bulkConfirmOpen, setBulkConfirmOpen] = useState(false);
  const [bulkResults, setBulkResults] = useState<BulkSendResponse | null>(null);

  const overdueQuery = useQuery<OverdueResponse>({
    queryKey: ["/api/chasing/overdue", companyId],
    queryFn: () => apiRequest("GET", `/api/chasing/overdue/${companyId}`),
    enabled: !!companyId,
  });
  const queueQuery = useQuery<QueueResponse>({
    queryKey: ["/api/chasing/queue", companyId],
    queryFn: () => apiRequest("GET", `/api/chasing/queue/${companyId}`),
    enabled: !!companyId,
  });

  const refreshChasing = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/chasing/overdue", companyId] });
    queryClient.invalidateQueries({ queryKey: ["/api/chasing/queue", companyId] });
    queryClient.invalidateQueries({ queryKey: ["/api/chasing/history", companyId] });
  };

  const sendOne = useMutation({
    mutationFn: (invoiceId: string) =>
      apiRequest("POST", `/api/chasing/send/${invoiceId}`, { method: "email", language: locale }),
    onSuccess: (data: { message: string }) => {
      toast({ title: translateNow("toasts.reminderReady") });
      // The message comes back in the language we asked for.
      setReady({ body: data.message, language: locale === "ar" ? "ar" : "en" });
      refreshChasing();
    },
    onError: (e: Error) =>
      toast({
        title: translateNow("toasts.couldNotSend"),
        description: e?.message,
        variant: "destructive",
      }),
  });

  const bulkSend = useMutation<BulkSendResponse, Error, void>({
    mutationFn: () =>
      apiRequest("POST", `/api/chasing/bulk-send/${companyId}`, {
        method: "email",
        language: locale,
      }),
    onSuccess: (data) => {
      const failed = data.failed ?? 0;
      toast({
        title: failed > 0 ? t["pages.chasingBulkErrors"] : t["pages.chasingBulkQueued"],
        description: formatMessage(translateNow("toasts.sentSkippedFailed"), {
          sent: data.sent,
          skipped: data.skipped,
          failed,
        }),
        variant: failed > 0 ? "destructive" : "default",
      });
      setBulkResults(data);
      refreshChasing();
    },
    onError: (e) =>
      toast({
        title: translateNow("toasts.bulkSendFailed"),
        description: e?.message,
        variant: "destructive",
      }),
  });

  const toggleDoNotChase = useMutation({
    mutationFn: ({ invoiceId, value }: { invoiceId: string; value: boolean }) =>
      apiRequest("PATCH", `/api/chasing/invoice/${invoiceId}/do-not-chase`, { doNotChase: value }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/chasing/overdue", companyId] });
      queryClient.invalidateQueries({ queryKey: ["/api/chasing/queue", companyId] });
    },
  });

  const rows = useMemo(() => overdueQuery.data?.rows ?? [], [overdueQuery.data?.rows]);
  const queue = useMemo(() => queueQuery.data?.queue ?? [], [queueQuery.data?.queue]);

  // Count and amount per aging bucket. An amount is shown only when every invoice in the
  // bucket shares one currency; a sum across currencies would be meaningless.
  const bucketTiles = useMemo(() => {
    return AGING_BUCKETS.map((bucket) => {
      const inBucket = rows.filter((r) => r.bucket === bucket);
      const currencies = new Set(inBucket.map((r) => r.invoice.currency));
      const amount = inBucket.reduce((sum, r) => sum + r.outstanding, 0);
      return {
        bucket,
        count: overdueQuery.data?.buckets?.[bucket] ?? inBucket.length,
        amount,
        currency: currencies.size === 1 ? [...currencies][0] : null,
        mixed: currencies.size > 1,
      };
    });
  }, [rows, overdueQuery.data?.buckets]);

  const sendDue = () => {
    if (queue.length > BULK_CONFIRM_THRESHOLD) setBulkConfirmOpen(true);
    else bulkSend.mutate();
  };

  return (
    <div className="space-y-8" data-testid="payment-chasing-page">
      <PageHeader
        eyebrow="Sales"
        title={tt["invoices.reminders.title"]}
        description={tt["invoices.reminders.description"]}
        actions={
          <Button
            onClick={sendDue}
            disabled={queue.length === 0 || bulkSend.isPending}
            data-testid="button-chase-all"
          >
            <Send aria-hidden />
            {bulkSend.isPending
              ? formatMessage(t["pages.chasingSending"], { count: queue.length })
              : formatMessage(tt["invoices.reminders.sendDue"], { count: queue.length })}
          </Button>
        }
      />

      {/* An empty ledger shows no zero tiles (spec 2.6). */}
      {(overdueQuery.isLoading || rows.length > 0) && (
        <div className="mobile-keep-cols grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
          {bucketTiles.map((tile) => (
            <StatCard
              key={tile.bucket}
              testId={`bucket-${tile.bucket}`}
              label={tt[`invoices.reminders.bucket.${tile.bucket as AgingBucket}`]}
              loading={overdueQuery.isLoading}
              value={
                tile.mixed ? (
                  <span className="money">{tile.count}</span>
                ) : (
                  <Money amount={tile.amount} currency={tile.currency ?? "AED"} />
                )
              }
              hint={
                tile.mixed
                  ? tt["invoices.reminders.bucketMixed"]
                  : tile.count === 0
                    ? tt["invoices.reminders.bucketNone"]
                    : formatMessage(
                        tt[
                          tile.count === 1
                            ? "invoices.reminders.bucketOne"
                            : "invoices.reminders.bucketCount"
                        ],
                        { count: tile.count }
                      )
              }
            />
          ))}
        </div>
      )}

      <Tabs value={tab} onValueChange={(v) => setTab(v as TabId)} className="space-y-4">
        <TabsList>
          <TabsTrigger value="overdue" data-testid="tab-reminders-overdue">
            {tt["invoices.reminders.tabOverdue"]}
          </TabsTrigger>
          <TabsTrigger value="schedule" data-testid="tab-reminders-schedule">
            {tt["invoices.reminders.tabSchedule"]}
          </TabsTrigger>
          <TabsTrigger value="history" data-testid="tab-reminders-history">
            {tt["invoices.reminders.tabHistory"]}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overdue" className="mt-0">
          <OverdueTab
            rows={rows}
            queue={queue}
            loading={overdueQuery.isLoading}
            error={overdueQuery.isError}
            sending={sendOne.isPending}
            onSend={(id) => sendOne.mutate(id)}
            onToggleDoNotChase={(invoiceId, value) => toggleDoNotChase.mutate({ invoiceId, value })}
          />
        </TabsContent>
        <TabsContent value="schedule" className="mt-0">
          <ScheduleTab companyId={companyId} />
        </TabsContent>
        <TabsContent value="history" className="mt-0">
          <HistoryTab companyId={companyId} rows={rows} />
        </TabsContent>
      </Tabs>

      <ReminderReadyDialog ready={ready} onClose={() => setReady(null)} />

      <AlertDialog open={bulkConfirmOpen} onOpenChange={setBulkConfirmOpen}>
        <AlertDialogContent data-testid="alert-bulk-confirm">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {formatMessage(tt["invoices.reminders.bulkTitle"], { count: queue.length })}
            </AlertDialogTitle>
            <AlertDialogDescription>{tt["invoices.reminders.bulkBody"]}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tt["invoices.reminders.cancel"]}</AlertDialogCancel>
            <AlertDialogAction
              data-testid="button-confirm-bulk"
              onClick={() => {
                setBulkConfirmOpen(false);
                bulkSend.mutate();
              }}
            >
              {formatMessage(tt["invoices.reminders.sendDue"], { count: queue.length })}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <BulkResultsDialog
        results={bulkResults}
        rows={[...queue, ...rows]}
        onClose={() => setBulkResults(null)}
      />
    </div>
  );
}
