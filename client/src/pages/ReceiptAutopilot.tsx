import { useMutation, useQuery } from "@tanstack/react-query";
import { Alert } from "@/components/ui/alert";
import { Label } from "@/components/ui/label";
import { SectionCard } from "@/components/ui/section-card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { useDefaultCompany } from "@/hooks/useDefaultCompany";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { formatMessage, translateNow, useTranslation } from "@/lib/i18n";

/**
 * Receipts → Automation (spec 3.8; the former /receipt-autopilot page). One switch, the
 * confidence threshold, a short "How it decides" list, and the acceptance figure once enough
 * receipts have been reviewed to make it meaningful. Settings and their API are unchanged.
 */

type ClassifierMode = "hybrid" | "openai_only";

interface ModelStats {
  totalPredictions: number;
  totalAccepted: number;
  totalRejected: number;
  overallAccuracy: number;
  belowThreshold: boolean;
  threshold: number;
  config: {
    mode: ClassifierMode;
    accuracyThreshold: number;
    autopilotEnabled: boolean;
    autopostThreshold?: number;
  };
}

/** Below this many reviewed receipts an acceptance rate says nothing, so none is shown. */
const MIN_REVIEWED = 20;
const THRESHOLDS = [0.8, 0.85, 0.9, 0.95, 0.99];

export function ReceiptAutomation() {
  const { t } = useTranslation();
  const tt = t as Record<string, string>;
  const { companyId } = useDefaultCompany();
  const { toast } = useToast();
  const key = ["/api/ai/classifier-stats", companyId];

  const statsQuery = useQuery<ModelStats>({
    queryKey: key,
    queryFn: () => apiRequest("GET", `/api/ai/classifier-stats?companyId=${companyId}`),
    enabled: !!companyId,
  });
  const updateConfig = useMutation({
    mutationFn: (patch: Partial<ModelStats["config"]>) =>
      apiRequest("PATCH", "/api/ai/classifier-config", { companyId, ...patch }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: key });
      toast({ title: translateNow("toasts.settingsSaved") });
    },
    onError: (err: Error) =>
      toast({
        title: translateNow("toasts.couldNotSave"),
        description: err?.message || translateNow("toasts.pleaseTryAgain"),
        variant: "destructive",
      }),
  });

  const stats = statsQuery.data;
  const config = stats?.config;
  const reviewed = (stats?.totalAccepted ?? 0) + (stats?.totalRejected ?? 0);

  if (statsQuery.isLoading) return <Skeleton className="h-64" />;
  if (statsQuery.isError || !config) {
    return (
      <Alert tone="warning" data-testid="alert-stats-error">
        {t["pages.autopilotStatsError"]}
      </Alert>
    );
  }

  return (
    <div className="max-w-narrow space-y-6">
      {stats?.belowThreshold && config.autopilotEnabled && (
        <Alert tone="warning" title={tt["purchases.automation.pausedTitle"]}>
          {formatMessage(tt["purchases.automation.pausedBody"], {
            threshold: Math.round(stats.threshold * 100),
          })}
        </Alert>
      )}
      <SectionCard
        title={tt["purchases.automation.title"]}
        description={tt["purchases.automation.description"]}
      >
        <div className="space-y-6">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <Label htmlFor="autopilot-toggle">{tt["purchases.automation.switch"]}</Label>
              <p className="text-small text-muted-foreground">
                {tt["purchases.automation.switchHint"]}
              </p>
            </div>
            <Switch
              id="autopilot-toggle"
              data-testid="switch-autopilot-enabled"
              checked={config.autopilotEnabled}
              onCheckedChange={(checked) => updateConfig.mutate({ autopilotEnabled: checked })}
              disabled={updateConfig.isPending}
            />
          </div>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <Label htmlFor="autopost-threshold">{tt["purchases.automation.threshold"]}</Label>
              <p className="text-small text-muted-foreground">
                {tt["purchases.automation.thresholdHint"]}
              </p>
            </div>
            <Select
              value={String(config.autopostThreshold ?? 0.9)}
              onValueChange={(v) => updateConfig.mutate({ autopostThreshold: Number(v) })}
              disabled={updateConfig.isPending}
            >
              <SelectTrigger
                id="autopost-threshold"
                className="w-28"
                data-testid="select-autopost-threshold"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {THRESHOLDS.map((v) => (
                  <SelectItem key={v} value={String(v)}>
                    <span className="money" dir="ltr">{`${Math.round(v * 100)}%`}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {reviewed >= MIN_REVIEWED && (
            <div
              className="rounded-lg border border-border px-4 py-3"
              data-testid="text-overall-accuracy"
            >
              <div className="text-caption text-muted-foreground">
                {tt["purchases.automation.acceptance"]}
              </div>
              <div className="text-h3 text-foreground">
                <span
                  className="money"
                  dir="ltr"
                >{`${Math.round(stats!.overallAccuracy * 100)}%`}</span>
              </div>
              <div className="text-small text-muted-foreground">
                {formatMessage(tt["purchases.automation.acceptanceHint"], {
                  accepted: stats!.totalAccepted,
                  reviewed,
                })}
              </div>
            </div>
          )}
        </div>
      </SectionCard>
      <SectionCard title={tt["purchases.automation.howTitle"]}>
        <ol className="list-decimal space-y-2 ps-5 text-small text-muted-foreground marker:text-foreground">
          <li>{tt["purchases.automation.how1"]}</li>
          <li>{tt["purchases.automation.how2"]}</li>
          <li>{tt["purchases.automation.how3"]}</li>
          <li>{tt["purchases.automation.how4"]}</li>
        </ol>
      </SectionCard>
    </div>
  );
}
