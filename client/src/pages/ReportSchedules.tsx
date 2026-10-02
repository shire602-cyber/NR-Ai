import { Fragment, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { CalendarClock, ChevronDown, ChevronUp, Pencil, Play, Trash2 } from "lucide-react";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
import { describeCadence, ReportScheduleDialog } from "@/components/reports/ReportScheduleDialog";
import { messages as dialogMessages } from "@/components/reports/ReportScheduleDialog.i18n";
import { useDefaultCompany } from "@/hooks/useDefaultCompany";
import { useReportScheduleAccess } from "@/hooks/useReportScheduleAccess";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "@/lib/i18n";
import { queryClient } from "@/lib/queryClient";
import { reportCatalog } from "@/lib/reportCatalog";
import { reportNameAr } from "@/lib/reportCatalogI18n";
import { REPORT_VIEWER_INDEX, reportViewerHref } from "@/lib/reportRunApi";
import {
  deleteSchedule,
  dubaiDateTime,
  listScheduleRuns,
  listSchedules,
  runScheduleNow,
  scheduleRunsQueryKey,
  schedulesQueryKey,
  updateSchedule,
  type ReportScheduleDto,
  type ReportScheduleRunDto,
  type ScheduleRunStatus,
} from "@/lib/reportSchedulesApi";
import { messages as pageMessages } from "./ReportSchedules.i18n";

type Tr = ReturnType<typeof pageMessages.useT>;

const schedulable = reportCatalog.filter(
  (r) => r.status === "live" && r.params && r.params.length > 0
);
const catalogEntry = (id: string) => reportCatalog.find((r) => r.id === id);

const STATUS_VARIANT: Record<ScheduleRunStatus, BadgeProps["variant"]> = {
  running: "secondary",
  sent: "success",
  skipped: "warning",
  failed: "destructive",
};

function statusLabel(tr: Tr, status: ScheduleRunStatus): string {
  return {
    running: tr("statusRunning"),
    sent: tr("statusSent"),
    skipped: tr("statusSkipped"),
    failed: tr("statusFailed"),
  }[status];
}

/** The server's reason codes in words; anything else (a render error, a provider message) is shown as it is. */
function reasonText(tr: Tr, reason: string | null): string {
  if (!reason) return "";
  if (reason === "EMAIL_NOT_CONFIGURED") return tr("reasonEmailNotConfigured");
  if (reason === "NO_RECIPIENTS") return tr("reasonNoRecipients");
  if (reason === "STALE_RUN") return tr("reasonStale");
  return reason;
}

function RunHistory({ companyId, schedule }: { companyId: string; schedule: ReportScheduleDto }) {
  const tr = pageMessages.useT();
  const runs = useQuery<ReportScheduleRunDto[]>({
    queryKey: scheduleRunsQueryKey(companyId, schedule.id),
    queryFn: () => listScheduleRuns(companyId, schedule.id),
    refetchInterval: (q) => (q.state.data?.some((r) => r.status === "running") ? 3000 : false),
  });
  if (runs.isLoading)
    return <p className="p-3 text-sm text-muted-foreground">{tr("loadingRuns")}</p>;
  if (!runs.data || runs.data.length === 0)
    return <p className="p-3 text-sm text-muted-foreground">{tr("noRuns")}</p>;
  return (
    <Table data-testid={`runs-${schedule.id}`}>
      <TableHeader>
        <TableRow>
          <TableHead>{tr("runWhen")}</TableHead>
          <TableHead>{tr("runTrigger")}</TableHead>
          <TableHead>{tr("runStatus")}</TableHead>
          <TableHead>{tr("runDetail")}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {runs.data.map((run) => (
          <TableRow key={run.id}>
            <TableCell className="whitespace-nowrap" dir="ltr">
              {dubaiDateTime(run.startedAt)}
            </TableCell>
            <TableCell>
              {run.trigger === "manual" ? tr("triggerManual") : tr("triggerSchedule")}
            </TableCell>
            <TableCell>
              <Badge variant={STATUS_VARIANT[run.status]}>{statusLabel(tr, run.status)}</Badge>
            </TableCell>
            <TableCell className="text-sm text-muted-foreground" dir="auto">
              {[
                run.status === "sent" ? tr("runSent", { count: run.recipientsSent }) : "",
                run.rowCount !== null ? tr.plural("runRows", run.rowCount) : "",
                run.byteSize !== null
                  ? tr("runSize", { kb: Math.max(1, Math.round(run.byteSize / 1024)) })
                  : "",
                reasonText(tr, run.reason),
              ]
                .filter(Boolean)
                .join(" · ")}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export default function ReportSchedules() {
  const tr = pageMessages.useT();
  const cadenceTr = dialogMessages.useT();
  const { locale } = useTranslation();
  const { toast } = useToast();
  const { companyId } = useDefaultCompany();
  const { canManage } = useReportScheduleAccess(companyId);
  const [openRuns, setOpenRuns] = useState<string | null>(null);
  const [editing, setEditing] = useState<ReportScheduleDto | null>(null);
  const [creatingFor, setCreatingFor] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<ReportScheduleDto | null>(null);

  const schedules = useQuery<ReportScheduleDto[]>({
    queryKey: schedulesQueryKey(companyId),
    queryFn: () => listSchedules(companyId as string),
    enabled: Boolean(companyId),
  });

  const nameOf = (id: string) =>
    locale === "ar"
      ? (reportNameAr[id] ?? catalogEntry(id)?.name ?? id)
      : (catalogEntry(id)?.name ?? id);
  const refresh = () => queryClient.invalidateQueries({ queryKey: schedulesQueryKey(companyId) });
  const onError = (error: any) =>
    toast({ variant: "destructive", title: tr("failed"), description: error?.message });

  const toggle = useMutation({
    mutationFn: (s: ReportScheduleDto) =>
      updateSchedule(companyId as string, s.id, { enabled: !s.enabled }),
    onSuccess: (saved) => {
      void refresh();
      toast({ title: saved.enabled ? tr("resumedToast") : tr("pausedToast") });
    },
    onError,
  });
  const runNow = useMutation({
    mutationFn: (s: ReportScheduleDto) => runScheduleNow(companyId as string, s.id),
    onSuccess: (_r, s) => {
      void refresh();
      void queryClient.invalidateQueries({
        queryKey: scheduleRunsQueryKey(companyId as string, s.id),
      });
      setOpenRuns(s.id);
      toast({ title: tr("runStarted"), description: tr("runStartedDescription") });
    },
    onError,
  });
  const remove = useMutation({
    mutationFn: (s: ReportScheduleDto) => deleteSchedule(companyId as string, s.id),
    onSuccess: () => {
      void refresh();
      setDeleting(null);
      toast({ title: tr("deletedToast") });
    },
    onError,
  });

  const list = schedules.data ?? [];
  const editEntry = editing ? catalogEntry(editing.reportId) : undefined;
  const createEntry = creatingFor ? catalogEntry(creatingFor) : undefined;

  return (
    <div className="space-y-6" data-testid="report-schedules-page">
      <PageHeader
        eyebrow={tr("eyebrow")}
        title={tr("title")}
        description={tr("description")}
        backHref={REPORT_VIEWER_INDEX}
        backLabel={tr("backToReports")}
      />
      {canManage ? (
        <div className="flex flex-wrap items-center gap-2">
          <Select value="" onValueChange={(v) => setCreatingFor(v)}>
            <SelectTrigger
              className="w-64"
              data-testid="select-new-schedule"
              aria-label={tr("newSchedule")}
            >
              <SelectValue placeholder={tr("newSchedule")} />
            </SelectTrigger>
            <SelectContent className="max-h-80">
              {schedulable.map((r) => (
                <SelectItem key={r.id} value={r.id}>
                  {nameOf(r.id)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : null}

      {!canManage && companyId ? (
        <p className="text-sm text-muted-foreground">{tr("noRole")}</p>
      ) : null}

      {schedules.isLoading ? (
        <div className="space-y-2" role="status" aria-label={tr("loading")}>
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      ) : null}

      {schedules.isError ? (
        <div className="space-y-2">
          <p className="text-sm text-destructive">{tr("loadError")}</p>
          <Button size="sm" variant="outline" onClick={() => void schedules.refetch()}>
            {tr("retry")}
          </Button>
        </div>
      ) : null}

      {schedules.isSuccess && list.length === 0 ? (
        <Card
          className="flex flex-col items-center gap-2 p-10 text-center"
          data-testid="schedules-empty"
        >
          <CalendarClock className="h-8 w-8 text-muted-foreground" aria-hidden />
          <p className="font-medium">{tr("emptyTitle")}</p>
          <p className="text-sm text-muted-foreground">
            {canManage ? tr("emptyBody") : tr("emptyViewer")}
          </p>
        </Card>
      ) : null}

      {list.length > 0 ? (
        <Card className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{tr("colReport")}</TableHead>
                <TableHead>{tr("colWhen")}</TableHead>
                <TableHead>{tr("colFile")}</TableHead>
                <TableHead>{tr("colRecipients")}</TableHead>
                <TableHead>{tr("colNext")}</TableHead>
                <TableHead>{tr("colLast")}</TableHead>
                <TableHead className="text-end">{tr("colActions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.map((s) => (
                <Fragment key={s.id}>
                  <TableRow data-testid={`schedule-row-${s.id}`}>
                    <TableCell className="font-medium">
                      <Link href={reportViewerHref(s.reportId)} className="hover:underline">
                        {nameOf(s.reportId)}
                      </Link>
                      {!s.enabled ? (
                        <Badge variant="secondary" className="ms-2">
                          {tr("paused")}
                        </Badge>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-sm">{describeCadence(cadenceTr, s)}</TableCell>
                    <TableCell className="text-sm uppercase" dir="ltr">
                      {s.format} · {s.lang}
                    </TableCell>
                    <TableCell className="text-sm">
                      {tr.plural("recipientsCount", s.recipientUserIds.length)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm" dir="ltr">
                      {s.enabled ? dubaiDateTime(s.nextRunAt) : ""}
                    </TableCell>
                    <TableCell className="text-sm">
                      {s.lastRunStatus ? (
                        <Badge variant={STATUS_VARIANT[s.lastRunStatus]}>
                          {statusLabel(tr, s.lastRunStatus)}
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground">{tr("neverRun")}</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setOpenRuns(openRuns === s.id ? null : s.id)}
                          aria-expanded={openRuns === s.id}
                          data-testid={`button-history-${s.id}`}
                        >
                          {openRuns === s.id ? (
                            <ChevronUp className="me-1 h-4 w-4" />
                          ) : (
                            <ChevronDown className="me-1 h-4 w-4" />
                          )}
                          {openRuns === s.id ? tr("hideHistory") : tr("history")}
                        </Button>
                        {canManage ? (
                          <>
                            <Switch
                              checked={s.enabled}
                              onCheckedChange={() => toggle.mutate(s)}
                              aria-label={s.enabled ? tr("pause") : tr("resume")}
                              data-testid={`switch-enabled-${s.id}`}
                            />
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => runNow.mutate(s)}
                              disabled={runNow.isPending}
                              aria-label={tr("runNow")}
                              title={tr("runNow")}
                              data-testid={`button-run-now-${s.id}`}
                            >
                              <Play className="h-4 w-4" />
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => setEditing(s)}
                              aria-label={tr("edit")}
                              title={tr("edit")}
                              data-testid={`button-edit-${s.id}`}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => setDeleting(s)}
                              aria-label={tr("delete")}
                              title={tr("delete")}
                              data-testid={`button-delete-${s.id}`}
                            >
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </>
                        ) : null}
                      </div>
                    </TableCell>
                  </TableRow>
                  {openRuns === s.id && companyId ? (
                    <TableRow className="bg-muted/30 hover:bg-muted/30">
                      <TableCell colSpan={7} className="p-0">
                        <RunHistory companyId={companyId} schedule={s} />
                      </TableCell>
                    </TableRow>
                  ) : null}
                </Fragment>
              ))}
            </TableBody>
          </Table>
        </Card>
      ) : null}

      {createEntry ? (
        <ReportScheduleDialog
          open
          onOpenChange={(o) => !o && setCreatingFor(null)}
          companyId={companyId}
          reportId={createEntry.id}
          reportName={nameOf(createEntry.id)}
          kinds={createEntry.params ?? []}
        />
      ) : null}
      {editing && editEntry ? (
        <ReportScheduleDialog
          open
          onOpenChange={(o) => !o && setEditing(null)}
          companyId={companyId}
          reportId={editEntry.id}
          reportName={nameOf(editEntry.id)}
          kinds={editEntry.params ?? []}
          schedule={editing}
        />
      ) : null}

      <AlertDialog open={deleting !== null} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{tr("deleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {deleting ? tr("deleteBody", { report: nameOf(deleting.reportId) }) : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tr("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleting && remove.mutate(deleting)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="button-confirm-delete-schedule"
            >
              {tr("delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
