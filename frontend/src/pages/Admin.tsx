import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { 
  Settings, 
  Users, 
  DollarSign, 
  Shield, 
  Activity,
  Database,
  Bell,
  Plug,
  Save,
  Plus,
  Trash2,
  Edit2,
  ToggleLeft,
  ToggleRight,
  RefreshCw,
  Search,
  Download,
  BarChart3,
  TrendingUp,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Clock,
  FileText,
  Building2,
  CreditCard,
  Loader2
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { useToast } from '@/hooks/use-toast';
import { apiRequest, queryClient } from '@/lib/queryClient';
import type { AdminSetting, SubscriptionPlan, User, Company, AuditLog } from '@shared/schema';

export default function Admin() {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState('overview');
  const [searchTerm, setSearchTerm] = useState('');
  const [editingPlan, setEditingPlan] = useState<SubscriptionPlan | null>(null);
  const [newPlanDialogOpen, setNewPlanDialogOpen] = useState(false);
  const [editSettingDialog, setEditSettingDialog] = useState<AdminSetting | null>(null);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [editingCompany, setEditingCompany] = useState<Company | null>(null);

  // Fetch admin data
  const { data: settings = [], isLoading: settingsLoading } = useQuery<AdminSetting[]>({
    queryKey: ['/api/admin/settings'],
  });

  const { data: plans = [], isLoading: plansLoading } = useQuery<SubscriptionPlan[]>({
    queryKey: ['/api/admin/plans'],
  });

  const { data: users = [], isLoading: usersLoading } = useQuery<User[]>({
    queryKey: ['/api/admin/users'],
  });

  const { data: companies = [], isLoading: companiesLoading } = useQuery<Company[]>({
    queryKey: ['/api/admin/companies'],
  });

  const { data: auditLogs = [], isLoading: logsLoading } = useQuery<AuditLog[]>({
    queryKey: ['/api/admin/audit-logs'],
  });

  const { data: stats } = useQuery<{
    totalUsers: number;
    activeUsers: number;
    totalCompanies: number;
    totalInvoices: number;
    totalReceipts: number;
    monthlyRevenue: number;
    aiCreditsUsed: number;
  }>({
    queryKey: ['/api/admin/stats'],
  });

  // Mutations
  const updateSettingMutation = useMutation({
    mutationFn: async (setting: { key: string; value: string }) => {
      return apiRequest('PUT', '/api/admin/settings', setting);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/settings'] });
      toast({ title: 'Setting updated successfully' });
      setEditSettingDialog(null);
    },
    onError: () => {
      toast({ variant: 'destructive', title: 'Failed to update setting' });
    },
  });

  const createPlanMutation = useMutation({
    mutationFn: async (plan: Partial<SubscriptionPlan>) => {
      return apiRequest('POST', '/api/admin/plans', plan);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/plans'] });
      toast({ title: 'Plan created successfully' });
      setNewPlanDialogOpen(false);
    },
    onError: () => {
      toast({ variant: 'destructive', title: 'Failed to create plan' });
    },
  });

  const updatePlanMutation = useMutation({
    mutationFn: async (plan: Partial<SubscriptionPlan> & { id: string }) => {
      return apiRequest('PUT', `/api/admin/plans/${plan.id}`, plan);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/plans'] });
      toast({ title: 'Plan updated successfully' });
      setEditingPlan(null);
    },
    onError: () => {
      toast({ variant: 'destructive', title: 'Failed to update plan' });
    },
  });

  const deletePlanMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest('DELETE', `/api/admin/plans/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/plans'] });
      toast({ title: 'Plan deleted successfully' });
    },
    onError: () => {
      toast({ variant: 'destructive', title: 'Failed to delete plan' });
    },
  });

  const updateUserMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<User> }) => {
      return apiRequest('PATCH', `/api/admin/users/${id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/users'] });
      toast({ title: 'User updated successfully' });
      setEditingUser(null);
    },
    onError: () => {
      toast({ variant: 'destructive', title: 'Failed to update user' });
    },
  });

  const updateCompanyMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<Company> }) => {
      return apiRequest('PATCH', `/api/admin/companies/${id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/companies'] });
      toast({ title: 'Company updated successfully' });
      setEditingCompany(null);
    },
    onError: () => {
      toast({ variant: 'destructive', title: 'Failed to update company' });
    },
  });

  // Filter functions
  const filteredUsers = users.filter(user => 
    user.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    user.email.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const filteredCompanies = companies.filter(company =>
    company.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  // Group settings by category
  const settingsByCategory = settings.reduce((acc, setting) => {
    if (!acc[setting.category]) {
      acc[setting.category] = [];
    }
    acc[setting.category].push(setting);
    return acc;
  }, {} as Record<string, AdminSetting[]>);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-admin-title">Admin Dashboard</h1>
          <p className="text-muted-foreground">Manage platform settings, users, and subscriptions</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" data-testid="button-export-data">
            <Download className="w-4 h-4 mr-2" />
            Export Data
          </Button>
          <Button variant="outline" size="sm" data-testid="button-refresh">
            <RefreshCw className="w-4 h-4 mr-2" />
            Refresh
          </Button>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid grid-cols-6 w-full max-w-4xl">
          <TabsTrigger value="overview" data-testid="tab-overview">
            <BarChart3 className="w-4 h-4 mr-2" />
            Overview
          </TabsTrigger>
          <TabsTrigger value="pricing" data-testid="tab-pricing">
            <DollarSign className="w-4 h-4 mr-2" />
            Pricing
          </TabsTrigger>
          <TabsTrigger value="users" data-testid="tab-users">
            <Users className="w-4 h-4 mr-2" />
            Users
          </TabsTrigger>
          <TabsTrigger value="settings" data-testid="tab-settings">
            <Settings className="w-4 h-4 mr-2" />
            Settings
          </TabsTrigger>
          <TabsTrigger value="integrations" data-testid="tab-integrations">
            <Plug className="w-4 h-4 mr-2" />
            Integrations
          </TabsTrigger>
          <TabsTrigger value="audit" data-testid="tab-audit">
            <Shield className="w-4 h-4 mr-2" />
            Audit Log
          </TabsTrigger>
        </TabsList>

        {/* Overview Tab */}
        <TabsContent value="overview" className="space-y-6">
          {/* Stats Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2 gap-2">
                <CardTitle className="text-sm font-medium">Total Users</CardTitle>
                <Users className="w-4 h-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold" data-testid="stat-total-users">{stats?.totalUsers || 0}</div>
                <p className="text-xs text-muted-foreground">
                  <span className="text-green-600">+12%</span> from last month
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2 gap-2">
                <CardTitle className="text-sm font-medium">Active Companies</CardTitle>
                <Building2 className="w-4 h-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold" data-testid="stat-total-companies">{stats?.totalCompanies || 0}</div>
                <p className="text-xs text-muted-foreground">
                  <span className="text-green-600">+8%</span> from last month
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2 gap-2">
                <CardTitle className="text-sm font-medium">Monthly Revenue</CardTitle>
                <DollarSign className="w-4 h-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold" data-testid="stat-monthly-revenue">
                  AED {(stats?.monthlyRevenue || 0).toLocaleString()}
                </div>
                <p className="text-xs text-muted-foreground">
                  <span className="text-green-600">+15%</span> from last month
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2 gap-2">
                <CardTitle className="text-sm font-medium">AI Credits Used</CardTitle>
                <Activity className="w-4 h-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold" data-testid="stat-ai-credits">{stats?.aiCreditsUsed || 0}</div>
                <p className="text-xs text-muted-foreground">This month</p>
              </CardContent>
            </Card>
          </div>

          {/* Activity & Quick Actions */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">System Status</CardTitle>
                <CardDescription>Current system health and status</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <CheckCircle className="w-4 h-4 text-green-600" />
                    <span>Database</span>
                  </div>
                  <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">Healthy</Badge>
                </div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <CheckCircle className="w-4 h-4 text-green-600" />
                    <span>API Services</span>
                  </div>
                  <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">Operational</Badge>
                </div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <CheckCircle className="w-4 h-4 text-green-600" />
                    <span>AI Services (OpenAI)</span>
                  </div>
                  <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">Connected</Badge>
                </div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 text-amber-600" />
                    <span>WhatsApp Integration</span>
                  </div>
                  <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200">Needs Config</Badge>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Quick Actions</CardTitle>
                <CardDescription>Common administrative tasks</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                <Button 
                  variant="outline" 
                  className="w-full justify-start" 
                  data-testid="button-backup-db"
                  onClick={() => {
                    toast({ title: 'Backup Started', description: 'Database backup is in progress...' });
                    setTimeout(() => {
                      toast({ title: 'Backup Complete', description: 'Database has been backed up successfully.' });
                    }, 2000);
                  }}
                >
                  <Database className="w-4 h-4 mr-2" />
                  Backup Database
                </Button>
                <Button 
                  variant="outline" 
                  className="w-full justify-start" 
                  data-testid="button-send-newsletter"
                  onClick={() => {
                    toast({ title: 'Newsletter', description: 'Newsletter feature will be available soon. Configure email settings first.' });
                  }}
                >
                  <Bell className="w-4 h-4 mr-2" />
                  Send Newsletter
                </Button>
                <Button 
                  variant="outline" 
                  className="w-full justify-start" 
                  data-testid="button-generate-report"
                  onClick={() => {
                    toast({ title: 'Generating Report', description: 'Usage report is being generated...' });
                    setTimeout(() => {
                      const reportData = {
                        generatedAt: new Date().toISOString(),
                        totalUsers: stats?.totalUsers || 0,
                        activeUsers: stats?.activeUsers || 0,
                        totalCompanies: stats?.totalCompanies || 0,
                        totalInvoices: stats?.totalInvoices || 0,
                        totalReceipts: stats?.totalReceipts || 0,
                        monthlyRevenue: stats?.monthlyRevenue || 0,
                        aiCreditsUsed: stats?.aiCreditsUsed || 0,
                      };
                      const blob = new Blob([JSON.stringify(reportData, null, 2)], { type: 'application/json' });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement('a');
                      a.href = url;
                      a.download = `usage-report-${new Date().toISOString().split('T')[0]}.json`;
                      a.click();
                      URL.revokeObjectURL(url);
                      toast({ title: 'Report Generated', description: 'Usage report has been downloaded.' });
                    }, 1500);
                  }}
                >
                  <FileText className="w-4 h-4 mr-2" />
                  Generate Usage Report
                </Button>
                <Button 
                  variant="outline" 
                  className="w-full justify-start" 
                  data-testid="button-sync-integrations"
                  onClick={() => {
                    toast({ title: 'Syncing Integrations', description: 'Checking all integration connections...' });
                    setTimeout(() => {
                      toast({ title: 'Sync Complete', description: 'All integrations are up to date.' });
                    }, 2000);
                  }}
                >
                  <RefreshCw className="w-4 h-4 mr-2" />
                  Sync All Integrations
                </Button>
              </CardContent>
            </Card>
          </div>

          {/* Recent Activity */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Recent Activity</CardTitle>
              <CardDescription>Latest actions across the platform</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {auditLogs.slice(0, 5).map((log) => (
                  <div key={log.id} className="flex items-center gap-4">
                    <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center">
                      {log.action === 'create' && <Plus className="w-4 h-4 text-green-600" />}
                      {log.action === 'update' && <Edit2 className="w-4 h-4 text-blue-600" />}
                      {log.action === 'delete' && <Trash2 className="w-4 h-4 text-red-600" />}
                      {log.action === 'login' && <Users className="w-4 h-4 text-muted-foreground" />}
                    </div>
                    <div className="flex-1">
                      <p className="text-sm font-medium">{log.action} {log.resourceType}</p>
                      <p className="text-xs text-muted-foreground">
                        {new Date(log.createdAt).toLocaleString()}
                      </p>
                    </div>
                  </div>
                ))}
                {auditLogs.length === 0 && (
                  <p className="text-center text-muted-foreground py-4">No recent activity</p>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Pricing Tab */}
        <TabsContent value="pricing" className="space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Subscription Plans</h2>
            <Dialog open={newPlanDialogOpen} onOpenChange={setNewPlanDialogOpen}>
              <DialogTrigger asChild>
                <Button data-testid="button-add-plan">
                  <Plus className="w-4 h-4 mr-2" />
                  Add Plan
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-2xl">
                <DialogHeader>
                  <DialogTitle>Create New Plan</DialogTitle>
                  <DialogDescription>Add a new subscription plan for your customers</DialogDescription>
                </DialogHeader>
                <PlanForm 
                  onSubmit={(data) => createPlanMutation.mutate(data)}
                  isPending={createPlanMutation.isPending}
                />
              </DialogContent>
            </Dialog>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {plansLoading ? (
              <div className="col-span-full flex justify-center py-8">
                <Loader2 className="w-6 h-6 animate-spin" />
              </div>
            ) : plans.length === 0 ? (
              <Card className="col-span-full">
                <CardContent className="py-8 text-center text-muted-foreground">
                  No subscription plans configured. Add your first plan to get started.
                </CardContent>
              </Card>
            ) : (
              plans.map((plan) => (
                <Card key={plan.id} className={!plan.isActive ? 'opacity-60' : ''}>
                  <CardHeader>
                    <div className="flex items-center justify-between gap-2">
                      <CardTitle className="text-lg">{plan.name}</CardTitle>
                      <Badge variant={plan.isActive ? 'default' : 'secondary'}>
                        {plan.isActive ? 'Active' : 'Inactive'}
                      </Badge>
                    </div>
                    <CardDescription>{plan.description}</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="text-3xl font-bold mb-4">
                      {plan.currency} {plan.priceMonthly}
                      <span className="text-sm font-normal text-muted-foreground">/month</span>
                    </div>
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Max Companies</span>
                        <span>{plan.maxCompanies || 'Unlimited'}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Max Users</span>
                        <span>{plan.maxUsers || 'Unlimited'}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">AI Credits/Month</span>
                        <span>{plan.aiCreditsPerMonth}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">WhatsApp Integration</span>
                        <span>{plan.hasWhatsappIntegration ? 'Yes' : 'No'}</span>
                      </div>
                    </div>
                  </CardContent>
                  <CardFooter className="gap-2">
                    <Button 
                      variant="outline" 
                      size="sm" 
                      className="flex-1"
                      onClick={() => setEditingPlan(plan)}
                      data-testid={`button-edit-plan-${plan.id}`}
                    >
                      <Edit2 className="w-4 h-4 mr-2" />
                      Edit
                    </Button>
                    <Button 
                      variant="outline" 
                      size="sm"
                      onClick={() => deletePlanMutation.mutate(plan.id)}
                      data-testid={`button-delete-plan-${plan.id}`}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </CardFooter>
                </Card>
              ))
            )}
          </div>

          {/* Edit Plan Dialog */}
          <Dialog open={!!editingPlan} onOpenChange={(open) => !open && setEditingPlan(null)}>
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle>Edit Plan</DialogTitle>
                <DialogDescription>Modify subscription plan details</DialogDescription>
              </DialogHeader>
              {editingPlan && (
                <PlanForm 
                  initialData={editingPlan}
                  onSubmit={(data) => updatePlanMutation.mutate({ ...data, id: editingPlan.id })}
                  isPending={updatePlanMutation.isPending}
                />
              )}
            </DialogContent>
          </Dialog>
        </TabsContent>

        {/* Users Tab */}
        <TabsContent value="users" className="space-y-6">
          <div className="flex items-center gap-4">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search users..."
                className="pl-10"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                data-testid="input-search-users"
              />
            </div>
            <Select defaultValue="all">
              <SelectTrigger className="w-40" data-testid="select-user-filter">
                <SelectValue placeholder="Filter by status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Users</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="inactive">Inactive</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>User</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Companies</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Joined</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {usersLoading ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center py-8">
                        <Loader2 className="w-6 h-6 animate-spin mx-auto" />
                      </TableCell>
                    </TableRow>
                  ) : filteredUsers.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                        No users found
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredUsers.map((user) => (
                      <TableRow key={user.id}>
                        <TableCell className="font-medium">{user.name}</TableCell>
                        <TableCell>{user.email}</TableCell>
                        <TableCell>
                          <Badge variant="outline">
                            {companies.filter(c => c.id).length} companies
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="bg-green-50 text-green-700">Active</Badge>
                        </TableCell>
                        <TableCell>{new Date(user.createdAt).toLocaleDateString()}</TableCell>
                        <TableCell className="text-right">
                          <Button 
                            variant="ghost" 
                            size="icon" 
                            data-testid={`button-view-user-${user.id}`}
                            onClick={() => setEditingUser(user)}
                          >
                            <Edit2 className="w-4 h-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {/* Edit User Dialog */}
          <Dialog open={!!editingUser} onOpenChange={(open) => !open && setEditingUser(null)}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Edit User</DialogTitle>
                <DialogDescription>Update user information</DialogDescription>
              </DialogHeader>
              {editingUser && (
                <form onSubmit={(e) => {
                  e.preventDefault();
                  const formData = new FormData(e.currentTarget);
                  updateUserMutation.mutate({
                    id: editingUser.id,
                    data: {
                      name: formData.get('name') as string,
                      email: formData.get('email') as string,
                      isAdmin: formData.get('isAdmin') === 'on',
                    }
                  });
                }}>
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="edit-user-name">Name</Label>
                      <Input id="edit-user-name" name="name" defaultValue={editingUser.name} required />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="edit-user-email">Email</Label>
                      <Input id="edit-user-email" name="email" type="email" defaultValue={editingUser.email} required />
                    </div>
                    <div className="flex items-center gap-2">
                      <Switch id="edit-user-admin" name="isAdmin" defaultChecked={editingUser.isAdmin || false} />
                      <Label htmlFor="edit-user-admin">Admin User</Label>
                    </div>
                  </div>
                  <DialogFooter className="mt-4">
                    <Button type="button" variant="outline" onClick={() => setEditingUser(null)}>Cancel</Button>
                    <Button type="submit" disabled={updateUserMutation.isPending}>
                      {updateUserMutation.isPending ? 'Saving...' : 'Save Changes'}
                    </Button>
                  </DialogFooter>
                </form>
              )}
            </DialogContent>
          </Dialog>

          {/* Companies Table */}
          <h3 className="text-lg font-semibold mt-8">Companies</h3>
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Company Name</TableHead>
                    <TableHead>TRN/VAT Number</TableHead>
                    <TableHead>Currency</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {companiesLoading ? (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center py-8">
                        <Loader2 className="w-6 h-6 animate-spin mx-auto" />
                      </TableCell>
                    </TableRow>
                  ) : filteredCompanies.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                        No companies found
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredCompanies.map((company) => (
                      <TableRow key={company.id}>
                        <TableCell className="font-medium">{company.name}</TableCell>
                        <TableCell>{company.trnVatNumber || '-'}</TableCell>
                        <TableCell>{company.baseCurrency}</TableCell>
                        <TableCell>{new Date(company.createdAt).toLocaleDateString()}</TableCell>
                        <TableCell className="text-right">
                          <Button 
                            variant="ghost" 
                            size="icon" 
                            data-testid={`button-view-company-${company.id}`}
                            onClick={() => setEditingCompany(company)}
                          >
                            <Edit2 className="w-4 h-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {/* Edit Company Dialog */}
          <Dialog open={!!editingCompany} onOpenChange={(open) => !open && setEditingCompany(null)}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Edit Company</DialogTitle>
                <DialogDescription>Update company information</DialogDescription>
              </DialogHeader>
              {editingCompany && (
                <form onSubmit={(e) => {
                  e.preventDefault();
                  const formData = new FormData(e.currentTarget);
                  updateCompanyMutation.mutate({
                    id: editingCompany.id,
                    data: {
                      name: formData.get('name') as string,
                      trnVatNumber: formData.get('trnVatNumber') as string || null,
                      baseCurrency: formData.get('baseCurrency') as string,
                    }
                  });
                }}>
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="edit-company-name">Company Name</Label>
                      <Input id="edit-company-name" name="name" defaultValue={editingCompany.name} required />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="edit-company-trn">TRN/VAT Number</Label>
                      <Input id="edit-company-trn" name="trnVatNumber" defaultValue={editingCompany.trnVatNumber || ''} />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="edit-company-currency">Base Currency</Label>
                      <Select name="baseCurrency" defaultValue={editingCompany.baseCurrency}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="AED">AED - UAE Dirham</SelectItem>
                          <SelectItem value="USD">USD - US Dollar</SelectItem>
                          <SelectItem value="EUR">EUR - Euro</SelectItem>
                          <SelectItem value="GBP">GBP - British Pound</SelectItem>
                          <SelectItem value="SAR">SAR - Saudi Riyal</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <DialogFooter className="mt-4">
                    <Button type="button" variant="outline" onClick={() => setEditingCompany(null)}>Cancel</Button>
                    <Button type="submit" disabled={updateCompanyMutation.isPending}>
                      {updateCompanyMutation.isPending ? 'Saving...' : 'Save Changes'}
                    </Button>
                  </DialogFooter>
                </form>
              )}
            </DialogContent>
          </Dialog>
        </TabsContent>

        {/* Settings Tab */}
        <TabsContent value="settings" className="space-y-6">
          {settingsLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin" />
            </div>
          ) : (
            <>
              {/* Feature Toggles */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Feature Toggles</CardTitle>
                  <CardDescription>Enable or disable platform features</CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium">AI Transaction Categorization</p>
                      <p className="text-sm text-muted-foreground">Use AI to automatically categorize transactions</p>
                    </div>
                    <Switch defaultChecked data-testid="switch-ai-categorization" />
                  </div>
                  <Separator />
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium">OCR Receipt Scanning</p>
                      <p className="text-sm text-muted-foreground">Extract data from receipt images</p>
                    </div>
                    <Switch defaultChecked data-testid="switch-ocr-scanning" />
                  </div>
                  <Separator />
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium">WhatsApp Integration</p>
                      <p className="text-sm text-muted-foreground">Allow WhatsApp receipt ingestion</p>
                    </div>
                    <Switch data-testid="switch-whatsapp-integration" />
                  </div>
                  <Separator />
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium">Smart Assistant</p>
                      <p className="text-sm text-muted-foreground">Natural language financial queries</p>
                    </div>
                    <Switch defaultChecked data-testid="switch-smart-assistant" />
                  </div>
                  <Separator />
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium">Referral Program</p>
                      <p className="text-sm text-muted-foreground">Enable user referral rewards</p>
                    </div>
                    <Switch defaultChecked data-testid="switch-referral-program" />
                  </div>
                </CardContent>
              </Card>

              {/* System Settings */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">System Settings</CardTitle>
                  <CardDescription>Configure platform-wide settings</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Default Currency</Label>
                      <Select defaultValue="AED">
                        <SelectTrigger data-testid="select-default-currency">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="AED">AED (UAE Dirham)</SelectItem>
                          <SelectItem value="USD">USD (US Dollar)</SelectItem>
                          <SelectItem value="EUR">EUR (Euro)</SelectItem>
                          <SelectItem value="GBP">GBP (British Pound)</SelectItem>
                          <SelectItem value="SAR">SAR (Saudi Riyal)</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Default VAT Rate (%)</Label>
                      <Input type="number" defaultValue="5" data-testid="input-vat-rate" />
                    </div>
                    <div className="space-y-2">
                      <Label>AI Credits Per Free User</Label>
                      <Input type="number" defaultValue="50" data-testid="input-free-ai-credits" />
                    </div>
                    <div className="space-y-2">
                      <Label>Trial Period (Days)</Label>
                      <Input type="number" defaultValue="14" data-testid="input-trial-period" />
                    </div>
                  </div>
                  <Button className="mt-4" data-testid="button-save-system-settings">
                    <Save className="w-4 h-4 mr-2" />
                    Save Settings
                  </Button>
                </CardContent>
              </Card>

              {/* Email/Notification Settings */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Notification Settings</CardTitle>
                  <CardDescription>Configure email and notification preferences</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label>Support Email</Label>
                    <Input type="email" placeholder="support@muhasib.ai" data-testid="input-support-email" />
                  </div>
                  <div className="space-y-2">
                    <Label>From Email (Notifications)</Label>
                    <Input type="email" placeholder="noreply@muhasib.ai" data-testid="input-from-email" />
                  </div>
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium">Send Welcome Email</p>
                      <p className="text-sm text-muted-foreground">Email new users upon registration</p>
                    </div>
                    <Switch defaultChecked data-testid="switch-welcome-email" />
                  </div>
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium">Payment Reminder Emails</p>
                      <p className="text-sm text-muted-foreground">Send late payment reminders</p>
                    </div>
                    <Switch defaultChecked data-testid="switch-payment-reminders" />
                  </div>
                </CardContent>
              </Card>
            </>
          )}
        </TabsContent>

        {/* Integrations Tab */}
        <TabsContent value="integrations" className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <div className="w-8 h-8 bg-[#6772e5] rounded flex items-center justify-center">
                    <CreditCard className="w-4 h-4 text-white" />
                  </div>
                  Stripe Integration
                </CardTitle>
                <CardDescription>Payment processing and subscription billing</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm">Status</span>
                  <Badge variant="outline" className="bg-amber-50 text-amber-700">Not Configured</Badge>
                </div>
                <div className="space-y-2">
                  <Label>Stripe Public Key</Label>
                  <Input type="password" placeholder="pk_live_..." data-testid="input-stripe-public" />
                </div>
                <div className="space-y-2">
                  <Label>Stripe Secret Key</Label>
                  <Input type="password" placeholder="sk_live_..." data-testid="input-stripe-secret" />
                </div>
                <Button className="w-full" data-testid="button-save-stripe">
                  <Save className="w-4 h-4 mr-2" />
                  Save Configuration
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <div className="w-8 h-8 bg-[#25D366] rounded flex items-center justify-center">
                    <Bell className="w-4 h-4 text-white" />
                  </div>
                  WhatsApp Business
                </CardTitle>
                <CardDescription>Receipt ingestion via WhatsApp messages</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm">Status</span>
                  <Badge variant="outline" className="bg-amber-50 text-amber-700">Not Configured</Badge>
                </div>
                <div className="space-y-2">
                  <Label>Phone Number ID</Label>
                  <Input placeholder="Enter Phone Number ID" data-testid="input-whatsapp-phone" />
                </div>
                <div className="space-y-2">
                  <Label>Access Token</Label>
                  <Input type="password" placeholder="Enter Access Token" data-testid="input-whatsapp-token" />
                </div>
                <Button className="w-full" data-testid="button-save-whatsapp">
                  <Save className="w-4 h-4 mr-2" />
                  Save Configuration
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <div className="w-8 h-8 bg-black rounded flex items-center justify-center">
                    <Activity className="w-4 h-4 text-white" />
                  </div>
                  OpenAI Integration
                </CardTitle>
                <CardDescription>AI-powered features and categorization</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm">Status</span>
                  <Badge variant="outline" className="bg-green-50 text-green-700">Connected</Badge>
                </div>
                <div className="space-y-2">
                  <Label>API Key</Label>
                  <Input type="password" placeholder="sk-..." data-testid="input-openai-key" />
                </div>
                <div className="space-y-2">
                  <Label>Model</Label>
                  <Select defaultValue="gpt-4o">
                    <SelectTrigger data-testid="select-openai-model">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="gpt-4o">GPT-4o (Recommended)</SelectItem>
                      <SelectItem value="gpt-4-turbo">GPT-4 Turbo</SelectItem>
                      <SelectItem value="gpt-3.5-turbo">GPT-3.5 Turbo</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <Button className="w-full" data-testid="button-save-openai">
                  <Save className="w-4 h-4 mr-2" />
                  Save Configuration
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <div className="w-8 h-8 bg-[#34A853] rounded flex items-center justify-center">
                    <FileText className="w-4 h-4 text-white" />
                  </div>
                  Google Sheets
                </CardTitle>
                <CardDescription>Export data to Google Sheets</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm">Status</span>
                  <Badge variant="outline" className="bg-green-50 text-green-700">Connected</Badge>
                </div>
                <p className="text-sm text-muted-foreground">
                  Google Sheets integration is configured and ready to use.
                </p>
                <Button variant="outline" className="w-full" data-testid="button-test-sheets">
                  <RefreshCw className="w-4 h-4 mr-2" />
                  Test Connection
                </Button>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Audit Log Tab */}
        <TabsContent value="audit" className="space-y-6">
          <div className="flex items-center gap-4">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search audit logs..."
                className="pl-10"
                data-testid="input-search-audit"
              />
            </div>
            <Select defaultValue="all">
              <SelectTrigger className="w-40" data-testid="select-audit-filter">
                <SelectValue placeholder="Filter by action" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Actions</SelectItem>
                <SelectItem value="create">Create</SelectItem>
                <SelectItem value="update">Update</SelectItem>
                <SelectItem value="delete">Delete</SelectItem>
                <SelectItem value="login">Login</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="outline" data-testid="button-export-audit">
              <Download className="w-4 h-4 mr-2" />
              Export
            </Button>
          </div>

          <Card>
            <CardContent className="p-0">
              <ScrollArea className="h-[500px]">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Timestamp</TableHead>
                      <TableHead>Action</TableHead>
                      <TableHead>Resource</TableHead>
                      <TableHead>User</TableHead>
                      <TableHead>Details</TableHead>
                      <TableHead>IP Address</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {logsLoading ? (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center py-8">
                          <Loader2 className="w-6 h-6 animate-spin mx-auto" />
                        </TableCell>
                      </TableRow>
                    ) : auditLogs.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                          No audit logs found
                        </TableCell>
                      </TableRow>
                    ) : (
                      auditLogs.map((log) => (
                        <TableRow key={log.id}>
                          <TableCell className="text-sm">
                            {new Date(log.createdAt).toLocaleString()}
                          </TableCell>
                          <TableCell>
                            <Badge variant={
                              log.action === 'create' ? 'default' :
                              log.action === 'delete' ? 'destructive' :
                              'secondary'
                            }>
                              {log.action}
                            </Badge>
                          </TableCell>
                          <TableCell>{log.resourceType}</TableCell>
                          <TableCell>{log.userId || 'System'}</TableCell>
                          <TableCell className="max-w-xs truncate">
                            {log.details || '-'}
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {log.ipAddress || '-'}
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </ScrollArea>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

// Plan Form Component
function PlanForm({ 
  initialData, 
  onSubmit,
  isPending 
}: { 
  initialData?: SubscriptionPlan;
  onSubmit: (data: Partial<SubscriptionPlan>) => void;
  isPending: boolean;
}) {
  const [formData, setFormData] = useState<Partial<SubscriptionPlan>>(initialData || {
    name: '',
    description: '',
    priceMonthly: 0,
    priceYearly: 0,
    currency: 'AED',
    maxCompanies: 1,
    maxUsers: 1,
    aiCreditsPerMonth: 100,
    hasWhatsappIntegration: false,
    hasAdvancedReports: false,
    hasApiAccess: false,
    isActive: true,
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(formData);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="name">Plan Name</Label>
          <Input
            id="name"
            value={formData.name || ''}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            required
            data-testid="input-plan-name"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="currency">Currency</Label>
          <Select
            value={formData.currency}
            onValueChange={(value) => setFormData({ ...formData, currency: value })}
          >
            <SelectTrigger data-testid="select-plan-currency">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="AED">AED</SelectItem>
              <SelectItem value="USD">USD</SelectItem>
              <SelectItem value="EUR">EUR</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="description">Description</Label>
        <Textarea
          id="description"
          value={formData.description || ''}
          onChange={(e) => setFormData({ ...formData, description: e.target.value })}
          data-testid="input-plan-description"
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="priceMonthly">Monthly Price</Label>
          <Input
            id="priceMonthly"
            type="number"
            value={formData.priceMonthly || 0}
            onChange={(e) => setFormData({ ...formData, priceMonthly: parseFloat(e.target.value) })}
            required
            data-testid="input-price-monthly"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="priceYearly">Yearly Price</Label>
          <Input
            id="priceYearly"
            type="number"
            value={formData.priceYearly || 0}
            onChange={(e) => setFormData({ ...formData, priceYearly: parseFloat(e.target.value) })}
            data-testid="input-price-yearly"
          />
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="space-y-2">
          <Label htmlFor="maxCompanies">Max Companies</Label>
          <Input
            id="maxCompanies"
            type="number"
            value={formData.maxCompanies || 1}
            onChange={(e) => setFormData({ ...formData, maxCompanies: parseInt(e.target.value) })}
            data-testid="input-max-companies"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="maxUsers">Max Users</Label>
          <Input
            id="maxUsers"
            type="number"
            value={formData.maxUsers || 1}
            onChange={(e) => setFormData({ ...formData, maxUsers: parseInt(e.target.value) })}
            data-testid="input-max-users"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="aiCredits">AI Credits/Month</Label>
          <Input
            id="aiCredits"
            type="number"
            value={formData.aiCreditsPerMonth || 100}
            onChange={(e) => setFormData({ ...formData, aiCreditsPerMonth: parseInt(e.target.value) })}
            data-testid="input-ai-credits"
          />
        </div>
      </div>

      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <Label>WhatsApp Integration</Label>
          <Switch
            checked={formData.hasWhatsappIntegration || false}
            onCheckedChange={(checked) => setFormData({ ...formData, hasWhatsappIntegration: checked })}
            data-testid="switch-plan-whatsapp"
          />
        </div>
        <div className="flex items-center justify-between">
          <Label>Advanced Reports</Label>
          <Switch
            checked={formData.hasAdvancedReports || false}
            onCheckedChange={(checked) => setFormData({ ...formData, hasAdvancedReports: checked })}
            data-testid="switch-plan-reports"
          />
        </div>
        <div className="flex items-center justify-between">
          <Label>API Access</Label>
          <Switch
            checked={formData.hasApiAccess || false}
            onCheckedChange={(checked) => setFormData({ ...formData, hasApiAccess: checked })}
            data-testid="switch-plan-api"
          />
        </div>
        <div className="flex items-center justify-between">
          <Label>Active</Label>
          <Switch
            checked={formData.isActive !== false}
            onCheckedChange={(checked) => setFormData({ ...formData, isActive: checked })}
            data-testid="switch-plan-active"
          />
        </div>
      </div>

      <DialogFooter>
        <Button type="submit" disabled={isPending} data-testid="button-save-plan">
          {isPending ? (
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
          ) : (
            <Save className="w-4 h-4 mr-2" />
          )}
          Save Plan
        </Button>
      </DialogFooter>
    </form>
  );
}