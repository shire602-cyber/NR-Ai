import { useEffect, useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useDefaultCompany } from '@/hooks/useDefaultCompany';
import { useToast } from '@/hooks/use-toast';
import { apiRequest, queryClient } from '@/lib/queryClient';
import { Brain, Sparkles, Activity, CheckCircle2, XCircle, AlertTriangle, ShieldCheck } from 'lucide-react';

type ClassifierMethod = 'rule' | 'keyword' | 'statistical' | 'openai';
type ClassifierMode = 'hybrid' | 'openai_only';

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
  };
}

const METHOD_LABELS: Record<ClassifierMethod, string> = {
  rule: 'Company Rules',
  keyword: 'UAE Keywords',
  statistical: 'Statistical (Naive Bayes)',
  openai: 'OpenAI Fallback',
};

const METHOD_DESCRIPTIONS: Record<ClassifierMethod, string> = {
  rule: 'Exact + fuzzy merchant patterns from your accepted history.',
  keyword: 'Built-in patterns covering DEWA, Etisalat, Careem, Emirates, …',
  statistical: 'Naive Bayes trained on your accepted classifications.',
  openai: 'Used when internal confidence falls below threshold.',
};

export default function ReceiptAutopilot() {
  const { companyId, isLoading: companyLoading } = useDefaultCompany();
  const { toast } = useToast();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const statsQuery = useQuery<ModelStats>({
    queryKey: ['/api/ai/classifier-stats', companyId],
    queryFn: () => apiRequest('GET', `/api/ai/classifier-stats?companyId=${companyId}`),
    enabled: !!companyId,
  });

  const updateConfig = useMutation({
    mutationFn: (patch: Partial<ModelStats['config']>) =>
      apiRequest('PATCH', '/api/ai/classifier-config', { companyId, ...patch }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/ai/classifier-stats', companyId] });
      toast({ title: 'Settings saved', description: 'Autopilot configuration updated.' });
    },
    onError: (err: any) => {
      toast({ title: 'Could not save', description: err?.message || 'Please try again.', variant: 'destructive' });
    },
  });

  const stats = statsQuery.data;
  const config = stats?.config;
  const accuracyPct = stats ? Math.round(stats.overallAccuracy * 100) : 0;
  const thresholdPct = stats ? Math.round(stats.threshold * 100) : 80;

  if (companyLoading || !companyId) {
    return <div className="space-y-4 p-6"><Skeleton className="h-32 w-full" /></div>;
  }

  return (
    <div className="space-y-8 p-2">
      <div className={`${mounted ? 'animate-in fade-in slide-in-from-top-4' : ''}`} style={{ animationDuration: '500ms' }}>
        <div className="relative overflow-hidden rounded-2xl p-8 mb-6 bg-gradient-to-br from-primary/10 via-transparent to-accent/5 dark:from-primary/5 dark:via-transparent dark:to-accent/10 border border-primary/10">
          <div className="flex items-start justify-between flex-wrap gap-6">
            <div className="max-w-2xl">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center">
                  <Brain className="w-6 h-6 text-primary" />
                </div>
                <Badge variant="secondary" className="text-xs font-medium">
                  <Sparkles className="w-3 h-3 mr-1" />
                  Receipt Autopilot
                </Badge>
                {stats?.belowThreshold && (
                  <Badge variant="destructive" className="text-xs">
                    <AlertTriangle className="w-3 h-3 mr-1" />
                    Failsafe Active
                  </Badge>
                )}
              </div>
              <h1 className="text-3xl font-bold mb-2" data-testid="text-autopilot-title">
                Receipt Autopilot
              </h1>
              <p className="text-muted-foreground">
                Internal classifier with OpenAI fallback. The system learns your accepted classifications and
                automatically posts high-confidence receipts to the GL.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* AI Accuracy Card */}
      <Card>
        <CardHeader className="flex flex-row items-center gap-4">
          <div className="w-12 h-12 rounded-lg bg-emerald-500/15 flex items-center justify-center">
            <Activity className="w-6 h-6 text-emerald-600" />
          </div>
          <div className="flex-1">
            <CardTitle>AI Accuracy</CardTitle>
            <CardDescription>
              Overall acceptance rate across all classifier methods. Threshold: {thresholdPct}%.
            </CardDescription>
          </div>
          <div className="text-right">
            <div className="text-3xl font-bold" data-testid="text-overall-accuracy">{accuracyPct}%</div>
            <div className="text-xs text-muted-foreground">
              {stats ? `${stats.totalAccepted} accepted / ${stats.totalRejected} rejected` : '—'}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <Progress value={accuracyPct} className="h-2" />
          {statsQuery.isError && (
            <Alert className="mt-4" variant="destructive" data-testid="alert-stats-error">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                Could not load classifier stats: {(statsQuery.error as any)?.message || 'Please try again.'}
              </AlertDescription>
            </Alert>
          )}
          {stats?.belowThreshold && (
            <Alert className="mt-4" variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                Internal classifier accuracy ({accuracyPct}%) is below the {thresholdPct}% threshold —
                this company has been automatically switched to OpenAI-only mode.
                Restore hybrid mode below once you have more training data.
              </AlertDescription>
            </Alert>
          )}

          {statsQuery.isLoading && (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4 mt-6" data-testid="stats-skeleton">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-32 w-full" />
              ))}
            </div>
          )}

          {!statsQuery.isLoading && stats && stats.totalPredictions === 0 && (
            <div className="mt-6 text-center text-sm text-muted-foreground py-8 border rounded-lg" data-testid="stats-empty">
              No receipts classified yet. Upload receipts to start training the model.
            </div>
          )}

          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4 mt-6">
            {!statsQuery.isLoading && stats && stats.totalPredictions > 0 && stats.byMethod.map((m) => (
              <Card key={m.method} className="border-muted">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-semibold flex items-center gap-2">
                    {METHOD_LABELS[m.method]}
                    {m.method === 'openai' && <Badge variant="outline" className="text-xs">Fallback</Badge>}
                  </CardTitle>
                  <CardDescription className="text-xs">{METHOD_DESCRIPTIONS[m.method]}</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="flex items-baseline gap-2">
                    <span className="text-2xl font-bold" data-testid={`text-method-accuracy-${m.method}`}>
                      {Math.round(m.accuracy * 100)}%
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {m.accepted + m.rejected} judged
                    </span>
                  </div>
                  <div className="mt-2 flex items-center gap-3 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <CheckCircle2 className="w-3 h-3 text-emerald-500" />
                      {m.accepted}
                    </span>
                    <span className="flex items-center gap-1">
                      <XCircle className="w-3 h-3 text-red-500" />
                      {m.rejected}
                    </span>
                    <span className="flex items-center gap-1 ml-auto">
                      Total {m.totalPredictions}
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
            <div className="w-12 h-12 rounded-lg bg-blue-500/15 flex items-center justify-center">
              <ShieldCheck className="w-6 h-6 text-blue-600" />
            </div>
            <div className="flex-1">
              <CardTitle>Autopilot Settings</CardTitle>
              <CardDescription>
                Hybrid mode runs the internal classifier first; OpenAI is used only as a fallback.
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <Label htmlFor="autopilot-toggle" className="text-base font-semibold">Auto-post high-confidence receipts</Label>
                <p className="text-sm text-muted-foreground mt-1">
                  When enabled, receipts matching a rule with ≥5 acceptances and ≥90% confidence
                  are auto-posted to the GL without user review.
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

            <div className="flex items-center justify-between">
              <div>
                <Label htmlFor="hybrid-toggle" className="text-base font-semibold">Hybrid mode (recommended)</Label>
                <p className="text-sm text-muted-foreground mt-1">
                  Off → bypass the internal classifier and use OpenAI for every receipt.
                </p>
              </div>
              <Switch
                id="hybrid-toggle"
                data-testid="switch-hybrid-mode"
                checked={config.mode === 'hybrid'}
                onCheckedChange={(checked) => updateConfig.mutate({ mode: checked ? 'hybrid' : 'openai_only' })}
                disabled={updateConfig.isPending}
              />
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
