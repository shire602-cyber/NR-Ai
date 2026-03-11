import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { apiRequest, queryClient } from '@/lib/queryClient';
import { TrendingUp, Target, Megaphone, Sparkles, Send, Play, Trash2, Plus, Loader2, Users, DollarSign } from 'lucide-react';

interface Service {
  id: string;
  name: string;
  description: string;
  category: string;
  price: number;
}

interface OpportunityClient {
  companyId: string;
  companyName: string;
  reason: string;
}

interface ServiceOpportunity {
  service: Service;
  clients: OpportunityClient[];
}

interface OpportunitiesData {
  totalOpportunities: number;
  byService: Record<string, ServiceOpportunity>;
}

interface Campaign {
  id: string;
  serviceId: string;
  name: string;
  description: string;
  status: 'draft' | 'messages_generated' | 'executing' | 'completed' | 'failed';
  targetCount: number;
  sentCount: number;
  createdAt: string;
}

function getCampaignStatusBadge(status: string) {
  switch (status) {
    case 'draft':
      return <Badge variant="outline">Draft</Badge>;
    case 'messages_generated':
      return <Badge className="bg-blue-100 text-blue-800 hover:bg-blue-100">Messages Generated</Badge>;
    case 'executing':
      return <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100">Executing</Badge>;
    case 'completed':
      return <Badge className="bg-green-100 text-green-800 hover:bg-green-100">Completed</Badge>;
    case 'failed':
      return <Badge variant="destructive">Failed</Badge>;
    default:
      return <Badge variant="outline">{status}</Badge>;
  }
}

function formatDate(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export default function AdminCrossSell() {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState('opportunities');
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [preselectedServiceId, setPreselectedServiceId] = useState<string | null>(null);
  const [newCampaignName, setNewCampaignName] = useState('');
  const [newCampaignDescription, setNewCampaignDescription] = useState('');
  const [newCampaignServiceId, setNewCampaignServiceId] = useState('');
  const [selectedCompanyIds, setSelectedCompanyIds] = useState<string[]>([]);

  const { data: catalog = [], isLoading: catalogLoading } = useQuery<Service[]>({
    queryKey: ['/api/admin/cross-sell/catalog'],
  });

  const { data: opportunities, isLoading: opportunitiesLoading } = useQuery<OpportunitiesData>({
    queryKey: ['/api/admin/cross-sell/opportunities'],
  });

  const { data: campaigns = [], isLoading: campaignsLoading } = useQuery<Campaign[]>({
    queryKey: ['/api/admin/cross-sell/campaigns'],
  });

  const createCampaignMutation = useMutation({
    mutationFn: (data: { serviceId: string; name: string; description: string; targetCompanyIds: string[] }) =>
      apiRequest('POST', '/api/admin/cross-sell/campaigns', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/cross-sell/campaigns'] });
      toast({ title: 'Campaign Created', description: 'Your cross-sell campaign has been created as a draft.' });
      handleCloseCreateDialog();
    },
    onError: (err: any) => {
      toast({ variant: 'destructive', title: 'Error', description: err.message });
    },
  });

  const generateMessagesMutation = useMutation({
    mutationFn: (campaignId: string) =>
      apiRequest('POST', `/api/admin/cross-sell/campaigns/${campaignId}/generate-messages`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/cross-sell/campaigns'] });
      toast({ title: 'Messages Generated', description: 'AI has generated personalized messages for the campaign.' });
    },
    onError: (err: any) => {
      toast({ variant: 'destructive', title: 'Error', description: err.message });
    },
  });

  const executeCampaignMutation = useMutation({
    mutationFn: (campaignId: string) =>
      apiRequest('POST', `/api/admin/cross-sell/campaigns/${campaignId}/execute`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/cross-sell/campaigns'] });
      toast({ title: 'Campaign Executing', description: 'The campaign is now being sent to targets.' });
    },
    onError: (err: any) => {
      toast({ variant: 'destructive', title: 'Error', description: err.message });
    },
  });

  const deleteCampaignMutation = useMutation({
    mutationFn: (campaignId: string) =>
      apiRequest('DELETE', `/api/admin/cross-sell/campaigns/${campaignId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/cross-sell/campaigns'] });
      toast({ title: 'Campaign Deleted', description: 'The draft campaign has been removed.' });
    },
    onError: (err: any) => {
      toast({ variant: 'destructive', title: 'Error', description: err.message });
    },
  });

  const handleOpenCreateDialog = (serviceId?: string) => {
    if (serviceId) {
      setPreselectedServiceId(serviceId);
      setNewCampaignServiceId(serviceId);
      const serviceOpportunity = opportunities?.byService[serviceId];
      if (serviceOpportunity) {
        setSelectedCompanyIds(serviceOpportunity.clients.map((c) => c.companyId));
      }
    } else {
      setPreselectedServiceId(null);
      setNewCampaignServiceId('');
      setSelectedCompanyIds([]);
    }
    setNewCampaignName('');
    setNewCampaignDescription('');
    setCreateDialogOpen(true);
  };

  const handleCloseCreateDialog = () => {
    setCreateDialogOpen(false);
    setPreselectedServiceId(null);
    setNewCampaignName('');
    setNewCampaignDescription('');
    setNewCampaignServiceId('');
    setSelectedCompanyIds([]);
  };

  const handleServiceChange = (serviceId: string) => {
    setNewCampaignServiceId(serviceId);
    const serviceOpportunity = opportunities?.byService[serviceId];
    if (serviceOpportunity) {
      setSelectedCompanyIds(serviceOpportunity.clients.map((c) => c.companyId));
    } else {
      setSelectedCompanyIds([]);
    }
  };

  const handleToggleCompany = (companyId: string) => {
    setSelectedCompanyIds((prev) =>
      prev.includes(companyId) ? prev.filter((id) => id !== companyId) : [...prev, companyId]
    );
  };

  const handleCreateCampaign = () => {
    if (!newCampaignServiceId || !newCampaignName || selectedCompanyIds.length === 0) {
      toast({ variant: 'destructive', title: 'Validation Error', description: 'Please fill in all fields and select at least one target company.' });
      return;
    }
    createCampaignMutation.mutate({
      serviceId: newCampaignServiceId,
      name: newCampaignName,
      description: newCampaignDescription,
      targetCompanyIds: selectedCompanyIds,
    });
  };

  const getServiceName = (serviceId: string): string => {
    const service = catalog.find((s) => s.id === serviceId);
    return service?.name ?? serviceId;
  };

  const availableClientsForService = newCampaignServiceId
    ? opportunities?.byService[newCampaignServiceId]?.clients ?? []
    : [];

  const isLoading = catalogLoading || opportunitiesLoading || campaignsLoading;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Cross-Selling Campaigns</h1>
          <p className="text-muted-foreground">Identify opportunities and run targeted service campaigns</p>
        </div>
        <Button onClick={() => handleOpenCreateDialog()}>
          <Plus className="w-4 h-4 mr-2" />
          New Campaign
        </Button>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="opportunities">
            <Target className="w-4 h-4 mr-2" />
            Opportunities
          </TabsTrigger>
          <TabsTrigger value="campaigns">
            <Megaphone className="w-4 h-4 mr-2" />
            Campaigns
          </TabsTrigger>
          <TabsTrigger value="catalog">
            <DollarSign className="w-4 h-4 mr-2" />
            Service Catalog
          </TabsTrigger>
        </TabsList>

        <TabsContent value="opportunities" className="space-y-6">
          <div className="grid gap-4 md:grid-cols-3">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
                <CardTitle className="text-sm font-medium">Total Opportunities</CardTitle>
                <TrendingUp className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{opportunities?.totalOpportunities ?? 0}</div>
                <p className="text-xs text-muted-foreground">Potential cross-sell targets identified</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
                <CardTitle className="text-sm font-medium">Services with Leads</CardTitle>
                <Target className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {opportunities?.byService ? Object.keys(opportunities.byService).length : 0}
                </div>
                <p className="text-xs text-muted-foreground">Services with matched clients</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
                <CardTitle className="text-sm font-medium">Active Campaigns</CardTitle>
                <Megaphone className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {campaigns.filter((c) => c.status === 'executing' || c.status === 'messages_generated').length}
                </div>
                <p className="text-xs text-muted-foreground">Campaigns in progress</p>
              </CardContent>
            </Card>
          </div>

          {opportunities?.byService && Object.keys(opportunities.byService).length > 0 ? (
            <div className="space-y-4">
              {Object.entries(opportunities.byService).map(([serviceId, opportunity]) => (
                <Card key={serviceId}>
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <div>
                        <CardTitle className="flex items-center gap-2">
                          <Sparkles className="h-5 w-5 text-amber-500" />
                          {opportunity.service.name}
                        </CardTitle>
                        <CardDescription>
                          {opportunity.clients.length} potential client{opportunity.clients.length !== 1 ? 's' : ''} identified
                        </CardDescription>
                      </div>
                      <Button onClick={() => handleOpenCreateDialog(serviceId)}>
                        <Megaphone className="w-4 h-4 mr-2" />
                        Create Campaign
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Client</TableHead>
                          <TableHead>Reason</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {opportunity.clients.map((client) => (
                          <TableRow key={client.companyId}>
                            <TableCell className="font-medium">
                              <div className="flex items-center gap-2">
                                <Users className="h-4 w-4 text-muted-foreground" />
                                {client.companyName}
                              </div>
                            </TableCell>
                            <TableCell className="text-muted-foreground">{client.reason}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12">
                <Target className="w-12 h-12 text-muted-foreground mb-4 opacity-50" />
                <p className="text-muted-foreground text-lg font-medium">No opportunities found</p>
                <p className="text-muted-foreground text-sm">Cross-sell opportunities will appear here once clients and services are analyzed.</p>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="campaigns" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Megaphone className="h-5 w-5" />
                All Campaigns
              </CardTitle>
              <CardDescription>Manage your cross-selling campaigns</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Campaign Name</TableHead>
                    <TableHead>Service</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Targets</TableHead>
                    <TableHead>Sent</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {campaigns.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                        <Megaphone className="w-12 h-12 mx-auto mb-2 opacity-50" />
                        <p>No campaigns yet</p>
                        <p className="text-sm">Create your first cross-sell campaign to get started.</p>
                      </TableCell>
                    </TableRow>
                  )}
                  {campaigns.map((campaign) => (
                    <TableRow key={campaign.id}>
                      <TableCell className="font-medium">{campaign.name}</TableCell>
                      <TableCell>{getServiceName(campaign.serviceId)}</TableCell>
                      <TableCell>{getCampaignStatusBadge(campaign.status)}</TableCell>
                      <TableCell>{campaign.targetCount}</TableCell>
                      <TableCell>{campaign.sentCount}</TableCell>
                      <TableCell className="text-muted-foreground">{formatDate(campaign.createdAt)}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-2">
                          {campaign.status === 'draft' && (
                            <>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => generateMessagesMutation.mutate(campaign.id)}
                                disabled={generateMessagesMutation.isPending}
                              >
                                {generateMessagesMutation.isPending ? (
                                  <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                                ) : (
                                  <Sparkles className="h-4 w-4 mr-1" />
                                )}
                                Generate Messages
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => deleteCampaignMutation.mutate(campaign.id)}
                                disabled={deleteCampaignMutation.isPending}
                              >
                                <Trash2 className="h-4 w-4 mr-1" />
                                Delete
                              </Button>
                            </>
                          )}
                          {campaign.status === 'messages_generated' && (
                            <>
                              <Button
                                size="sm"
                                onClick={() => executeCampaignMutation.mutate(campaign.id)}
                                disabled={executeCampaignMutation.isPending}
                              >
                                {executeCampaignMutation.isPending ? (
                                  <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                                ) : (
                                  <Send className="h-4 w-4 mr-1" />
                                )}
                                Execute
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => deleteCampaignMutation.mutate(campaign.id)}
                                disabled={deleteCampaignMutation.isPending}
                              >
                                <Trash2 className="h-4 w-4 mr-1" />
                                Delete
                              </Button>
                            </>
                          )}
                          {campaign.status === 'executing' && (
                            <Button variant="outline" size="sm" disabled>
                              <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                              In Progress
                            </Button>
                          )}
                          {campaign.status === 'completed' && (
                            <Badge className="bg-green-100 text-green-800 hover:bg-green-100">
                              Completed
                            </Badge>
                          )}
                          {campaign.status === 'failed' && (
                            <Badge variant="destructive">Failed</Badge>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="catalog" className="space-y-6">
          {catalog.length > 0 ? (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {catalog.map((service) => (
                <Card key={service.id}>
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-lg">{service.name}</CardTitle>
                      <Badge variant="outline">{service.category}</Badge>
                    </div>
                    <CardDescription>{service.description}</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="flex items-center gap-2">
                      <DollarSign className="h-4 w-4 text-muted-foreground" />
                      <span className="text-2xl font-bold">${service.price.toLocaleString()}</span>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12">
                <DollarSign className="w-12 h-12 text-muted-foreground mb-4 opacity-50" />
                <p className="text-muted-foreground text-lg font-medium">No services in catalog</p>
                <p className="text-muted-foreground text-sm">Add services to your catalog to enable cross-selling.</p>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>

      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Create Cross-Sell Campaign</DialogTitle>
            <DialogDescription>
              Set up a new campaign to reach potential clients for a specific service.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="campaign-service">Target Service</Label>
              <Select
                value={newCampaignServiceId}
                onValueChange={handleServiceChange}
                disabled={!!preselectedServiceId}
              >
                <SelectTrigger id="campaign-service">
                  <SelectValue placeholder="Select a service" />
                </SelectTrigger>
                <SelectContent>
                  {catalog.map((service) => (
                    <SelectItem key={service.id} value={service.id}>
                      {service.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="campaign-name">Campaign Name</Label>
              <Input
                id="campaign-name"
                placeholder="e.g., Q1 Tax Advisory Outreach"
                value={newCampaignName}
                onChange={(e) => setNewCampaignName(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="campaign-description">Description</Label>
              <Textarea
                id="campaign-description"
                placeholder="Describe the goal and message of this campaign..."
                value={newCampaignDescription}
                onChange={(e) => setNewCampaignDescription(e.target.value)}
                rows={3}
              />
            </div>

            {newCampaignServiceId && availableClientsForService.length > 0 && (
              <div className="space-y-2">
                <Label>
                  Target Companies ({selectedCompanyIds.length} of {availableClientsForService.length} selected)
                </Label>
                <div className="border rounded-md max-h-48 overflow-y-auto">
                  {availableClientsForService.map((client) => (
                    <div
                      key={client.companyId}
                      className="flex items-center gap-3 px-3 py-2 hover:bg-muted/50 cursor-pointer border-b last:border-b-0"
                      onClick={() => handleToggleCompany(client.companyId)}
                    >
                      <input
                        type="checkbox"
                        checked={selectedCompanyIds.includes(client.companyId)}
                        onChange={() => handleToggleCompany(client.companyId)}
                        className="rounded border-gray-300"
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{client.companyName}</p>
                        <p className="text-xs text-muted-foreground truncate">{client.reason}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {newCampaignServiceId && availableClientsForService.length === 0 && (
              <div className="text-center py-4 text-muted-foreground text-sm">
                No opportunity clients found for this service. You can still create a campaign manually.
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={handleCloseCreateDialog}>
              Cancel
            </Button>
            <Button
              onClick={handleCreateCampaign}
              disabled={createCampaignMutation.isPending || !newCampaignServiceId || !newCampaignName || selectedCompanyIds.length === 0}
            >
              {createCampaignMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Plus className="h-4 w-4 mr-2" />
              )}
              Create Campaign
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
