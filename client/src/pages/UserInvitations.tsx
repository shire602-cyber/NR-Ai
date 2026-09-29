import { PageHeader } from "@/components/ui/page-header";
import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  Mail,
  Plus,
  Search,
  MoreHorizontal,
  RefreshCw,
  XCircle,
  CheckCircle,
  Clock,
  Trash2,
  Send,
  Building2,
  Copy,
  ExternalLink,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
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
import { format, formatDistanceToNow, isAfter } from "date-fns";
import type { Invitation, Company } from "@shared/schema";
import { messages as pageMessages } from "./UserInvitations.i18n";

export default function UserInvitations() {
  const tr = pageMessages.useT();

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
      toast({ title: tr("invitationSentSuccessfully") });
      setInviteDialogOpen(false);
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: tr("failedToSendInvitation"),
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
      toast({ title: tr("invitationRevoked") });
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: tr("failedToRevokeInvitation"),
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
      toast({ title: tr("invitationResentSuccessfully") });
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: tr("failedToResendInvitation"),
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
      toast({ title: tr("invitationDeleted") });
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: tr("failedToDeleteInvitation"),
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
        <Badge className="bg-success/10 text-success border-success/20">{tr("accepted")}</Badge>
      );
    }
    if (invitation.status === "revoked") {
      return <Badge variant="destructive">{tr("revoked")}</Badge>;
    }
    if (isExpired) {
      return <Badge variant="secondary">{tr("expired")}</Badge>;
    }
    return <Badge className="bg-info/10 text-info border-info/20">{tr("pending")}</Badge>;
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
    toast({ title: tr("invitationLinkCopiedToClipboard") });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  const pendingCount = invitations.filter((i) => i.status === "pending").length;
  const acceptedCount = invitations.filter((i) => i.status === "accepted").length;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={tr("admin")}
        title={tr("userInvitations")}
        testId="text-invitations-title"
        description={tr("inviteClientsToAccessTheirPortal")}
        actions={
          <Button onClick={() => setInviteDialogOpen(true)} data-testid="button-send-invite">
            <Mail className="w-4 h-4 me-2" />
            {tr("sendInvitation")}
          </Button>
        }
      />
      <Dialog open={inviteDialogOpen} onOpenChange={setInviteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{tr("sendClientInvitation")}</DialogTitle>
            <DialogDescription>{tr("inviteANewUserToAccess")}</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSendInvitation} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">{tr("emailAddress")}</Label>
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
              <Label htmlFor="company">{tr("assignToClientOptional")}</Label>
              <Select
                value={selectedCompanyId || "none"}
                onValueChange={(value) => setSelectedCompanyId(value === "none" ? "" : value)}
              >
                <SelectTrigger data-testid="select-invite-company">
                  <SelectValue placeholder={tr("selectAClientCompany")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{tr("noCompanyAssigned")}</SelectItem>
                  {clients.map((client) => (
                    <SelectItem key={client.id} value={client.id}>
                      {client.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">{tr("ifAssignedTheUserWillHave")}</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="userType">{tr("userType")}</Label>
              <Select name="userType" defaultValue="client">
                <SelectTrigger data-testid="select-invite-usertype">
                  <SelectValue placeholder={tr("selectUserType")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="client">{tr("clientNrManagedPortalAccess")}</SelectItem>
                  <SelectItem value="customer">{tr("customerFullSaasBookkeeping")}</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {tr("clientSimplifiedPortalForNrManaged")}
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="role">{tr("accessLevel")}</Label>
              <Select name="role" defaultValue="client">
                <SelectTrigger data-testid="select-invite-role">
                  <SelectValue placeholder={tr("selectAccessLevel")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="client">{tr("standardViewTheirCompanyOnly")}</SelectItem>
                  <SelectItem value="staff">{tr("staffAdminAccess")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setInviteDialogOpen(false)}>
                {tr("cancel")}
              </Button>
              <Button
                type="submit"
                disabled={createInvitationMutation.isPending}
                data-testid="button-submit-invite"
              >
                <Send className="w-4 h-4 me-2" />
                {createInvitationMutation.isPending ? tr("sending") : tr("sendInvitation")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">{tr("totalInvitations")}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{invitations.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">{tr("pending")}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-info">{pendingCount}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">{tr("accepted")}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-success">{acceptedCount}</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-4 flex-1">
              <div className="relative flex-1 max-w-md">
                <Search className="absolute start-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder={tr("searchByEmail")}
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="ps-10"
                  data-testid="input-search-invites"
                />
              </div>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-40" data-testid="select-filter-status">
                  <SelectValue placeholder={tr("filterByStatus")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{tr("allStatus")}</SelectItem>
                  <SelectItem value="pending">{tr("pending")}</SelectItem>
                  <SelectItem value="accepted">{tr("accepted")}</SelectItem>
                  <SelectItem value="revoked">{tr("revoked")}</SelectItem>
                  <SelectItem value="expired">{tr("expired")}</SelectItem>
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
                  <TableHead>{tr("email")}</TableHead>
                  <TableHead>{tr("client")}</TableHead>
                  <TableHead>{tr("role")}</TableHead>
                  <TableHead>{tr("status")}</TableHead>
                  <TableHead>{tr("expires")}</TableHead>
                  <TableHead>{tr("sent")}</TableHead>
                  <TableHead className="text-end">{tr("actions")}</TableHead>
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
                          <span className="text-muted-foreground">{tr("notAssigned")}</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant={invitation.role === "staff" ? "default" : "secondary"}>
                          {invitation.role}
                        </Badge>
                      </TableCell>
                      <TableCell>{getStatusBadge(invitation)}</TableCell>
                      <TableCell>
                        {invitation.expiresAt ? (
                          <span className={isExpired ? "text-destructive" : ""}>
                            {formatDistanceToNow(new Date(invitation.expiresAt), {
                              addSuffix: true,
                            })}
                          </span>
                        ) : (
                          "-"
                        )}
                      </TableCell>
                      <TableCell>
                        {invitation.createdAt
                          ? format(new Date(invitation.createdAt), "MMM d, yyyy")
                          : "-"}
                      </TableCell>
                      <TableCell className="text-end">
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
                                {tr("copyInviteLink")}
                              </DropdownMenuItem>
                            )}
                            {canResend && (
                              <DropdownMenuItem
                                onClick={() => resendInvitationMutation.mutate(invitation.id)}
                                disabled={resendInvitationMutation.isPending}
                              >
                                <RefreshCw className="w-4 h-4 me-2" />
                                {tr("resendInvitation")}
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
                                  {tr("revoke")}
                                </DropdownMenuItem>
                              </>
                            )}
                            <DropdownMenuItem
                              className="text-destructive"
                              onClick={() => {
                                if (confirm(tr("deleteThisInvitation"))) {
                                  deleteInvitationMutation.mutate(invitation.id);
                                }
                              }}
                            >
                              <Trash2 className="w-4 h-4 me-2" />
                              {tr("delete")}
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
                        ? tr("noInvitationsMatchYourFilters")
                        : tr("noInvitationsSentYet")}
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
