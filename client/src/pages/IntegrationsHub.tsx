import { T } from "@/components/layout/T";
import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SectionCard } from "@/components/ui/section-card";
import { StatusBadge } from "@/components/ui/status-badge";
import { StatCard } from "@/components/ui/stat-card";
import { EmptyState } from "@/components/ui/empty-state";
import { useToast } from "@/hooks/use-toast";
import { formatMessage, useTranslation, translateNow } from "@/lib/i18n";
import { formatDate } from "@/lib/format-date";
import { useDefaultCompany } from "@/hooks/useDefaultCompany";
import { Money } from "@/components/ui/money";
import { PageHeader } from "@/components/ui/page-header";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { AlertTriangle, ArrowUpRight, CreditCard, Loader2, RefreshCw } from "lucide-react";
import { SiStripe, SiShopify } from "react-icons/si";
import { Link } from "wouter";
import {
  connectedCount,
  isIntegrationConnected,
  summarizeImportedTransactions,
} from "@/pages/integrations/summary";

interface EcommerceIntegration {
  id: string;
  platform: string;
  isActive: boolean;
  connectionStatus?: "not_connected" | "connected" | "error";
  externalAccountName?: string | null;
  lastSyncAt: string | null;
  syncStatus: string;
  syncError: string | null;
}

interface EcommerceTransaction {
  id: string;
  platform: string;
  externalId: string;
  transactionType: string;
  amount: number;
  currency: string;
  customerName: string | null;
  customerEmail: string | null;
  status: string;
  transactionDate: string;
  isReconciled: boolean;
}

interface IntegrationConfig {
  platform: string;
  apiKey?: string;
  shopDomain?: string;
  accessToken?: string;
}

interface ConnectorStatusRow {
  id: string;
  category?: "accounting" | "pos";
  label: { en: string; ar: string };
  purpose: { en: string; ar: string };
}

// W5-B (R19-03, R19-09, R19-14): only integrations with real adapters can be connected.
// Accounting and POS systems without a live connection are listed under "By import".
// R18-02: description keys live in the pages namespace; names are brands.
const PLATFORMS = [
  {
    id: "stripe_payouts",
    name: "Stripe",
    description: "pages.integrationStripeDescription",
    icon: SiStripe,
  },
  {
    id: "shopify",
    name: "Shopify",
    description: "pages.integrationShopifyDescription",
    icon: SiShopify,
  },
];

/**
 * Settings → Integrations (WP-E, spec 3.15). A plain list of connectors in two groups:
 * "Available" (connect with your own credentials) and "By import". Imported transactions
 * and their counters appear only once a platform is connected, and every counter is
 * computed from rows the server returned — the page never shows a figure it did not load.
 */
export default function IntegrationsHub() {
  const { t, locale } = useTranslation();
  const isRTL = locale === "ar";
  const { toast } = useToast();
  const { companyId } = useDefaultCompany();
  const [connectDialogOpen, setConnectDialogOpen] = useState(false);
  const [selectedPlatform, setSelectedPlatform] = useState<(typeof PLATFORMS)[0] | null>(null);
  const [configForm, setConfigForm] = useState<IntegrationConfig>({ platform: "" });

  const { data: integrationStatus } = useQuery<{ connectors: ConnectorStatusRow[] }>({
    queryKey: ["/api/integrations/status"],
  });

  const { data: integrations, isLoading: integrationsLoading } = useQuery<EcommerceIntegration[]>({
    queryKey: ["/api/integrations/ecommerce", companyId],
    queryFn: () => {
      const params = new URLSearchParams({ companyId: companyId ?? "" });
      return apiRequest("GET", `/api/integrations/ecommerce?${params}`);
    },
    enabled: !!companyId,
  });

  const connected = connectedCount(integrations);

  const { data: transactions, isLoading: transactionsLoading } = useQuery<EcommerceTransaction[]>({
    queryKey: ["/api/integrations/ecommerce/transactions", companyId],
    queryFn: () => {
      const params = new URLSearchParams({ companyId: companyId ?? "" });
      return apiRequest("GET", `/api/integrations/ecommerce/transactions?${params}`);
    },
    enabled: !!companyId && connected > 0,
  });

  const connectMutation = useMutation({
    mutationFn: async (config: IntegrationConfig) => {
      return await apiRequest("POST", "/api/integrations/ecommerce/connect", {
        companyId,
        ...config,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/integrations/ecommerce", companyId] });
      toast({
        title: translateNow("toasts.connected"),
        description: formatMessage(translateNow("toasts.integrationConnected"), {
          name: selectedPlatform?.name ?? "",
        }),
      });
      setConnectDialogOpen(false);
      setConfigForm({ platform: "" });
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: translateNow("toasts.error"),
        description: error?.message || translateNow("toasts.failedToConnectIntegration"),
      });
    },
  });

  const syncMutation = useMutation({
    mutationFn: async (integrationId: string) => {
      return await apiRequest("POST", `/api/integrations/ecommerce/${integrationId}/sync`, {
        companyId,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/integrations/ecommerce", companyId] });
      queryClient.invalidateQueries({
        queryKey: ["/api/integrations/ecommerce/transactions", companyId],
      });
      toast({ title: translateNow("integrations.syncDone") });
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: translateNow("toasts.syncFailed"),
        description: error?.message || translateNow("toasts.failedToSyncData"),
      });
    },
  });

  const getIntegration = (platform: string) => integrations?.find((i) => i.platform === platform);

  const handleConnect = (platform: (typeof PLATFORMS)[0]) => {
    setSelectedPlatform(platform);
    setConfigForm({ platform: platform.id });
    setConnectDialogOpen(true);
  };

  const handleSubmitConnect = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPlatform) return;

    if (selectedPlatform.id === "stripe_payouts" && !configForm.apiKey) {
      toast({
        variant: "destructive",
        title: translateNow("toasts.error"),
        description: translateNow("toasts.pleaseEnterYourStripeSecretKey"),
      });
      return;
    }

    if (selectedPlatform.id === "shopify" && (!configForm.shopDomain || !configForm.accessToken)) {
      toast({
        variant: "destructive",
        title: translateNow("toasts.error"),
        description: translateNow("toasts.pleaseEnterBothShopDomainAndAccess"),
      });
      return;
    }

    connectMutation.mutate(configForm);
  };

  const summary = summarizeImportedTransactions(transactions);
  const transactionRows = transactions ?? [];
  const byImport = integrationStatus?.connectors ?? [];

  const connectorsView = (
    <div className="space-y-6">
      <SectionCard
        title={<T k="integrations.availableTitle" />}
        description={<T k="integrations.availableHelp" />}
        flush
        testId="integrations-available"
      >
        <ul className="divide-y divide-border border-t">
          {PLATFORMS.map((platform) => {
            const integration = getIntegration(platform.id);
            const Icon = platform.icon;
            // W5-B (R19-03): "connected" only after the platform accepted the credentials.
            const isConnected = isIntegrationConnected(integration);
            return (
              <li
                key={platform.id}
                className="flex flex-wrap items-center gap-4 px-5 py-4 md:px-6"
                data-testid={`integration-row-${platform.id}`}
              >
                <div
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-border bg-surface-sunken text-foreground"
                  aria-hidden="true"
                >
                  <Icon className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium text-foreground">{platform.name}</p>
                    {isConnected && (
                      <StatusBadge tone="success">
                        <T k="pages.connected" />
                      </StatusBadge>
                    )}
                  </div>
                  <p className="text-small text-muted-foreground">{t[platform.description]}</p>
                  {isConnected && integration && (
                    <p className="mt-1 text-caption text-muted-foreground">
                      {t["pages.integrationLastSynced"]}{" "}
                      {integration.lastSyncAt
                        ? formatDate(integration.lastSyncAt, locale)
                        : t["pages.integrationNever"]}
                    </p>
                  )}
                  {isConnected && integration?.syncStatus === "failed" && integration.syncError && (
                    <p className="mt-1 flex items-center gap-1.5 text-small text-danger">
                      <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
                      <T k="integrations.lastSyncFailed" />
                    </p>
                  )}
                </div>
                {isConnected ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => syncMutation.mutate(integration!.id)}
                    disabled={syncMutation.isPending}
                    data-testid={`button-sync-${platform.id}`}
                  >
                    {syncMutation.isPending ? (
                      <Loader2 className="me-2 h-4 w-4 animate-spin" />
                    ) : (
                      <RefreshCw className="me-2 h-4 w-4" />
                    )}
                    <T k="integrations.syncNow" />
                  </Button>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleConnect(platform)}
                    data-testid={`button-connect-${platform.id}`}
                  >
                    <T k="integrations.connect" />
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      </SectionCard>

      {byImport.length > 0 && (
        <SectionCard
          title={<T k="integrations.byImportTitle" />}
          description={<T k="integrations.byImportHelp" />}
          flush
          testId="integrations-by-import"
        >
          <ul className="divide-y divide-border border-t">
            {byImport.map((cn) => (
              <li
                key={cn.id}
                className="flex flex-wrap items-center gap-4 px-5 py-4 md:px-6"
                data-testid={`connector-${cn.id}`}
              >
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-foreground">{isRTL ? cn.label.ar : cn.label.en}</p>
                  <p className="text-small text-muted-foreground">
                    {isRTL ? cn.purpose.ar : cn.purpose.en}
                  </p>
                </div>
                <Link
                  href="/import"
                  className="inline-flex items-center gap-1 text-small font-medium text-primary hover:underline"
                >
                  <T k="integrations.importCsv" />
                  <ArrowUpRight className="h-3.5 w-3.5 rtl:-scale-x-100" aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ul>
        </SectionCard>
      )}
    </div>
  );

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Settings"
        testId="text-integrations-title"
        title={<T k="integrations.title" />}
        description={<T k="integrations.description" />}
      />

      {integrationsLoading && !!companyId ? (
        <div className="space-y-3" data-testid="integrations-loading">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
      ) : connected === 0 ? (
        connectorsView
      ) : (
        <Tabs defaultValue="platforms" className="space-y-6">
          <TabsList>
            <TabsTrigger value="platforms" data-testid="tab-platforms">
              <T k="integrations.tabConnectors" />
            </TabsTrigger>
            <TabsTrigger value="transactions" data-testid="tab-transactions">
              <T k="pageLabels.transactions" />
            </TabsTrigger>
          </TabsList>

          <TabsContent value="platforms">{connectorsView}</TabsContent>

          <TabsContent value="transactions" className="space-y-6">
            {summary && (
              <div className="grid gap-4 sm:grid-cols-3" data-testid="integrations-summary">
                <StatCard
                  label={<T k="integrations.importedCount" />}
                  value={summary.total}
                  testId="integrations-summary-total"
                />
                <StatCard
                  label={<T k="pages.reconciled" />}
                  value={summary.reconciled}
                  testId="integrations-summary-reconciled"
                />
                <StatCard
                  label={<T k="pageLabels.pendingReconciliation" />}
                  value={summary.awaitingReconciliation}
                  testId="integrations-summary-pending"
                />
              </div>
            )}

            <SectionCard
              title={<T k="integrations.recentImports" />}
              description={<T k="pageLabels.recentTransactionsImportedFromConnectedPlatforms" />}
              flush
            >
              {transactionsLoading ? (
                <div className="space-y-3 border-t p-5">
                  <Skeleton className="h-11 w-full" />
                  <Skeleton className="h-11 w-full" />
                  <Skeleton className="h-11 w-full" />
                </div>
              ) : transactionRows.length === 0 ? (
                <div className="border-t">
                  <EmptyState
                    icon={CreditCard}
                    title={t["pageLabels.noImportedTransactionsYet"]}
                    description={t["integrations.emptyTransactions"]}
                    compact
                  />
                </div>
              ) : (
                <ul className="divide-y divide-border border-t">
                  {transactionRows.map((txn) => {
                    const platform = PLATFORMS.find((p) => p.id === txn.platform);
                    const isRefund = txn.transactionType === "refund";
                    return (
                      <li
                        key={txn.id}
                        className="flex items-center justify-between gap-4 px-5 py-3 md:px-6"
                      >
                        <div className="min-w-0">
                          <p className="truncate font-medium text-foreground">
                            {txn.customerName || t["integrations.unnamedCustomer"]}
                          </p>
                          <p className="text-small text-muted-foreground">
                            {platform?.name ?? txn.platform} ·{" "}
                            {isRefund ? t["integrations.typeRefund"] : t["integrations.typeSale"]} ·{" "}
                            {formatDate(txn.transactionDate, locale)}
                          </p>
                        </div>
                        <div className="flex shrink-0 flex-col items-end gap-1">
                          <span className="font-medium tabular-nums">
                            <Money
                              amount={isRefund ? -Math.abs(txn.amount) : txn.amount}
                              currency={txn.currency}
                            />
                          </span>
                          {txn.isReconciled ? (
                            <StatusBadge tone="success">
                              <T k="pages.reconciled" />
                            </StatusBadge>
                          ) : (
                            <StatusBadge tone="warning">
                              <T k="pages.pending" />
                            </StatusBadge>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </SectionCard>
          </TabsContent>
        </Tabs>
      )}

      <Dialog open={connectDialogOpen} onOpenChange={setConnectDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {selectedPlatform
                ? formatMessage(t["pages.integrationConnect"], { name: selectedPlatform.name })
                : null}
            </DialogTitle>
            <DialogDescription>
              {formatMessage(t["integrations.connectHelp"], { name: selectedPlatform?.name ?? "" })}
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSubmitConnect}>
            <div className="space-y-4 py-4">
              {selectedPlatform?.id === "stripe_payouts" && (
                <div className="space-y-2">
                  <Label htmlFor="apiKey">
                    <T k="pageLabels.stripeSecretKey" />
                  </Label>
                  <Input
                    id="apiKey"
                    type="password"
                    dir="ltr"
                    placeholder="rk_live_..."
                    value={configForm.apiKey || ""}
                    onChange={(e) => setConfigForm({ ...configForm, apiKey: e.target.value })}
                    data-testid="input-api-key"
                  />
                  <p className="text-small text-muted-foreground">
                    <T k="integrations.stripeKeyHelp" />
                  </p>
                </div>
              )}

              {selectedPlatform?.id === "shopify" && (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="shopDomain">
                      <T k="pageLabels.shopDomain" />
                    </Label>
                    <Input
                      id="shopDomain"
                      dir="ltr"
                      placeholder="mystore.myshopify.com"
                      value={configForm.shopDomain || ""}
                      onChange={(e) => setConfigForm({ ...configForm, shopDomain: e.target.value })}
                      data-testid="input-shop-domain"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="accessToken">
                      <T k="pageLabels.accessToken" />
                    </Label>
                    <Input
                      id="accessToken"
                      type="password"
                      dir="ltr"
                      placeholder="shpat_..."
                      value={configForm.accessToken || ""}
                      onChange={(e) =>
                        setConfigForm({ ...configForm, accessToken: e.target.value })
                      }
                      data-testid="input-access-token"
                    />
                  </div>
                </>
              )}
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setConnectDialogOpen(false)}>
                <T k="pages.cancel" />
              </Button>
              <Button type="submit" disabled={connectMutation.isPending}>
                {connectMutation.isPending && <Loader2 className="me-2 h-4 w-4 animate-spin" />}
                <T k="integrations.connect" />
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
