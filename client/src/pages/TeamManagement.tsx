import { PageHeader } from "@/components/ui/page-header";
import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
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
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { useTranslation } from "@/lib/i18n";
import { useToast } from "@/hooks/use-toast";
import { useDefaultCompany } from "@/hooks/useDefaultCompany";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  UserPlus,
  Users,
  Shield,
  Crown,
  Calculator,
  Briefcase,
  User,
  Mail,
  Trash2,
  Edit,
  Check,
  X,
  Loader2,
  Settings,
  Eye,
  FileText,
  Receipt,
  BarChart3,
  Building2,
} from "lucide-react";
import { messages as pageMessages } from "./TeamManagement.i18n";

interface TeamMember {
  id: string;
  userId: string;
  companyId: string;
  role: string;
  createdAt: string;
  user: {
    id: string;
    email: string;
    name: string;
  };
}

interface RolePermission {
  key: string;
  label: string;
  labelAr: string;
  icon: React.ReactNode;
  roles: string[];
}

const getRolePermissions = (): RolePermission[] => [
  {
    key: "view_dashboard",
    label: pageMessages.t("viewDashboard"),
    labelAr: "عرض لوحة التحكم",
    icon: <BarChart3 className="w-4 h-4" />,
    roles: ["owner", "cfo", "accountant", "employee"],
  },
  {
    key: "manage_invoices",
    label: pageMessages.t("manageInvoices"),
    labelAr: "إدارة الفواتير",
    icon: <FileText className="w-4 h-4" />,
    roles: ["owner", "cfo", "accountant"],
  },
  {
    key: "manage_expenses",
    label: pageMessages.t("manageExpenses"),
    labelAr: "إدارة المصروفات",
    icon: <Receipt className="w-4 h-4" />,
    roles: ["owner", "cfo", "accountant", "employee"],
  },
  {
    key: "post_journal",
    label: pageMessages.t("postJournalEntries"),
    labelAr: "ترحيل القيود",
    icon: <Calculator className="w-4 h-4" />,
    roles: ["owner", "cfo", "accountant"],
  },
  {
    key: "view_reports",
    label: pageMessages.t("viewFinancialReports"),
    labelAr: "عرض التقارير المالية",
    icon: <BarChart3 className="w-4 h-4" />,
    roles: ["owner", "cfo", "accountant"],
  },
  {
    key: "manage_vat",
    label: pageMessages.t("manageVatReturns"),
    labelAr: "إدارة إقرارات الضريبة",
    icon: <FileText className="w-4 h-4" />,
    roles: ["owner", "cfo", "accountant"],
  },
  {
    key: "manage_team",
    label: pageMessages.t("manageTeamMembers"),
    labelAr: "إدارة فريق العمل",
    icon: <Users className="w-4 h-4" />,
    roles: ["owner"],
  },
  {
    key: "company_settings",
    label: pageMessages.t("companySettings"),
    labelAr: "إعدادات الشركة",
    icon: <Settings className="w-4 h-4" />,
    roles: ["owner"],
  },
];

const getRoles = () => [
  {
    value: "owner",
    label: pageMessages.t("owner"),
    labelAr: "مالك",
    description: pageMessages.t("fullAccessToAllFeatures"),
    icon: <Crown className="w-4 h-4" />,
  },
  {
    value: "cfo",
    label: pageMessages.t("cfo"),
    labelAr: "المدير المالي",
    description: pageMessages.t("financialOversightAndReporting"),
    icon: <Briefcase className="w-4 h-4" />,
  },
  {
    value: "accountant",
    label: pageMessages.t("accountant"),
    labelAr: "محاسب",
    description: pageMessages.t("dayToDayBookkeeping"),
    icon: <Calculator className="w-4 h-4" />,
  },
  {
    value: "employee",
    label: pageMessages.t("employee"),
    labelAr: "موظف",
    description: pageMessages.t("submitExpensesOnly"),
    icon: <User className="w-4 h-4" />,
  },
];

export default function TeamManagement() {
  const tr = pageMessages.useT();

  const { t, locale } = useTranslation();
  const { toast } = useToast();
  const { companyId, isLoading: isLoadingCompany } = useDefaultCompany();
  const [inviteDialogOpen, setInviteDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [permissionsDialogOpen, setPermissionsDialogOpen] = useState(false);
  const [selectedMember, setSelectedMember] = useState<TeamMember | null>(null);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("accountant");
  const [newRole, setNewRole] = useState("");

  const { data: teamMembers, isLoading: isLoadingTeam } = useQuery<TeamMember[]>({
    queryKey: ["/api/companies", companyId, "team"],
    enabled: !!companyId,
  });

  const inviteMutation = useMutation({
    mutationFn: ({ email, role }: { email: string; role: string }) =>
      apiRequest("POST", `/api/companies/${companyId}/team/invite`, { email, role }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/companies", companyId, "team"] });
      toast({
        title: tr("invitationSent"),
        description: tr("anInvitationHasBeenSentTo", { inviteEmail }),
      });
      setInviteDialogOpen(false);
      setInviteEmail("");
      setInviteRole("accountant");
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: tr("invitationFailed"),
        description: error?.message || tr("failedToSendInvitation"),
      });
    },
  });

  const updateRoleMutation = useMutation({
    mutationFn: ({ memberId, role }: { memberId: string; role: string }) =>
      apiRequest("PUT", `/api/companies/${companyId}/team/${memberId}`, { role }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/companies", companyId, "team"] });
      toast({
        title: tr("roleUpdated"),
        description: tr("teamMemberRoleHasBeenUpdated"),
      });
      setEditDialogOpen(false);
      setSelectedMember(null);
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: tr("updateFailed"),
        description: error?.message || tr("failedToUpdateRole"),
      });
    },
  });

  const removeMemberMutation = useMutation({
    mutationFn: (memberId: string) =>
      apiRequest("DELETE", `/api/companies/${companyId}/team/${memberId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/companies", companyId, "team"] });
      toast({
        title: tr("memberRemoved"),
        description: tr("teamMemberHasBeenRemovedFrom"),
      });
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: tr("removalFailed"),
        description: error?.message || tr("failedToRemoveMember"),
      });
    },
  });

  const stats = useMemo(() => {
    if (!teamMembers) return { total: 0, owners: 0, accountants: 0, employees: 0 };

    return {
      total: teamMembers.length,
      owners: teamMembers.filter((m) => m.role === "owner").length,
      accountants: teamMembers.filter((m) => m.role === "accountant" || m.role === "cfo").length,
      employees: teamMembers.filter((m) => m.role === "employee").length,
    };
  }, [teamMembers]);

  const getRoleBadge = (role: string) => {
    const roleInfo = getRoles().find((r) => r.value === role);
    const colors: Record<string, string> = {
      owner: "bg-chart-5/10 text-chart-5",
      cfo: "bg-info-subtle text-info-subtle-foreground",
      accountant: "bg-success-subtle text-success-subtle-foreground",
      employee: "bg-muted text-foreground",
    };

    return (
      <Badge variant="secondary" className={colors[role] || ""}>
        {roleInfo?.icon}
        <span className="ms-1">{locale === "ar" ? roleInfo?.labelAr : roleInfo?.label}</span>
      </Badge>
    );
  };

  const getInitials = (name: string) => {
    return name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);
  };

  const handleEditMember = (member: TeamMember) => {
    setSelectedMember(member);
    setNewRole(member.role);
    setEditDialogOpen(true);
  };

  const handleUpdateRole = () => {
    if (!selectedMember || !newRole) return;
    updateRoleMutation.mutate({
      memberId: selectedMember.id,
      role: newRole,
    });
  };

  const [memberToRemove, setMemberToRemove] = useState<TeamMember | null>(null);

  const handleRemoveMember = (member: TeamMember) => {
    if (member.role === "owner") {
      toast({
        variant: "destructive",
        title: tr("cannotRemoveOwner"),
        description: tr("theCompanyOwnerCannotBeRemoved"),
      });
      return;
    }
    setMemberToRemove(member);
  };

  if (isLoadingCompany) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-64" />
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
        <Skeleton className="h-96" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={tr("settings")}
        title={tr("teamManagement")}
        description={tr("manageTeamMembersAndTheirAccess")}
        actions={
          <>
            <Button
              variant="outline"
              onClick={() => setPermissionsDialogOpen(true)}
              data-testid="button-view-permissions"
            >
              <Shield className="w-4 h-4 me-2" />
              {tr("permissions")}
            </Button>
            <Button onClick={() => setInviteDialogOpen(true)} data-testid="button-invite-member">
              <UserPlus className="w-4 h-4 me-2" />
              {tr("inviteMember")}
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {tr("totalMembers")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.total}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {tr("owners")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-chart-5">{stats.owners}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {tr("accountantsCfos")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-success">{stats.accountants}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {tr("employees")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-muted-foreground">{stats.employees}</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{tr("teamMembers")}</CardTitle>
          <CardDescription>{tr("allMembersWhoHaveAccessTo")}</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoadingTeam ? (
            <div className="space-y-4">
              {[1, 2, 3].map((i) => (
                <div key={i} className="flex items-center gap-4">
                  <Skeleton className="h-10 w-10 rounded-full" />
                  <div className="flex-1">
                    <Skeleton className="h-4 w-32 mb-2" />
                    <Skeleton className="h-3 w-48" />
                  </div>
                </div>
              ))}
            </div>
          ) : !teamMembers || teamMembers.length === 0 ? (
            <div className="text-center py-12">
              <Users className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
              <p className="text-muted-foreground">{tr("noOtherTeamMembersInviteYour")}</p>
            </div>
          ) : (
            <div className="space-y-4">
              {teamMembers.map((member) => (
                <div
                  key={member.id}
                  className="flex items-center justify-between p-4 border rounded-lg"
                  data-testid={`member-${member.id}`}
                >
                  <div className="flex items-center gap-4">
                    <Avatar>
                      <AvatarFallback>{getInitials(member.user.name)}</AvatarFallback>
                    </Avatar>
                    <div>
                      <p className="font-medium">{member.user.name}</p>
                      <p className="text-sm text-muted-foreground">{member.user.email}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    {getRoleBadge(member.role)}
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleEditMember(member)}
                        disabled={member.role === "owner"}
                        data-testid={`button-edit-${member.id}`}
                      >
                        <Edit className="w-4 h-4" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleRemoveMember(member)}
                        disabled={member.role === "owner"}
                        className="text-destructive hover:text-destructive"
                        data-testid={`button-remove-${member.id}`}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={inviteDialogOpen} onOpenChange={setInviteDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{tr("inviteTeamMember")}</DialogTitle>
            <DialogDescription>{tr("sendAnInvitationToJoinYour")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>{tr("emailAddress")}</Label>
              <Input
                type="email"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="colleague@company.com"
                data-testid="input-invite-email"
              />
            </div>
            <div className="space-y-2">
              <Label>{tr("role")}</Label>
              <Select value={inviteRole} onValueChange={setInviteRole}>
                <SelectTrigger data-testid="select-invite-role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {getRoles()
                    .filter((r) => r.value !== "owner")
                    .map((role) => (
                      <SelectItem key={role.value} value={role.value}>
                        <div className="flex items-center gap-2">
                          {role.icon}
                          <div>
                            <p>{locale === "ar" ? role.labelAr : role.label}</p>
                            <p className="text-xs text-muted-foreground">{role.description}</p>
                          </div>
                        </div>
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setInviteDialogOpen(false)}>
              {tr("cancel")}
            </Button>
            <Button
              onClick={() => inviteMutation.mutate({ email: inviteEmail, role: inviteRole })}
              disabled={inviteMutation.isPending || !inviteEmail}
              data-testid="button-confirm-invite"
            >
              {inviteMutation.isPending && <Loader2 className="w-4 h-4 me-2 animate-spin" />}
              <Mail className="w-4 h-4 me-2" />
              {tr("sendInvite")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{tr("editRole")}</DialogTitle>
            <DialogDescription>
              {selectedMember && (
                <span>
                  {tr("changeRoleFor")} {selectedMember.user.name}
                </span>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>{tr("newRole")}</Label>
              <Select value={newRole} onValueChange={setNewRole}>
                <SelectTrigger data-testid="select-new-role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {getRoles()
                    .filter((r) => r.value !== "owner")
                    .map((role) => (
                      <SelectItem key={role.value} value={role.value}>
                        <div className="flex items-center gap-2">
                          {role.icon}
                          <span>{locale === "ar" ? role.labelAr : role.label}</span>
                        </div>
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditDialogOpen(false)}>
              {tr("cancel")}
            </Button>
            <Button
              onClick={handleUpdateRole}
              disabled={updateRoleMutation.isPending}
              data-testid="button-confirm-update"
            >
              {updateRoleMutation.isPending && <Loader2 className="w-4 h-4 me-2 animate-spin" />}
              {tr("updateRole")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={permissionsDialogOpen} onOpenChange={setPermissionsDialogOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{tr("permissionsMatrix")}</DialogTitle>
            <DialogDescription>{tr("availablePermissionsForEachRole")}</DialogDescription>
          </DialogHeader>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{tr("permission")}</TableHead>
                  {getRoles().map((role) => (
                    <TableHead key={role.value} className="text-center">
                      {locale === "ar" ? role.labelAr : role.label}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {getRolePermissions().map((permission) => (
                  <TableRow key={permission.key}>
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-2">
                        {permission.icon}
                        {locale === "ar" ? permission.labelAr : permission.label}
                      </div>
                    </TableCell>
                    {getRoles().map((role) => (
                      <TableCell key={role.value} className="text-center">
                        {permission.roles.includes(role.value) ? (
                          <Check className="w-4 h-4 mx-auto text-success" />
                        ) : (
                          <X className="w-4 h-4 mx-auto text-muted-foreground" />
                        )}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPermissionsDialogOpen(false)}>
              {tr("close")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={!!memberToRemove}
        onOpenChange={(open) => {
          if (!open) setMemberToRemove(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {tr("remove", { name: memberToRemove?.user?.name })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {tr("thisWillRemoveFromTheTeam", { name: memberToRemove?.user?.name })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tr("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (memberToRemove) {
                  removeMemberMutation.mutate(memberToRemove.id);
                  setMemberToRemove(null);
                }
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {tr("remove2")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
