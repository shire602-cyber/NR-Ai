import { useState, useEffect } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useDefaultCompany } from '@/hooks/useDefaultCompany';
import { useToast } from '@/hooks/use-toast';
import { apiRequest, queryClient } from '@/lib/queryClient';
import { formatCurrency, formatDate } from '@/lib/format';
import { 
  Sparkles, AlertTriangle, TrendingUp, TrendingDown, 
  Check, X, FileWarning, DollarSign, RefreshCw, 
  Brain, Zap, ShieldAlert, LineChart, Upload,
  Clock, ChevronRight, CheckCircle2, AlertCircle,
  ArrowUpRight, ArrowDownRight, Target, Lightbulb
} from 'lucide-react';
import { 
  ResponsiveContainer, LineChart as RechartsLineChart, Line, 
  XAxis, YAxis, Tooltip, Legend, AreaChart, Area, BarChart, Bar
} from 'recharts';

type AnomalyAlert = {
  id: string;
  type: string;
  severity: string;
  title: string;
  description: string;
  relatedEntityType?: string;
  relatedEntityId?: string;
  aiConfidence?: number;
  isResolved: boolean;
  createdAt: string;
};

type CashFlowForecast = {
  id: string;
  forecastDate: string;
  forecastType: string;
  predictedInflow: number;
  predictedOutflow: number;
  predictedBalance: number;
  confidenceLevel?: number;
};

export default function AIFeatures() {
  const { companyId } = useDefaultCompany();
  const { toast } = useToast();
  const [mounted, setMounted] = useState(false);
  const [activeTab, setActiveTab] = useState('overview');
  const [resolveDialogOpen, setResolveDialogOpen] = useState(false);
  const [selectedAlert, setSelectedAlert] = useState<AnomalyAlert | null>(null);
  const [resolutionNote, setResolutionNote] = useState('');
  const [categorizationOpen, setCategorizationOpen] = useState(false);
  const [reconciliationOpen, setReconciliationOpen] = useState(false);
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  const { data: anomalyAlerts, isLoading: alertsLoading, refetch: refetchAlerts } = useQuery<AnomalyAlert[]>({
    queryKey: ['/api/companies', companyId, 'anomaly-alerts'],
    enabled: !!companyId,
  });

  const { data: forecasts, isLoading: forecastsLoading } = useQuery<CashFlowForecast[]>({
    queryKey: ['/api/companies', companyId, 'forecasts'],
    enabled: !!companyId,
  });

  const detectAnomaliesMutation = useMutation({
    mutationFn: async () => {
      return apiRequest('POST', '/api/ai/detect-anomalies', { companyId });
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ['/api/companies', companyId, 'anomaly-alerts'] });
      toast({
        title: 'Scan Complete',
        description: `Found ${data?.summary?.totalAnomalies || 0} potential issues`,
      });
    },
    onError: (error: any) => {
      toast({
        title: 'Error',
        description: error.message || 'Failed to scan for anomalies',
        variant: 'destructive',
      });
    },
  });

  const generateForecastMutation = useMutation({
    mutationFn: async () => {
      return apiRequest('POST', '/api/ai/forecast-cashflow', { companyId, forecastMonths: 3 });
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ['/api/companies', companyId, 'forecasts'] });
      toast({
        title: 'Forecast Generated',
        description: 'Cash flow predictions have been updated',
      });
    },
    onError: (error: any) => {
      toast({
        title: 'Error',
        description: error.message || 'Failed to generate forecast',
        variant: 'destructive',
      });
    },
  });

  const resolveAlertMutation = useMutation({
    mutationFn: async ({ alertId, note }: { alertId: string; note?: string }) => {
      return apiRequest('POST', `/api/anomaly-alerts/${alertId}/resolve`, { note });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/companies', companyId, 'anomaly-alerts'] });
      setResolveDialogOpen(false);
      setSelectedAlert(null);
      setResolutionNote('');
      toast({
        title: 'Alert Resolved',
        description: 'The anomaly has been marked as resolved',
      });
    },
    onError: (error: any) => {
      toast({
        title: 'Error',
        description: error.message || 'Failed to resolve alert',
        variant: 'destructive',
      });
    },
  });

  const unresolvedAlerts = anomalyAlerts?.filter(a => !a.isResolved) || [];
  const criticalAlerts = unresolvedAlerts.filter(a => a.severity === 'critical' || a.severity === 'high');
  const forecastData = forecasts?.map(f => ({
    month: formatDate(f.forecastDate, 'MMM'),
    inflow: f.predictedInflow,
    outflow: f.predictedOutflow,
    balance: f.predictedBalance,
    confidence: (f.confidenceLevel || 0) * 100,
  })) || [];

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'critical': return 'bg-red-500';
      case 'high': return 'bg-orange-500';
      case 'medium': return 'bg-yellow-500';
      default: return 'bg-blue-500';
    }
  };

  const getTypeIcon = (type: string) => {
    switch (type) {
      case 'duplicate': return FileWarning;
      case 'unusual_amount': return DollarSign;
      case 'timing': return Clock;
      case 'potential_fraud': return ShieldAlert;
      default: return AlertTriangle;
    }
  };

  const FeatureCard = ({ icon: Icon, title, description, onClick, loading, buttonText, color }: any) => (
    <Card className="hover-elevate active-elevate-2 transition-all duration-300">
      <CardHeader className="flex flex-row items-center gap-4">
        <div className={`w-12 h-12 rounded-lg ${color} bg-opacity-15 dark:bg-opacity-25 flex items-center justify-center`}>
          <Icon className={`w-6 h-6 ${color.replace('bg-', 'text-')}`} />
        </div>
        <div className="flex-1">
          <CardTitle className="text-lg">{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        <Button 
          onClick={onClick} 
          disabled={loading}
          className="w-full"
          data-testid={`button-${title.toLowerCase().replace(/\s+/g, '-')}`}
        >
          {loading ? (
            <>
              <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
              Processing...
            </>
          ) : (
            <>
              <Sparkles className="w-4 h-4 mr-2" />
              {buttonText}
            </>
          )}
        </Button>
      </CardContent>
    </Card>
  );

  return (
    <div className="space-y-8">
      <div className={`${mounted ? 'animate-in fade-in slide-in-from-top-4' : ''}`} style={{ animationDuration: '500ms' }}>
        <div className="relative overflow-hidden rounded-2xl p-8 mb-8 bg-gradient-to-br from-primary/10 via-transparent to-accent/5 dark:from-primary/5 dark:via-transparent dark:to-accent/10 border border-primary/10 dark:border-primary/5">
          <div className="relative z-10">
            <div className="flex items-start justify-between flex-wrap gap-6">
              <div className="max-w-2xl">
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center">
                    <Brain className="w-6 h-6 text-primary" />
                  </div>
                  <Badge variant="secondary" className="text-xs font-medium">
                    <Zap className="w-3 h-3 mr-1" />
                    AI-Powered
                  </Badge>
                </div>
                <h1 className="text-3xl font-bold mb-2" data-testid="text-ai-features-title">
                  AI Financial Automation
                </h1>
                <p className="text-muted-foreground">
                  Leverage advanced AI to automate transaction categorization, detect anomalies, 
                  reconcile bank statements, and forecast cash flow.
                </p>
              </div>
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <Badge variant={unresolvedAlerts.length > 0 ? 'destructive' : 'secondary'}>
                    {unresolvedAlerts.length} Active Alerts
                  </Badge>
                  {criticalAlerts.length > 0 && (
                    <Badge variant="destructive">
                      {criticalAlerts.length} Critical
                    </Badge>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
        <TabsList className="grid w-full grid-cols-4 lg:w-auto lg:inline-grid">
          <TabsTrigger value="overview" data-testid="tab-overview">
            <Target className="w-4 h-4 mr-2" />
            Overview
          </TabsTrigger>
          <TabsTrigger value="anomalies" data-testid="tab-anomalies">
            <ShieldAlert className="w-4 h-4 mr-2" />
            Anomalies
          </TabsTrigger>
          <TabsTrigger value="forecast" data-testid="tab-forecast">
            <LineChart className="w-4 h-4 mr-2" />
            Forecast
          </TabsTrigger>
          <TabsTrigger value="automation" data-testid="tab-automation">
            <Zap className="w-4 h-4 mr-2" />
            Automation
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-6">
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
            <Card className={`${mounted ? 'animate-in fade-in slide-in-from-bottom-4' : ''}`} style={{ animationDuration: '400ms' }}>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Active Alerts</CardTitle>
                <AlertTriangle className={`w-5 h-5 ${unresolvedAlerts.length > 0 ? 'text-orange-500' : 'text-muted-foreground'}`} />
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold" data-testid="text-active-alerts">{unresolvedAlerts.length}</div>
                <p className="text-xs text-muted-foreground mt-1">
                  {criticalAlerts.length > 0 ? `${criticalAlerts.length} require attention` : 'No critical issues'}
                </p>
              </CardContent>
            </Card>

            <Card className={`${mounted ? 'animate-in fade-in slide-in-from-bottom-4' : ''}`} style={{ animationDuration: '500ms' }}>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Resolved Today</CardTitle>
                <CheckCircle2 className="w-5 h-5 text-green-500" />
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold" data-testid="text-resolved-today">
                  {anomalyAlerts?.filter(a => a.isResolved).length || 0}
                </div>
                <p className="text-xs text-muted-foreground mt-1">Issues addressed</p>
              </CardContent>
            </Card>

            <Card className={`${mounted ? 'animate-in fade-in slide-in-from-bottom-4' : ''}`} style={{ animationDuration: '600ms' }}>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Forecast Months</CardTitle>
                <LineChart className="w-5 h-5 text-primary" />
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold" data-testid="text-forecast-months">{forecasts?.length || 0}</div>
                <p className="text-xs text-muted-foreground mt-1">Predicted ahead</p>
              </CardContent>
            </Card>

            <Card className={`${mounted ? 'animate-in fade-in slide-in-from-bottom-4' : ''}`} style={{ animationDuration: '700ms' }}>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">AI Confidence</CardTitle>
                <Brain className="w-5 h-5 text-purple-500" />
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold" data-testid="text-ai-confidence">
                  {forecastData.length > 0 ? Math.round(forecastData.reduce((a, b) => a + b.confidence, 0) / forecastData.length) : 0}%
                </div>
                <p className="text-xs text-muted-foreground mt-1">Average prediction accuracy</p>
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-6 md:grid-cols-2">
            <FeatureCard
              icon={ShieldAlert}
              title="Anomaly Detection"
              description="Scan transactions for duplicates, unusual amounts, and potential fraud"
              onClick={() => detectAnomaliesMutation.mutate()}
              loading={detectAnomaliesMutation.isPending}
              buttonText="Scan for Anomalies"
              color="bg-orange-500"
            />
            <FeatureCard
              icon={LineChart}
              title="Cash Flow Forecast"
              description="Generate AI predictions for the next 3 months based on historical data"
              onClick={() => generateForecastMutation.mutate()}
              loading={generateForecastMutation.isPending}
              buttonText="Generate Forecast"
              color="bg-blue-500"
            />
          </div>

          {forecastData.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Cash Flow Prediction</CardTitle>
                <CardDescription>Projected inflows and outflows for the next 3 months</CardDescription>
              </CardHeader>
              <CardContent className="h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={forecastData}>
                    <defs>
                      <linearGradient id="inflowGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="hsl(142, 76%, 36%)" stopOpacity={0.3}/>
                        <stop offset="95%" stopColor="hsl(142, 76%, 36%)" stopOpacity={0}/>
                      </linearGradient>
                      <linearGradient id="outflowGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="hsl(0, 84%, 60%)" stopOpacity={0.3}/>
                        <stop offset="95%" stopColor="hsl(0, 84%, 60%)" stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <XAxis dataKey="month" />
                    <YAxis />
                    <Tooltip formatter={(value) => formatCurrency(Number(value))} />
                    <Legend />
                    <Area type="monotone" dataKey="inflow" stroke="hsl(142, 76%, 36%)" fill="url(#inflowGradient)" name="Inflow" />
                    <Area type="monotone" dataKey="outflow" stroke="hsl(0, 84%, 60%)" fill="url(#outflowGradient)" name="Outflow" />
                  </AreaChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="anomalies" className="space-y-6">
          <div className="flex justify-between items-center">
            <div>
              <h2 className="text-xl font-semibold">Anomaly Alerts</h2>
              <p className="text-muted-foreground">AI-detected issues requiring review</p>
            </div>
            <Button 
              onClick={() => detectAnomaliesMutation.mutate()}
              disabled={detectAnomaliesMutation.isPending}
              data-testid="button-scan-anomalies"
            >
              {detectAnomaliesMutation.isPending ? (
                <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Sparkles className="w-4 h-4 mr-2" />
              )}
              Scan Now
            </Button>
          </div>

          {alertsLoading ? (
            <div className="space-y-4">
              {[1, 2, 3].map((i) => (
                <Card key={i}>
                  <CardContent className="p-6">
                    <Skeleton className="h-20" />
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : unresolvedAlerts.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12 text-center">
                <CheckCircle2 className="w-12 h-12 text-green-500 mb-4" />
                <h3 className="text-lg font-semibold">All Clear</h3>
                <p className="text-muted-foreground">No anomalies detected in your transactions</p>
                <Button 
                  variant="outline" 
                  className="mt-4"
                  onClick={() => detectAnomaliesMutation.mutate()}
                  disabled={detectAnomaliesMutation.isPending}
                  data-testid="button-run-scan"
                >
                  Run New Scan
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-4">
              {unresolvedAlerts.map((alert) => {
                const TypeIcon = getTypeIcon(alert.type);
                return (
                  <Card key={alert.id} className="hover-elevate">
                    <CardContent className="p-6">
                      <div className="flex items-start gap-4">
                        <div className={`w-10 h-10 rounded-lg ${getSeverityColor(alert.severity)} bg-opacity-15 flex items-center justify-center flex-shrink-0`}>
                          <TypeIcon className={`w-5 h-5 ${getSeverityColor(alert.severity).replace('bg-', 'text-')}`} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <h3 className="font-semibold truncate">{alert.title}</h3>
                            <Badge variant={alert.severity === 'critical' ? 'destructive' : alert.severity === 'high' ? 'destructive' : 'secondary'}>
                              {alert.severity}
                            </Badge>
                          </div>
                          <p className="text-sm text-muted-foreground mb-3">{alert.description}</p>
                          <div className="flex items-center gap-4 text-xs text-muted-foreground">
                            <span className="flex items-center gap-1">
                              <Clock className="w-3 h-3" />
                              {formatDate(alert.createdAt)}
                            </span>
                            {alert.aiConfidence && (
                              <span className="flex items-center gap-1">
                                <Brain className="w-3 h-3" />
                                {Math.round(alert.aiConfidence * 100)}% confidence
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              setSelectedAlert(alert);
                              setResolveDialogOpen(true);
                            }}
                            data-testid={`button-resolve-${alert.id}`}
                          >
                            <Check className="w-4 h-4 mr-1" />
                            Resolve
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>

        <TabsContent value="forecast" className="space-y-6">
          <div className="flex justify-between items-center">
            <div>
              <h2 className="text-xl font-semibold">Cash Flow Forecast</h2>
              <p className="text-muted-foreground">AI-powered predictions based on your financial history</p>
            </div>
            <Button 
              onClick={() => generateForecastMutation.mutate()}
              disabled={generateForecastMutation.isPending}
              data-testid="button-generate-forecast"
            >
              {generateForecastMutation.isPending ? (
                <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Sparkles className="w-4 h-4 mr-2" />
              )}
              Generate Forecast
            </Button>
          </div>

          {forecastsLoading ? (
            <div className="grid gap-6 md:grid-cols-3">
              {[1, 2, 3].map((i) => (
                <Card key={i}>
                  <CardContent className="p-6">
                    <Skeleton className="h-32" />
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : forecasts && forecasts.length > 0 ? (
            <>
              <div className="grid gap-6 md:grid-cols-3">
                {forecasts.map((forecast, index) => (
                  <Card key={forecast.id} className="hover-elevate">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-lg flex items-center gap-2">
                        {formatDate(forecast.forecastDate, 'MMMM yyyy')}
                        {forecast.confidenceLevel && (
                          <Badge variant="outline" className="text-xs">
                            {Math.round(forecast.confidenceLevel * 100)}% conf
                          </Badge>
                        )}
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="flex justify-between items-center">
                        <span className="text-sm text-muted-foreground flex items-center gap-1">
                          <ArrowUpRight className="w-4 h-4 text-green-500" />
                          Predicted Inflow
                        </span>
                        <span className="font-semibold text-green-600 dark:text-green-400">
                          {formatCurrency(forecast.predictedInflow)}
                        </span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-sm text-muted-foreground flex items-center gap-1">
                          <ArrowDownRight className="w-4 h-4 text-red-500" />
                          Predicted Outflow
                        </span>
                        <span className="font-semibold text-red-600 dark:text-red-400">
                          {formatCurrency(forecast.predictedOutflow)}
                        </span>
                      </div>
                      <div className="border-t pt-4">
                        <div className="flex justify-between items-center">
                          <span className="text-sm font-medium">Net Balance</span>
                          <span className={`text-lg font-bold ${forecast.predictedBalance >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                            {formatCurrency(forecast.predictedBalance)}
                          </span>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>

              <Card>
                <CardHeader>
                  <CardTitle>Trend Visualization</CardTitle>
                </CardHeader>
                <CardContent className="h-80">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={forecastData}>
                      <XAxis dataKey="month" />
                      <YAxis />
                      <Tooltip formatter={(value) => formatCurrency(Number(value))} />
                      <Legend />
                      <Bar dataKey="inflow" fill="hsl(142, 76%, 36%)" name="Inflow" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="outflow" fill="hsl(0, 84%, 60%)" name="Outflow" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            </>
          ) : (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12 text-center">
                <LineChart className="w-12 h-12 text-muted-foreground mb-4" />
                <h3 className="text-lg font-semibold">No Forecasts Yet</h3>
                <p className="text-muted-foreground mb-4">Generate AI-powered cash flow predictions</p>
                <Button 
                  onClick={() => generateForecastMutation.mutate()}
                  disabled={generateForecastMutation.isPending}
                  data-testid="button-first-forecast"
                >
                  <Sparkles className="w-4 h-4 mr-2" />
                  Generate First Forecast
                </Button>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="automation" className="space-y-6">
          <div>
            <h2 className="text-xl font-semibold mb-2">AI Automation Tools</h2>
            <p className="text-muted-foreground mb-6">
              Streamline your bookkeeping with intelligent automation
            </p>
          </div>

          <div className="grid gap-6 md:grid-cols-2">
            <Card className="hover-elevate">
              <CardHeader>
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-lg bg-purple-500 bg-opacity-15 dark:bg-opacity-25 flex items-center justify-center">
                    <Brain className="w-6 h-6 text-purple-500" />
                  </div>
                  <div>
                    <CardTitle>Smart Categorization</CardTitle>
                    <CardDescription>Auto-categorize transactions using AI</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2 text-sm text-muted-foreground mb-4">
                  <li className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-green-500" />
                    UAE-specific vendor recognition
                  </li>
                  <li className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-green-500" />
                    Learns from your corrections
                  </li>
                  <li className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-green-500" />
                    Batch processing support
                  </li>
                </ul>
                <Button 
                  variant="outline" 
                  className="w-full" 
                  onClick={() => setCategorizationOpen(true)}
                  data-testid="button-smart-categorization"
                >
                  <Zap className="w-4 h-4 mr-2" />
                  Configure
                </Button>
              </CardContent>
            </Card>

            <Card className="hover-elevate">
              <CardHeader>
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-lg bg-blue-500 bg-opacity-15 dark:bg-opacity-25 flex items-center justify-center">
                    <RefreshCw className="w-6 h-6 text-blue-500" />
                  </div>
                  <div>
                    <CardTitle>Bank Reconciliation</CardTitle>
                    <CardDescription>AI-assisted matching of bank transactions</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2 text-sm text-muted-foreground mb-4">
                  <li className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-green-500" />
                    Import bank statements (CSV)
                  </li>
                  <li className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-green-500" />
                    Smart matching suggestions
                  </li>
                  <li className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-green-500" />
                    One-click reconciliation
                  </li>
                </ul>
                <Button 
                  variant="outline" 
                  className="w-full" 
                  onClick={() => setReconciliationOpen(true)}
                  data-testid="button-bank-reconciliation"
                >
                  <Upload className="w-4 h-4 mr-2" />
                  Import Statement
                </Button>
              </CardContent>
            </Card>

            <Card className="hover-elevate">
              <CardHeader>
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-lg bg-green-500 bg-opacity-15 dark:bg-opacity-25 flex items-center justify-center">
                    <Lightbulb className="w-6 h-6 text-green-500" />
                  </div>
                  <div>
                    <CardTitle>Financial Insights</CardTitle>
                    <CardDescription>Get AI-powered business recommendations</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2 text-sm text-muted-foreground mb-4">
                  <li className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-green-500" />
                    Cost optimization tips
                  </li>
                  <li className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-green-500" />
                    Cash flow warnings
                  </li>
                  <li className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-green-500" />
                    UAE tax compliance alerts
                  </li>
                </ul>
                <Button variant="outline" className="w-full" asChild>
                  <a href="/ai-cfo" data-testid="link-ai-cfo">
                    <Sparkles className="w-4 h-4 mr-2" />
                    Ask AI CFO
                  </a>
                </Button>
              </CardContent>
            </Card>

            <Card className="hover-elevate">
              <CardHeader>
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-lg bg-orange-500 bg-opacity-15 dark:bg-opacity-25 flex items-center justify-center">
                    <ShieldAlert className="w-6 h-6 text-orange-500" />
                  </div>
                  <div>
                    <CardTitle>Fraud Protection</CardTitle>
                    <CardDescription>Continuous monitoring for suspicious activity</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2 text-sm text-muted-foreground mb-4">
                  <li className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-green-500" />
                    Duplicate detection
                  </li>
                  <li className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-green-500" />
                    Unusual pattern alerts
                  </li>
                  <li className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-green-500" />
                    Real-time notifications
                  </li>
                </ul>
                <Button 
                  variant="outline" 
                  className="w-full"
                  onClick={() => setActiveTab('anomalies')}
                  data-testid="button-view-alerts"
                >
                  <AlertCircle className="w-4 h-4 mr-2" />
                  View Alerts ({unresolvedAlerts.length})
                </Button>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>

      <Dialog open={resolveDialogOpen} onOpenChange={setResolveDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Resolve Alert</DialogTitle>
            <DialogDescription>
              Mark this anomaly as reviewed and resolved
            </DialogDescription>
          </DialogHeader>
          {selectedAlert && (
            <div className="space-y-4">
              <Alert>
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>
                  <strong>{selectedAlert.title}</strong>
                  <br />
                  {selectedAlert.description}
                </AlertDescription>
              </Alert>
              <div className="space-y-2">
                <Label htmlFor="resolution-note">Resolution Note (Optional)</Label>
                <Textarea
                  id="resolution-note"
                  placeholder="Add a note about how this was resolved..."
                  value={resolutionNote}
                  onChange={(e) => setResolutionNote(e.target.value)}
                  data-testid="input-resolution-note"
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setResolveDialogOpen(false)}>
              Cancel
            </Button>
            <Button 
              onClick={() => {
                if (selectedAlert) {
                  resolveAlertMutation.mutate({ 
                    alertId: selectedAlert.id, 
                    note: resolutionNote 
                  });
                }
              }}
              disabled={resolveAlertMutation.isPending}
              data-testid="button-confirm-resolve"
            >
              {resolveAlertMutation.isPending ? (
                <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Check className="w-4 h-4 mr-2" />
              )}
              Mark Resolved
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={categorizationOpen} onOpenChange={setCategorizationOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Smart Categorization Settings</DialogTitle>
            <DialogDescription>
              Configure how AI categorizes your transactions
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <Alert>
              <Sparkles className="h-4 w-4" />
              <AlertDescription>
                Smart Categorization is configured to learn from your corrections automatically. 
                Just keep correcting miscategorized transactions and the AI will improve over time.
              </AlertDescription>
            </Alert>
            <div className="space-y-2">
              <Label>Current Settings</Label>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-green-500" />
                  UAE-specific vendor recognition: Enabled
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-green-500" />
                  Learning from corrections: Enabled
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-green-500" />
                  Batch processing: Ready
                </li>
              </ul>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCategorizationOpen(false)}>
              Close
            </Button>
            <Button onClick={() => {
              setCategorizationOpen(false);
              toast({
                title: 'Settings Saved',
                description: 'Smart categorization is active and learning from your corrections',
              });
            }} data-testid="button-save-categorization">
              Got It
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={reconciliationOpen} onOpenChange={setReconciliationOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Import Bank Statement</DialogTitle>
            <DialogDescription>
              Upload a CSV file containing your bank transactions
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <Alert>
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                Bank Reconciliation feature coming soon! Upload CSV files with columns: Date, Description, Amount
              </AlertDescription>
            </Alert>
            <div className="space-y-2">
              <Label htmlFor="csv-file">Select CSV File</Label>
              <Input 
                id="csv-file" 
                type="file" 
                accept=".csv"
                onChange={(e) => setUploadedFile(e.target.files?.[0] || null)}
                data-testid="input-csv-file"
              />
              {uploadedFile && (
                <p className="text-sm text-muted-foreground">
                  Selected: {uploadedFile.name}
                </p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => {
              setReconciliationOpen(false);
              setUploadedFile(null);
            }}>
              Cancel
            </Button>
            <Button 
              onClick={() => {
                setReconciliationOpen(false);
                setUploadedFile(null);
                toast({
                  title: 'Coming Soon',
                  description: 'Bank reconciliation feature will be available soon',
                });
              }}
              disabled={!uploadedFile}
              data-testid="button-upload-csv"
            >
              Upload
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
