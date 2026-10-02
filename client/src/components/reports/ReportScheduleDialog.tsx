import { useEffect, useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import type { ReportParamKind } from "@shared/report-result";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useReportScheduleAccess } from "@/hooks/useReportScheduleAccess";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "@/lib/i18n";
import { queryClient } from "@/lib/queryClient";
import {
  AS_OF_PRESETS,
  RANGE_PRESETS,
  type AsOfPreset,
  type RangePreset,
} from "@/lib/report-presets";
import { reportUiRule } from "@/lib/report-ui-rules";
import type { ReportViewState } from "@/lib/reportRunApi";
import {
  DAYS_OF_MONTH,
  DAYS_OF_WEEK,
  HOURS_OF_DAY,
  MAX_SCHEDULE_RECIPIENTS,
  SENSITIVE_SCHEDULE_ROLES,
  createSchedule,
  hourLabel,
  schedulesQueryKey,
  updateSchedule,
  type ReportScheduleDto,
  type ScheduleCadence,
  type ScheduleComparison,
  type ScheduleFormat,
  type ScheduleInput,
} from "@/lib/reportSchedulesApi";
import { messages as paramMessages } from "./ReportParamsBar.i18n";
import { messages as pageMessages } from "./ReportScheduleDialog.i18n";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companyId: string | undefined;
  reportId: string;
  reportName: string;
  kinds: readonly ReportParamKind[];
  /** The viewer's current choices; presets and filters carry over into a new schedule. */
  initialState?: ReportViewState;
  /** Editing an existing schedule. */
  schedule?: ReportScheduleDto;
}

type Tr = ReturnType<typeof pageMessages.useT>;

/** "every Monday at 07:00", in words, for a toast or a list row. */
export function describeCadence(
  tr: Tr,
  s: {
    cadence: ScheduleCadence;
    dayOfWeek: number | null;
    dayOfMonth: number | null;
    hourDubai: number;
  }
): string {
  const time = hourLabel(s.hourDubai);
  const dayNames = [
    tr("sunday"),
    tr("monday"),
    tr("tuesday"),
    tr("wednesday"),
    tr("thursday"),
    tr("friday"),
    tr("saturday"),
  ];
  if (s.cadence === "weekly") return tr("whenWeekly", { day: dayNames[s.dayOfWeek ?? 0], time });
  if (s.cadence === "monthly") return tr("whenMonthly", { day: s.dayOfMonth ?? 1, time });
  return tr("whenDaily", { time });
}

interface FormState {
  format: ScheduleFormat;
  lang: "en" | "ar";
  cadence: ScheduleCadence;
  dayOfWeek: number;
  dayOfMonth: number;
  hourDubai: number;
  rangePreset: RangePreset;
  asOfPreset: AsOfPreset;
  compare: ScheduleComparison;
  filters: Record<string, string>;
  recipients: string[];
}

function initialForm(props: Props, uiLang: "en" | "ar", userId: string | null): FormState {
  const { schedule, initialState } = props;
  if (schedule) {
    return {
      format: schedule.format,
      lang: schedule.lang,
      cadence: schedule.cadence,
      dayOfWeek: schedule.dayOfWeek ?? 0,
      dayOfMonth: schedule.dayOfMonth ?? 1,
      hourDubai: schedule.hourDubai,
      rangePreset: schedule.params.rangePreset ?? "thisMonth",
      asOfPreset: schedule.params.asOfPreset ?? "today",
      compare: schedule.params.compare ?? "none",
      filters: schedule.params.filters ?? {},
      recipients: schedule.recipientUserIds,
    };
  }
  const state = initialState;
  const filters: Record<string, string> = {};
  for (const key of reportUiRule(props.reportId).filters) {
    const v = state?.filters[key];
    if (v) filters[key] = v;
  }
  return {
    format: "pdf",
    lang: uiLang,
    cadence: "monthly",
    dayOfWeek: 0,
    dayOfMonth: 1,
    hourDubai: 7,
    rangePreset: state && state.rangePreset !== "custom" ? state.rangePreset : "lastMonth",
    asOfPreset: state && state.asOfPreset !== "custom" ? state.asOfPreset : "today",
    compare:
      state && (state.compare === "priorPeriod" || state.compare === "priorYear")
        ? state.compare
        : "none",
    filters,
    recipients: userId ? [userId] : [],
  };
}

export function ReportScheduleDialog(props: Props) {
  const { open, onOpenChange, companyId, reportId, reportName, kinds, schedule } = props;
  const tr = pageMessages.useT();
  const pr = paramMessages.useT();
  const { toast } = useToast();
  const { locale } = useTranslation();
  const uiLang = locale === "ar" ? "ar" : "en";
  const { members, isLoadingMembers, userId } = useReportScheduleAccess(companyId);
  const rule = reportUiRule(reportId);
  const [form, setForm] = useState<FormState>(() => initialForm(props, uiLang, userId));

  // Start from the viewer's choices (or the schedule being edited) each time the dialog opens.
  useEffect(() => {
    if (open) setForm(initialForm(props, uiLang, userId));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, schedule?.id, reportId]);

  const eligible = useMemo(
    () =>
      rule.sensitive
        ? members.filter((m) => (SENSITIVE_SCHEDULE_ROLES as readonly string[]).includes(m.role))
        : members,
    [members, rule.sensitive]
  );

  const patch = (changes: Partial<FormState>) => setForm((f) => ({ ...f, ...changes }));
  const toggleRecipient = (id: string, on: boolean) =>
    patch({
      recipients: on
        ? [...new Set([...form.recipients, id])]
        : form.recipients.filter((r) => r !== id),
    });

  const hasRange = kinds.includes("range");
  const hasAsOf = kinds.includes("asOf");
  const canCompare = kinds.includes("comparison") && !rule.ownComparison;
  const tooMany = form.recipients.length > MAX_SCHEDULE_RECIPIENTS;
  const none = form.recipients.length === 0;

  const input = (): ScheduleInput => ({
    reportId,
    params: {
      ...(hasRange ? { rangePreset: form.rangePreset } : {}),
      ...(hasAsOf ? { asOfPreset: form.asOfPreset } : {}),
      ...(canCompare && form.compare !== "none" ? { compare: form.compare } : {}),
      ...(Object.keys(form.filters).length ? { filters: form.filters } : {}),
    },
    format: form.format,
    lang: form.lang,
    cadence: form.cadence,
    ...(form.cadence === "weekly" ? { dayOfWeek: form.dayOfWeek } : {}),
    ...(form.cadence === "monthly" ? { dayOfMonth: form.dayOfMonth } : {}),
    hourDubai: form.hourDubai,
    recipientUserIds: form.recipients,
  });

  const save = useMutation({
    mutationFn: () => {
      if (!companyId) throw new Error("No company");
      return schedule
        ? updateSchedule(companyId, schedule.id, input())
        : createSchedule(companyId, input());
    },
    onSuccess: (saved) => {
      void queryClient.invalidateQueries({ queryKey: schedulesQueryKey(companyId) });
      toast({
        title: schedule ? tr("updated") : tr("created"),
        description: schedule
          ? undefined
          : tr("createdDescription", { report: reportName, when: describeCadence(tr, saved) }),
      });
      onOpenChange(false);
    },
    onError: (error: any) =>
      toast({ variant: "destructive", title: tr("failed"), description: error?.message }),
  });

  const rangeLabel: Record<RangePreset, string> = {
    thisMonth: pr("thisMonth"),
    lastMonth: pr("lastMonth"),
    thisQuarter: pr("thisQuarter"),
    lastQuarter: pr("lastQuarter"),
    thisYear: pr("thisYear"),
    lastYear: pr("lastYear"),
    last30Days: pr("last30Days"),
    last90Days: pr("last90Days"),
  };
  const asOfLabel: Record<AsOfPreset, string> = {
    today: pr("today"),
    lastMonthEnd: pr("lastMonthEnd"),
    lastQuarterEnd: pr("lastQuarterEnd"),
    lastYearEnd: pr("lastYearEnd"),
  };
  const dayNames = [
    tr("sunday"),
    tr("monday"),
    tr("tuesday"),
    tr("wednesday"),
    tr("thursday"),
    tr("friday"),
    tr("saturday"),
  ];
  const filterText = Object.entries(form.filters)
    .map(([k, v]) => `${k}=${v}`)
    .join(", ");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[90vh] overflow-y-auto sm:max-w-xl"
        data-testid="dialog-report-schedule"
      >
        <DialogHeader>
          <DialogTitle>{schedule ? tr("editTitle") : tr("newTitle")}</DialogTitle>
          <DialogDescription>{tr("description", { report: reportName })}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>{tr("format")}</Label>
            <Select
              value={form.format}
              onValueChange={(v) => patch({ format: v as ScheduleFormat })}
            >
              <SelectTrigger data-testid="schedule-format">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="pdf">{tr("formatPdf")}</SelectItem>
                <SelectItem value="csv">{tr("formatCsv")}</SelectItem>
                <SelectItem value="xlsx">{tr("formatXlsx")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>{tr("language")}</Label>
            <Select value={form.lang} onValueChange={(v) => patch({ lang: v as "en" | "ar" })}>
              <SelectTrigger data-testid="schedule-lang">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="en">{tr("english")}</SelectItem>
                <SelectItem value="ar">{tr("arabic")}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>{tr("cadence")}</Label>
            <Select
              value={form.cadence}
              onValueChange={(v) => patch({ cadence: v as ScheduleCadence })}
            >
              <SelectTrigger data-testid="schedule-cadence">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="daily">{tr("daily")}</SelectItem>
                <SelectItem value="weekly">{tr("weekly")}</SelectItem>
                <SelectItem value="monthly">{tr("monthly")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {form.cadence === "weekly" ? (
            <div className="space-y-1.5">
              <Label>{tr("dayOfWeek")}</Label>
              <Select
                value={String(form.dayOfWeek)}
                onValueChange={(v) => patch({ dayOfWeek: Number(v) })}
              >
                <SelectTrigger data-testid="schedule-day-of-week">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DAYS_OF_WEEK.map((d) => (
                    <SelectItem key={d} value={String(d)}>
                      {dayNames[d]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}
          {form.cadence === "monthly" ? (
            <div className="space-y-1.5">
              <Label>{tr("dayOfMonth")}</Label>
              <Select
                value={String(form.dayOfMonth)}
                onValueChange={(v) => patch({ dayOfMonth: Number(v) })}
              >
                <SelectTrigger data-testid="schedule-day-of-month">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DAYS_OF_MONTH.map((d) => (
                    <SelectItem key={d} value={String(d)}>
                      {d}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}
          <div className="space-y-1.5">
            <Label>{tr("hour")}</Label>
            <Select
              value={String(form.hourDubai)}
              onValueChange={(v) => patch({ hourDubai: Number(v) })}
            >
              <SelectTrigger data-testid="schedule-hour">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {HOURS_OF_DAY.map((h) => (
                  <SelectItem key={h} value={String(h)}>
                    {hourLabel(h)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {hasRange || hasAsOf || canCompare ? (
          <fieldset className="space-y-3 rounded-md border p-3">
            <legend className="px-1 text-sm font-medium">{tr("dateChoices")}</legend>
            <div className="grid gap-4 sm:grid-cols-2">
              {hasRange ? (
                <div className="space-y-1.5">
                  <Label>{pr("period")}</Label>
                  <Select
                    value={form.rangePreset}
                    onValueChange={(v) => patch({ rangePreset: v as RangePreset })}
                  >
                    <SelectTrigger data-testid="schedule-range-preset">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {RANGE_PRESETS.map((p) => (
                        <SelectItem key={p} value={p}>
                          {rangeLabel[p]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : null}
              {hasAsOf ? (
                <div className="space-y-1.5">
                  <Label>{pr("asOfDay")}</Label>
                  <Select
                    value={form.asOfPreset}
                    onValueChange={(v) => patch({ asOfPreset: v as AsOfPreset })}
                  >
                    <SelectTrigger data-testid="schedule-asof-preset">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {AS_OF_PRESETS.map((p) => (
                        <SelectItem key={p} value={p}>
                          {asOfLabel[p]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : null}
              {canCompare ? (
                <div className="space-y-1.5">
                  <Label>{tr("comparison")}</Label>
                  <Select
                    value={form.compare}
                    onValueChange={(v) => patch({ compare: v as ScheduleComparison })}
                  >
                    <SelectTrigger data-testid="schedule-compare">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">{pr("compareNone")}</SelectItem>
                      <SelectItem value="priorPeriod">{pr("comparePriorPeriod")}</SelectItem>
                      <SelectItem value="priorYear">{pr("comparePriorYear")}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              ) : null}
            </div>
            <p className="text-xs text-muted-foreground">{tr("periodHint")}</p>
            {filterText ? (
              <p className="text-xs text-muted-foreground" dir="auto">
                {tr("filtersKept", { filters: filterText })}
              </p>
            ) : null}
          </fieldset>
        ) : null}

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">{tr("recipients")}</legend>
          <p className="text-xs text-muted-foreground">
            {rule.sensitive ? tr("recipientsSensitive") : tr("recipientsHint")}
          </p>
          {isLoadingMembers ? (
            <p className="text-sm text-muted-foreground">{tr("loadingMembers")}</p>
          ) : null}
          <div
            className="max-h-44 space-y-1 overflow-y-auto rounded-md border p-2"
            data-testid="schedule-recipients"
          >
            {eligible.map((m) => {
              const id = `recipient-${m.userId}`;
              const name = m.user?.name || m.user?.email || m.userId;
              return (
                <div key={m.userId} className="flex items-center gap-2 py-1">
                  <Checkbox
                    id={id}
                    checked={form.recipients.includes(m.userId)}
                    onCheckedChange={(c) => toggleRecipient(m.userId, c === true)}
                  />
                  <Label htmlFor={id} className="flex-1 cursor-pointer font-normal" dir="auto">
                    {name}
                    {m.userId === userId ? ` ${tr("you")}` : ""}
                    <span className="ms-2 text-xs text-muted-foreground" dir="ltr">
                      {m.user?.email}
                    </span>
                  </Label>
                </div>
              );
            })}
          </div>
          {none ? (
            <p role="alert" className="text-sm text-destructive">
              {tr("noRecipients")}
            </p>
          ) : null}
          {tooMany ? (
            <p role="alert" className="text-sm text-destructive">
              {tr("tooManyRecipients", { max: MAX_SCHEDULE_RECIPIENTS })}
            </p>
          ) : null}
        </fieldset>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {tr("cancel")}
          </Button>
          <Button
            onClick={() => save.mutate()}
            disabled={save.isPending || none || tooMany || !companyId}
            data-testid="button-save-schedule"
          >
            {save.isPending ? tr("saving") : tr("save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
