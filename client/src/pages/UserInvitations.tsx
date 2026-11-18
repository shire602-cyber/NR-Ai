import { T } from "@/components/layout/T";
import { useTranslation, translateNow } from "@/lib/i18n";
import { PageHeader } from "@/components/ui/page-header";
import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  Mail,
  Search,
  MoreHorizontal,
  RefreshCw,
  XCircle,
  Trash2,
  Send,
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
import { apiRequest, queryClient } from "@/lib/queryClient";
import { formatDistanceToNow, isAfter } from "date-fns";
import { dateFnsOptions } from "@/lib/date-locale";
import { formatDate as formatDisplayDate } from "@/lib/format-date";
import type { Invitation, Company } from "@shared/schema";

export default function UserInvitations() {
  const { t, locale } = useTranslation();
  const { toast } = useToast();
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [inviteDialogOpen, setInviteDialogOpen] = useState(false);
  const [selectedCompanyId, setSelectedCompanyId] = useState<string>("");

  const { data: invitations = [], isLoading } = useQuery<Invitation[]>({
    queryKey: ["/api/admin/invitations"],
  });

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

  const filteredInvitations = invitations.filter((inv) => {
    const matchesSearch = inv.email.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus = statusFilter === "all" || inv.status === statusFilter;
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
    const email = formData.get("email") as string;
    const role = formData.get("role") as string;
    const userType = formData.get("userType") as string;

    createInvitationMutation.mutate({
      email,
      companyId: selectedCompanyId || undefined,
      role: role || "client",
      userType: userType || "client",
    });
  };

  const copyInviteLink = (token: string) => {
    const link = `${window.location.origin}/register?invite=${token}`;
    navigator.clipboard.writeText(link);
    toast({ title: t["portal.inviteLinkCopied"] });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={t["pages.eyebrowAdmin"]}
        title={t["portal.inviteTitle"]}
        testId="text-invitations-title"
        description={t["portal.inviteSubtitle"]}
        actions={
          <Button onClick={() => setInviteDialogOpen(true)} data-testid="button-send-invite">
            <Mail className="w-4 h-4 me-2" />
            <T k="pageLabels.sendInvitation" />
          </Button>
        }
      />
      <Dialog open={inviteDialogOpen} onOpenChange={setInviteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              <T k="pageLabels.sendClientInvitation" />
            </DialogTitle>
            <DialogDescription>
              <T k="portal.inviteDescription" />
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSendInvitation} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">{t["adminConsole.inviteEmail"]}</Label>
              <Input
                id="email"
                name="email"
                type="email"
                placeholder="client@example.com"
                required
                data-testid="input-invite-email"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="company">{t["adminConsole.inviteAssignClient"]}</Label>
              <Select
                value={selectedCompanyId || "none"}
                onValueChange={(value) => setSelectedCompanyId(value === "none" ? "" : value)}
              >
                <SelectTrigger data-testid="select-invite-company">
                  <SelectValue placeholder={t["portal.inviteSelectCompany"]} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">
                    <T k="pageLabels.noCompanyAssigned" />
                  </SelectItem>
                  {clients.map((client) => (
                    <SelectItem key={client.id} value={client.id}>
                      {client.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                <T k="pageLabels.ifAssignedTheUserWillHave" />
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="userType">{t["adminConsole.inviteUserType"]}</Label>
              <Select name="userType" defaultValue="client">
                <SelectTrigger data-testid="select-invite-usertype">
                  <SelectValue placeholder={t["portal.inviteSelectUserType"]} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="client">{t["adminConsole.userTypeClient"]}</SelectItem>
                  <SelectItem value="customer">{t["adminConsole.userTypeCustomer"]}</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">{t["firmOps.inviteUserTypeHint"]}</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="role">
                <T k="pageLabels.accessLevel" />
              </Label>
              <Select name="role" defaultValue="client">
                <SelectTrigger data-testid="select-invite-role">
                  <SelectValue placeholder={t["portal.inviteSelectAccess"]} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="client">{t["portal.invitations.roleStandard"]}</SelectItem>
                  <SelectItem value="staff">{t["portal.invitations.roleStaff"]}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setInviteDialogOpen(false)}>
                <T k="pages.cancel" />
              </Button>
              <Button
                type="submit"
                disabled={createInvitationMutation.isPending}
                data-testid="button-submit-invite"
              >
                <Send className="w-4 h-4 me-2" />
                {createInvitationMutation.isPending
                  ? t["portal.inviteSending"]
                  : t["pageLabels.sendInvitation"]}
              </Button>
            </DialogFooter>
          </form>
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
                  const isExpired =
                    invitation.expiresAt && isAfter(new Date(), new Date(invitation.expiresAt));
                  const canResend = invitation.status === "pending" || isExpired;

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
                                if (confirm("Delete this invitation?")) {
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
                {filteredInvitations.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                      {searchTerm || statusFilter !== "all"
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
