import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useDefaultCompany } from "@/hooks/useDefaultCompany";
import { useCompanyPermission } from "@/hooks/useCompanyPermission";
import { formatMessage, translateNow, useTranslation } from "@/lib/i18n";
import { formatDateTime } from "@/lib/format-date";
import { apiRequest, queryClient } from "@/lib/queryClient";

/** One automation as GET /api/companies/:id/automations returns it (company-automations.ts). */
export interface AutomationRow {
  key: string;
  job: string;
  enabled: boolean;
  scheduled: boolean;
  cron: string | null;
  lastRunAt: string | null;
  lastStatus: "ok" | "failed" | null;
  lastSummary: Record<string, unknown> | null;
  lastError: string | null;
  nextRunAt: string | null;
  running: boolean;
}

/** Display order and the page each automation's results land on. */
const AUTOMATION_LINKS: Record<string, string> = {
  categorise: "/assistant?tab=review",
  paymentReminders: "/payment-chasing",
  recurringInvoices: "/recurring-invoices",
  recurringBills: "/bill-pay",
  recurringJournals: "/journal",
  reportDeliveries: "/reports",
  anomalyChecks: "/assistant?tab=review",
};

/** "3 sent", "2 created" … from the run summary (catalog keys per summary field). */
function summaryText(summary: Record<string, unknown> | null, t: Record<string, string>): string {
  if (!summary) return "";
  const parts: string[] = [];
  for (const [field, value] of Object.entries(summary)) {
    const n = Number(value);
    const key = `assistant.automationSummary_${field}`;
    if (!Number.isFinite(n) || !t[key]) continue;
    parts.push(formatMessage(t[key], { count: n }));
  }
  return parts.join(" · ");
}

/**
 * Assistant → Automations (WQ7): every scheduled automation the company has, each with an on/off
 * switch that the scheduler respects, its last run and result, and its next run. Switches need
 * the company-settings permission; everyone else sees the same rows read-only. Results land in
 * Review or on the module's own page as drafts or records; switching off never deletes them.
 */
export default function AutomationsPanel() {
  const { t, locale } = useTranslation();
  const { toast } = useToast();
  const { companyId } = useDefaultCompany();
  const { can } = useCompanyPermission();
  const canManage = can("settings.company");

  const list = useQuery<{ automations: AutomationRow[] }>({
    queryKey: ["/api/companies", companyId, "automations"],
    queryFn: () => apiRequest("GET", `/api/companies/${companyId}/automations`),
    enabled: !!companyId,
  });

  const toggle = useMutation({
    mutationFn: ({ key, enabled }: { key: string; enabled: boolean }) =>
      apiRequest("PUT", `/api/companies/${companyId}/automations/${key}`, { enabled }),
    onSuccess: (_data, vars) => {
      toast({
        title: translateNow(
          vars.enabled ? "assistant.automationTurnedOn" : "assistant.automationTurnedOff"
        ),
        description: translateNow(`assistant.automation_${vars.key}_title`),
      });
      void queryClient.invalidateQueries({
        queryKey: ["/api/companies", companyId, "automations"],
      });
    },
    onError: (error: Error) =>
      toast({
        title: translateNow("toasts.error"),
        description: error?.message,
        variant: "destructive",
      }),
  });

  const categorise = useMutation({
    mutationFn: () => apiRequest("POST", `/api/companies/${companyId}/ai-gl/scan`),
    onSuccess: (data: { scan?: { classified?: number } }) => {
      toast({
        title: translateNow("toasts.scanComplete2"),
        description: formatMessage(translateNow("assistant.scanResult"), {
          count: data?.scan?.classified ?? 0,
        }),
      });
      void queryClient.invalidateQueries({ queryKey: ["/api/companies", companyId, "ai-gl"] });
    },
    onError: (error: Error) =>
      toast({
        title: translateNow("toasts.scanFailed2"),
        description: error?.message,
        variant: "destructive",
      }),
  });

  const checks = useMutation({
    mutationFn: () => apiRequest("POST", "/api/ai/detect-anomalies", { companyId }),
    onSuccess: (data: { summary?: { totalAnomalies?: number } }) => {
      toast({
        title: translateNow("toasts.scanComplete2"),
        description: formatMessage(translateNow("toasts.foundPotentialIssues"), {
          count: data?.summary?.totalAnomalies ?? 0,
        }),
      });
      void queryClient.invalidateQueries({
        queryKey: ["/api/companies", companyId, "anomaly-alerts"],
      });
      void queryClient.invalidateQueries({ queryKey: [`/api/companies/${companyId}/anomalies`] });
    },
    onError: (error: Error) =>
      toast({
        title: translateNow("toasts.error"),
        description: error?.message,
        variant: "destructive",
      }),
  });

  const runNow: Record<string, { run: () => void; pending: boolean; testId: string }> = {
    categorise: {
      run: () => categorise.mutate(),
      pending: categorise.isPending,
      testId: "button-automation-categorise",
    },
    anomalyChecks: {
      run: () => checks.mutate(),
      pending: checks.isPending,
      testId: "button-scan-anomalies",
    },
  };

  if (list.isLoading) {
    return (
      <div className="flex justify-center py-12" aria-busy="true">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-hidden />
      </div>
    );
  }

  const rows = list.data?.automations ?? [];

  return (
    <div className="mx-auto max-w-[760px] space-y-3">
      <p className="text-small text-muted-foreground">{t["assistant.automationsIntro"]}</p>
      {!canManage ? (
        <p className="text-caption text-muted-foreground" data-testid="automations-readonly">
          {t["assistant.automationsReadOnly"]}
        </p>
      ) : null}
      <ul
        className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card"
        data-testid="assistant-automations"
      >
        {rows.map((row) => {
          const title = t[`assistant.automation_${row.key}_title`] ?? row.key;
          const body = t[`assistant.automation_${row.key}_body`];
          const switchId = `automation-switch-${row.key}`;
          const summary = summaryText(row.lastSummary, t);
          const action = runNow[row.key];
          const href = AUTOMATION_LINKS[row.key];
          return (
            <li
              key={row.key}
              className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-start"
              data-testid={`automation-${row.key}`}
              data-enabled={row.enabled ? "true" : "false"}
            >
              <div className="min-w-0 flex-1">
                <label htmlFor={switchId} className="font-medium text-foreground">
                  {title}
                </label>
                {body ? <p className="text-small text-muted-foreground">{body}</p> : null}
                <dl className="mt-2 grid gap-x-6 gap-y-1 text-caption text-muted-foreground sm:grid-cols-2">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <dt>{t["assistant.automationLastRun"]}</dt>
                    <dd className="text-foreground" data-testid={`automation-last-run-${row.key}`}>
                      {row.lastRunAt
                        ? formatDateTime(row.lastRunAt, locale)
                        : t["assistant.notRunYet"]}
                    </dd>
                    {row.lastStatus ? (
                      <Badge
                        dot
                        variant={row.lastStatus === "ok" ? "success" : "danger"}
                        data-testid={`automation-last-status-${row.key}`}
                      >
                        {t[`assistant.automationStatus_${row.lastStatus}`]}
                      </Badge>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <dt>{t["assistant.automationNextRun"]}</dt>
                    <dd className="text-foreground" data-testid={`automation-next-run-${row.key}`}>
                      {!row.enabled
                        ? t["assistant.automationPaused"]
                        : row.nextRunAt
                          ? formatDateTime(row.nextRunAt, locale)
                          : t["assistant.automationNotScheduled"]}
                    </dd>
                  </div>
                  {summary ? (
                    <div className="sm:col-span-2">
                      <dt className="sr-only">{t["assistant.automationLastResult"]}</dt>
                      <dd>{summary}</dd>
                    </div>
                  ) : null}
                  {row.lastStatus === "failed" && row.lastError ? (
                    <div className="sm:col-span-2">
                      <dt className="sr-only">{t["assistant.automationLastResult"]}</dt>
                      <dd className="text-danger">{t["assistant.automationFailedHint"]}</dd>
                    </div>
                  ) : null}
                </dl>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                {action ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={action.run}
                    disabled={action.pending || !companyId}
                    data-testid={action.testId}
                  >
                    {action.pending && <Loader2 className="me-2 h-4 w-4 animate-spin" />}
                    {t["assistant.runNow"]}
                  </Button>
                ) : href ? (
                  <Button variant="ghost" size="sm" asChild>
                    <Link href={href}>{t["assistant.open"]}</Link>
                  </Button>
                ) : null}
                <Switch
                  id={switchId}
                  checked={row.enabled}
                  disabled={!canManage || toggle.isPending}
                  onCheckedChange={(enabled) => toggle.mutate({ key: row.key, enabled })}
                  data-testid={`switch-automation-${row.key}`}
                />
              </div>
            </li>
          );
        })}
      </ul>
      <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
        <li
          className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center"
          data-testid="automation-matches"
        >
          <div className="min-w-0 flex-1">
            <p className="font-medium text-foreground">{t["assistant.autoMatchesTitle"]}</p>
            <p className="text-small text-muted-foreground">{t["assistant.autoMatchesBody"]}</p>
            <p className="mt-1 text-caption text-muted-foreground">
              {t["assistant.inReconciliation"]}
            </p>
          </div>
          <Button variant="outline" size="sm" asChild>
            <Link href="/bank-reconciliation" data-testid="button-bank-reconciliation">
              {t["assistant.open"]}
            </Link>
          </Button>
        </li>
        <li
          className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center"
          data-testid="automation-receipts"
        >
          <div className="min-w-0 flex-1">
            <p className="font-medium text-foreground">{t["assistant.autoReceiptsTitle"]}</p>
            <p className="text-small text-muted-foreground">{t["assistant.autoReceiptsBody"]}</p>
            <p className="mt-1 text-caption text-muted-foreground">{t["assistant.whenUploaded"]}</p>
          </div>
          <Button variant="outline" size="sm" asChild>
            <Link href="/receipts">{t["assistant.open"]}</Link>
          </Button>
        </li>
      </ul>
    </div>
  );
}
