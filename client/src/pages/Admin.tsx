import { AdminPlanControl } from "@/components/billing/AdminPlanControl";
import { T } from "@/components/layout/T";
import { StatCard } from "@/components/ui/stat-card";
import { activityActionLabel, activityEntityLabel } from "@/lib/activity-log-labels";
import { useTranslation, translateNow, formatMessage } from "@/lib/i18n";
import { Money } from "@/components/ui/money";
import { PageHeader } from "@/components/ui/page-header";
import { Fragment, useState, useEffect } from "react";
import { formatDate, formatDateTime } from "@/lib/format-date";
import { auditDetailEntries } from "@/pages/admin/audit-details";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  Settings,
  Users,
  DollarSign,
  Shield,
  Activity,
  Plug,
  Save,
  Plus,
  Trash2,
  Edit2,
  RefreshCw,
  Search,
  Download,
  BarChart3,
  FileText,
  CreditCard,
  Loader2,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  CardFooter,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { exportToExcel } from "@/lib/export";
import type { AdminSetting, SubscriptionPlan, User, Company, AuditLog } from "@shared/schema";

export default function Admin() {
  const { t, locale } = useTranslation();
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState("overview");
  const [searchTerm, setSearchTerm] = useState("");
  const [editingPlan, setEditingPlan] = useState<SubscriptionPlan | null>(null);
  const [newPlanDialogOpen, setNewPlanDialogOpen] = useState(false);
  const [_editSettingDialog, setEditSettingDialog] = useState<AdminSetting | null>(null);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [editingCompany, setEditingCompany] = useState<Company | null>(null);

  // System settings state
  const [systemSettings, setSystemSettings] = useState({
    defaultCurrency: "AED",
    defaultVatRate: "5",
    freeAiCredits: "50",
    trialPeriod: "14",
    aiCategorization: true,
    ocrScanning: true,
    smartAssistant: true,
    referralProgram: true,
    supportEmail: "",
    fromEmail: "",
    sendWelcomeEmail: true,
    paymentReminders: true,
  });

  // Fetch admin data
  const { data: settings = [], isLoading: settingsLoading } = useQuery<AdminSetting[]>({
    queryKey: ["/api/admin/settings"],
  });

  useEffect(() => {
    if (settings.length === 0) return;
    const settingsMap = settings.reduce(
      (acc: Record<string, string>, setting: AdminSetting) => {
        acc[setting.key] = setting.value;
        return acc;
      },
      {} as Record<string, string>
    );

    // eslint-disable-next-line react-hooks/set-state-in-effect -- hydrates local form state from fetched data
    setSystemSettings((prev) => ({
      ...prev,
      defaultCurrency: settingsMap["system.defaultCurrency"] || prev.defaultCurrency,
      defaultVatRate: settingsMap["system.defaultVatRate"] || prev.defaultVatRate,
      freeAiCredits: settingsMap["system.freeAiCredits"] || prev.freeAiCredits,
      trialPeriod: settingsMap["system.trialPeriod"] || prev.trialPeriod,
      aiCategorization:
        "feature.aiCategorization" in settingsMap
          ? settingsMap["feature.aiCategorization"] === "true"
          : prev.aiCategorization,
      ocrScanning:
        "feature.ocrScanning" in settingsMap
          ? settingsMap["feature.ocrScanning"] === "true"
          : prev.ocrScanning,
      smartAssistant:
        "feature.smartAssistant" in settingsMap
          ? settingsMap["feature.smartAssistant"] === "true"
          : prev.smartAssistant,
      referralProgram:
        "feature.referralProgram" in settingsMap
          ? settingsMap["feature.referralProgram"] === "true"
          : prev.referralProgram,
      supportEmail: settingsMap["notification.supportEmail"] || prev.supportEmail,
      fromEmail: settingsMap["notification.fromEmail"] || prev.fromEmail,
      sendWelcomeEmail:
        "notification.sendWelcomeEmail" in settingsMap
          ? settingsMap["notification.sendWelcomeEmail"] === "true"
          : prev.sendWelcomeEmail,
      paymentReminders:
        "notification.paymentReminders" in settingsMap
          ? settingsMap["notification.paymentReminders"] === "true"
          : prev.paymentReminders,
    }));
  }, [settings]);

  const { data: plans = [], isLoading: plansLoading } = useQuery<SubscriptionPlan[]>({
    queryKey: ["/api/admin/plans"],
  });

  const { data: users = [], isLoading: usersLoading } = useQuery<User[]>({
    queryKey: ["/api/admin/users"],
  });

  const { data: companies = [], isLoading: companiesLoading } = useQuery<Company[]>({
    queryKey: ["/api/admin/companies"],
  });

  const [expandedLog, setExpandedLog] = useState<string | null>(null);
  const { data: auditLogs = [], isLoading: logsLoading } = useQuery<AuditLog[]>({
    queryKey: ["/api/admin/audit-logs"],
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
    queryKey: ["/api/admin/stats"],
  });

  // Mutations
  const _updateSettingMutation = useMutation({
    mutationFn: async (setting: { key: string; value: string }) => {
      return apiRequest("PUT", "/api/admin/settings", setting);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/settings"] });
      toast({ title: t["admin.settingUpdatedSuccessfully"] });
      setEditSettingDialog(null);
    },
    onError: () => {
      toast({ variant: "destructive", title: t["admin.failedToUpdateSetting"] });
    },
  });

  // Save all system settings
  const saveSystemSettingsMutation = useMutation({
    mutationFn: async (settingsToSave: typeof systemSettings) => {
      const settings = [
        { key: "system.defaultCurrency", value: settingsToSave.defaultCurrency },
        { key: "system.defaultVatRate", value: settingsToSave.defaultVatRate },
        { key: "system.freeAiCredits", value: settingsToSave.freeAiCredits },
        { key: "system.trialPeriod", value: settingsToSave.trialPeriod },
        { key: "feature.aiCategorization", value: settingsToSave.aiCategorization.toString() },
        { key: "feature.ocrScanning", value: settingsToSave.ocrScanning.toString() },
        { key: "feature.smartAssistant", value: settingsToSave.smartAssistant.toString() },
        { key: "feature.referralProgram", value: settingsToSave.referralProgram.toString() },
        { key: "notification.supportEmail", value: settingsToSave.supportEmail },
        { key: "notification.fromEmail", value: settingsToSave.fromEmail },
        { key: "notification.sendWelcomeEmail", value: settingsToSave.sendWelcomeEmail.toString() },
        { key: "notification.paymentReminders", value: settingsToSave.paymentReminders.toString() },
      ];

      // Save all settings in parallel
      await Promise.all(
        settings.map((setting) => apiRequest("PUT", "/api/admin/settings", setting))
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/settings"] });
      toast({ title: t["admin.systemSettingsSavedSuccessfully"] });
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: translateNow("toasts.failedToSaveSettings"),
        description: error?.message || translateNow("toasts.pleaseTryAgain2"),
      });
    },
  });

  const createPlanMutation = useMutation({
    mutationFn: async (plan: Partial<SubscriptionPlan>) => {
      return apiRequest("POST", "/api/admin/plans", plan);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/plans"] });
      toast({ title: t["admin.planCreatedSuccessfully"] });
      setNewPlanDialogOpen(false);
    },
    onError: () => {
      toast({ variant: "destructive", title: t["admin.failedToCreatePlan"] });
    },
  });

  const updatePlanMutation = useMutation({
    mutationFn: async (plan: Partial<SubscriptionPlan> & { id: string }) => {
      // The server contract is strict (R17-20): send plan fields only, never id / createdAt.
      const { id, createdAt: _createdAt, ...fields } = plan;
      return apiRequest("PUT", `/api/admin/plans/${id}`, fields);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/plans"] });
      toast({ title: t["admin.planUpdatedSuccessfully"] });
      setEditingPlan(null);
    },
    onError: () => {
      toast({ variant: "destructive", title: t["admin.failedToUpdatePlan"] });
    },
  });

  const deletePlanMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest("DELETE", `/api/admin/plans/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/plans"] });
      toast({ title: t["admin.planDeletedSuccessfully"] });
    },
    onError: () => {
      toast({ variant: "destructive", title: t["admin.failedToDeletePlan"] });
    },
  });

  const updateUserMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<User> }) => {
      return apiRequest("PATCH", `/api/admin/users/${id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      toast({ title: t["admin.userUpdatedSuccessfully"] });
      setEditingUser(null);
    },
    onError: () => {
      toast({ variant: "destructive", title: t["admin.failedToUpdateUser"] });
    },
  });

  const updateCompanyMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<Company> }) => {
      return apiRequest("PATCH", `/api/admin/companies/${id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/companies"] });
      toast({ title: t["admin.companyUpdatedSuccessfully"] });
      setEditingCompany(null);
    },
    onError: () => {
      toast({ variant: "destructive", title: t["admin.failedToUpdateCompany"] });
    },
  });

  // Broken-path sweep: "Export data" and "Refresh" had no handlers. Export writes the users and
  // companies lists (two sheets); Refresh re-reads every admin query.
  const exportAdminData = () =>
    exportToExcel(
      [
        {
          sheetName: t["admin.export.usersSheet"],
          columns: [
            { header: t["admin.export.name"], key: "name", width: 28 },
            { header: t["admin.export.email"], key: "email", width: 32 },
            { header: t["admin.export.type"], key: "type", width: 14 },
            { header: t["admin.export.created"], key: "created", width: 16 },
          ],
          rows: users.map((u) => ({
            name: u.name,
            email: u.email,
            type: u.userType,
            created: formatDate(u.createdAt, locale),
          })),
        },
        {
          sheetName: t["admin.export.companiesSheet"],
          columns: [
            { header: t["admin.export.name"], key: "name", width: 32 },
            { header: t["admin.export.trn"], key: "trn", width: 18 },
            { header: t["admin.export.currency"], key: "currency", width: 10 },
            { header: t["admin.export.created"], key: "created", width: 16 },
          ],
          rows: companies.map((c) => ({
            name: c.name,
            trn: c.trnVatNumber ?? "",
            currency: c.baseCurrency,
            created: formatDate(c.createdAt, locale),
          })),
        },
      ],
      "admin-export"
    );

  // Filter functions
  const filteredUsers = users.filter(
    (user) =>
      user.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      user.email.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const filteredCompanies = companies.filter((company) =>
    company.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  // Group settings by category
  const _settingsByCategory = settings.reduce(
    (acc, setting) => {
      if (!acc[setting.category]) {
        acc[setting.category] = [];
      }
      acc[setting.category].push(setting);
      return acc;
    },
    {} as Record<string, AdminSetting[]>
  );

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Admin"
        title={t["admin.adminDashboard"]}
        testId="text-admin-title"
        description={t["admin.managePlatformSettingsUsersAnd"]}
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void exportAdminData()}
              data-testid="button-export-data"
            >
              <Download className="w-4 h-4 me-2" />
              <T k="pageLabels.exportData" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                queryClient.invalidateQueries({
                  predicate: (q) => String(q.queryKey[0] ?? "").startsWith("/api/admin/"),
                })
              }
              data-testid="button-refresh"
            >
              <RefreshCw className="w-4 h-4 me-2" />
              <T k="pages.refresh" />
            </Button>
          </>
        }
      />

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="overview" data-testid="tab-overview">
            <BarChart3 className="w-4 h-4 me-2" />
            <T k="pages.overview" />
          </TabsTrigger>
          <TabsTrigger value="pricing" data-testid="tab-pricing">
            <DollarSign className="w-4 h-4 me-2" />
            <T k="pages.pricing" />
          </TabsTrigger>
          <TabsTrigger value="users" data-testid="tab-users">
            <Users className="w-4 h-4 me-2" />
            <T k="pages.users" />
          </TabsTrigger>
          <TabsTrigger value="settings" data-testid="tab-settings">
            <Settings className="w-4 h-4 me-2" />
            <T k="pages.settings" />
          </TabsTrigger>
          <TabsTrigger value="integrations" data-testid="tab-integrations">
            <Plug className="w-4 h-4 me-2" />
            <T k="pageLabels.integrations" />
          </TabsTrigger>
          <TabsTrigger value="audit" data-testid="tab-audit">
            <Shield className="w-4 h-4 me-2" />
            <T k="pageLabels.auditLog" />
          </TabsTrigger>
        </TabsList>

        {/* Overview Tab */}
        <TabsContent value="overview" className="space-y-6">
          {/* Stats Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard
              label={<T k="pageLabels.totalUsers" />}
              value={stats?.totalUsers || 0}
              testId="stat-total-users"
            />
            <StatCard
              label={<T k="pageLabels.activeCompanies" />}
              value={stats?.totalCompanies || 0}
              testId="stat-total-companies"
            />
            <StatCard
              label={<T k="pageLabels.monthlyRevenue" />}
              value={<Money amount={stats?.monthlyRevenue || 0} currency="AED" />}
              testId="stat-monthly-revenue"
            />
            <StatCard
              label={<T k="pageLabels.aICreditsUsed" />}
              value={stats?.aiCreditsUsed || 0}
              hint={<T k="pages.thisMonth" />}
              testId="stat-ai-credits"
            />
          </div>

          {/* WP-E (spec 3.16): the hard-coded "all green" system status and the quick actions
              that only showed toasts (backup, newsletter, sync) were removed; nothing here may
              claim work it did not do. */}
          {/* Recent Activity */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                <T k="pages.recentActivity" />
              </CardTitle>
              <CardDescription>
                <T k="pageLabels.latestActionsAcrossThePlatform" />
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {/* Fable P18: the activity-feed row (no empty avatar circles, no coloured icons);
                    one sentence, entity and a one-line date. */}
                {auditLogs.slice(0, 5).map((log) => (
                  <div key={log.id} className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">{activityActionLabel(t, log.action)}</p>
                      <p className="text-xs text-muted-foreground">
                        {activityEntityLabel(t, log.resourceType)}
                      </p>
                    </div>
                    <time className="shrink-0 whitespace-nowrap text-xs tabular-nums text-muted-foreground">
                      {formatDateTime(log.createdAt, locale)}
                    </time>
                  </div>
                ))}
                {auditLogs.length === 0 && (
                  <p className="text-center text-muted-foreground py-4">
                    <T k="pageLabels.noRecentActivity" />
                  </p>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Pricing Tab */}
        <TabsContent value="pricing" className="space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">
              <T k="pageLabels.subscriptionPlans" />
            </h2>
            <Dialog open={newPlanDialogOpen} onOpenChange={setNewPlanDialogOpen}>
              <DialogTrigger asChild>
                <Button data-testid="button-add-plan">
                  <Plus className="w-4 h-4 me-2" />
                  <T k="pageLabels.addPlan" />
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-2xl">
                <DialogHeader>
                  <DialogTitle>
                    <T k="pageLabels.createNewPlan" />
                  </DialogTitle>
                  <DialogDescription>
                    <T k="pageLabels.addANewSubscriptionPlanForYourCustomers" />
                  </DialogDescription>
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
                  {t["admin.noSubscriptionPlansConfiguredAdd"]}
                </CardContent>
              </Card>
            ) : (
              plans.map((plan) => (
                <Card key={plan.id} className={!plan.isActive ? "opacity-60" : ""}>
                  <CardHeader>
                    <div className="flex items-center justify-between gap-2">
                      <CardTitle className="text-lg">{plan.name}</CardTitle>
                      <Badge variant={plan.isActive ? "default" : "secondary"}>
                        {plan.isActive ? "Active" : "Inactive"}
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
                        <span className="text-muted-foreground">
                          <T k="pageLabels.maxCompanies" />
                        </span>
                        <span>{plan.maxCompanies || "Unlimited"}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">
                          <T k="pageLabels.maxUsers" />
                        </span>
                        <span>{plan.maxUsers || t["adminConsole.unlimited"]}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">
                          {t["adminConsole.aiCreditsPerMonth"]}
                        </span>
                        <span>{plan.aiCreditsPerMonth}</span>
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
                      <Edit2 className="w-4 h-4 me-2" />
                      {t["firmOps.edit"]}
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
                <DialogTitle>
                  <T k="pageLabels.editPlan" />
                </DialogTitle>
                <DialogDescription>
                  <T k="pageLabels.modifySubscriptionPlanDetails" />
                </DialogDescription>
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
              <Search className="absolute start-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder={t["admin.searchUsers"]}
                className="ps-10"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                data-testid="input-search-users"
              />
            </div>
            <Select defaultValue="all">
              <SelectTrigger className="w-40" data-testid="select-user-filter">
                <SelectValue placeholder={t["admin.filterByStatus"]} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">
                  <T k="pageLabels.allUsers" />
                </SelectItem>
                <SelectItem value="active">
                  <T k="firm.linkActive" />
                </SelectItem>
                <SelectItem value="inactive">
                  <T k="pages.inactive" />
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t["adminConsole.colUser"]}</TableHead>
                    <TableHead>
                      <T k="hr.field.email" />
                    </TableHead>
                    <TableHead>
                      <T k="pages.companies" />
                    </TableHead>
                    <TableHead>
                      <T k="banking.common.status" />
                    </TableHead>
                    <TableHead>
                      <T k="pageLabels.joined" />
                    </TableHead>
                    <TableHead data-numeric>
                      <T k="banking.common.actions" />
                    </TableHead>
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
                        <T k="pageLabels.noUsersFound" />
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredUsers.map((user) => (
                      <TableRow key={user.id}>
                        <TableCell className="font-medium">{user.name}</TableCell>
                        <TableCell>{user.email}</TableCell>
                        <TableCell>
                          <Badge variant="outline">
                            {formatMessage(t["adminConsole.companiesCount"], {
                              count: companies.filter((c) => c.id).length,
                            })}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="bg-success-subtle text-success">
                            <T k="firm.linkActive" />
                          </Badge>
                        </TableCell>
                        <TableCell>{formatDate(user.createdAt, locale)}</TableCell>
                        <TableCell data-numeric>
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
                <DialogTitle>
                  <T k="pageLabels.editUser" />
                </DialogTitle>
                <DialogDescription>
                  <T k="pageLabels.updateUserInformation" />
                </DialogDescription>
              </DialogHeader>
              {editingUser && (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    const formData = new FormData(e.currentTarget);
                    updateUserMutation.mutate({
                      id: editingUser.id,
                      data: {
                        name: formData.get("name") as string,
                        email: formData.get("email") as string,
                        isAdmin: formData.get("isAdmin") === "on",
                      },
                    });
                  }}
                >
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="edit-user-name">{t["adminConsole.fieldName"]}</Label>
                      <Input
                        id="edit-user-name"
                        name="name"
                        defaultValue={editingUser.name}
                        required
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="edit-user-email">
                        <T k="hr.field.email" />
                      </Label>
                      <Input
                        id="edit-user-email"
                        name="email"
                        type="email"
                        defaultValue={editingUser.email}
                        required
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <Switch
                        id="edit-user-admin"
                        name="isAdmin"
                        defaultChecked={editingUser.isAdmin || false}
                      />
                      <Label htmlFor="edit-user-admin">
                        <T k="pageLabels.adminUser" />
                      </Label>
                    </div>
                  </div>
                  <DialogFooter className="mt-4">
                    <Button type="button" variant="outline" onClick={() => setEditingUser(null)}>
                      <T k="pages.cancel" />
                    </Button>
                    <Button type="submit" disabled={updateUserMutation.isPending}>
                      {updateUserMutation.isPending ? "Saving..." : t["pages.saveChanges"]}
                    </Button>
                  </DialogFooter>
                </form>
              )}
            </DialogContent>
          </Dialog>

          {/* Companies Table */}
          <h3 className="text-lg font-semibold mt-8">
            <T k="pages.companies" />
          </h3>
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>
                      <T k="pages.companyName" />
                    </TableHead>
                    <TableHead>{t["adminConsole.trnVat"]}</TableHead>
                    <TableHead>
                      <T k="banking.accounts.currency" />
                    </TableHead>
                    <TableHead>
                      <T k="pages.created" />
                    </TableHead>
                    <TableHead data-numeric>
                      <T k="banking.common.actions" />
                    </TableHead>
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
                        <T k="pageLabels.noCompaniesFound" />
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredCompanies.map((company) => (
                      <TableRow key={company.id}>
                        <TableCell className="font-medium">{company.name}</TableCell>
                        <TableCell>{company.trnVatNumber || "-"}</TableCell>
                        <TableCell>{company.baseCurrency}</TableCell>
                        <TableCell>{formatDate(company.createdAt, locale)}</TableCell>
                        <TableCell data-numeric>
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
                <DialogTitle>
                  <T k="pageLabels.editCompany" />
                </DialogTitle>
                <DialogDescription>
                  <T k="pageLabels.updateCompanyInformation" />
                </DialogDescription>
              </DialogHeader>
              {editingCompany && (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    const formData = new FormData(e.currentTarget);
                    updateCompanyMutation.mutate({
                      id: editingCompany.id,
                      data: {
                        name: formData.get("name") as string,
                        trnVatNumber: (formData.get("trnVatNumber") as string) || null,
                        baseCurrency: formData.get("baseCurrency") as string,
                      },
                    });
                  }}
                >
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="edit-company-name">
                        <T k="pages.companyName" />
                      </Label>
                      <Input
                        id="edit-company-name"
                        name="name"
                        defaultValue={editingCompany.name}
                        required
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="edit-company-trn">{t["adminConsole.trnVat"]}</Label>
                      <Input
                        id="edit-company-trn"
                        name="trnVatNumber"
                        defaultValue={editingCompany.trnVatNumber || ""}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="edit-company-currency">
                        <T k="pageLabels.baseCurrency" />
                      </Label>
                      <Select name="baseCurrency" defaultValue={editingCompany.baseCurrency}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="AED">
                            <T k="pageLabels.aEDUAEDirham" />
                          </SelectItem>
                          <SelectItem value="USD">
                            <T k="pageLabels.uSDUSDollar" />
                          </SelectItem>
                          <SelectItem value="EUR">
                            <T k="pageLabels.eUREuro" />
                          </SelectItem>
                          <SelectItem value="GBP">
                            <T k="pageLabels.gBPBritishPound" />
                          </SelectItem>
                          <SelectItem value="SAR">
                            <T k="pageLabels.sARSaudiRiyal" />
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <DialogFooter className="mt-4">
                    <Button type="button" variant="outline" onClick={() => setEditingCompany(null)}>
                      <T k="pages.cancel" />
                    </Button>
                    <Button type="submit" disabled={updateCompanyMutation.isPending}>
                      {updateCompanyMutation.isPending ? "Saving..." : t["pages.saveChanges"]}
                    </Button>
                  </DialogFooter>
                </form>
              )}
              {editingCompany && <AdminPlanControl companyId={editingCompany.id} />}
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
                  <CardTitle className="text-base">
                    <T k="pageLabels.featureToggles" />
                  </CardTitle>
                  <CardDescription>
                    <T k="pageLabels.enableOrDisablePlatformFeatures" />
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium">
                        <T k="pageLabels.aITransactionCategorization" />
                      </p>
                      <p className="text-sm text-muted-foreground">
                        <T k="pageLabels.useAIToAutomaticallyCategorizeTransactions" />
                      </p>
                    </div>
                    <Switch
                      checked={systemSettings.aiCategorization}
                      onCheckedChange={(checked) =>
                        setSystemSettings((prev) => ({ ...prev, aiCategorization: checked }))
                      }
                      data-testid="switch-ai-categorization"
                    />
                  </div>
                  <Separator />
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium">
                        <T k="pageLabels.oCRReceiptScanning" />
                      </p>
                      <p className="text-sm text-muted-foreground">
                        <T k="pageLabels.extractDataFromReceiptImages" />
                      </p>
                    </div>
                    <Switch
                      checked={systemSettings.ocrScanning}
                      onCheckedChange={(checked) =>
                        setSystemSettings((prev) => ({ ...prev, ocrScanning: checked }))
                      }
                      data-testid="switch-ocr-scanning"
                    />
                  </div>
                  <Separator />
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium">
                        <T k="pageLabels.smartAssistant" />
                      </p>
                      <p className="text-sm text-muted-foreground">
                        <T k="pageLabels.naturalLanguageFinancialQueries" />
                      </p>
                    </div>
                    <Switch
                      checked={systemSettings.smartAssistant}
                      onCheckedChange={(checked) =>
                        setSystemSettings((prev) => ({ ...prev, smartAssistant: checked }))
                      }
                      data-testid="switch-smart-assistant"
                    />
                  </div>
                  <Separator />
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium">
                        <T k="pageLabels.referralProgram" />
                      </p>
                      <p className="text-sm text-muted-foreground">
                        <T k="pageLabels.enableUserReferralRewards" />
                      </p>
                    </div>
                    <Switch
                      checked={systemSettings.referralProgram}
                      onCheckedChange={(checked) =>
                        setSystemSettings((prev) => ({ ...prev, referralProgram: checked }))
                      }
                      data-testid="switch-referral-program"
                    />
                  </div>
                </CardContent>
              </Card>

              {/* System Settings */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">
                    <T k="pageLabels.systemSettings" />
                  </CardTitle>
                  <CardDescription>
                    <T k="pageLabels.configurePlatformWideSettings" />
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>
                        <T k="pageLabels.defaultCurrency" />
                      </Label>
                      <Select
                        value={systemSettings.defaultCurrency}
                        onValueChange={(value) =>
                          setSystemSettings((prev) => ({ ...prev, defaultCurrency: value }))
                        }
                      >
                        <SelectTrigger data-testid="select-default-currency">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="AED">{t["adminConsole.curAED"]}</SelectItem>
                          <SelectItem value="USD">{t["adminConsole.curUSD"]}</SelectItem>
                          <SelectItem value="EUR">{t["adminConsole.curEUR"]}</SelectItem>
                          <SelectItem value="GBP">{t["adminConsole.curGBP"]}</SelectItem>
                          <SelectItem value="SAR">{t["adminConsole.curSAR"]}</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>{t["adminConsole.defaultVatRate"]}</Label>
                      <Input
                        type="number"
                        value={systemSettings.defaultVatRate}
                        onChange={(e) =>
                          setSystemSettings((prev) => ({ ...prev, defaultVatRate: e.target.value }))
                        }
                        data-testid="input-vat-rate"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>
                        <T k="pageLabels.aICreditsPerFreeUser" />
                      </Label>
                      <Input
                        type="number"
                        value={systemSettings.freeAiCredits}
                        onChange={(e) =>
                          setSystemSettings((prev) => ({ ...prev, freeAiCredits: e.target.value }))
                        }
                        data-testid="input-free-ai-credits"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>{t["adminConsole.trialPeriodDays"]}</Label>
                      <Input
                        type="number"
                        value={systemSettings.trialPeriod}
                        onChange={(e) =>
                          setSystemSettings((prev) => ({ ...prev, trialPeriod: e.target.value }))
                        }
                        data-testid="input-trial-period"
                      />
                    </div>
                  </div>
                  <Button
                    className="mt-4"
                    data-testid="button-save-system-settings"
                    onClick={() => saveSystemSettingsMutation.mutate(systemSettings)}
                    disabled={saveSystemSettingsMutation.isPending}
                  >
                    {saveSystemSettingsMutation.isPending ? (
                      <>
                        <Loader2 className="w-4 h-4 me-2 animate-spin" />
                        <T k="pageLabels.saving" />
                      </>
                    ) : (
                      <>
                        <Save className="w-4 h-4 me-2" />
                        <T k="pageLabels.saveSettings" />
                      </>
                    )}
                  </Button>
                </CardContent>
              </Card>

              {/* Email/Notification Settings */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">
                    <T k="pageLabels.notificationSettings" />
                  </CardTitle>
                  <CardDescription>
                    <T k="pageLabels.configureEmailAndNotificationPreferences" />
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label>
                      <T k="pageLabels.supportEmail" />
                    </Label>
                    <Input
                      type="email"
                      placeholder="support@muhasib.ai"
                      value={systemSettings.supportEmail}
                      onChange={(e) =>
                        setSystemSettings((prev) => ({ ...prev, supportEmail: e.target.value }))
                      }
                      data-testid="input-support-email"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>{t["adminConsole.fromEmail"]}</Label>
                    <Input
                      type="email"
                      placeholder="noreply@muhasib.ai"
                      value={systemSettings.fromEmail}
                      onChange={(e) =>
                        setSystemSettings((prev) => ({ ...prev, fromEmail: e.target.value }))
                      }
                      data-testid="input-from-email"
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium">
                        <T k="pageLabels.sendWelcomeEmail" />
                      </p>
                      <p className="text-sm text-muted-foreground">
                        <T k="pageLabels.emailNewUsersUponRegistration" />
                      </p>
                    </div>
                    <Switch
                      checked={systemSettings.sendWelcomeEmail}
                      onCheckedChange={(checked) =>
                        setSystemSettings((prev) => ({ ...prev, sendWelcomeEmail: checked }))
                      }
                      data-testid="switch-welcome-email"
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium">
                        <T k="pageLabels.paymentReminderEmails" />
                      </p>
                      <p className="text-sm text-muted-foreground">
                        <T k="pageLabels.sendLatePaymentReminders" />
                      </p>
                    </div>
                    <Switch
                      checked={systemSettings.paymentReminders}
                      onCheckedChange={(checked) =>
                        setSystemSettings((prev) => ({ ...prev, paymentReminders: checked }))
                      }
                      data-testid="switch-payment-reminders"
                    />
                  </div>
                  <Button
                    className="mt-4"
                    onClick={() => saveSystemSettingsMutation.mutate(systemSettings)}
                    disabled={saveSystemSettingsMutation.isPending}
                  >
                    {saveSystemSettingsMutation.isPending ? (
                      <>
                        <Loader2 className="w-4 h-4 me-2 animate-spin" />
                        <T k="pageLabels.saving" />
                      </>
                    ) : (
                      <>
                        <Save className="w-4 h-4 me-2" />
                        <T k="pageLabels.saveNotificationSettings" />
                      </>
                    )}
                  </Button>
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
                  <T k="pageLabels.stripeIntegration" />
                </CardTitle>
                <CardDescription>
                  <T k="pageLabels.paymentProcessingAndSubscriptionBilling" />
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm">
                    <T k="banking.common.status" />
                  </span>
                  <Badge variant="outline" className="bg-warning-subtle text-warning">
                    <T k="pageLabels.notConfigured" />
                  </Badge>
                </div>
                <div className="space-y-2">
                  <Label>
                    <T k="pageLabels.stripePublicKey" />
                  </Label>
                  <Input
                    type="password"
                    placeholder="pk_live_..."
                    data-testid="input-stripe-public"
                  />
                </div>
                <div className="space-y-2">
                  <Label>
                    <T k="pageLabels.stripeSecretKey" />
                  </Label>
                  <Input
                    type="password"
                    placeholder="sk_live_..."
                    data-testid="input-stripe-secret"
                  />
                </div>
                <Button className="w-full" data-testid="button-save-stripe">
                  <Save className="w-4 h-4 me-2" />
                  <T k="pageLabels.saveConfiguration" />
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <div className="w-8 h-8 bg-black rounded flex items-center justify-center">
                    <Activity className="w-4 h-4 text-white" />
                  </div>
                  <T k="pageLabels.openAIIntegration" />
                </CardTitle>
                <CardDescription>
                  <T k="pageLabels.aIPoweredFeaturesAndCategorization" />
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm">
                    <T k="banking.common.status" />
                  </span>
                  <Badge variant="outline" className="bg-success-subtle text-success">
                    <T k="pages.connected" />
                  </Badge>
                </div>
                <div className="space-y-2">
                  <Label>
                    <T k="pageLabels.aPIKey" />
                  </Label>
                  <Input type="password" placeholder="sk-..." data-testid="input-openai-key" />
                </div>
                <div className="space-y-2">
                  <Label>
                    <T k="pageLabels.model" />
                  </Label>
                  <Select defaultValue="gpt-4o">
                    <SelectTrigger data-testid="select-openai-model">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="gpt-4o">{t["adminConsole.modelRecommended"]}</SelectItem>
                      <SelectItem value="gpt-4-turbo">
                        <span translate="no">GPT-4 Turbo</span>
                      </SelectItem>
                      <SelectItem value="gpt-3.5-turbo">
                        <span translate="no">GPT-3.5 Turbo</span>
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <Button className="w-full" data-testid="button-save-openai">
                  <Save className="w-4 h-4 me-2" />
                  <T k="pageLabels.saveConfiguration" />
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <div className="w-8 h-8 bg-[#34A853] rounded flex items-center justify-center">
                    <FileText className="w-4 h-4 text-white" />
                  </div>
                  <T k="pageLabels.googleSheets" />
                </CardTitle>
                <CardDescription>
                  <T k="pageLabels.exportDataToGoogleSheets" />
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm">
                    <T k="banking.common.status" />
                  </span>
                  <Badge variant="outline" className="bg-success-subtle text-success">
                    <T k="pages.connected" />
                  </Badge>
                </div>
                <p className="text-sm text-muted-foreground">
                  <T k="pageLabels.googleSheetsIntegrationIsConfiguredAndReadyToUse" />
                </p>
                <Button variant="outline" className="w-full" data-testid="button-test-sheets">
                  <RefreshCw className="w-4 h-4 me-2" />
                  <T k="pageLabels.testConnection" />
                </Button>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Audit Log Tab */}
        <TabsContent value="audit" className="space-y-6">
          <div className="flex items-center gap-4">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute start-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder={t["admin.searchAuditLogs"]}
                className="ps-10"
                data-testid="input-search-audit"
              />
            </div>
            <Select defaultValue="all">
              <SelectTrigger className="w-40" data-testid="select-audit-filter">
                <SelectValue placeholder={t["admin.filterByAction"]} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">
                  <T k="pages.allActions" />
                </SelectItem>
                <SelectItem value="create">
                  <T k="hr.create" />
                </SelectItem>
                <SelectItem value="update">
                  <T k="pages.update" />
                </SelectItem>
                <SelectItem value="delete">
                  <T k="hr.delete" />
                </SelectItem>
                <SelectItem value="login">
                  <T k="pages.login" />
                </SelectItem>
              </SelectContent>
            </Select>
            <Button variant="outline" data-testid="button-export-audit">
              <Download className="w-4 h-4 me-2" />
              <T k="pages.export" />
            </Button>
          </div>

          <Card>
            <CardContent className="p-0">
              <ScrollArea className="h-[500px]">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>
                        <T k="pageLabels.timestamp" />
                      </TableHead>
                      <TableHead>
                        <T k="pages.action" />
                      </TableHead>
                      <TableHead>
                        <T k="pageLabels.resource" />
                      </TableHead>
                      <TableHead>{t["settingsPages.auditUser"]}</TableHead>
                      <TableHead>
                        <T k="reportCenter.details" />
                      </TableHead>
                      <TableHead>
                        <T k="pageLabels.iPAddress" />
                      </TableHead>
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
                          <T k="pageLabels.noAuditLogsFound" />
                        </TableCell>
                      </TableRow>
                    ) : (
                      auditLogs.map((log) => {
                        const entries = auditDetailEntries(log.details);
                        const open = expandedLog === log.id;
                        const actor = log.userId ? users.find((u) => u.id === log.userId) : null;
                        return (
                          <Fragment key={log.id}>
                            <TableRow>
                              <TableCell className="whitespace-nowrap text-sm tabular-nums">
                                {formatDateTime(log.createdAt, locale)}
                              </TableCell>
                              <TableCell>
                                <Badge variant="secondary">
                                  {activityActionLabel(t, log.action)}
                                </Badge>
                              </TableCell>
                              <TableCell>{activityEntityLabel(t, log.resourceType)}</TableCell>
                              <TableCell dir="auto">
                                {log.userId
                                  ? (actor?.name ??
                                    actor?.email ??
                                    t["settingsPages.auditUnknownUser"])
                                  : t["shell.themeSystem"]}
                              </TableCell>
                              <TableCell>
                                {entries.length === 0 ? (
                                  <span className="text-muted-foreground">—</span>
                                ) : (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    aria-expanded={open}
                                    onClick={() => setExpandedLog(open ? null : log.id)}
                                    data-testid={`button-audit-details-${log.id}`}
                                  >
                                    {open
                                      ? t["settingsPages.auditHide"]
                                      : t["settingsPages.auditShow"]}
                                  </Button>
                                )}
                              </TableCell>
                              <TableCell className="text-muted-foreground" dir="ltr">
                                {log.ipAddress || "—"}
                              </TableCell>
                            </TableRow>
                            {open && (
                              <TableRow data-testid={`audit-details-${log.id}`}>
                                <TableCell colSpan={6} className="bg-surface-sunken">
                                  <dl className="grid grid-cols-[minmax(8rem,auto)_1fr] gap-x-6 gap-y-1 text-small">
                                    {entries.map((e, i) => (
                                      <Fragment key={`${e.key}-${i}`}>
                                        <dt className="text-muted-foreground">{e.key || "—"}</dt>
                                        <dd className="break-all" dir="auto">
                                          {e.value}
                                        </dd>
                                      </Fragment>
                                    ))}
                                  </dl>
                                </TableCell>
                              </TableRow>
                            )}
                          </Fragment>
                        );
                      })
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
  isPending,
}: {
  initialData?: SubscriptionPlan;
  onSubmit: (data: Partial<SubscriptionPlan>) => void;
  isPending: boolean;
}) {
  const { t } = useTranslation();
  const [formData, setFormData] = useState<Partial<SubscriptionPlan>>(
    initialData || {
      name: "",
      description: "",
      priceMonthly: 0,
      priceYearly: 0,
      currency: "AED",
      maxCompanies: 1,
      maxUsers: 1,
      aiCreditsPerMonth: 100,
      hasWhatsappIntegration: false,
      hasAdvancedReports: false,
      hasApiAccess: false,
      isActive: true,
    }
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(formData);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="name">
            <T k="pageLabels.planName" />
          </Label>
          <Input
            id="name"
            value={formData.name || ""}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            required
            data-testid="input-plan-name"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="currency">
            <T k="banking.accounts.currency" />
          </Label>
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
        <Label htmlFor="description">
          <T k="banking.common.description" />
        </Label>
        <Textarea
          id="description"
          value={formData.description || ""}
          onChange={(e) => setFormData({ ...formData, description: e.target.value })}
          data-testid="input-plan-description"
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="priceMonthly">
            <T k="pageLabels.monthlyPrice" />
          </Label>
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
          <Label htmlFor="priceYearly">
            <T k="pageLabels.yearlyPrice" />
          </Label>
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
          <Label htmlFor="maxCompanies">
            <T k="pageLabels.maxCompanies" />
          </Label>
          <Input
            id="maxCompanies"
            type="number"
            value={formData.maxCompanies || 1}
            onChange={(e) => setFormData({ ...formData, maxCompanies: parseInt(e.target.value) })}
            data-testid="input-max-companies"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="maxUsers">
            <T k="pageLabels.maxUsers" />
          </Label>
          <Input
            id="maxUsers"
            type="number"
            value={formData.maxUsers || 1}
            onChange={(e) => setFormData({ ...formData, maxUsers: parseInt(e.target.value) })}
            data-testid="input-max-users"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="aiCredits">{t["adminConsole.aiCreditsPerMonth"]}</Label>
          <Input
            id="aiCredits"
            type="number"
            value={formData.aiCreditsPerMonth || 100}
            onChange={(e) =>
              setFormData({ ...formData, aiCreditsPerMonth: parseInt(e.target.value) })
            }
            data-testid="input-ai-credits"
          />
        </div>
      </div>

      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <Label>
            <T k="pageLabels.advancedReports" />
          </Label>
          <Switch
            checked={formData.hasAdvancedReports || false}
            onCheckedChange={(checked) => setFormData({ ...formData, hasAdvancedReports: checked })}
            data-testid="switch-plan-reports"
          />
        </div>
        <div className="flex items-center justify-between">
          <Label>
            <T k="pageLabels.aPIAccess" />
          </Label>
          <Switch
            checked={formData.hasApiAccess || false}
            onCheckedChange={(checked) => setFormData({ ...formData, hasApiAccess: checked })}
            data-testid="switch-plan-api"
          />
        </div>
        <div className="flex items-center justify-between">
          <Label>
            <T k="firm.linkActive" />
          </Label>
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
            <Loader2 className="w-4 h-4 me-2 animate-spin" />
          ) : (
            <Save className="w-4 h-4 me-2" />
          )}
          {t["adminConsole.savePlan"]}
        </Button>
      </DialogFooter>
    </form>
  );
}
