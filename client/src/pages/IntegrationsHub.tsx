import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useToast } from '@/hooks/use-toast';
import { useTranslation } from '@/lib/i18n';
import { useDefaultCompany } from '@/hooks/useDefaultCompany';
import { formatCurrency } from '@/lib/format';
import { apiRequest, queryClient } from '@/lib/queryClient';
import { 
  Link2, 
  Plug, 
  RefreshCw, 
  Check, 
  X, 
  AlertTriangle,
  ExternalLink,
  Settings,
  ChevronRight,
  Loader2,
  CreditCard,
  ShoppingBag,
  Users,
  Zap,
  Clock,
  ArrowRight,
  Shield,
  Database,
  FileText
} from 'lucide-react';
import { SiStripe, SiShopify, SiSalesforce } from 'react-icons/si';

interface EcommerceIntegration {
  id: string;
  platform: string;
  isActive: boolean;
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

const PLATFORMS = [
  {
    id: 'stripe',
    name: 'Stripe',
    description: 'Accept payments and automatically import transactions',
    icon: SiStripe,
    color: 'text-[#635BFF]',
    bgColor: 'bg-[#635BFF]/10',
    features: ['Payment processing', 'Automatic reconciliation', 'Refund tracking', 'Invoice sync'],
    status: 'available',
  },
  {
    id: 'shopify',
    name: 'Shopify',
    description: 'Sync orders, products, and customer data from your store',
    icon: SiShopify,
    color: 'text-[#95BF47]',
    bgColor: 'bg-[#95BF47]/10',
    features: ['Order import', 'Product catalog sync', 'Customer data', 'Inventory tracking'],
    status: 'available',
  },
  {
    id: 'salesforce',
    name: 'Salesforce',
    description: 'Connect your CRM for customer and sales data synchronization',
    icon: SiSalesforce,
    color: 'text-[#00A1E0]',
    bgColor: 'bg-[#00A1E0]/10',
    features: ['Contact sync', 'Opportunity tracking', 'Invoice generation', 'Sales reports'],
    status: 'coming_soon',
  },
];

export default function IntegrationsHub() {
  const { t, locale } = useTranslation();
  const isRTL = locale === 'ar';
  const { toast } = useToast();
  const { companyId } = useDefaultCompany();
  const [connectDialogOpen, setConnectDialogOpen] = useState(false);
  const [selectedPlatform, setSelectedPlatform] = useState<typeof PLATFORMS[0] | null>(null);
  const [configForm, setConfigForm] = useState<IntegrationConfig>({ platform: '' });

  // Fetch integrations
  const { data: integrations, isLoading: integrationsLoading } = useQuery<EcommerceIntegration[]>({
    queryKey: ['/api/integrations/ecommerce', companyId],
    enabled: !!companyId,
  });

  // Fetch recent transactions
  const { data: transactions, isLoading: transactionsLoading } = useQuery<EcommerceTransaction[]>({
    queryKey: ['/api/integrations/ecommerce/transactions', companyId],
    enabled: !!companyId,
  });

  // Connect integration mutation
  const connectMutation = useMutation({
    mutationFn: async (config: IntegrationConfig) => {
      return await apiRequest('POST', '/api/integrations/ecommerce/connect', {
        companyId,
        ...config,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/integrations/ecommerce', companyId] });
      toast({ title: 'Connected', description: `${selectedPlatform?.name} integration connected successfully` });
      setConnectDialogOpen(false);
      setConfigForm({ platform: '' });
    },
    onError: (error: any) => {
      toast({ variant: 'destructive', title: 'Error', description: error.message || 'Failed to connect integration' });
    },
  });

  // Sync mutation
  const syncMutation = useMutation({
    mutationFn: async (integrationId: string) => {
      return await apiRequest('POST', `/api/integrations/ecommerce/${integrationId}/sync`, {
        companyId,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/integrations/ecommerce', companyId] });
      queryClient.invalidateQueries({ queryKey: ['/api/integrations/ecommerce/transactions', companyId] });
      toast({ title: 'Sync Started', description: 'Data synchronization is in progress' });
    },
    onError: (error: any) => {
      toast({ variant: 'destructive', title: 'Sync Failed', description: error.message || 'Failed to sync data' });
    },
  });

  // Toggle integration mutation
  const toggleMutation = useMutation({
    mutationFn: async ({ integrationId, isActive }: { integrationId: string; isActive: boolean }) => {
      return await apiRequest('PATCH', `/api/integrations/ecommerce/${integrationId}/toggle`, {
        isActive,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/integrations/ecommerce', companyId] });
    },
    onError: (error: any) => {
      toast({ variant: 'destructive', title: 'Error', description: error.message || 'Failed to update integration' });
    },
  });

  const getIntegration = (platform: string) => {
    return integrations?.find(i => i.platform === platform);
  };

  const handleConnect = (platform: typeof PLATFORMS[0]) => {
    setSelectedPlatform(platform);
    setConfigForm({ platform: platform.id });
    setConnectDialogOpen(true);
  };

  const handleSubmitConnect = (e: React.FormEvent) => {
    e.preventDefault();
    connectMutation.mutate(configForm);
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-AE', {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  // Sample transactions for demo
  const sampleTransactions: EcommerceTransaction[] = [
    { id: '1', platform: 'stripe', externalId: 'ch_1234', transactionType: 'payment', amount: 2500, currency: 'AED', customerName: 'Ahmed Hassan', customerEmail: 'ahmed@email.com', status: 'succeeded', transactionDate: '2024-11-28T10:30:00Z', isReconciled: true },
    { id: '2', platform: 'stripe', externalId: 'ch_1235', transactionType: 'payment', amount: 1850, currency: 'AED', customerName: 'Sara Ali', customerEmail: 'sara@email.com', status: 'succeeded', transactionDate: '2024-11-27T14:15:00Z', isReconciled: false },
    { id: '3', platform: 'shopify', externalId: 'ord_5678', transactionType: 'order', amount: 3200, currency: 'AED', customerName: 'Mohammed Khan', customerEmail: 'mkhan@email.com', status: 'succeeded', transactionDate: '2024-11-27T09:45:00Z', isReconciled: true },
    { id: '4', platform: 'stripe', externalId: 'ch_1236', transactionType: 'refund', amount: -450, currency: 'AED', customerName: 'Fatima Omar', customerEmail: 'fatima@email.com', status: 'succeeded', transactionDate: '2024-11-26T16:20:00Z', isReconciled: true },
  ];

  return (
    <div className="space-y-6" dir={isRTL ? 'rtl' : 'ltr'}>
      {/* Header */}
      <div className="relative overflow-hidden rounded-lg bg-gradient-to-br from-purple-600/10 via-pink-600/5 to-transparent border border-purple-600/20 p-8">
        <div className="relative z-10">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-3 rounded-lg bg-purple-600/20">
              <Plug className="w-6 h-6 text-purple-600" />
            </div>
            <div>
              <h1 className="text-3xl font-bold" data-testid="text-integrations-title">CRM & E-Commerce Integrations</h1>
              <p className="text-muted-foreground mt-1">
                Connect your business tools for automatic data synchronization
              </p>
            </div>
          </div>
        </div>
        <div className="absolute top-0 right-0 w-64 h-64 bg-purple-600/5 rounded-full -mr-32 -mt-32 blur-3xl" />
        <div className="absolute bottom-0 left-0 w-48 h-48 bg-pink-600/5 rounded-full -ml-24 -mb-24 blur-3xl" />
      </div>

      <Tabs defaultValue="platforms" className="space-y-6">
        <TabsList className="grid w-full grid-cols-3 lg:w-fit">
          <TabsTrigger value="platforms" className="gap-2" data-testid="tab-platforms">
            <Plug className="w-4 h-4" />
            <span className="hidden sm:inline">Platforms</span>
          </TabsTrigger>
          <TabsTrigger value="transactions" className="gap-2" data-testid="tab-transactions">
            <CreditCard className="w-4 h-4" />
            <span className="hidden sm:inline">Transactions</span>
          </TabsTrigger>
          <TabsTrigger value="settings" className="gap-2" data-testid="tab-settings">
            <Settings className="w-4 h-4" />
            <span className="hidden sm:inline">Settings</span>
          </TabsTrigger>
        </TabsList>

        {/* Platforms Tab */}
        <TabsContent value="platforms" className="space-y-6">
          {/* Quick Stats */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <Card className="hover-elevate">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
                <CardTitle className="text-sm font-medium">Connected</CardTitle>
                <Link2 className="w-4 h-4 text-green-600 dark:text-green-400" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">1</div>
                <p className="text-xs text-muted-foreground mt-1">Active integrations</p>
              </CardContent>
            </Card>

            <Card className="hover-elevate">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
                <CardTitle className="text-sm font-medium">Synced Today</CardTitle>
                <RefreshCw className="w-4 h-4 text-blue-600 dark:text-blue-400" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">24</div>
                <p className="text-xs text-muted-foreground mt-1">Transactions imported</p>
              </CardContent>
            </Card>

            <Card className="hover-elevate">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
                <CardTitle className="text-sm font-medium">Total Value</CardTitle>
                <CreditCard className="w-4 h-4 text-purple-600 dark:text-purple-400" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold font-mono">{formatCurrency(45850, 'AED')}</div>
                <p className="text-xs text-muted-foreground mt-1">This month</p>
              </CardContent>
            </Card>

            <Card className="hover-elevate">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
                <CardTitle className="text-sm font-medium">Reconciled</CardTitle>
                <Check className="w-4 h-4 text-green-600 dark:text-green-400" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">89%</div>
                <p className="text-xs text-muted-foreground mt-1">Auto-matched</p>
              </CardContent>
            </Card>
          </div>

          {/* Platform Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {PLATFORMS.map((platform) => {
              const integration = getIntegration(platform.id);
              const Icon = platform.icon;
              const isConnected = integration?.isActive;
              const isComingSoon = platform.status === 'coming_soon';

              return (
                <Card key={platform.id} className={`hover-elevate relative overflow-hidden ${isComingSoon ? 'opacity-60' : ''}`}>
                  {isComingSoon && (
                    <div className="absolute top-3 right-3">
                      <Badge variant="secondary">Coming Soon</Badge>
                    </div>
                  )}
                  
                  <CardHeader>
                    <div className="flex items-start gap-4">
                      <div className={`p-3 rounded-lg ${platform.bgColor}`}>
                        <Icon className={`w-8 h-8 ${platform.color}`} />
                      </div>
                      <div className="flex-1">
                        <CardTitle className="text-lg flex items-center gap-2">
                          {platform.name}
                          {isConnected && (
                            <Badge variant="secondary" className="bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400">
                              <Check className="w-3 h-3 mr-1" />
                              Connected
                            </Badge>
                          )}
                        </CardTitle>
                        <CardDescription className="mt-1">{platform.description}</CardDescription>
                      </div>
                    </div>
                  </CardHeader>

                  <CardContent>
                    <div className="space-y-3">
                      <p className="text-xs font-medium text-muted-foreground">Features:</p>
                      <div className="flex flex-wrap gap-1">
                        {platform.features.map((feature, idx) => (
                          <Badge key={idx} variant="outline" className="text-xs">
                            {feature}
                          </Badge>
                        ))}
                      </div>

                      {integration && isConnected && (
                        <div className="pt-3 border-t mt-3">
                          <div className="flex items-center justify-between text-sm">
                            <span className="text-muted-foreground">Last synced:</span>
                            <span className="font-medium">
                              {integration.lastSyncAt ? formatDate(integration.lastSyncAt) : 'Never'}
                            </span>
                          </div>
                          {integration.syncStatus === 'failed' && integration.syncError && (
                            <div className="flex items-center gap-2 mt-2 text-sm text-red-600 dark:text-red-400">
                              <AlertTriangle className="w-4 h-4" />
                              {integration.syncError}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </CardContent>

                  <CardFooter className="flex gap-2">
                    {!isComingSoon && (
                      <>
                        {isConnected ? (
                          <>
                            <Button 
                              variant="outline" 
                              size="sm" 
                              className="flex-1"
                              onClick={() => syncMutation.mutate(integration!.id)}
                              disabled={syncMutation.isPending}
                              data-testid={`button-sync-${platform.id}`}
                            >
                              {syncMutation.isPending ? (
                                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                              ) : (
                                <RefreshCw className="w-4 h-4 mr-2" />
                              )}
                              Sync Now
                            </Button>
                            <Button 
                              variant="ghost" 
                              size="icon"
                              data-testid={`button-settings-${platform.id}`}
                            >
                              <Settings className="w-4 h-4" />
                            </Button>
                          </>
                        ) : (
                          <Button 
                            className="w-full gap-2"
                            onClick={() => handleConnect(platform)}
                            data-testid={`button-connect-${platform.id}`}
                          >
                            <Plug className="w-4 h-4" />
                            Connect {platform.name}
                          </Button>
                        )}
                      </>
                    )}
                    {isComingSoon && (
                      <Button variant="outline" className="w-full" disabled>
                        Coming Soon
                      </Button>
                    )}
                  </CardFooter>
                </Card>
              );
            })}
          </div>

          {/* Benefits Section */}
          <Card className="bg-gradient-to-br from-primary/5 to-transparent border-primary/20">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Zap className="w-5 h-5 text-primary" />
                Why Connect Your Platforms?
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="flex gap-3">
                  <div className="p-2 rounded-lg bg-primary/10 h-fit">
                    <Clock className="w-5 h-5 text-primary" />
                  </div>
                  <div>
                    <p className="font-medium">Save Time</p>
                    <p className="text-sm text-muted-foreground">Automatic transaction import eliminates manual data entry</p>
                  </div>
                </div>
                <div className="flex gap-3">
                  <div className="p-2 rounded-lg bg-primary/10 h-fit">
                    <Shield className="w-5 h-5 text-primary" />
                  </div>
                  <div>
                    <p className="font-medium">Reduce Errors</p>
                    <p className="text-sm text-muted-foreground">AI-powered matching ensures accurate reconciliation</p>
                  </div>
                </div>
                <div className="flex gap-3">
                  <div className="p-2 rounded-lg bg-primary/10 h-fit">
                    <Database className="w-5 h-5 text-primary" />
                  </div>
                  <div>
                    <p className="font-medium">Real-time Data</p>
                    <p className="text-sm text-muted-foreground">Always have up-to-date financial information</p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Transactions Tab */}
        <TabsContent value="transactions" className="space-y-6">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              Recent transactions imported from connected platforms
            </p>
            <Button variant="outline" size="sm" data-testid="button-export-transactions">
              <FileText className="w-4 h-4 mr-2" />
              Export
            </Button>
          </div>

          <Card>
            <CardContent className="p-0">
              <ScrollArea className="h-[500px]">
                <div className="divide-y">
                  {sampleTransactions.map((txn) => {
                    const platform = PLATFORMS.find(p => p.id === txn.platform);
                    const Icon = platform?.icon || CreditCard;
                    const isRefund = txn.transactionType === 'refund';

                    return (
                      <div key={txn.id} className="flex items-center justify-between p-4 hover:bg-muted/50 transition-colors">
                        <div className="flex items-center gap-4">
                          <div className={`p-2 rounded-lg ${platform?.bgColor || 'bg-muted'}`}>
                            <Icon className={`w-5 h-5 ${platform?.color || 'text-muted-foreground'}`} />
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <p className="font-medium">{txn.customerName || 'Unknown Customer'}</p>
                              <Badge variant="outline" className="text-xs">
                                {txn.transactionType}
                              </Badge>
                            </div>
                            <p className="text-sm text-muted-foreground">
                              {txn.customerEmail} • {formatDate(txn.transactionDate)}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-4">
                          <div className="text-right">
                            <p className={`font-mono font-bold ${isRefund ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400'}`}>
                              {isRefund ? '' : '+'}{formatCurrency(txn.amount, txn.currency)}
                            </p>
                            <div className="flex items-center gap-1 justify-end">
                              {txn.isReconciled ? (
                                <Badge variant="secondary" className="bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 text-xs">
                                  <Check className="w-3 h-3 mr-1" />
                                  Reconciled
                                </Badge>
                              ) : (
                                <Badge variant="secondary" className="bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 text-xs">
                                  <Clock className="w-3 h-3 mr-1" />
                                  Pending
                                </Badge>
                              )}
                            </div>
                          </div>
                          <Button variant="ghost" size="icon" className="h-8 w-8">
                            <ChevronRight className="w-4 h-4" />
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>

          {/* Summary */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Pending Reconciliation</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-amber-600 dark:text-amber-400">12</div>
                <p className="text-xs text-muted-foreground mt-1">Transactions need review</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Auto-Matched</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-green-600 dark:text-green-400">156</div>
                <p className="text-xs text-muted-foreground mt-1">This month</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Failed Imports</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-red-600 dark:text-red-400">3</div>
                <p className="text-xs text-muted-foreground mt-1">Require attention</p>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Settings Tab */}
        <TabsContent value="settings" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Sync Settings</CardTitle>
              <CardDescription>Configure how data is synchronized from connected platforms</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium">Automatic Sync</p>
                  <p className="text-sm text-muted-foreground">Sync new transactions every hour</p>
                </div>
                <Switch defaultChecked data-testid="switch-auto-sync" />
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium">Auto-Reconciliation</p>
                  <p className="text-sm text-muted-foreground">Automatically match transactions with invoices</p>
                </div>
                <Switch defaultChecked data-testid="switch-auto-reconcile" />
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium">Create Journal Entries</p>
                  <p className="text-sm text-muted-foreground">Automatically create journal entries for matched transactions</p>
                </div>
                <Switch data-testid="switch-auto-journal" />
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium">Import Refunds</p>
                  <p className="text-sm text-muted-foreground">Include refunds in transaction imports</p>
                </div>
                <Switch defaultChecked data-testid="switch-import-refunds" />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Account Mapping</CardTitle>
              <CardDescription>Map platform transactions to your chart of accounts</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-sm text-muted-foreground">Stripe Payments</Label>
                  <p className="font-medium">1000 - Cash</p>
                </div>
                <div>
                  <Label className="text-sm text-muted-foreground">Stripe Fees</Label>
                  <p className="font-medium">5200 - Bank Charges</p>
                </div>
                <div>
                  <Label className="text-sm text-muted-foreground">Shopify Sales</Label>
                  <p className="font-medium">4000 - Sales Revenue</p>
                </div>
                <div>
                  <Label className="text-sm text-muted-foreground">Shopify Fees</Label>
                  <p className="font-medium">5300 - Platform Fees</p>
                </div>
              </div>
              <Button variant="outline" className="w-full" data-testid="button-edit-mapping">
                <Settings className="w-4 h-4 mr-2" />
                Edit Account Mapping
              </Button>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Connect Dialog */}
      <Dialog open={connectDialogOpen} onOpenChange={setConnectDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {selectedPlatform && (
                <>
                  <selectedPlatform.icon className={`w-6 h-6 ${selectedPlatform.color}`} />
                  Connect {selectedPlatform.name}
                </>
              )}
            </DialogTitle>
            <DialogDescription>
              Enter your API credentials to connect {selectedPlatform?.name} with your bookkeeping system.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSubmitConnect}>
            <div className="space-y-4 py-4">
              {selectedPlatform?.id === 'stripe' && (
                <div className="space-y-2">
                  <Label htmlFor="apiKey">Stripe Secret Key</Label>
                  <Input
                    id="apiKey"
                    type="password"
                    placeholder="sk_live_..."
                    value={configForm.apiKey || ''}
                    onChange={(e) => setConfigForm({ ...configForm, apiKey: e.target.value })}
                    data-testid="input-api-key"
                  />
                  <p className="text-xs text-muted-foreground">
                    Find this in your Stripe Dashboard under Developers &gt; API keys
                  </p>
                </div>
              )}

              {selectedPlatform?.id === 'shopify' && (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="shopDomain">Shop Domain</Label>
                    <Input
                      id="shopDomain"
                      placeholder="mystore.myshopify.com"
                      value={configForm.shopDomain || ''}
                      onChange={(e) => setConfigForm({ ...configForm, shopDomain: e.target.value })}
                      data-testid="input-shop-domain"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="accessToken">Access Token</Label>
                    <Input
                      id="accessToken"
                      type="password"
                      placeholder="shpat_..."
                      value={configForm.accessToken || ''}
                      onChange={(e) => setConfigForm({ ...configForm, accessToken: e.target.value })}
                      data-testid="input-access-token"
                    />
                  </div>
                </>
              )}
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setConnectDialogOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={connectMutation.isPending}>
                {connectMutation.isPending ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <Plug className="w-4 h-4 mr-2" />
                )}
                Connect
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
