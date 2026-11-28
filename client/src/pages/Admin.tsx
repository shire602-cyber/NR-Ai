import { AdminPlanControl } from "@/components/billing/AdminPlanControl";
import { AdminTrialsCard } from "@/components/billing/AdminTrialsCard";
import { T } from "@/components/layout/T";
import { StatCard } from "@/components/ui/stat-card";
import { activityActionLabel, activityEntityLabel } from "@/lib/activity-log-labels";
import { useTranslation, formatMessage } from "@/lib/i18n";
import { PageHeader } from "@/components/ui/page-header";
import { Fragment, useState } from "react";
import { formatDate, formatDateTime } from "@/lib/format-date";
import { auditDetailEntries } from "@/pages/admin/audit-details";
import { IntegrationsTab } from "@/pages/admin/IntegrationsTab";
import { auditExportRows, filterAuditLogs } from "@/pages/admin/audit-export";
import { useQuery, useMutation, useIsFetching } from "@tanstack/react-query";
import {
  Users,
  Shield,
  Plug,
  Edit2,
  RefreshCw,
  Search,
  Download,
  BarChart3,
  Loader2,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
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
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { exportToExcel } from "@/lib/export";
import type { User, Company, AuditLog } from "@shared/schema";

/** `/api/admin/users` row: the user plus the number of live companies they belong to. */
type AdminUserRow = User & { companyCount: number };

export default function Admin() {
  const { t, locale } = useTranslation();
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState("overview");
  const [searchTerm, setSearchTerm] = useState("");
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [editingCompany, setEditingCompany] = useState<Company | null>(null);

  const { data: users = [], isLoading: usersLoading } = useQuery<AdminUserRow[]>({
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
    activeCompanies?: number;
    totalInvoices: number;
    totalReceipts: number;
    aiCreditsUsed: number;
  }>({
    queryKey: ["/api/admin/stats"],
  });

  // Mutations
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
          rtl: locale === "ar",
          columns: [
            { header: t["admin.export.name"], key: "name", width: 28 },
            { header: t["admin.export.email"], key: "email", width: 32 },
            { header: t["admin.export.type"], key: "type", width: 14 },
            { header: t["admin.export.created"], key: "created", width: 16 },
          ],
          rows: users.map((u) => ({
            name: u.name,
            email: u.email,
            type:
              u.userType === "client"
                ? t["adminConsole.userTypeClient"]
                : u.userType === "customer"
                  ? t["adminConsole.userTypeCustomer"]
                  : u.userType,
            created: formatDate(u.createdAt, locale),
          })),
        },
        {
          sheetName: t["admin.export.companiesSheet"],
          rtl: locale === "ar",
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

  // Audit tab: search, action filter and export all work on the localised rows.
  const [auditSearch, setAuditSearch] = useState("");
  const [auditAction, setAuditAction] = useState("all");
  const shownAuditLogs = filterAuditLogs(t, auditLogs, users, {
    search: auditSearch,
    action: auditAction,
  });
  const exportAuditLogs = () =>
    exportToExcel(
      [
        {
          sheetName: t["admin.export.auditSheet"],
          rtl: locale === "ar",
          columns: [
            { header: t["pageLabels.timestamp"], key: "date", width: 22 },
            { header: t["pages.action"], key: "action", width: 30 },
            { header: t["pageLabels.resource"], key: "resource", width: 22 },
            { header: t["settingsPages.auditUser"], key: "user", width: 28 },
            { header: t["reportCenter.details"], key: "details", width: 50 },
            { header: t["pageLabels.iPAddress"], key: "ip", width: 16 },
          ],
          rows: auditExportRows(t, shownAuditLogs, users, locale),
        },
      ],
      "audit-log"
    );
  // Visible feedback while the admin queries re-read (STEP1 F6).
  const refreshing =
    useIsFetching({ predicate: (q) => /^\/api\/admin\//.test(String(q.queryKey[0])) }) > 0;

  // Filter functions
  const filteredUsers = users.filter(
    (user) =>
      user.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      user.email.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const filteredCompanies = companies.filter((company) =>
    company.name.toLowerCase().includes(searchTerm.toLowerCase())
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
              onClick={() => {
                for (const key of [
                  "/api/admin/users",
                  "/api/admin/companies",
                  "/api/admin/audit-logs",
                  "/api/admin/stats",
                ]) {
                  void queryClient.invalidateQueries({ queryKey: [key] });
                }
              }}
              disabled={refreshing}
              aria-busy={refreshing}
              data-testid="button-refresh"
            >
              <RefreshCw className={`w-4 h-4 me-2 ${refreshing ? "animate-spin" : ""}`} />
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
          <TabsTrigger value="users" data-testid="tab-users">
            <Users className="w-4 h-4 me-2" />
            <T k="pages.users" />
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
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <StatCard
              label={<T k="pageLabels.totalUsers" />}
              value={stats?.totalUsers || 0}
              testId="stat-total-users"
            />
            <StatCard
              label={<T k="pageLabels.activeCompanies" />}
              value={stats?.activeCompanies ?? stats?.totalCompanies ?? 0}
              testId="stat-total-companies"
            />
            <StatCard
              label={<T k="pageLabels.aICreditsUsed" />}
              value={stats?.aiCreditsUsed || 0}
              hint={<T k="pages.thisMonth" />}
              testId="stat-ai-credits"
            />
          </div>

          {/* STEP4: trials, the plan each customer chose and activation requests. */}
          <AdminTrialsCard
            onOpen={(companyId) => {
              const company = companies.find((c) => c.id === companyId);
              if (!company) return;
              setActiveTab("users");
              setEditingCompany(company);
            }}
          />

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
                      <TableCell colSpan={5} className="text-center py-8">
                        <Loader2 className="w-6 h-6 animate-spin mx-auto" />
                      </TableCell>
                    </TableRow>
                  ) : filteredUsers.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
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
                              count: user.companyCount,
                            })}
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
                      {updateUserMutation.isPending
                        ? t["pageLabels.saving"]
                        : t["pages.saveChanges"]}
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
                      {updateCompanyMutation.isPending
                        ? t["pageLabels.saving"]
                        : t["pages.saveChanges"]}
                    </Button>
                  </DialogFooter>
                </form>
              )}
              {editingCompany && <AdminPlanControl companyId={editingCompany.id} />}
            </DialogContent>
          </Dialog>
        </TabsContent>

        {/* Integrations Tab (STEP1 F6: status from the server; no do-nothing buttons) */}
        <TabsContent value="integrations" className="space-y-6">
          <IntegrationsTab />
        </TabsContent>

        {/* Audit Log Tab */}
        <TabsContent value="audit" className="space-y-6">
          <div className="flex flex-wrap items-center gap-3 sm:gap-4">
            <div className="relative min-w-0 flex-1 basis-56 max-w-md">
              <Search className="absolute start-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder={t["admin.searchAuditLogs"]}
                className="ps-10"
                value={auditSearch}
                onChange={(e) => setAuditSearch(e.target.value)}
                data-testid="input-search-audit"
              />
            </div>
            <Select value={auditAction} onValueChange={setAuditAction}>
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
            <Button
              variant="outline"
              onClick={() => void exportAuditLogs()}
              disabled={shownAuditLogs.length === 0}
              data-testid="button-export-audit"
            >
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
                    ) : shownAuditLogs.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                          <T k="pageLabels.noAuditLogsFound" />
                        </TableCell>
                      </TableRow>
                    ) : (
                      shownAuditLogs.map((log) => {
                        const entries = auditDetailEntries(log.details, t);
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
