import { T } from "@/components/layout/T";
import { PageHeader } from "@/components/ui/page-header";
import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { RowActions, RowActionButton } from "@/components/ui/row-actions";
import { formatDate } from "@/lib/format";
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
import { useTranslation } from "@/lib/i18n";
import { useToast } from "@/hooks/use-toast";
import { useDefaultCompany } from "@/hooks/useDefaultCompany";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  COMPANY_ROLES,
  COMPANY_ROLE_DESCRIPTIONS,
  COMPANY_ROLE_LABELS,
  canPerform,
  companyAccessQueryKey,
  roleHasPermission,
  type CompanyAccess,
  type CompanyRole,
  type Permission,
} from "@/lib/auth";
import {
  UserPlus,
  Users,
  Shield,
  Crown,
  Calculator,
  User,
  Mail,
  Trash2,
  Edit,
  Check,
  X,
  Loader2,
  Eye,
  BookOpen,
  BadgeCheck,
  RefreshCw,
  Copy,
} from "lucide-react";

interface TeamMember {
  id: string;
  userId: string;
  companyId: string;
  role: CompanyRole;
  createdAt: string;
  user: {
    id: string;
    email: string;
    name: string;
  };
}

interface TeamInvitation {
  id: string;
  email: string;
  role: CompanyRole;
  status: "pending" | "accepted" | "revoked" | "expired";
  expiresAt: string;
  sendCount: number;
}

interface InviteResponse {
  invitation: TeamInvitation;
  delivery: "email" | "link";
  inviteUrl?: string;
}

type Bilingual = { en: string; ar: string };

const ROLE_ICONS: Record<CompanyRole, React.ReactNode> = {
  owner: <Crown className="w-4 h-4" />,
  admin: <Shield className="w-4 h-4" />,
  accountant: <Calculator className="w-4 h-4" />,
  bookkeeper: <BookOpen className="w-4 h-4" />,
  approver: <BadgeCheck className="w-4 h-4" />,
  employee: <User className="w-4 h-4" />,
  viewer: <Eye className="w-4 h-4" />,
};

const ROLE_COLORS: Record<CompanyRole, string> = {
  owner: "bg-chart-5/10 text-chart-5",
  admin: "bg-info-subtle text-info-subtle-foreground",
  accountant: "bg-success-subtle text-success-subtle-foreground",
  bookkeeper: "bg-success-subtle text-success-subtle-foreground",
  approver: "bg-info-subtle text-info-subtle-foreground",
  employee: "bg-muted text-foreground",
  viewer: "bg-muted text-muted-foreground",
};

/** Shown in the permissions matrix; keys come from shared/permissions.ts. */
const PERMISSION_LABELS: Record<Permission, Bilingual> = {
  "reports.read": { en: "View records and reports", ar: "عرض السجلات والتقارير" },
  "documents.write": { en: "Create and edit documents", ar: "إنشاء المستندات وتعديلها" },
  "documents.approve": { en: "Approve documents", ar: "اعتماد المستندات" },
  "ledger.post": { en: "Post to the ledger", ar: "الترحيل إلى دفتر الأستاذ" },
  "payments.release": { en: "Release payments", ar: "إصدار المدفوعات" },
  "payroll.manage": { en: "Manage payroll", ar: "إدارة الرواتب" },
  "payroll.approve": { en: "Approve payroll", ar: "اعتماد الرواتب" },
  "tax.submit": { en: "Submit tax returns", ar: "تقديم الإقرارات الضريبية" },
  "settings.company": { en: "Company settings", ar: "إعدادات الشركة" },
  "company.delete": { en: "Delete the company", ar: "حذف الشركة" },
  "team.manage": { en: "Manage team members", ar: "إدارة أعضاء الفريق" },
  "billing.manage": { en: "Manage billing", ar: "إدارة الفوترة" },
  "backups.manage": { en: "Backups and restore", ar: "النسخ الاحتياطي والاستعادة" },
  "period.lock": { en: "Lock periods", ar: "إقفال الفترات" },
  "period.unlock": { en: "Unlock periods", ar: "فتح الفترات المقفلة" },
};

const COPY = {
  invitationsTitle: { en: "Pending invitations", ar: "الدعوات المعلقة" },
  invitationsEmpty: { en: "No pending invitations.", ar: "لا توجد دعوات معلقة." },
  resend: { en: "Resend", ar: "إعادة الإرسال" },
  revoke: { en: "Revoke", ar: "إلغاء الدعوة" },
  expires: { en: "Expires", ar: "تنتهي في" },
  linkTitle: { en: "Share the invitation link", ar: "شارك رابط الدعوة" },
  linkBody: {
    en: "Email delivery is not configured, so no email was sent. Send this link to the invitee yourself; it expires in 7 days.",
    ar: "لم يتم إعداد البريد الإلكتروني، لذلك لم تُرسل أي رسالة. أرسل هذا الرابط إلى المدعو بنفسك؛ تنتهي صلاحيته خلال 7 أيام.",
  },
  copy: { en: "Copy link", ar: "نسخ الرابط" },
  copied: { en: "Link copied", ar: "تم نسخ الرابط" },
  sentTitle: { en: "Invitation sent", ar: "تم إرسال الدعوة" },
  readOnly: {
    en: "Your role can view the team but not change it.",
    ar: "يمكن لدورك عرض الفريق دون تعديله.",
  },
  yourRole: { en: "Your role", ar: "دورك" },
  finance: { en: "Finance team", ar: "الفريق المالي" },
  others: { en: "Employees and viewers", ar: "الموظفون والمشاهدون" },
  removeTitle: { en: "Remove team member?", ar: "إزالة عضو الفريق؟" },
  removeBody: {
    en: "They will lose access to this company immediately.",
    ar: "سيفقد الوصول إلى هذه الشركة فورًا.",
  },
  failed: { en: "Something went wrong", ar: "حدث خطأ ما" },
  updated: { en: "Role updated", ar: "تم تحديث الدور" },
  removed: { en: "Member removed", ar: "تمت إزالة العضو" },
  revoked: { en: "Invitation revoked", ar: "تم إلغاء الدعوة" },
} satisfies Record<string, Bilingual>;

const FINANCE_ROLES: CompanyRole[] = ["admin", "accountant", "bookkeeper", "approver"];

export default function TeamManagement() {
  const { t, locale } = useTranslation();
  const tr = (b: Bilingual) => (locale === "ar" ? b.ar : b.en);
  const { toast } = useToast();
  const { companyId, isLoading: isLoadingCompany } = useDefaultCompany();
  const [inviteDialogOpen, setInviteDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [permissionsDialogOpen, setPermissionsDialogOpen] = useState(false);
  const [selectedMember, setSelectedMember] = useState<TeamMember | null>(null);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<CompanyRole>("accountant");
  const [newRole, setNewRole] = useState<CompanyRole | "">("");
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [memberToRemove, setMemberToRemove] = useState<TeamMember | null>(null);

  const { data: teamMembers, isLoading: isLoadingTeam } = useQuery<TeamMember[]>({
    queryKey: ["/api/companies", companyId, "team"],
    enabled: !!companyId,
  });
  const { data: access } = useQuery<CompanyAccess>({
    queryKey: companyAccessQueryKey(companyId),
    enabled: !!companyId,
  });
  const canManage = canPerform(access, "team.manage");
  const grantable = access?.grantableRoles ?? [];

  const { data: invitations } = useQuery<TeamInvitation[]>({
    queryKey: ["/api/companies", companyId, "team", "invitations"],
    enabled: !!companyId && canManage,
  });
  const pendingInvitations = (invitations ?? []).filter(
    (i) => i.status === "pending" || i.status === "expired"
  );

  const invalidateTeam = () =>
    queryClient.invalidateQueries({ queryKey: ["/api/companies", companyId, "team"] });
  const onError = (error: { message?: string }) =>
    toast({ variant: "destructive", title: tr(COPY.failed), description: error?.message });

  const handleInviteResult = (result: InviteResponse) => {
    invalidateTeam();
    if (result.delivery === "link" && result.inviteUrl) {
      setInviteLink(result.inviteUrl);
    } else {
      toast({ title: tr(COPY.sentTitle), description: result.invitation.email });
    }
  };

  const inviteMutation = useMutation({
    mutationFn: ({ email, role }: { email: string; role: CompanyRole }) =>
      apiRequest("POST", `/api/companies/${companyId}/team/invite`, {
        email,
        role,
      }) as Promise<InviteResponse>,
    onSuccess: (result) => {
      handleInviteResult(result);
      setInviteDialogOpen(false);
      setInviteEmail("");
      setInviteRole("accountant");
    },
    onError,
  });

  const resendMutation = useMutation({
    mutationFn: (invitationId: string) =>
      apiRequest(
        "POST",
        `/api/companies/${companyId}/team/invitations/${invitationId}/resend`,
        {}
      ) as Promise<InviteResponse>,
    onSuccess: handleInviteResult,
    onError,
  });

  const revokeMutation = useMutation({
    mutationFn: (invitationId: string) =>
      apiRequest("DELETE", `/api/companies/${companyId}/team/invitations/${invitationId}`),
    onSuccess: () => {
      invalidateTeam();
      toast({ title: tr(COPY.revoked) });
    },
    onError,
  });

  const updateRoleMutation = useMutation({
    mutationFn: ({ memberId, role }: { memberId: string; role: CompanyRole }) =>
      apiRequest("PUT", `/api/companies/${companyId}/team/${memberId}`, { role }),
    onSuccess: () => {
      invalidateTeam();
      toast({ title: tr(COPY.updated) });
      setEditDialogOpen(false);
      setSelectedMember(null);
    },
    onError,
  });

  const removeMemberMutation = useMutation({
    mutationFn: (memberId: string) =>
      apiRequest("DELETE", `/api/companies/${companyId}/team/${memberId}`),
    onSuccess: () => {
      invalidateTeam();
      toast({ title: tr(COPY.removed) });
    },
    onError,
  });

  const stats = useMemo(() => {
    const members = teamMembers ?? [];
    return {
      total: members.length,
      owners: members.filter((m) => m.role === "owner").length,
      finance: members.filter((m) => FINANCE_ROLES.includes(m.role)).length,
      others: members.filter((m) => m.role === "employee" || m.role === "viewer").length,
    };
  }, [teamMembers]);

  const roleLabel = (role: CompanyRole) =>
    tr(COMPANY_ROLE_LABELS[role] ?? COMPANY_ROLE_LABELS.employee);

  const getRoleBadge = (role: CompanyRole) => (
    <Badge variant="secondary" className={ROLE_COLORS[role] || ""}>
      {ROLE_ICONS[role]}
      <span className="ms-1">{roleLabel(role)}</span>
    </Badge>
  );

  const getInitials = (name: string) =>
    name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);

  const handleEditMember = (member: TeamMember) => {
    setSelectedMember(member);
    setNewRole(member.role);
    setEditDialogOpen(true);
  };

  const handleUpdateRole = () => {
    if (!selectedMember || !newRole) return;
    updateRoleMutation.mutate({ memberId: selectedMember.id, role: newRole });
  };

  const copyInviteLink = async () => {
    if (!inviteLink) return;
    try {
      await navigator.clipboard.writeText(inviteLink);
      toast({ title: tr(COPY.copied) });
    } catch {
      /* clipboard unavailable: the link stays visible to copy by hand */
    }
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
        eyebrow="Settings"
        title={t["pages.teamTeamManagement"]}
        description={t["pages.teamManageTeamMembersAndTheirAccess"]}
        actions={
          <>
            <Button
              variant="outline"
              onClick={() => setPermissionsDialogOpen(true)}
              data-testid="button-view-permissions"
            >
              <Shield className="w-4 h-4 me-2" />
              {locale === "ar" ? "الصلاحيات" : "Permissions"}
            </Button>
            {canManage && (
              <Button onClick={() => setInviteDialogOpen(true)} data-testid="button-invite-member">
                <UserPlus className="w-4 h-4 me-2" />
                {t["pages.teamInviteMember"]}
              </Button>
            )}
          </>
        }
      />

      {access && (
        <p className="text-sm text-muted-foreground" data-testid="text-your-role">
          {tr(COPY.yourRole)}: {access.role ? roleLabel(access.role) : "NRA"}
          {!canManage && <span className="ms-2">{tr(COPY.readOnly)}</span>}
        </p>
      )}

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {t["pages.teamTotalMembers"]}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.total}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {locale === "ar" ? "المالكين" : "Owners"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold tabular-nums">{stats.owners}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {tr(COPY.finance)}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold tabular-nums">{stats.finance}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {tr(COPY.others)}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold tabular-nums">{stats.others}</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t["pages.teamTeamMembers"]}</CardTitle>
          <CardDescription>{t["pages.teamAllMembersWhoHaveAccessTo"]}</CardDescription>
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
              <p className="text-muted-foreground">
                {locale === "ar"
                  ? "لا يوجد أعضاء آخرين. قم بدعوة فريقك."
                  : "No other team members. Invite your team to collaborate."}
              </p>
            </div>
          ) : (
            <div className="-mx-5 -mb-5 divide-hairline border-t border-border/70">
              {teamMembers.map((member) => {
                const ownerLocked = member.role === "owner" && access?.role !== "owner";
                return (
                  <div
                    key={member.id}
                    className="flex items-center justify-between gap-3 px-5 py-3"
                    data-testid={`member-${member.id}`}
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <Avatar>
                        <AvatarFallback>{getInitials(member.user.name)}</AvatarFallback>
                      </Avatar>
                      <div className="min-w-0">
                        <p className="truncate font-medium" dir="auto">
                          {member.user.name}
                        </p>
                        <p className="truncate text-small text-muted-foreground" dir="ltr">
                          {member.user.email}
                        </p>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-3">
                      {getRoleBadge(member.role)}
                      {canManage && (
                        <RowActions>
                          <RowActionButton
                            icon={Edit}
                            label={t["pages.teamEditRole"]}
                            onClick={() => handleEditMember(member)}
                            disabled={ownerLocked}
                            data-testid={`button-edit-${member.id}`}
                          />
                          <RowActionButton
                            icon={Trash2}
                            label={t["pages.teamRemoveMember"]}
                            onClick={() => setMemberToRemove(member)}
                            disabled={ownerLocked}
                            className="hover:text-destructive"
                            data-testid={`button-remove-${member.id}`}
                          />
                        </RowActions>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {canManage && (
        <Card>
          <CardHeader>
            <CardTitle>{tr(COPY.invitationsTitle)}</CardTitle>
          </CardHeader>
          <CardContent>
            {pendingInvitations.length === 0 ? (
              <p className="text-sm text-muted-foreground">{tr(COPY.invitationsEmpty)}</p>
            ) : (
              <div className="-mx-5 -mb-5 divide-hairline border-t border-border/70">
                {pendingInvitations.map((inv) => (
                  <div
                    key={inv.id}
                    className="flex flex-wrap items-center justify-between gap-3 px-5 py-3"
                    data-testid={`invitation-${inv.id}`}
                  >
                    <div className="flex items-center gap-3">
                      <Mail className="w-4 h-4 text-muted-foreground" />
                      <div>
                        <p className="font-medium" dir="ltr">
                          {inv.email}
                        </p>
                        <p className="text-caption text-muted-foreground">
                          {tr(COPY.expires)}: {formatDate(inv.expiresAt, locale)}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {getRoleBadge(inv.role)}
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => resendMutation.mutate(inv.id)}
                        disabled={resendMutation.isPending}
                        data-testid={`button-resend-${inv.id}`}
                      >
                        <RefreshCw className="w-4 h-4 me-1" />
                        {tr(COPY.resend)}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-muted-foreground hover:text-destructive"
                        onClick={() => revokeMutation.mutate(inv.id)}
                        disabled={revokeMutation.isPending}
                        data-testid={`button-revoke-${inv.id}`}
                      >
                        <X className="w-4 h-4 me-1" />
                        {tr(COPY.revoke)}
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Dialog open={inviteDialogOpen} onOpenChange={setInviteDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t["pages.teamInviteTeamMember"]}</DialogTitle>
            <DialogDescription>{t["pages.teamSendAnInvitationToJoinYour"]}</DialogDescription>
          </DialogHeader>
          {/* X6b: a real form so Enter in the email field sends the invitation. */}
          <form
            id="invite-member-form"
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (inviteEmail && !inviteMutation.isPending) {
                inviteMutation.mutate({ email: inviteEmail, role: inviteRole });
              }
            }}
          >
            <div className="space-y-2">
              <Label>{t["pages.teamEmailAddress"]}</Label>
              <Input
                type="email"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="colleague@company.com"
                data-testid="input-invite-email"
              />
            </div>
            <div className="space-y-2">
              <Label>{locale === "ar" ? "الدور" : "Role"}</Label>
              <Select value={inviteRole} onValueChange={(v) => setInviteRole(v as CompanyRole)}>
                <SelectTrigger data-testid="select-invite-role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {grantable.map((role) => (
                    <SelectItem key={role} value={role}>
                      <div className="flex items-center gap-2">
                        {ROLE_ICONS[role]}
                        <div>
                          <p>{roleLabel(role)}</p>
                          <p className="text-xs text-muted-foreground">
                            {tr(COMPANY_ROLE_DESCRIPTIONS[role])}
                          </p>
                        </div>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </form>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setInviteDialogOpen(false)}>
              {locale === "ar" ? "إلغاء" : "Cancel"}
            </Button>
            <Button
              type="submit"
              form="invite-member-form"
              disabled={inviteMutation.isPending || !inviteEmail}
              data-testid="button-confirm-invite"
            >
              {inviteMutation.isPending && <Loader2 className="w-4 h-4 me-2 animate-spin" />}
              <Mail className="w-4 h-4 me-2" />
              {t["pages.teamSendInvite"]}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!inviteLink} onOpenChange={(open) => !open && setInviteLink(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{tr(COPY.linkTitle)}</DialogTitle>
            <DialogDescription>{tr(COPY.linkBody)}</DialogDescription>
          </DialogHeader>
          <Input readOnly value={inviteLink ?? ""} data-testid="input-invite-link" dir="ltr" />
          <DialogFooter>
            <Button onClick={copyInviteLink} data-testid="button-copy-invite-link">
              <Copy className="w-4 h-4 me-2" />
              {tr(COPY.copy)}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t["pages.teamEditRole2"]}</DialogTitle>
            <DialogDescription>
              {selectedMember && (
                <span>
                  {t["pages.teamChangeRoleFor"]} {selectedMember.user.name}
                </span>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>{t["pages.teamNewRole"]}</Label>
              <Select value={newRole} onValueChange={(v) => setNewRole(v as CompanyRole)}>
                <SelectTrigger data-testid="select-new-role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {grantable.map((role) => (
                    <SelectItem key={role} value={role}>
                      <div className="flex items-center gap-2">
                        {ROLE_ICONS[role]}
                        <span>{roleLabel(role)}</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditDialogOpen(false)}>
              {locale === "ar" ? "إلغاء" : "Cancel"}
            </Button>
            <Button
              onClick={handleUpdateRole}
              disabled={updateRoleMutation.isPending}
              data-testid="button-confirm-update"
            >
              {updateRoleMutation.isPending && <Loader2 className="w-4 h-4 me-2 animate-spin" />}
              {t["pages.teamUpdateRole"]}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={permissionsDialogOpen} onOpenChange={setPermissionsDialogOpen}>
        <DialogContent className="sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>{t["pages.teamPermissionsMatrix"]}</DialogTitle>
            <DialogDescription>{t["pages.teamAvailablePermissionsForEachRole"]}</DialogDescription>
          </DialogHeader>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{locale === "ar" ? "الصلاحية" : "Permission"}</TableHead>
                  {COMPANY_ROLES.map((role) => (
                    <TableHead key={role} className="text-center">
                      {roleLabel(role)}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {(Object.keys(PERMISSION_LABELS) as Permission[]).map((permission) => (
                  <TableRow key={permission}>
                    <TableCell className="font-medium">
                      {tr(PERMISSION_LABELS[permission])}
                    </TableCell>
                    {COMPANY_ROLES.map((role) => (
                      <TableCell key={role} className="text-center">
                        {roleHasPermission(role, permission) ? (
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
              {locale === "ar" ? "إغلاق" : "Close"}
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
            <AlertDialogTitle>{tr(COPY.removeTitle)}</AlertDialogTitle>
            <AlertDialogDescription>
              {memberToRemove?.user?.name} — {tr(COPY.removeBody)}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              <T k="pages.cancel" />
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (memberToRemove) {
                  removeMemberMutation.mutate(memberToRemove.id);
                  setMemberToRemove(null);
                }
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              <T k="pages.remove" />
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
