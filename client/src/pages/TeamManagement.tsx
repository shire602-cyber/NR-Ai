import { T } from "@/components/layout/T";
import { SettingsLayout } from "@/components/layout/SettingsLayout";
import { PageHeader } from "@/components/ui/page-header";
import { useRef, useState } from "react";
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
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { useTranslation } from "@/lib/i18n";
import { useToast } from "@/hooks/use-toast";
import { useDefaultCompany } from "@/hooks/useDefaultCompany";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  COMPANY_ROLE_DESCRIPTIONS,
  COMPANY_ROLE_LABELS,
  canPerform,
  companyAccessQueryKey,
  type CompanyAccess,
  type CompanyRole,
} from "@/lib/auth";
import { OnDemandDialogStatus } from "@/components/team/onDemandDialog";
import { useOnDemandDialog } from "@/components/team/useOnDemandDialog";
import {
  UserPlus,
  Users,
  Shield,
  Crown,
  Calculator,
  User,
  Mail,
  Trash2,
  X,
  Loader2,
  Eye,
  BookOpen,
  BadgeCheck,
  RefreshCw,
  Search,
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

// One neutral pill for every role (spec 2.3: status/role is not carried by colour fills).
const ROLE_PILL = "border-transparent bg-neutral-subtle text-neutral-subtle-foreground";
const ROLE_COLORS: Record<CompanyRole, string> = {
  owner: ROLE_PILL,
  admin: ROLE_PILL,
  accountant: ROLE_PILL,
  bookkeeper: ROLE_PILL,
  approver: ROLE_PILL,
  employee: ROLE_PILL,
  viewer: ROLE_PILL,
};

const loadPermissionsMatrixDialog = () => import("@/components/team/PermissionsMatrixDialog");

export default function TeamManagement() {
  const { t, locale } = useTranslation();
  const tr = (b: Bilingual) => (locale === "ar" ? b.ar : b.en);
  const { toast } = useToast();
  const { companyId, isLoading: isLoadingCompany } = useDefaultCompany();
  const [inviteDialogOpen, setInviteDialogOpen] = useState(false);
  const [permissionsDialogOpen, setPermissionsDialogOpen] = useState(false);
  const permissionsDialog = useOnDemandDialog(loadPermissionsMatrixDialog);
  const permissionsTrigger = useRef<HTMLButtonElement>(null);
  const openPermissions = () => {
    setPermissionsDialogOpen(true);
    permissionsDialog.request();
  };
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<CompanyRole>("accountant");
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [memberSearch, setMemberSearch] = useState("");
  const [inviteEmailError, setInviteEmailError] = useState<string | null>(null);
  const [memberToRemove, setMemberToRemove] = useState<TeamMember | null>(null);

  const {
    data: teamMembers,
    isLoading: isLoadingTeam,
    isPending: teamPending,
    fetchStatus: teamFetchStatus,
    isLoadingError: teamLoadFailed,
    isRefetchError: teamRefreshFailed,
    refetch: refetchTeam,
  } = useQuery<TeamMember[]>({
    queryKey: ["/api/companies", companyId, "team"],
    enabled: !!companyId,
  });
  const { data: access } = useQuery<CompanyAccess>({
    queryKey: companyAccessQueryKey(companyId),
    enabled: !!companyId,
  });
  const canManage = canPerform(access, "team.manage");
  const grantable = access?.grantableRoles ?? [];

  // A first fetch with no cached data that is paused (offline) is neither loaded nor empty.
  const teamOffline = teamPending && teamFetchStatus === "paused";
  const {
    data: invitations,
    isLoading: isLoadingInvitations,
    isPending: invitationsPending,
    fetchStatus: invitationsFetchStatus,
    isLoadingError: invitationsLoadFailed,
    isRefetchError: invitationsRefreshFailed,
    refetch: refetchInvitations,
  } = useQuery<TeamInvitation[]>({
    queryKey: ["/api/companies", companyId, "team", "invitations"],
    enabled: !!companyId && canManage,
  });
  const invitationsOffline = invitationsPending && invitationsFetchStatus === "paused";
  const pendingInvitations = (invitations ?? []).filter(
    (i) => i.status === "pending" || i.status === "expired"
  );

  // The search box only appears once the roster is long enough to need it. Filtering uses
  // that same condition so a roster that shrinks below the threshold cannot keep a hidden filter.
  const showMemberSearch = (teamMembers?.length ?? 0) > 5;
  const needle = (showMemberSearch ? memberSearch : "").trim().toLowerCase();
  const visibleMembers = (teamMembers ?? []).filter(
    (m) =>
      !needle ||
      m.user.name.toLowerCase().includes(needle) ||
      m.user.email.toLowerCase().includes(needle)
  );

  const invalidateTeam = () =>
    queryClient.invalidateQueries({ queryKey: ["/api/companies", companyId, "team"] });
  const onError = (error: { message?: string }) =>
    toast({ variant: "destructive", title: t["pages.teamFailed"], description: error?.message });

  const handleInviteResult = (result: InviteResponse) => {
    invalidateTeam();
    if (result.delivery === "link" && result.inviteUrl) {
      setInviteLink(result.inviteUrl);
    } else {
      toast({ title: t["pages.teamSentTitle"], description: result.invitation.email });
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
      toast({ title: t["pages.teamRevoked"] });
    },
    onError,
  });

  const updateRoleMutation = useMutation({
    mutationFn: ({ memberId, role }: { memberId: string; role: CompanyRole }) =>
      apiRequest("PUT", `/api/companies/${companyId}/team/${memberId}`, { role }),
    onSuccess: () => {
      invalidateTeam();
      toast({ title: t["pages.teamUpdated"] });
    },
    onError,
  });

  const removeMemberMutation = useMutation({
    mutationFn: (memberId: string) =>
      apiRequest("DELETE", `/api/companies/${companyId}/team/${memberId}`),
    onSuccess: () => {
      invalidateTeam();
      toast({ title: t["pages.teamRemoved"] });
    },
    onError,
  });

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

  const copyInviteLink = async () => {
    if (!inviteLink) return;
    try {
      await navigator.clipboard.writeText(inviteLink);
      toast({ title: t["pages.teamCopied"] });
    } catch {
      /* clipboard unavailable: the link stays visible to copy by hand */
    }
  };

  if (isLoadingCompany) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-96" />
      </div>
    );
  }

  return (
    <SettingsLayout>
      <div className="space-y-6">
        <PageHeader
          eyebrow={t["pages.companyProfileEyebrow"]}
          title={t["pages.teamTeamManagement"]}
          description={t["pages.teamManageTeamMembersAndTheirAccess"]}
          actions={
            <>
              <Button
                ref={permissionsTrigger}
                variant="outline"
                onClick={openPermissions}
                data-testid="button-view-permissions"
              >
                <Shield className="w-4 h-4 me-2" />
                {t["settingsPages.permissions"]}
              </Button>
              <OnDemandDialogStatus
                status={permissionsDialog.status}
                onRetry={() => {
                  // The retry button goes away while loading; keep focus on the trigger.
                  permissionsTrigger.current?.focus();
                  openPermissions();
                }}
                testId="permissions-dialog"
              />
              {canManage && (
                <Button
                  onClick={() => setInviteDialogOpen(true)}
                  data-testid="button-invite-member"
                >
                  <UserPlus className="w-4 h-4 me-2" />
                  {t["pages.teamInviteMember"]}
                </Button>
              )}
            </>
          }
        />

        {access && (
          <p className="text-sm text-muted-foreground" data-testid="text-your-role">
            {t["pages.teamYourRole"]}: {access.role ? roleLabel(access.role) : "NRA"}
            {!canManage && <span className="ms-2">{t["pages.teamReadOnly"]}</span>}
          </p>
        )}

        <Card>
          <CardHeader>
            <CardTitle>{t["pages.teamTeamMembers"]}</CardTitle>
            <CardDescription>{t["pages.teamAllMembersWhoHaveAccessTo"]}</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoadingTeam ? (
              <div
                className="space-y-4"
                role="status"
                aria-label={t["portal.teamRosterLoading"]}
                data-testid="team-loading"
              >
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
            ) : teamOffline ? (
              <div
                className="py-12 text-center text-muted-foreground"
                role="status"
                data-testid="team-offline"
              >
                {t["portal.teamRosterOffline"]}
              </div>
            ) : teamLoadFailed ? (
              <div className="py-12 text-center" role="alert" data-testid="team-load-error">
                <p className="mb-4 text-muted-foreground">{t["pages.teamLoadFailed"]}</p>
                <Button
                  variant="outline"
                  onClick={() => refetchTeam()}
                  data-testid="button-retry-team"
                >
                  <RefreshCw className="w-4 h-4 me-2" />
                  {t["pages.teamRetry"]}
                </Button>
              </div>
            ) : (
              <>
                {teamRefreshFailed && (
                  <div
                    className="mb-4 flex flex-wrap items-center gap-3"
                    role="alert"
                    data-testid="team-load-error"
                  >
                    <p className="text-sm text-muted-foreground">{t["pages.teamLoadFailed"]}</p>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => refetchTeam()}
                      data-testid="button-retry-team"
                    >
                      <RefreshCw className="w-4 h-4 me-2" />
                      {t["pages.teamRetry"]}
                    </Button>
                  </div>
                )}
                {!teamMembers ? null : teamMembers.length === 0 ? (
                  <div className="text-center py-12">
                    <Users className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
                    <p className="text-muted-foreground">
                      {locale === "ar"
                        ? "لا يوجد أعضاء آخرين. قم بدعوة فريقك."
                        : "No other team members. Invite your team to collaborate."}
                    </p>
                  </div>
                ) : (
                  <>
                    {showMemberSearch && (
                      <div className="relative mb-3 max-w-sm">
                        <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                        <Input
                          value={memberSearch}
                          onChange={(e) => setMemberSearch(e.target.value)}
                          placeholder={t["pages.teamSearch"]}
                          aria-label={t["pages.teamSearch"]}
                          className="ps-10"
                          data-testid="input-search-members"
                        />
                      </div>
                    )}
                    {visibleMembers.length === 0 && (
                      <p
                        className="py-6 text-center text-sm text-muted-foreground"
                        data-testid="members-no-match"
                      >
                        {t["pages.teamNoMatches"]}
                      </p>
                    )}
                    <div className="-mx-5 -mb-5 divide-hairline border-t border-border/70">
                      {visibleMembers.map((member) => {
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
                              {canManage && !ownerLocked ? (
                                <Select
                                  value={member.role}
                                  onValueChange={(role) =>
                                    updateRoleMutation.mutate({
                                      memberId: member.id,
                                      role: role as CompanyRole,
                                    })
                                  }
                                  disabled={updateRoleMutation.isPending}
                                >
                                  <SelectTrigger
                                    className="h-9 w-44"
                                    aria-label={`${t["pages.teamEditRole"]}: ${member.user.name}`}
                                    data-testid={`select-role-${member.id}`}
                                  >
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {/* A member's current role stays listed even when it cannot be granted. */}
                                    {(grantable.includes(member.role)
                                      ? grantable
                                      : [member.role, ...grantable]
                                    ).map((role) => (
                                      <SelectItem key={role} value={role}>
                                        {roleLabel(role)}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              ) : (
                                getRoleBadge(member.role)
                              )}
                              {canManage && (
                                <RowActions>
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
                  </>
                )}
              </>
            )}
          </CardContent>
        </Card>

        {canManage && (
          <Card>
            <CardHeader>
              <CardTitle>{t["pages.teamInvitationsTitle"]}</CardTitle>
            </CardHeader>
            <CardContent>
              {isLoadingInvitations ? (
                <p
                  className="text-sm text-muted-foreground"
                  role="status"
                  data-testid="team-invitations-loading"
                >
                  {t["portal.inviteLoading"]}
                </p>
              ) : invitationsOffline ? (
                <p
                  className="text-sm text-muted-foreground"
                  role="status"
                  data-testid="team-invitations-offline"
                >
                  {t["portal.inviteOffline"]}
                </p>
              ) : invitationsLoadFailed ? (
                <div
                  role="alert"
                  className="flex items-center gap-3"
                  data-testid="invitations-load-error"
                >
                  <p className="text-sm text-muted-foreground">
                    {t["pages.teamInvitesLoadFailed"]}
                  </p>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => refetchInvitations()}
                    data-testid="button-retry-team-invites"
                  >
                    {t["pages.teamRetry"]}
                  </Button>
                </div>
              ) : (
                <>
                  {invitationsRefreshFailed && (
                    <div
                      role="alert"
                      className="mb-4 flex items-center gap-3"
                      data-testid="invitations-load-error"
                    >
                      <p className="text-sm text-muted-foreground">
                        {t["pages.teamInvitesLoadFailed"]}
                      </p>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => refetchInvitations()}
                        data-testid="button-retry-team-invites"
                      >
                        {t["pages.teamRetry"]}
                      </Button>
                    </div>
                  )}
                  {!invitations ? null : pendingInvitations.length === 0 ? (
                    <p
                      className="text-sm text-muted-foreground"
                      data-testid="team-invitations-empty"
                    >
                      {t["pages.teamInvitationsEmpty"]}
                    </p>
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
                                {inv.status === "expired" && (
                                  <Badge variant="secondary" className="me-2">
                                    {t["pages.teamExpiredLabel"]}
                                  </Badge>
                                )}
                                {t["pages.teamExpires"]}: {formatDate(inv.expiresAt, locale)}
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
                              {t["pages.teamResend"]}
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
                              {t["pages.teamRevoke"]}
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </>
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
              noValidate
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                const email = inviteEmail.trim();
                if (!email || inviteMutation.isPending) return;
                // In-app message (app language) instead of the browser's own bubble.
                if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
                  setInviteEmailError(t["pages.teamEmailInvalid"]);
                  return;
                }
                setInviteEmailError(null);
                inviteMutation.mutate({ email, role: inviteRole });
              }}
            >
              <div className="space-y-2">
                <Label>{t["pages.teamEmailAddress"]}</Label>
                <Input
                  type="email"
                  value={inviteEmail}
                  onChange={(e) => {
                    setInviteEmail(e.target.value);
                    setInviteEmailError(null);
                  }}
                  placeholder="colleague@company.com"
                  aria-invalid={inviteEmailError ? true : undefined}
                  aria-describedby={inviteEmailError ? "team-invite-email-error" : undefined}
                  data-testid="input-invite-email"
                />
                {inviteEmailError && (
                  <p id="team-invite-email-error" role="alert" className="text-small text-danger">
                    {inviteEmailError}
                  </p>
                )}
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
              <DialogTitle>{t["pages.teamLinkTitle"]}</DialogTitle>
              <DialogDescription>{t["pages.teamLinkBody"]}</DialogDescription>
            </DialogHeader>
            <Input readOnly value={inviteLink ?? ""} data-testid="input-invite-link" dir="ltr" />
            <DialogFooter>
              <Button onClick={copyInviteLink} data-testid="button-copy-invite-link">
                <Copy className="w-4 h-4 me-2" />
                {t["pages.teamCopy"]}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Loaded on first open and kept mounted afterwards so the close animation still plays. */}
        {permissionsDialog.Component && (
          <permissionsDialog.Component
            open={permissionsDialogOpen}
            onOpenChange={setPermissionsDialogOpen}
          />
        )}

        <AlertDialog
          open={!!memberToRemove}
          onOpenChange={(open) => {
            if (!open) setMemberToRemove(null);
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t["pages.teamRemoveTitle"]}</AlertDialogTitle>
              <AlertDialogDescription>
                {memberToRemove?.user?.name} — {t["pages.teamRemoveBody"]}
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
    </SettingsLayout>
  );
}
