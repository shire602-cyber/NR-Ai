import { useMemo, useState, type ChangeEvent } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Bell, Mail, MailCheck, MessageSquare, Plus } from "lucide-react";
import type { ReminderLog, ReminderSetting } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SetupNotice } from "@/components/ui/setup-notice";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge, type StatusTone } from "@/components/ui/status-badge";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { formatDate } from "@/lib/format-date";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { formatMessage, translateNow, useTranslation } from "@/lib/i18n";
import { TokenEditor, type TokenField } from "./payment-reminders/TokenEditor";

/**
 * Automatic reminder emails (the former /reminders page). Since spec 3.7 they live inside
 * Payment reminders: the rules in the Schedule tab, the delivery log in the History tab.
 * `/reminders` redirects to `/payment-chasing?tab=schedule`.
 */

const REMINDER_TYPES = [
  "invoice_overdue",
  "invoice_due_soon",
  "vat_deadline",
  "payment_followup",
] as const;

/** Merge fields of the reminder email renderer (`reminderTemplateVars` in email.service). */
const EMAIL_FIELDS = [
  "customerName",
  "invoiceNumber",
  "amountDue",
  "total",
  "dueDate",
  "daysOverdue",
  "companyName",
  "payLink",
] as const;

const FIELD_LABEL_KEY: Record<(typeof EMAIL_FIELDS)[number], string> = {
  customerName: "invoices.reminders.field.customerName",
  invoiceNumber: "invoices.reminders.field.invoiceNumber",
  amountDue: "invoices.reminders.field.amount",
  total: "invoices.reminders.field.total",
  dueDate: "invoices.reminders.field.dueDate",
  daysOverdue: "invoices.reminders.field.daysOverdue",
  companyName: "invoices.reminders.field.senderName",
  payLink: "invoices.reminders.field.paymentLink",
};

const settingsKey = (companyId?: string) => ["/api/companies", companyId, "reminder-settings"];
const logsKey = (companyId?: string) => ["/api/companies", companyId, "reminder-logs"];

const BLANK_RULE = {
  reminderType: "",
  isEnabled: true,
  daysBeforeDue: 3,
  daysAfterDue: 1,
  repeatIntervalDays: 7,
  maxReminders: 3,
  sendEmail: true,
  sendSms: false,
  sendInApp: true,
  emailSubject: "",
  emailTemplate: "",
  language: "bilingual" as "en" | "ar" | "bilingual",
};

export function AutomaticEmailRules({ companyId }: { companyId?: string }) {
  const { t } = useTranslation();
  const tt = t as Record<string, string>;
  const { toast } = useToast();
  const [createOpen, setCreateOpen] = useState(false);

  // W4-D (R16-08): honest delivery state; without an email provider nothing is emailed.
  const { data: emailStatus } = useQuery<{ configured: boolean }>({
    queryKey: ["/api/companies", companyId, "email-outbox", "status"],
    enabled: !!companyId,
  });
  const { data: settings, isLoading } = useQuery<ReminderSetting[]>({
    queryKey: settingsKey(companyId),
    enabled: !!companyId,
  });

  const runNow = useMutation({
    mutationFn: () => apiRequest("POST", `/api/companies/${companyId}/reminders/run`),
    onSuccess: (r: { sent: number; queued: number; blocked: number; message: string | null }) => {
      queryClient.invalidateQueries({ queryKey: logsKey(companyId) });
      toast({
        title: formatMessage(tt["invoices.reminders.runResult"], {
          sent: r.sent,
          total: r.queued + r.blocked,
        }),
        description: r.message ?? undefined,
      });
    },
    onError: (error: Error) =>
      toast({
        title: translateNow("toasts.error"),
        description: error?.message,
        variant: "destructive",
      }),
  });

  const updateRule = useMutation({
    mutationFn: ({ id, ...data }: { id: string } & Partial<ReminderSetting>) =>
      apiRequest("PATCH", `/api/reminder-settings/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: settingsKey(companyId) });
      toast({ title: t["pages.remindersUpdated"] });
    },
  });

  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-start justify-between gap-3 space-y-0">
        <div className="min-w-0">
          <CardTitle>{tt["invoices.reminders.autoEmailsTitle"]}</CardTitle>
          <CardDescription>{tt["invoices.reminders.autoEmailsBody"]}</CardDescription>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => runNow.mutate()}
            disabled={runNow.isPending}
            data-testid="button-run-reminders"
          >
            {tt["invoices.reminders.runNow"]}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setCreateOpen(true)}
            data-testid="button-create-reminder"
          >
            <Plus aria-hidden />
            {tt["invoices.reminders.addRule"]}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 pt-0">
        {emailStatus && !emailStatus.configured && (
          <SetupNotice data-testid="email-not-configured-banner">
            {tt["invoices.reminders.emailNotReady"]}
          </SetupNotice>
        )}
        {isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : !settings?.length ? (
          <EmptyState
            size="sm"
            title={tt["invoices.reminders.noRulesTitle"]}
            description={tt["invoices.reminders.noRulesBody"]}
          />
        ) : (
          <ul className="divide-hairline rounded-lg border border-border">
            {settings.map((rule) => (
              <li
                key={rule.id}
                className="flex items-center justify-between gap-4 px-4 py-3"
                data-testid={`card-setting-${rule.id}`}
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-small font-medium text-foreground">
                      {tt[`invoices.reminders.type.${rule.reminderType}`] ??
                        tt["invoices.reminders.type.payment_followup"]}
                    </span>
                    <StatusBadge tone={rule.isEnabled ? "success" : "neutral"}>
                      {rule.isEnabled
                        ? tt["invoices.reminders.ruleActive"]
                        : tt["invoices.reminders.ruleOff"]}
                    </StatusBadge>
                  </div>
                  <p className="text-caption text-muted-foreground">
                    {formatMessage(tt["invoices.reminders.ruleSummary"], {
                      before: rule.daysBeforeDue ?? 0,
                      after: rule.daysAfterDue ?? 0,
                      repeat: rule.repeatIntervalDays ?? 7,
                      max: rule.maxReminders ?? 3,
                    })}
                  </p>
                </div>
                <Switch
                  checked={rule.isEnabled}
                  onCheckedChange={(checked) => updateRule.mutate({ id: rule.id, isEnabled: checked })}
                  aria-label={tt[`invoices.reminders.type.${rule.reminderType}`]}
                  data-testid={`switch-enable-${rule.id}`}
                />
              </li>
            ))}
          </ul>
        )}
      </CardContent>
      <CreateRuleDialog companyId={companyId} open={createOpen} onOpenChange={setCreateOpen} />
    </Card>
  );
}

function CreateRuleDialog({
  companyId,
  open,
  onOpenChange,
}: {
  companyId?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const tt = t as Record<string, string>;
  const { toast } = useToast();
  const [rule, setRule] = useState(BLANK_RULE);
  const fields: TokenField[] = useMemo(
    () => EMAIL_FIELDS.map((key) => ({ key, label: tt[FIELD_LABEL_KEY[key]] })),
    [tt]
  );
  const create = useMutation({
    mutationFn: (data: typeof BLANK_RULE) =>
      apiRequest("POST", `/api/companies/${companyId}/reminder-settings`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: settingsKey(companyId) });
      onOpenChange(false);
      setRule(BLANK_RULE);
      toast({ title: t["pages.remindersCreated"] });
    },
    onError: (error: Error) =>
      toast({
        title: translateNow("toasts.error"),
        description: error?.message,
        variant: "destructive",
      }),
  });
  const number = (key: "daysBeforeDue" | "daysAfterDue" | "repeatIntervalDays" | "maxReminders") => ({
    type: "number" as const,
    inputMode: "numeric" as const,
    value: rule[key],
    onChange: (e: ChangeEvent<HTMLInputElement>) =>
      setRule({ ...rule, [key]: parseInt(e.target.value) || 0 }),
  });
  const channels = [
    { key: "sendInApp", icon: Bell, label: tt["invoices.reminders.channelInApp"], testId: "switch-in-app" },
    { key: "sendEmail", icon: Mail, label: tt["invoices.reminders.channelEmail"], testId: "switch-email" },
    { key: "sendSms", icon: MessageSquare, label: tt["invoices.reminders.channelSms"], testId: "switch-sms" },
  ] as const;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>{tt["invoices.reminders.ruleDialogTitle"]}</DialogTitle>
          <DialogDescription>{tt["invoices.reminders.ruleDialogDesc"]}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="space-y-1.5">
            <Label>{tt["invoices.reminders.ruleType"]}</Label>
            <Select
              value={rule.reminderType}
              onValueChange={(value) => setRule({ ...rule, reminderType: value })}
            >
              <SelectTrigger data-testid="select-reminder-type">
                <SelectValue placeholder={tt["invoices.reminders.ruleTypePlaceholder"]} />
              </SelectTrigger>
              <SelectContent>
                {REMINDER_TYPES.map((type) => (
                  <SelectItem key={type} value={type}>
                    {tt[`invoices.reminders.type.${type}`]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="rule-before">{tt["invoices.reminders.daysBefore"]}</Label>
              <Input id="rule-before" {...number("daysBeforeDue")} data-testid="input-days-before" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rule-after">{tt["invoices.reminders.daysAfter"]}</Label>
              <Input id="rule-after" {...number("daysAfterDue")} data-testid="input-days-after" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rule-repeat">{tt["invoices.reminders.repeatEvery"]}</Label>
              <Input
                id="rule-repeat"
                {...number("repeatIntervalDays")}
                data-testid="input-repeat-interval"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rule-max">{tt["invoices.reminders.maxCount"]}</Label>
              <Input id="rule-max" {...number("maxReminders")} data-testid="input-max-reminders" />
            </div>
          </div>
          <fieldset className="space-y-2">
            <legend className="text-small font-medium">{tt["invoices.reminders.channels"]}</legend>
            <div className="flex flex-wrap gap-x-6 gap-y-2">
              {channels.map(({ key, icon: Icon, label, testId }) => (
                <label key={key} className="flex min-h-11 items-center gap-2 text-small">
                  <Switch
                    checked={rule[key]}
                    onCheckedChange={(checked) => setRule({ ...rule, [key]: checked })}
                    data-testid={testId}
                  />
                  <Icon className="h-4 w-4 text-muted-foreground" aria-hidden />
                  {label}
                </label>
              ))}
            </div>
          </fieldset>
          <div className="space-y-1.5">
            <Label>{tt["invoices.reminders.emailLanguage"]}</Label>
            <Select
              value={rule.language}
              onValueChange={(value) =>
                setRule({ ...rule, language: value as typeof BLANK_RULE.language })
              }
            >
              <SelectTrigger data-testid="select-reminder-language">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="bilingual">{tt["invoices.reminders.langBoth"]}</SelectItem>
                <SelectItem value="en">{tt["invoices.reminders.langEn"]}</SelectItem>
                <SelectItem value="ar">{tt["invoices.reminders.langAr"]}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label id="rule-subject-label">{tt["invoices.reminders.optionalSubject"]}</Label>
            <TokenEditor
              value={rule.emailSubject}
              onChange={(emailSubject) => setRule({ ...rule, emailSubject })}
              syntax="double"
              fields={fields}
              multiline={false}
              insertLabel={tt["invoices.reminders.insertField"]}
              aria-labelledby="rule-subject-label"
              testId="input-email-subject"
            />
          </div>
          <div className="space-y-1.5">
            <Label id="rule-body-label">{tt["invoices.reminders.optionalBody"]}</Label>
            <TokenEditor
              value={rule.emailTemplate}
              onChange={(emailTemplate) => setRule({ ...rule, emailTemplate })}
              syntax="double"
              fields={fields}
              insertLabel={tt["invoices.reminders.insertField"]}
              aria-labelledby="rule-body-label"
              testId="input-email-template"
            />
            <p className="text-small text-muted-foreground">
              {tt["invoices.reminders.optionalBodyHint"]}
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {tt["invoices.reminders.cancel"]}
          </Button>
          <Button
            onClick={() => create.mutate(rule)}
            disabled={!rule.reminderType || create.isPending}
            data-testid="button-save-reminder"
          >
            {tt["invoices.reminders.createRule"]}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const LOG_TONE: Record<string, StatusTone> = {
  sent: "success",
  delivered: "success",
  queued: "neutral",
  retrying: "neutral",
  sending: "neutral",
  pending: "neutral",
  skipped: "neutral",
  requires_external: "neutral",
  blocked_no_provider: "warning",
  failed: "danger",
  dead: "danger",
  bounced: "danger",
  complained: "danger",
};

/** Status label: outbox states have catalog labels; the rest map to the shared ones. */
function logStatusLabel(status: string, t: Record<string, string>): string {
  if (status === "blocked_no_provider") return t["portal.emailNotConfiguredShort"];
  if (status === "requires_external") return t["portal.requiresExternal"];
  if (status === "sent") return t["invoices.reminders.result.sent"];
  if (status === "delivered") return t["pageLabels.delivered"];
  if (status === "failed") return t["invoices.reminders.status.failed"];
  if (status === "pending") return t["invoices.reminders.status.pending"];
  return t[`portal.outboxStatus.${status}`] ?? t["invoices.reminders.status.pending"];
}

export function AutomaticEmailLog({ companyId }: { companyId?: string }) {
  const { t, locale } = useTranslation();
  const tt = t as Record<string, string>;
  const { data: logs, isLoading } = useQuery<ReminderLog[]>({
    queryKey: logsKey(companyId),
    enabled: !!companyId,
  });
  if (isLoading) return <Skeleton className="h-24 w-full" />;
  // Nothing has ever been emailed automatically: the section stays out of the way.
  if (!logs?.length) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{tt["invoices.reminders.autoLogTitle"]}</CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        <ul className="divide-hairline">
          {logs.map((log) => (
            <li
              key={log.id}
              className="flex flex-wrap items-center justify-between gap-3 py-3"
              data-testid={`card-log-${log.id}`}
            >
              <div className="flex min-w-0 items-center gap-3">
                {log.channel === "email" ? (
                  <MailCheck className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                ) : (
                  <Bell className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                )}
                <div className="min-w-0">
                  <div className="text-small font-medium">
                    {tt[`invoices.reminders.type.${log.reminderType}`] ??
                      tt["invoices.reminders.type.payment_followup"]}
                  </div>
                  <div className="truncate text-caption text-muted-foreground" dir="auto">
                    {log.recipientEmail || log.recipientPhone || tt["invoices.reminders.logInApp"]}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-3 text-caption text-muted-foreground">
                <span>
                  {formatMessage(tt["invoices.reminders.logStep"], {
                    level: log.level ?? log.attemptNumber,
                  })}
                </span>
                <StatusBadge tone={LOG_TONE[log.status] ?? "neutral"}>
                  {logStatusLabel(log.status, tt)}
                </StatusBadge>
                <span className="tabular-nums">{log.sentAt ? formatDate(log.sentAt, locale) : "—"}</span>
              </div>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
