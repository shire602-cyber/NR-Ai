import { useMutation, useQuery } from "@tanstack/react-query";
import { Activity, CreditCard, FileText, Loader2, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { T } from "@/components/layout/T";
import { useTranslation } from "@/lib/i18n";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface IntegrationStatus {
  stripe: { configured: boolean };
  openai: { configured: boolean };
  googleSheets: { configured: boolean };
}

interface SheetsTestResult {
  ok: boolean;
  code: "not_configured" | "connected" | "failed";
}

/**
 * Admin > Integrations (STEP1 F6). Secrets live in the server environment, so the cards show
 * whether each integration has credentials (read from the server) and never collect a key.
 * Google Sheets has a real "Test connection" and shows the result, not a fixed "Connected".
 */
export function IntegrationsTab() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const { data: status, isLoading } = useQuery<IntegrationStatus>({
    queryKey: ["/api/admin/integrations/status"],
  });

  const sheetsTest = useMutation({
    mutationFn: (): Promise<SheetsTestResult> =>
      apiRequest("POST", "/api/admin/integrations/google-sheets/test", {}),
    onSuccess: (result) =>
      toast({
        variant: result.ok ? "default" : "destructive",
        title:
          result.code === "connected"
            ? t["admin.integrations.testOk"]
            : result.code === "not_configured"
              ? t["pageLabels.notConfigured"]
              : t["admin.integrations.testFailed"],
      }),
    onError: () => toast({ variant: "destructive", title: t["admin.integrations.testFailed"] }),
  });

  const configuredBadge = (configured: boolean | undefined, testid: string) =>
    isLoading ? (
      <Badge variant="outline" data-testid={testid}>
        …
      </Badge>
    ) : configured ? (
      <Badge variant="outline" className="bg-success-subtle text-success" data-testid={testid}>
        {t["admin.integrations.configured"]}
      </Badge>
    ) : (
      <Badge variant="outline" className="bg-warning-subtle text-warning" data-testid={testid}>
        <T k="pageLabels.notConfigured" />
      </Badge>
    );

  const sheetsBadge = () => {
    if (sheetsTest.data?.code === "connected")
      return (
        <Badge
          variant="outline"
          className="bg-success-subtle text-success"
          data-testid="badge-sheets-status"
        >
          <T k="pages.connected" />
        </Badge>
      );
    if (sheetsTest.data?.code === "failed")
      return (
        <Badge
          variant="outline"
          className="bg-danger-subtle text-danger"
          data-testid="badge-sheets-status"
        >
          {t["admin.integrations.testFailed"]}
        </Badge>
      );
    return configuredBadge(status?.googleSheets.configured, "badge-sheets-status");
  };

  return (
    <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <div className="flex h-8 w-8 items-center justify-center rounded bg-[#6772e5]">
              <CreditCard className="h-4 w-4 text-white" />
            </div>
            <T k="pageLabels.stripeIntegration" />
          </CardTitle>
          <CardDescription>
            <T k="pageLabels.paymentProcessingAndSubscriptionBilling" />
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm">
              <T k="banking.common.status" />
            </span>
            {configuredBadge(status?.stripe.configured, "badge-stripe-status")}
          </div>
          <p className="text-sm text-muted-foreground">{t["admin.integrations.stripeNote"]}</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <div className="flex h-8 w-8 items-center justify-center rounded bg-black">
              <Activity className="h-4 w-4 text-white" />
            </div>
            <T k="pageLabels.openAIIntegration" />
          </CardTitle>
          <CardDescription>
            <T k="pageLabels.aIPoweredFeaturesAndCategorization" />
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm">
              <T k="banking.common.status" />
            </span>
            {configuredBadge(status?.openai.configured, "badge-openai-status")}
          </div>
          <p className="text-sm text-muted-foreground">{t["admin.integrations.openaiNote"]}</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <div className="flex h-8 w-8 items-center justify-center rounded bg-[#34A853]">
              <FileText className="h-4 w-4 text-white" />
            </div>
            <T k="pageLabels.googleSheets" />
          </CardTitle>
          <CardDescription>
            <T k="pageLabels.exportDataToGoogleSheets" />
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm">
              <T k="banking.common.status" />
            </span>
            {sheetsBadge()}
          </div>
          <p className="text-sm text-muted-foreground">{t["admin.integrations.sheetsNote"]}</p>
          <Button
            variant="outline"
            className="w-full"
            disabled={sheetsTest.isPending || !status?.googleSheets.configured}
            onClick={() => sheetsTest.mutate()}
            data-testid="button-test-sheets"
          >
            {sheetsTest.isPending ? (
              <Loader2 className="me-2 h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="me-2 h-4 w-4" />
            )}
            <T k="pageLabels.testConnection" />
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
