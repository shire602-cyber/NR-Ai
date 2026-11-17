import { useHasMounted } from "@/hooks/use-has-mounted";
import { T } from "@/components/layout/T";
import { formatMessage, useTranslation, translateNow } from "@/lib/i18n";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useDefaultCompany } from "@/hooks/useDefaultCompany";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  Brain,
  Sparkles,
  Activity,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  ShieldCheck,
} from "lucide-react";

type ClassifierMethod = "rule" | "keyword" | "statistical" | "openai";
type ClassifierMode = "hybrid" | "openai_only";

interface MethodStats {
  method: ClassifierMethod;
  totalPredictions: number;
  accepted: number;
  rejected: number;
  pending: number;
  accuracy: number;
}

interface ModelStats {
  companyId: string;
  totalPredictions: number;
  totalAccepted: number;
  totalRejected: number;
  totalPending: number;
  overallAccuracy: number;
  byMethod: MethodStats[];
  belowThreshold: boolean;
  threshold: number;
  config: {
    mode: ClassifierMode;
    accuracyThreshold: number;
    autopilotEnabled: boolean;
    autopostThreshold?: number;
  };
}

export default function ReceiptAutopilot() {
  const { t } = useTranslation();
  const { companyId, isLoading: companyLoading } = useDefaultCompany();
  const { toast } = useToast();
  const mounted = useHasMounted();

  const statsQuery = useQuery<ModelStats>({
    queryKey: ["/api/ai/classifier-stats", companyId],
    queryFn: () => apiRequest("GET", `/api/ai/classifier-stats?companyId=${companyId}`),
    enabled: !!companyId,
  });

  const updateConfig = useMutation({
    mutationFn: (patch: Partial<ModelStats["config"]>) =>
      apiRequest("PATCH", "/api/ai/classifier-config", { companyId, ...patch }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ai/classifier-stats", companyId] });
      toast({
        title: translateNow("toasts.settingsSaved"),
        description: translateNow("toasts.autopilotConfigurationUpdated"),
      });
    },
    onError: (err: any) => {
      toast({
        title: translateNow("toasts.couldNotSave"),
        description: err?.message || translateNow("toasts.pleaseTryAgain"),
        variant: "destructive",
      });
    },
  });

  const stats = statsQuery.data;
  const config = stats?.config;
  const accuracyPct = stats ? Math.round(stats.overallAccuracy * 100) : 0;
  const thresholdPct = stats ? Math.round(stats.threshold * 100) : 80;

  if (companyLoading || !companyId) {
    return (
      <div className="space-y-4 p-6">
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-8 p-2">
      <div
        className={`${mounted ? "animate-in fade-in slide-in-from-top-4" : ""}`}
        style={{ animationDuration: "500ms" }}
      >
        <div className="relative overflow-hidden rounded-2xl p-8 mb-6 dark:dark:dark:border border-primary/10">
          <div className="flex items-start justify-between flex-wrap gap-6">
            <div className="max-w-2xl">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center">
                  <Brain className="w-6 h-6 text-primary" />
                </div>
                <Badge variant="secondary" className="text-xs font-medium">
                  <Sparkles className="w-3 h-3 mr-1" />
                  <T k="pageLabels.receiptAutopilot" />
                </Badge>
                {stats?.belowThreshold && (
                  <Badge variant="destructive" className="text-xs">
                    <AlertTriangle className="w-3 h-3 mr-1" />
                    <T k="pageLabels.failsafeActive" />
                  </Badge>
                )}
              </div>
              <h1 className="text-3xl font-bold mb-2" data-testid="text-autopilot-title">
                <T k="pageLabels.receiptAutopilot" />
              </h1>
              <p className="text-muted-foreground">
                <T k="pages.receiptAutopilotIntro" />
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* AI Accuracy Card */}
      <Card>
        <CardHeader className="flex flex-row items-center gap-4">
          <div className="w-12 h-12 rounded-lg bg-success/15 flex items-center justify-center">
            <Activity className="w-6 h-6 text-success" />
          </div>
          <div className="flex-1">
            <CardTitle>
              <T k="pageLabels.aiAccuracy" />
            </CardTitle>
            <CardDescription>
              {formatMessage(t["pages.receiptAutopilotAccuracyHint"], { threshold: thresholdPct })}
            </CardDescription>
          </div>
          <div className="text-right">
            <div className="text-3xl font-bold" data-testid="text-overall-accuracy">
              {accuracyPct}%
            </div>
            <div className="text-xs text-muted-foreground">
              {stats
                ? formatMessage(t["pages.receiptAutopilotAcceptedRejected"], {
                    accepted: stats.totalAccepted,
                    rejected: stats.totalRejected,
                  })
                : "—"}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <Progress value={accuracyPct} className="h-2" />
          {statsQuery.isError && (
            <Alert className="mt-4" variant="destructive" data-testid="alert-stats-error">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>{t["pages.autopilotStatsError"]}</AlertDescription>
            </Alert>
          )}
          {stats?.belowThreshold && (
            <Alert className="mt-4" variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                {formatMessage(t["pages.autopilotBelowThreshold"], {
                  accuracy: accuracyPct,
                  threshold: thresholdPct,
                })}
              </AlertDescription>
            </Alert>
          )}

          {statsQuery.isLoading && (
            <div
              className="grid gap-4 md:grid-cols-2 lg:grid-cols-4 mt-6"
              data-testid="stats-skeleton"
            >
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-32 w-full" />
              ))}
            </div>
          )}

          {!statsQuery.isLoading && stats && stats.totalPredictions === 0 && (
            <div
              className="mt-6 text-center text-sm text-muted-foreground py-8 border rounded-lg"
              data-testid="stats-empty"
            >
              <T k="pages.receiptAutopilotEmpty" />
            </div>
          )}

          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4 mt-6">
            {!statsQuery.isLoading &&
              stats &&
              stats.totalPredictions > 0 &&
              stats.byMethod.map((m) => (
                <Card key={m.method} className="border-muted">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-semibold flex items-center gap-2">
                      {t[`pages.autopilotMethod_${m.method}`]}
                      {m.method === "openai" && (
                        <Badge variant="outline" className="text-xs">
                          <T k="pageLabels.fallback" />
                        </Badge>
                      )}
                    </CardTitle>
                    <CardDescription className="text-xs">
                      {t[`pages.autopilotMethodHint_${m.method}`]}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="flex items-baseline gap-2">
                      <span
                        className="text-2xl font-bold"
                        data-testid={`text-method-accuracy-${m.method}`}
                      >
                        {Math.round(m.accuracy * 100)}%
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {formatMessage(t["pages.autopilotJudged"], {
                          count: m.accepted + m.rejected,
                        })}
                      </span>
                    </div>
                    <div className="mt-2 flex items-center gap-3 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <CheckCircle2 className="w-3 h-3 text-success" />
                        {m.accepted}
                      </span>
                      <span className="flex items-center gap-1">
                        <XCircle className="w-3 h-3 text-destructive" />
                        {m.rejected}
                      </span>
                      <span className="flex items-center gap-1 ml-auto">
                        {formatMessage(t["pages.autopilotTotal"], { count: m.totalPredictions })}
                      </span>
                    </div>
                  </CardContent>
                </Card>
              ))}
          </div>
        </CardContent>
      </Card>

      {/* Configuration */}
      {config && (
        <Card>
          <CardHeader className="flex flex-row items-center gap-4">
            <div className="w-12 h-12 rounded-lg bg-info/15 flex items-center justify-center">
              <ShieldCheck className="w-6 h-6 text-info" />
            </div>
            <div className="flex-1">
              <CardTitle>
                <T k="pageLabels.autopilotSettings" />
              </CardTitle>
              <CardDescription>{t["pages.receiptAutopilotHybridHint"]}</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <Label htmlFor="autopilot-toggle" className="text-base font-semibold">
                  <T k="pageLabels.autoPostHighConfidenceReceipts" />
                </Label>
                <p className="text-sm text-muted-foreground mt-1">
                  {t["pages.receiptAutopilotAutopostHint"]}
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

            <div className="flex items-center justify-between gap-6">
              <div>
                <Label htmlFor="autopost-threshold" className="text-base font-semibold">
                  <T k="pageLabels.autoPostConfidenceThreshold" />
                </Label>
                <p className="text-sm text-muted-foreground mt-1">
                  {t["pages.receiptAutopilotThresholdHint"]}
                </p>
              </div>
              <select
                id="autopost-threshold"
                data-testid="select-autopost-threshold"
                className="border rounded-md px-3 py-2 bg-background text-sm"
                value={String(config.autopostThreshold ?? 0.9)}
                onChange={(e) => updateConfig.mutate({ autopostThreshold: Number(e.target.value) })}
                disabled={updateConfig.isPending}
              >
                {[0.8, 0.85, 0.9, 0.95, 0.99].map((v) => (
                  <option key={v} value={String(v)}>
                    {Math.round(v * 100)}%
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-center justify-between">
              <div>
                <Label htmlFor="hybrid-toggle" className="text-base font-semibold">
                  {t["pages.receiptAutopilotHybridLabel"]}
                </Label>
                <p className="text-sm text-muted-foreground mt-1">
                  {t["pages.receiptAutopilotHybridOffHint"]}
                </p>
              </div>
              <Switch
                id="hybrid-toggle"
                data-testid="switch-hybrid-mode"
                checked={config.mode === "hybrid"}
                onCheckedChange={(checked) =>
                  updateConfig.mutate({ mode: checked ? "hybrid" : "openai_only" })
                }
                disabled={updateConfig.isPending}
              />
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
