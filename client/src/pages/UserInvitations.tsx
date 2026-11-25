import { T } from "@/components/layout/T";
import { useTranslation, translateNow } from "@/lib/i18n";
import { PageHeader } from "@/components/ui/page-header";
import { useRef, useState } from "react";
import { OnDemandDialogStatus } from "@/components/team/onDemandDialog";
import { useOnDemandDialog } from "@/components/team/useOnDemandDialog";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  Mail,
  Search,
  MoreHorizontal,
  RefreshCw,
  XCircle,
  Trash2,
  Building2,
  Copy,
} from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/ui/status-badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { freshChunkUrl } from "@/lib/dialogChunk";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { formatDistanceToNow, isAfter } from "date-fns";
import { dateFnsOptions } from "@/lib/date-locale";
import { formatDate as formatDisplayDate } from "@/lib/format-date";
import type { Invitation, Company } from "@shared/schema";

type InviteClientModule = typeof import("@/components/team/InviteClientDialog");

// First try: the literal import (split, hashed and preloaded by the bundler). Retry: the same chunk
// under a fresh URL; the production path is a marker the dialog-chunk-urls Vite plugin rewrites to
// the emitted chunk (see lib/dialogChunk.ts).
const loadInviteClientDialog = (retry: string | null): Promise<InviteClientModule> => {
  if (retry === null) return import("@/components/team/InviteClientDialog");
  const path = import.meta.env.DEV
    ? "../components/team/InviteClientDialog.tsx"
    : "__MUHASIB_DIALOG_CHUNK__InviteClientDialog__";
  return import(/* @vite-ignore */ freshChunkUrl(new URL(path, import.meta.url), retry));
};

export default function UserInvitations() {
  const { t, locale } = useTranslation();
  const { toast } = useToast();
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [inviteDialogOpen, setInviteDialogOpen] = useState(false);
  const inviteDialog = useOnDemandDialog(loadInviteClientDialog, "InviteClientDialog");
  const inviteTrigger = useRef<HTMLButtonElement>(null);
  const openInviteDialog = () => {
    setInviteDialogOpen(true);
    inviteDialog.request();
  };
  const [emailError, setEmailError] = useState<string | null>(null);
  const [selectedCompanyId, setSelectedCompanyId] = useState<string>("");

  const {
    data: invitationsData,
    isLoading,
    isPending: invitationsPending,
    fetchStatus: invitationsFetchStatus,
    isLoadingError,
    isRefetchError,
    refetch,
  } = useQuery<Invitation[]>({
    queryKey: ["/api/admin/invitations"],
  });
  // Empty copy is only for a successful response; a paused (offline) first fetch has no data yet.
  const invitations = invitationsData ?? [];
  const invitationsOffline = invitationsPending && invitationsFetchStatus === "paused";
  const manualLinkInputRef = useRef<HTMLInputElement>(null);
  const [manualLink, setManualLink] = useState<string | null>(null);

  const { data: clients = [] } = useQuery<Company[]>({
    queryKey: ["/api/admin/clients"],
  });

  const createInvitationMutation = useMutation({
    mutationFn: async (data: {
      email: string;
      companyId?: string;
      role: string;
      userType: string;
    }) => {
      return apiRequest("POST", "/api/admin/invitations", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/invitations"] });
      toast({ title: t["portal.inviteSent"] });
      setInviteDialogOpen(false);
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: translateNow("toasts.failedToSendInvitation"),
        description: error?.message,
      });
    },
  });

  const revokeInvitationMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest("PATCH", `/api/admin/invitations/${id}/revoke`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/invitations"] });
      toast({ title: t["portal.inviteRevoked"] });
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: translateNow("toasts.failedToRevokeInvitation"),
        description: error?.message,
      });
    },
  });

  const resendInvitationMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest("POST", `/api/admin/invitations/${id}/resend`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/invitations"] });
      toast({ title: t["portal.inviteResent"] });
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: translateNow("toasts.failedToResendInvitation"),
        description: error?.message,
      });
    },
  });

  const deleteInvitationMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest("DELETE", `/api/admin/invitations/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/invitations"] });
      toast({ title: t["portal.inviteDeleted"] });
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: translateNow("toasts.failedToDeleteInvitation"),
        description: error?.message,
      });
    },
  });

  // "Expired" is derived from expiresAt (the API keeps status "pending"), so the filter must use
  // the same derived status the badge shows: Pending excludes lapsed invites, Expired finds them.
  const effectiveStatus = (inv: Invitation) =>
    inv.status === "pending" && inv.expiresAt && isAfter(new Date(), new Date(inv.expiresAt))
      ? "expired"
      : inv.status;

  // Normalised once: whitespace alone is not a filter, for matching and for the empty state.
  const searchNeedle = searchTerm.trim().toLowerCase();
  const filteredInvitations = invitations.filter((inv) => {
    const matchesSearch = inv.email.toLowerCase().includes(searchNeedle);
    const matchesStatus = statusFilter === "all" || effectiveStatus(inv) === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const getStatusBadge = (invitation: Invitation) => {
    const isExpired = invitation.expiresAt && isAfter(new Date(), new Date(invitation.expiresAt));

    if (invitation.status === "accepted") {
      return (
        <StatusBadge tone="success">
          <T k="pages.accepted" />
        </StatusBadge>
      );
    }
    if (invitation.status === "revoked") {
      return (
        <StatusBadge tone="danger">
          <T k="pages.revoked" />
        </StatusBadge>
      );
    }
    if (isExpired) {
      return (
        <Badge variant="secondary">
          <T k="pages.expired" />
        </Badge>
      );
    }
    return (
      <StatusBadge tone="info">
        <T k="pages.pending" />
      </StatusBadge>
    );
  };

  const handleSendInvitation = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const email = String(formData.get("email") ?? "").trim();
    // Broken-path sweep: an empty "Send invitation" did nothing visible (only the browser's own
    // bubble, in the browser's language); the form now says what is wrong, in the app language.
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setEmailError(t[email ? "forms.errors.emailAddressInvalid" : "forms.errors.required"]);
      return;
    }
    setEmailError(null);
    const role = formData.get("role") as string;
    const userType = formData.get("userType") as string;

    createInvitationMutation.mutate({
      email,
      companyId: selectedCompanyId || undefined,
      role: role || "client",
      userType: userType || "client",
    });
  };

  const copyInviteLink = async (token: string) => {
    const link = `${window.location.origin}/register?invite=${token}`;
    try {
      await navigator.clipboard.writeText(link);
      toast({ title: t["portal.inviteLinkCopied"] });
    } catch {
      toast({ variant: "destructive", title: t["portal.inviteCopyFailed"] });
      // Clipboard refused: show the same link so it can be copied by hand.
      setManualLink(link);
    }
  };

  if (isLoading) {
    return (
      <div
        className="flex items-center justify-center h-64"
        role="status"
        aria-label={t["portal.inviteLoading"]}
        data-testid="invitations-loading"
      >
        <div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  if (invitationsOffline) {
    return (
      <div className="space-y-4 py-16 text-center" role="status" data-testid="invitations-offline">
        <p className="text-muted-foreground">{t["portal.inviteOffline"]}</p>
      </div>
    );
  }

  if (isLoadingError) {
    return (
      <div
        className="space-y-4 py-16 text-center"
        role="alert"
        data-testid="invitations-load-error"
      >
        <p className="text-muted-foreground">{t["portal.inviteLoadFailed"]}</p>
        <Button variant="outline" onClick={() => refetch()} data-testid="button-retry-invitations">
          <RefreshCw className="w-4 h-4 me-2" />
          {t["pages.retry"]}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {isRefetchError && (
        <div
          className="flex flex-wrap items-center gap-3"
          role="alert"
          data-testid="invitations-load-error"
        >
          <p className="text-sm text-muted-foreground">{t["portal.inviteLoadFailed"]}</p>
          <Button
            size="sm"
            variant="outline"
            onClick={() => refetch()}
            data-testid="button-retry-invitations"
          >
            <RefreshCw className="w-4 h-4 me-2" />
            {t["pages.retry"]}
          </Button>
        </div>
      )}
      <PageHeader
        eyebrow={t["pages.eyebrowAdmin"]}
        title={t["portal.inviteTitle"]}
        testId="text-invitations-title"
        description={t["portal.inviteSubtitle"]}
        actions={
          <>
            <Button ref={inviteTrigger} onClick={openInviteDialog} data-testid="button-send-invite">
              <Mail className="w-4 h-4 me-2" />
              <T k="pageLabels.sendInvitation" />
            </Button>
            <OnDemandDialogStatus
              status={inviteDialog.status}
              onRetry={() => {
                // The retry button goes away while loading; keep focus on the trigger.
                inviteTrigger.current?.focus();
                openInviteDialog();
              }}
              testId="invite-dialog"
            />
          </>
        }
      />
      {/* Loaded on first open and kept mounted afterwards so the close animation still plays. */}
      {inviteDialog.Component && (
        <inviteDialog.Component
          open={inviteDialogOpen}
          onOpenChange={setInviteDialogOpen}
          onSubmit={handleSendInvitation}
          emailError={emailError}
          onEmailChange={() => setEmailError(null)}
          clients={clients}
          selectedCompanyId={selectedCompanyId}
          onCompanyChange={setSelectedCompanyId}
          isPending={createInvitationMutation.isPending}
        />
      )}

      <Dialog open={manualLink !== null} onOpenChange={(open) => !open && setManualLink(null)}>
        <DialogContent
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            manualLinkInputRef.current?.focus();
            manualLinkInputRef.current?.select();
          }}
        >
          <DialogHeader>
            <DialogTitle>{t["portal.inviteLinkDialogTitle"]}</DialogTitle>
            <DialogDescription>{t["portal.inviteLinkDialogBody"]}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="invite-link-manual">{t["portal.inviteLinkFieldLabel"]}</Label>
            <Input
              id="invite-link-manual"
              ref={manualLinkInputRef}
              readOnly
              dir="ltr"
              value={manualLink ?? ""}
              onFocus={(e) => e.currentTarget.select()}
              data-testid="input-invite-link-manual"
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setManualLink(null)}>
              <T k="pages.close" />
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-4 flex-1">
              <div className="relative flex-1 max-w-md">
                <Search className="absolute start-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder={t["portal.inviteSearchPlaceholder"]}
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="ps-10"
                  data-testid="input-search-invites"
                />
              </div>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger
                  className="w-40"
                  aria-label={t["firmOps.ariaInviteStatus"]}
                  data-testid="select-filter-status"
                >
                  <SelectValue placeholder={t["portal.inviteFilterStatus"]} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">
                    <T k="pageLabels.allStatus" />
                  </SelectItem>
                  <SelectItem value="pending">
                    <T k="pages.pending" />
                  </SelectItem>
                  <SelectItem value="accepted">
                    <T k="pages.accepted" />
                  </SelectItem>
                  <SelectItem value="revoked">
                    <T k="pages.revoked" />
                  </SelectItem>
                  <SelectItem value="expired">
                    <T k="pages.expired" />
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-[500px]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>
                    <T k="pages.email" />
                  </TableHead>
                  <TableHead>
                    <T k="pages.client" />
                  </TableHead>
                  <TableHead>{t["portal.invitations.role"]}</TableHead>
                  <TableHead>
                    <T k="pages.status" />
                  </TableHead>
                  <TableHead>
                    <T k="pageLabels.expires" />
                  </TableHead>
                  <TableHead>{t["portal.invitations.sent"]}</TableHead>
                  <TableHead data-numeric>
                    <T k="pages.actions" />
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredInvitations.map((invitation) => {
                  const client = clients.find((c) => c.id === invitation.companyId);
                  // Only an unanswered invite can be resent; an accepted or revoked one whose
                  // expiry date has passed must not offer Resend.
                  const isExpired =
                    invitation.status === "pending" &&
                    invitation.expiresAt &&
                    isAfter(new Date(), new Date(invitation.expiresAt));
                  const canResend = invitation.status === "pending";

                  return (
                    <TableRow key={invitation.id} data-testid={`row-invite-${invitation.id}`}>
                      <TableCell className="font-medium">{invitation.email}</TableCell>
                      <TableCell>
                        {client ? (
                          <div className="flex items-center gap-2">
                            <Building2 className="w-4 h-4 text-muted-foreground" />
                            {client.name}
                          </div>
                        ) : (
                          <span className="text-muted-foreground">
                            <T k="pageLabels.notAssigned" />
                          </span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant={invitation.role === "staff" ? "default" : "secondary"}>
                          {t[`portal.invitations.roleValue.${invitation.role}`] ?? invitation.role}
                        </Badge>
                      </TableCell>
                      <TableCell>{getStatusBadge(invitation)}</TableCell>
                      <TableCell>
                        {invitation.expiresAt ? (
                          <span className={isExpired ? "text-destructive" : ""}>
                            {formatDistanceToNow(new Date(invitation.expiresAt), {
                              addSuffix: true,
                              ...dateFnsOptions(locale),
                            })}
                          </span>
                        ) : (
                          "-"
                        )}
                      </TableCell>
                      <TableCell>
                        {invitation.createdAt
                          ? formatDisplayDate(invitation.createdAt, locale)
                          : "-"}
                      </TableCell>
                      <TableCell data-numeric>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              data-testid={`button-actions-invite-${invitation.id}`}
                            >
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            {invitation.status === "pending" && !isExpired && (
                              <DropdownMenuItem onClick={() => copyInviteLink(invitation.token)}>
                                <Copy className="w-4 h-4 me-2" />
                                <T k="pageLabels.copyInviteLink" />
                              </DropdownMenuItem>
                            )}
                            {canResend && (
                              <DropdownMenuItem
                                onClick={() => resendInvitationMutation.mutate(invitation.id)}
                                disabled={resendInvitationMutation.isPending}
                              >
                                <RefreshCw className="w-4 h-4 me-2" />
                                <T k="pageLabels.resendInvitation" />
                              </DropdownMenuItem>
                            )}
                            {invitation.status === "pending" && (
                              <>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                  className="text-destructive"
                                  onClick={() => revokeInvitationMutation.mutate(invitation.id)}
                                  disabled={revokeInvitationMutation.isPending}
                                >
                                  <XCircle className="w-4 h-4 me-2" />
                                  <T k="pageLabels.revoke" />
                                </DropdownMenuItem>
                              </>
                            )}
                            <DropdownMenuItem
                              className="text-destructive"
                              onClick={() => {
                                if (confirm(t["portal.inviteDeleteConfirm"])) {
                                  deleteInvitationMutation.mutate(invitation.id);
                                }
                              }}
                            >
                              <Trash2 className="w-4 h-4 me-2" />
                              <T k="pages.delete" />
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  );
                })}
                {invitationsData !== undefined && filteredInvitations.length === 0 && (
                  <TableRow>
                    <TableCell
                      colSpan={7}
                      className="text-center py-8 text-muted-foreground"
                      data-testid="invitations-empty"
                    >
                      {searchNeedle || statusFilter !== "all"
                        ? t["portal.inviteNoMatches"]
                        : t["portal.inviteNoneYet"]}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
}
