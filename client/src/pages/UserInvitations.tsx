import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
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
  ExternalLink
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { apiRequest, queryClient } from '@/lib/queryClient';
import { format, formatDistanceToNow, isAfter } from 'date-fns';
import type { Invitation, Company } from '@shared/schema';

export default function UserInvitations() {
  const { toast } = useToast();
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [inviteDialogOpen, setInviteDialogOpen] = useState(false);
  const [selectedCompanyId, setSelectedCompanyId] = useState<string>('');

  const { data: invitations = [], isLoading } = useQuery<Invitation[]>({
    queryKey: ['/api/admin/invitations'],
  });

  const { data: clients = [] } = useQuery<Company[]>({
    queryKey: ['/api/admin/clients'],
  });

  const createInvitationMutation = useMutation({
    mutationFn: async (data: { email: string; companyId?: string; role: string }) => {
      return apiRequest('/api/admin/invitations', {
        method: 'POST',
        body: JSON.stringify(data),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/invitations'] });
      toast({ title: 'Invitation sent successfully' });
      setInviteDialogOpen(false);
    },
    onError: (error: any) => {
      toast({ variant: 'destructive', title: 'Failed to send invitation', description: error.message });
    },
  });

  const revokeInvitationMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest(`/api/admin/invitations/${id}/revoke`, {
        method: 'PATCH',
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/invitations'] });
      toast({ title: 'Invitation revoked' });
    },
    onError: (error: any) => {
      toast({ variant: 'destructive', title: 'Failed to revoke invitation', description: error.message });
    },
  });

  const resendInvitationMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest(`/api/admin/invitations/${id}/resend`, {
        method: 'POST',
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/invitations'] });
      toast({ title: 'Invitation resent successfully' });
    },
    onError: (error: any) => {
      toast({ variant: 'destructive', title: 'Failed to resend invitation', description: error.message });
    },
  });

  const deleteInvitationMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest(`/api/admin/invitations/${id}`, {
        method: 'DELETE',
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/invitations'] });
      toast({ title: 'Invitation deleted' });
    },
    onError: (error: any) => {
      toast({ variant: 'destructive', title: 'Failed to delete invitation', description: error.message });
    },
  });

  const filteredInvitations = invitations.filter(inv => {
    const matchesSearch = inv.email.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus = statusFilter === 'all' || inv.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const getStatusBadge = (invitation: Invitation) => {
    const isExpired = invitation.expiresAt && isAfter(new Date(), new Date(invitation.expiresAt));
    
    if (invitation.status === 'accepted') {
      return <Badge className="bg-green-500/10 text-green-500 border-green-500/20">Accepted</Badge>;
    }
    if (invitation.status === 'revoked') {
      return <Badge variant="destructive">Revoked</Badge>;
    }
    if (isExpired) {
      return <Badge variant="secondary">Expired</Badge>;
    }
    return <Badge className="bg-blue-500/10 text-blue-500 border-blue-500/20">Pending</Badge>;
  };

  const handleSendInvitation = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const email = formData.get('email') as string;
    const role = formData.get('role') as string;
    
    createInvitationMutation.mutate({
      email,
      companyId: selectedCompanyId || undefined,
      role: role || 'client',
    });
  };

  const copyInviteLink = (token: string) => {
    const link = `${window.location.origin}/register?invite=${token}`;
    navigator.clipboard.writeText(link);
    toast({ title: 'Invitation link copied to clipboard' });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  const pendingCount = invitations.filter(i => i.status === 'pending').length;
  const acceptedCount = invitations.filter(i => i.status === 'accepted').length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold" data-testid="text-invitations-title">User Invitations</h1>
          <p className="text-muted-foreground">Invite clients to access their portal</p>
        </div>
        <Dialog open={inviteDialogOpen} onOpenChange={setInviteDialogOpen}>
          <DialogTrigger asChild>
            <Button data-testid="button-send-invite">
              <Mail className="w-4 h-4 mr-2" />
              Send Invitation
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Send Client Invitation</DialogTitle>
              <DialogDescription>
                Invite a new user to access the client portal. They will receive a link to register.
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={handleSendInvitation} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">Email Address *</Label>
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
                <Label htmlFor="company">Assign to Client (optional)</Label>
                <Select value={selectedCompanyId} onValueChange={setSelectedCompanyId}>
                  <SelectTrigger data-testid="select-invite-company">
                    <SelectValue placeholder="Select a client company" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">No company assigned</SelectItem>
                    {clients.map((client) => (
                      <SelectItem key={client.id} value={client.id}>{client.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  If assigned, the user will have access to this client's data.
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="role">User Role</Label>
                <Select name="role" defaultValue="client">
                  <SelectTrigger data-testid="select-invite-role">
                    <SelectValue placeholder="Select role" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="client">Client (view their company only)</SelectItem>
                    <SelectItem value="staff">Staff (admin access)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setInviteDialogOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={createInvitationMutation.isPending} data-testid="button-submit-invite">
                  <Send className="w-4 h-4 mr-2" />
                  {createInvitationMutation.isPending ? 'Sending...' : 'Send Invitation'}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Total Invitations</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{invitations.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Pending</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-blue-500">{pendingCount}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Accepted</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-500">{acceptedCount}</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-4 flex-1">
              <div className="relative flex-1 max-w-md">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search by email..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10"
                  data-testid="input-search-invites"
                />
              </div>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-40" data-testid="select-filter-status">
                  <SelectValue placeholder="Filter by status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Status</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="accepted">Accepted</SelectItem>
                  <SelectItem value="revoked">Revoked</SelectItem>
                  <SelectItem value="expired">Expired</SelectItem>
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
                  <TableHead>Email</TableHead>
                  <TableHead>Client</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Expires</TableHead>
                  <TableHead>Sent</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredInvitations.map((invitation) => {
                  const client = clients.find(c => c.id === invitation.companyId);
                  const isExpired = invitation.expiresAt && isAfter(new Date(), new Date(invitation.expiresAt));
                  const canResend = invitation.status === 'pending' || isExpired;
                  
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
                          <span className="text-muted-foreground">Not assigned</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant={invitation.role === 'staff' ? 'default' : 'secondary'}>
                          {invitation.role}
                        </Badge>
                      </TableCell>
                      <TableCell>{getStatusBadge(invitation)}</TableCell>
                      <TableCell>
                        {invitation.expiresAt ? (
                          <span className={isExpired ? 'text-destructive' : ''}>
                            {formatDistanceToNow(new Date(invitation.expiresAt), { addSuffix: true })}
                          </span>
                        ) : '-'}
                      </TableCell>
                      <TableCell>
                        {invitation.createdAt 
                          ? format(new Date(invitation.createdAt), 'MMM d, yyyy')
                          : '-'}
                      </TableCell>
                      <TableCell className="text-right">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" data-testid={`button-actions-invite-${invitation.id}`}>
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            {invitation.status === 'pending' && !isExpired && (
                              <DropdownMenuItem onClick={() => copyInviteLink(invitation.token)}>
                                <Copy className="w-4 h-4 mr-2" />
                                Copy Invite Link
                              </DropdownMenuItem>
                            )}
                            {canResend && (
                              <DropdownMenuItem 
                                onClick={() => resendInvitationMutation.mutate(invitation.id)}
                                disabled={resendInvitationMutation.isPending}
                              >
                                <RefreshCw className="w-4 h-4 mr-2" />
                                Resend Invitation
                              </DropdownMenuItem>
                            )}
                            {invitation.status === 'pending' && (
                              <>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem 
                                  className="text-destructive"
                                  onClick={() => revokeInvitationMutation.mutate(invitation.id)}
                                  disabled={revokeInvitationMutation.isPending}
                                >
                                  <XCircle className="w-4 h-4 mr-2" />
                                  Revoke
                                </DropdownMenuItem>
                              </>
                            )}
                            <DropdownMenuItem 
                              className="text-destructive"
                              onClick={() => {
                                if (confirm('Delete this invitation?')) {
                                  deleteInvitationMutation.mutate(invitation.id);
                                }
                              }}
                            >
                              <Trash2 className="w-4 h-4 mr-2" />
                              Delete
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
                      {searchTerm || statusFilter !== 'all' 
                        ? 'No invitations match your filters' 
                        : 'No invitations sent yet'}
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
